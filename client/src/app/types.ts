export type Clue = {
  id?: string;
  kind: 'text' | 'image' | 'audio' | 'video' | 'link';
  content: string;
};

export type Work = {
  id?: string;
  title: string;
  kind: string;
  clues: Clue[];
  answer_mode?: 'choices' | 'autocomplete';
  dictionary_id?: string;
  options?: AnswerOption[];
};

export type Round = {
  id?: string;
  title: string;
  person: {
    id?: string;
    name: string;
    answer_mode?: 'choices' | 'autocomplete';
    dictionary_id?: string;
    options?: AnswerOption[];
  };
  works: Work[];
};

export type Quiz = {
  id: string;
  title: string;
  description: string;
  answer_mode: 'choices' | 'autocomplete';
  sequence_mode: 'rounds' | 'works-first';
  hide_player_names: boolean;
  rounds?: Round[];
};

export type Room = {
  id: string;
  quiz_id: string;
  code: string;
  status: string;
  current_round: number;
  qrCodeDataUrl?: string;
  leaderboard?: PlayerScore[];
  gameState?: GameState;
};

export type PlayerScore = {
  id: string;
  nickname: string;
  realNickname?: string;
  avatar?: string;
  score: number;
};

export type AnswerOption = {
  id: string;
  label: string;
  position: number;
  isCorrect?: number;
};

export type GameState = {
  status: 'lobby' | 'question' | 'reveal' | 'finished';
  currentQuestionIndex: number;
  totalQuestions: number;
  questionStartedAt: string | null;
  questionEndsAt: string | null;
  finalRevealStartedAt: string | null;
  playerCount: number;
  answerCount: number;
  answerStats?: AnswerStats;
  leaderboard: PlayerScore[];
  topLeaderboard: PlayerScore[];
  players: PlayerScore[];
  hidePlayerNames: boolean;
  activeQuestion?: ActiveQuestion;
};

export type AnswerStats = {
  total: number;
  correct: number;
  incorrect: number;
};

export type ActiveQuestion = {
  roundId: string;
  roundTitle: string;
  targetType: 'work' | 'person';
  targetId: string;
  prompt: string;
  answerMode: 'choices' | 'autocomplete';
  clues: Clue[];
  works: Array<{ title: string; clues: Clue[] }>;
  options: AnswerOption[];
  suggestions: string[];
  correctOption?: { id: string; label: string };
};

export type AnswerDictionary = {
  id: string;
  name: string;
  values: string[];
  usage_count?: number;
};

export type PlayerResult = {
  isCorrect: boolean;
  points: number;
  totalScore: number;
  rank: number;
  totalPlayers: number;
};

export type LobbyReaction = {
  id: string;
  emoji: string;
  side: 'left' | 'right';
  x: number;
  y: number;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};
