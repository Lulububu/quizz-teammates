import { randomUUID } from 'node:crypto';
import { firestore } from './firebase.js';

export type AnswerMode = 'choices' | 'autocomplete';

export type ClueInput = {
  id?: string;
  kind: 'text' | 'image' | 'audio' | 'video' | 'link';
  content: string;
  position?: number;
};

export type WorkInput = {
  id?: string;
  title: string;
  kind: string;
  clues: ClueInput[];
  answerMode?: AnswerMode;
  dictionaryId?: string;
  options?: string[];
  correctOptionIndex?: number;
  correctAnswer?: string;
};

export type RoundInput = {
  id?: string;
  title: string;
  person: {
    id?: string;
    name: string;
    answerMode?: AnswerMode;
    dictionaryId?: string;
    options?: string[];
    correctOptionIndex?: number;
    correctAnswer?: string;
  };
  works: WorkInput[];
};

export type QuizInput = {
  title: string;
  description?: string;
  answerMode?: AnswerMode;
  rounds: RoundInput[];
};

export type AnswerOption = {
  id: string;
  label: string;
  position: number;
  isCorrect?: number;
};

export type Clue = {
  id: string;
  kind: string;
  content: string;
  position: number;
};

export type Work = {
  id: string;
  title: string;
  kind: string;
  position: number;
  answer_mode?: AnswerMode;
  dictionary_id?: string;
  clues: Clue[];
  options: AnswerOption[];
};

export type Round = {
  id: string;
  title: string;
  position: number;
  person: {
    id: string;
    name: string;
    answer_mode?: AnswerMode;
    dictionary_id?: string;
    options: AnswerOption[];
  };
  works: Work[];
};

export type QuizRow = {
  id: string;
  owner_user_id: string;
  title: string;
  description: string;
  answer_mode: AnswerMode;
  created_at: string;
  rounds?: Round[];
};

export type AnswerDictionary = {
  id: string;
  owner_user_id: string;
  name: string;
  values: string[];
  created_at?: string;
  updated_at?: string;
  usage_count?: number;
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

export type PlayerScore = {
  id: string;
  nickname: string;
  score: number;
  joined_at?: string;
};

export type AnswerRow = {
  id: string;
  room_id: string;
  player_id: string;
  round_id: string;
  target_type: 'work' | 'person';
  target_id: string;
  value: string;
  is_correct: number;
  points: number;
  answered_at: string;
};

const quizzes = firestore.collection('quizzes');
const rooms = firestore.collection('rooms');
const answerDictionaries = firestore.collection('answerDictionaries');

export async function listQuizzes(ownerUserId: string): Promise<QuizRow[]> {
  const snapshot = await quizzes.where('owner_user_id', '==', ownerUserId).get();
  return snapshot.docs
    .map((doc) => quizFromDoc(doc.id, doc.data(), false))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createQuiz(input: QuizInput, ownerUserId: string): Promise<QuizRow> {
  const id = randomUUID();
  const quiz = {
    owner_user_id: ownerUserId,
    title: input.title,
    description: input.description ?? '',
    answer_mode: input.answerMode ?? 'choices',
    created_at: new Date().toISOString(),
    rounds: buildRounds(input.rounds, input.answerMode ?? 'choices'),
  };
  await quizzes.doc(id).set(quiz);
  return quizFromDoc(id, quiz, false);
}

export async function updateQuiz(quizId: string, input: QuizInput, ownerUserId: string): Promise<QuizRow | undefined> {
  if (!(await userOwnsQuiz(quizId, ownerUserId))) return undefined;
  await deleteRoomsForQuiz(quizId);
  await quizzes.doc(quizId).update({
    title: input.title,
    description: input.description ?? '',
    answer_mode: input.answerMode ?? 'choices',
    rounds: buildRounds(input.rounds, input.answerMode ?? 'choices'),
  });
  return getOwnedQuiz(quizId, ownerUserId);
}

export async function deleteQuiz(quizId: string, ownerUserId: string): Promise<boolean> {
  if (!(await userOwnsQuiz(quizId, ownerUserId))) return false;
  await deleteRoomsForQuiz(quizId);
  await quizzes.doc(quizId).delete();
  return true;
}

export async function getQuiz(quizId: string): Promise<QuizRow | undefined> {
  return getQuizDetails(quizId, false);
}

export async function getQuizWithAnswers(quizId: string): Promise<QuizRow | undefined> {
  return getQuizDetails(quizId, true);
}

export async function getOwnedQuiz(quizId: string, ownerUserId: string): Promise<QuizRow | undefined> {
  const quiz = await getQuizDetails(quizId, false);
  return quiz?.owner_user_id === ownerUserId ? quiz : undefined;
}

export async function getOwnedQuizForEditing(quizId: string, ownerUserId: string): Promise<QuizRow | undefined> {
  const quiz = await getQuizDetails(quizId, true);
  return quiz?.owner_user_id === ownerUserId ? quiz : undefined;
}

export async function userOwnsQuiz(quizId: string, ownerUserId: string): Promise<boolean> {
  const snapshot = await quizzes.doc(quizId).get();
  return snapshot.exists && snapshot.data()?.owner_user_id === ownerUserId;
}

export async function listAnswerDictionaries(ownerUserId: string): Promise<AnswerDictionary[]> {
  const snapshot = await answerDictionaries.where('owner_user_id', '==', ownerUserId).get();
  const ownedQuizzes = await listQuizzes(ownerUserId);
  return snapshot.docs
    .map((doc) => {
      const dictionary = dictionaryFromDoc(doc.id, doc.data());
      return {
        ...dictionary,
        usage_count: ownedQuizzes.filter((quiz) => quizUsesDictionary(quiz, dictionary.id)).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAnswerDictionaryValues(ownerUserId: string, dictionaryId?: string): Promise<string[]> {
  if (dictionaryId) {
    const snapshot = await answerDictionaries.doc(dictionaryId).get();
    if (snapshot.exists && snapshot.data()?.owner_user_id === ownerUserId) {
      return dictionaryValues(snapshot.data()?.values);
    }
    return [];
  }
  const dictionaries = await listAnswerDictionaries(ownerUserId);
  return Array.from(new Set(dictionaries.flatMap((dictionary) => dictionary.values)));
}

export async function saveAnswerDictionary(
  ownerUserId: string,
  input: { id?: string; name: string; values: string[] },
): Promise<AnswerDictionary | undefined> {
  const id = input.id || randomUUID();
  const uniqueValues = Array.from(new Set(input.values.map((value) => value.trim()).filter(Boolean)));
  const existing = await answerDictionaries.doc(id).get();
  if (existing.exists && existing.data()?.owner_user_id !== ownerUserId) return undefined;
  const dictionary = {
    owner_user_id: ownerUserId,
    name: input.name.trim(),
    values: uniqueValues,
    created_at: existing.data()?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await answerDictionaries.doc(id).set(dictionary);
  return dictionaryFromDoc(id, dictionary);
}

export async function deleteAnswerDictionary(ownerUserId: string, dictionaryId: string): Promise<boolean> {
  const snapshot = await answerDictionaries.doc(dictionaryId).get();
  if (!snapshot.exists || snapshot.data()?.owner_user_id !== ownerUserId) return false;
  await answerDictionaries.doc(dictionaryId).delete();
  return true;
}

export async function createRoom(quizId: string): Promise<RoomRow> {
  const id = randomUUID();
  const code = await createUniqueRoomCode();
  const room: RoomRow = {
    id,
    quiz_id: quizId,
    code,
    status: 'lobby',
    current_round: 0,
    current_question_index: -1,
    question_started_at: null,
    question_ends_at: null,
    created_at: new Date().toISOString(),
  };
  await rooms.doc(code).set(room);
  return room;
}

export async function getRoomByCode(code: string): Promise<RoomRow | undefined> {
  const snapshot = await rooms.doc(code.toUpperCase()).get();
  return snapshot.exists ? (snapshot.data() as RoomRow) : undefined;
}

export async function updateRoomQuestion(
  code: string,
  questionIndex: number,
  startedAt: string | null,
  endsAt: string | null,
  status = 'question',
): Promise<void> {
  await rooms.doc(code).update({
    status,
    current_question_index: questionIndex,
    question_started_at: startedAt,
    question_ends_at: endsAt,
  });
}

export async function updateRoomStatus(code: string, status: string): Promise<void> {
  await rooms.doc(code).update({ status });
}

export async function addPlayer(code: string, nickname: string): Promise<PlayerScore> {
  const id = randomUUID();
  const player = {
    id,
    nickname,
    score: 0,
    joined_at: new Date().toISOString(),
  };
  await rooms.doc(code).collection('players').doc(id).set(player);
  return player;
}

export async function getPlayer(code: string, playerId: string): Promise<PlayerScore | undefined> {
  const snapshot = await rooms.doc(code).collection('players').doc(playerId).get();
  return snapshot.exists ? (snapshot.data() as PlayerScore) : undefined;
}

export async function findPlayerByNickname(code: string, nickname: string): Promise<PlayerScore | undefined> {
  const snapshot = await rooms.doc(code).collection('players').get();
  const normalizedNickname = nickname.trim().toLocaleLowerCase('fr-FR');
  const player = snapshot.docs.find(
    (doc) => String(doc.data().nickname ?? '').trim().toLocaleLowerCase('fr-FR') === normalizedNickname,
  );
  return player ? (player.data() as PlayerScore) : undefined;
}

export async function removePlayer(code: string, playerId: string): Promise<boolean> {
  const playerRef = rooms.doc(code).collection('players').doc(playerId);
  const player = await playerRef.get();
  if (!player.exists) return false;
  const answers = await rooms.doc(code).collection('answers').where('player_id', '==', playerId).get();
  for (const answer of answers.docs) {
    await answer.ref.delete();
  }
  await playerRef.delete();
  return true;
}

export async function getLeaderboard(roomIdOrCode: string): Promise<PlayerScore[]> {
  const snapshot = await rooms.doc(roomIdOrCode).collection('players').get();
  return snapshot.docs
    .map((doc) => doc.data() as PlayerScore)
    .sort((a, b) => b.score - a.score || (a.joined_at ?? '').localeCompare(b.joined_at ?? ''));
}

export async function getPlayerCount(code: string): Promise<number> {
  const snapshot = await rooms.doc(code).collection('players').count().get();
  return snapshot.data().count;
}

export async function getAnswerCount(
  code: string,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
): Promise<number> {
  const snapshot = await rooms
    .doc(code)
    .collection('answers')
    .where('round_id', '==', roundId)
    .where('target_type', '==', targetType)
    .where('target_id', '==', targetId)
    .count()
    .get();
  return snapshot.data().count;
}

export async function getSelectedOption(
  quizId: string,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
  optionId: string,
): Promise<AnswerOption | undefined> {
  const quiz = await getQuizDetails(quizId, true);
  const round = quiz?.rounds?.find((candidate) => candidate.id === roundId);
  const target = targetType === 'person' ? round?.person : round?.works.find((work) => work.id === targetId);
  if (target?.id !== targetId) return undefined;
  return target?.options.find((option) => option.id === optionId);
}

export async function hasAnswered(
  code: string,
  playerId: string,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
): Promise<boolean> {
  const snapshot = await rooms
    .doc(code)
    .collection('answers')
    .where('player_id', '==', playerId)
    .where('round_id', '==', roundId)
    .where('target_type', '==', targetType)
    .where('target_id', '==', targetId)
    .limit(1)
    .get();
  return !snapshot.empty;
}

export async function recordAnswer(code: string, answer: Omit<AnswerRow, 'id' | 'room_id'>): Promise<void> {
  const id = randomUUID();
  await rooms.doc(code).collection('answers').doc(id).set({
    ...answer,
    id,
    room_id: code,
  });
  if (answer.points > 0) {
    const playerRef = rooms.doc(code).collection('players').doc(answer.player_id);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(playerRef);
      const currentScore = Number(snapshot.data()?.score ?? 0);
      transaction.update(playerRef, { score: currentScore + answer.points });
    });
  }
}

export async function getPlayers(code: string): Promise<PlayerScore[]> {
  const snapshot = await rooms.doc(code).collection('players').get();
  return snapshot.docs
    .map((doc) => doc.data() as PlayerScore)
    .sort((a, b) => (a.joined_at ?? '').localeCompare(b.joined_at ?? ''));
}

export async function getPlayerAnswer(
  code: string,
  playerId: string,
  roundId: string,
  targetType: 'work' | 'person',
  targetId: string,
): Promise<{ isCorrect: number; points: number } | undefined> {
  const snapshot = await rooms
    .doc(code)
    .collection('answers')
    .where('player_id', '==', playerId)
    .where('round_id', '==', roundId)
    .where('target_type', '==', targetType)
    .where('target_id', '==', targetId)
    .limit(1)
    .get();
  const data = snapshot.docs[0]?.data() as AnswerRow | undefined;
  return data ? { isCorrect: data.is_correct, points: data.points } : undefined;
}

function buildRounds(rounds: RoundInput[], fallbackAnswerMode: AnswerMode): Round[] {
  return rounds.map((round, roundIndex) => {
    const roundId = randomUUID();
    const personId = randomUUID();
    return {
      id: roundId,
      title: round.title,
      position: roundIndex,
      person: {
        id: personId,
        name: round.person.name,
        answer_mode: round.person.answerMode ?? fallbackAnswerMode,
        dictionary_id: round.person.dictionaryId ?? '',
        options: buildOptions(round.person.options, round.person.correctOptionIndex, round.person.correctAnswer),
      },
      works: round.works.map((work, workIndex) => {
        const workId = randomUUID();
        return {
          id: workId,
          title: work.title,
          kind: work.kind || 'other',
          position: workIndex,
          answer_mode: work.answerMode ?? fallbackAnswerMode,
          dictionary_id: work.dictionaryId ?? '',
          clues: work.clues.map((clue, clueIndex) => ({
            id: randomUUID(),
            kind: clue.kind,
            content: clue.content,
            position: clueIndex,
          })),
          options: buildOptions(work.options, work.correctOptionIndex, work.correctAnswer),
        };
      }),
    };
  });
}

function buildOptions(options?: string[], correctOptionIndex = 0, correctAnswer?: string): AnswerOption[] {
  const labels = options?.length ? options : [correctAnswer ?? ''];
  return labels.map((label, optionIndex) => ({
    id: randomUUID(),
    label,
    position: optionIndex,
    isCorrect: optionIndex === correctOptionIndex || (!options?.length && optionIndex === 0) ? 1 : 0,
  }));
}

async function getQuizDetails(quizId: string, includeCorrectOptions: boolean): Promise<QuizRow | undefined> {
  const snapshot = await quizzes.doc(quizId).get();
  if (!snapshot.exists) return undefined;
  return quizFromDoc(snapshot.id, snapshot.data() ?? {}, includeCorrectOptions);
}

function quizFromDoc(id: string, data: FirebaseFirestore.DocumentData, includeCorrectOptions: boolean): QuizRow {
  const rounds = ((data.rounds ?? []) as Round[]).map((round) => ({
    ...round,
    person: {
      ...round.person,
      options: scrubOptions(round.person.options, includeCorrectOptions),
    },
    works: round.works.map((work) => ({
      ...work,
      options: scrubOptions(work.options, includeCorrectOptions),
    })),
  }));
  return {
    id,
    owner_user_id: data.owner_user_id,
    title: data.title,
    description: data.description ?? '',
    answer_mode: data.answer_mode ?? 'choices',
    created_at: data.created_at,
    rounds,
  };
}

function scrubOptions(options: AnswerOption[], includeCorrectOptions: boolean): AnswerOption[] {
  if (includeCorrectOptions) return options;
  return options.map(({ isCorrect: _isCorrect, ...option }) => option);
}

function dictionaryFromDoc(id: string, data: FirebaseFirestore.DocumentData): AnswerDictionary {
  return {
    id,
    owner_user_id: data.owner_user_id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Dictionnaire principal',
    values: dictionaryValues(data.values),
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

function dictionaryValues(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

function quizUsesDictionary(quiz: QuizRow, dictionaryId: string): boolean {
  return (quiz.rounds ?? []).some(
    (round) =>
      round.person.dictionary_id === dictionaryId ||
      round.works.some((work) => work.dictionary_id === dictionaryId),
  );
}

async function createUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const existing = await rooms.doc(code).get();
    if (!existing.exists) return code;
  }
  return randomUUID().slice(0, 8).toUpperCase();
}

async function deleteRoomsForQuiz(quizId: string): Promise<void> {
  const snapshot = await rooms.where('quiz_id', '==', quizId).get();
  for (const room of snapshot.docs) {
    await deleteSubcollection(room.ref.collection('players'));
    await deleteSubcollection(room.ref.collection('answers'));
    await room.ref.delete();
  }
}

async function deleteSubcollection(collection: FirebaseFirestore.CollectionReference): Promise<void> {
  const snapshot = await collection.get();
  for (const doc of snapshot.docs) {
    await doc.ref.delete();
  }
}
