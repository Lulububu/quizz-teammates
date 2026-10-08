export type QuestionClock = {
  status: string;
  question_started_at: string | null;
  question_ends_at: string | null;
  question_paused_at?: string | null;
};

export function questionPausePatch(room: QuestionClock, paused: boolean, now = Date.now()) {
  if (room.status !== 'question') throw new Error("Cette question n'est plus en cours.");
  if (Boolean(room.question_paused_at) === paused) return undefined;
  const start = Date.parse(room.question_started_at ?? '');
  const end = Date.parse(room.question_ends_at ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Minuteur indisponible.');
  if (paused) {
    if (end <= now) throw new Error('Le temps de réponse est terminé.');
    return { question_paused_at: new Date(now).toISOString() };
  }
  const pausedAt = Date.parse(room.question_paused_at ?? '');
  if (!Number.isFinite(pausedAt)) throw new Error('Pause invalide.');
  const shift = Math.max(0, now - pausedAt);
  // Shift both endpoints to preserve clue intervals and the speed-based score.
  return {
    question_started_at: new Date(start + shift).toISOString(),
    question_ends_at: new Date(end + shift).toISOString(),
    question_paused_at: null,
  };
}

export function calculatePoints(targetType: 'work' | 'person', room: QuestionClock, now = Date.now()): number {
  const basePoints = targetType === 'person' ? 300 : 100;
  const start = Date.parse(room.question_started_at ?? '');
  const end = Date.parse(room.question_ends_at ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return basePoints;
  const remainingRatio = Math.max(0, Math.min(1, (end - now) / Math.max(1, end - start)));
  return Math.round(basePoints * (0.5 + remainingRatio * 0.5));
}
