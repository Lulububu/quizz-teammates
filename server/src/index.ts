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
import { requireAdmin, verifyAdminToken } from './auth.js';
import { getFirebaseWebConfig } from './firebase.js';
import {
  addPlayer,
  createQuiz,
  createRoom,
  deleteQuiz,
  getAnswerCount,
  getLeaderboard,
  getOwnedQuiz,
  getOwnedQuizForEditing,
  getPlayerAnswer,
  getPlayerCount,
  getPlayers,
  getQuiz,
  getRoomByCode,
  getSelectedOption,
  hasAnswered,
  listQuizzes,
  recordAnswer,
  updateRoomQuestion,
  updateRoomStatus,
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
  res.json({ firebase: getFirebaseWebConfig() });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json(req.adminUser);
});

app.get('/api/quizzes', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await listQuizzes(req.adminUser!.id));
}));

app.post('/api/quizzes', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.status(201).json(await createQuiz(parsed.data as QuizInput, req.adminUser!.id));
}));

app.get('/api/quizzes/:quizId', requireAdmin, asyncRoute(async (req, res) => {
  const quiz = await getOwnedQuiz(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
}));

app.get('/api/quizzes/:quizId/edit', requireAdmin, asyncRoute(async (req, res) => {
  const quiz = await getOwnedQuizForEditing(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
}));

app.put('/api/quizzes/:quizId', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const quiz = await updateQuiz(req.params.quizId, parsed.data as QuizInput, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
}));

app.delete('/api/quizzes/:quizId', requireAdmin, asyncRoute(async (req, res) => {
  const deleted = await deleteQuiz(req.params.quizId, req.adminUser!.id);
  if (!deleted) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.status(204).send();
}));

app.post('/api/quizzes/:quizId/rooms', requireAdmin, asyncRoute(async (req, res) => {
  const quiz = await getOwnedQuiz(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.status(201).json(await createRoom(req.params.quizId));
}));

app.get('/api/rooms/:code', asyncRoute(async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room) {
    res.status(404).json({ error: 'Salon introuvable' });
    return;
  }
  const joinUrl = `${req.protocol}://${req.get('host')}/join/${room.code}`;
  res.json({
    ...room,
    leaderboard: await getLeaderboard(room.code),
    gameState: await getGameState(room.code, false),
    qrCodeDataUrl: await QRCode.toDataURL(joinUrl),
  });
}));

if (existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDistDir, 'index.html'));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Erreur serveur';
  console.error(error);
  res.status(500).json({
    error: 'Erreur serveur',
    details: process.env.NODE_ENV === 'production' ? undefined : message,
  });
});

io.on('connection', (socket) => {
  socket.on('host-room', async (payload: { code: string; idToken?: string }, callback) => {
    const room = await getRoomByCode(payload.code);
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
    callback?.({ ok: true, gameState: await getGameState(room.code, true) });
  });

  socket.on('join-room', async (payload: { code: string; nickname: string }, callback) => {
    const room = await getRoomByCode(payload.code);
    if (!room || !payload.nickname?.trim()) {
      callback?.({ ok: false, error: 'Code ou pseudo invalide' });
      return;
    }

    const player = await addPlayer(room.code, payload.nickname.trim());
    socket.join(room.code);
    socket.join(playerChannel(player.id));
    await emitGameState(room.code);
    callback?.({ ok: true, playerId: player.id, room, gameState: await getGameState(room.code, false) });
  });

  socket.on('start-game', async (payload: { code: string; idToken?: string }, callback) => {
    const room = await getRoomByCode(payload.code);
    if (!room) {
      callback?.({ ok: false, error: 'Salon introuvable' });
      return;
    }
    const admin = await verifyRoomOwner(room.quiz_id, payload.idToken);
    if (!admin.ok) {
      callback?.({ ok: false, error: admin.error });
      return;
    }
    const result = await activateQuestion(payload.code, 0);
    callback?.(result);
  });

  socket.on('next-question', async (payload: { code: string; idToken?: string }, callback) => {
    const room = await getRoomByCode(payload.code);
    if (!room) {
      callback?.({ ok: false, error: 'Salon introuvable' });
      return;
    }
    const admin = await verifyRoomOwner(room.quiz_id, payload.idToken);
    if (!admin.ok) {
      callback?.({ ok: false, error: admin.error });
      return;
    }
    const result = await activateQuestion(payload.code, room.current_question_index + 1);
    callback?.(result);
  });

  socket.on(
    'submit-answer',
    async (
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
      const room = await getRoomByCode(payload.code);
      const activeQuestion = room ? await getActiveQuestion(room, false) : undefined;
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

      const selectedOption = await getSelectedOption(
        room.quiz_id,
        payload.roundId,
        payload.targetType,
        payload.targetId,
        payload.optionId,
      );

      if (!selectedOption) {
        callback?.({ ok: false, error: 'Option introuvable' });
        return;
      }

      const alreadyAnswered = await hasAnswered(
        room.code,
        payload.playerId,
        payload.roundId,
        payload.targetType,
        payload.targetId,
      );

      if (alreadyAnswered) {
        callback?.({ ok: false, error: 'Reponse deja envoyee' });
        return;
      }

      const isCorrect = selectedOption.isCorrect === 1;
      const points = isCorrect ? calculatePoints(payload.targetType, room.question_started_at, room.question_ends_at) : 0;

      await recordAnswer(room.code, {
        player_id: payload.playerId,
        round_id: payload.roundId,
        target_type: payload.targetType,
        target_id: payload.targetId,
        value: payload.optionId,
        is_correct: isCorrect ? 1 : 0,
        points,
        answered_at: new Date().toISOString(),
      });

      await emitGameState(room.code);
      if (await allPlayersAnswered(room.code, payload.roundId, payload.targetType, payload.targetId)) {
        await revealQuestion(room.code);
      }
      callback?.({ ok: true, isCorrect, points });
    },
  );
});

async function activateQuestion(code: string, questionIndex: number) {
  const room = await getRoomByCode(code);
  if (!room) {
    return { ok: false, error: 'Salon introuvable' };
  }
  const quiz = (await getQuiz(room.quiz_id)) as QuizWithRounds | undefined;
  const questionCount = getQuestionCount(quiz);
  if (questionIndex >= questionCount) {
    clearRevealTimer(room.code);
    await updateRoomQuestion(room.code, questionIndex, null, null, 'finished');
    await emitGameState(room.code);
    return { ok: true, finished: true };
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + questionDurationMs);
  await updateRoomQuestion(room.code, questionIndex, startedAt.toISOString(), endsAt.toISOString());

  clearRevealTimer(room.code);
  revealTimers.set(
    room.code,
    setTimeout(() => {
      void revealQuestion(room.code);
    }, questionDurationMs),
  );
  await emitGameState(room.code);
  return { ok: true, gameState: await getGameState(room.code, true) };
}

async function revealQuestion(code: string): Promise<void> {
  const room = await getRoomByCode(code);
  if (!room || room.status !== 'question') return;
  await updateRoomStatus(room.code, 'reveal');
  clearRevealTimer(code);
  await emitGameState(code);
  await emitPlayerResults(code);
}

async function emitGameState(code: string): Promise<void> {
  io.to(code).emit('game-state', await getGameState(code, false));
  io.to(hostChannel(code)).emit('host-game-state', await getGameState(code, true));
}

function clearRevealTimer(code: string): void {
  const timer = revealTimers.get(code);
  if (timer) clearTimeout(timer);
  revealTimers.delete(code);
}

async function getGameState(code: string, includeAnswer: boolean) {
  const room = await getRoomByCode(code);
  if (!room) return undefined;
  const activeQuestion = await getActiveQuestion(room, includeAnswer);
  const quiz = (await getQuiz(room.quiz_id)) as QuizWithRounds | undefined;
  const leaderboard = room.status === 'finished' || includeAnswer ? await getLeaderboard(room.code) : [];
  return {
    status: room.status,
    currentQuestionIndex: room.current_question_index,
    totalQuestions: getQuestionCount(quiz),
    questionStartedAt: room.question_started_at,
    questionEndsAt: room.question_ends_at,
    playerCount: await getPlayerCount(room.code),
    answerCount: activeQuestion
      ? await getAnswerCount(room.code, activeQuestion.roundId, activeQuestion.targetType, activeQuestion.targetId)
      : 0,
    leaderboard,
    topLeaderboard: includeAnswer ? leaderboard.slice(0, 5) : [],
    activeQuestion,
  };
}

async function getActiveQuestion(
  room: { quiz_id: string; current_question_index: number; status: string },
  includeAnswer: boolean,
) {
  const quiz = (await getQuiz(room.quiz_id)) as QuizWithRounds | undefined;
  const rounds = quiz?.rounds ?? [];
  if (room.current_question_index < 0) return undefined;

  const roundIndex = Math.floor(room.current_question_index / 4);
  const questionInRound = room.current_question_index % 4;
  const round = rounds[roundIndex];
  if (!round) return undefined;

  const targetType: 'work' | 'person' = questionInRound < 3 ? 'work' : 'person';
  const target = targetType === 'work' ? round.works[questionInRound] : round.person;
  const options = target.options.map(({ isCorrect: _isCorrect, ...option }) => option);
  const correctOption = includeAnswer || room.status === 'reveal' || room.status === 'finished'
    ? target.options.find((option) => option.isCorrect === 1)
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
    clues: targetType === 'work' ? round.works[questionInRound].clues : round.works.flatMap((work) => work.clues),
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

async function allPlayersAnswered(
  code: string,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
): Promise<boolean> {
  const playerCount = await getPlayerCount(code);
  if (playerCount === 0) return false;
  return (await getAnswerCount(code, roundId, targetType, targetId)) >= playerCount;
}

async function emitPlayerResults(code: string): Promise<void> {
  const room = await getRoomByCode(code);
  const question = room ? await getActiveQuestion(room, true) : undefined;
  if (!room || !question) return;

  const leaderboard = await getLeaderboard(room.code);
  const players = await getPlayers(room.code);
  for (const player of players) {
    const answer = await getPlayerAnswer(room.code, player.id, question.roundId, question.targetType, question.targetId);
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

function asyncRoute(
  handler: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>,
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

async function verifyRoomOwner(quizId: string, idToken: string | undefined): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!idToken) {
    return { ok: false, error: 'Connexion Google requise' };
  }
  try {
    const admin = await verifyAdminToken(idToken);
    if (!(await userOwnsQuiz(quizId, admin.id))) {
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
    person: {
      id: string;
      name: string;
      options: Array<{ id: string; label: string; position: number; isCorrect?: number }>;
    };
    works: Array<{
      id: string;
      title: string;
      clues: Array<{ id?: string; kind: string; content: string }>;
      options: Array<{ id: string; label: string; position: number; isCorrect?: number }>;
    }>;
  }>;
};

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
