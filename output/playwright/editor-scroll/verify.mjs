import { chromium } from '../../../performance/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = new URL('./', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const options = title => [title, 'Une autre réponse', 'Troisième proposition', 'Dernière proposition'].map((label, index) => ({ id: String(index), label, isCorrect: index === 0 ? 1 : 0 }));
const quiz = { id: 'long-quiz', title: 'Les œuvres de toute notre équipe', description: '40 manches de test', answer_mode: 'choices',
  rounds: Array.from({ length: 40 }, (_, i) => ({ title: 'Manche ' + (i + 1), person: { name: 'Participant ' + (i + 1), options: options('Participant ' + (i + 1)) },
    works: Array.from({ length: 3 }, (_, j) => ({ options: options(`Œuvre ${i + 1}.${j + 1}`), clues: [{ kind: 'text', content: `Indice de la manche ${i + 1}, œuvre ${j + 1}.` }] })) })) };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const checks = [], errors = [], metrics = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
await page.route('**/socket.io/**', route => route.abort());
await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'PUT') return route.fulfill({ status: 400, json: {
    issues: [{ path: ['rounds', 19, 'works', 1, 'options', 2], message: 'Cette proposition est à corriger.' }],
  } });
  const body = path === '/api/auth/config' ? { firebase: {} } : path === '/api/quizzes' ? [quiz]
    : path.endsWith('/edit') ? quiz : path === '/api/answer-dictionaries' ? [] : { theme: 'studio' };
  return route.fulfill({ json: body });
});
async function shot(name) {
  await page.screenshot({ path: out + name + '.png', fullPage: true, animations: 'disabled' });
  const metric = await page.evaluate(name => ({ name, width: innerWidth, height: innerHeight,
    pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight,
    navigationHeight: document.querySelector('.editor-question-list').clientHeight,
    navigationScrollHeight: document.querySelector('.editor-question-list').scrollHeight }), name);
  metrics.push(metric);
  assert(metric.pageWidth <= metric.width, 'Horizontal overflow: ' + name);
  if (metric.width > 600) assert(metric.pageHeight <= metric.height + 1, 'Page should fit viewport: ' + JSON.stringify(metric));
  if (metric.width > 600) assert(metric.navigationHeight >= 100, 'Navigation needs enough usable height: ' + JSON.stringify(metric));
}
async function visibleInScrollArea(selector, parent) {
  return page.locator(selector).evaluate((el, parent) => {
    const bounds = document.querySelector(parent).getBoundingClientRect(), rect = el.getBoundingClientRect();
    return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
  }, parent);
}
async function waitForSelection() {
  await page.waitForFunction(() => {
    const list = document.querySelector('.editor-question-list'), active = list.querySelector('.active');
    const bounds = list.getBoundingClientRect(), rect = active.getBoundingClientRect();
    return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
  });
}
try {
  await page.goto('http://localhost:4200/?theme=studio');
  await page.locator('app-home').waitFor();
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.api.socket.disconnect(); c.api.socket.removeAllListeners(); c.api.authReady.set(true);
    c.api.adminUser.set({ id: 'local-test', name: 'Camille', email: '', picture: '' }); ng.applyChanges(c);
  });
  await page.getByRole('button', { name: 'Modifier ' + quiz.title, exact: true }).click();
  await page.locator('.question-group').nth(39).waitFor({ state: 'attached' });
  await shot('01-editeur-40-manches');
  const contentTop = await page.locator('.editor-question-content').evaluate(el => el.getBoundingClientRect().top);
  const list = page.getByRole('region', { name: 'Manches et questions' });
  await list.hover();
  await page.mouse.wheel(0, 16000);
  await page.waitForFunction(() => document.querySelector('.editor-question-list').scrollTop > 1000);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.locator('.editor-question-content').evaluate(el => el.scrollTop), 0);
  await page.locator('.question-group').nth(39).locator('.question-nav-item').first().click();
  await page.getByRole('heading', { name: 'Œuvre 40.1', exact: true }).waitFor();
  assert.equal(await page.locator('.editor-question-content').evaluate(el => el.getBoundingClientRect().top), contentTop);
  assert(await visibleInScrollArea('.question-nav-item.active', '.editor-question-list'));
  await page.getByLabel("Texte de l'indice").fill('Indice modifié sans remonter la page.');
  await shot('02-derniere-manche');
  checks.push('40 rounds: sidebar scrolling leaves the form and page fixed; last round directly editable');

  await page.setViewportSize({ width: 800, height: 650 });
  const oldNavigation = await list.evaluate(el => el.scrollTop);
  await page.locator('.editor-question-content').evaluate(el => el.scrollTop = el.scrollHeight);
  assert(await page.locator('.editor-question-content').evaluate(el => el.scrollTop > 100));
  assert.equal(await list.evaluate(el => el.scrollTop), oldNavigation);
  await page.locator('.question-group').nth(39).locator('.question-nav-item').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.editor-question-content').scrollTop === 0);
  await waitForSelection();
  assert(await visibleInScrollArea('.question-editor-heading', '.editor-question-content'));
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByText('Cette proposition est à corriger.', { exact: true }).waitFor();
  await waitForSelection();
  await page.waitForFunction(() => {
    const area = document.querySelector('.editor-question-content').getBoundingClientRect();
    const error = document.querySelector('.field-error').getBoundingClientRect();
    return error.top >= area.top && error.bottom <= area.bottom;
  });
  assert.equal(await page.locator('.question-nav-item.active strong').textContent(), 'Œuvre 20.2');
  await list.focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('.editor-question-list').scrollTop === 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await list.press('End');
  await page.waitForFunction(() => {
    const list = document.querySelector('.editor-question-list');
    return list.scrollTop >= list.scrollHeight - list.clientHeight - 5;
  });
  assert.equal(await page.evaluate(() => scrollY), 0);
  checks.push('Validation reveals the relevant question and error; keyboard Home/End scroll only the round list');
  const menu = page.locator('.question-group').nth(39).locator('.action-menu');
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: 'Dupliquer', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.question-group').length === 41);
  await waitForSelection();
  await page.getByRole('button', { name: 'Ajouter une manche', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.question-group').length === 42);
  await waitForSelection();
  await shot('03-navigation-tablette');
  checks.push('Independent form scrolling, reset on selection, contextual menu and newly added/duplicated round kept visible');

  for (const theme of ['studio', 'cosmic', 'academy', 'orbit', 'arcade']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width: 1366, height: 768 });
    await shot('04-editeur-' + theme);
    const save = await page.getByRole('button', { name: 'Enregistrer', exact: true }).boundingBox();
    const add = await page.getByRole('button', { name: 'Ajouter une manche', exact: true }).boundingBox();
    assert(save.y >= 0 && save.y + save.height <= 768);
    assert(add.y >= 0 && add.y + add.height <= 768);
  }
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home'));
    c.draft.title = 'Un titre de quiz volontairement long pour vérifier que le bandeau peut revenir sur plusieurs lignes sans masquer les commandes';
    c.message.set('Un message assez long à afficher dans le bandeau. '.repeat(3));
    document.documentElement.dataset.theme = 'studio'; ng.applyChanges(c);
  });
  await page.setViewportSize({ width: 720, height: 500 });
  await shot('05-editeur-fenetre-basse');
  checks.push('Five themes at 1366x768 and 720x500 with wrapped title/message: save and add controls remain available');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const c = ng.getComponent(document.querySelector('app-home')); c.draft.title = 'Les œuvres de notre équipe'; c.message.set(''); ng.applyChanges(c);
  });
  await page.locator('.mobile-question-toggle').click();
  await waitForSelection();
  assert(await list.evaluate(el => el.clientHeight <= 360 && el.scrollHeight > 10000));
  await list.evaluate(el => el.scrollTop = 0);
  await page.locator('.question-group').first().locator('.question-nav-item').first().click();
  await page.waitForFunction(() => document.querySelector('.mobile-question-toggle').getAttribute('aria-expanded') === 'false');
  await page.getByLabel("Texte de l'indice").fill('Indice modifié sur mobile.');
  await page.locator('.mobile-question-toggle').click();
  await list.evaluate(el => el.scrollTop = el.scrollHeight);
  await page.locator('.question-group').nth(39).locator('.question-nav-item').first().click();
  await page.getByRole('heading', { name: 'Œuvre 40.1', exact: true }).waitFor();
  await shot('06-selection-mobile');
  assert(await page.evaluate(() => document.documentElement.scrollHeight < 2500));
  await page.locator('.mobile-question-toggle').click();
  await waitForSelection();
  assert(await page.locator('.question-nav-item.active').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= document.querySelector('.editor-toolbar').getBoundingClientRect().bottom && rect.bottom <= innerHeight;
  }), 'The active mobile question must not sit behind the sticky toolbar');
  await shot('07-liste-mobile');
  checks.push('Mobile: bounded vertical list, auto-collapse on selection, reopen at active question and last-round editing');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, metrics, errors }, null, 2));
} finally {
  if (checks.length < 5) console.log(await page.evaluate(() => ({
    focus: document.activeElement?.className,
    navigation: [...document.querySelectorAll('.editor-question-list')].map(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight })),
  })));
  await writeFile(out + 'report.json', JSON.stringify({ checks, metrics, errors }, null, 2));
  await browser.close();
}
