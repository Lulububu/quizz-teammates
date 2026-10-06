import { GameState } from './types';

export function visibleClueCount(
  state: Pick<GameState, 'questionStartedAt' | 'questionEndsAt'>,
  now: number,
  clueCount: number,
): number {
  if (clueCount <= 0) return 0;
  if (clueCount === 1) return 1;

  const startedAt = Date.parse(state.questionStartedAt ?? '');
  const endsAt = Date.parse(state.questionEndsAt ?? '');
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return 1;

  const elapsed = Math.max(0, now - startedAt);
  const interval = (endsAt - startedAt) / clueCount;
  return Math.min(clueCount, Math.floor(elapsed / interval) + 1);
}
