import { chromium } from '../../../performance/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Local browser fixtures: no real accounts, quizzes or Firebase data are changed.
const out = new URL('./', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const base = 'http://localhost:4200';
const longLabel = 'Les aventures extraordinaires de la communauté des voyageurs à travers les mondes oubliés : une histoire de rencontres et de souvenirs, édition intégrale augmentée (livre, 2001, Un auteur au nom particulièrement long)';
const labels = [longLabel, ...Array.from({ length: 7 }, (_, i) => 'Les voyages ' + i + ' ' + 'Extraordinaire'.repeat(12) + ' (film, 2000)')];
const state = {
  status: 'question', currentQuestionIndex: 5, totalQuestions: 12,
  questionStartedAt: new Date(Date.now() - 10000).toISOString(), questionEndsAt: new Date(Date.now() + 120000).toISOString(),
  finalRevealStartedAt: null, playerCount: 2, answerCount: 1, hidePlayerNames: false,
  players: [], leaderboard: [{ id: 'p1', nickname: 'Camille', score: 1234 }], topLeaderboard: [],
  activeQuestion: { roundId: 'r1', roundTitle: 'Manche 2', targetType: 'work', targetId: 'w5', prompt: 'Quelle est cette œuvre ?',
    answerMode: 'autocomplete', suggestions: labels, options: [], clues: [{ kind: 'text', content: 'Un voyage extraordinaire.' }], works: [] },
};
const room = { id: 'LIVE42', code: 'LIVE42', quiz_id: 'q1', status: 'question', current_round: 1, gameState: state };
const rooms = [
  { code: 'LIVE42', quiz_id: 'q1', quiz_title: 'Nos œuvres préférées', status: 'question', current_question_index: 5, total_questions: 12, created_at: '2026-10-07T12:00:00Z' },
  { code: 'WAIT42', quiz_id: 'q1', quiz_title: 'La prochaine partie', status: 'lobby', current_question_index: -1, total_questions: 12, created_at: '2026-10-06T12:00:00Z' },
  { code: 'ANSW42', quiz_id: 'q1', quiz_title: 'Pop culture', status: 'reveal', current_question_index: 2, total_questions: 12, created_at: '2026-10-05T12:00:00Z' },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [], checks = [], screenshots = [];
let listMode = 'ready', listRequests = 0, createRequests = 0, waitAuth = false;
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
await page.route('**/socket.io/**', route => route.abort());
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'POST') createRequests++;
  if (path === '/api/rooms') {
    listRequests++;
    await new Promise(resolve => setTimeout(resolve, 400));
    return route.fulfill(listMode === 'error' ? { status: 503, json: { error: 'Temporary failure' } } : { json: listMode === 'empty' ? [] : rooms });
  }
  if (path.startsWith('/api/rooms/') && waitAuth) {
    await page.evaluate(() => ng.getComponent(document.querySelector('app-root')).api.authReady.set(false));
    waitAuth = false;
  }
  const data = path === '/api/auth/config' ? { firebase: {} } : path === '/api/quizzes' ? []
    : path === '/api/answer-dictionaries' ? [{ id: 'd1', name: 'Œuvres', values: labels }]
    : path.startsWith('/api/rooms/') ? room : { theme: 'studio' };
  await route.fulfill({ json: data });
});
async function shot(name) {
  await page.screenshot({ path: out + name + '.png', fullPage: true, animations: 'disabled' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' horizontal overflow');
  screenshots.push(name + '.png');
}
async function adminHome() {
  await page.goto(base + '/?theme=studio');
  await page.locator('app-home').waitFor();
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.api.socket.disconnect(); c.api.socket.removeAllListeners();
    c.api.authReady.set(true); c.api.adminUser.set({ id: 'admin', name: 'Camille', email: '', picture: '' });
    ng.applyChanges(c);
  });
  await page.getByRole('button', { name: 'Quiz en cours', exact: true }).waitFor();
}
async function fullLabels() {
  const boxes = await page.locator('.suggestion-list button').evaluateAll(buttons => buttons.map(button => {
    const label = button.querySelector('.suggestion-label');
    const rect = button.getBoundingClientRect(), text = label.getBoundingClientRect();
    return { contained: text.top >= rect.top && text.bottom <= rect.bottom && text.left >= rect.left && text.right <= rect.right,
      clipped: label.scrollHeight > label.clientHeight || label.scrollWidth > label.clientWidth, height: rect.height };
  }));
  assert.equal(boxes.length, 8);
  assert(boxes.every(box => box.contained && !box.clipped), JSON.stringify(boxes));
  assert(await page.locator('.suggestion-list').evaluate(el => el.scrollHeight > el.clientHeight), 'list should scroll');
}
try {
  await adminHome();
  await page.getByRole('button', { name: 'Quiz en cours', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Récupération' }).waitFor();
  assert(await page.getByRole('button', { name: 'Actualiser' }).isDisabled());
  await page.locator('.active-room-row').first().waitFor();
  assert.equal(await page.locator('.active-room-row').count(), 3);
  await shot('01-parties-desktop');
  await page.setViewportSize({ width: 360, height: 800 });
  await shot('02-parties-mobile');
  listMode = 'error';
  await page.getByRole('button', { name: 'Actualiser' }).click();
  await page.getByRole('alert').filter({ hasText: 'Impossible de charger' }).waitFor();
  listMode = 'empty';
  await page.getByRole('button', { name: 'Actualiser' }).click();
  await page.getByRole('heading', { name: 'Aucune partie en cours' }).waitFor();
  listMode = 'ready';
  await page.getByRole('button', { name: 'Actualiser' }).click();
  await page.locator('.active-room-row').first().waitFor();
  assert.equal(listRequests, 4);
  checks.push('Active rooms: statuses, progress, loading, refresh, failure, empty state and mobile layout');

  await page.evaluate(state => {
    const api = ng.getComponent(document.querySelector('app-home')).api;
    window.hostCalls = 0; window.leftRooms = [];
    api.connected.set(true);
    api.hostRoom = async () => {
      window.hostCalls++;
      await new Promise(resolve => setTimeout(resolve, 300));
      if (window.failHost) throw new Error('timeout');
      return { ok: true, gameState: state };
    };
    api.leaveHostRoom = code => window.leftRooms.push(code);
  }, state);
  waitAuth = true;
  await page.getByRole('link', { name: 'Reprendre' }).first().click();
  await page.getByRole('status').filter({ hasText: 'Vérification' }).waitFor();
  assert.equal(await page.evaluate(() => window.hostCalls), 0);
  await page.evaluate(() => { const c = ng.getComponent(document.querySelector('app-room')); c.api.authReady.set(true); ng.applyChanges(c); });
  await page.getByRole('status').filter({ hasText: 'Reprise' }).waitFor();
  await page.locator('.live-question').waitFor();
  const resumed = await page.evaluate(() => ng.getComponent(document.querySelector('app-room')).api.gameState());
  assert.equal(resumed.currentQuestionIndex, 5);
  assert.equal(resumed.questionEndsAt, state.questionEndsAt);
  assert.equal(resumed.leaderboard[0].score, 1234);
  assert.equal(resumed.answerCount, 1);
  assert.equal(createRequests, 0);
  await page.evaluate(() => { const c = ng.getComponent(document.querySelector('app-room')); c.api.connected.set(false); ng.applyChanges(c); });
  await page.getByRole('status').filter({ hasText: 'Connexion au salon' }).waitFor();
  await page.evaluate(() => { const c = ng.getComponent(document.querySelector('app-room')); window.failHost = true; c.api.connected.set(true); ng.applyChanges(c); });
  await page.getByRole('heading', { name: 'Salon inaccessible' }).waitFor();
  await page.evaluate(() => window.failHost = false);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await page.locator('.live-question').waitFor();
  assert.equal(await page.evaluate(() => window.hostCalls), 3);
  await page.locator('.topbar .brand').click();
  await page.locator('app-home').waitFor();
  assert.deepEqual(await page.evaluate(() => window.leftRooms), ['LIVE42']);
  checks.push('Host: waits for restored authentication, keeps deadline/scores/answers, reconnects, retries after timeout and leaves subscription on navigation');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Nouveau quiz' }).click();
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.activeTarget().answerMode = 'autocomplete'; c.activeTarget().dictionaryId = 'd1'; ng.applyChanges(c);
  });
  const search = page.getByRole('combobox', { name: 'Bonne réponse œuvre' });
  await search.fill('Les');
  await fullLabels();
  await shot('03-libelles-editeur');
  await search.press('ArrowDown');
  await search.press('Enter');
  assert.equal(await page.locator('.selected-search-answer strong').textContent(), labels[1]);
  await page.getByRole('button', { name: 'Modifier la réponse', exact: true }).click();
  await search.fill('Les');
  await page.locator('app-answer-search').getByRole('option').first().click();
  assert.equal(await page.locator('.selected-search-answer strong').textContent(), longLabel);
  checks.push('Editor: eight fully wrapped labels, scrolling, unbroken long words, keyboard selection and edit');

  await page.goto(base + '/join/LIVE42?theme=studio');
  await page.locator('app-join').waitFor();
  await page.evaluate(({ state, room }) => {
    const c = ng.getComponent(document.querySelector('app-join'));
    clearInterval(c.timerId); c.api.socket.disconnect(); c.api.socket.removeAllListeners();
    c.api.connected.set(true); c.loading.set(false); c.roomError.set(''); c.room.set(room); c.playerId.set('p1');
    c.api.gameState.set(state); c.now.set(Date.now()); ng.applyChanges(c);
  }, { state, room });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    if (await page.getByRole('button', { name: 'Modifier la réponse', exact: true }).count()) await page.getByRole('button', { name: 'Modifier la réponse', exact: true }).click();
    await page.getByRole('combobox').fill('Les');
    await fullLabels();
    assert(await page.locator('.suggestion-list').evaluate(el => el.querySelector('button').getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom), 'first long label should fit the mobile list viewport');
    await shot('04-recherche-mobile-' + theme);
    await page.locator('app-answer-search').getByRole('option').first().click();
    assert.equal(await page.locator('.selected-answer-summary').textContent(), longLabel);
    assert(await page.locator('.selected-answer-summary').evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth));
    assert(await page.getByRole('button', { name: 'Valider ma réponse' }).isEnabled());
    await shot('05-selection-mobile-' + theme);
  }
  checks.push('Player: full suggestions and full selected answer with an accessible validation button at 360px across themes');
  assert.deepEqual(errors, []);
  await writeFile(out + 'report.json', JSON.stringify({ checks, errors, screenshots }, null, 2));
  console.log(JSON.stringify({ checks, errors, screenshots }, null, 2));
} finally { await browser.close(); }
