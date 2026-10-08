import { GameState } from './types';

type QuestionClock = Pick<GameState, 'questionStartedAt' | 'questionEndsAt' | 'questionPausedAt'>;

export function questionClockTime(state: QuestionClock, now: number): number {
  const pausedAt = Date.parse(state.questionPausedAt ?? '');
  return Number.isFinite(pausedAt) ? pausedAt : now;
}

export function remainingQuestionSeconds(state: QuestionClock | undefined, now: number): number {
  const end = Date.parse(state?.questionEndsAt ?? '');
  return state && Number.isFinite(end) ? Math.max(0, Math.ceil((end - questionClockTime(state, now)) / 1000)) : 0;
}

export function questionProgress(state: QuestionClock | undefined, now: number): number {
  if (!state) return 0;
  const start = Date.parse(state.questionStartedAt ?? '');
  const end = Date.parse(state.questionEndsAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(100, ((end - questionClockTime(state, now)) / Math.max(1, end - start)) * 100));
}

export function visibleClueCount(
  state: QuestionClock,
  now: number,
  clueCount: number,
): number {
  if (clueCount <= 0) return 0;
  if (clueCount === 1) return 1;

  const startedAt = Date.parse(state.questionStartedAt ?? '');
  const endsAt = Date.parse(state.questionEndsAt ?? '');
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return 1;

  const elapsed = Math.max(0, questionClockTime(state, now) - startedAt);
  const interval = (endsAt - startedAt) / clueCount;
  return Math.min(clueCount, Math.floor(elapsed / interval) + 1);
}
