import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { z } from 'zod';
import { requireAdmin, verifyAdminToken } from './auth.js';
import { createCloudinaryUploadSignature } from './cloudinary.js';
import { getFirebaseWebConfig } from './firebase.js';
import { remainingQuestionDelay } from './room-resume.js';
import {
  addPlayer,
  createQuiz,
  createRoom,
  deleteAnswerDictionary,
  deleteQuiz,
  duplicateQuiz,
  getAnswerCount,
  getAnswerStats,
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
  hasAnswered,
  listAnswerDictionaries,
  listQuizzes,
  listActiveRooms,
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
  type RoomRow,
} from './repositories.js';

const app = express();
const server = createServer(app);
const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const clientDistDir = existsSync(join(rootDir, 'dist', 'client', 'browser'))
  ? join(rootDir, 'dist', 'client', 'browser')
  : join(rootDir, 'dist', 'client');
const lobbyReactionEmojis = new Set(['👏', '🔥', '🎉', '❤️', '😂', '🤩', '🚀', '💡', '😎', '🥳', '⭐', '🙌']);
const lastLobbyReactionAt = new Map<string, number>();
const io = new Server(server, {
  cors: {
    origin: true,
  },
});
const questionDurationMs = 40_000;
const revealTimers = new Map<string, NodeJS.Timeout>();
const dictionaryCache = new Map<string, { values: Promise<string[]>; expiresAt: number }>();
const dictionaryCacheTtlMs = 15 * 60_000;
const dictionaryCacheLimit = 3;
const roomUpdateTimers = new Map<string, NodeJS.Timeout>();
const roomStateRevisions = new Map<string, number>();
const roomStateEmissions = new Map<string, number>();
const revealingRooms = new Set<string>();
const answerUpdates = new Map<string, {
  questionIndex: number;
  roundId: string;
  targetType: 'work' | 'person';
  targetId: string;
  timer?: NodeJS.Timeout;
  running: boolean;
  dirty: boolean;
}>();
const jsonBodyLimit = process.env.JSON_BODY_LIMIT ?? '25mb';

app.use(cors());
app.use(express.json({ limit: jsonBodyLimit }));

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

const availableThemes = ['studio', 'academy', 'cosmic', 'orbit', 'arcade'] as const;
const configuredTheme = availableThemes.includes(process.env.APP_THEME as typeof availableThemes[number])
  ? process.env.APP_THEME
  : 'studio';

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
  invalidateDictionaryCache(req.adminUser!.id);
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
  invalidateDictionaryCache(req.adminUser!.id);
  res.json(dictionary);
}));

app.delete('/api/answer-dictionaries/:dictionaryId', requireAdmin, asyncRoute(async (req, res) => {
  const deleted = await deleteAnswerDictionary(req.adminUser!.id, req.params.dictionaryId);
  if (!deleted) {
    res.status(404).json({ error: 'Dictionnaire introuvable' });
    return;
  }
  invalidateDictionaryCache(req.adminUser!.id);
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
  const dictionaryErrors = await validateQuizAutocompleteAnswers(parsed.data as QuizInput, req.adminUser!.id);
  if (dictionaryErrors.length > 0) {
    res.status(400).json(validationErrorResponse(dictionaryErrors));
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
  const dictionaryErrors = await validateQuizAutocompleteAnswers(parsed.data as QuizInput, req.adminUser!.id);
  if (dictionaryErrors.length > 0) {
    res.status(400).json(validationErrorResponse(dictionaryErrors));
    return;
  }
  const quiz = await updateQuiz(req.params.quizId, parsed.data as QuizInput, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.json(quiz);
}));

app.post('/api/quizzes/:quizId/duplicate', requireAdmin, asyncRoute(async (req, res) => {
  const quiz = await duplicateQuiz(req.params.quizId, req.adminUser!.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz introuvable' });
    return;
  }
  res.status(201).json(quiz);
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
  const room = await createRoom(req.params.quizId);
  primeQuizDictionaries(quiz, room.question_order?.[0]);
  res.status(201).json(room);
}));

app.get('/api/rooms', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await listActiveRooms(req.adminUser!.id));
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
  if (isPayloadTooLargeError(error)) {
    res.status(413).json({
      error: 'Payload trop volumineux',
      details: `La requête dépasse la limite configurée (${jsonBodyLimit}).`,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Erreur serveur';
  console.error(error);
  res.status(500).json({
    error: 'Erreur serveur',
    details: process.env.NODE_ENV === 'production' ? undefined : message,
  });
});

function isPayloadTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'type' in error
    && (error as { type?: string }).type === 'entity.too.large'
  );
}

io.on('connection', (socket) => {
  socket.on('host-room', async (payload: { code: string; idToken?: string }, callback) => {
    socket.data.hostRequestCode = payload.code;
    try {
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
      if (socket.data.hostRequestCode !== payload.code || !socket.connected) return;
      if (socket.data.hostRoomCode && socket.data.hostRoomCode !== room.code) {
        socket.leave(socket.data.hostRoomCode);
        socket.leave(hostChannel(socket.data.hostRoomCode));
      }
      socket.data.hostRoomCode = room.code;
      socket.join(room.code);
      socket.join(hostChannel(room.code));
      await restoreQuestionTimer(room.code);
      callback?.({ ok: true, gameState: await getGameState(room.code, true, false) });
    } catch (error) {
      console.error('Reprise du salon impossible', error);
      callback?.({ ok: false, error: 'Impossible de reprendre le salon. Réessayez.' });
    }
  });

  socket.on('leave-host-room', (payload: { code: string }) => {
    if (socket.data.hostRequestCode === payload.code) socket.data.hostRequestCode = undefined;
    if (socket.data.hostRoomCode !== payload.code) return;
    socket.leave(payload.code);
    socket.leave(hostChannel(payload.code));
    socket.data.hostRoomCode = undefined;
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
    const existingPlayers = await getPlayers(room.code);
    if (existingPlayers.some((player) => player.nickname.trim().toLocaleLowerCase('fr-FR') === nickname.toLocaleLowerCase('fr-FR'))) {
      callback?.({ ok: false, error: 'Ce pseudo est déjà utilisé dans ce salon' });
      return;
    }

    socket.join(room.code);
    let player;
    try {
      player = await addPlayer(room.code, nickname, existingPlayers);
    } catch (error) {
      socket.leave(room.code);
      console.error('Inscription du joueur impossible', error);
      callback?.({ ok: false, error: 'Impossible de rejoindre le salon' });
      return;
    }
    socket.join(playerChannel(player.id));
    callback?.({ ok: true, playerId: player.id, player, room, gameState: await getLobbyGameState(room, existingPlayers.length + 1) });
    scheduleRoomState(room.code);
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

  socket.on('lobby-reaction', async (payload: { code: string; playerId: string; emoji: string }, callback) => {
    const room = await getRoomByCode(payload.code);
    const player = room ? await getPlayer(room.code, payload.playerId) : undefined;
    if (!room || !player || room.status !== 'lobby') {
      callback?.({ ok: false, error: 'Réaction indisponible.' });
      return;
    }
    if (!lobbyReactionEmojis.has(payload.emoji)) {
      callback?.({ ok: false, error: 'Réaction invalide.' });
      return;
    }
    const now = Date.now();
    const lastReaction = lastLobbyReactionAt.get(player.id) ?? 0;
    if (now - lastReaction < 450) {
      callback?.({ ok: false, error: 'Patientez avant de renvoyer une réaction.' });
      return;
    }
    lastLobbyReactionAt.set(player.id, now);
    io.to(hostChannel(room.code)).emit('lobby-reaction', {
      id: randomUUID(),
      emoji: payload.emoji,
      side: Math.random() < 0.5 ? 'left' : 'right',
      x: 12 + Math.round(Math.random() * 76),
      y: 12 + Math.round(Math.random() * 68),
    });
    callback?.({ ok: true });
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
      const activeQuestion = room ? await getActiveQuestion(room, true, false) : undefined;
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

      const submittedValue = payload.value?.trim() ?? '';
      const correctOption = activeQuestion.correctOption;
      const isAutocomplete = activeQuestion.answerMode === 'autocomplete';
      const selectedOption = isAutocomplete
        ? undefined
        : activeQuestion.options.find((option) => option.id === payload.optionId);

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
        : selectedOption?.id === correctOption?.id;
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

      callback?.({ ok: true, isCorrect, points });
      scheduleAnswerUpdate(room.code, room.current_question_index, payload.roundId, payload.targetType, payload.targetId);
    },
  );
});

async function getLobbyGameState(room: RoomRow, playerCount: number) {
  const quiz = room.question_order ? undefined : await getQuiz(room.quiz_id);
  return {
    status: 'lobby' as const,
    currentQuestionIndex: room.current_question_index,
    totalQuestions: room.question_order?.length ?? getQuestionCount(quiz as QuizWithRounds | undefined),
    questionStartedAt: null,
    questionEndsAt: null,
    finalRevealStartedAt: null,
    playerCount,
    answerCount: 0,
    answerStats: undefined,
    leaderboard: [],
    topLeaderboard: [],
    players: [],
    hidePlayerNames: room.hide_player_names ?? quiz?.hide_player_names ?? false,
    activeQuestion: undefined,
  };
}

function getCachedDictionaryValues(ownerUserId: string, dictionaryId?: string): Promise<string[]> {
  const key = `${ownerUserId}:${dictionaryId ?? ''}`;
  const cached = dictionaryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.values;
  dictionaryCache.delete(key);
  const values = getAnswerDictionaryValues(ownerUserId, dictionaryId);
  dictionaryCache.set(key, { values, expiresAt: Date.now() + dictionaryCacheTtlMs });
  void values.catch(() => {
    if (dictionaryCache.get(key)?.values === values) dictionaryCache.delete(key);
  });
  while (dictionaryCache.size > dictionaryCacheLimit) {
    dictionaryCache.delete(dictionaryCache.keys().next().value!);
  }
  return values;
}

function invalidateDictionaryCache(ownerUserId: string): void {
  for (const key of dictionaryCache.keys()) {
    if (key.startsWith(`${ownerUserId}:`)) dictionaryCache.delete(key);
  }
}

function primeQuizDictionaries(quiz: QuizWithRounds, firstQuestion?: QuestionReference): void {
  const ids = new Set<string | undefined>();
  if (firstQuestion) {
    const round = quiz.rounds?.find((candidate) => candidate.id === firstQuestion.round_id);
    const target = firstQuestion.target_type === 'person'
      ? round?.person
      : round?.works.find((work) => work.id === firstQuestion.target_id);
    if (target && (target.answer_mode ?? quiz.answer_mode) === 'autocomplete') ids.add(target.dictionary_id);
  }
  for (const round of quiz.rounds ?? []) {
    for (const target of [...round.works, round.person]) {
      if ((target.answer_mode ?? quiz.answer_mode) === 'autocomplete') ids.add(target.dictionary_id);
    }
  }
  for (const id of [...ids].slice(0, dictionaryCacheLimit)) {
    void getCachedDictionaryValues(quiz.owner_user_id, id).catch(console.error);
  }
}

function invalidateRoomState(code: string): void {
  roomStateRevisions.set(code, (roomStateRevisions.get(code) ?? 0) + 1);
  const roomTimer = roomUpdateTimers.get(code);
  if (roomTimer) clearTimeout(roomTimer);
  roomUpdateTimers.delete(code);
  const answerUpdate = answerUpdates.get(code);
  if (answerUpdate?.timer) clearTimeout(answerUpdate.timer);
  answerUpdates.delete(code);
}

function scheduleRoomState(code: string): void {
  if (roomUpdateTimers.has(code)) return;
  roomUpdateTimers.set(code, setTimeout(() => {
    roomUpdateTimers.delete(code);
    void emitGameState(code).catch(console.error);
  }, 150));
}

function scheduleAnswerUpdate(
  code: string,
  questionIndex: number,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
): void {
  let update = answerUpdates.get(code);
  if (!update || update.questionIndex !== questionIndex) {
    update = { questionIndex, roundId, targetType, targetId, running: false, dirty: false };
    answerUpdates.set(code, update);
  }
  update.dirty = true;
  if (update.running || update.timer) return;
  const pending = update;
  pending.timer = setTimeout(() => {
    pending.timer = undefined;
    void flushAnswerUpdate(code, pending);
  }, 150);
}

async function flushAnswerUpdate(code: string, update: NonNullable<ReturnType<typeof answerUpdates.get>>): Promise<void> {
  update.running = true;
  update.dirty = false;
  try {
    const room = await getRoomByCode(code);
    if (room?.status !== 'question' || room.current_question_index !== update.questionIndex) return;
    if (await allPlayersAnswered(code, update.roundId, update.targetType, update.targetId)) {
      await revealQuestion(code);
    } else {
      await emitGameState(code);
    }
  } catch (error) {
    console.error('Mise à jour des réponses impossible', error);
  } finally {
    update.running = false;
    if (answerUpdates.get(code) !== update) return;
    if (update.dirty) {
      answerUpdates.delete(code);
      scheduleAnswerUpdate(code, update.questionIndex, update.roundId, update.targetType, update.targetId);
    } else {
      answerUpdates.delete(code);
    }
  }
}

async function activateQuestion(code: string, questionIndex: number) {
  const room = await getRoomByCode(code);
  if (!room) {
    return { ok: false, error: 'Salon introuvable' };
  }
  const quiz = room.question_order ? undefined : (await getQuiz(room.quiz_id)) as QuizWithRounds | undefined;
  const questionCount = room.question_order?.length ?? getQuestionCount(quiz);
  if (questionIndex >= questionCount) {
    invalidateRoomState(room.code);
    clearRevealTimer(room.code);
    await updateRoomQuestion(room.code, questionIndex, new Date().toISOString(), null, 'finished');
    await emitGameState(room.code);
    return { ok: true, finished: true };
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + questionDurationMs);
  invalidateRoomState(room.code);
  await updateRoomQuestion(room.code, questionIndex, startedAt.toISOString(), endsAt.toISOString());

  clearRevealTimer(room.code);
  revealTimers.set(
    room.code,
    setTimeout(() => {
      void revealQuestion(room.code).catch(console.error);
    }, questionDurationMs),
  );
  await emitGameState(room.code, true);
  return { ok: true };
}

async function restoreQuestionTimer(code: string): Promise<void> {
  const room = await getRoomByCode(code);
  if (!room) return;
  const delay = remainingQuestionDelay(room);
  if (delay === undefined) return;
  if (delay === 0) {
    await revealQuestion(code);
  } else if (!revealTimers.has(code)) {
    revealTimers.set(code, setTimeout(() => {
      void (async () => {
        const current = await getRoomByCode(code);
        if (current?.current_question_index === room.current_question_index
          && current.question_ends_at === room.question_ends_at) await revealQuestion(code);
      })().catch(console.error);
    }, delay));
  }
}

async function revealQuestion(code: string): Promise<void> {
  if (revealingRooms.has(code)) return;
  revealingRooms.add(code);
  try {
    const room = await getRoomByCode(code);
    if (!room || room.status !== 'question') return;
    invalidateRoomState(room.code);
    await updateRoomStatus(room.code, 'reveal');
    clearRevealTimer(code);
    await emitPlayerResults(code);
    await emitGameState(code, false);
  } finally {
    revealingRooms.delete(code);
  }
}

async function emitGameState(code: string, includeSuggestions = false): Promise<void> {
  const revision = roomStateRevisions.get(code) ?? 0;
  const emission = (roomStateEmissions.get(code) ?? 0) + 1;
  roomStateEmissions.set(code, emission);
  const hostState = await getGameState(code, true, includeSuggestions);
  if (!hostState || revision !== (roomStateRevisions.get(code) ?? 0) || emission !== roomStateEmissions.get(code)) return;
  const playerState = {
    ...hostState,
    leaderboard: hostState.status === 'finished' ? hostState.leaderboard : [],
    topLeaderboard: [],
    players: [],
    activeQuestion: hostState.activeQuestion
      ? { ...hostState.activeQuestion, correctOption: hostState.status === 'question' ? undefined : hostState.activeQuestion.correctOption }
      : undefined,
  };
  const hostQuestion = hostState.activeQuestion
    ? { ...hostState.activeQuestion, suggestions: [] }
    : undefined;
  io.to(code).emit('game-state', playerState);
  io.to(hostChannel(code)).emit('host-game-state', { ...hostState, activeQuestion: hostQuestion });
}

function clearRevealTimer(code: string): void {
  const timer = revealTimers.get(code);
  if (timer) clearTimeout(timer);
  revealTimers.delete(code);
}

async function getGameState(code: string, includeAnswer: boolean, includeSuggestions = true) {
  const room = await getRoomByCode(code);
  if (!room) return undefined;
  const [quiz, rawLeaderboard] = await Promise.all([
    includeAnswer || room.status === 'reveal' || room.status === 'finished'
      ? getQuizWithAnswers(room.quiz_id)
      : getQuiz(room.quiz_id),
    room.status === 'finished' || includeAnswer ? getLeaderboard(room.code) : Promise.resolve([]),
  ]) as [QuizWithRounds | undefined, Awaited<ReturnType<typeof getLeaderboard>>];
  const activeQuestionPromise = getActiveQuestion(room, includeAnswer, includeSuggestions, quiz);
  const playerCountPromise = room.status === 'finished' || includeAnswer
    ? Promise.resolve(rawLeaderboard.length)
    : getPlayerCount(room.code);
  const [activeQuestion, playerCount] = await Promise.all([activeQuestionPromise, playerCountPromise]);
  const hidePlayerNames = room.hide_player_names ?? quiz?.hide_player_names ?? false;
  const leaderboard = hidePlayerNames
    ? anonymizeLeaderboard(rawLeaderboard, includeAnswer || room.status === 'finished')
    : rawLeaderboard;
  const answerStats = activeQuestion
    ? await getAnswerStats(room.code, activeQuestion.roundId, activeQuestion.targetType, activeQuestion.targetId)
    : undefined;
  return {
    status: room.status,
    currentQuestionIndex: room.current_question_index,
    totalQuestions: room.question_order?.length ?? getQuestionCount(quiz),
    questionStartedAt: room.question_started_at,
    questionEndsAt: room.question_ends_at,
    finalRevealStartedAt: room.status === 'finished' ? room.question_started_at : null,
    playerCount,
    answerCount: answerStats?.total ?? 0,
    answerStats,
    leaderboard,
    topLeaderboard: includeAnswer ? leaderboard.slice(0, 5) : [],
    players: includeAnswer ? [...rawLeaderboard].sort((a, b) => (a.joined_at ?? '').localeCompare(b.joined_at ?? '')) : [],
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
  includeSuggestions = false,
  providedQuiz?: QuizWithRounds,
) {
  const shouldIncludeAnswer = includeAnswer || room.status === 'reveal' || room.status === 'finished';
  const quiz = (providedQuiz ?? await (shouldIncludeAnswer ? getQuizWithAnswers(room.quiz_id) : getQuiz(room.quiz_id))) as
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
        ? await getCachedDictionaryValues(quiz.owner_user_id, target.dictionary_id)
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

type DictionaryValidationCache = Map<string, Promise<Set<string>>>;

async function validateQuizAutocompleteAnswers(quiz: QuizInput, ownerUserId: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const dictionaryCache: DictionaryValidationCache = new Map();
  for (const [roundIndex, round] of quiz.rounds.entries()) {
    const personError = await validateAutocompleteAnswer(
      round.person.answerMode ?? quiz.answerMode ?? 'choices',
      round.person,
      ownerUserId,
      dictionaryCache,
      `manche ${roundIndex + 1}, personne cible`,
      ['rounds', roundIndex, 'person', 'correctAnswer'],
    );
    if (personError) issues.push(personError);

    for (const [workIndex, work] of round.works.entries()) {
      const workError = await validateAutocompleteAnswer(
        work.answerMode ?? quiz.answerMode ?? 'choices',
        work,
        ownerUserId,
        dictionaryCache,
        `manche ${roundIndex + 1}, œuvre ${workIndex + 1}`,
        ['rounds', roundIndex, 'works', workIndex, 'correctAnswer'],
      );
      if (workError) issues.push(workError);
    }
  }
  return issues;
}

async function validateAutocompleteAnswer(
  answerMode: AnswerMode,
  target: { correctAnswer?: string; dictionaryId?: string },
  ownerUserId: string,
  dictionaryCache: DictionaryValidationCache,
  label: string,
  path: Array<string | number>,
): Promise<ValidationIssue | undefined> {
  if (answerMode !== 'autocomplete') return undefined;
  const answer = target.correctAnswer?.trim() ?? '';
  const validAnswers = await getCachedDictionaryAnswers(ownerUserId, target.dictionaryId, dictionaryCache);
  if (!validAnswers.has(normalizeAnswer(answer))) {
    return {
      path,
      message: `La bonne réponse de ${label} doit être présente dans le dictionnaire sélectionné : "${answer}".`,
    };
  }
  return undefined;
}

function getCachedDictionaryAnswers(
  ownerUserId: string,
  dictionaryId: string | undefined,
  dictionaryCache: DictionaryValidationCache,
): Promise<Set<string>> {
  const cacheKey = dictionaryId || '__all_dictionaries__';
  const cached = dictionaryCache.get(cacheKey);
  if (cached) return cached;
  const promise = getAnswerDictionaryValues(ownerUserId, dictionaryId)
    .then((values) => new Set(values.map(normalizeAnswer)));
  dictionaryCache.set(cacheKey, promise);
  return promise;
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
  const [playerCount, answerCount] = await Promise.all([
    getPlayerCount(code),
    getAnswerCount(code, roundId, targetType, targetId),
  ]);
  if (playerCount === 0) return false;
  return answerCount >= playerCount;
}

async function emitPlayerResults(code: string): Promise<void> {
  const room = await getRoomByCode(code);
  const question = room ? await getActiveQuestion(room, true, false) : undefined;
  if (!room || !question) return;

  const leaderboard = await getLeaderboard(room.code);
  await Promise.all(leaderboard.map(async (player, index) => {
    const answer = await getPlayerAnswer(room.code, player.id, question.roundId, question.targetType, question.targetId);
    io.to(playerChannel(player.id)).emit('player-result', {
      isCorrect: answer?.isCorrect === 1,
      points: answer?.points ?? 0,
      rank: index + 1,
      totalPlayers: leaderboard.length,
      totalScore: player.score,
    });
  }));
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
