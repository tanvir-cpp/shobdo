(function (root) {
  'use strict';

  const KEY = 'shobdoSettings';
  const DEFAULTS = Object.freeze({ enabled: true, mode: 'english', suggestions: true });
  let writes = Promise.resolve();

  function normalize(value) {
    const settings = value && typeof value === 'object' ? value : {};
    return {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : DEFAULTS.enabled,
      mode: settings.mode === 'bangla' || settings.mode === 'english' ? settings.mode : DEFAULTS.mode,
      suggestions: typeof settings.suggestions === 'boolean' ? settings.suggestions : DEFAULTS.suggestions,
    };
  }

  async function read() {
    const stored = await root.chrome.storage.local.get(KEY);
    return normalize(stored[KEY]);
  }

  async function update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Settings updates must be an object.');
    }
    for (const key of Object.keys(patch)) {
      if (key !== 'enabled' && key !== 'mode' && key !== 'suggestions') {
        throw new TypeError('Unknown setting: ' + key);
      }
    }
    if (Object.hasOwn(patch, 'enabled') && typeof patch.enabled !== 'boolean') {
      throw new TypeError('Enabled must be true or false.');
    }
    if (Object.hasOwn(patch, 'mode') && patch.mode !== 'bangla' && patch.mode !== 'english') {
      throw new TypeError('Mode must be bangla or english.');
    }
    if (Object.hasOwn(patch, 'suggestions') && typeof patch.suggestions !== 'boolean') {
      throw new TypeError('Suggestions must be true or false.');
    }
    // Copy now so a caller cannot mutate a queued update. Serialize writes made
    // within this context so quick control changes do not overwrite one another.
    const changes = { ...patch };
    const next = writes.then(async function () {
      const settings = { ...(await read()), ...changes };
      await root.chrome.storage.local.set({ [KEY]: settings });
      return settings;
    });
    writes = next.catch(function () {});
    return next;
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('A settings subscriber must be a function.');
    }
    function listener(changes, areaName) {
      if (areaName === 'local' && Object.hasOwn(changes, KEY)) {
        callback(normalize(changes[KEY].newValue));
      }
    }
    root.chrome.storage.onChanged.addListener(listener);
    return function unsubscribe() {
      root.chrome.storage.onChanged.removeListener(listener);
    };
  }

  root.ShobdoSettings = Object.freeze({ DEFAULTS, read, update, subscribe });
})(globalThis);
