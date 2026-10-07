import { chromium } from '../../../performance/node_modules/playwright/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';

// Local UI checks only: no Firebase account or remote quiz is modified.
const out = new URL('./', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const base = 'http://localhost:4200';
const names = ['Camille', 'Alex', 'Sarah', 'Louis', 'Alice', 'Thomas', 'Emma', 'Hugo'];
const players = names.map((nickname, i) => ({ id: 'p' + i, nickname, realNickname: nickname, avatar: ['🍒', '🦊', '🥝', '🐼'][i % 4], score: 4860 - i * 320 }));
const titles = ['Gladiator (film, 2000)', 'Gladiator II (film, 2024)', 'Gladiator (jeu vidéo, 1986)', 'Fondation (livre, 1951)', 'One More Time (musique, 2000)'];
const dictionaries = [{ id: 'd1', name: 'Œuvres', values: titles, usage_count: 2 }];
const state = {
  status: 'lobby', currentQuestionIndex: 4, totalQuestions: 24,
  questionStartedAt: null, questionEndsAt: null, finalRevealStartedAt: null,
  playerCount: 30, answerCount: 18, leaderboard: players, topLeaderboard: players.slice(0, 5),
  players, hidePlayerNames: false, answerStats: { total: 30, correct: 21, incorrect: 9 },
  activeQuestion: {
    roundId: 'r1', roundTitle: 'Manche 2', targetType: 'work', targetId: 'w1',
    prompt: 'Quelle est cette œuvre ?', answerMode: 'autocomplete',
    clues: [
      { id: 'c1', kind: 'image', content: '/audit-media' },
      { id: 'c2', kind: 'text', content: 'Un général devenu esclave. Un esclave devenu gladiateur.' },
      { id: 'c3', kind: 'image', content: '/audit-media?second' },
    ], works: [], options: [], suggestions: titles,
    correctOption: { id: 'o1', label: titles[0] },
  },
};
const room = { id: 'audit', quiz_id: 'demo', code: 'DEMO42', status: 'lobby', current_round: 1,
  qrCodeDataUrl: await QRCode.toDataURL(base + '/join/DEMO42'), gameState: state };
const quizzes = [
  { id: 'q1', title: 'Qui se cache derrière ces œuvres ?', description: 'Les coups de cœur de notre équipe', rounds: Array(6).fill({}), sequence_mode: 'works-first', hide_player_names: true },
  { id: 'q2', title: 'La soirée pop culture', description: 'Films, musiques et jeux vidéo', rounds: Array(4).fill({}), sequence_mode: 'rounds' },
];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.route('**/socket.io/**', route => route.abort());
let rejectSave = false;
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/quizzes' && route.request().method() === 'POST') {
    await new Promise(r => setTimeout(r, 800));
    return route.fulfill(rejectSave
      ? { status: 400, json: { issues: [{ path: ['rounds', 0, 'works', 1, 'options', 2], message: 'Cette proposition est obligatoire.' }] } }
      : { json: { ...quizzes[0], ...route.request().postDataJSON() } });
  }
  const body = path === '/api/quizzes' ? quizzes : path === '/api/answer-dictionaries' ? dictionaries
    : path.startsWith('/api/rooms/') ? room : path === '/api/auth/config' ? { firebase: {} } : { theme: 'studio' };
  await route.fulfill({ json: body });
});
await page.route('**/audit-media*', async route => route.fulfill({ contentType: 'image/png', body: await readFile('contenu_quizz/louis/gladiator/gladiator_01.png') }));
await page.route('**/audit-audio', async route => route.fulfill({ contentType: 'audio/mpeg', body: await readFile('contenu_quizz/alice/Stardew valley/01.mp3') }));
await page.route('**/audit-video', async route => route.fulfill({ contentType: 'video/mp4', body: await readFile('contenu_quizz/alice/Blade Runner/02.mp4') }));
const metrics = [], checks = [];
async function shot(name, fullPage = false) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: out + name + '.png', fullPage, animations: 'disabled' });
  const metric = await page.evaluate(name => ({ name, viewport: innerWidth, viewportHeight: innerHeight, contentWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight }), name);
  metrics.push(metric);
  assert(metric.contentWidth <= metric.viewport, name + ': horizontal overflow');
}
async function home() {
  await page.goto(base + '/?theme=studio');
  await page.locator('app-home').waitFor();
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.api.authReady.set(true); c.api.authError.set('');
    c.api.adminUser.set({ id: 'audit', name: 'Camille', email: '', picture: '' });
    ng.applyChanges(c);
  });
  await page.getByRole('heading', { name: quizzes[0].title }).waitFor();
}
async function host(status, extra = {}) {
  await page.evaluate(({ state, room, status, extra }) => {
    const c = ng.getComponent(document.querySelector('app-room'));
    clearInterval(c.timerId); c.api.socket.disconnect(); c.api.socket.removeAllListeners();
    const hostState = { ...state, status, questionStartedAt: new Date(Date.now() - 6000).toISOString(), questionEndsAt: new Date(Date.now() + 34000).toISOString(), ...extra };
    c.api.hostRoom = async () => ({ ok: true, gameState: hostState });
    c.api.authReady.set(true); c.api.adminUser.set({ id: 'audit', name: 'Camille', email: '', picture: '' });
    c.loading.set(false); c.error.set(''); c.room.set(room); c.now.set(Date.now());
    c.api.connected.set(true); c.api.hostRoomMeta.set(room);
    c.api.gameState.set(hostState);
    ng.applyChanges(c);
  }, { state, room, status, extra });
}
async function player(status, extra = {}) {
  await page.evaluate(({ state, room, status, extra }) => {
    const c = ng.getComponent(document.querySelector('app-join'));
    clearInterval(c.timerId); c.api.socket.disconnect(); c.api.socket.removeAllListeners();
    c.loading.set(false); c.roomError.set(''); c.room.set(room); c.playerId.set('p0');
    c.playerAvatar.set('🍒'); c.totalScore.set(4020); c.now.set(Date.now());
    c.api.gameState.set({ ...state, status, questionStartedAt: new Date(Date.now() - 6000).toISOString(), questionEndsAt: new Date(Date.now() + 34000).toISOString(), ...extra });
    ng.applyChanges(c);
  }, { state, room, status, extra });
}
try {
  await page.goto(base + '/?theme=studio');
  await page.locator('app-home').waitFor();
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.api.authReady.set(true); c.api.authError.set(''); ng.applyChanges(c);
  });
  await shot('00-accueil');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('00-accueil-mobile', true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await home();
  await shot('01-bibliotheque');
  await page.getByRole('button', { name: 'Nouveau quiz' }).click();
  await page.locator('.question-nav-item').first().waitFor();
  assert.equal(await page.locator('.question-nav-item').count(), 2);
  await shot('02-editeur-neuf');
  await page.getByRole('button', { name: 'Ajouter une œuvre', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une œuvre', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.question-nav-item').length === 4);
  assert.equal(await page.locator('.question-nav-item').count(), 4);
  await page.evaluate(titles => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.draft.title = 'Qui se cache derrière ces œuvres ?';
    c.draft.rounds[0].works.forEach((work, i) => {
      work.options = [titles[i ? i + 2 : 0], 'Interstellar', 'Dune', 'Le Seigneur des anneaux']; work.correctOptionIndex = 0;
      work.clues = [{ kind: 'image', content: '/audit-media' }, { kind: 'text', content: 'Un destin hors du commun.' }, { kind: 'image', content: '/audit-media?second' }];
    });
    c.draft.rounds[0].works[0].answerMode = 'autocomplete';
    c.draft.rounds[0].works[0].dictionaryId = 'd1';
    c.draft.rounds[0].works[0].correctAnswer = titles[0];
    c.draft.rounds[0].person.options = ['Camille', 'Alex', 'Sarah', 'Louis'];
    c.selectQuestion(0, 0); ng.applyChanges(c);
  }, titles);
  await page.locator('.editor-media-stage img').evaluate(img => img.decode());
  await shot('03-editeur-image');
  await page.getByRole('button', { name: 'Ajouter un indice', exact: true }).click();
  await page.getByLabel("Texte de l'indice").fill('Un dernier indice.');
  await page.getByRole('button', { name: 'Supprimer cet indice', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.clue-timeline button:not(.add-clue)').length === 3);
  assert.equal(await page.locator('.clue-timeline button:not(.add-clue)').count(), 3);
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot('04-apercu');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await shot('05-reglages');
  await page.getByRole('button', { name: 'Questions', exact: true }).click();
  rejectSave = true;
  await page.getByRole('button', { name: 'Créer le quiz', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Enregistrement…' }).isDisabled());
  await page.getByText('Cette proposition est obligatoire.').waitFor();
  assert.equal(await page.locator('.question-nav-item.active small').textContent(), 'Œuvre 2');
  await shot('06-erreur-ciblee');
  rejectSave = false;
  await page.getByRole('button', { name: 'Créer le quiz', exact: true }).click();
  await page.locator('.quiz-library').waitFor();
  checks.push('Editor: add/remove clues, add works, preview, settings, validation focus, pending save and save confirmation');
  await page.getByRole('button', { name: 'Importer JSON' }).click();
  await shot('07-import');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dictionnaires', exact: true }).click();
  await page.getByRole('button', { name: 'Éditer', exact: true }).click();
  await shot('08-dictionnaires');

  await page.goto(base + '/rooms/DEMO42?theme=studio');
  await page.locator('app-room').waitFor();
  await host('lobby');
  await shot('09-salon');
  await host('question');
  await page.locator('.current-clue img').evaluate(img => img.decode());
  assert.equal(await page.locator('.clue-thumbnail:disabled').count(), 2);
  for (const [width, height] of [[1440, 900], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await shot('10-indice-' + width);
    const bottom = await page.locator('.live-footer').evaluate(el => el.getBoundingClientRect().bottom);
    assert(bottom <= height, 'host controls should fit viewport');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await host('question', { questionStartedAt: new Date(Date.now() - 20000).toISOString(), questionEndsAt: new Date(Date.now() + 20000).toISOString() });
  await page.getByText('Un général devenu esclave. Un esclave devenu gladiateur.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Indice 1, Image', exact: true }).click();
  await page.locator('.current-clue img').waitFor();
  checks.push('Host: viewport fit and clue reveal without exposing future clues; previous clue selection');
  for (const kind of ['audio', 'video']) {
    await host('question', { currentQuestionIndex: kind === 'audio' ? 10 : 11, activeQuestion: { ...state.activeQuestion, clues: [{ id: kind, kind, content: '/audit-' + kind }] } });
    await page.locator('.current-clue ' + kind).waitFor();
    await page.waitForFunction(kind => document.querySelector('.current-clue ' + kind)?.readyState >= 2, kind);
    if (await page.locator('.current-clue button').count()) await page.locator('.current-clue button').click();
    await page.waitForFunction(kind => document.querySelector('.current-clue ' + kind)?.currentTime > 0, kind);
    if (kind === 'video') {
      const frame = await page.locator('video').evaluate(video => {
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 64, 64);
        return new Set(ctx.getImageData(0,0,64,64).data).size;
      });
      assert(frame > 10, 'video frame is not blank');
    }
    await shot('10-media-' + kind);
  }
  checks.push('Host: audio and video loaded and playing; decoded video frame is nonblank');
  await host('reveal');
  await shot('11-resultats-animateur');
  await host('reveal', { currentQuestionIndex: 23 });
  assert(await page.getByRole('button', { name: 'Voir les résultats' }).isVisible());
  await host('finished', { finalRevealStartedAt: new Date(Date.now() - 20000).toISOString() });
  await shot('12-podium');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/join/DEMO42?theme=studio');
  await page.locator('app-join').waitFor();
  await player('lobby');
  await shot('13-joueur-pret');
  await player('question');
  await page.getByRole('combobox').fill('gla');
  await shot('14-joueur-recherche');
  await page.getByRole('option', { name: titles[0], exact: true }).click();
  assert(await page.getByRole('button', { name: 'Valider ma réponse' }).isEnabled());
  await shot('15-joueur-selection');
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.api.submitAnswer = () => new Promise(resolve => window.resolveAnswer = resolve);
  });
  await page.getByRole('button', { name: 'Valider ma réponse' }).click();
  await page.getByRole('heading', { name: 'Envoi de la réponse…' }).waitFor();
  await shot('16-joueur-envoi');
  assert.equal(await page.locator('.result-card').count(), 0);
  await page.evaluate(() => window.resolveAnswer({ ok: true }));
  await page.getByRole('heading', { name: 'Réponse enregistrée' }).waitFor();
  await shot('17-joueur-enregistre');
  await player('reveal');
  await page.locator('.result-pending').waitFor();
  assert.equal(await page.locator('.result-card').count(), 0);
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.api.playerResult.set({ isCorrect: true, points: 840, totalScore: 4860, rank: 3, totalPlayers: 30 }); ng.applyChanges(c);
  });
  await shot('18-joueur-correct');
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-join'));
    c.api.playerResult.set({ isCorrect: false, points: 0, totalScore: 4020, rank: 5, totalPlayers: 30 }); ng.applyChanges(c);
  });
  await shot('19-joueur-incorrect');
  await player('question', { currentQuestionIndex: 5 });
  await page.getByRole('combobox').fill('gla');
  assert.equal(await page.locator('.submitted-answer').count(), 0);
  await page.getByRole('option', { name: titles[0], exact: true }).click();
  await page.getByRole('button', { name: 'Valider ma réponse' }).click();
  await page.locator('.answer-sending').waitFor();
  await player('question', { currentQuestionIndex: 6 });
  await page.evaluate(() => window.resolveAnswer({ ok: true }));
  await page.getByRole('combobox').waitFor();
  assert.equal(await page.locator('.submitted-answer').count(), 0);
  await page.getByRole('combobox').fill('ancien');
  await player('question', { currentQuestionIndex: 7, activeQuestion: { ...state.activeQuestion, targetId: 'new-work' } });
  await page.waitForFunction(() => document.querySelector('[role=combobox]')?.value === '');
  checks.push('Player: selection required, pending/accepted/result states; late acknowledgement ignored on next question');
  for (const [width, height] of [[360, 800], [390, 480]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('combobox').fill('gla');
    await page.getByRole('option', { name: titles[0], exact: true }).click();
    await shot('20-joueur-' + width + '-' + height, true);
    await page.getByRole('button', { name: 'Valider ma réponse' }).scrollIntoViewIfNeeded();
    const visible = await page.getByRole('button', { name: 'Valider ma réponse' }).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert(visible, 'validation remains reachable');
    await page.getByRole('button', { name: 'Modifier la réponse' }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await player('question', { currentQuestionIndex: 7, activeQuestion: { ...state.activeQuestion, answerMode: 'choices', options: titles.slice(0,4).map((label,i) => ({ id:'o'+i, label })) } });
  await shot('21-joueur-choix');
  await player('question', { currentQuestionIndex: 8, activeQuestion: { ...state.activeQuestion, targetType: 'person', prompt: 'À qui appartiennent ces œuvres ?', works: titles.slice(0,3).map(title => ({ title })), clues: [] } });
  await shot('22-joueur-personne', true);
  await player('finished', { finalRevealStartedAt: new Date(Date.now() - 20000).toISOString() });
  await shot('23-joueur-final', true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await home();
  await page.getByRole('button', { name: 'Nouveau quiz' }).click();
  await page.locator('.editor-properties').waitFor();
  for (const theme of ['cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await shot('24-editeur-' + theme);
  }
  await page.evaluate(() => document.documentElement.dataset.theme = 'studio');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('25-editeur-mobile', true);
  await page.getByLabel("Texte de l'indice").scrollIntoViewIfNeeded();
  await shot('26-editeur-mobile-champ');
  assert(await page.getByLabel("Texte de l'indice").isVisible());
  await page.locator('.mobile-question-toggle').scrollIntoViewIfNeeded();
  await page.locator('.mobile-question-toggle').click();
  await page.getByRole('button', { name: 'Ajouter une œuvre', exact: true }).click();
  assert.equal(await page.locator('.mobile-question-toggle').getAttribute('aria-expanded'), 'false');
  checks.push('Mobile editor: collapsed navigation, selecting/adding a question opens the corresponding editor');
  await page.setViewportSize({ width: 720, height: 500 });
  await shot('27-editeur-zoom-equivalent', true);
  await page.setViewportSize({ width: 390, height: 844 });

  // Same server timestamp on two screens, including a tab opened during the reveal.
  const playerPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await playerPage.route('**/socket.io/**', route => route.abort());
  await playerPage.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/rooms/') ? room : { firebase: {} } }));
  await playerPage.goto(base + '/join/DEMO42?theme=studio');
  await playerPage.locator('app-join').waitFor();
  await page.goto(base + '/rooms/DEMO42?theme=studio');
  await page.locator('app-room').waitFor();
  const started = Date.now();
  const hiddenState = { ...state, status: 'finished', hidePlayerNames: true, finalRevealStartedAt: new Date(started).toISOString(), leaderboard: players.map(p => ({ ...p, nickname: p.avatar })) };
  for (const [elapsed, count] of [[0, 0], [1200, 5], [3500, 6], [6500, 7], [10000, 8], [13500, 8]]) {
    for (const [target, selector] of [[page, 'app-room'], [playerPage, 'app-join']]) {
      await target.evaluate(({ selector, hiddenState, room, now }) => {
        const c = ng.getComponent(document.querySelector(selector)); clearInterval(c.timerId);
        c.api.socket.disconnect(); c.api.socket.removeAllListeners(); c.loading.set(false);
        if (selector === 'app-room') {
          c.api.hostRoom = async () => ({ ok: true, gameState: hiddenState });
          c.api.authReady.set(true); c.api.adminUser.set({ id: 'audit', name: 'Camille', email: '', picture: '' });
          c.api.connected.set(true);
        }
        c.error?.set(''); c.roomError?.set(''); c.room.set(room); c.playerId?.set('p0');
        c.api.gameState.set(hiddenState); c.api.hostRoomMeta.set(selector === 'app-room' ? room : undefined);
        c.now.set(now); ng.applyChanges(c);
      }, { selector, hiddenState, room, now: started + elapsed });
      if (selector === 'app-room') await target.locator('.podium-screen').waitFor();
      const visibleNames = await target.locator('.name-revealed').count();
      assert.equal(visibleNames, count, selector + ' names at ' + elapsed);
    }
    assert.equal(await page.locator('.final-ranking').isVisible(), elapsed >= 13500);
  }
  await playerPage.close();
  checks.push('Final identities: host/player reveal the same names at 0 / 1.2 / 3.5 / 6.5 / 10 / 13.5 seconds');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await host('question');
  await shot('28-animateur-mobile', true);
  await host('finished', { finalRevealStartedAt: new Date(Date.now() - 20000).toISOString() });
  await shot('29-podium-mobile', true);
  assert.equal(await page.locator('.podium-place.first').evaluate(el => getComputedStyle(el).animationDuration), '1e-05s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push('Reduced motion, mobile host/podium and narrow layout equivalent to 200% desktop zoom');
  assert.deepEqual(errors, [], 'browser exceptions');
  console.log(JSON.stringify({ checks, metrics, errors }, null, 2));
} finally {
  await writeFile(out + 'report.json', JSON.stringify({ checks, metrics, errors }, null, 2));
  await browser.close();
}
