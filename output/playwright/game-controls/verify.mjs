import { chromium } from '../../../performance/node_modules/playwright/index.mjs';
import QRCode from 'qrcode';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('./', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const host = await context.newPage(), player = await context.newPage();
const errors = [], checks = [], geometry = [];
const players = Array.from({ length: 17 }, (_, index) => ({ id: 'p' + index, nickname: 'Participant ' + (index + 1), score: 0 }));
const state = { status: 'lobby', currentQuestionIndex: -1, totalQuestions: 4, questionStartedAt: null, questionEndsAt: null,
  questionPausedAt: null, finalRevealStartedAt: null, playerCount: players.length, answerCount: 0, players, leaderboard: [], topLeaderboard: [], hidePlayerNames: false };
const room = { id: 'LOCAL1', code: 'LOCAL1', quiz_id: 'q1', gameState: state, qrCodeDataUrl: await QRCode.toDataURL('http://localhost:4200/join/LOCAL1') };
// A local silent WAV verifies real playback without depending on personal assets.
const wav = Buffer.alloc(44 + 8000 * 2 * 12);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
await context.route('**/pause-test.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
await context.route('**/socket.io/**', route => route.abort());
await context.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/config' ? { firebase: {} }
  : route.request().url().includes('/api/rooms/') ? room : { theme: 'studio' } }));
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => {
    if (window.rejectClipboard) throw new Error('Denied'); window.copiedLink = value;
  } } });
});
for (const page of [host, player]) { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); }
async function shot(page, name) {
  await page.screenshot({ path: out + name + '.png', animations: 'disabled' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow: ' + name);
}
async function updatePlayer(next) {
  await player.evaluate(next => { const c = ng.getComponent(document.querySelector('app-join')); c.now.set(Date.now()); c.api.gameState.set(next); ng.applyChanges(c); }, next);
}
try {
  await host.goto('http://localhost:4200/rooms/LOCAL1?theme=studio');
  await host.locator('app-room').waitFor();
  await host.evaluate(({ state, room }) => {
    const c = ng.getComponent(document.querySelector('app-room'));
    c.api.socket.disconnect(); c.api.socket.removeAllListeners(); c.api.authReady.set(true);
    c.api.adminUser.set({ id: 'test', name: 'Camille' }); c.api.connected.set(true);
    c.api.hostRoom = async () => ({ ok: true, gameState: c.api.gameState() });
    c.api.hostRoomMeta.set(room); c.room.set(room); c.api.gameState.set(state); c.loading.set(false); c.error.set(''); ng.applyChanges(c);
  }, { state, room });
  await host.locator('.lobby-qr img').waitFor();
  for (const [width, height] of [[1920, 1080], [1440, 1000], [840, 900], [768, 900], [390, 844]]) {
    await host.setViewportSize({ width, height });
    await shot(host, '01-lobby-' + width);
    const position = await host.evaluate(() => {
      const parent = document.querySelector('.lobby-launch').getBoundingClientRect();
      const image = document.querySelector('.lobby-qr img'), rect = image.getBoundingClientRect();
      return { width: innerWidth, delta: Math.abs(rect.left + rect.width / 2 - parent.left - parent.width / 2),
        square: Math.abs(rect.width - rect.height), decoded: image.complete && image.naturalWidth > 0 };
    });
    geometry.push(position); assert(position.delta < 1); assert(position.square < 1); assert(position.decoded);
  }
  checks.push('QR centered and square at 1920, 1440, 840, 768 and 390 px with uneven player counts');
  const lobbyCopy = host.locator('.lobby-launch app-copy-join-link button');
  await lobbyCopy.click();
  await host.getByRole('button', { name: 'Lien copié', exact: true }).waitFor();
  assert.equal(await host.evaluate(() => window.copiedLink), 'http://localhost:4200/join/LOCAL1');
  await host.evaluate(() => window.rejectClipboard = true);
  await lobbyCopy.click(); await host.locator('.lobby-launch [role="alert"]').waitFor();
  await host.evaluate(() => window.rejectClipboard = false);
  await lobbyCopy.click();
  assert.equal(await host.locator('.lobby-launch [role="alert"]').count(), 0);
  const share = host.locator('.room-share'), toggle = share.locator('summary');
  await toggle.click();
  assert(await share.evaluate(el => el.open));
  await share.getByRole('button', { name: 'Copier le lien', exact: true }).click();
  assert(await share.evaluate(el => el.open), 'Inside clicks keep the popover open');
  await host.locator('.lobby-player-count').click();
  assert.equal(await share.evaluate(el => el.open), false);
  await toggle.click(); await share.locator('button').focus(); await host.keyboard.press('Escape');
  assert.equal(await share.evaluate(el => el.open), false);
  assert(await toggle.evaluate(el => el === document.activeElement));
  checks.push('Copy link in lobby and popover, success/failure feedback, outside click and Escape with focus restoration');

  await host.setViewportSize({ width: 1440, height: 900 });
  const live = { ...state, status: 'question', currentQuestionIndex: 0, questionStartedAt: new Date(Date.now() - 5000).toISOString(), questionEndsAt: new Date(Date.now() + 35000).toISOString(),
    activeQuestion: { roundId: 'r1', roundTitle: 'Manche 1', targetType: 'work', targetId: 'w1', prompt: 'Quelle est cette œuvre ?', answerMode: 'autocomplete',
      options: [], suggestions: ['Fondation (livre, 1951, Isaac Asimov)', 'Interstellar (film, 2014, Christopher Nolan)'],
      clues: [{ id: 'c1', kind: 'audio', content: '/pause-test.wav' }, { id: 'c2', kind: 'text', content: 'Indice 2' }, { id: 'c3', kind: 'text', content: 'Indice 3' }], works: [] } };
  await host.evaluate(live => {
    const c = ng.getComponent(document.querySelector('app-room')); c.api.gameState.set(live);
    c.api.setQuestionPaused = async (code, questionIndex, paused) => {
      window.pauseCalls = (window.pauseCalls ?? 0) + 1;
      await new Promise(resolve => setTimeout(resolve, 600));
      if (window.pauseFailure) throw new Error('Simulated timeout');
      const state = c.api.gameState(), now = Date.now();
      const shift = paused ? 0 : now - Date.parse(state.questionPausedAt);
      c.api.gameState.set({ ...state, questionPausedAt: paused ? new Date(now).toISOString() : null,
        questionStartedAt: new Date(Date.parse(state.questionStartedAt) + shift).toISOString(),
        questionEndsAt: new Date(Date.parse(state.questionEndsAt) + shift).toISOString() });
      c.now.set(now); ng.applyChanges(c); return { ok: true };
    };
    ng.applyChanges(c);
  }, live);
  await host.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > 0.1; });
  await player.goto('http://localhost:4200/join/LOCAL1?theme=studio');
  await player.locator('app-join').waitFor();
  await player.evaluate(({ live, room }) => {
    const c = ng.getComponent(document.querySelector('app-join')); c.api.socket.disconnect(); c.api.socket.removeAllListeners();
    c.room.set(room); c.playerId.set('p1'); c.loading.set(false); c.roomError.set(''); c.api.gameState.set(live); ng.applyChanges(c);
  }, { live, room });
  await player.setViewportSize({ width: 390, height: 844 });
  await player.getByRole('combobox').fill('Fondation');
  await player.getByRole('option').first().click();
  await host.getByRole('button', { name: 'Pause', exact: true }).click();
  const pending = host.getByRole('button', { name: 'Mise à jour…', exact: true });
  await pending.waitFor(); assert(await pending.isDisabled());
  await host.getByRole('button', { name: 'Reprendre', exact: true }).waitFor();
  assert.equal(await host.evaluate(() => window.pauseCalls), 1);
  const paused = await host.evaluate(() => ng.getComponent(document.querySelector('app-room')).api.gameState());
  await updatePlayer(paused);
  const pausedTime = await host.locator('.live-timer strong').textContent();
  const mediaTime = await host.locator('audio').evaluate(el => el.currentTime);
  assert(await host.locator('audio').evaluate(el => el.paused));
  for (const page of [host, player]) await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-room, app-join')); clearInterval(c.timerId); c.now.set(Date.now() + 120000); ng.applyChanges(c);
  });
  assert.equal(await host.locator('.live-timer strong').textContent(), pausedTime);
  assert.equal(await host.locator('.clue-thumbnail:disabled').count(), 2);
  assert(await player.getByRole('button', { name: 'Valider ma réponse' }).isDisabled());
  await player.getByText('Partie en pause.', { exact: false }).waitFor();
  assert(await player.locator('.selected-search-answer').textContent().then(text => text.includes('Fondation')));
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await host.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await player.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await shot(host, '02-pause-animateur-' + theme); await shot(player, '03-pause-joueur-' + theme);
  }
  assert(Math.abs(await host.locator('audio').evaluate(el => el.currentTime) - mediaTime) < .05);
  await host.setViewportSize({ width: 390, height: 844 }); await shot(host, '04-pause-animateur-mobile');
  await host.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await host.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  const resumed = await host.evaluate(() => ng.getComponent(document.querySelector('app-room')).api.gameState());
  await updatePlayer(resumed);
  assert.equal(await player.getByRole('button', { name: 'Valider ma réponse' }).isDisabled(), false);
  assert(await host.locator('audio').evaluate(el => !el.paused && el.currentTime >= 0.1));
  assert(await player.locator('.selected-search-answer').textContent().then(text => text.includes('Fondation')));
  checks.push('Pause pending state, frozen countdown/clues/media, player selection preserved and answer disabled; synchronized resume');
  await host.evaluate(() => window.pauseFailure = true);
  await host.getByRole('button', { name: 'Pause', exact: true }).click();
  await host.getByText("Le serveur n'a pas confirmé la commande.", { exact: false }).waitFor();
  assert.equal(await host.getByRole('button', { name: 'Pause', exact: true }).isDisabled(), false);
  assert.equal(await host.evaluate(() => ng.getComponent(document.querySelector('app-room')).api.gameState().questionPausedAt), null);
  checks.push('Timeout feedback restores the control without falsely showing a paused game');
  assert.deepEqual(errors, []);
} finally {
  await writeFile(out + 'report.json', JSON.stringify({ checks, geometry, errors }, null, 2));
  console.log(JSON.stringify({ checks, geometry, errors }, null, 2));
  await browser.close();
}
