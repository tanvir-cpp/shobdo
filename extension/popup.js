(function () {
  'use strict';

  const popup = document.getElementById('popup');
  const enabled = document.getElementById('enabled');
  const suggestions = document.getElementById('suggestions');
  const modes = document.getElementById('mode-controls');
  const english = document.getElementById('mode-english');
  const bangla = document.getElementById('mode-bangla');
  const status = document.getElementById('status');
  const errorBox = document.getElementById('error-box');
  const errorMessage = document.getElementById('error-message');
  const retry = document.getElementById('retry');
  let current = null;
  let busy = false;

  function render(settings) {
    current = settings;
    enabled.checked = settings.enabled;
    suggestions.checked = settings.suggestions;
    english.checked = settings.mode === 'english';
    bangla.checked = settings.mode === 'bangla';
    if (!settings.enabled) {
      status.textContent = 'Shobdo is paused. ' + (settings.mode === 'bangla' ? 'Bangla' : 'English') + ' mode is saved for when you enable it.';
    } else if (settings.mode === 'bangla') {
      status.textContent = 'Bangla mode is on · Converts words in supported text fields.';
    } else {
      status.textContent = 'English mode is on · Your typing stays in English.';
    }
  }

  function setBusy(value) {
    busy = value;
    popup.setAttribute('aria-busy', String(value));
    enabled.disabled = value || !current;
    suggestions.disabled = value || !current;
    modes.disabled = value || !current;
    retry.disabled = value;
  }

  function clearError() {
    errorBox.hidden = true;
    errorMessage.textContent = '';
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorBox.hidden = false;
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    clearError();
    try {
      render(await ShobdoSettings.read());
    } catch (error) {
      status.textContent = current ? 'Could not refresh your saved settings.' : 'Settings are unavailable.';
      showError('Could not load your settings. Try reloading them.');
    } finally {
      setBusy(false);
    }
  }

  async function save(patch) {
    if (busy) return;
    const previous = current;
    setBusy(true);
    clearError();
    try {
      render(await ShobdoSettings.update(patch));
    } catch (error) {
      // Restore persisted controls rather than displaying an unsaved selection.
      try {
        render(await ShobdoSettings.read());
      } catch (readError) {
        render(previous);
        status.textContent = 'Could not confirm your saved settings.';
      }
      showError('Your change could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  enabled.addEventListener('change', function () {
    save({ enabled: enabled.checked });
  });
  suggestions.addEventListener('change', function () {
    save({ suggestions: suggestions.checked });
  });
  for (const radio of [english, bangla]) {
    radio.addEventListener('change', function () {
      if (radio.checked) save({ mode: radio.value });
    });
  }
  retry.addEventListener('click', refresh);
  const unsubscribe = ShobdoSettings.subscribe(function (settings) {
    render(settings);
    if (!busy) setBusy(false);
  });
  window.addEventListener('pagehide', unsubscribe, { once: true });
  refresh();
})();
