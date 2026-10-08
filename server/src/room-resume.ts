type TimedRoom = {
  status: string;
  question_ends_at: string | null;
  question_paused_at?: string | null;
};

// A resumed question keeps its original deadline, even after a server restart.
export function remainingQuestionDelay(room: TimedRoom, now = Date.now()): number | undefined {
  if (room.status !== 'question' || room.question_paused_at) return undefined;
  const end = Date.parse(room.question_ends_at ?? '');
  return Number.isFinite(end) ? Math.max(0, end - now) : 0;
}
