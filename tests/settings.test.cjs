'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.join(__dirname, '..', 'extension');
const settingsSource = fs.readFileSync(path.join(extension, 'settings.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(extension, 'background.js'), 'utf8');
const KEY = 'shobdoSettings';
const clone = value => value === undefined ? undefined : structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));

function event() {
  const listeners = new Set();
  return {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit: (...args) => { for (const listener of [...listeners]) listener(...args); },
    get size() { return listeners.size; },
  };
}

function fixture(initial = {}) {
  const data = clone(initial);
  const onChanged = event();
  const writes = [];
  let failGet = false;
  let failSet = false;
  function context(background = false) {
    const errors = [];
    const chrome = {
      storage: {
        local: {
          async get(key) {
            if (failGet) throw new Error('Read failed');
            return { [key]: clone(data[key]) };
          },
          async set(values) {
            if (failSet) throw new Error('Write failed');
            const changes = {};
            for (const [key, value] of Object.entries(values)) {
              changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
              data[key] = clone(value);
            }
            writes.push(clone(values));
            onChanged.emit(changes, 'local');
          },
        },
        onChanged,
      },
      commands: { onCommand: event() },
      runtime: { onInstalled: event(), onStartup: event() },
    };
    const sandbox = vm.createContext({ chrome, console: { error: (...args) => errors.push(args) } });
    sandbox.importScripts = filename => {
      assert.equal(filename, 'settings.js');
      vm.runInContext(settingsSource, sandbox, { filename });
    };
    vm.runInContext(background ? backgroundSource : settingsSource, sandbox, { filename: background ? 'background.js' : 'settings.js' });
    return { settings: sandbox.ShobdoSettings, chrome, errors, sandbox };
  }
  return {
    context, data, writes, onChanged,
    failGet(value) { failGet = value; },
    failSet(value) { failSet = value; },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('defaults are frozen and reads return independent validated values', async () => {
  const store = fixture();
  const { settings } = store.context();
  assert.deepEqual(plain(settings.DEFAULTS), { enabled: true, mode: 'english', suggestions: true });
  assert.equal(Object.isFrozen(settings.DEFAULTS), true);
  const first = await settings.read();
  first.enabled = false;
  assert.deepEqual(plain(await settings.read()), { enabled: true, mode: 'english', suggestions: true });
  assert.equal(store.writes.length, 0);
  store.data[KEY] = { enabled: 'yes', mode: 'other', suggestions: 'yes', extra: 'ignored' };
  assert.deepEqual(plain(await settings.read()), { enabled: true, mode: 'english', suggestions: true });
  store.data[KEY] = { enabled: false, mode: 'bangla' };
  assert.deepEqual(plain(await settings.read()), { enabled: false, mode: 'bangla', suggestions: true });
  store.data[KEY].suggestions = false;
  assert.deepEqual(plain(await settings.read()), { enabled: false, mode: 'bangla', suggestions: false });
});

test('enabled, mode and suggestions persist across popup/content/new contexts', async () => {
  const store = fixture();
  const popup = store.context();
  const content = store.context();
  const observed = [];
  const unsubscribe = content.settings.subscribe(settings => observed.push(plain(settings)));
  await popup.settings.update({ mode: 'bangla' });
  await popup.settings.update({ enabled: false });
  assert.deepEqual(plain(await content.settings.read()), { enabled: false, mode: 'bangla', suggestions: true });
  assert.deepEqual(plain(await store.context().settings.read()), { enabled: false, mode: 'bangla', suggestions: true });
  assert.deepEqual(observed, [{ enabled: true, mode: 'bangla', suggestions: true }, { enabled: false, mode: 'bangla', suggestions: true }]);
  await popup.settings.update({ suggestions: false });
  assert.deepEqual(plain(await store.context().settings.read()), { enabled: false, mode: 'bangla', suggestions: false });
  await popup.settings.update({ enabled: true, mode: 'english' });
  assert.deepEqual(store.data[KEY], { enabled: true, mode: 'english', suggestions: false });
  unsubscribe();
  await popup.settings.update({ enabled: false });
  assert.equal(observed.length, 4);
  assert.equal(store.onChanged.size, 0);
});

test('partial updates serialize and copy the caller patch', async () => {
  const store = fixture();
  const { settings } = store.context();
  const patch = { mode: 'bangla' };
  const first = settings.update(patch);
  patch.mode = 'english';
  const second = settings.update({ enabled: false });
  const third = settings.update({ suggestions: false });
  await Promise.all([first, second, third]);
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'bangla', suggestions: false });
});

test('invalid updates reject without saving and storage failures remain retryable', async () => {
  const store = fixture();
  const { settings } = store.context();
  for (const patch of [null, [], 'bangla', { enabled: 1 }, { mode: 'Bangla' }, { suggestions: 1 }, { suggestions: 'false' }, { suggestions: null }, { suggestions: undefined }, { other: true }]) {
    await assert.rejects(settings.update(patch), { name: 'TypeError' });
  }
  assert.equal(store.writes.length, 0);
  store.failGet(true);
  await assert.rejects(settings.read(), /Read failed/);
  await assert.rejects(settings.update({ enabled: false }), /Read failed/);
  store.failGet(false);
  store.failSet(true);
  await assert.rejects(settings.update({ mode: 'bangla' }), /Write failed/);
  store.failSet(false);
  await settings.update({ mode: 'bangla' });
  assert.deepEqual(store.data[KEY], { enabled: true, mode: 'bangla', suggestions: true });
});

test('subscriptions validate changes and ignore unrelated storage areas and keys', () => {
  const store = fixture();
  const { settings } = store.context();
  const observed = [];
  assert.throws(() => settings.subscribe(null), { name: 'TypeError' });
  const unsubscribe = settings.subscribe(value => observed.push(plain(value)));
  store.onChanged.emit({ [KEY]: { newValue: { enabled: false, mode: 'bangla' } } }, 'sync');
  store.onChanged.emit({ unrelated: { newValue: true } }, 'local');
  assert.equal(observed.length, 0);
  store.onChanged.emit({ [KEY]: { newValue: { enabled: false, mode: 'invalid', suggestions: false } } }, 'local');
  store.onChanged.emit({ [KEY]: { oldValue: {} } }, 'local');
  assert.deepEqual(observed, [{ enabled: false, mode: 'english', suggestions: false }, { enabled: true, mode: 'english', suggestions: true }]);
  unsubscribe();
  unsubscribe();
  assert.equal(store.onChanged.size, 0);
});

test('background initializes defaults and repairs missing or invalid fields', async () => {
  for (const initial of [{}, { [KEY]: { enabled: false } }, { [KEY]: { mode: 'bangla', enabled: 'invalid' } }]) {
    const store = fixture(initial);
    const worker = store.context(true);
    await settle();
    const expected = initial[KEY]?.mode === 'bangla'
      ? { enabled: true, mode: 'bangla', suggestions: true }
      : { enabled: initial[KEY]?.enabled === false ? false : true, mode: 'english', suggestions: true };
    assert.deepEqual(store.data[KEY], expected);
    worker.chrome.runtime.onInstalled.emit();
    worker.chrome.runtime.onStartup.emit();
    await settle();
    assert.deepEqual(store.data[KEY], expected);
    assert.equal(worker.errors.length, 0);
  }
  const existing = fixture({ [KEY]: { enabled: false, mode: 'bangla', suggestions: false } });
  existing.context(true);
  await settle();
  assert.equal(existing.writes.length, 0, 'valid settings need no startup rewrite');
});

test('background migrates old settings once without resetting mode or paused state', async () => {
  for (const suggestions of [undefined, 'invalid', false, true]) {
    const initial = { enabled: false, mode: 'bangla' };
    if (suggestions !== undefined) initial.suggestions = suggestions;
    const store = fixture({ [KEY]: initial });
    const worker = store.context(true);
    await settle();
    assert.deepEqual(store.data[KEY], { enabled: false, mode: 'bangla', suggestions: suggestions === false ? false : true });
    const migratedWrites = suggestions === undefined || suggestions === 'invalid' ? 1 : 0;
    assert.equal(store.writes.length, migratedWrites);
    worker.chrome.runtime.onInstalled.emit({ reason: 'update' });
    worker.chrome.runtime.onStartup.emit();
    await settle();
    assert.equal(store.writes.length, migratedWrites, 'migration is idempotent');
  }
});

test('shortcut toggles persistent mode, preserves paused state, survives worker restarts', async () => {
  const store = fixture({ [KEY]: { enabled: false, mode: 'english', suggestions: false } });
  let worker = store.context(true);
  // Exercise a shortcut delivered before the startup default operation finishes.
  worker.chrome.commands.onCommand.emit('toggle-mode');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'bangla', suggestions: false });
  assert.deepEqual(plain(await store.context().settings.read()), { enabled: false, mode: 'bangla', suggestions: false });
  worker = store.context(true);
  worker.chrome.commands.onCommand.emit('toggle-mode');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'english', suggestions: false });
  const writesBefore = store.writes.length;
  worker.chrome.commands.onCommand.emit('unrelated');
  await settle();
  assert.equal(store.writes.length, writesBefore);
  worker.chrome.commands.onCommand.emit('toggle-mode');
  worker.chrome.commands.onCommand.emit('toggle-mode');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'english', suggestions: false });
});

test('background reports storage failure and processes the next command', async () => {
  const store = fixture({ [KEY]: { enabled: true, mode: 'english', suggestions: true } });
  const worker = store.context(true);
  await settle();
  store.failSet(true);
  worker.chrome.commands.onCommand.emit('toggle-mode');
  await settle();
  assert.equal(worker.errors.length, 1);
  assert.deepEqual(store.data[KEY], { enabled: true, mode: 'english', suggestions: true });
  store.failSet(false);
  worker.chrome.commands.onCommand.emit('toggle-mode');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: true, mode: 'bangla', suggestions: true });
});

function popupFixture(store) {
  const elements = {};
  for (const id of ['popup', 'enabled', 'suggestions', 'mode-controls', 'mode-english', 'mode-bangla', 'status', 'error-box', 'error-message', 'retry']) {
    const listeners = {};
    elements[id] = {
      disabled: true, checked: false, hidden: id === 'error-box', textContent: '', attributes: {},
      addEventListener(name, callback) { listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      dispatch(name) { listeners[name]?.(); },
    };
  }
  elements['mode-english'].value = 'english';
  elements['mode-bangla'].value = 'bangla';
  const context = store.context();
  context.sandbox.document = { getElementById: id => elements[id] };
  const windowEvents = {};
  context.sandbox.window = { addEventListener: (name, callback) => { windowEvents[name] = callback; } };
  vm.runInContext(fs.readFileSync(path.join(extension, 'popup.js'), 'utf8'), context.sandbox, { filename: 'popup.js' });
  return { elements, windowEvents };
}

test('popup controls save real changes and reflect external settings while open', async () => {
  const store = fixture();
  const { elements, windowEvents } = popupFixture(store);
  await settle();
  assert.equal(elements.enabled.checked, true);
  assert.equal(elements.enabled.disabled, false);
  assert.equal(elements.suggestions.checked, true);
  assert.equal(elements.suggestions.disabled, false);
  assert.equal(elements['mode-english'].checked, true);
  assert.match(elements.status.textContent, /English mode is on/);
  elements['mode-bangla'].checked = true;
  elements['mode-bangla'].dispatch('change');
  assert.equal(elements['mode-controls'].disabled, true, 'prevent input during an in-flight save');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: true, mode: 'bangla', suggestions: true });
  assert.match(elements.status.textContent, /Bangla mode is on/);
  elements.enabled.checked = false;
  elements.enabled.dispatch('change');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'bangla', suggestions: true });
  assert.match(elements.status.textContent, /paused.*Bangla/);
  elements.suggestions.checked = false;
  elements.suggestions.dispatch('change');
  assert.equal(elements.suggestions.disabled, true, 'suggestions also wait for persistence');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'bangla', suggestions: false });
  assert.equal(elements.suggestions.checked, false);
  const external = store.context();
  await external.settings.update({ enabled: true, mode: 'english', suggestions: true });
  assert.equal(elements.enabled.checked, true);
  assert.equal(elements['mode-english'].checked, true);
  assert.equal(elements['mode-bangla'].checked, false);
  assert.equal(elements.suggestions.checked, true);
  assert.match(elements.status.textContent, /English mode is on/);
  windowEvents.pagehide();
  assert.equal(store.onChanged.size, 0);
});

test('popup shows save failures and restores persisted controls', async () => {
  const store = fixture({ [KEY]: { enabled: true, mode: 'english' } });
  const { elements } = popupFixture(store);
  await settle();
  store.failSet(true);
  elements.enabled.checked = false;
  elements.enabled.dispatch('change');
  await settle();
  assert.equal(elements['error-box'].hidden, false);
  assert.match(elements['error-message'].textContent, /could not be saved/);
  assert.equal(elements.enabled.checked, true);
  assert.equal(elements.enabled.disabled, false);
  assert.deepEqual(store.data[KEY], { enabled: true, mode: 'english' });
  store.failSet(false);
  elements.enabled.checked = false;
  elements.enabled.dispatch('change');
  await settle();
  assert.equal(elements['error-box'].hidden, true);
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'english', suggestions: true });
});

test('popup loading failure exposes retry and recovers', async () => {
  const store = fixture();
  store.failGet(true);
  const { elements } = popupFixture(store);
  await settle();
  assert.equal(elements['error-box'].hidden, false);
  assert.match(elements.status.textContent, /unavailable/);
  assert.equal(elements.enabled.disabled, true);
  assert.equal(elements.suggestions.disabled, true);
  assert.equal(elements['mode-controls'].disabled, true);
  assert.equal(elements.retry.disabled, false);
  store.failGet(false);
  elements.retry.dispatch('click');
  await settle();
  assert.equal(elements['error-box'].hidden, true);
  assert.equal(elements.enabled.disabled, false);
  assert.equal(elements.suggestions.disabled, false);
  assert.equal(elements['mode-controls'].disabled, false);
  assert.match(elements.status.textContent, /English mode is on/);
});

test('popup restores suggestion preference after save and confirmation failures, then retries', async () => {
  const store = fixture({ [KEY]: { enabled: false, mode: 'bangla', suggestions: false } });
  const { elements } = popupFixture(store);
  await settle();
  assert.equal(elements.suggestions.checked, false);
  store.failSet(true);
  elements.suggestions.checked = true;
  elements.suggestions.dispatch('change');
  await settle();
  assert.equal(elements.suggestions.checked, false);
  assert.equal(elements['error-box'].hidden, false);
  assert.equal(elements.suggestions.disabled, false);
  store.failGet(true);
  elements.suggestions.checked = true;
  elements.suggestions.dispatch('change');
  await settle();
  assert.equal(elements.suggestions.checked, false);
  assert.match(elements.status.textContent, /Could not confirm/);
  store.failGet(false);
  store.failSet(false);
  elements.suggestions.checked = true;
  elements.suggestions.dispatch('change');
  await settle();
  assert.deepEqual(store.data[KEY], { enabled: false, mode: 'bangla', suggestions: true });
  assert.equal(elements['error-box'].hidden, true);
});
