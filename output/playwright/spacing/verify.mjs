import { chromium } from '../../../performance/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('./', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [], measures = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const values = ['Fondation (livre, 1951, Isaac Asimov)', 'Interstellar (film, 2014, Christopher Nolan)'];
const dictionary = { id: 'd1', name: 'Les œuvres incontournables', values, usage_count: 2 };
const state = {
  status: 'question', currentQuestionIndex: 0, totalQuestions: 4, questionStartedAt: new Date(Date.now() - 2000).toISOString(), questionEndsAt: new Date(Date.now() + 360000).toISOString(),
  finalRevealStartedAt: null, playerCount: 2, answerCount: 1, players: [], leaderboard: [], topLeaderboard: [], hidePlayerNames: false,
  activeQuestion: { roundId: 'r1', roundTitle: 'Manche 1', targetType: 'work', targetId: 'w1', prompt: 'Quelle est cette œuvre ?', answerMode: 'autocomplete',
    options: [], suggestions: values, clues: [{ kind: 'text', content: 'Un voyage à travers le temps et les étoiles.' }], works: [],
    correctOption: { id: 'o1', label: values[0] } }, answerStats: { total: 2, correct: 1, incorrect: 1 },
};
const room = { id: 'SPACE1', code: 'SPACE1', quiz_id: 'q1', status: 'question', gameState: state };
await page.route('**/socket.io/**', route => route.abort());
await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ json: path === '/api/auth/config' ? { firebase: {} }
    : path === '/api/answer-dictionaries' ? [dictionary] : path === '/api/quizzes' ? []
    : path.startsWith('/api/rooms/') ? room : { theme: 'studio' } });
});
async function settleLayout() {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function checkInset(name, parent, child, side, minimum) {
  await settleLayout();
  const value = await page.locator(child).first().evaluate((el, { parent, side }) => {
    const area = document.querySelector(parent), a = area.getBoundingClientRect(), b = el.getBoundingClientRect();
    const style = getComputedStyle(area);
    return side === 'left' ? b.left - a.left - parseFloat(style.borderLeftWidth) : b.top - a.top - parseFloat(style.borderTopWidth);
  }, { parent, side });
  measures.push({ name, side, value, minimum });
  if (value < minimum - 1) failures.push(`${name}: ${side} ${value}px < ${minimum}px`);
}
async function checkSurface(name, selector, minimum = 12) {
  await settleLayout();
  const result = await page.locator(selector).first().evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, image: style.backgroundImage, border: style.borderLeftWidth,
      inset: Math.min(parseFloat(style.paddingLeft), parseFloat(style.paddingRight)) };
  });
  const framed = result.background !== 'rgba(0, 0, 0, 0)' || result.image !== 'none' || parseFloat(result.border) > 0;
  if (framed) {
    measures.push({ name, ...result, minimum });
    if (result.inset < minimum - 1) failures.push(`${name}: colored/bordered surface has ${result.inset}px horizontal padding`);
  }
}
async function shot(name) {
  if (!baseline) await page.screenshot({ path: out + name + '.png', animations: 'disabled' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) failures.push(name + ': horizontal overflow');
}
async function home(admin = false) {
  await page.goto('http://localhost:4200/?theme=studio');
  await page.locator('app-home').waitFor();
  await page.evaluate(admin => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.api.socket.disconnect(); c.api.socket.removeAllListeners(); c.api.authReady.set(true);
    c.api.authError.set(admin ? '' : 'Impossible de charger la configuration Firebase.');
    c.api.adminUser.set(admin ? { id: 'test', name: 'Camille', email: '', picture: '' } : undefined); ng.applyChanges(c);
  }, admin);
}
try {
  await home();
  for (const [width, height] of [[1440, 1000], [2330, 1476], [1000, 900], [900, 900], [768, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await checkInset('home-' + width, '.admin-login', '.admin-login h2', width <= 900 ? 'top' : 'left', width <= 900 ? 24 : 32);
    if (width <= 900) {
      const border = await page.locator('.admin-login').evaluate(el => getComputedStyle(el).borderLeftWidth);
      if (border !== '0px') failures.push('home-' + width + ': stacked layout retains vertical separator');
    }
    await shot('01-accueil-' + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await home(true);
  await page.getByRole('button', { name: 'Dictionnaires', exact: true }).click();
  await page.getByRole('heading', { name: dictionary.name }).waitFor();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('active-tab-' + theme, '.admin-tabs .active');
    await checkInset('dictionaries-' + theme, '.dictionary-layout > aside', '.dictionary-layout > aside h2', 'left', 24);
    await checkSurface('dictionary-row-' + theme, '.dictionary-row');
    await checkSurface('dictionary-editor-' + theme, '.dictionary-layout > div');
    await shot('02-dictionnaires-' + theme);
  }
  await page.getByRole('button', { name: 'Éditer', exact: true }).click();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('active-dictionary-' + theme, '.dictionary-row.active');
  }
  await page.setViewportSize({ width: 1000, height: 900 });
  await checkInset('dictionaries-narrow-desktop', '.dictionary-library', '.dictionary-library h2', 'left', 24);
  await shot('03-dictionnaires-bureau-etroit');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.dictionary-layout > aside').scrollIntoViewIfNeeded();
  await checkInset('dictionaries-mobile', '.dictionary-layout > aside', '.dictionary-layout > aside h2', 'top', 24);
  await shot('03-dictionnaires-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Mes quiz', exact: true }).click();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('quiz-library-' + theme, '.quiz-library');
  }
  await page.getByRole('button', { name: 'Importer JSON', exact: true }).click();
  await checkInset('import-modal', '.import-modal', '.import-modal .modal-header', 'left', 24);
  await shot('04-import');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Nouveau quiz', exact: true }).click();
  await page.locator('.editor-properties').waitFor();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkInset('editor-answers-' + theme, '.editor-properties', '.editor-properties > h3', 'left', 24);
    await checkSurface('editor-warning-' + theme, '.works-requirement');
    await page.getByRole('button', { name: 'Recherche', exact: true }).click();
    await checkSurface('editor-search-' + theme, '.autocomplete');
    await shot('05-editeur-' + theme);
    await page.getByRole('button', { name: '4 propositions', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await checkInset('editor-settings', '.quiz-settings', '.quiz-settings > header', 'left', 24);
  await page.getByRole('button', { name: 'Questions', exact: true }).click();
  await page.setViewportSize({ width: 768, height: 900 });
  await checkInset('editor-stacked-answers', '.editor-properties', '.editor-properties > h3', 'top', 24);
  await shot('06-editeur-tablette');

  await page.goto('http://localhost:4200/rooms/SPACE1?theme=studio');
  await page.locator('app-room').waitFor();
  await page.evaluate(({ state, room }) => {
    const c = ng.getComponent(document.querySelector('app-room')); clearInterval(c.timerId);
    c.api.socket.disconnect(); c.api.socket.removeAllListeners();
    c.api.hostRoom = async () => ({ ok: true, gameState: state });
    c.api.authReady.set(true); c.api.adminUser.set({ id: 'test', name: 'Camille' }); c.api.connected.set(true);
    c.room.set(room); c.api.gameState.set(state); c.loading.set(false); c.error.set(''); ng.applyChanges(c);
  }, { state, room });
  await page.locator('.clue-rail').waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checkInset('host-clue-rail', '.clue-rail', '.clue-rail h2', 'left', 20);
  await page.evaluate(state => {
    const c = ng.getComponent(document.querySelector('app-room')); c.api.gameState.set({ ...state, status: 'reveal' }); ng.applyChanges(c);
  }, state);
  await page.locator('.answer-impact').waitFor();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('host-results-' + theme, '.answer-impact');
    await checkSurface('host-result-row-' + theme, '.answer-impact-row');
    await shot('07-resultats-animateur-' + theme);
  }
  await page.evaluate(state => {
    const c = ng.getComponent(document.querySelector('app-room'));
    const players = ['Camille', 'Dominique', 'Alexandre', 'Stéphanie'].map((nickname, i) => ({ id: 'p' + i, nickname, score: 1000 - i * 100, avatar: '' }));
    c.api.gameState.set({ ...state, status: 'finished', playerCount: 4, leaderboard: players, topLeaderboard: players,
      finalRevealStartedAt: new Date(Date.now() - 120000).toISOString() }); ng.applyChanges(c);
  }, state);
  await page.locator('.final-ranking').waitFor();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('final-ranking-' + theme, '.final-ranking');
    await shot('10-classement-final-' + theme);
  }
  await page.goto('http://localhost:4200/join/SPACE1?theme=studio');
  await page.locator('app-join').waitFor();
  await page.evaluate(({ state, room }) => {
    const c = ng.getComponent(document.querySelector('app-join')); clearInterval(c.timerId);
    c.api.socket.disconnect(); c.api.socket.removeAllListeners(); c.loading.set(false); c.roomError.set('');
    c.room.set(room); c.playerId.set('p1'); c.api.gameState.set(state); ng.applyChanges(c);
  }, { state, room });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('player-clue-' + theme, '.text-clue');
    await checkSurface('player-search-' + theme, '.autocomplete');
    await shot('08-joueur-recherche-' + theme);
  }
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.selectedAnswer.set('Fondation : un titre particulièrement long pour vérifier les marges du message de confirmation (livre, 1951, Isaac Asimov)');
    c.sendingAnswer.set(true); ng.applyChanges(c);
  });
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('answer-sending-' + theme, '.answer-sending');
    await shot('11-envoi-' + theme);
  }
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.sendingAnswer.set(false); c.answeredQuestionIndex.set(0); ng.applyChanges(c);
  });
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('answer-submitted-' + theme, '.submitted-answer');
    await shot('12-confirmation-' + theme);
  }
  await page.evaluate(state => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.api.gameState.set({ ...state, status: 'reveal' });
    ng.applyChanges(c);
  }, state);
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('result-pending-' + theme, '.result-pending');
    await shot('13-resultat-en-attente-' + theme);
  }
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.api.playerResult.set({ isCorrect: false, points: 0, totalScore: 450, rank: 2, totalPlayers: 2 }); ng.applyChanges(c);
  });
  await page.locator('.correct-answer').waitFor();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('player-result-' + theme, '.correct-answer');
    await shot('09-joueur-resultat-' + theme);
  }
  await page.evaluate(state => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.api.gameState.set({ ...state, activeQuestion: { ...state.activeQuestion, clues: [{ kind: 'audio',
      content: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=' }] } });
    ng.applyChanges(c);
  }, state);
  await page.setViewportSize({ width: 320, height: 800 });
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await checkSurface('player-audio-' + theme, '.audio-clue');
    await checkInset('player-audio-controls-' + theme, '.audio-clue', '.audio-clue audio', 'left', 16);
    await shot('14-indice-sonore-' + theme);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ measures, failures, errors }, null, 2));
  if (!baseline) assert.deepEqual(failures, []);
} finally {
  await writeFile(out + (baseline ? 'baseline.json' : 'report.json'), JSON.stringify({ measures, failures, errors }, null, 2));
  await browser.close();
}
