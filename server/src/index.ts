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
import { createCloudinaryUploadSignature } from './cloudinary.js';
import { getFirebaseWebConfig } from './firebase.js';
import {
  addPlayer,
  createQuiz,
  createRoom,
  deleteAnswerDictionary,
  deleteQuiz,
  findPlayerByNickname,
  getAnswerCount,
  getAnswerDictionaryValues,
  getLeaderboard,
  getOwnedQuiz,
  getOwnedQuizForEditing,
  getPlayer,
  getPlayerAnswer,
  getPlayerCount,
  getPlayers,
  getQuiz,
  getQuizWithAnswers,
  getRoomByCode,
  getSelectedOption,
  hasAnswered,
  listAnswerDictionaries,
  listQuizzes,
  recordAnswer,
  removePlayer,
  saveAnswerDictionary,
  updateRoomQuestion,
  updateRoomPlayerNamesVisibility,
  updateRoomStatus,
  updateQuiz,
  userOwnsQuiz,
  type AnswerMode,
  type QuestionReference,
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
  answerMode: z.enum(['choices', 'autocomplete']).optional(),
  sequenceMode: z.enum(['rounds', 'works-first']).optional(),
  hidePlayerNames: z.boolean().optional(),
  rounds: z
    .array(
      z.object({
        title: z.string().min(1),
        person: z.object({
          name: z.string().min(1),
          answerMode: z.enum(['choices', 'autocomplete']).optional(),
          dictionaryId: z.string().optional(),
          options: z.array(z.string().min(1)).optional(),
          correctOptionIndex: z.number().int().min(0).optional(),
          correctAnswer: z.string().optional(),
        }),
        works: z
          .array(
            z.object({
              title: z.string().min(1),
              kind: z.string().default('other'),
              answerMode: z.enum(['choices', 'autocomplete']).optional(),
              dictionaryId: z.string().optional(),
              options: z.array(z.string().min(1)).optional(),
              correctOptionIndex: z.number().int().min(0).optional(),
              correctAnswer: z.string().optional(),
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
}).superRefine((quiz, ctx) => {
  for (const [roundIndex, round] of quiz.rounds.entries()) {
    validateAnswerConfig(round.person.answerMode ?? quiz.answerMode ?? 'choices', round.person, ['rounds', roundIndex, 'person'], ctx);
    for (const [workIndex, work] of round.works.entries()) {
      validateAnswerConfig(work.answerMode ?? quiz.answerMode ?? 'choices', work, ['rounds', roundIndex, 'works', workIndex], ctx);
    }
  }
});

const dictionarySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  values: z.array(z.string()).default([]),
});

const uploadSignatureSchema = z.object({
  kind: z.enum(['image', 'audio', 'video']),
});

const availableThemes = ['academy', 'cosmic', 'orbit', 'arcade'] as const;
const configuredTheme = availableThemes.includes(process.env.APP_THEME as typeof availableThemes[number])
  ? process.env.APP_THEME
  : 'academy';

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/app/config', (_req, res) => {
  res.json({ theme: configuredTheme, availableThemes });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({ firebase: getFirebaseWebConfig() });
});

app.get('/api/auth/me', requireAdmin, (req, res) => {
  res.json(req.adminUser);
});

app.post('/api/uploads/cloudinary/signature', requireAdmin, (req, res) => {
  const parsed = uploadSignatureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Type de média invalide' });
    return;
  }
  res.json(createCloudinaryUploadSignature(req.adminUser!.id, parsed.data.kind));
});

app.get('/api/answer-dictionaries', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await listAnswerDictionaries(req.adminUser!.id));
}));

app.post('/api/answer-dictionaries', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = dictionarySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const dictionary = await saveAnswerDictionary(req.adminUser!.id, parsed.data);
  if (!dictionary) {
    res.status(404).json({ error: 'Dictionnaire introuvable' });
    return;
  }
  res.status(201).json(dictionary);
}));

app.put('/api/answer-dictionaries/:dictionaryId', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = dictionarySchema.safeParse({ ...req.body, id: req.params.dictionaryId });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const dictionary = await saveAnswerDictionary(req.adminUser!.id, parsed.data);
  if (!dictionary) {
    res.status(404).json({ error: 'Dictionnaire introuvable' });
    return;
  }
  res.json(dictionary);
}));

app.delete('/api/answer-dictionaries/:dictionaryId', requireAdmin, asyncRoute(async (req, res) => {
  const deleted = await deleteAnswerDictionary(req.adminUser!.id, req.params.dictionaryId);
  if (!deleted) {
    res.status(404).json({ error: 'Dictionnaire introuvable' });
    return;
  }
  res.status(204).send();
}));

app.get('/api/quizzes', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await listQuizzes(req.adminUser!.id));
}));

app.post('/api/quizzes', requireAdmin, asyncRoute(async (req, res) => {
  const parsed = quizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(validationErrorResponse(parsed.error.issues));
    return;
  }
  const dictionaryError = await validateQuizAutocompleteAnswers(parsed.data as QuizInput, req.adminUser!.id);
  if (dictionaryError) {
    res.status(400).json(validationErrorResponse([dictionaryError]));
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
    res.status(400).json(validationErrorResponse(parsed.error.issues));
    return;
  }
  const dictionaryError = await validateQuizAutocompleteAnswers(parsed.data as QuizInput, req.adminUser!.id);
  if (dictionaryError) {
    res.status(400).json(validationErrorResponse([dictionaryError]));
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
    callback?.({ ok: true, gameState: await getGameState(room.code, true, false) });
  });

  socket.on('join-room', async (payload: { code: string; nickname: string }, callback) => {
    const room = await getRoomByCode(payload.code);
    const nickname = payload.nickname?.trim() ?? '';
    if (!room) {
      callback?.({ ok: false, error: 'Salon introuvable' });
      return;
    }
    if (room.status !== 'lobby') {
      callback?.({ ok: false, error: 'Cette partie a déjà commencé' });
      return;
    }
    if (nickname.length < 2 || nickname.length > 24) {
      callback?.({ ok: false, error: 'Le pseudo doit contenir entre 2 et 24 caractères' });
      return;
    }
    if (await findPlayerByNickname(room.code, nickname)) {
      callback?.({ ok: false, error: 'Ce pseudo est déjà utilisé dans ce salon' });
      return;
    }

    const player = await addPlayer(room.code, nickname);
    socket.join(room.code);
    socket.join(playerChannel(player.id));
    await emitGameState(room.code, false);
    callback?.({ ok: true, playerId: player.id, player, room, gameState: await getGameState(room.code, false) });
  });

  socket.on('resume-player', async (payload: { code: string; playerId: string }, callback) => {
    const room = await getRoomByCode(payload.code);
    const player = room ? await getPlayer(room.code, payload.playerId) : undefined;
    if (!room || !player) {
      callback?.({ ok: false, error: 'Session joueur introuvable' });
      return;
    }
    socket.join(room.code);
    socket.join(playerChannel(player.id));
    callback?.({ ok: true, player, gameState: await getGameState(room.code, false) });
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
    'set-player-names-visibility',
    async (payload: { code: string; hidePlayerNames: boolean; idToken?: string }, callback) => {
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
      await updateRoomPlayerNamesVisibility(room.code, payload.hidePlayerNames);
      await emitGameState(room.code, false);
      callback?.({ ok: true });
    },
  );

  socket.on('remove-player', async (payload: { code: string; playerId: string; idToken?: string }, callback) => {
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
    if (room.status !== 'lobby') {
      callback?.({ ok: false, error: 'Un joueur ne peut être retiré que depuis le lobby' });
      return;
    }
    const removed = await removePlayer(room.code, payload.playerId);
    if (!removed) {
      callback?.({ ok: false, error: 'Joueur introuvable' });
      return;
    }
    io.to(playerChannel(payload.playerId)).emit('player-removed', { message: "L'animateur vous a retiré du salon." });
    await emitGameState(room.code, false);
    callback?.({ ok: true });
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
        optionId?: string;
        value?: string;
      },
      callback,
    ) => {
      const room = await getRoomByCode(payload.code);
      const activeQuestion = room ? await getActiveQuestion(room, true) : undefined;
      if (!room || !activeQuestion) {
        callback?.({ ok: false, error: 'Salon introuvable' });
        return;
      }
      if (room.status !== 'question') {
        callback?.({ ok: false, error: 'Le temps de réponse est terminé' });
        return;
      }
      if (!(await getPlayer(room.code, payload.playerId))) {
        callback?.({ ok: false, error: 'Session joueur invalide' });
        return;
      }
      if (
        activeQuestion.roundId !== payload.roundId ||
        activeQuestion.targetType !== payload.targetType ||
        activeQuestion.targetId !== payload.targetId
      ) {
        callback?.({ ok: false, error: "Cette question n'est pas active" });
        return;
      }

      const selectedOption = await getSelectedOption(
        room.quiz_id,
        payload.roundId,
        payload.targetType,
        payload.targetId,
        payload.optionId ?? '',
      );

      const submittedValue = payload.value?.trim() ?? '';
      const correctOption = activeQuestion.correctOption;
      const isAutocomplete = activeQuestion.answerMode === 'autocomplete';

      if (!isAutocomplete && !selectedOption) {
        callback?.({ ok: false, error: 'Option introuvable' });
        return;
      }

      if (isAutocomplete && !submittedValue) {
        callback?.({ ok: false, error: 'Réponse vide' });
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
        callback?.({ ok: false, error: 'Réponse déjà envoyée' });
        return;
      }

      const isCorrect = isAutocomplete
        ? normalizeAnswer(submittedValue) === normalizeAnswer(correctOption?.label ?? '')
        : selectedOption?.isCorrect === 1;
      const points = isCorrect ? calculatePoints(payload.targetType, room.question_started_at, room.question_ends_at) : 0;

      await recordAnswer(room.code, {
        player_id: payload.playerId,
        round_id: payload.roundId,
        target_type: payload.targetType,
        target_id: payload.targetId,
        value: isAutocomplete ? submittedValue : payload.optionId ?? '',
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
  const questionCount = room.question_order?.length ?? getQuestionCount(quiz);
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
  await emitGameState(room.code, true);
  return { ok: true, gameState: await getGameState(room.code, true) };
}

async function revealQuestion(code: string): Promise<void> {
  const room = await getRoomByCode(code);
  if (!room || room.status !== 'question') return;
  await updateRoomStatus(room.code, 'reveal');
  clearRevealTimer(code);
  await emitPlayerResults(code);
  await emitGameState(code, false);
}

async function emitGameState(code: string, includeSuggestions = false): Promise<void> {
  io.to(code).emit('game-state', await getGameState(code, false, includeSuggestions));
  io.to(hostChannel(code)).emit('host-game-state', await getGameState(code, true, false));
}

function clearRevealTimer(code: string): void {
  const timer = revealTimers.get(code);
  if (timer) clearTimeout(timer);
  revealTimers.delete(code);
}

async function getGameState(code: string, includeAnswer: boolean, includeSuggestions = true) {
  const room = await getRoomByCode(code);
  if (!room) return undefined;
  const activeQuestion = await getActiveQuestion(room, includeAnswer, includeSuggestions);
  const quiz = (await getQuiz(room.quiz_id)) as QuizWithRounds | undefined;
  const rawLeaderboard = room.status === 'finished' || includeAnswer ? await getLeaderboard(room.code) : [];
  const hidePlayerNames = room.hide_player_names ?? quiz?.hide_player_names ?? false;
  const leaderboard = hidePlayerNames
    ? anonymizeLeaderboard(rawLeaderboard, includeAnswer)
    : rawLeaderboard;
  return {
    status: room.status,
    currentQuestionIndex: room.current_question_index,
    totalQuestions: room.question_order?.length ?? getQuestionCount(quiz),
    questionStartedAt: room.question_started_at,
    questionEndsAt: room.question_ends_at,
    playerCount: await getPlayerCount(room.code),
    answerCount: activeQuestion
      ? await getAnswerCount(room.code, activeQuestion.roundId, activeQuestion.targetType, activeQuestion.targetId)
      : 0,
    leaderboard,
    topLeaderboard: includeAnswer ? leaderboard.slice(0, 5) : [],
    players: includeAnswer ? await getPlayers(room.code) : [],
    hidePlayerNames,
    activeQuestion,
  };
}

async function getActiveQuestion(
  room: {
    quiz_id: string;
    current_question_index: number;
    status: string;
    question_order?: QuestionReference[];
  },
  includeAnswer: boolean,
  includeSuggestions = true,
) {
  const shouldIncludeAnswer = includeAnswer || room.status === 'reveal' || room.status === 'finished';
  const quiz = (await (shouldIncludeAnswer ? getQuizWithAnswers(room.quiz_id) : getQuiz(room.quiz_id))) as
    | QuizWithRounds
    | undefined;
  if (!quiz) return undefined;
  const rounds = quiz.rounds ?? [];
  if (room.current_question_index < 0) return undefined;

  const questionReference =
    room.question_order?.[room.current_question_index]
    ?? getLegacyQuestionReference(rounds, room.current_question_index);
  if (!questionReference) return undefined;
  const round = rounds.find((candidate) => candidate.id === questionReference.round_id);
  if (!round) return undefined;

  const targetType = questionReference.target_type;
  const workTarget =
    targetType === 'work'
      ? round.works.find((work) => work.id === questionReference.target_id)
      : undefined;
  const target = targetType === 'work' ? workTarget : round.person;
  if (!target || target.id !== questionReference.target_id) return undefined;
  const options = target.options.map(({ isCorrect: _isCorrect, ...option }) => option);
  const correctOption = shouldIncludeAnswer ? target.options.find((option) => option.isCorrect === 1) : undefined;
  const answerMode = target.answer_mode ?? quiz.answer_mode ?? 'choices';

  return {
    roundId: round.id,
    roundTitle: round.title,
    targetType,
    targetId: target.id,
    prompt:
      targetType === 'work'
        ? `Quelle est cette œuvre ?`
        : `Quelle personne relie ces trois œuvres ?`,
    clues: workTarget?.clues ?? [],
    works: targetType === 'person' ? round.works.map((work) => ({ title: work.title, clues: [] })) : [],
    answerMode,
    options: answerMode === 'choices' ? options : [],
    suggestions:
      answerMode === 'autocomplete' && includeSuggestions
        ? await getAnswerDictionaryValues(quiz.owner_user_id, target.dictionary_id)
        : [],
    correctOption,
  };
}

function getLegacyQuestionReference(
  rounds: NonNullable<QuizWithRounds['rounds']>,
  questionIndex: number,
): QuestionReference | undefined {
  const roundIndex = Math.floor(questionIndex / 4);
  const questionInRound = questionIndex % 4;
  const round = rounds[roundIndex];
  if (!round) return undefined;
  if (questionInRound < 3) {
    const work = round.works[questionInRound];
    return work
      ? { round_id: round.id, target_type: 'work', target_id: work.id }
      : undefined;
  }
  return { round_id: round.id, target_type: 'person', target_id: round.person.id };
}

function getQuestionCount(quiz: QuizWithRounds | undefined): number {
  return (quiz?.rounds?.length ?? 0) * 4;
}

function anonymizeLeaderboard<T extends { nickname: string; avatar?: string }>(
  leaderboard: T[],
  includeRealNames: boolean,
): Array<T & { realNickname?: string }> {
  return leaderboard.map((player) => ({
    ...player,
    ...(includeRealNames ? { realNickname: player.nickname } : {}),
    nickname: player.avatar || '🎭',
  }));
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

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function validateAnswerConfig(
  answerMode: AnswerMode,
  target: { options?: string[]; correctOptionIndex?: number; correctAnswer?: string },
  path: Array<string | number>,
  ctx: z.RefinementCtx,
): void {
  if (answerMode === 'choices') {
    if (!target.options || target.options.length !== 4 || target.options.some((option) => !option.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quatre propositions non vides sont requises en mode QCM.',
        path: [...path, 'options'],
      });
    }
    if (target.correctOptionIndex === undefined || target.correctOptionIndex < 0 || target.correctOptionIndex > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Une bonne proposition doit être sélectionnée.',
        path: [...path, 'correctOptionIndex'],
      });
    }
    return;
  }

  if (!target.correctAnswer?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Une bonne réponse est requise en mode recherche.',
      path: [...path, 'correctAnswer'],
    });
  }
}

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

async function validateQuizAutocompleteAnswers(quiz: QuizInput, ownerUserId: string): Promise<ValidationIssue | undefined> {
  for (const [roundIndex, round] of quiz.rounds.entries()) {
    const personError = await validateAutocompleteAnswer(
      round.person.answerMode ?? quiz.answerMode ?? 'choices',
      round.person,
      ownerUserId,
      `manche ${roundIndex + 1}, personne cible`,
      ['rounds', roundIndex, 'person', 'correctAnswer'],
    );
    if (personError) return personError;

    for (const [workIndex, work] of round.works.entries()) {
      const workError = await validateAutocompleteAnswer(
        work.answerMode ?? quiz.answerMode ?? 'choices',
        work,
        ownerUserId,
        `manche ${roundIndex + 1}, œuvre ${workIndex + 1}`,
        ['rounds', roundIndex, 'works', workIndex, 'correctAnswer'],
      );
      if (workError) return workError;
    }
  }
  return undefined;
}

async function validateAutocompleteAnswer(
  answerMode: AnswerMode,
  target: { correctAnswer?: string; dictionaryId?: string },
  ownerUserId: string,
  label: string,
  path: Array<string | number>,
): Promise<ValidationIssue | undefined> {
  if (answerMode !== 'autocomplete') return undefined;
  const answer = target.correctAnswer?.trim() ?? '';
  const dictionaryValues = await getAnswerDictionaryValues(ownerUserId, target.dictionaryId);
  const validAnswers = new Set(dictionaryValues.map(normalizeAnswer));
  if (!validAnswers.has(normalizeAnswer(answer))) {
    return {
      path,
      message: `La bonne réponse de ${label} doit être présente dans le dictionnaire sélectionné.`,
    };
  }
  return undefined;
}

function validationErrorResponse(issues: ValidationIssue[] | z.ZodIssue[]) {
  return {
    error: 'Validation impossible',
    issues: issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  };
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
    return { ok: false, error: 'Connexion Firebase requise' };
  }
  try {
    const admin = await verifyAdminToken(idToken);
    if (!(await userOwnsQuiz(quizId, admin.id))) {
      return { ok: false, error: 'Quiz introuvable pour ce compte' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Session Firebase invalide' };
  }
}

type QuizWithRounds = {
  owner_user_id: string;
  answer_mode: AnswerMode;
  hide_player_names: boolean;
  rounds?: Array<{
    id: string;
    title: string;
    person: {
      id: string;
      name: string;
      answer_mode?: AnswerMode;
      dictionary_id?: string;
      options: Array<{ id: string; label: string; position: number; isCorrect?: number }>;
    };
    works: Array<{
      id: string;
      title: string;
      answer_mode?: AnswerMode;
      dictionary_id?: string;
      clues: Array<{ id?: string; kind: string; content: string }>;
      options: Array<{ id: string; label: string; position: number; isCorrect?: number }>;
    }>;
  }>;
};

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
