import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { chromium } from '../../../performance/node_modules/playwright/index.mjs';

const root = new URL('../../../', import.meta.url);
const out = new URL('./', import.meta.url);
await mkdir(out, { recursive: true });
const assets = ['logo-buzzer.png', 'favicon-32x32.png', 'favicon.ico', 'apple-touch-icon.png'];
for (const name of assets) {
  assert.deepEqual(await readFile(new URL('client/public/' + name, root)), await readFile(new URL('dist/client/' + name, root)));
}
for (const [name, size, transparent] of [['logo-buzzer.png', 128, true], ['favicon-32x32.png', 32, true], ['apple-touch-icon.png', 180, false]]) {
  const png = PNG.sync.read(await readFile(new URL('client/public/' + name, root)));
  assert.equal(png.width, size);
  assert.equal(png.height, size);
  assert.equal(png.data[3], transparent ? 0 : 255);
  assert(png.data.some((value, index) => index % 4 === 3 && value > 200));
}
const ico = await readFile(new URL('client/public/favicon.ico', root));
assert.equal(ico.readUInt16LE(4), 3);
for (const [index, size] of [16, 32, 48].entries()) {
  const offset = ico.readUInt32LE(6 + index * 16 + 12);
  assert.equal(ico.readUInt32BE(offset + 16), size);
  assert.equal(ico.readUInt32BE(offset + 20), size);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [];
try {
  // Chromium icon requests are not intercepted: decode the ICO on a separate page.
  const assetsPage = await browser.newPage();
  await assetsPage.goto('http://localhost:4200/favicon-32x32.png?v=buzzer-1');
  for (const name of assets) {
    const response = await assetsPage.request.get('http://localhost:4200/' + name);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-type'], /image\//);
    assert.deepEqual(await response.body(), await readFile(new URL('client/public/' + name, root)));
  }
  await assetsPage.evaluate(async assets => {
    for (const name of assets) {
      const image = new Image();
      image.src = '/' + name;
      await image.decode();
      if (!image.naturalWidth) throw new Error('Blank image: ' + name);
    }
  }, assets);
  await assetsPage.close();
  checks.push('Build assets, transparency, ICO sizes, HTTP responses and browser decoding');

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/api/**', route => route.fulfill({ json: {} }));
  await context.route('**/socket.io/**', route => route.abort());
  const page = await context.newPage();
  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.goto('http://localhost:4200/?theme=' + theme);
    await page.locator('.brand-logo').waitFor();
    await page.locator('.brand-logo').evaluate(image => image.decode());
    assert.equal(await page.getByRole('link', { name: 'Quiz Teammates', exact: true }).count(), 1);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator('.brand-logo').boundingBox();
      assert.equal(bounds.width, 32);
      assert.equal(bounds.height, 32);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('.topbar').screenshot({ path: new URL(`${theme}-${width}.png`, out).pathname });
    }
    checks.push('Header logo, accessible link and mobile layout: ' + theme);
  }
  await page.goto('http://localhost:4200/?theme=studio');
  await page.locator('.brand-logo').waitFor();
  await page.evaluate(() => {
    const component = ng.getComponent(document.querySelector('app-root'));
    component.gameView.set(true);
    component.api.gameState.set({ status: 'question', hidePlayerNames: false });
    component.api.hostRoomMeta.set({ code: 'DEMO12' });
    ng.applyChanges(component);
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.topbar').screenshot({ path: new URL('host-mobile.png', out).pathname });
  const links = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(links => links.map(link => link.href));
  assert.equal(links.length, 3);
  assert(links.every(link => link.endsWith('?v=buzzer-1')));
  assert(!links.some(link => link.includes('.svg')));
  checks.push('Dark host header with live controls, cache-versioned favicon links');
  await writeFile(new URL('report.json', out), JSON.stringify({ checks }, null, 2) + '\n');
  console.log(JSON.stringify({ checks }, null, 2));
} finally {
  await browser.close();
}
