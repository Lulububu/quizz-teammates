import { GameState } from './types';

export type FinalRevealState = {
  message: string;
  revealedPlayerIds: Set<string>;
};

export function getFinalRevealState(
  state: GameState | undefined,
  now: number,
): FinalRevealState {
  if (!state || state.status !== 'finished') {
    return { message: '', revealedPlayerIds: new Set() };
  }
  if (!state.hidePlayerNames) {
    return {
      message: '',
      revealedPlayerIds: new Set(state.leaderboard.map((player) => player.id)),
    };
  }
  if (!state.finalRevealStartedAt) {
    return {
      message: '',
      revealedPlayerIds: new Set(state.leaderboard.map((player) => player.id)),
    };
  }

  const startedAt = new Date(state.finalRevealStartedAt).getTime();
  const elapsed = Math.max(0, now - startedAt);
  const revealedPlayerIds = new Set<string>();

  if (elapsed >= 700) {
    for (const player of state.leaderboard.slice(3)) revealedPlayerIds.add(player.id);
  }
  if (elapsed >= 1800 && state.leaderboard[2]) revealedPlayerIds.add(state.leaderboard[2].id);
  if (elapsed >= 3400 && state.leaderboard[1]) revealedPlayerIds.add(state.leaderboard[1].id);
  if (elapsed >= 5200 && state.leaderboard[0]) revealedPlayerIds.add(state.leaderboard[0].id);

  let message = 'Découvrons les participants…';
  if (elapsed >= 1800) message = 'Troisième place';
  if (elapsed >= 3400) message = 'Deuxième place';
  if (elapsed >= 5200) message = 'Et le gagnant est…';
  if (elapsed >= 6800) message = '';

  return { message, revealedPlayerIds };
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
