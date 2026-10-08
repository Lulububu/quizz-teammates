import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { io as connect, type Socket } from 'socket.io-client';
import { firestore, firebaseAuth } from '../server/src/firebase';
import { questionPausePatch, calculatePoints } from '../server/src/question-clock';
import { remainingQuestionDelay } from '../server/src/room-resume';
import { remainingQuestionSeconds, questionProgress, visibleClueCount } from '../client/src/app/clue-timing';

// All persistence and authentication are replaced before importing the actual server.
const documents = new Map<string, any>();
const snapshot = (path: string) => ({ exists: documents.has(path), id: path.split('/').at(-1), data: () => structuredClone(documents.get(path)) });
function doc(path: string): any {
  return { path, get: async () => snapshot(path),
    set: async (data: unknown) => documents.set(path, structuredClone(data)),
    update: async (patch: unknown) => documents.set(path, { ...documents.get(path), ...patch as object }),
    collection: (name: string) => collection(path + '/' + name) };
}
function collection(path: string, filters: Array<[string, unknown]> = [], limit = Infinity): any {
  const rows = () => [...documents].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
    && filters.every(([field, expected]) => value[field] === expected)).slice(0, limit);
  return {
    doc: (id: string) => doc(path + '/' + id),
    where: (field: string, operator: string, value: unknown) => { assert.equal(operator, '=='); return collection(path, [...filters, [field, value]], limit); },
    limit: (count: number) => collection(path, filters, count),
    orderBy: () => collection(path, filters, limit),
    count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
    get: async () => ({ empty: rows().length === 0, docs: rows().map(([key]) => snapshot(key)) }),
  };
}
let transactionQueue = Promise.resolve();
const collections = mock.method(firestore, 'collection', collection);
const transactions = mock.method(firestore, 'runTransaction', (fn: any): any => {
  const operation = transactionQueue.then(async () => {
    const writes: Array<() => void> = [];
    const result = await fn({
      get: async (ref: any) => snapshot(ref.path),
      getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)),
      set: (ref: any, data: unknown) => writes.push(() => { documents.set(ref.path, structuredClone(data)); }),
      update: (ref: any, patch: unknown) => writes.push(() => { documents.set(ref.path, { ...documents.get(ref.path), ...patch as object }); }),
    });
    writes.forEach(write => write());
    return result;
  });
  transactionQueue = operation.then(() => {}, () => {});
  return operation;
});
const auth = mock.method(firebaseAuth, 'verifyIdToken', (async (token: string) => {
  if (token !== 'owner' && token !== 'other') throw new Error('Session invalide');
  return { uid: token, email: token + '@example.test' };
}) as typeof firebaseAuth.verifyIdToken);
const { setRoomQuestionPaused, recordAnswer, revealRoomQuestion, updateRoomQuestion } = await import('../server/src/repositories');
after(() => { collections.mock.restore(); transactions.mock.restore(); auth.mock.restore(); });

const baseTime = Date.parse('2026-01-01T12:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
const timedRoom = (start = baseTime) => ({ id: 'r', code: 'PAUSE1', quiz_id: 'q', status: 'question', current_question_index: 0,
  current_round: 0, created_at: iso(start), question_started_at: iso(start), question_ends_at: iso(start + 40_000), question_paused_at: null as string | null,
  question_order: [{ round_id: 'r1', target_type: 'work', target_id: 'w1' }] });
const answer = { player_id: 'p1', round_id: 'r1', target_type: 'work' as const, target_id: 'w1', value: 'o1', is_correct: 1, answered_at: '' };
beforeEach(() => { documents.clear(); });

test('pause freezes time, progress and clues; repeated resumes preserve duration and speed score', () => {
  let room = { ...timedRoom(), ...questionPausePatch(timedRoom(), true, baseTime + 15_000) };
  const state = { questionStartedAt: room.question_started_at, questionEndsAt: room.question_ends_at, questionPausedAt: room.question_paused_at };
  assert.equal(remainingQuestionSeconds(state, baseTime + 120_000), 25);
  assert.equal(questionProgress(state, baseTime + 120_000), 62.5);
  assert.equal(visibleClueCount(state, baseTime + 120_000, 3), 2);
  assert.equal(remainingQuestionDelay(room, baseTime + 120_000), undefined);
  assert.equal(questionPausePatch(room, true, baseTime + 60_000), undefined);
  room = { ...room, ...questionPausePatch(room, false, baseTime + 120_000) };
  assert.equal(remainingQuestionDelay(room, baseTime + 120_000), 25_000);
  assert.equal(Date.parse(room.question_ends_at) - Date.parse(room.question_started_at), 40_000);
  assert.equal(calculatePoints('work', room, baseTime + 120_000), calculatePoints('work', timedRoom(), baseTime + 15_000));
  assert.equal(questionPausePatch(room, false, baseTime + 130_000), undefined);
  room = { ...room, ...questionPausePatch(room, true, baseTime + 122_000) };
  room = { ...room, ...questionPausePatch(room, false, baseTime + 140_000) };
  assert.equal(remainingQuestionDelay(room, baseTime + 140_000), 23_000);
  assert.throws(() => questionPausePatch(timedRoom(), true, baseTime + 40_000), /terminé/);
  assert.throws(() => questionPausePatch({ ...timedRoom(), status: 'reveal' }, true, baseTime), /plus en cours/);
});

test('persistence rejects late commands and stale timer callbacks across pause/resume', async () => {
  const room = timedRoom(Date.now());
  documents.set('rooms/PAUSE1', room);
  await setRoomQuestionPaused('PAUSE1', 0, true);
  const paused = documents.get('rooms/PAUSE1').question_paused_at;
  await setRoomQuestionPaused('PAUSE1', 0, true);
  assert.equal(documents.get('rooms/PAUSE1').question_paused_at, paused);
  assert.equal(await revealRoomQuestion('PAUSE1', { index: 0, endsAt: room.question_ends_at }), false);
  await assert.rejects(setRoomQuestionPaused('PAUSE1', 1, false), /plus active/);
  await delay(5);
  await setRoomQuestionPaused('PAUSE1', 0, false);
  assert.equal(await revealRoomQuestion('PAUSE1', { index: 0, endsAt: room.question_ends_at }), false);
  assert.equal(await revealRoomQuestion('PAUSE1', { index: 0, endsAt: documents.get('rooms/PAUSE1').question_ends_at }), true);
  await assert.rejects(setRoomQuestionPaused('PAUSE1', 0, true), /plus en cours/);
});

test('answers and scores are atomic, unique, and rejected during pause or after expiry', async () => {
  documents.set('rooms/PAUSE1', timedRoom(Date.now()));
  documents.set('rooms/PAUSE1/players/p1', { id: 'p1', score: 10 });
  await setRoomQuestionPaused('PAUSE1', 0, true);
  await assert.rejects(recordAnswer('PAUSE1', answer, 0), /en pause/);
  assert.equal(documents.get('rooms/PAUSE1/players/p1').score, 10);
  assert.equal([...documents.keys()].filter(key => key.includes('/answers/')).length, 0);
  await setRoomQuestionPaused('PAUSE1', 0, false);
  const results = await Promise.allSettled([recordAnswer('PAUSE1', answer, 0), recordAnswer('PAUSE1', answer, 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(documents.get('rooms/PAUSE1/players/p1').score, 110);
  await updateRoomQuestion('PAUSE1', 1, iso(Date.now() - 50_000), iso(Date.now() - 10_000));
  await assert.rejects(recordAnswer('PAUSE1', { ...answer, target_id: 'w2' }, 1), /terminé/);
  assert.equal(documents.get('rooms/PAUSE1').question_paused_at, null);
});

test('real sockets: owner-only pause, players frozen, reconnection, then reveal after all answers', { timeout: 15_000 }, async t => {
  process.env.PORT = '0';
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  const option = { id: 'o1', label: 'Fondation', isCorrect: 1, position: 0 };
  documents.set('answerDictionaries/d1', { id: 'd1', owner_user_id: 'owner', name: 'Œuvres', values: ['Fondation', 'Interstellar'] });
  documents.set('quizzes/q', { id: 'q', owner_user_id: 'owner', title: 'Test', answer_mode: 'autocomplete', rounds: [{ id: 'r1', title: 'Manche',
    person: { id: 'person', name: 'Camille', options: [option] }, works: [{ id: 'w1', title: 'Fondation', dictionary_id: 'd1', options: [option], clues: [{ kind: 'text', content: 'Indice' }] }] }] });
  documents.set('rooms/PAUSE1', { ...timedRoom(Date.now() - 39_000) });
  for (const id of ['p1', 'p2']) documents.set('rooms/PAUSE1/players/' + id, { id, nickname: id, score: 0 });
  const { server, io } = await import('../server/src/index');
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const sockets: Socket[] = [];
  const emit = (socket: Socket, event: string, payload: unknown): Promise<any> => socket.timeout(3000).emitWithAck(event, payload);
  t.after(async () => {
    if (sockets[0]?.connected) await emit(sockets[0], 'next-question', { code: 'PAUSE1', idToken: 'owner' }).catch(() => {});
    sockets.forEach(socket => socket.disconnect());
    await new Promise<void>(resolve => io.close(() => resolve()));
  });
  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true }); sockets.push(socket);
    await new Promise(resolve => socket.once('connect', resolve)); return socket;
  }
  const host = await client(), player = await client();
  let hostState: any, playerState: any;
  host.on('host-game-state', state => { hostState = state; });
  player.on('game-state', state => { playerState = state; });
  assert.equal((await emit(host, 'host-room', { code: 'PAUSE1', idToken: 'owner' })).ok, true);
  const joined = await emit(player, 'resume-player', { code: 'PAUSE1', playerId: 'p1' });
  assert.equal(joined.ok, true);
  assert(joined.gameState.activeQuestion.suggestions.includes('Fondation'));
  const command = { code: 'PAUSE1', questionIndex: 0, paused: true };
  assert.equal((await emit(player, 'set-question-paused', command)).ok, false);
  assert.equal((await emit(player, 'set-question-paused', { ...command, idToken: 'other' })).ok, false);
  assert.equal((await emit(host, 'set-question-paused', { ...command, idToken: 'owner' })).ok, true);
  await delay(50);
  assert(hostState.questionPausedAt);
  assert.equal(playerState.questionPausedAt, hostState.questionPausedAt);
  await delay(1100);
  assert.equal(documents.get('rooms/PAUSE1').status, 'question');
  const payload = { code: 'PAUSE1', playerId: 'p1', roundId: 'r1', targetType: 'work', targetId: 'w1', value: 'Fondation' };
  assert.match((await emit(player, 'submit-answer', payload)).error, /en pause/);
  const reconnected = await client();
  const restored = await emit(reconnected, 'host-room', { code: 'PAUSE1', idToken: 'owner' });
  assert.equal(restored.gameState.questionPausedAt, hostState.questionPausedAt);
  assert.equal((await emit(host, 'set-question-paused', { ...command, paused: false, idToken: 'owner' })).ok, true);
  assert.equal((await emit(player, 'submit-answer', payload)).ok, true);
  await delay(180);
  assert.equal(documents.get('rooms/PAUSE1').status, 'question');
  const result = new Promise<any>(resolve => player.once('player-result', resolve));
  assert.equal((await emit(player, 'submit-answer', { ...payload, playerId: 'p2' })).ok, true);
  assert.equal((await result).isCorrect, true);
  await delay(40);
  assert.equal(hostState.status, 'reveal');
  assert.equal(playerState.status, 'reveal');
  assert.equal(hostState.answerCount, 2);
  assert.equal(hostState.questionPausedAt, null);
  // A pause winning the race against the last-answer reveal must not lose that reveal.
  await updateRoomQuestion('PAUSE1', 0, iso(Date.now()), iso(Date.now() + 40_000));
  assert.equal((await emit(host, 'set-question-paused', { ...command, idToken: 'owner' })).ok, true);
  assert.equal(documents.get('rooms/PAUSE1').status, 'question');
  assert.equal((await emit(host, 'set-question-paused', { ...command, paused: false, idToken: 'owner' })).ok, true);
  assert.equal(documents.get('rooms/PAUSE1').status, 'reveal');
});
