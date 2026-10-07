import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { firestore } from '../server/src/firebase';
import { remainingQuestionDelay } from '../server/src/room-resume';

type Document = { id: string; [key: string]: unknown };
type Filter = [string, string, unknown];
const fixtures: Record<string, Document[]> = { quizzes: [], rooms: [], answerDictionaries: [] };
const queries: { collection: string; filters: Filter[]; fields?: string[] }[] = [];

// Exercise repository queries without credentials or any access to a real Firebase project.
function collection(name: string, filters: Filter[] = [], fields?: string[]): unknown {
  assert(name in fixtures, 'Unexpected collection: ' + name);
  return {
    where: (field: string, operator: string, value: unknown) => collection(name, [...filters, [field, operator, value]], fields),
    select: (...projection: string[]) => collection(name, filters, projection),
    get: async () => {
      queries.push({ collection: name, filters, fields });
      return { docs: fixtures[name].filter(row => filters.every(([field, operator, value]) => {
        if (operator === '==') return row[field] === value;
        assert.equal(operator, 'in');
        return (value as unknown[]).includes(row[field]);
      })).map(row => ({
        id: row.id,
        data: () => fields ? Object.fromEntries(fields.filter(key => key in row).map(key => [key, row[key]])) : row,
      })) };
    },
  };
}

const collectionMock = mock.method(firestore, 'collection', collection as typeof firestore.collection);
const { listActiveRooms } = await import('../server/src/repositories');
after(() => collectionMock.mock.restore());
beforeEach(() => { Object.keys(fixtures).forEach(key => fixtures[key] = []); queries.length = 0; });

test('lists only active rooms belonging to the account, including legacy rooms without an owner field', async () => {
  fixtures.quizzes = [
    { id: 'mine', owner_user_id: 'admin', title: 'My quiz', rounds: [{ works: [{}] }] },
    { id: 'other', owner_user_id: 'someone-else', title: 'Private quiz', rounds: [] },
  ];
  fixtures.rooms = [
    { id: 'LOBBY', quiz_id: 'mine', status: 'lobby', created_at: '2026-01-01' },
    { id: 'LIVE', quiz_id: 'mine', status: 'question', current_question_index: 1, question_order: [{}, {}, {}], created_at: '2026-01-03', answers: ['secret'] },
    { id: 'REVEAL', quiz_id: 'mine', status: 'reveal', current_question_index: 0, created_at: '2026-01-02' },
    { id: 'DONE', quiz_id: 'mine', status: 'finished', created_at: '2026-01-04' },
    { id: 'PRIVATE', quiz_id: 'other', status: 'lobby', created_at: '2026-01-05' },
  ];
  const rooms = await listActiveRooms('admin');
  assert.deepEqual(rooms.map(room => room.code), ['LIVE', 'REVEAL', 'LOBBY']);
  assert.equal(rooms[0].total_questions, 3);
  assert.equal(rooms[2].total_questions, 2);
  assert.equal(rooms[2].current_question_index, -1);
  assert.equal(rooms[0].quiz_title, 'My quiz');
  assert.deepEqual(Object.keys(rooms[0]).sort(), ['code', 'quiz_id', 'quiz_title', 'status', 'current_question_index', 'total_questions', 'created_at'].sort());
  assert.deepEqual(queries[0].filters, [['owner_user_id', '==', 'admin']]);
  assert.deepEqual(queries[1].filters, [['quiz_id', 'in', ['mine']]]);
});

test('does not query rooms when the account owns no quiz', async () => {
  assert.deepEqual(await listActiveRooms('empty'), []);
  assert.equal(queries.length, 1);
});

test('splits large quiz libraries into bounded queries', async () => {
  fixtures.quizzes = Array.from({ length: 23 }, (_, index) => ({ id: 'q' + index, owner_user_id: 'admin', title: 'Quiz', rounds: [] }));
  fixtures.rooms = fixtures.quizzes.map(quiz => ({ id: 'room-' + quiz.id, quiz_id: quiz.id, status: 'lobby' }));
  const rooms = await listActiveRooms('admin');
  assert.equal(rooms.length, 23);
  assert.deepEqual(queries.slice(1).map(query => (query.filters[0][2] as string[]).length), [10, 10, 3]);
});

test('resuming preserves the deadline and restores only the remaining time', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const room = { status: 'question', question_ends_at: '2026-01-01T12:00:13Z' };
  assert.equal(remainingQuestionDelay(room, now), 13_000);
  assert.equal(remainingQuestionDelay(room, now + 8_000), 5_000);
  assert.equal(room.question_ends_at, '2026-01-01T12:00:13Z');
  assert.equal(remainingQuestionDelay(room, now + 13_000), 0);
  assert.equal(remainingQuestionDelay(room, now + 80_000), 0);
  assert.equal(remainingQuestionDelay({ status: 'question', question_ends_at: null }, now), 0);
  assert.equal(remainingQuestionDelay({ status: 'question', question_ends_at: 'invalid' }, now), 0);
  for (const status of ['lobby', 'reveal', 'finished']) {
    assert.equal(remainingQuestionDelay({ ...room, status }, now), undefined);
  }
});
