import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getGoogleClientId, requireAdmin, verifyAdminToken } from './auth.js';
import { db } from './db.js';
import {
  createQuiz,
  createRoom,
  deleteQuiz,
  getLeaderboard,
  getOwnedQuiz,
  getOwnedQuizForEditing,
  getQuiz,
  getRoomByCode,
  listQuizzes,
  updateQuiz,
  userOwnsQuiz,
  type QuizInput,
} from './repositories.js';

const app = express();
const server = createServer(app);
const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const clientDistDir = existsSync(join(rootDir, 'dist', 'client', 'browser'))
  ? join(rootDir, 'dist', 'client', 'browser')
  : join(rootDir, 'dist', 'client');
const io = new Server(server, {
  cors: {
    origin: true,
  },
});
const questionDurationMs = 20_000;
const revealTimers = new Map<string, NodeJS.Timeout>();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const quizSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  rounds: z
    .array(
      z.object({
        title: z.string().min(1),
        person: z.object({
          name: z.string().min(1),
          options: z.array(z.string().min(1)).length(4),
          correctOptionIndex: z.number().int().min(0).max(3),
        }),
        works: z
          .array(
            z.object({
              title: z.string().min(1),
              kind: z.string().default('other'),
              options: z.array(z.string().min(1)).length(4),
              correctOptionIndex: z.number().int().min(0).max(3),
              clues: z
                .array(
                  z.object({
                    kind: z.enum(['text', 'image', 'audio', 'video', 'link']),
                    content: z.string().min(1),
                  }),
                )
                .min(1),
            }),
          )
          .length(3),
      }),
    )
    .min(1),
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({ googleClientId: getGoogleClientId() });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json(req.adminUser);
});

app.get('/api/quizzes', requireAdmin, (req, res) => {
  res.json(listQuizzes(req.adminUser!.id));
});

app.post('/api/quizzes', requireAdmin, (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.status(201).json(createQuiz(parsed.data as QuizInput, req.adminUser!.id));
});

app.get('/api/quizzes/:quizId', requireAdmin, (req, res) => {
  const quiz = getOwnedQuiz(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
});

app.get('/api/quizzes/:quizId/edit', requireAdmin, (req, res) => {
  const quiz = getOwnedQuizForEditing(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
});

app.put('/api/quizzes/:quizId', requireAdmin, (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const quiz = updateQuiz(req.params.quizId, parsed.data as QuizInput, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
});

app.delete('/api/quizzes/:quizId', requireAdmin, (req, res) => {
  const deleted = deleteQuiz(req.params.quizId, req.adminUser!.id);
  if (!deleted) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.status(204).send();
});

app.post('/api/quizzes/:quizId/rooms', requireAdmin, (req, res) => {
  const quiz = getOwnedQuiz(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.status(201).json(createRoom(req.params.quizId));
});

app.get('/api/rooms/:code', async (req, res) => {
  const room = getRoomByCode(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'Salon introuvable' });
    return;
  }
  const joinUrl = `${req.protocol}://${req.get('host')}/join/${room.code}`;
  res.json({
    ...room,
    leaderboard: getLeaderboard(room.id),
    gameState: getGameState(room.code, false),
    qrCodeDataUrl: await QRCode.toDataURL(joinUrl),
  });
});

if (existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDistDir, 'index.html'));
  });
}

io.on('connection', (socket) => {
  socket.on('host-room', async (payload: { code: string; idToken?: string }, callback) => {
    const room = getRoomByCode(payload.code);
    if (!room) {
      callback?.({ ok: false, error: 'Salon introuvable' });
      return;
    }
    const admin = await verifyRoomOwner(room.quiz_id, payload.idToken);
    if (!admin.ok) {
      callback?.({ ok: false, error: admin.error });
      return;
    }
    socket.join(room.code);
    socket.join(hostChannel(room.code));
    callback?.({ ok: true, gameState: getGameState(room.code, true) });
  });

  socket.on('join-room', (payload: { code: string; nickname: string }, callback) => {
    const room = getRoomByCode(payload.code);
    if (!room || !payload.nickname?.trim()) {
      callback?.({ ok: false, error: 'Code ou pseudo invalide' });
      return;
    }

    const playerId = randomUUID();
    db.prepare('INSERT INTO players (id, room_id, nickname, score, joined_at) VALUES (?, ?, ?, 0, ?)').run(
      playerId,
      room.id,
      payload.nickname.trim(),
      new Date().toISOString(),
    );
    socket.join(room.code);
    socket.join(playerChannel(playerId));
    emitGameState(room.code);
    callback?.({ ok: true, playerId, room, gameState: getGameState(room.code, false) });
  });

  socket.on('start-game', async (payload: { code: string; idToken?: string }, callback) => {
    const room = getRoomByCode(payload.code);
    if (!room) {
      callback?.({ ok: false, error: 'Salon introuvable' });
      return;
    }
    const admin = await verifyRoomOwner(room.quiz_id, payload.idToken);
    if (!admin.ok) {
      callback?.({ ok: false, error: admin.error });
      return;
    }
    const result = activateQuestion(payload.code, 0);
    callback?.(result);
  });

  socket.on('next-question', async (payload: { code: string; idToken?: string }, callback) => {
    const room = getRoomByCode(payload.code);
    if (!room) {
      callback?.({ ok: false, error: 'Salon introuvable' });
      return;
    }
    const admin = await verifyRoomOwner(room.quiz_id, payload.idToken);
    if (!admin.ok) {
      callback?.({ ok: false, error: admin.error });
      return;
    }
    const result = activateQuestion(payload.code, room.current_question_index + 1);
    callback?.(result);
  });

  socket.on(
    'submit-answer',
    (
      payload: {
        code: string;
        playerId: string;
        roundId: string;
        targetType: 'work' | 'person';
        targetId: string;
        optionId: string;
      },
      callback,
    ) => {
      const room = getRoomByCode(payload.code);
      const activeQuestion = room ? getActiveQuestion(room, false) : undefined;
      if (!room || !activeQuestion) {
        callback?.({ ok: false, error: 'Salon introuvable' });
        return;
      }
      if (room.status !== 'question') {
        callback?.({ ok: false, error: 'Le temps de reponse est termine' });
        return;
      }
      if (
        activeQuestion.roundId !== payload.roundId ||
        activeQuestion.targetType !== payload.targetType ||
        activeQuestion.targetId !== payload.targetId
      ) {
        callback?.({ ok: false, error: 'Cette question n est pas active' });
        return;
      }

      const selectedOption = db
        .prepare(
          `SELECT id, label, is_correct AS isCorrect
           FROM answer_options
           WHERE id = ? AND round_id = ? AND target_type = ? AND target_id = ?`,
        )
        .get(payload.optionId, payload.roundId, payload.targetType, payload.targetId) as
        | { id: string; label: string; isCorrect: number }
        | undefined;

      if (!selectedOption) {
        callback?.({ ok: false, error: 'Option introuvable' });
        return;
      }

      const alreadyAnswered = db
        .prepare(
          `SELECT id FROM answers
           WHERE room_id = ? AND player_id = ? AND round_id = ? AND target_type = ? AND target_id = ?`,
        )
        .get(room.id, payload.playerId, payload.roundId, payload.targetType, payload.targetId);

      if (alreadyAnswered) {
        callback?.({ ok: false, error: 'Reponse deja envoyee' });
        return;
      }

      const isCorrect = selectedOption.isCorrect === 1;
      const points = isCorrect ? calculatePoints(payload.targetType, room.question_started_at, room.question_ends_at) : 0;

      db.prepare(
        `INSERT INTO answers
         (id, room_id, player_id, round_id, target_type, target_id, value, is_correct, points, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        room.id,
        payload.playerId,
        payload.roundId,
        payload.targetType,
        payload.targetId,
        payload.optionId,
        isCorrect ? 1 : 0,
        points,
        new Date().toISOString(),
      );
      if (points > 0) {
        db.prepare('UPDATE players SET score = score + ? WHERE id = ?').run(points, payload.playerId);
      }

      emitGameState(room.code);
      if (allPlayersAnswered(room.id, payload.roundId, payload.targetType, payload.targetId)) {
        revealQuestion(room.code);
      }
      callback?.({ ok: true, isCorrect, points });
    },
  );
});

function activateQuestion(code: string, questionIndex: number) {
  const room = getRoomByCode(code);
  if (!room) {
    return { ok: false, error: 'Salon introuvable' };
  }
  const quiz = getQuiz(room.quiz_id) as QuizWithRounds | undefined;
  const questionCount = getQuestionCount(quiz);
  if (questionIndex >= questionCount) {
    clearRevealTimer(room.code);
    db.prepare(
      `UPDATE rooms
       SET status = 'finished', current_question_index = ?, question_started_at = NULL, question_ends_at = NULL
       WHERE id = ?`,
    ).run(questionIndex, room.id);
    emitGameState(room.code);
    return { ok: true, finished: true };
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + questionDurationMs);
  db.prepare(
    `UPDATE rooms
     SET status = 'question', current_question_index = ?, question_started_at = ?, question_ends_at = ?
     WHERE id = ?`,
  ).run(questionIndex, startedAt.toISOString(), endsAt.toISOString(), room.id);

  clearRevealTimer(room.code);
  revealTimers.set(
    room.code,
    setTimeout(() => revealQuestion(room.code), questionDurationMs),
  );
  emitGameState(room.code);
  return { ok: true, gameState: getGameState(room.code, true) };
}

function revealQuestion(code: string): void {
  const room = getRoomByCode(code);
  if (!room || room.status !== 'question') return;
  db.prepare("UPDATE rooms SET status = 'reveal' WHERE id = ?").run(room.id);
  clearRevealTimer(code);
  emitGameState(code);
  emitPlayerResults(code);
}

function emitGameState(code: string): void {
  io.to(code).emit('game-state', getGameState(code, false));
  io.to(hostChannel(code)).emit('host-game-state', getGameState(code, true));
}

function clearRevealTimer(code: string): void {
  const timer = revealTimers.get(code);
  if (timer) clearTimeout(timer);
  revealTimers.delete(code);
}

function getGameState(code: string, includeAnswer: boolean) {
  const room = getRoomByCode(code);
  if (!room) return undefined;
  const activeQuestion = getActiveQuestion(room, includeAnswer);
  const quiz = getQuiz(room.quiz_id) as QuizWithRounds | undefined;
  return {
    status: room.status,
    currentQuestionIndex: room.current_question_index,
    totalQuestions: getQuestionCount(quiz),
    questionStartedAt: room.question_started_at,
    questionEndsAt: room.question_ends_at,
    playerCount: getPlayerCount(room.id),
    answerCount: activeQuestion ? getAnswerCount(room.id, activeQuestion.roundId, activeQuestion.targetType, activeQuestion.targetId) : 0,
    leaderboard: room.status === 'finished' || includeAnswer ? getLeaderboard(room.id) : [],
    topLeaderboard: includeAnswer ? getLeaderboard(room.id).slice(0, 5) : [],
    activeQuestion,
  };
}

function getActiveQuestion(room: { quiz_id: string; current_question_index: number; status: string }, includeAnswer: boolean) {
  const quiz = getQuiz(room.quiz_id) as QuizWithRounds | undefined;
  const rounds = quiz?.rounds ?? [];
  if (room.current_question_index < 0) return undefined;

  const roundIndex = Math.floor(room.current_question_index / 4);
  const questionInRound = room.current_question_index % 4;
  const round = rounds[roundIndex];
  if (!round) return undefined;

  const target = questionInRound < 3 ? round.works[questionInRound] : round.person;
  const targetType: 'work' | 'person' = questionInRound < 3 ? 'work' : 'person';
  const options = db
    .prepare(
      `SELECT id, label, position
       FROM answer_options
       WHERE round_id = ? AND target_type = ? AND target_id = ?
       ORDER BY position ASC`,
    )
    .all(round.id, targetType, target.id) as Array<{ id: string; label: string; position: number }>;
  const correctOption = includeAnswer || room.status === 'reveal' || room.status === 'finished'
    ? (db
        .prepare(
          `SELECT id, label
           FROM answer_options
           WHERE round_id = ? AND target_type = ? AND target_id = ? AND is_correct = 1`,
        )
        .get(round.id, targetType, target.id) as { id: string; label: string } | undefined)
    : undefined;

  return {
    roundId: round.id,
    roundTitle: round.title,
    targetType,
    targetId: target.id,
    prompt:
      targetType === 'work'
        ? `Quelle est cette oeuvre ?`
        : `Quelle personne relie ces trois oeuvres ?`,
    clues: targetType === 'work' ? target.clues : round.works.flatMap((work) => work.clues),
    works: targetType === 'person' ? round.works.map((work) => ({ title: work.title, clues: work.clues })) : [],
    options,
    correctOption,
  };
}

function getQuestionCount(quiz: QuizWithRounds | undefined): number {
  return (quiz?.rounds?.length ?? 0) * 4;
}

function calculatePoints(targetType: 'work' | 'person', startedAt: string | null, endsAt: string | null): number {
  const basePoints = targetType === 'person' ? 300 : 100;
  if (!startedAt || !endsAt) return basePoints;
  const started = new Date(startedAt).getTime();
  const ends = new Date(endsAt).getTime();
  const now = Date.now();
  const duration = Math.max(1, ends - started);
  const remainingRatio = Math.max(0, Math.min(1, (ends - now) / duration));
  return Math.round(basePoints * (0.5 + remainingRatio * 0.5));
}

function allPlayersAnswered(
  roomId: string,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
): boolean {
  const playerCount = getPlayerCount(roomId);
  if (playerCount === 0) return false;
  return getAnswerCount(roomId, roundId, targetType, targetId) >= playerCount;
}

function getPlayerCount(roomId: string): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM players WHERE room_id = ?').get(roomId) as { count: number }).count;
}

function getAnswerCount(roomId: string, roundId: string, targetType: 'work' | 'person', targetId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM answers
         WHERE room_id = ? AND round_id = ? AND target_type = ? AND target_id = ?`,
      )
      .get(roomId, roundId, targetType, targetId) as { count: number }
  ).count;
}

function emitPlayerResults(code: string): void {
  const room = getRoomByCode(code);
  const question = room ? getActiveQuestion(room, true) : undefined;
  if (!room || !question) return;

  const leaderboard = getLeaderboard(room.id) as Array<{ id: string; nickname: string; score: number }>;
  const players = db.prepare('SELECT id FROM players WHERE room_id = ?').all(room.id) as Array<{ id: string }>;
  for (const player of players) {
    const answer = db
      .prepare(
        `SELECT is_correct AS isCorrect, points
         FROM answers
         WHERE room_id = ? AND player_id = ? AND round_id = ? AND target_type = ? AND target_id = ?`,
      )
      .get(room.id, player.id, question.roundId, question.targetType, question.targetId) as
      | { isCorrect: number; points: number }
      | undefined;
    io.to(playerChannel(player.id)).emit('player-result', {
      isCorrect: answer?.isCorrect === 1,
      points: answer?.points ?? 0,
      rank: leaderboard.findIndex((entry) => entry.id === player.id) + 1,
      totalPlayers: leaderboard.length,
      totalScore: leaderboard.find((entry) => entry.id === player.id)?.score ?? 0,
    });
  }
}

function hostChannel(code: string): string {
  return `host:${code}`;
}

function playerChannel(playerId: string): string {
  return `player:${playerId}`;
}

async function verifyRoomOwner(quizId: string, idToken: string | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!idToken) {
    return { ok: false, error: 'Connexion Google requise' };
  }
  try {
    const admin = await verifyAdminToken(idToken);
    if (!userOwnsQuiz(quizId, admin.id)) {
      return { ok: false, error: 'Quiz introuvable pour ce compte' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Session Google invalide' };
  }
}

type QuizWithRounds = {
  rounds?: Array<{
    id: string;
    title: string;
    person: { id: string; name: string; clues?: unknown[] };
    works: Array<{ id: string; title: string; clues: Array<{ kind: string; content: string }> }>;
  }>;
};

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
