'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('production extension in real Chromium', { timeout: 120000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const extension = path.join(root, 'dist/shobdo');
  assert.ok(fs.existsSync(path.join(extension, 'manifest.json')), 'Run npm run build first');
  const output = path.join(root, 'test-results');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'shobdo-profile-'));
  let context;
  const errors = [];
  const testAssets = {
    '/test-assets/model.js': 'node_modules/prosemirror-model/dist/index.js',
    '/test-assets/state.js': 'node_modules/prosemirror-state/dist/index.js',
    '/test-assets/view.js': 'node_modules/prosemirror-view/dist/index.js',
    '/test-assets/transform.js': 'node_modules/prosemirror-transform/dist/index.js',
    '/test-assets/orderedmap.js': 'node_modules/orderedmap/dist/index.js',
    '/test-assets/react.js': 'node_modules/react/umd/react.development.js',
    '/test-assets/react-dom.js': 'node_modules/react-dom/umd/react-dom.development.js',
    '/test-assets/social.js': 'test-results/social-fixture.js',
  };
  const server = http.createServer((request, response) => {
    if (testAssets[request.url]) {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(fs.readFileSync(path.join(root, testAssets[request.url])));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(path.join(root, request.url === '/managed' ? 'tests/fixtures/managed.html' : 'demo/index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: process.env.SHOBDO_HEADED !== '1',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(url);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(() => document.getElementById('popup').getAttribute('aria-busy') === 'false');
    return { page, popup, worker };
  }
  let { page, popup, worker } = await launch();
  const field = selector => page.locator(selector);
  async function settled() {
    await popup.waitForFunction(() => document.getElementById('popup').getAttribute('aria-busy') === 'false');
    // Storage notification and selectionchange are asynchronous browser events.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function mode(value) {
    await popup.locator(`#mode-${value}`).check();
    await settled();
  }
  async function type(selector, value) {
    await field(selector).focus();
    await field(selector).pressSequentially(value);
  }
  async function seed(selector, value) {
    // Existing text is programmatically set, not typed. Playwright fill() emits
    // insertText, which Shobdo correctly transliterates in Bangla mode.
    await field(selector).evaluate((element, text) => {
      element.value = text;
      element.setSelectionRange(text.length, text.length);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    }, value);
  }

  await t.test('loads with working defaults, CSP-safe popup and registered shortcut', async () => {
    assert.equal(await popup.locator('#mode-english').isChecked(), true);
    assert.equal(await popup.locator('#enabled').isChecked(), true);
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.equal(commands.find(command => command.name === 'toggle-mode')?.shortcut, 'Alt+Shift+S');
    await type('#area', 'ami');
    assert.equal(await field('#area').inputValue(), 'ami');
  });
  await t.test('live popup mode changes convert actual keystrokes into requested phrases', async () => {
    await mode('bangla');
    await field('#area').fill('');
    await type('#area', 'ami banglay likhi. tumi kemon acho? tomar bhalo bangla');
    assert.equal(await field('#area').inputValue(), 'আমি বাংলায় লিখি. তুমি কেমন আছো? তোমার ভালো বাংলা');
  });
  await t.test('Latin-aware backspace and native textarea newline', async () => {
    await field('#area').fill('');
    await type('#area', 'kha');
    assert.equal(await field('#area').inputValue(), 'খা');
    await field('#area').press('Backspace');
    assert.equal(await field('#area').inputValue(), 'খ');
    await field('#area').press('Backspace');
    assert.equal(await field('#area').inputValue(), 'ক');
    await field('#area').press('Backspace');
    assert.equal(await field('#area').inputValue(), '');
    await type('#area', 'ami');
    await field('#area').press('Enter');
    await type('#area', 'bangla');
    assert.equal(await field('#area').inputValue(), 'আমি\nবাংলা');
  });
  await t.test('selection replacement preserves text and caret in text/search inputs', async () => {
    for (const selector of ['#plain', '#search']) {
      await seed(selector, 'Before old after');
      await field(selector).focus();
      await field(selector).evaluate(element => element.setSelectionRange(7, 10));
      await field(selector).pressSequentially('ami');
      assert.equal(await field(selector).inputValue(), 'Before আমি after');
      assert.deepEqual(await field(selector).evaluate(element => [element.selectionStart, element.selectionEnd]), [10, 10]);
      await field(selector).press('Home');
      await field(selector).pressSequentially('tumi ');
      assert.equal(await field(selector).inputValue(), 'তুমি Before আমি after');
    }
  });
  await t.test('punctuation and one-word English escape work with real selection events', async () => {
    await seed('#area', 'Existing বাংলা: ');
    await type('#area', 'ami, `React! bangla.');
    assert.equal(await field('#area').inputValue(), 'Existing বাংলা: আমি, React! বাংলা.');
    await mode('english');
    await type('#area', ' JavaScript');
    assert.equal(await field('#area').inputValue(), 'Existing বাংলা: আমি, React! বাংলা. JavaScript');
  });
  await t.test('enable switch actually pauses/resumes transliteration', async () => {
    await mode('bangla');
    await popup.locator('#enabled').uncheck();
    await settled();
    await field('#area').fill('');
    await type('#area', 'ami ');
    assert.equal(await field('#area').inputValue(), 'ami ');
    await popup.locator('#enabled').check();
    await settled();
    await type('#area', 'ami');
    assert.equal(await field('#area').inputValue(), 'ami আমি');
  });
  await t.test('basic contenteditable preserves formatting and surrounding text', async () => {
    await field('#rich').focus();
    await field('#rich').press('ControlOrMeta+End');
    await field('#rich').pressSequentially('ami bangla');
    assert.equal(await field('#rich').textContent(), 'Existing text: type after this. আমি বাংলা');
    assert.equal(await field('#rich b').textContent(), 'Existing text: ');
    await field('#rich').press('Backspace');
    assert.equal(await field('#rich').textContent(), 'Existing text: type after this. আমি বাংল');
  });
  await t.test('site rerenders must not reverse ami, hi or valo or abandon the active Latin word', async () => {
    await page.evaluate(() => {
      const rich = document.createElement('div'); rich.id = 'rerender-rich';
      rich.contentEditable = 'true'; rich.style.cssText = 'min-height:40px;white-space:pre-wrap;border:1px solid';
      // A common controlled-editor pattern: replace DOM text from state in its
      // input handler. The browser's live selection then collapses to the start.
      rich.addEventListener('input', () => rich.replaceChildren(document.createTextNode(rich.textContent)));
      document.body.append(rich);
    });
    const rich = field('#rerender-rich');
    for (const [latin, expected] of [['ami', 'আমি'], ['hi', 'হি'], ['valo', 'ভালো']]) {
      await rich.evaluate(element => element.replaceChildren());
      await rich.focus();
      await rich.pressSequentially(latin);
      assert.equal(await rich.textContent(), expected, `Typing ${latin} must compose forwards after a site rerender`);
    }
  });
  await t.test('microtask rerenders preserve word order, the caret and Latin-aware backspace', async () => {
    await page.evaluate(() => {
      const rich = document.createElement('div'); rich.id = 'async-rerender-rich';
      rich.contentEditable = 'true'; rich.style.cssText = 'min-height:40px;white-space:pre-wrap;border:1px solid';
      rich.addEventListener('input', () => {
        const text = rich.textContent;
        queueMicrotask(() => queueMicrotask(() => rich.replaceChildren(document.createTextNode(text))));
      });
      document.body.append(rich);
    });
    const rich = field('#async-rerender-rich');
    await rich.focus(); await rich.pressSequentially('ami hi valo');
    assert.equal(await rich.textContent(), 'আমি হি ভালো');
    await rich.press('Backspace');
    assert.equal(await rich.textContent(), 'আমি হি ভাল');
    await rich.pressSequentially('o');
    assert.equal(await rich.textContent(), 'আমি হি ভালো');
  });
  await t.test('password typing stays native', async () => {
    await type('#password', 'ami');
    assert.equal(await field('#password').inputValue(), 'ami');
  });
  await t.test('real extension icons load and suggestions start with their default preference', async () => {
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.version, '1.1.1');
    assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
    assert.equal(await popup.locator('.brand-mark').evaluate(image => image.complete && image.naturalWidth === 48), true);
    assert.equal(await popup.locator('#suggestions').isChecked(), true);
  });
  async function endOf(selector, child) {
    await field(selector).focus();
    await field(selector).evaluate((element, childSelector) => {
      const range = document.createRange();
      range.selectNodeContents(childSelector ? element.querySelector(childSelector) : element);
      range.collapse(false);
      const scope = element.getRootNode();
      const selection = scope.getSelection?.() || document.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
    }, child);
  }
  await t.test('paragraph fields retain both blocks while typing and backspacing', async () => {
    await endOf('#blocks', 'p:first-child');
    await field('#blocks').pressSequentially('ami');
    assert.equal(await field('#blocks p:first-child').textContent(), 'First line: আমি');
    assert.equal(await field('#blocks p:last-child').textContent(), 'Second line: ');
    await endOf('#blocks', 'p:last-child');
    await field('#blocks').pressSequentially('kha');
    await field('#blocks').press('Backspace');
    assert.equal(await field('#blocks p:last-child').textContent(), 'Second line: খ');
    assert.equal(await field('#blocks p').count(), 2);
    await field('#blocks').press('Enter');
    await field('#blocks').pressSequentially('bangla');
    assert.equal(await field('#blocks p').count(), 3);
    assert.equal(await field('#blocks p:last-child').textContent(), 'বাংলা');
  });
  await t.test('BR-based and initially empty composers transliterate', async () => {
    await endOf('#breaks');
    await field('#breaks').pressSequentially('ami');
    assert.equal(await field('#breaks').textContent(), 'BeforeAfter আমি');
    assert.equal(await field('#breaks br').count(), 1);
    await endOf('#empty-rich');
    await field('#empty-rich').pressSequentially('ami bangla');
    assert.equal(await field('#empty-rich').textContent(), 'আমি বাংলা');
    await field('#empty-rich').press('Backspace');
    assert.equal(await field('#empty-rich').textContent(), 'আমি বাংল');
  });
  await t.test('mention widgets and dynamically mounted fields retain correct editing', async () => {
    await endOf('#widget-rich');
    await field('#widget-rich').pressSequentially('ami');
    assert.equal(await field('#widget-rich [contenteditable=false]').textContent(), '@Mention');
    assert.equal(await field('#widget-rich').textContent(), '@Mention Type here: আমি');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'dynamic-field';
      document.body.append(input);
    });
    await type('#dynamic-field', 'tumi');
    assert.equal(await field('#dynamic-field').inputValue(), 'তুমি');
  });
  await t.test('open shadow inputs and contenteditable keep independent carets', async () => {
    await page.evaluate(() => {
      const host = document.createElement('section'); host.id = 'shadow-fields';
      const shadow = host.attachShadow({ mode: 'open' });
      const input = document.createElement('input'); input.id = 'shadow-input';
      const rich = document.createElement('div'); rich.id = 'shadow-rich';
      rich.contentEditable = 'true'; rich.style.cssText = 'min-height:40px;white-space:pre-wrap;border:1px solid';
      shadow.append(input, rich); document.body.append(host);
    });
    await type('#shadow-input', 'ami bangla');
    assert.equal(await field('#shadow-input').inputValue(), 'আমি বাংলা');
    await endOf('#shadow-rich');
    await field('#shadow-rich').pressSequentially('kha');
    assert.equal(await field('#shadow-rich').textContent(), 'খা');
    await field('#shadow-rich').press('Backspace');
    assert.equal(await field('#shadow-rich').textContent(), 'খ');
  });
  await t.test('about-srcdoc iframe inputs and rich-text composers receive the content script', async () => {
    await page.evaluate(() => {
      const iframe = document.createElement('iframe'); iframe.id = 'frame-fields';
      iframe.srcdoc = '<textarea id="frame-area"></textarea><div id="frame-rich" contenteditable="true"><p><br></p></div>';
      document.body.append(iframe);
    });
    const frame = page.frameLocator('#frame-fields');
    const area = frame.locator('#frame-area');
    await area.waitFor();
    await area.pressSequentially('ami');
    assert.equal(await area.inputValue(), 'আমি');
    const rich = frame.locator('#frame-rich');
    await rich.focus(); await rich.press('ControlOrMeta+End');
    await rich.pressSequentially('bangla');
    assert.equal(await rich.textContent(), 'বাংলা');
  });
  const options = () => field('[data-shobdo-suggestions] [role=option]');
  await t.test('local completion and misspelling suggestions accept using Tab or a click', async () => {
    await seed('#area', 'Keep English: ');
    await type('#area', 'banlga');
    await options().first().waitFor();
    assert.match(await options().first().textContent(), /বাংলা/);
    await field('#area').press('Tab');
    assert.equal(await field('#area').inputValue(), 'Keep English: বাংলা');
    assert.equal(await field('[data-shobdo-suggestions]').count(), 0);
    assert.equal(await field('#area').evaluate(element => document.activeElement === element), true);
    await field('#area').pressSequentially(' bhlo');
    await options().first().waitFor();
    assert.match(await options().first().textContent(), /ভালো/);
    await options().first().click();
    assert.equal(await field('#area').inputValue(), 'Keep English: বাংলা ভালো');
    await field('#area').pressSequentially(' ban');
    await field('#area').press('Tab');
    assert.equal(await field('#area').inputValue(), 'Keep English: বাংলা ভালো বাংলা');
  });
  await t.test('suggestion navigation, dismissal, settings and raw English preserve native controls', async () => {
    await seed('#area', '');
    await type('#area', 'am');
    await options().first().waitFor();
    assert.ok(await options().count() > 1);
    await field('#area').press('ArrowDown');
    // Read the actual highlighted candidate rather than hardcoding ambiguous ranks.
    const selected = await page.locator('[data-shobdo-suggestions] [role=option][aria-selected=true]').textContent();
    await field('#area').press('Tab');
    assert.ok(selected.startsWith(await field('#area').inputValue()));
    await seed('#area', '');
    await type('#area', 'ami');
    await field('#area').press('Escape');
    assert.equal(await field('[data-shobdo-suggestions]').count(), 0);
    assert.equal(await field('#area').inputValue(), 'আমি');
    await popup.locator('#suggestions').uncheck();
    await settled();
    await seed('#area', '');
    await type('#area', 'banlga');
    assert.equal(await field('[data-shobdo-suggestions]').count(), 0);
    await field('#area').press('Tab');
    assert.equal(await field('#area').evaluate(element => document.activeElement === element), false);
    await popup.locator('#suggestions').check();
    await settled();
    await seed('#area', '');
    await type('#area', '`React');
    assert.equal(await field('#area').inputValue(), 'React');
    assert.equal(await field('[data-shobdo-suggestions]').count(), 0);
  });
  await t.test('actual React controlled input and textarea state keep translated values after rerender', async () => {
    const managed = await context.newPage();
    try {
      await managed.goto(url + 'managed');
      await managed.waitForFunction(() => window.editorsReady && document.getElementById('react-input'));
      for (const [selector, property] of [['#react-input', 'reactText'], ['#react-area', 'reactArea']]) {
        await managed.locator(selector).pressSequentially('ami bangla');
        assert.equal(await managed.locator(selector).inputValue(), 'আমি বাংলা');
        assert.equal(await managed.evaluate(key => window[key], property), 'আমি বাংলা');
        await managed.locator(selector).press('Escape');
        await managed.locator('#react-render').click();
        assert.equal(await managed.locator(selector).inputValue(), 'আমি বাংলা');
      }
    } finally { await managed.close(); }
  });
  await t.test('Enter retains native form submission while the suggestion panel is open', async () => {
    await page.evaluate(() => {
      const form = document.createElement('form');
      const input = document.createElement('input'); input.id = 'enter-field';
      form.append(input); document.body.append(form);
      window.formSubmissions = 0;
      form.addEventListener('submit', event => { event.preventDefault(); window.formSubmissions++; });
    });
    await type('#enter-field', 'ami');
    await options().first().waitFor();
    await field('#enter-field').press('Enter');
    assert.equal(await page.evaluate(() => window.formSubmissions), 1);
    assert.equal(await field('#enter-field').inputValue(), 'আমি');
    assert.equal(await field('[data-shobdo-suggestions]').count(), 0);
  });
  await t.test('actual ProseMirror document model follows native translated editing and suggestions', async () => {
    const managed = await context.newPage();
    try {
      await managed.goto(url + 'managed');
      await managed.waitForFunction(() => window.editorsReady);
      const editor = managed.locator('.ProseMirror');
      await editor.focus();
      await editor.pressSequentially('ami bangla');
      await managed.waitForFunction(() => window.editorView.state.doc.textContent === 'আমি বাংলা');
      assert.equal(await editor.textContent(), 'আমি বাংলা');
      await editor.press('Backspace');
      await managed.waitForFunction(() => window.editorView.state.doc.textContent === 'আমি বাংল');
      await editor.pressSequentially(' banlga');
      await editor.press('Tab');
      await managed.waitForFunction(() => window.editorView.state.doc.textContent === 'আমি বাংল বাংলা');
      await managed.evaluate(() => window.editorView.updateState(window.editorView.state));
      assert.equal(await editor.textContent(), 'আমি বাংল বাংলা');
    } finally { await managed.close(); }
  });
  await t.test('React rich-text DOM rebuilding composes ami, hi and valo without reversing them', async () => {
    const managed = await context.newPage();
    try {
      await managed.goto(url + 'managed');
      await managed.waitForFunction(() => window.socialEditorsReady && document.getElementById('react-rich'), null, { timeout: 5000 });
      const editor = managed.locator('#react-rich');
      await editor.focus(); await editor.pressSequentially('ami hi valo');
      assert.equal(await editor.textContent(), 'আমি হি ভালো');
      assert.equal(await managed.evaluate(() => window.controlledRichText), 'আমি হি ভালো');
      await editor.press('Backspace');
      assert.equal(await managed.evaluate(() => window.controlledRichText), 'আমি হি ভাল');
    } finally { await managed.close(); }
  });
  await t.test('actual Lexical composer retains Bangla in its document state', async () => {
    const managed = await context.newPage();
    try {
      await managed.goto(url + 'managed');
      await managed.waitForFunction(() => window.socialEditorsReady, null, { timeout: 5000 });
      const editor = managed.locator('#lexical-root');
      await editor.focus(); await editor.pressSequentially('ami hi valo');
      assert.equal(await editor.textContent(), 'আমি হি ভালো');
      assert.equal(await managed.evaluate(() => window.readLexicalText()), 'আমি হি ভালো');
      assert.deepEqual(await managed.evaluate(() => window.lexicalErrors), []);
      await editor.press('Backspace');
      assert.equal(await managed.evaluate(() => window.readLexicalText()), 'আমি হি ভাল');
    } finally { await managed.close(); }
  });
  await t.test('actual Draft.js composer retains Bangla in its document state', async () => {
    const managed = await context.newPage();
    try {
      await managed.goto(url + 'managed');
      await managed.waitForFunction(() => window.socialEditorsReady && document.querySelector('#draft-root [contenteditable]'), null, { timeout: 5000 });
      const editor = managed.locator('#draft-root [contenteditable=true]');
      await editor.focus(); await editor.pressSequentially('ami hi valo');
      assert.equal(await editor.textContent(), 'আমি হি ভালো');
      assert.equal(await managed.evaluate(() => window.draftEditorState.getCurrentContent().getPlainText()), 'আমি হি ভালো');
      await editor.press('Backspace');
      assert.equal(await managed.evaluate(() => window.draftEditorState.getCurrentContent().getPlainText()), 'আমি হি ভাল');
    } finally { await managed.close(); }
  });
  await t.test('settings persist across an actual browser restart', async () => {
    await page.screenshot({ path: path.join(output, 'playground.png'), fullPage: true });
    await popup.setViewportSize({ width: 400, height: 640 });
    await popup.screenshot({ path: path.join(output, 'popup.png'), fullPage: true });
    await popup.locator('#suggestions').uncheck();
    await settled();
    await context.close();
    context = null;
    ({ page, popup, worker } = await launch());
    assert.equal(await popup.locator('#mode-bangla').isChecked(), true);
    assert.equal(await popup.locator('#enabled').isChecked(), true);
    assert.equal(await popup.locator('#suggestions').isChecked(), false);
    await type('#area', 'ami');
    assert.equal(await field('#area').inputValue(), 'আমি');
    assert.equal(await field('[data-shobdo-suggestions]').count(), 0);
  });
  await t.test('no extension/page JavaScript errors', () => {
    assert.deepEqual(errors, []);
  });
});
