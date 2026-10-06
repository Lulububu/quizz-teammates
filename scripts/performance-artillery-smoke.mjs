import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

const app = express();
app.use(express.json());
const server = createServer(app);
const io = new Server(server);
const players = new Map();
const answers = new Map();
const code = 'SMOKE1';
const expectedPlayers = Number(process.env.PERF_SMOKE_PLAYERS ?? 2);
const answerMode = process.env.PERF_SMOKE_MODE ?? 'autocomplete';
const question = {
  roundId: 'round', targetType: 'work', targetId: 'work',
  answerMode, options: [{ id: 'good', label: 'Bonne' }, { id: 'bad', label: 'Mauvaise' }],
};
let status = 'lobby';

function leaderboard() {
  return [...players.values()].sort((a, b) => b.score - a.score);
}

function state(host) {
  const ranked = leaderboard();
  return {
    status, totalQuestions: 1, currentQuestionIndex: status === 'lobby' ? -1 : status === 'finished' ? 1 : 0,
    playerCount: players.size,
    answerStats: { total: answers.size, correct: [...answers.values()].filter(Boolean).length, incorrect: [...answers.values()].filter((value) => !value).length },
    leaderboard: host || status === 'finished' ? ranked : [],
    topLeaderboard: host ? ranked.slice(0, 5) : [],
    players: host ? ranked : [],
    activeQuestion: status === 'finished' || status === 'lobby' ? undefined : {
      ...question, suggestions: answerMode === 'autocomplete' ? ['Bonne', 'Mauvaise'] : [],
      ...(host || status === 'reveal' ? { correctOption: { id: 'good', label: 'Bonne' } } : {}),
    },
  };
}

function broadcast() {
  io.to(code).emit('game-state', state(false));
  io.to('host').emit('host-game-state', state(true));
}

app.get('/api/quizzes/smoke/edit', (_req, res) => res.json({
  rounds: [{
    works: [{ id: 'work', options: [{ id: 'good', label: 'Bonne', isCorrect: 1 }, { id: 'bad', label: 'Mauvaise', isCorrect: 0 }] }],
    person: { id: 'person', options: [{ id: 'person-good', label: 'Personne', isCorrect: 1 }] },
  }],
}));
app.post('/api/quizzes/smoke/rooms', (_req, res) => res.json({ code }));

io.on('connection', (socket) => {
  socket.on('host-room', (_payload, callback) => {
    socket.join(code);
    socket.join('host');
    callback({ ok: true, gameState: state(true) });
  });
  socket.on('join-room', ({ nickname }, callback) => {
    const id = nickname;
    players.set(id, { id, nickname, score: 0 });
    socket.join(code);
    socket.join(`player:${id}`);
    callback({ ok: true, playerId: id, gameState: state(false) });
    broadcast();
  });
  socket.on('start-game', (_payload, callback) => {
    status = 'question';
    broadcast();
    callback({ ok: true });
  });
  socket.on('submit-answer', ({ playerId, optionId, value }, callback) => {
    const correct = answerMode === 'autocomplete' ? value === 'Bonne' : optionId === 'good';
    answers.set(playerId, correct);
    if (correct) players.get(playerId).score = 100;
    callback({ ok: true, isCorrect: correct, points: correct ? 100 : 0 });
    if (answers.size === expectedPlayers) {
      status = 'reveal';
      const ranked = leaderboard();
      for (const player of ranked) {
        io.to(`player:${player.id}`).emit('player-result', {
          isCorrect: answers.get(player.id), points: player.score, totalScore: player.score,
          rank: ranked.findIndex((entry) => entry.id === player.id) + 1, totalPlayers: expectedPlayers,
        });
      }
      broadcast();
    }
  });
  socket.on('next-question', (_payload, callback) => {
    status = 'finished';
    broadcast();
    callback({ ok: true });
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const child = spawn(process.execPath, ['scripts/performance-artillery-controller.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PERF_BASE_URL: `http://127.0.0.1:${port}`,
    PERF_QUIZ_ID: 'smoke',
    PERF_ADMIN_TOKEN: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.e30`,
    PERF_PLAYERS: String(expectedPlayers), PERF_LAG_MS: '0',
    PERF_REPORT: '/tmp/quizz-artillery-smoke.json',
  },
});
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
await new Promise((resolve) => io.close(resolve));
process.exitCode = exitCode ?? 1;
