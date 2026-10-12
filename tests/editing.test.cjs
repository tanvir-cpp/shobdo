'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
const words = { k: 'ক', kh: 'খ', kha: 'খা', khan: 'খান', a: 'আ', am: 'আম',
  ami: 'আমি', amI: 'আমি', hi: 'হি', b: 'ব', ba: 'বা', bangla: 'বাংলা' };
const transliterate = text => words[text] || [...text].map(c => ({
  a: 'আ', b: 'ব', g: 'গ', h: 'হ', i: 'ই', k: 'ক', l: 'ল', n: 'ন', m: 'ম',
})[c.toLowerCase()] || c).join('');

async function setup(markup = '<textarea></textarea>', initial = {},
  { realDependencies = false, deferredRead = false, suggestions = false,
    nativeRich = false, mount = null } = {}) {
  const dom = new JSDOM(markup, { runScripts: 'outside-only', url: 'https://example.test/' });
  const { window } = dom;
  let settings = { enabled: true, mode: 'english', ...initial };
  let subscriber;
  const initialSettings = { ...settings };
  let finishRead;
  const deferred = deferredRead ? new Promise(resolve => {
    finishRead = () => resolve(initialSettings);
  }) : null;
  window.ShobdoEngine = { transliterate };
  window.ShobdoSettings = {
    read: async () => deferred || { ...settings },
    subscribe: callback => { subscriber = callback; return () => {}; },
    update: async patch => {
      settings = { ...settings, ...patch };
      subscriber?.({ ...settings });
      return { ...settings };
    },
  };
  let panel;
  if (suggestions) {
    const host = window.document.createElement('div');
    host.setAttribute('data-shobdo-suggestions', '');
    const shadow = host.attachShadow({ mode: 'open' });
    const button = window.document.createElement('button');
    button.textContent = 'candidate';
    shadow.append(button);
    window.document.body.append(host);
    window.ShobdoSuggestions = { create(onAccept) {
      panel = { host, button, shown: null, shows: [], hides: 0, keys: [],
        candidate: { text: 'আমিই', latin: 'amii', kind: 'phonetic' },
        show(value) { this.shown = value; this.shows.push(value); },
        hide() { this.shown = null; this.hides += 1; },
        accept(candidate = this.candidate) { onAccept(candidate); },
        handleKey(event) {
          this.keys.push(event.key);
          if (!this.shown || event.ctrlKey || event.metaKey || event.altKey) return false;
          if (event.key === 'Tab') { this.accept(); return true; }
          if (event.key === 'Escape') { this.hide(); return true; }
          return ['ArrowUp', 'ArrowDown'].includes(event.key);
        },
      };
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => panel.accept());
      return panel;
    } };
  }
  if (realDependencies) {
    const listeners = new Set();
    window.chrome = { storage: {
      local: {
        get: async key => ({ [key]: { ...settings } }),
        set: async value => {
          const oldValue = settings;
          settings = { ...value.shobdoSettings };
          for (const listener of listeners)
            listener({ shobdoSettings: { oldValue, newValue: settings } }, 'local');
        },
      },
      onChanged: {
        addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener),
      },
    } };
    for (const filename of ['vendor/avro.js', 'vendor/autodict.js', 'engine.js', 'suggestions.js', 'settings.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', filename), 'utf8'),
        dom.getInternalVMContext(), { filename });
    }
  }
  vm.runInContext(source, dom.getInternalVMContext(), { filename: 'content.js' });
  await new Promise(resolve => setImmediate(resolve));
  const root = mount ? mount(window) : window.document.querySelector('textarea,input,[contenteditable]');
  root.focus();
  const field = root.tagName === 'INPUT' || root.tagName === 'TEXTAREA';
  const tree = root.getRootNode();
  // jsdom does not implement native shadow selections. Provide the same scoped
  // selection API Chrome exposes, while retaining real DOM Range operations.
  if (tree.host) {
    let ranges = [];
    tree.getSelection = () => ({
      get rangeCount() { return ranges.length; },
      getRangeAt: index => ranges[index],
      removeAllRanges: () => { ranges = []; },
      addRange: range => { ranges = [range]; },
    });
  }
  const getSelection = () => tree.getSelection?.() || window.getSelection();
  function text() { return field ? root.value : root.textContent; }
  function point(offset) {
    const walker = window.document.createTreeWalker(root, 4);
    let node;
    while ((node = walker.nextNode())) {
      if (offset <= node.data.length) return [node, offset];
      offset -= node.data.length;
    }
    return [root, root.childNodes.length];
  }
  function select(start, end = start, changed = false) {
    if (field) {
      try { root.setSelectionRange(start, end); } catch (_) { /* Unsupported input type. */ }
    } else {
      const range = window.document.createRange();
      range.setStart(...point(start));
      range.setEnd(...point(end));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (changed) window.document.dispatchEvent(new window.Event('selectionchange'));
  }
  function selection() {
    if (field) return [root.selectionStart, root.selectionEnd];
    const range = getSelection().getRangeAt(0);
    const prefix = window.document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    prefix.setEnd(range.endContainer, range.endOffset);
    return [start, prefix.toString().length];
  }
  function selectNode(node, start, end = start, endNode = node, changed = true) {
    const range = window.document.createRange();
    range.setStart(node, start);
    range.setEnd(endNode, end);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (changed) window.document.dispatchEvent(new window.Event('selectionchange'));
  }
  const commands = [];
  if (nativeRich) {
    window.document.execCommand = (command, ui, value) => {
      commands.push({ command, value });
      assert.ok(['insertText', 'delete'].includes(command));
      const inputType = command === 'delete' ? 'deleteContentBackward' : 'insertText';
      const data = command === 'delete' ? null : value;
      const selection = getSelection();
      const range = selection.getRangeAt(0).cloneRange();
      const placeholder = range.collapsed && range.startContainer.nodeType === 1
        && range.startContainer.childNodes.length === 1
        && range.startContainer.firstChild.tagName === 'BR' ? range.startContainer.firstChild : null;
      const before = new window.InputEvent('beforeinput', { bubbles: true, composed: true,
        cancelable: true, inputType, data });
      if (!root.dispatchEvent(before)) return false;
      range.deleteContents();
      if (value) {
        const node = window.document.createTextNode(value);
        range.insertNode(node);
        range.setStartAfter(node);
      }
      placeholder?.remove();
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      root.dispatchEvent(new window.InputEvent('input', { bubbles: true, composed: true,
        inputType, data }));
      return true;
    };
  }
  function nativeReplace(data, inputType) {
    let [start, end] = selection();
    if (start === null) {
      // These types have no text selection API; the extension must leave them native.
      root.value += data || '';
      return;
    }
    if (inputType === 'deleteContentBackward' && start === end && start > 0) {
      start -= 1;
      const code = text().charCodeAt(start);
      if (code >= 0xDC00 && code <= 0xDFFF && start > 0) start -= 1;
    }
    if (inputType === 'deleteContentForward' && start === end) end += 1;
    const value = inputType.startsWith('delete') ? '' : data || '';
    if (field) root.setRangeText(value, start, end, 'end');
    else {
      const range = getSelection().getRangeAt(0).cloneRange();
      if (inputType.startsWith('delete')) {
        range.setStart(...point(start));
        range.setEnd(...point(end));
      }
      range.deleteContents();
      if (value) {
        const node = window.document.createTextNode(value);
        range.insertNode(node);
        range.setStartAfter(node);
      }
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function edit(data, inputType = 'insertText', options = {}) {
    let before;
    if (!options.noBefore) {
      before = new window.InputEvent('beforeinput', { bubbles: true, composed: true,
        cancelable: options.cancelable !== false, inputType, data,
        isComposing: !!options.isComposing });
      root.dispatchEvent(before);
    }
    if (!before?.defaultPrevented) {
      nativeReplace(data, inputType);
      root.dispatchEvent(new window.InputEvent('input', { bubbles: true, composed: true,
        inputType, data, isComposing: !!options.isComposing }));
    }
    return before;
  }
  function type(value, options) { for (const character of value) edit(character, 'insertText', options); }
  select(text().length);
  return { dom, window, root, text, select, selectNode, selection, edit, type, finishRead,
    panel, commands,
    mode: patch => window.ShobdoSettings.update(patch) };
}

test('default English is native; persisted mode and enabled changes take effect', async t => {
  const page = await setup();
  t.after(() => page.dom.window.close());
  page.type('ami ');
  assert.equal(page.text(), 'ami ');
  await page.mode({ mode: 'bangla' });
  page.type('ami ');
  assert.equal(page.text(), 'ami আমি ');
  await page.mode({ enabled: false });
  page.type('ami');
  assert.equal(page.text(), 'ami আমি ami');
});

test('a live settings change wins over a stale initial storage read', async t => {
  const page = await setup('<textarea></textarea>', {}, { deferredRead: true });
  t.after(() => page.dom.window.close());
  await page.mode({ mode: 'bangla' });
  page.finishRead();
  await new Promise(resolve => setImmediate(resolve));
  page.type('ami');
  assert.equal(page.text(), 'আমি');
});

test('each Latin keystroke rerenders the active word and backspace removes Latin keystrokes', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const events = [];
  page.window.document.addEventListener('input', event => {
    events.push({ text: page.text(), type: event.inputType, data: event.data });
  });
  for (const [key, expected] of [['k', 'ক'], ['h', 'খ'], ['a', 'খা']]) {
    assert.equal(page.edit(key).defaultPrevented, true);
    assert.equal(page.text(), expected);
    assert.deepEqual(page.selection(), [expected.length, expected.length]);
  }
  for (const expected of ['খ', 'ক', '']) {
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), expected);
    assert.deepEqual(page.selection(), [expected.length, expected.length]);
  }
  assert.equal(events.length, 6, 'one bubbling input notification per edit');
  assert.deepEqual(events.map(event => event.text), ['ক', 'খ', 'খা', 'খ', 'ক', '']);
  assert.equal(events[5].data, null);
});

test('existing text, spaces, punctuation and mixed language are preserved', async t => {
  const page = await setup('<textarea>Existing বাংলা: </textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.type('ami! bangla.');
  assert.equal(page.text(), 'Existing বাংলা: আমি! বাংলা.');
  await page.mode({ mode: 'english' });
  page.type(' React');
  await page.mode({ mode: 'bangla' });
  page.type(' ami');
  assert.equal(page.text(), 'Existing বাংলা: আমি! বাংলা. React আমি');
});

test('text/search inputs replace a selected word without changing surrounding text', async t => {
  for (const type of ['text', 'search']) {
    const page = await setup(`<input type="${type}" value="Before old after">`, { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    page.select(7, 10, true);
    page.type('ami');
    assert.equal(page.text(), 'Before আমি after');
    assert.deepEqual(page.selection(), [10, 10]);
    page.select(7, 10, true);
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), 'Before  after', 'selected Bangla is deleted natively');
  }
});

test('moving the caret or selecting text commits the active word', async t => {
  const page = await setup('<textarea>prefix </textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.type('kha');
  page.select(7, 7, true);
  page.type('ami ');
  assert.equal(page.text(), 'prefix আমি খা');
  page.select(page.text().length, page.text().length, true);
  page.root.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'prefix আমি খ', 'old text uses native deletion, not an old Latin buffer');
});

test('switching mode clears the buffer but retains already-rendered Bangla', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.type('k');
  await page.mode({ mode: 'english' });
  page.type('h');
  await page.mode({ mode: 'bangla' });
  page.type('a');
  assert.equal(page.text(), 'কhআ');
});

test('backtick escapes one Latin word and is consumed on its first letter', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.type('`');
  assert.equal(page.text(), '`');
  page.type('React');
  assert.equal(page.text(), 'React');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'Reac');
  page.type('t,ami ');
  assert.equal(page.text(), 'React,আমি ');
  page.type('`a');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'React,আমি `', 'deleting the first raw letter restores its prefix');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'React,আমি ');
});

test('a multi-character text insertion converts only that insertion and tracks its last word', async t => {
  const page = await setup('<textarea>Keep English </textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.edit('ami, `React kha');
  assert.equal(page.text(), 'Keep English আমি, React খা');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'Keep English আমি, React খ');
});

test('noncancelable beforeinput and input-only fallback use the Latin composition buffer', async t => {
  for (const options of [{ cancelable: false }, { noBefore: true }]) {
    const page = await setup('<textarea>old </textarea>', { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    let events = 0;
    page.root.addEventListener('input', () => { events += 1; });
    page.type('kha', options);
    assert.equal(page.text(), 'old খা');
    page.edit(null, 'deleteContentBackward', options);
    assert.equal(page.text(), 'old খ');
    assert.deepEqual(page.selection(), [5, 5]);
    assert.equal(events, 4, 'fallback does not duplicate the native input notification');
  }
});

test('input fallback replaces selected text and never scans unrelated existing text', async t => {
  const page = await setup('<textarea>old English tail</textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.select(4, 11, true);
  page.edit('ami', 'insertText', { cancelable: false });
  assert.equal(page.text(), 'old আমি tail');
});

test('IME composition and pasted text remain native', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.root.dispatchEvent(new page.window.CompositionEvent('compositionstart', { bubbles: true }));
  page.type('kha', { isComposing: true });
  assert.equal(page.text(), 'kha');
  page.root.dispatchEvent(new page.window.CompositionEvent('compositionend', { bubbles: true, data: 'kha' }));
  page.root.dispatchEvent(new page.window.InputEvent('input', { bubbles: true,
    inputType: 'insertText', data: 'kha' }));
  assert.equal(page.text(), 'kha', 'an IME final input after compositionend stays native');
  page.edit(' ', 'insertText');
  page.edit('English বাংলা', 'insertFromPaste');
  assert.equal(page.text(), 'kha English বাংলা');
  page.type(' ami');
  assert.equal(page.text(), 'kha English বাংলা আমি');
});

test('sensitive, unsupported, readonly and disabled fields are not intercepted', async t => {
  for (const attributes of ['type="password"', 'type="email"', 'type="url"',
    'type="number"', 'type="text" readonly', 'type="text" disabled']) {
    const page = await setup(`<input ${attributes}>`, { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    const before = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
      data: 'ami', inputType: 'insertText' });
    page.root.dispatchEvent(before);
    assert.equal(before.defaultPrevented, false, attributes);
    assert.equal(page.text(), '', attributes);
  }
});

test('a text input inside a disabled fieldset is left native', async t => {
  const page = await setup('<fieldset disabled><input type="text"></fieldset>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertText', data: 'ami' });
  page.root.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(page.text(), '');
});

test('basic contenteditable handles nested text and preserves unrelated DOM identities', async t => {
  const page = await setup('<div contenteditable="true" tabindex="0"><b>Keep </b><span><em>old</em></span><i> tail</i></div>',
    { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const before = page.root.querySelector('b');
  const after = page.root.querySelector('i');
  const existingText = before.firstChild;
  const replacedText = page.root.querySelector('em').firstChild;
  page.select(5, 8, true);
  page.type('kha');
  assert.equal(page.text(), 'Keep খা tail');
  assert.deepEqual(page.selection(), [7, 7]);
  assert.equal(page.root.querySelector('b'), before);
  assert.equal(before.firstChild, existingText);
  assert.equal(page.root.querySelector('i'), after);
  assert.equal(replacedText.isConnected, true);
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'Keep খ tail');
});

test('basic contenteditable can replace a selection spanning inline nodes', async t => {
  const page = await setup('<div contenteditable="true" tabindex="0"><span>one </span><b>two</b><i> tail</i></div>',
    { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const tail = page.root.querySelector('i');
  page.select(2, 7, true);
  page.type('ami');
  assert.equal(page.text(), 'onআমি tail');
  assert.equal(page.root.querySelector('i'), tail);
  assert.deepEqual(page.selection(), [5, 5]);
});

test('empty contenteditable and nested text targets work', async t => {
  const page = await setup('<div contenteditable="true" tabindex="0"></div>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.type('ami');
  assert.equal(page.text(), 'আমি');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'আম');
  const target = page.root.firstChild;
  const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertText', data: 'i' });
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(page.text(), 'আমি');
});

test('model-owned editors without a native command, canvas and uneditable hosts remain native', async t => {
  for (const markup of [
    '<div contenteditable="true" class="ProseMirror">one</div>',
    '<div contenteditable="true" data-lexical-editor="true">one</div>',
    '<div contenteditable="false">one</div>',
    '<div contenteditable="true" aria-readonly="true">one</div>',
    '<canvas contenteditable="true">one</canvas>',
  ]) {
    const page = await setup(markup, { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    const old = page.text();
    const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
      inputType: 'insertText', data: 'ami' });
    page.root.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, markup);
    assert.equal(page.text(), old, markup);
  }
});

test('multiline P/DIV/BR hosts compose locally and preserve other lines', async t => {
  for (const markup of [
    '<div contenteditable="true"><p>Keep English</p><p>old</p><p>বাংলা tail</p></div>',
    '<div contenteditable="true"><div>Keep English</div><div>old</div><div>বাংলা tail</div></div>',
    '<div contenteditable="true">Keep English<br><span>old</span><br>বাংলা tail</div>',
  ]) {
    const page = await setup(markup, { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    const old = page.root.children[1].firstChild;
    const first = page.root.firstChild;
    const last = page.root.lastChild;
    const breaks = [...page.root.querySelectorAll('br')];
    page.selectNode(old, 0, 3);
    page.type('kha');
    assert.equal(page.text(), 'Keep Englishখাবাংলা tail');
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), 'Keep Englishখবাংলা tail');
    page.type('a,`React');
    assert.equal(page.text(), 'Keep Englishখা,Reactবাংলা tail');
    assert.equal(page.root.firstChild, first);
    assert.equal(page.root.lastChild, last);
    assert.deepEqual([...page.root.querySelectorAll('br')], breaks);
  }
});

test('initial BR placeholders and empty nested blocks allow composition', async t => {
  for (const markup of [
    '<div contenteditable="true"><br></div>',
    '<div contenteditable="true"><p><br></p></div>',
    '<div contenteditable="true"><div></div></div>',
  ]) {
    const page = await setup(markup, { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    const line = page.root.querySelector('p,div') || page.root;
    page.selectNode(line, 0);
    page.type('kha');
    assert.equal(page.text(), 'খা');
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), 'খ');
    assert.equal(page.root.querySelector('p,div') || page.root, line);
  }
});

test('BR and block boundaries never become part of a selected composition', async t => {
  for (const markup of [
    '<div contenteditable="true"><p>one</p><p>two</p></div>',
    '<div contenteditable="true"><span>one</span><br><span>two</span></div>',
  ]) {
    const page = await setup(markup, { mode: 'bangla' });
    t.after(() => page.dom.window.close());
    const first = page.root.firstChild.firstChild;
    const last = page.root.lastChild.firstChild;
    page.selectNode(first, 1, 2, last);
    const before = page.root.innerHTML;
    const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
      inputType: 'insertText', data: 'ami' });
    page.root.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(page.root.innerHTML, before);
  }
});

test('noneditable widgets are preserved while adjacent editable text works', async t => {
  const page = await setup('<div contenteditable="true"><span>one </span>'
    + '<span contenteditable="false"><b>widget</b></span><span> tail</span></div>',
  { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const widget = page.root.children[1];
  const widgetText = widget.firstChild.firstChild;
  const tail = page.root.lastChild.firstChild;
  page.selectNode(tail, 1);
  page.type('ami ');
  assert.equal(page.text(), 'one widget আমি tail');
  assert.equal(page.root.children[1], widget);
  assert.equal(widget.firstChild.firstChild, widgetText);
  const before = page.root.innerHTML;
  for (const select of [
    () => page.selectNode(widgetText, 2),
    () => page.selectNode(page.root.firstChild.firstChild, 1, 2, tail),
  ]) {
    select();
    const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
      inputType: 'insertText', data: 'ami' });
    page.root.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(page.root.innerHTML, before);
  }
  const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertText', data: 'ami' });
  widgetText.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'events inside a false island are not inherited');
});

test('inherited and explicitly nested editable text share a local active word', async t => {
  const page = await setup('<div contenteditable="true"><p>Keep </p>'
    + '<p><span contenteditable="true"><em>old</em></span></p></div>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const nested = page.root.querySelector('em');
  page.selectNode(nested.firstChild, 0, 3);
  for (const key of 'kha') {
    const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
      inputType: 'insertText', data: key });
    nested.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(page.text(), 'Keep খা');
  assert.equal(page.root.querySelector('em'), nested);
});

test('a true editing host inside a false island is independently editable', async t => {
  const page = await setup('<div contenteditable="true"><span contenteditable="false">widget '
    + '<span contenteditable="true">old</span></span></div>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const nested = page.root.querySelector('[contenteditable="false"] [contenteditable="true"]');
  page.selectNode(nested.firstChild, 0, 3);
  const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertText', data: 'ami' });
  nested.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(page.text(), 'widget আমি');
});

test('fields mounted after the script loads work through delegated listeners', async t => {
  const page = await setup('<main></main>', { mode: 'bangla' }, { mount(window) {
    const field = window.document.createElement('textarea');
    field.value = 'Keep ';
    window.document.querySelector('main').append(field);
    return field;
  } });
  t.after(() => page.dom.window.close());
  page.type('kha');
  assert.equal(page.text(), 'Keep খা');
});

test('open shadow inputs and rich text use composed targets and scoped selection', async t => {
  for (const markup of ['<input type="text" value="Keep ">',
    '<div contenteditable="true"><p>Keep </p><p><br></p></div>']) {
    const page = await setup('<div id="host"></div>', { mode: 'bangla' }, { mount(window) {
      const shadow = window.document.querySelector('#host').attachShadow({ mode: 'open' });
      shadow.innerHTML = markup;
      return shadow.firstChild;
    } });
    t.after(() => page.dom.window.close());
    if (page.root.tagName !== 'INPUT') page.selectNode(page.root.lastChild, 0);
    page.type('kha');
    assert.equal(page.text(), 'Keep খা');
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), 'Keep খ');
  }
});

test('native rich insertion notifies a model-driven editor without duplicate input', async t => {
  for (const attributes of ['class="ProseMirror"', 'class="ql-editor"',
    'data-slate-editor="true"', 'data-lexical-editor="true"', 'data-contents="true"']) {
    const page = await setup(`<div contenteditable="true" ${attributes}><p>Keep </p><p>old</p></div>`,
      { mode: 'bangla' }, { nativeRich: true });
    t.after(() => page.dom.window.close());
    const keep = page.root.firstChild;
    let model;
    let notifications = 0;
    page.root.addEventListener('input', () => { model = page.text(); notifications += 1; });
    page.selectNode(page.root.lastChild.firstChild, 0, 3);
    page.type('kha');
    page.edit(null, 'deleteContentBackward');
    assert.equal(model, 'Keep খ');
    assert.equal(notifications, 4);
    assert.equal(page.commands.length, 4);
    assert.equal(page.root.firstChild, keep);
  }
});

test('native placeholder normalization rebases the active word', async t => {
  const page = await setup('<div class="ProseMirror" contenteditable="true"><p><br></p></div>',
    { mode: 'bangla' }, { nativeRich: true });
  t.after(() => page.dom.window.close());
  page.selectNode(page.root.firstChild, 0);
  page.type('kha');
  assert.equal(page.text(), 'খা');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'খ');
});

test('same-text native input rerenders keep the caret and Latin word in surrounding text', async t => {
  for (const [attributes, nativeRich] of [['', false], ['', true], ['class="ProseMirror"', true]]) {
    const page = await setup(`<div contenteditable="true" ${attributes}>Keep old tail</div>`,
      { mode: 'bangla' }, { nativeRich, suggestions: true });
    t.after(() => page.dom.window.close());
    let inputs = 0;
    page.root.addEventListener('input', () => {
      inputs += 1;
      page.root.replaceChildren(page.window.document.createTextNode(page.text()));
    });
    page.select(5, 8, true);
    for (const [key, expected] of [['a', 'আ'], ['m', 'আম'], ['i', 'আমি']]) {
      page.edit(key);
      assert.equal(page.text(), `Keep ${expected} tail`);
      assert.deepEqual(page.selection(), [5 + expected.length, 5 + expected.length]);
    }
    assert.equal(page.panel.shown.latin, 'ami');
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), 'Keep আম tail');
    assert.deepEqual(page.selection(), [7, 7]);
    page.edit('i');
    page.panel.accept();
    assert.equal(page.text(), 'Keep আমিই tail');
    assert.deepEqual(page.selection(), [9, 9]);
    assert.equal(page.panel.shown, null);
    page.edit('h');
    page.edit('i');
    assert.equal(page.text(), 'Keep আমিইহি tail', 'accepted word is committed; hi is one live word');
    assert.equal(inputs, 8, 'restoring a caret never adds an input notification');
  }
});

test('caret rebuilding remains local across blocks, widgets and open shadow roots', async t => {
  const markup = '<div contenteditable="true"><p>Keep English</p>'
    + '<p><b>Prefix </b><span id="word"><em>old</em></span><i> suffix</i></p>'
    + '<p><span contenteditable="false">widget</span><br>Tail</p></div>';
  for (const shadow of [false, true]) {
    const page = await setup(shadow ? '<div id="host"></div>' : markup, { mode: 'bangla' },
      { nativeRich: true, mount: shadow ? window => {
        const tree = window.document.querySelector('#host').attachShadow({ mode: 'open' });
        tree.innerHTML = markup;
        return tree.firstChild;
      } : null });
    t.after(() => page.dom.window.close());
    const span = page.root.querySelector('#word');
    const prefix = span.previousSibling;
    const suffix = span.nextSibling;
    const widget = page.root.querySelector('[contenteditable="false"]');
    const br = page.root.querySelector('br');
    page.root.addEventListener('input', () => {
      span.replaceChildren(page.window.document.createTextNode(span.textContent));
    });
    page.selectNode(span.firstChild.firstChild, 0, 3);
    page.type('ami');
    assert.equal(page.text(), 'Keep EnglishPrefix আমি suffixwidgetTail');
    assert.equal(span.textContent, 'আমি');
    page.edit(null, 'deleteContentBackward');
    assert.equal(span.textContent, 'আম');
    assert.equal(span.previousSibling, prefix);
    assert.equal(span.nextSibling, suffix);
    assert.equal(page.root.querySelector('[contenteditable="false"]'), widget);
    assert.equal(page.root.querySelector('br'), br);
    assert.equal(widget.textContent, 'widget');
  }
});

test('synchronous same-value input caret resets preserve words, backspace and suggestions', async t => {
  for (const markup of ['<input value="Keep old tail">', '<textarea>Keep old tail</textarea>']) {
    const page = await setup(markup, { mode: 'bangla' }, { suggestions: true });
    t.after(() => page.dom.window.close());
    page.root.addEventListener('input', () => {
      page.root.value = page.root.value;
      page.root.setSelectionRange(0, 0);
    });
    page.select(5, 8, true);
    page.type('ami');
    assert.equal(page.text(), 'Keep আমি tail');
    assert.deepEqual(page.selection(), [8, 8]);
    page.edit(null, 'deleteContentBackward');
    assert.equal(page.text(), 'Keep আম tail');
    page.edit('i');
    assert.equal(page.panel.shown.latin, 'ami');
    page.panel.accept();
    assert.equal(page.text(), 'Keep আমিই tail');
    assert.deepEqual(page.selection(), [9, 9]);
  }
});

test('bounded microtask same-text rerenders restore rich and input carets', async t => {
  for (const rich of [false, true]) {
    const page = await setup(rich ? '<div contenteditable="true">Keep old tail</div>'
      : '<input value="Keep old tail">', { mode: 'bangla' },
    { nativeRich: rich, suggestions: true });
    t.after(() => page.dom.window.close());
    page.root.addEventListener('input', () => {
      page.window.queueMicrotask(() => page.window.queueMicrotask(() => {
        if (rich) page.root.replaceChildren(page.window.document.createTextNode(page.text()));
        else { page.root.value = page.root.value; page.root.setSelectionRange(0, 0); }
      }));
    });
    page.select(5, 8, true);
    for (const key of 'ami') {
      page.edit(key);
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(page.text(), 'Keep আমি tail');
    assert.deepEqual(page.selection(), [8, 8]);
    assert.equal(page.panel.shown.latin, 'ami');
    page.edit(null, 'deleteContentBackward');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.text(), 'Keep আম tail');
    assert.deepEqual(page.selection(), [7, 7]);
    page.edit('i');
    await new Promise(resolve => setImmediate(resolve));
    page.panel.accept();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.text(), 'Keep আমিই tail');
    assert.deepEqual(page.selection(), [9, 9]);
  }
});

test('native spaces and punctuation keep word order through captured-text microtask rerenders', async t => {
  for (const [attributes, deferred] of [['', false], ['', true], ['class="ProseMirror"', true]]) {
    const page = await setup(`<div contenteditable="true" ${attributes}></div>`,
      { mode: 'bangla' }, { nativeRich: true, suggestions: true });
    t.after(() => page.dom.window.close());
    let inputs = 0;
    page.root.addEventListener('input', () => {
      inputs += 1;
      const capturedText = page.text();
      const rebuild = () => {
        page.root.replaceChildren(page.window.document.createTextNode(capturedText));
      };
      if (deferred) page.window.queueMicrotask(() => page.window.queueMicrotask(rebuild));
      else rebuild();
    });
    for (const key of 'ami! hi bangla.') {
      const before = page.edit(key);
      if (/[ !.]/.test(key)) assert.equal(before.defaultPrevented, false, 'separators stay native');
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(page.selection(), [page.text().length, page.text().length], key);
      if (/[ !.]/.test(key)) assert.equal(page.panel.shown, null, 'a separator commits the Latin word');
    }
    assert.equal(page.text(), 'আমি! হি বাংলা.');
    assert.equal(inputs, 'ami! hi bangla.'.length, 'caret repair emits no additional input');
    assert.equal(page.commands.length, 'amihibangla'.length, 'managed separators never invoke a replacement command');
  }
});

test('native managed Enter restores an empty rebuilt paragraph caret without editing the model', async t => {
  const page = await setup('<div contenteditable="true" class="ProseMirror"><p>আমি</p></div>',
    { mode: 'bangla' }, { nativeRich: true });
  t.after(() => page.dom.window.close());
  const { document } = page.window;
  page.root.addEventListener('input', () => {
    const captured = page.root.innerHTML;
    page.window.queueMicrotask(() => page.window.queueMicrotask(() => { page.root.innerHTML = captured; }));
  });
  const before = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertParagraph', data: null });
  page.root.dispatchEvent(before);
  assert.equal(before.defaultPrevented, false);
  // Simulate the browser/model's native paragraph insertion, which jsdom does not implement.
  const paragraph = document.createElement('p');
  paragraph.append(document.createElement('br'));
  page.root.append(paragraph);
  page.selectNode(paragraph, 0);
  page.root.dispatchEvent(new page.window.InputEvent('input', { bubbles: true,
    inputType: 'insertParagraph', data: null }));
  await new Promise(resolve => setImmediate(resolve));
  const range = page.window.getSelection().getRangeAt(0);
  assert.notEqual(page.root.lastChild, paragraph, 'the site rebuilt the paragraph');
  assert.equal(range.startContainer, page.root.lastChild);
  assert.equal(range.startOffset, 0);
  assert.equal(range.collapsed, true);
  assert.equal(page.root.innerHTML, '<p>আমি</p><p><br></p>');
  assert.equal(page.commands.length, 0);
});

test('native newline caret repair preserves surrounding text without a managed replacement', async t => {
  for (const markup of ['<input value="Keep  tail">', '<textarea>Keep  tail</textarea>',
    '<div contenteditable="true" class="ProseMirror">Keep  tail</div>']) {
    const page = await setup(markup, { mode: 'bangla' }, { nativeRich: true });
    t.after(() => page.dom.window.close());
    const rich = page.root.tagName === 'DIV';
    page.root.addEventListener('input', () => {
      const capturedText = page.text();
      page.window.queueMicrotask(() => page.window.queueMicrotask(() => {
        if (rich) page.root.replaceChildren(page.window.document.createTextNode(capturedText));
        else { page.root.value = capturedText; page.root.setSelectionRange(0, 0); }
      }));
    });
    page.select(5, 5, true);
    page.edit('ami');
    await new Promise(resolve => setImmediate(resolve));
    // Single-line inputs cannot insert a newline, so exercise their native space instead.
    const newline = page.root.tagName === 'INPUT' ? ' ' : '\n';
    const type = newline === ' ' ? 'insertText' : 'insertLineBreak';
    assert.equal(page.edit(newline, type).defaultPrevented, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(page.selection(), [9, 9]);
    page.edit('hi');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.text(), `Keep আমি${newline}হি tail`);
    assert.equal(page.commands.length, rich ? 2 : 0);
  }
});

test('native separator repair is cancelled by navigation and leaves English, paste and IME native', async t => {
  for (const action of ['navigation', 'selection', 'text', 'english', 'paste', 'ime']) {
    const page = await setup('<div contenteditable="true">Keep </div>',
      { mode: action === 'english' ? 'english' : 'bangla' }, { nativeRich: true });
    t.after(() => page.dom.window.close());
    let intended;
    page.root.addEventListener('input', () => {
      const capturedText = page.text();
      page.window.queueMicrotask(() => page.window.queueMicrotask(() => {
        page.root.replaceChildren(page.window.document.createTextNode(capturedText));
        if (action === 'navigation') page.root.dispatchEvent(new page.window.KeyboardEvent('keydown',
          { key: 'ArrowLeft', bubbles: true }));
        if (['navigation', 'selection'].includes(action)) page.select(1, 1, true);
        if (action === 'text') page.root.textContent = 'site changed text';
        intended = page.selection();
      }));
    });
    const options = action === 'ime' ? { isComposing: true } : {};
    const type = action === 'paste' ? 'insertFromPaste' : 'insertText';
    assert.equal(page.edit(' ', type, options).defaultPrevented, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(page.selection(), intended, action);
    assert.equal(page.text(), action === 'text' ? 'site changed text' : 'Keep  ', action);
    assert.equal(page.commands.length, 0);
  }
});

test('late callback rerenders retain separator repairs through one task and the next keystroke', async t => {
  const page = await setup('<div contenteditable="true"></div>', { mode: 'bangla' }, { nativeRich: true });
  t.after(() => page.dom.window.close());
  page.root.addEventListener('input', () => {
    const captured = page.text();
    // Emulate a later propagation callback whose checkpoint comes after the
    // capture handler's two checks, as happens in Chromium rather than jsdom.
    const later = turns => page.window.queueMicrotask(() => {
      if (turns) later(turns - 1);
      else {
        page.root.replaceChildren(page.window.document.createTextNode(captured));
        page.window.document.dispatchEvent(new page.window.Event('selectionchange'));
      }
    });
    later(4);
  });
  for (const key of 'ami hi') {
    page.edit(key);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(page.selection(), [page.text().length, page.text().length]);
  }
  assert.equal(page.text(), 'আমি হি');
  page.edit(null, 'deleteContentBackward');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(page.text(), 'আমি হ');
  assert.equal(page.commands.at(-1).command, 'delete', 'an empty insertText is not a native deletion');
});

test('a pending repair does not fight deliberate movement on a surviving text anchor', async t => {
  const page = await setup('<div contenteditable="true">Keep </div>', { mode: 'bangla' },
    { nativeRich: true, suggestions: true });
  t.after(() => page.dom.window.close());
  page.edit('ami');
  page.select(6);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(page.selection(), [6, 6]);
  assert.equal(page.panel.shown, null);
});

test('successful native edits suppress the original Latin beforeinput but retain model input', async t => {
  const page = await setup('<div contenteditable="true" class="ProseMirror"></div>',
    { mode: 'bangla' }, { nativeRich: true });
  t.after(() => page.dom.window.close());
  const originalLatin = [];
  const model = [];
  page.root.addEventListener('beforeinput', event => {
    if (/[A-Za-z]/.test(event.data || '')) originalLatin.push(event.data);
  });
  page.root.addEventListener('input', () => model.push(page.text()));
  page.type('ami');
  assert.equal(page.text(), 'আমি');
  assert.deepEqual(model, ['আ', 'আম', 'আমি']);
  assert.deepEqual(originalLatin, [], 'the site must not process the original edit after native insertion');
});

test('Lexical and Draft-style keydowns convert before original handlers and preserve native notifications', async t => {
  for (const attributes of ['data-lexical-editor="true"', 'class="public-DraftEditor-content"']) {
    const page = await setup(`<div contenteditable="true" ${attributes}><span></span></div>`,
      { mode: 'bangla' }, { nativeRich: true });
    t.after(() => page.dom.window.close());
    const keys = [];
    const originals = [];
    const model = [];
    page.root.addEventListener('keydown', event => keys.push(event));
    page.root.addEventListener('input', () => model.push(page.text()));
    for (const key of ['a', 'm', 'i', 'Backspace']) {
      const event = new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      originals.push(event);
      page.root.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, key);
    }
    assert.equal(page.text(), 'আম');
    assert.deepEqual(model, ['আ', 'আম', 'আমি', 'আম']);
    assert.equal(keys.some(event => originals.includes(event)), false, 'no competing original keystroke reaches the editor');
    assert.equal(page.commands.at(-1).command, 'delete');
  }
});

test('refused managed keydown insertion preserves original event, DOM and selection', async t => {
  const page = await setup('<div contenteditable="true" data-lexical-editor="true"><span>old tail</span></div>',
    { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.window.document.execCommand = () => false;
  const node = page.root.firstChild;
  const keys = [];
  page.root.addEventListener('keydown', event => keys.push(event.key));
  page.select(0, 3, true);
  const event = new page.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  page.root.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(keys, ['a']);
  assert.equal(page.text(), 'old tail');
  assert.equal(page.root.firstChild, node);
  assert.deepEqual(page.selection(), [0, 3]);
});

test('native input receipts hold a model-owned first insertion until its callback commits normalized DOM', async t => {
  const page = await setup('<div contenteditable="true" data-lexical-editor="true"></div>',
    { mode: 'bangla' }, { nativeRich: true, suggestions: true });
  t.after(() => page.dom.window.close());
  page.root.addEventListener('input', () => {
    const captured = page.text();
    page.root.replaceChildren();
    page.window.queueMicrotask(() => {
      const paragraph = page.window.document.createElement('p');
      paragraph.textContent = captured;
      page.root.append(paragraph);
    });
  }, { once: true });
  const before = page.edit('a');
  assert.equal(before.defaultPrevented, true, 'a confirmed native input must not let the original Latin edit also run');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(page.text(), 'আ');
  assert.deepEqual(page.selection(), [1, 1]);
  page.edit('m');
  page.edit('i');
  assert.equal(page.text(), 'আমি');
  assert.equal(page.panel.shown.latin, 'ami');
  assert.equal(page.root.querySelectorAll('p').length, 1);
});

test('empty inline seeding and word-local native endpoints preserve page-owned wrappers', async t => {
  const page = await setup('<div contenteditable="true"><span></span></div>',
    { mode: 'bangla' }, { nativeRich: true });
  t.after(() => page.dom.window.close());
  let span = page.root.firstChild;
  const native = page.window.document.execCommand;
  page.window.document.execCommand = (...args) => {
    const range = page.window.getSelection().getRangeAt(0);
    assert.equal(range.startContainer.nodeType, 3);
    assert.equal(range.endContainer.nodeType, 3);
    assert.equal(range.startContainer.parentNode, span);
    assert.equal(range.endContainer.parentNode, span);
    return native(...args);
  };
  page.root.addEventListener('input', () => {
    assert.equal(span.parentNode, page.root, 'only the site should remove its own span');
    const replacement = page.window.document.createElement('span');
    replacement.textContent = span.textContent;
    span.replaceWith(replacement);
    span = replacement;
  });
  page.type('ami');
  page.edit(null, 'deleteContentBackward');
  assert.equal(page.text(), 'আম');
  assert.equal(page.root.children.length, 1);
  assert.equal(page.root.childNodes.length, 1, 'no unowned text is inserted alongside the controlled span');
});

test('queued caret repair never overrides deliberate navigation, selection, focus, mode or changed text', async t => {
  for (const action of ['arrow', 'pointer', 'selection', 'focus', 'mode', 'text']) {
    const page = await setup('<div contenteditable="true">Keep old tail</div><input id="other">',
      { mode: 'bangla' }, { nativeRich: true, suggestions: true });
    t.after(() => page.dom.window.close());
    let intendedSelection;
    page.root.addEventListener('input', () => {
      page.window.queueMicrotask(() => {
        page.root.replaceChildren(page.window.document.createTextNode(page.text()));
        if (action === 'arrow') page.root.dispatchEvent(new page.window.KeyboardEvent('keydown',
          { key: 'ArrowLeft', bubbles: true }));
        if (action === 'pointer') page.root.dispatchEvent(new page.window.Event('pointerdown', { bubbles: true }));
        if (['arrow', 'pointer', 'selection'].includes(action)) page.select(1, 1, true);
        if (action === 'focus') page.window.document.querySelector('#other').focus();
        if (action === 'mode') page.mode({ mode: 'english' });
        if (action === 'text') page.root.textContent = 'site changed text';
        intendedSelection = page.selection();
      });
    });
    page.select(5, 8, true);
    page.edit('ami');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(page.selection(), intendedSelection, action);
    assert.equal(page.panel.shown, null, action);
    assert.equal(page.text(), action === 'text' ? 'site changed text' : 'Keep আমি tail', action);
  }
});

test('synchronous site text changes or navigation suppress caret repair and the Latin buffer', async t => {
  for (const rich of [false, true]) {
    for (const navigation of [false, true]) {
      const page = await setup(rich ? '<div contenteditable="true">Keep old tail</div>'
        : '<input value="Keep old tail">', { mode: 'bangla' }, { nativeRich: rich, suggestions: true });
      t.after(() => page.dom.window.close());
      const handler = () => {
        if (navigation) page.root.dispatchEvent(new page.window.KeyboardEvent('keydown',
          { key: 'ArrowLeft', bubbles: true }));
        else if (rich) page.root.textContent = 'site changed text';
        else page.root.value = 'site changed text';
        page.select(1);
      };
      page.root.addEventListener('input', handler);
      page.select(5, 8, true);
      page.edit('ami');
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(page.selection(), [1, 1]);
      assert.equal(page.panel.shown, null);
      assert.equal(page.text(), navigation ? 'Keep আমি tail' : 'site changed text');
      page.root.removeEventListener('input', handler);
      page.edit('a');
      assert.equal(page.text(), navigation ? 'Kআeep আমি tail' : 'sআite changed text');
    }
  }
});

test('unmanaged multiline input fallback remains local and does not emit duplicate native input', async t => {
  const page = await setup('<div contenteditable="true"><p>Keep </p><p>old</p><p> tail</p></div>',
    { mode: 'bangla' }, { nativeRich: true });
  t.after(() => page.dom.window.close());
  let notifications = 0;
  page.root.addEventListener('input', () => { notifications += 1; });
  page.selectNode(page.root.children[1].firstChild, 0, 3);
  page.type('kha', { cancelable: false });
  assert.equal(page.text(), 'Keep খা tail');
  page.edit(null, 'deleteContentBackward', { cancelable: false });
  assert.equal(page.text(), 'Keep খ tail');
  assert.equal(notifications, 4);
  assert.equal(page.commands.length, 0, 'input fallback uses safe local ranges instead of another native event');
});

test('multiline paste and native IME commit are not transliterated', async t => {
  const page = await setup('<div contenteditable="true"><p>Keep </p><p><br></p></div>',
    { mode: 'bangla' }, { suggestions: true });
  t.after(() => page.dom.window.close());
  page.selectNode(page.root.lastChild, 0);
  page.edit('English বাংলা', 'insertFromPaste');
  page.type(' ami');
  assert.equal(page.panel.shown.latin, 'ami');
  page.root.dispatchEvent(new page.window.CompositionEvent('compositionstart', { bubbles: true }));
  page.type('kha', { isComposing: true });
  page.root.dispatchEvent(new page.window.CompositionEvent('compositionend', { bubbles: true, data: 'kha' }));
  page.root.dispatchEvent(new page.window.InputEvent('input', { bubbles: true,
    inputType: 'insertText', data: 'kha' }));
  assert.equal(page.text(), 'Keep English বাংলা আমিkha');
  assert.equal(page.panel.shown, null);
});

test('refused native commands preserve managed DOM and restore its original selection', async t => {
  const page = await setup('<div class="ProseMirror" contenteditable="true">old tail</div>',
    { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.window.document.execCommand = () => false;
  page.select(0, 3, true);
  const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
    inputType: 'insertText', data: 'ami' });
  page.root.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(page.text(), 'old tail');
  assert.deepEqual(page.selection(), [0, 3]);
  page.edit('ami', 'insertText', { cancelable: false });
  assert.equal(page.text(), 'ami tail', 'managed input-only paths remain native');
});

test('nested model-owned regions are protected without excluding their simple siblings', async t => {
  const page = await setup('<div contenteditable="true"><span>Keep </span>'
    + '<span class="ProseMirror">model</span><span> tail</span></div>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  const model = page.root.children[1];
  const tail = page.root.lastChild.firstChild;
  page.selectNode(tail, 1);
  page.type('ami ');
  assert.equal(page.text(), 'Keep model আমি tail');
  assert.equal(page.root.children[1], model);
  for (const select of [
    () => page.selectNode(model.firstChild, 2),
    () => page.selectNode(page.root.firstChild.firstChild, 1, 2, tail),
  ]) {
    select();
    const before = page.root.innerHTML;
    const event = new page.window.InputEvent('beforeinput', { bubbles: true, cancelable: true,
      inputType: 'insertText', data: 'ami' });
    page.root.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(page.root.innerHTML, before);
  }
});

test('suggestions show only active nonraw words and accept just that validated word', async t => {
  const page = await setup('<textarea>Keep English:  tail</textarea>', { mode: 'bangla' },
    { suggestions: true });
  t.after(() => page.dom.window.close());
  page.select(14, 14, true);
  page.type('a');
  assert.equal(page.panel.shown, null);
  page.type('mi');
  assert.equal(page.panel.shown.latin, 'ami');
  assert.equal(page.panel.shown.rendered, 'আমি');
  assert.equal(page.panel.shown.root, page.root);
  page.panel.accept();
  assert.equal(page.text(), 'Keep English: আমিই tail');
  assert.equal(page.panel.shown, null);
  page.type('a');
  assert.equal(page.text(), 'Keep English: আমিইআ tail', 'acceptance commits the source Latin buffer');
});

test('suggestion keys are handled before movement invalidation and Enter stays native', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' }, { suggestions: true });
  t.after(() => page.dom.window.close());
  const key = value => {
    const event = new page.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    page.root.dispatchEvent(event);
    return event;
  };
  page.type('ami');
  assert.equal(key('ArrowDown').defaultPrevented, true);
  assert.equal(key('ArrowUp').defaultPrevented, true);
  assert.equal(page.panel.shown.latin, 'ami');
  assert.equal(key('Tab').defaultPrevented, true);
  assert.equal(page.text(), 'আমিই');
  page.type(' ami');
  assert.equal(key('Escape').defaultPrevented, true);
  assert.equal(page.panel.shown, null);
  page.type('a');
  assert.equal(key('Enter').defaultPrevented, false);
  assert.equal(page.panel.shown, null);
});

test('shadow suggestion pointer events preserve the active word until click acceptance', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' }, { suggestions: true });
  t.after(() => page.dom.window.close());
  page.type('ami');
  page.panel.button.dispatchEvent(new page.window.Event('pointerdown',
    { bubbles: true, composed: true, cancelable: true }));
  page.panel.button.click();
  assert.equal(page.text(), 'আমিই');
  assert.equal(page.panel.shown, null);
});

test('stale suggestions cannot replace moved, externally changed or committed text', async t => {
  for (const invalidate of [
    page => page.select(0),
    page => { page.root.value = 'Changed'; page.select(7); },
    page => page.type(' '),
    page => page.root.dispatchEvent(new page.window.FocusEvent('focusout', { bubbles: true })),
  ]) {
    const page = await setup('<textarea></textarea>', { mode: 'bangla' }, { suggestions: true });
    t.after(() => page.dom.window.close());
    page.type('ami');
    invalidate(page);
    const before = page.text();
    page.panel.accept();
    assert.equal(page.text(), before);
    assert.equal(page.panel.shown, null);
  }
});

test('suggestion visibility follows settings, composition, raw words and caret movement', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' }, { suggestions: true });
  t.after(() => page.dom.window.close());
  page.type('ami');
  await page.mode({ suggestions: false });
  assert.equal(page.panel.shown, null);
  page.type(' ami');
  assert.equal(page.panel.shown, null);
  await page.mode({ suggestions: true });
  page.type(' ami');
  assert.equal(page.panel.shown.latin, 'ami');
  page.root.dispatchEvent(new page.window.CompositionEvent('compositionstart', { bubbles: true }));
  assert.equal(page.panel.shown, null);
  page.root.dispatchEvent(new page.window.CompositionEvent('compositionend', { bubbles: true, data: '' }));
  page.type(' `React');
  assert.equal(page.panel.shown, null);
  page.type(',ami');
  assert.equal(page.panel.shown.latin, 'ami');
  page.select(0, 0, true);
  assert.equal(page.panel.shown, null);
  page.select(page.text().length, page.text().length, true);
  page.type(' ami');
  await page.mode({ mode: 'english' });
  assert.equal(page.panel.shown, null);
  await page.mode({ mode: 'bangla' });
  page.type(' ami');
  await page.mode({ enabled: false });
  assert.equal(page.panel.shown, null);
});

test('page-controlled value changes invalidate the active word safely', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.type('k');
  page.root.value = 'other';
  page.select(2);
  page.type('a');
  assert.equal(page.text(), 'otআher');
});

test('an engine error does not cancel the native edit', async t => {
  const page = await setup('<textarea></textarea>', { mode: 'bangla' });
  t.after(() => page.dom.window.close());
  page.window.ShobdoEngine.transliterate = () => { throw new Error('unavailable'); };
  assert.equal(page.edit('a').defaultPrevented, false);
  assert.equal(page.text(), 'a');
});

test('real engine and storage settings integrate through the browser-script load order', async t => {
  const page = await setup('<textarea>Keep English: </textarea>', {}, { realDependencies: true });
  t.after(() => page.dom.window.close());
  page.type('English ');
  assert.equal(page.text(), 'Keep English: English ');
  await page.mode({ mode: 'bangla' });
  page.type('ami bangla `React kemon acho?');
  assert.equal(page.text(), 'Keep English: English আমি বাংলা React কেমন আছো?');
  await page.mode({ mode: 'english' });
  page.type(' Mixed language');
  assert.equal(page.text(), 'Keep English: English আমি বাংলা React কেমন আছো? Mixed language');
});

test('real shadow suggestion panel accepts a correction through the content integration', async t => {
  const page = await setup('<textarea>Keep English:  tail</textarea>', { mode: 'bangla' },
    { realDependencies: true });
  t.after(() => page.dom.window.close());
  page.select(14, 14, true);
  page.type('banlga');
  const panel = page.window.document.querySelector('[data-shobdo-suggestions]');
  assert.ok(panel, 'the optional helper was loaded before the content script');
  const candidate = panel.shadowRoot.querySelector('[role="option"]');
  assert.equal(candidate.firstChild.textContent, 'বাংলা');
  candidate.dispatchEvent(new page.window.MouseEvent('pointerdown',
    { bubbles: true, composed: true, cancelable: true }));
  candidate.click();
  assert.equal(page.text(), 'Keep English: বাংলা tail');
  assert.equal(page.window.document.querySelector('[data-shobdo-suggestions]'), null);
  page.type(' am');
  const key = new page.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  page.root.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(page.text(), 'Keep English: বাংলা আম tail');
});
