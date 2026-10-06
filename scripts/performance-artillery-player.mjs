import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const timeoutMs = Number(process.env.PERF_TIMEOUT_MS ?? 45_000);
const lagMs = Number(process.env.PERF_LAG_MS ?? 800);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitFor(items, predicate, label) {
  return new Promise((resolve, reject) => {
    const existing = items.find(predicate);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`${label} non reçu en ${timeoutMs} ms`));
    }, timeoutMs);
    const poll = setInterval(() => {
      const found = items.find(predicate);
      if (!found) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(found);
    }, 25);
  });
}

function acknowledge(socket, event, payload, timeout = 12_000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeout).emit(event, payload, (error, result) => {
      if (error) reject(new Error(`${event} : délai de réponse dépassé`));
      else if (!result?.ok) reject(new Error(`${event} : ${result?.error ?? 'échec'}`));
      else resolve(result);
    });
  });
}

function normalize(value) {
  return value.trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function selectAutocompleteSuggestion(suggestions, desiredLabel) {
  const desired = normalize(desiredLabel);
  assert(desired.length >= 2, `Recherche impossible pour « ${desiredLabel} »`);
  const entries = suggestions.map((label) => ({ label, normalized: normalize(label) }));
  for (const length of new Set([2, 4, 8, desired.length])) {
    if (length > desired.length) continue;
    const query = desired.slice(0, length);
    const startsWith = [];
    const contains = [];
    for (const entry of entries) {
      if (entry.normalized.startsWith(query)) startsWith.push(entry.label);
      else if (contains.length < 8 && entry.normalized.includes(query)) contains.push(entry.label);
      if (startsWith.length >= 8) break;
    }
    const visible = [...startsWith, ...contains].slice(0, 8);
    if (visible.includes(desiredLabel)) return desiredLabel;
  }
  throw new Error(`« ${desiredLabel} » n'apparaît pas dans les résultats de recherche`);
}

export function runPlayer(context, events, done) {
  runPlayerAsync(context, events).then(() => done(), done);
}

async function runPlayerAsync(_context, events) {
  const baseUrl = process.env.PERF_BASE_URL;
  const code = process.env.PERF_ROOM_CODE;
  const answers = JSON.parse(process.env.PERF_ANSWERS_JSON || '{}');
  assert(baseUrl && code, 'Configuration de la partie de charge absente');
  const nickname = `Load-${randomUUID().slice(0, 12)}`;
  const prefersCorrect = parseInt(nickname.at(-1), 16) % 2 === 0;
  const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, autoConnect: false });
  const states = [];
  const results = [];
  socket.on('game-state', (state) => states.push({ state, at: Date.now() }));
  socket.on('player-result', (result) => results.push(result));
  let totalScore = 0;

  try {
    const connectedAt = Date.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connexion Socket.IO trop lente')), timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
      socket.connect();
    });
    events.emit('histogram', 'game.connect_ms', Date.now() - connectedAt);
    const joinedAt = Date.now();
    const joined = await acknowledge(socket, 'join-room', { code, nickname }, timeoutMs);
    events.emit('histogram', 'game.join_ms', Date.now() - joinedAt);
    assert(joined.playerId, 'Identifiant joueur absent');
    const totalQuestions = joined.gameState?.totalQuestions;
    assert(Number.isInteger(totalQuestions) && totalQuestions > 0, 'Nombre de questions invalide');

    for (let index = 0; index < totalQuestions; index++) {
      const questionEntry = await waitFor(states, (entry) => entry.state.status === 'question' && entry.state.currentQuestionIndex === index, `Question ${index + 1}`);
      const state = questionEntry.state;
      const question = state.activeQuestion;
      const expected = answers[question?.targetId];
      assert(expected, `Réponse de référence absente pour la question ${index + 1}`);
      assert(!question.correctOption, 'Bonne réponse exposée avant révélation');
      assert(state.leaderboard.length === 0, 'Classement affiché pendant la question');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * (lagMs + 1))));
      let correct = prefersCorrect;
      let answer;
      if (question.answerMode === 'autocomplete') {
        assert(question.suggestions.includes(expected.label), 'Bonne réponse absente de la recherche');
        const desiredLabel = prefersCorrect
          ? expected.label
          : question.suggestions.find((suggestion) => suggestion !== expected.label && normalize(suggestion).length >= 2) ?? expected.label;
        const selectedValue = selectAutocompleteSuggestion(question.suggestions, desiredLabel);
        correct = selectedValue === expected.label;
        answer = { value: selectedValue };
      } else {
        answer = { optionId: correct ? expected.optionId : expected.wrongOptionId };
      }
      assert(question.answerMode === 'autocomplete' || answer.optionId, 'Proposition incorrecte absente');
      const sentAt = Date.now();
      const response = await acknowledge(socket, 'submit-answer', {
        code, playerId: joined.playerId,
        roundId: question.roundId, targetType: question.targetType, targetId: question.targetId,
        ...answer,
      });
      events.emit('histogram', 'game.answer_ack_ms', Date.now() - sentAt);
      assert(response.isCorrect === correct, 'Correction incorrecte');
      totalScore += response.points;

      const result = await waitFor(results, (_, resultIndex) => resultIndex === index, `Résultat ${index + 1}`);
      const reveal = await waitFor(states, (entry) => entry.state.status === 'reveal' && entry.state.currentQuestionIndex === index, `Révélation ${index + 1}`);
      events.emit('histogram', 'game.result_ms', Date.now() - sentAt);
      assert(result.isCorrect === correct && result.points === response.points, 'Résultat personnel incohérent');
      assert(result.totalScore === totalScore, 'Total de points incohérent');
      assert(reveal.state.activeQuestion?.correctOption?.label === expected.label, 'Bonne réponse révélée incorrecte');
      assert(reveal.state.leaderboard.length === 0, 'Classement affiché avant la fin');
      events.emit('counter', 'game.questions_completed', 1);
    }

    const finished = await waitFor(states, (entry) => entry.state.status === 'finished', 'Classement final');
    const leaderboard = finished.state.leaderboard;
    assert(leaderboard.length === Number(process.env.PERF_PLAYERS ?? 30), 'Classement final incomplet');
    assert(leaderboard.find((player) => player.id === joined.playerId)?.score === totalScore, 'Score final différent du total personnel');
    let lastIndex = -1;
    let lastPhase = -1;
    for (const { state } of states) {
      assert(state.currentQuestionIndex >= lastIndex, 'Retour à une ancienne question');
      const phase = { lobby: -1, question: 0, reveal: 1, finished: 2 }[state.status];
      if (state.currentQuestionIndex === lastIndex) assert(phase >= lastPhase, 'Retour à une ancienne phase');
      lastIndex = state.currentQuestionIndex;
      lastPhase = phase;
    }
    events.emit('counter', 'game.players_completed', 1);
  } finally {
    socket.disconnect();
  }
}
