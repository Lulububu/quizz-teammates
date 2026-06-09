import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataDir = join(rootDir, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'quizz-teammates.sqlite'));
db.pragma('foreign_keys = ON');

const schemaPath = join(rootDir, 'server', 'src', 'schema.sql');
db.exec(readFileSync(schemaPath, 'utf8'));

const quizColumns = new Set(
  (db.prepare('PRAGMA table_info(quizzes)').all() as Array<{ name: string }>).map((column) => column.name),
);
if (!quizColumns.has('owner_user_id')) {
  db.exec('ALTER TABLE quizzes ADD COLUMN owner_user_id TEXT REFERENCES admin_users(id) ON DELETE CASCADE');
}

const roomColumns = new Set(
  (db.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>).map((column) => column.name),
);
if (!roomColumns.has('current_question_index')) {
  db.exec('ALTER TABLE rooms ADD COLUMN current_question_index INTEGER NOT NULL DEFAULT -1');
}
if (!roomColumns.has('question_started_at')) {
  db.exec('ALTER TABLE rooms ADD COLUMN question_started_at TEXT');
}
if (!roomColumns.has('question_ends_at')) {
  db.exec('ALTER TABLE rooms ADD COLUMN question_ends_at TEXT');
}

export type QuizRow = {
  id: string;
  owner_user_id: string | null;
  title: string;
  description: string;
  created_at: string;
};

export type RoomRow = {
  id: string;
  quiz_id: string;
  code: string;
  status: string;
  current_round: number;
  current_question_index: number;
  question_started_at: string | null;
  question_ends_at: string | null;
  created_at: string;
};
