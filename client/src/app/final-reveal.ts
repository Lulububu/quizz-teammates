import { GameState } from './types';

export type FinalRevealState = {
  message: string;
  revealedPlayerIds: Set<string>;
  complete: boolean;
};

const otherNamesAtMs = 1_200;
const thirdPlaceAtMs = 3_500;
const secondPlaceAtMs = 6_500;
const firstPlaceAtMs = 10_000;
const revealCompleteAtMs = 13_500;

export function getFinalRevealState(
  state: GameState | undefined,
  now: number,
): FinalRevealState {
  if (!state || state.status !== 'finished') {
    return { message: '', revealedPlayerIds: new Set(), complete: false };
  }
  if (!state.finalRevealStartedAt) {
    return {
      message: '',
      revealedPlayerIds: new Set(state.leaderboard.map((player) => player.id)),
      complete: true,
    };
  }

  const startedAt = new Date(state.finalRevealStartedAt).getTime();
  if (!Number.isFinite(startedAt)) {
    return {
      message: '',
      revealedPlayerIds: new Set(state.leaderboard.map((player) => player.id)),
      complete: true,
    };
  }
  const elapsed = Math.max(0, now - startedAt);
  const complete = elapsed >= revealCompleteAtMs;
  if (!state.hidePlayerNames) {
    return {
      message: '',
      revealedPlayerIds: new Set(state.leaderboard.map((player) => player.id)),
      complete,
    };
  }
  const revealedPlayerIds = new Set<string>();

  if (elapsed >= otherNamesAtMs) {
    for (const player of state.leaderboard.slice(3)) revealedPlayerIds.add(player.id);
  }
  if (elapsed >= thirdPlaceAtMs && state.leaderboard[2]) revealedPlayerIds.add(state.leaderboard[2].id);
  if (elapsed >= secondPlaceAtMs && state.leaderboard[1]) revealedPlayerIds.add(state.leaderboard[1].id);
  if (elapsed >= firstPlaceAtMs && state.leaderboard[0]) revealedPlayerIds.add(state.leaderboard[0].id);

  let message = 'Découvrons les participants…';
  if (elapsed >= thirdPlaceAtMs) message = 'Troisième place';
  if (elapsed >= secondPlaceAtMs) message = 'Deuxième place';
  if (elapsed >= firstPlaceAtMs) message = 'Et le gagnant est…';
  if (complete) message = '';

  return { message, revealedPlayerIds, complete };
}

export function finalPlayerName(
  state: GameState | undefined,
  reveal: FinalRevealState,
  player: { id: string; nickname: string; realNickname?: string },
): string {
  if (!state?.hidePlayerNames || reveal.revealedPlayerIds.has(player.id)) {
    return player.realNickname || player.nickname;
  }
  return player.nickname;
}
