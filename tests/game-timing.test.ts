import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleClueCount } from '../client/src/app/clue-timing';
import { getFinalRevealState } from '../client/src/app/final-reveal';
import type { GameState } from '../client/src/app/types';

const startedAt = '2026-01-01T12:00:00.000Z';
const start = Date.parse(startedAt);

test('three clues span the full 40-second answer window', () => {
  const question = {
    questionStartedAt: startedAt,
    questionEndsAt: new Date(start + 40_000).toISOString(),
  };
  assert.equal(visibleClueCount(question, start, 3), 1);
  assert.equal(visibleClueCount(question, start + 13_333, 3), 1);
  assert.equal(visibleClueCount(question, start + 13_334, 3), 2);
  assert.equal(visibleClueCount(question, start + 26_667, 3), 3);
  assert.equal(visibleClueCount(question, start + 40_000, 3), 3);
});

test('a missing timer shows only the first clue', () => {
  assert.equal(visibleClueCount({ questionStartedAt: null, questionEndsAt: null }, start, 3), 1);
  assert.equal(visibleClueCount({ questionStartedAt: null, questionEndsAt: null }, start, 0), 0);
});

test('final names reveal after positions three, two, then one', () => {
  const state = {
    status: 'finished',
    hidePlayerNames: true,
    finalRevealStartedAt: startedAt,
    leaderboard: [1, 2, 3, 4].map((rank) => ({ id: String(rank), nickname: `Player ${rank}`, score: 0 })),
  } as GameState;
  assert.deepEqual([...getFinalRevealState(state, start + 1_200).revealedPlayerIds], ['4']);
  assert.deepEqual([...getFinalRevealState(state, start + 3_500).revealedPlayerIds], ['4', '3']);
  assert.deepEqual([...getFinalRevealState(state, start + 6_500).revealedPlayerIds], ['4', '3', '2']);
  assert.deepEqual([...getFinalRevealState(state, start + 10_000).revealedPlayerIds], ['4', '3', '2', '1']);
  assert.equal(getFinalRevealState(state, start + 13_499).complete, false);
  assert.equal(getFinalRevealState(state, start + 13_500).complete, true);
});
