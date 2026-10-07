import { chromium } from '../../../performance/node_modules/playwright/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';

// Render the existing local Angular UI with isolated demonstration data.
const out = new URL('./', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const names = ['Camille', 'Alex', 'Sarah', 'Louis', 'Alice', 'Thomas', 'Emma', 'Hugo'];
const players = names.map((nickname, i) => ({ id: `p${i}`, nickname, avatar: ['🍒', '🦊', '🥝', '🐼'][i % 4], score: 4860 - i * 320 }));
const state = {
  status: 'lobby', currentQuestionIndex: 4, totalQuestions: 24,
  questionStartedAt: null, questionEndsAt: null, finalRevealStartedAt: null,
  playerCount: 30, answerCount: 18, leaderboard: players, topLeaderboard: players.slice(0, 5),
  players, hidePlayerNames: false,
  answerStats: { total: 30, correct: 21, incorrect: 9 },
  activeQuestion: {
    roundId: 'r1', roundTitle: 'Manche 2', targetType: 'work', targetId: 'w1',
    prompt: 'Quelle est cette œuvre ?', answerMode: 'autocomplete',
    clues: [{ id: 'c1', kind: 'image', content: '/audit-media' }], works: [], options: [],
    suggestions: ['Gladiator (film, 2000)', 'Gladiator II (film, 2024)', 'Gladiator (jeu vidéo, 1986)'],
    correctOption: { id: 'o1', label: 'Gladiator (film, 2000)' },
  },
};
const room = { id: 'audit', quiz_id: 'demo', code: 'DEMO42', status: 'lobby', current_round: 1,
  qrCodeDataUrl: await QRCode.toDataURL('http://localhost:4200/join/DEMO42'), gameState: state };
const quizzes = [
  { id: 'q1', title: 'Qui se cache derrière ces œuvres ?', description: 'Les coups de cœur de notre équipe', rounds: Array(6).fill({}), sequence_mode: 'works-first', hide_player_names: true },
  { id: 'q2', title: 'La soirée pop culture', description: 'Films, musiques et jeux vidéo', rounds: Array(4).fill({}), sequence_mode: 'rounds' },
];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.route('**/socket.io/**', route => route.abort());
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const body = path === '/api/quizzes' ? quizzes : path === '/api/answer-dictionaries' ? []
    : path.startsWith('/api/rooms/') ? room : {};
  await route.fulfill({ json: body });
});
await page.route('**/audit-media', async route => route.fulfill({ contentType: 'image/png', body: await readFile('contenu_quizz/louis/gladiator/gladiator_01.png') }));
const metrics = [];
async function shot(name, fullPage = false) {
  await page.screenshot({ path: `${out}${name}.png`, fullPage, animations: 'disabled' });
  metrics.push(await page.evaluate(name => ({ name, viewport: innerWidth, contentWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, nestedBorders: document.querySelectorAll('.panel .item, .panel .work-editor, .panel .clue-editor').length }), name));
}
await page.goto('http://localhost:4200/?theme=cosmic');
await page.locator('app-home').waitFor();
await page.evaluate(() => {
  const c = ng.getComponent(document.querySelector('app-home'));
  c.api.authReady.set(true);
  c.api.authError.set('');
  ng.applyChanges(c);
});
await shot('01-accueil-cosmic');
await page.evaluate(() => {
  const c = ng.getComponent(document.querySelector('app-home'));
  c.api.adminUser.set({ id: 'audit', name: 'Camille', email: '', picture: '' });
  ng.applyChanges(c);
});
await page.getByRole('heading', { name: 'Qui se cache derrière ces œuvres ?' }).waitFor();
await shot('02-bibliotheque-cosmic');
await page.getByRole('button', { name: 'Éditeur', exact: true }).click();
await shot('03-editeur-cosmic');
await shot('04-editeur-cosmic-complet', true);
await page.evaluate(() => { document.documentElement.dataset.theme = 'academy'; });
await shot('05-editeur-academy');

await page.goto('http://localhost:4200/rooms/DEMO42?theme=cosmic');
await page.locator('app-room').waitFor();
await page.evaluate(({ room, state }) => {
  const c = ng.getComponent(document.querySelector('app-room'));
  c.api.socket.disconnect(); c.api.socket.removeAllListeners();
  c.loading.set(false); c.error.set(''); c.room.set(room);
  c.api.hostRoomMeta.set(room); c.api.gameState.set(state);
  ng.applyChanges(c);
}, { room, state });
await shot('06-salon-cosmic');
await page.evaluate(state => {
  const c = ng.getComponent(document.querySelector('app-room'));
  clearInterval(c.timerId);
  c.now.set(Date.now());
  c.api.gameState.set({ ...state, status: 'question', questionStartedAt: new Date(Date.now() - 16000).toISOString(), questionEndsAt: new Date(Date.now() + 24000).toISOString() });
  ng.applyChanges(c);
}, state);
await page.locator('.current-clue img').waitFor();
await page.locator('.current-clue img').evaluate(img => img.decode());
await shot('07-indice-cosmic');
await page.evaluate(state => {
  const c = ng.getComponent(document.querySelector('app-room'));
  c.api.gameState.set({ ...state, status: 'reveal' }); ng.applyChanges(c);
}, state);
await shot('08-resultat-animateur-cosmic');

await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://localhost:4200/join/DEMO42?theme=cosmic');
await page.locator('app-join').waitFor();
await page.evaluate(({ room, state }) => {
  const c = ng.getComponent(document.querySelector('app-join'));
  c.api.socket.disconnect(); c.api.socket.removeAllListeners(); clearInterval(c.timerId);
  c.loading.set(false); c.roomError.set(''); c.room.set(room);
  c.playerId.set('p0'); c.playerAvatar.set('🍒'); c.now.set(Date.now());
  c.api.gameState.set({ ...state, status: 'question', questionStartedAt: new Date(Date.now() - 16000).toISOString(), questionEndsAt: new Date(Date.now() + 24000).toISOString() });
  ng.applyChanges(c);
}, { room, state });
await shot('09-joueur-mobile-cosmic', true);
await page.evaluate(state => {
  const c = ng.getComponent(document.querySelector('app-join'));
  c.api.gameState.set({ ...state, status: 'reveal' });
  c.api.playerResult.set({ isCorrect: true, points: 840, totalScore: 4860, rank: 3, totalPlayers: 30 });
  ng.applyChanges(c);
}, state);
await shot('10-resultat-joueur-mobile-cosmic', true);
await writeFile(`${out}metrics.json`, JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
