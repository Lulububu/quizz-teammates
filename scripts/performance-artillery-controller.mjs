import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.perf.local', quiet: true });

const baseUrl = (process.env.PERF_BASE_URL ?? '').replace(/\/$/, '');
const quizId = process.env.PERF_QUIZ_ID;
const token = (process.env.PERF_ADMIN_TOKEN ?? '').replace(/^Bearer\s+/i, '').trim().replace(/\\_/g, '_');
const players = Number(process.env.PERF_PLAYERS ?? 30);
const timeoutMs = Number(process.env.PERF_TIMEOUT_MS ?? 45_000);
const revealMs = Number(process.env.PERF_REVEAL_MS ?? 3_000);
const report = process.env.PERF_REPORT ?? '/tmp/quizz-artillery-report.json';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function waitFor(items, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`${label} non reçu en ${timeoutMs} ms`));
    }, timeoutMs);
    const poll = setInterval(() => {
      const match = items.find(predicate);
      if (!match) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(match);
    }, 50);
  });
}

function acknowledge(socket, event, payload, acknowledgementTimeoutMs = timeoutMs) {
  return new Promise((resolve, reject) => {
    socket.timeout(acknowledgementTimeoutMs).emit(event, payload, (error, response) => {
      if (error) reject(new Error(`${event} : délai dépassé`));
      else if (!response?.ok) reject(new Error(`${event} : ${response?.error ?? 'échec'}`));
      else resolve(response);
    });
  });
}

async function getJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  check(response.ok, `${path} : HTTP ${response.status}`);
  return response.json();
}

function referenceAnswers(quiz) {
  const answers = {};
  for (const round of quiz.rounds ?? []) {
    for (const question of [...round.works, round.person]) {
      const correct = question.options.find((option) => option.isCorrect === 1);
      const wrong = question.options.find((option) => option.isCorrect !== 1);
      check(correct, `Bonne réponse absente pour ${question.id}`);
      answers[question.id] = { label: correct.label, optionId: correct.id, wrongOptionId: wrong?.id };
    }
  }
  return answers;
}

function quizSliceInput(quiz, roundCount) {
  const answerInput = (target) => ({
    answerMode: target.answer_mode,
    dictionaryId: target.dictionary_id,
    options: target.options.map((option) => option.label),
    correctOptionIndex: target.options.findIndex((option) => option.isCorrect === 1),
    correctAnswer: target.options.find((option) => option.isCorrect === 1)?.label,
  });
  return {
    title: `[Test de charge] ${quiz.title}`,
    description: 'Copie temporaire pour test de performance',
    answerMode: quiz.answer_mode,
    sequenceMode: quiz.sequence_mode,
    hidePlayerNames: quiz.hide_player_names,
    rounds: quiz.rounds.slice(0, roundCount).map((round) => ({
      title: round.title,
      person: { name: round.person.name, ...answerInput(round.person) },
      works: round.works.map((work) => ({
        title: work.title,
        kind: work.kind,
        clues: work.clues.map((clue) => ({ kind: clue.kind, content: clue.content })),
        ...answerInput(work),
      })),
    })),
  };
}

async function main() {
  check(/^https?:\/\//.test(baseUrl), 'PERF_BASE_URL requis');
  check(quizId && token, 'PERF_QUIZ_ID et PERF_ADMIN_TOKEN requis');
  check(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token), 'PERF_ADMIN_TOKEN est tronqué ou invalide');
  let expiresAt;
  try {
    expiresAt = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp;
  } catch {
    throw new Error('Impossible de lire la date d’expiration du jeton Firebase');
  }
  check(Number(expiresAt) > Date.now() / 1000 + 60, 'Le jeton Firebase a expiré ou expire dans moins d’une minute');
  check(Number.isInteger(players) && players >= 2 && players <= 100, 'PERF_PLAYERS invalide');
  check(Number.isInteger(revealMs) && revealMs >= 0 && revealMs <= 15_000, 'PERF_REVEAL_MS invalide');
  const roundLimit = Number(process.env.PERF_ROUNDS ?? 0);
  check(Number.isInteger(roundLimit) && roundLimit >= 0, 'PERF_ROUNDS invalide');
  const sourceQuiz = await getJson(`/api/quizzes/${encodeURIComponent(quizId)}/edit`);
  check(roundLimit <= (sourceQuiz.rounds?.length ?? 0), 'PERF_ROUNDS dépasse le nombre de manches du quiz');
  let temporaryQuizId;
  let socket;
  let artillery;
  let artilleryExit;
  const hostStates = [];

  try {
    if (roundLimit > 0) {
      const copy = await getJson('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quizSliceInput(sourceQuiz, roundLimit)),
      });
      temporaryQuizId = copy.id;
      console.log(`Quiz temporaire ${temporaryQuizId} créé avec ${roundLimit} manche(s).`);
    }
    const testQuizId = temporaryQuizId ?? quizId;
    const quiz = temporaryQuizId
      ? await getJson(`/api/quizzes/${encodeURIComponent(testQuizId)}/edit`)
      : sourceQuiz;
    const answers = referenceAnswers(quiz);
    const room = await getJson(`/api/quizzes/${encodeURIComponent(testQuizId)}/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    console.log(`Salon de charge ${room.code} créé pour ${players} joueurs.`);
    socket = io(baseUrl, { transports: ['websocket'], reconnection: false });
    socket.on('host-game-state', (state) => hostStates.push(state));
    await new Promise((resolve, reject) => {
      if (socket.connected) return resolve();
      const timer = setTimeout(() => reject(new Error('Connexion organisateur trop lente')), timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });
    const joined = await acknowledge(socket, 'host-room', { code: room.code, idToken: token });
    check(joined.gameState?.status === 'lobby', 'Salon non disponible');
    const questionCount = joined.gameState.totalQuestions;
    check(questionCount > 0, 'Quiz vide');

    const binary = fileURLToPath(new URL('../performance/node_modules/.bin/artillery', import.meta.url));
    const scenario = fileURLToPath(new URL('./performance-artillery.yml', import.meta.url));
    const overrides = JSON.stringify({ config: { phases: [{ duration: 8, arrivalCount: players }] } });
    artillery = spawn(binary, ['run', '--target', baseUrl, '--overrides', overrides, '--output', report, scenario], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PERF_ROOM_CODE: room.code,
        PERF_ANSWERS_JSON: JSON.stringify(answers),
      },
    });
    artilleryExit = new Promise((resolve, reject) => {
      artillery.once('error', reject);
      artillery.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Artillery a échoué (code ${code})`)));
    });
    await Promise.race([
      waitFor(hostStates, (state) => state.status === 'lobby' && state.playerCount === players, 'Arrivée des joueurs'),
      artilleryExit.then(() => { throw new Error('Les joueurs Artillery ont quitté le salon avant le lancement'); }),
    ]);

    await acknowledge(socket, 'start-game', { code: room.code, idToken: token });
    for (let index = 0; index < questionCount; index++) {
      const reveal = await Promise.race([
        waitFor(hostStates, (state) => state.status === 'reveal' && state.currentQuestionIndex === index, `Révélation ${index + 1}`),
        artilleryExit.then(() => { throw new Error('Artillery a terminé avant la fin du quiz'); }),
      ]);
      check(reveal.answerStats?.total === players, `Question ${index + 1} : ${reveal.answerStats?.total ?? 0}/${players} réponses`);
      check(reveal.answerStats.correct + reveal.answerStats.incorrect === players, 'Statistiques de réponses incohérentes');
      check(reveal.topLeaderboard.length === Math.min(5, players), 'Top 5 incomplet');
      console.log(`Question ${index + 1}/${questionCount} : ${players} réponses reçues.`);
      await new Promise((resolve) => setTimeout(resolve, revealMs));
      await acknowledge(socket, 'next-question', { code: room.code, idToken: token });
    }
    const finished = await waitFor(hostStates, (state) => state.status === 'finished', 'Classement final');
    check(finished.leaderboard.length === players, 'Classement final incomplet');
    await artilleryExit;
    const artilleryReport = JSON.parse(await readFile(report, 'utf8'));
    const counters = artilleryReport.aggregate?.counters ?? {};
    check(counters['vusers.failed'] === 0, `${counters['vusers.failed']} joueur(s) virtuel(s) ont échoué`);
    check(counters['vusers.completed'] === players, `${counters['vusers.completed'] ?? 0}/${players} joueurs virtuels terminés`);
    check(counters['game.players_completed'] === players, 'Classement final non reçu par tous les joueurs');
    check(counters['game.questions_completed'] === players * questionCount, 'Résultats de questions incomplets');
    const resultP95 = artilleryReport.aggregate?.summaries?.['game.result_ms']?.p95;
    const resultLimit = Number(process.env.PERF_RESULT_P95_MAX_MS ?? 10_000);
    check(resultP95 <= resultLimit, `Résultats trop lents : p95 ${resultP95 ?? 'absent'} ms > ${resultLimit} ms`);
    console.log(`Charge validée. Rapport Artillery : ${report}`);
  } finally {
    if (artillery && artillery.exitCode === null && artilleryExit) {
      let timeout;
      await Promise.race([
        artilleryExit.catch(() => {}),
        new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMs + 30_000); }),
      ]);
      clearTimeout(timeout);
      if (artillery.exitCode === null) artillery.kill('SIGTERM');
    }
    socket?.disconnect();
    if (temporaryQuizId) {
      try {
        const response = await fetch(`${baseUrl}/api/quizzes/${encodeURIComponent(temporaryQuizId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        check(response.status === 204, `suppression HTTP ${response.status}`);
        console.log('Quiz temporaire supprimé.');
      } catch (error) {
        console.error(`Quiz temporaire ${temporaryQuizId} à supprimer manuellement : ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
