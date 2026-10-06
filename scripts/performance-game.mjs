import { writeFile } from 'node:fs/promises';
import { io } from 'socket.io-client';

const defaults = {
  players: 30,
  lagMs: 800,
  timeoutMs: 30_000,
  ackTimeoutMs: 12_000,
};

function option(name, fallback) {
  const position = process.argv.indexOf(`--${name}`);
  return position < 0 ? fallback : process.argv[position + 1];
}

function numberOption(name, fallback, min, max) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} doit etre un entier entre ${min} et ${max}`);
  }
  return value;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function observe(socket) {
  const observations = { states: [], hostStates: [], results: [], listeners: new Set() };
  const push = (key, value) => {
    observations[key].push({ value, at: Date.now() });
    for (const listener of observations.listeners) listener();
  };
  socket.on('game-state', (state) => push('states', state));
  socket.on('host-game-state', (state) => push('hostStates', state));
  socket.on('player-result', (result) => push('results', result));
  return observations;
}

function waitFor(observations, key, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const find = () => observations[key].find((entry, index) => predicate(entry.value, index));
    const existing = find();
    if (existing) return resolve(existing);
    const timeout = setTimeout(() => {
      observations.listeners.delete(onChange);
      reject(new Error(`Delai depasse : ${label}`));
    }, timeoutMs);
    const onChange = () => {
      const entry = find();
      if (!entry) return;
      clearTimeout(timeout);
      observations.listeners.delete(onChange);
      resolve(entry);
    };
    observations.listeners.add(onChange);
  });
}

async function connect(baseUrl, timeoutMs) {
  const socket = io(baseUrl, { autoConnect: false, reconnection: false, transports: ['websocket'] });
  const observations = observe(socket);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connexion Socket.IO trop lente')), timeoutMs);
      socket.once('connect', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
      socket.connect();
    });
    return { socket, observations };
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function emit(socket, event, payload, timeoutMs) {
  const started = Date.now();
  const response = await new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, value) => {
      if (error) reject(new Error(`${event} : accusé de réception absent après ${timeoutMs} ms`));
      else resolve(value);
    });
  });
  check(response?.ok, `${event} : ${response?.error ?? 'réponse invalide'}`);
  return { response, durationMs: Date.now() - started };
}

function answerFor(question, correct) {
  if (question.answerMode === 'autocomplete') {
    check(Boolean(question.correctOption?.label), 'Réponse attendue absente pour la recherche');
    return { value: correct ? question.correctOption.label : `${question.correctOption.label} [test incorrect]` };
  }
  const option = correct
    ? question.options.find((item) => item.id === question.correctOption?.id)
    : question.options.find((item) => item.id !== question.correctOption?.id);
  check(Boolean(option), 'Les quatre propositions attendues sont incomplètes');
  return { optionId: option.id };
}

async function main() {
  const baseUrl = (option('url', process.env.PERF_BASE_URL) ?? '').replace(/\/$/, '');
  const quizId = option('quiz-id', process.env.PERF_QUIZ_ID);
  const token = option('token', process.env.PERF_ADMIN_TOKEN);
  const playersCount = numberOption('players', defaults.players, 2, 100);
  const requestedQuestions = option('questions', undefined);
  const expectedQuestionCount = requestedQuestions === undefined ? undefined : numberOption('questions', 4, 1, 100);
  const lagMs = numberOption('lag-ms', defaults.lagMs, 0, 10_000);
  const timeoutMs = numberOption('timeout-ms', defaults.timeoutMs, 1_000, 120_000);
  const ackTimeoutMs = numberOption('ack-timeout-ms', defaults.ackTimeoutMs, 1_000, 60_000);
  const reportPath = option('report', undefined);
  check(baseUrl.startsWith('http://') || baseUrl.startsWith('https://'), 'PERF_BASE_URL ou --url requis');
  check(Boolean(quizId), 'PERF_QUIZ_ID ou --quiz-id requis');
  check(Boolean(token), 'PERF_ADMIN_TOKEN ou --token requis');

  const runId = Date.now().toString(36);
  const report = { url: baseUrl, quizId, players: playersCount, questionsRequested: expectedQuestionCount ?? 'all', lagMs, startedAt: new Date().toISOString(), questionResults: [], metrics: {}, errors: [] };
  const sockets = [];
  const metrics = { connect: [], join: [], hostCommand: [], answerAck: [], questionDelivery: [], revealDelivery: [], resultDelivery: [] };
  let roomCode;

  try {
    const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    check(health.ok, `Santé du serveur : HTTP ${health.status}`);
    const roomResponse = await fetch(`${baseUrl}/api/quizzes/${encodeURIComponent(quizId)}/rooms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
    check(roomResponse.ok, `Création du salon : HTTP ${roomResponse.status} ${await roomResponse.text()}`);
    roomCode = (await roomResponse.json()).code;
    report.roomCode = roomCode;
    console.log(`Salon de test ${roomCode} créé ; connexion de ${playersCount} joueurs.`);

    const hostConnectedAt = Date.now();
    const host = await connect(baseUrl, timeoutMs);
    sockets.push(host.socket);
    metrics.connect.push(Date.now() - hostConnectedAt);
    const hosted = await emit(host.socket, 'host-room', { code: roomCode, idToken: token }, ackTimeoutMs);
    check(hosted.response.gameState?.status === 'lobby', 'Le salon organisateur n’est pas en attente');
    const questionsCount = hosted.response.gameState.totalQuestions;
    check(questionsCount > 0, 'Le quiz ne contient aucune question');
    if (expectedQuestionCount !== undefined) {
      check(questionsCount === expectedQuestionCount, `Le quiz contient ${questionsCount} questions, pas ${expectedQuestionCount}`);
    }
    report.questionsPlayed = questionsCount;

    const playerSet = await Promise.all(Array.from({ length: playersCount }, async (_, index) => {
      const started = Date.now();
      const client = await connect(baseUrl, timeoutMs);
      sockets.push(client.socket);
      metrics.connect.push(Date.now() - started);
      const nickname = `Perf-${runId}-${String(index + 1).padStart(2, '0')}`;
      const joined = await emit(client.socket, 'join-room', { code: roomCode, nickname }, ackTimeoutMs);
      metrics.join.push(joined.durationMs);
      check(Boolean(joined.response.playerId), `${nickname} n’a pas reçu d’identifiant`);
      return { ...client, id: joined.response.playerId, nickname, score: 0, index };
    }));
    const lobby = await waitFor(host.observations, 'hostStates', (state) => state.status === 'lobby' && state.playerCount === playersCount, timeoutMs, '30 joueurs visibles par l’organisateur');
    check(lobby.value.players.length === playersCount, 'Liste des joueurs incomplète dans le lobby');

    let commandAt = Date.now();
    metrics.hostCommand.push((await emit(host.socket, 'start-game', { code: roomCode, idToken: token }, ackTimeoutMs)).durationMs);
    for (let questionIndex = 0; questionIndex < questionsCount; questionIndex++) {
      const hostQuestion = await waitFor(host.observations, 'hostStates', (state) => state.status === 'question' && state.currentQuestionIndex === questionIndex, timeoutMs, `question ${questionIndex + 1} côté organisateur`);
      const question = hostQuestion.value.activeQuestion;
      check(Boolean(question?.correctOption), `Réponse correcte absente de la question ${questionIndex + 1}`);
      check(hostQuestion.value.playerCount === playersCount, `Nombre de joueurs incorrect à la question ${questionIndex + 1}`);
      const playerQuestions = await Promise.all(playerSet.map((player) => waitFor(player.observations, 'states', (state) => state.status === 'question' && state.currentQuestionIndex === questionIndex, timeoutMs, `question ${questionIndex + 1} pour ${player.nickname}`)));
      for (const entry of playerQuestions) {
        check(entry.value.activeQuestion?.targetId === question.targetId, 'Questions différentes entre clients');
        check(!entry.value.activeQuestion?.correctOption, 'Réponse correcte divulguée avant révélation');
        check(entry.value.leaderboard.length === 0 && entry.value.topLeaderboard.length === 0, 'Classement visible pendant la question');
      }
      if (question.answerMode === 'autocomplete') {
        check(playerQuestions[0].value.activeQuestion.suggestions.includes(question.correctOption.label), 'Bonne réponse absente des suggestions');
      }
      metrics.questionDelivery.push(...playerQuestions.map((entry) => Math.max(0, entry.at - commandAt)));

      const expected = playerSet.map((player) => player.index % 2 === questionIndex % 2);
      const submissions = playerSet.map(async (player, index) => {
        const delay = (index % 6) * Math.floor(lagMs / 5) + Math.floor(index / 6) * 25;
        await new Promise((resolve) => setTimeout(resolve, delay));
        const sentAt = Date.now();
        const result = await emit(player.socket, 'submit-answer', {
          code: roomCode, playerId: player.id,
          roundId: question.roundId, targetType: question.targetType, targetId: question.targetId,
          ...answerFor(question, expected[index]),
        }, ackTimeoutMs);
        metrics.answerAck.push(result.durationMs);
        check(result.response.isCorrect === expected[index], `Correction incohérente pour ${player.nickname}`);
        check(expected[index] ? result.response.points > 0 : result.response.points === 0, `Points incohérents pour ${player.nickname}`);
        player.score += result.response.points;
        return { sentAt, ackAt: Date.now(), points: result.response.points };
      });
      const submissionResults = await Promise.all(submissions);
      const lastAckAt = Math.max(...submissionResults.map((item) => item.ackAt));
      const lastSentAt = Math.max(...submissionResults.map((item) => item.sentAt));
      const hostReveal = await waitFor(host.observations, 'hostStates', (state) => state.status === 'reveal' && state.currentQuestionIndex === questionIndex, timeoutMs, `révélation ${questionIndex + 1} côté organisateur`);
      const expectedCorrect = expected.filter(Boolean).length;
      check(hostReveal.value.answerStats?.total === playersCount, `Réponses comptées : ${hostReveal.value.answerStats?.total}/${playersCount}`);
      check(hostReveal.value.answerStats?.correct === expectedCorrect, 'Total des bonnes réponses incohérent');
      check(hostReveal.value.answerStats?.incorrect === playersCount - expectedCorrect, 'Total des mauvaises réponses incohérent');
      check(hostReveal.value.topLeaderboard.length === Math.min(5, playersCount), 'Top 5 organisateur incomplet');
      const revealEntries = await Promise.all(playerSet.map((player) => waitFor(player.observations, 'states', (state) => state.status === 'reveal' && state.currentQuestionIndex === questionIndex, timeoutMs, `révélation ${questionIndex + 1} pour ${player.nickname}`)));
      const results = await Promise.all(playerSet.map((player) => waitFor(player.observations, 'results', (_, entryIndex) => entryIndex === questionIndex, timeoutMs, `résultat ${questionIndex + 1} pour ${player.nickname}`)));
      for (let index = 0; index < playersCount; index++) {
        const state = revealEntries[index].value;
        const result = results[index].value;
        check(state.activeQuestion?.correctOption?.label === question.correctOption.label, 'Révélation différente entre clients');
        check(state.leaderboard.length === 0, 'Classement complet visible avant la fin');
        check(result.isCorrect === expected[index], `Résultat personnel incorrect pour ${playerSet[index].nickname}`);
        check(result.points === submissionResults[index].points, `Points annonces differents des points enregistres pour ${playerSet[index].nickname}`);
        check(result.totalScore === playerSet[index].score, `Score total incorrect pour ${playerSet[index].nickname}`);
        check(result.rank >= 1 && result.rank <= playersCount, 'Position personnelle invalide');
        check(result.totalPlayers === playersCount, 'Nombre de joueurs incohérent dans le résultat');
        const expectedRank = hostReveal.value.leaderboard.findIndex((entry) => entry.id === playerSet[index].id) + 1;
        check(result.rank === expectedRank, `Position incorrecte pour ${playerSet[index].nickname}`);
        check(hostReveal.value.leaderboard[expectedRank - 1]?.score === playerSet[index].score, `Score organisateur incohérent pour ${playerSet[index].nickname}`);
      }
      metrics.revealDelivery.push(...revealEntries.map((entry) => Math.max(0, entry.at - lastSentAt)));
      metrics.resultDelivery.push(...results.map((entry) => Math.max(0, entry.at - lastSentAt)));
      const endedEarly = lastAckAt < new Date(hostQuestion.value.questionEndsAt).getTime() - 1_000;
      if (endedEarly) check(hostReveal.at < new Date(hostQuestion.value.questionEndsAt).getTime(), 'Révélation anticipée absente alors que tous ont répondu');
      report.questionResults.push({ index: questionIndex + 1, mode: question.answerMode, targetType: question.targetType, expectedCorrect, revealedEarly: endedEarly, answerAckP95Ms: percentile(metrics.answerAck.slice(questionIndex * playersCount), 0.95) });
      console.log(`Question ${questionIndex + 1} : ${playersCount} réponses, ${expectedCorrect} correctes, résultats cohérents.`);
      commandAt = Date.now();
      metrics.hostCommand.push((await emit(host.socket, 'next-question', { code: roomCode, idToken: token }, ackTimeoutMs)).durationMs);
    }

    const finalHost = await waitFor(host.observations, 'hostStates', (state) => state.status === 'finished', timeoutMs, 'classement final organisateur');
    const finalPlayers = await Promise.all(playerSet.map((player) => waitFor(player.observations, 'states', (state) => state.status === 'finished', timeoutMs, `classement final pour ${player.nickname}`)));
    check(finalHost.value.leaderboard.length === playersCount, 'Classement final incomplet');
    for (const entry of finalPlayers) {
      check(entry.value.leaderboard.length === playersCount, 'Classement final absent pour un joueur');
      check(entry.value.leaderboard.every((player, index, list) => index === 0 || list[index - 1].score >= player.score), 'Classement final non trié');
    }
    for (const player of playerSet) {
      const finalScore = finalHost.value.leaderboard.find((entry) => entry.id === player.id)?.score;
      check(finalScore === player.score, `Score final incorrect pour ${player.nickname} : ${finalScore} au lieu de ${player.score}`);
      let lastIndex = -1;
      let lastPhase = -1;
      for (const { value: state } of player.observations.states) {
        if (state.currentQuestionIndex < 0) {
          check(lastIndex < 0, `Retour au lobby après le début du jeu pour ${player.nickname}`);
          continue;
        }
        const phase = { question: 0, reveal: 1, finished: 2 }[state.status];
        check(state.currentQuestionIndex >= lastIndex, `Retour à une ancienne question pour ${player.nickname}`);
        if (state.currentQuestionIndex === lastIndex) {
          check(phase >= lastPhase, `Retour à une ancienne phase pour ${player.nickname}`);
        }
        lastIndex = state.currentQuestionIndex;
        lastPhase = phase;
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    for (const socket of sockets) socket.disconnect();
    report.finishedAt = new Date().toISOString();
    report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
    report.metrics = Object.fromEntries(Object.entries(metrics).map(([name, values]) => [name, { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: values.length ? Math.max(...values) : null }]));
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
