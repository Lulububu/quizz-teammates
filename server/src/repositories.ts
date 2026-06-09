import { randomUUID } from 'node:crypto';
import { db, type QuizRow, type RoomRow } from './db.js';

export type ClueInput = {
  kind: 'text' | 'image' | 'audio' | 'video' | 'link';
  content: string;
};

export type WorkInput = {
  title: string;
  kind: string;
  clues: ClueInput[];
  options: string[];
  correctOptionIndex: number;
};

export type RoundInput = {
  title: string;
  person: {
    name: string;
    options: string[];
    correctOptionIndex: number;
  };
  works: WorkInput[];
};

export type QuizInput = {
  title: string;
  description?: string;
  rounds: RoundInput[];
};

export function listQuizzes(ownerUserId: string): QuizRow[] {
  return db.prepare('SELECT * FROM quizzes WHERE owner_user_id = ? ORDER BY created_at DESC').all(ownerUserId) as QuizRow[];
}

export function deleteQuiz(quizId: string, ownerUserId: string): boolean {
  const personIds = db.prepare('SELECT person_id AS id FROM rounds WHERE quiz_id = ?').all(quizId) as Array<{
    id: string;
  }>;
  const transaction = db.transaction(() => {
    const result = db.prepare('DELETE FROM quizzes WHERE id = ? AND owner_user_id = ?').run(quizId, ownerUserId);
    for (const person of personIds) {
      db.prepare(
        `DELETE FROM persons
         WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM rounds WHERE person_id = ?)`,
      ).run(person.id, person.id);
    }
    return result.changes > 0;
  });

  return transaction();
}

export function createQuiz(input: QuizInput, ownerUserId: string): QuizRow {
  const quizId = randomUUID();
  const createdAt = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare('INSERT INTO quizzes (id, owner_user_id, title, description, created_at) VALUES (?, ?, ?, ?, ?)').run(
      quizId,
      ownerUserId,
      input.title,
      input.description ?? '',
      createdAt,
    );

    insertQuizRounds(quizId, input.rounds);
  });

  transaction();
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId) as QuizRow;
}

export function updateQuiz(quizId: string, input: QuizInput, ownerUserId: string): QuizRow | undefined {
  const existing = db.prepare('SELECT * FROM quizzes WHERE id = ? AND owner_user_id = ?').get(
    quizId,
    ownerUserId,
  ) as QuizRow | undefined;
  if (!existing) return undefined;

  const personIds = db.prepare('SELECT person_id AS id FROM rounds WHERE quiz_id = ?').all(quizId) as Array<{
    id: string;
  }>;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE quizzes SET title = ?, description = ? WHERE id = ?').run(
      input.title,
      input.description ?? '',
      quizId,
    );
    db.prepare('DELETE FROM rooms WHERE quiz_id = ?').run(quizId);
    db.prepare('DELETE FROM rounds WHERE quiz_id = ?').run(quizId);
    for (const person of personIds) {
      db.prepare(
        `DELETE FROM persons
         WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM rounds WHERE person_id = ?)`,
      ).run(person.id, person.id);
    }
    insertQuizRounds(quizId, input.rounds);
  });

  transaction();
  return db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId) as QuizRow;
}

export function getQuiz(quizId: string) {
  return getQuizDetails(quizId, false);
}

export function getQuizForEditing(quizId: string) {
  return getQuizDetails(quizId, true);
}

export function getOwnedQuiz(quizId: string, ownerUserId: string) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ? AND owner_user_id = ?').get(
    quizId,
    ownerUserId,
  ) as QuizRow | undefined;
  if (!quiz) return undefined;
  return getQuizDetails(quizId, false);
}

export function getOwnedQuizForEditing(quizId: string, ownerUserId: string) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ? AND owner_user_id = ?').get(
    quizId,
    ownerUserId,
  ) as QuizRow | undefined;
  if (!quiz) return undefined;
  return getQuizDetails(quizId, true);
}

export function userOwnsQuiz(quizId: string, ownerUserId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM quizzes WHERE id = ? AND owner_user_id = ?').get(quizId, ownerUserId));
}

function getQuizDetails(quizId: string, includeCorrectOptions: boolean) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId) as QuizRow | undefined;
  if (!quiz) return undefined;

  const rounds = db
    .prepare(
      `SELECT rounds.*, persons.name AS person_name, persons.aliases AS person_aliases
       FROM rounds
       JOIN persons ON persons.id = rounds.person_id
       WHERE quiz_id = ?
       ORDER BY position ASC`,
    )
    .all(quizId) as Array<Record<string, unknown>>;

  return {
    ...quiz,
    rounds: rounds.map((round) => {
      const works = db
        .prepare('SELECT * FROM works WHERE round_id = ? ORDER BY position ASC')
        .all(round.id) as Array<Record<string, unknown>>;
      return {
        id: round.id,
        title: round.title,
        position: round.position,
        person: {
          id: round.person_id,
          name: round.person_name,
          options: db
            .prepare(
              `SELECT id, label, position${includeCorrectOptions ? ', is_correct AS isCorrect' : ''}
               FROM answer_options
               WHERE round_id = ? AND target_type = 'person' AND target_id = ?
               ORDER BY position ASC`,
            )
            .all(round.id as string, round.person_id as string),
        },
        works: works.map((work) => ({
          id: work.id,
          title: work.title,
          kind: work.kind,
          position: work.position,
          clues: db.prepare('SELECT * FROM clues WHERE work_id = ? ORDER BY position ASC').all(work.id as string),
          options: db
            .prepare(
              `SELECT id, label, position${includeCorrectOptions ? ', is_correct AS isCorrect' : ''}
               FROM answer_options
               WHERE round_id = ? AND target_type = 'work' AND target_id = ?
               ORDER BY position ASC`,
            )
            .all(round.id as string, work.id as string),
        })),
      };
    }),
  };
}

export function createRoom(quizId: string): RoomRow {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room = {
    id: randomUUID(),
    quiz_id: quizId,
    code,
    status: 'lobby',
    current_round: 0,
    current_question_index: -1,
    question_started_at: null,
    question_ends_at: null,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO rooms
     (id, quiz_id, code, status, current_round, current_question_index, question_started_at, question_ends_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    room.id,
    room.quiz_id,
    room.code,
    room.status,
    room.current_round,
    room.current_question_index,
    room.question_started_at,
    room.question_ends_at,
    room.created_at,
  );
  return room;
}

export function getRoomByCode(code: string): RoomRow | undefined {
  return db.prepare('SELECT * FROM rooms WHERE code = ?').get(code.toUpperCase()) as RoomRow | undefined;
}

export function getLeaderboard(roomId: string) {
  return db
    .prepare('SELECT id, nickname, score FROM players WHERE room_id = ? ORDER BY score DESC, joined_at ASC')
    .all(roomId);
}

function insertOptions(
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
  options: string[],
  correctOptionIndex: number,
): void {
  options.forEach((label, optionIndex) => {
    db.prepare(
      `INSERT INTO answer_options (id, round_id, target_type, target_id, label, is_correct, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), roundId, targetType, targetId, label, optionIndex === correctOptionIndex ? 1 : 0, optionIndex);
  });
}

function insertQuizRounds(quizId: string, rounds: RoundInput[]): void {
  rounds.forEach((round, roundIndex) => {
    const personId = randomUUID();
    const roundId = randomUUID();

    db.prepare('INSERT INTO persons (id, name, aliases) VALUES (?, ?, ?)').run(
      personId,
      round.person.name,
      JSON.stringify([]),
    );
    db.prepare('INSERT INTO rounds (id, quiz_id, person_id, position, title) VALUES (?, ?, ?, ?, ?)').run(
      roundId,
      quizId,
      personId,
      roundIndex,
      round.title,
    );

    round.works.forEach((work, workIndex) => {
      const workId = randomUUID();
      db.prepare('INSERT INTO works (id, round_id, title, kind, position, aliases) VALUES (?, ?, ?, ?, ?, ?)').run(
        workId,
        roundId,
        work.title,
        work.kind || 'other',
        workIndex,
        JSON.stringify([]),
      );

      insertOptions(roundId, 'work', workId, work.options, work.correctOptionIndex);

      work.clues.forEach((clue, clueIndex) => {
        db.prepare('INSERT INTO clues (id, work_id, kind, content, position) VALUES (?, ?, ?, ?, ?)').run(
          randomUUID(),
          workId,
          clue.kind,
          clue.content,
          clueIndex,
        );
      });
    });

    insertOptions(roundId, 'person', personId, round.person.options, round.person.correctOptionIndex);
  });
}
