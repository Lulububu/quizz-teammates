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
  options?: AnswerOption[];
};

export type Round = {
  id?: string;
  title: string;
  person: {
    id?: string;
    name: string;
    options?: AnswerOption[];
  };
  works: Work[];
};

export type Quiz = {
  id: string;
  title: string;
  description: string;
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
  playerCount: number;
  answerCount: number;
  leaderboard: PlayerScore[];
  topLeaderboard: PlayerScore[];
  activeQuestion?: ActiveQuestion;
};

export type ActiveQuestion = {
  roundId: string;
  roundTitle: string;
  targetType: 'work' | 'person';
  targetId: string;
  prompt: string;
  clues: Clue[];
  works: Array<{ title: string; clues: Clue[] }>;
  options: AnswerOption[];
  correctOption?: { id: string; label: string };
};

export type PlayerResult = {
  isCorrect: boolean;
  points: number;
  totalScore: number;
  rank: number;
  totalPlayers: number;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};
