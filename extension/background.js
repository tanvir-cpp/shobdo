'use strict';

importScripts('settings.js');

// Keep command operations in order, including the initial default write. A
// shortcut changes mode only: it never silently re-enables a paused extension.
let operations = Promise.resolve();

// The queued promise is returned to event listeners so Chrome keeps the
// worker alive until the storage work settles, instead of suspending it
// mid-write after an onInstalled/onStartup/command event.
function queueOperation(operation) {
  operations = operations.then(operation).catch(function (error) {
    console.error('Shobdo could not save its settings.', error);
  });
  return operations;
}

// The toolbar badge is the only always-visible signal of the typing mode, which
// matters because Alt+Shift+S flips it without opening any UI. Badge text is
// not persisted by Chrome, so it is re-applied on every worker start.
function describeAction(settings) {
  if (!settings.enabled) {
    return { text: 'OFF', color: '#6b7a74', title: 'Shobdo — paused' };
  }
  if (settings.mode === 'bangla') {
    return { text: 'BN', color: '#136e58', title: 'Shobdo — Bangla typing (Alt+Shift+S to switch)' };
  }
  return { text: 'EN', color: '#6b7a74', title: 'Shobdo — English typing (Alt+Shift+S to switch)' };
}

async function syncAction(settings) {
  if (!chrome.action) return;
  const view = describeAction(settings);
  try {
    await Promise.all([
      chrome.action.setBadgeText({ text: view.text }),
      chrome.action.setBadgeBackgroundColor({ color: view.color }),
      chrome.action.setTitle({ title: view.title }),
    ]);
  } catch (error) {
    console.error('Shobdo could not update its toolbar badge.', error);
  }
}

// Registered synchronously so it also wakes a suspended worker; subscribe()
// hands over normalized settings.
ShobdoSettings.subscribe(function (settings) {
  queueOperation(function () { return syncAction(settings); });
});

function initializeSettings() {
  return queueOperation(async function () {
    const stored = (await chrome.storage.local.get('shobdoSettings')).shobdoSettings;
    if (!stored || typeof stored.enabled !== 'boolean' || (stored.mode !== 'english' && stored.mode !== 'bangla') || typeof stored.suggestions !== 'boolean') {
      await ShobdoSettings.update({});
    }
    await syncAction(await ShobdoSettings.read());
  });
}

chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'toggle-mode') return;
  return queueOperation(async function () {
    const settings = await ShobdoSettings.read();
    await ShobdoSettings.update({ mode: settings.mode === 'english' ? 'bangla' : 'english' });
  });
});

// initializeSettings is registered and called from three places intentionally:
//  1. chrome.runtime.onInstalled — fresh installs and extension updates.
//  2. chrome.runtime.onStartup  — browser restarts with the extension installed.
//  3. Bare call below            — mid-session service-worker restarts, where
//     Chrome fires neither onInstalled nor onStartup (most common in practice).
// The operation queue serializes all three; the guard inside initializeSettings
// (checking for valid stored settings) prevents redundant writes when multiple
// events fire together on a fresh install.
chrome.runtime.onInstalled.addListener(initializeSettings);
chrome.runtime.onStartup.addListener(initializeSettings);
initializeSettings();
