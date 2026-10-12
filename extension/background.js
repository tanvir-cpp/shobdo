'use strict';

importScripts('settings.js');

// Keep command operations in order, including the initial default write. A
// shortcut changes mode only: it never silently re-enables a paused extension.
let operations = Promise.resolve();

function queueOperation(operation) {
  operations = operations.then(operation).catch(function (error) {
    console.error('Shobdo could not save its settings.', error);
  });
}

function initializeSettings() {
  queueOperation(async function () {
    const stored = (await chrome.storage.local.get('shobdoSettings')).shobdoSettings;
    if (!stored || typeof stored.enabled !== 'boolean' || (stored.mode !== 'english' && stored.mode !== 'bangla') || typeof stored.suggestions !== 'boolean') {
      await ShobdoSettings.update({});
    }
  });
}

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-mode') return;
  queueOperation(async function () {
    const settings = await ShobdoSettings.read();
    await ShobdoSettings.update({ mode: settings.mode === 'english' ? 'bangla' : 'english' });
  });
});

chrome.runtime.onInstalled.addListener(initializeSettings);
chrome.runtime.onStartup.addListener(initializeSettings);
initializeSettings();
