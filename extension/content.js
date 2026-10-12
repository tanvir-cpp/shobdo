/* Local, word-at-a-time editing. Structural boundaries and widgets are never
 * part of a composition; model-owned DOM is edited only via the browser.
 *
 * Single-file content script is intentional: the manifest injects scripts in
 * order at document_start, and one atomic IIFE avoids cross-file load races.
 * Internally this file is sectioned (state, adapters, caret repair, word
 * plans, event wiring); see the ── section banners below. */
(() => {
  'use strict';

  const engine = globalThis.ShobdoEngine;
  const settingsApi = globalThis.ShobdoSettings;
  if (!engine || typeof engine.transliterate !== 'function' || !settingsApi) return;

  // ── Tunables ──────────────────────────────────────────────────────────
  // MAX_RICH_TEXT_LENGTH bounds the O(n) logical-index walk per keystroke.
  // Larger documents stay native rather than risking input jank.
  const MAX_RICH_TEXT_LENGTH = 50000;
  // MAX_CARET_CHECKS bounds post-edit rerender verification (microtasks + one task).
  const MAX_CARET_CHECKS = 2;
  let execCommandWarned = false;

  let settings = { enabled: true, mode: 'english', suggestions: true };
  let settingsRevision = 0;
  let word = null;
  let emitting = false;
  let caretRepair = null;
  let interactionRevision = 0;
  const composing = new WeakSet();
  const compositionCommits = new WeakMap();
  const snapshots = new WeakMap();
  const pending = new WeakMap();
  const inlineTags = new Set(['SPAN', 'B', 'I', 'STRONG', 'EM', 'U', 'S', 'A',
    'FONT', 'CODE', 'SMALL', 'SUB', 'SUP', 'MARK']);
  // Block elements wrap their content with logical newline boundaries so that
  // canReplace() prevents replacement ranges from crossing structural edges.
  // LI/UL/OL enable transliteration inside lists; H1–H6/BLOCKQUOTE/PRE cover
  // headings and preformatted blocks in plain contenteditable editors.
  // Unknown/widget tags not in either set emit \ufffc, protecting model-owned DOM.
  const blockTags = new Set(['P', 'DIV', 'LI', 'UL', 'OL',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);
  const managedEditor = '.ProseMirror,.ql-editor,[data-slate-editor],'
    + '[data-lexical-editor],[data-contents],.DraftEditor-root,.DraftEditor-editorContainer,.public-DraftEditor-content';
  const earlyNativeEditor = '[data-lexical-editor],.DraftEditor-root,.DraftEditor-editorContainer,.public-DraftEditor-content';
  let suggestions = null;
  let suggestedWord = null;
  try { suggestions = globalThis.ShobdoSuggestions?.create(acceptSuggestion) || null; }
  catch (_) { /* Optional helper: editing also works without a suggestion panel. */ }

  function commit(keepCaret = false) {
    if (!keepCaret) {
      interactionRevision += 1;
      caretRepair = null;
    }
    word = null;
    suggestedWord = null;
    suggestions?.hide();
  }

  function showSuggestions(edit) {
    if (!suggestions) return;
    const active = currentWord(edit, edit.selection());
    if (!active || active.raw || active.latin.length < 2 || !settings.suggestions
      || !settings.enabled || settings.mode !== 'bangla' || composing.has(edit.root)) {
      suggestedWord = null;
      suggestions.hide();
      return;
    }
    let rect;
    try { rect = edit.caretRect?.(); } catch (_) { /* Field rectangle is sufficient. */ }
    suggestedWord = { ...active };
    suggestions.show({ root: active.root, latin: active.latin, rendered: active.rendered, rect });
  }

  function acceptSuggestion(candidate) {
    flushCaret();
    if (!word || !settings.enabled || settings.mode !== 'bangla' || !settings.suggestions
      || typeof candidate?.text !== 'string' || !candidate.text) return commit();
    const edit = adapter(editable(word.root));
    const active = edit && currentWord(edit, edit.selection());
    if (!active || active.raw || composing.has(active.root)
      || suggestedWord?.root !== active.root || suggestedWord.start !== active.start
      || suggestedWord.latin !== active.latin || suggestedWord.rendered !== active.rendered) return commit();
    replace(edit, { start: active.start, rendered: candidate.text, word: null },
      active.start + active.rendered.length, true, 'insertText');
    commit(true);
  }

  function applySettings(next) {
    const updated = {
      enabled: typeof next?.enabled === 'boolean' ? next.enabled : settings.enabled,
      mode: next?.mode === 'bangla' || next?.mode === 'english' ? next.mode : settings.mode,
      suggestions: typeof next?.suggestions === 'boolean' ? next.suggestions : settings.suggestions,
    };
    if (updated.enabled !== settings.enabled || updated.mode !== settings.mode
      || updated.suggestions !== settings.suggestions) commit();
    settings = updated;
  }

  // A storage change arriving while the initial read is in flight wins that race.
  const initialRevision = settingsRevision;
  try {
    Promise.resolve(settingsApi.read()).then(value => {
      if (initialRevision === settingsRevision) applySettings(value);
    }).catch(() => {});
    settingsApi.subscribe(value => {
      settingsRevision += 1;
      applySettings(value);
    });
  } catch (_) { /* Keep native editing if settings are unavailable. */ }

  // ── Section 1: editable hosts + adapters ──────────────────────────────
  // The logical index walks rich DOM once per call; callers that need both
  // text and selection should use snapshot() to avoid two walks.

  function targetOf(event) { return event.composedPath?.()[0] || event.target; }

  function execCommandSupported(doc) {
    return typeof doc?.execCommand === 'function';
  }

  function warnExecCommandOnce() {
    if (execCommandWarned) return;
    execCommandWarned = true;
    // document.execCommand is deprecated but still the only way to join the
    // browser's native undo stack and notify ProseMirror/Lexical/Draft models.
    // When it disappears, conversion must fall back to the input-event path
    // (already implemented below) plus manual InputEvent dispatch.
    try { console.warn('Shobdo: document.execCommand unavailable; using fallback editing.'); }
    catch (_) { /* Console may be restricted; editing continues regardless. */ }
  }

  function editable(target) {
    let element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element) return null;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      if (element.disabled || element.readOnly || element.matches(':disabled')) return null;
      // Only 'text' and 'search' support unconstrained Latin input that Shobdo
      // can transliterate. 'tel' has no value restriction but its numeric keypad
      // on mobile makes phonetic Banglish input unlikely; 'email', 'url', 'number',
      // 'date', 'password' and other types either enforce a format incompatible
      // with Bangla or carry security implications (password fields must never be touched).
      if (element.tagName === 'INPUT' && !['text', 'search'].includes(element.type)) return null;
      return element;
    }
    let root = null;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.getAttribute('aria-readonly') === 'true'
        || ancestor.getAttribute('aria-disabled') === 'true') return null;
      const value = ancestor.getAttribute('contenteditable')?.toLowerCase();
      if (value === 'false') break;
      if (['', 'true', 'plaintext-only'].includes(value)) root = ancestor;
    }
    return root?.tagName === 'CANVAS' ? null : root;
  }

  function adapter(root) {
    if (!root) return null;
    if (root.tagName === 'INPUT' || root.tagName === 'TEXTAREA') {
      return {
        root,
        text: () => root.value,
        selection: () => typeof root.selectionStart === 'number'
          ? { start: root.selectionStart, end: root.selectionEnd } : null,
        snapshot() {
          return { text: root.value, selection: this.selection() };
        },
        setCaret(position) { root.setSelectionRange(position, position); },
        replace(start, end, text) {
          root.setRangeText(text, start, end, 'end');
          return { changed: true, native: false, valid: true };
        },
      };
    }
    const doc = root.ownerDocument;
    const tree = root.getRootNode();
    function isNativeOnly() {
      const range = selectedRange();
      const start = range?.startContainer;
      const end = range?.endContainer;
      return !!root.closest(managedEditor)
        || !!(start?.nodeType === 1 ? start : start?.parentElement)?.closest(managedEditor)
        || !!(end?.nodeType === 1 ? end : end?.parentElement)?.closest(managedEditor);
    }
    function getSelection() {
      return (typeof tree.getSelection === 'function' && tree.getSelection()) || doc.getSelection();
    }
    function selectedRange() {
      const selection = getSelection();
      if (!selection || selection.rangeCount !== 1) return null;
      let range = selection.getRangeAt(0);
      if ((!root.contains(range.startContainer) || !root.contains(range.endContainer))
        && typeof selection.getComposedRanges === 'function') {
        const shadowRoots = [];
        for (let scope = tree; scope?.host; scope = scope.host.getRootNode()) shadowRoots.push(scope);
        range = selection.getComposedRanges({ shadowRoots })[0];
      }
      return range && root.contains(range.startContainer) && root.contains(range.endContainer)
        ? range : null;
    }

    // A logical index includes hard boundaries. Unlike textContent, it cannot
    // accidentally join words on opposite sides of a BR, block or widget.
    function index() {
      let text = '';
      const selection = selectedRange();
      const nodes = new WeakMap();
      const leaves = [];
      const containers = [];
      function visit(node, top = false) {
        if (node.nodeType === 3) {
          nodes.set(node, { start: text.length, length: node.data.length });
          leaves.push({ node, start: text.length, end: text.length + node.data.length });
          text += node.data;
          return;
        }
        if (node.nodeType !== 1) return;
        const value = node.getAttribute('contenteditable')?.toLowerCase();
        if (!top && (value === 'false' || node.getAttribute('aria-readonly') === 'true'
          || node.getAttribute('aria-disabled') === 'true'
          || (node.matches(managedEditor) && (!selection
            || !node.contains(selection.startContainer) || !node.contains(selection.endContainer)))
          || (!inlineTags.has(node.tagName) && !blockTags.has(node.tagName) && node.tagName !== 'BR'))) {
          text += '\ufffc';
          return;
        }
        if (node.tagName === 'BR') { text += '\n'; return; }
        const block = !top && blockTags.has(node.tagName);
        if (block) text += '\n';
        const positions = [text.length];
        for (const child of node.childNodes) { visit(child); positions.push(text.length); }
        nodes.set(node, { positions });
        containers.push({ node, positions });
        if (block) text += '\n';
      }
      visit(root, true);
      function offset(node, position) {
        const entry = nodes.get(node);
        if (!entry) return null;
        return node.nodeType === 3 && position <= entry.length ? entry.start + position
          : entry.positions?.[position] ?? null;
      }
      function point(position, preferred) {
        if (preferred?.node.nodeType === 3 && offset(preferred.node, preferred.offset) === position) return preferred;
        // Reuse the caret's surviving text leaf for a word-local replacement at
        // an inline boundary instead of moving the insertion into its sibling.
        const entry = preferred?.node.nodeType === 3 && nodes.get(preferred.node);
        if (entry && position >= entry.start && position <= entry.start + entry.length)
          return { node: preferred.node, offset: position - entry.start };
        const leaf = leaves.find(item => position >= item.start && position <= item.end);
        if (leaf) return { node: leaf.node, offset: position - leaf.start };
        // Canonical endpoints stay inside editable inline wrappers. Selecting
        // through a parent's child boundary can let native editing remove a
        // framework-owned span that its next render still expects to exist.
        const container = containers.find(item => item.node !== root && item.positions.includes(position));
        if (container) return { node: container.node, offset: container.positions.indexOf(position) };
        if (preferred && offset(preferred.node, preferred.offset) === position) return preferred;
        const child = nodes.get(root).positions.indexOf(position);
        if (child >= 0) return { node: root, offset: child };
        return null;
      }
      return { text, offset, point };
    }
    return {
      root,
      get nativeOnly() { return isNativeOnly(); },
      text: () => index().text,
      selection() {
        // One DOM walk for selection only. Use snapshot() when both text and
        // selection are needed to avoid two walks.
        const range = selectedRange();
        if (!range) return null;
        const map = index();
        const start = map.offset(range.startContainer, range.startOffset);
        const end = map.offset(range.endContainer, range.endOffset);
        return start !== null && end !== null ? { start, end } : null;
      },
      // Single DOM walk returning both text and selection. Prefer this over
      // calling text() + selection() separately (which walks twice).
      snapshot() {
        const range = selectedRange();
        const map = index();
        if (!range) return { text: map.text, selection: null };
        const start = map.offset(range.startContainer, range.startOffset);
        const end = map.offset(range.endContainer, range.endOffset);
        return { text: map.text, selection: start !== null && end !== null ? { start, end } : null };
      },
      caretNode() {
        const range = selectedRange();
        if (!range) return null;
        const map = index();
        return map.point(map.offset(range.endContainer, range.endOffset))?.node;
      },
      resetCaret() {
        const range = selectedRange();
        if (!range || range.startContainer !== range.endContainer
          || range.startOffset !== 0 || range.endOffset !== 0) return false;
        if (range.endContainer.nodeType === 1) return true;
        // Some frameworks reset to the start of the first text leaf instead of
        // the element boundary. Treat that as a reset only at logical offset 0.
        // Deliberate moves to 0 on surviving anchors are still rejected by the
        // caller (watchCaret requires a lost anchor for rich text).
        if (range.endContainer.nodeType === 3) {
          return index().offset(range.endContainer, 0) === 0;
        }
        return false;
      },
      setCaret(position) {
        const point = index().point(position);
        if (!point) return false;
        const range = doc.createRange();
        range.setStart(point.node, point.offset);
        range.collapse(true);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      },
      caretRect() {
        const range = selectedRange();
        if (!range) return null;
        const caret = doc.createRange();
        caret.setStart(range.endContainer, range.endOffset);
        caret.collapse(true);
        return caret.getBoundingClientRect?.();
      },
      canReplace(start, end) {
        const map = index();
        if (map.text.length > MAX_RICH_TEXT_LENGTH) return false;
        return start >= 0 && end >= start && end <= map.text.length
          && !/[\n\ufffc]/.test(map.text.slice(start, end));
      },
      replace(start, end, text, preferNative = true) {
        const interaction = interactionRevision;
        const map = index();
        if (map.text.length > MAX_RICH_TEXT_LENGTH) return null;
        const previous = selectedRange();
        if (!previous || /[\n\ufffc]/.test(map.text.slice(start, end))) return null;
        const expected = map.text.slice(0, start) + text + map.text.slice(end);
        const old = map.text.slice(start, end);
        let prefix = 0;
        while (prefix < old.length && prefix < text.length && old[prefix] === text[prefix]) prefix += 1;
        const insertedText = text.slice(prefix);
        const from = map.point(start + prefix, { node: previous.startContainer, offset: previous.startOffset });
        const to = map.point(end, { node: previous.endContainer, offset: previous.endOffset });
        if (!from || !to) return null;
        const range = doc.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        const selection = getSelection();
        const restore = doc.createRange();
        restore.setStart(previous.startContainer, previous.startOffset);
        restore.setEnd(previous.endContainer, previous.endOffset);
        const originalStart = map.offset(previous.startContainer, previous.startOffset);
        const originalEnd = map.offset(previous.endContainer, previous.endOffset);
        // Draft's textInput hook updates its model before native insertion and
        // owns removal of its BR/text placeholders. Never delete those first.
        if (preferNative && root.closest('.DraftEditor-root,.public-DraftEditor-content')) {
          selection.removeAllRanges();
          selection.addRange(range);
          doc.dispatchEvent(new Event('selectionchange'));
          const before = insertedText ? new InputEvent('textInput', {
            bubbles: true, composed: true, cancelable: true, data: insertedText,
          }) : new KeyboardEvent('keydown', {
            bubbles: true, composed: true, cancelable: true, key: 'Backspace', keyCode: 8,
          });
          root.dispatchEvent(before);
          if (before.defaultPrevented) {
            const actual = index().text;
            if (actual === map.text && actual !== expected)
              return { changed: true, native: true, deferred: true, expected, caret: start + text.length };
            const current = selectedRange();
            const caret = current && index().offset(current.endContainer, current.endOffset);
            const rebased = typeof caret === 'number' ? caret - text.length : null;
            const valid = rebased !== null && actual.slice(rebased, caret) === text
              && actual.replace(/\n/g, '') === expected.replace(/\n/g, '');
            return { changed: true, native: true, valid, start: rebased };
          }
        }
        const emptyInline = from.node.nodeType === 1 && inlineTags.has(from.node.tagName)
          && !from.node.textContent && !isNativeOnly();
        if (preferNative && !emptyInline && !execCommandSupported(doc)) warnExecCommandOnce();
        if (preferNative && !emptyInline && execCommandSupported(doc)) {
          selection.removeAllRanges();
          selection.addRange(range);
          let success = false;
          let notified = null;
          const command = !insertedText && !range.collapsed ? 'delete' : 'insertText';
          const observe = event => {
            if ((command === 'insertText' && event.data === insertedText && event.inputType === 'insertText')
              || (command === 'delete' && event.inputType?.startsWith('delete'))) notified = index().text;
          };
          root.addEventListener('input', observe, true);
          try { success = doc.execCommand(command, false, insertedText); } catch (_) { /* Native refused. */ }
          finally { root.removeEventListener('input', observe, true); }
          const actual = index().text;
          // A model may briefly restore its old DOM during the native input and
          // commit the verified insertion at the callback's next checkpoint.
          if (success && actual === map.text && notified !== null && actual !== expected
            && notified.replace(/\n/g, '') === expected.replace(/\n/g, '')) {
            return { changed: true, native: true, deferred: true, expected, caret: start + text.length };
          }
          if (actual !== map.text || (success && actual === expected)) {
            // The input callback may rebuild identical text while the browser's
            // live Range falls back to root offset zero. Reconstruct the intended
            // caret only for a verified replacement in the still-focused field.
            if (actual === expected && interaction === interactionRevision) {
              repairCaret(this, expected, start + text.length);
            }
            const inserted = selectedRange();
            const insertedMap = index();
            const caret = inserted && insertedMap.offset(inserted.endContainer, inserted.endOffset);
            const rebased = typeof caret === 'number' ? caret - text.length : null;
            // Native editing can remove an empty BR placeholder or normalize
            // block markup. Rebase the buffer against its actual local caret.
            const valid = interaction === interactionRevision && rebased !== null && rebased >= 0
              && insertedMap.text.slice(rebased, caret) === text
              && (actual !== expected || caret === start + text.length)
              && actual.replace(/\n/g, '') === expected.replace(/\n/g, '');
            return { changed: true, native: true, valid, start: rebased };
          }
          selection.removeAllRanges();
          selection.addRange(restore);
          const restoredMap = index();
          if (!root.contains(from.node) || !root.contains(to.node)
            || restoredMap.offset(restore.startContainer, restore.startOffset) !== originalStart
            || restoredMap.offset(restore.endContainer, restore.endOffset) !== originalEnd) return null;
        }
        // Never directly mutate a framework's document model. A failed native
        // command leaves its DOM/selection intact and the original edit native.
        if (isNativeOnly()) return null;
        if (from.node === to.node && from.node.nodeType === 3) {
          from.node.replaceData(from.offset, to.offset - from.offset, insertedText);
          range.setStart(from.node, from.offset + insertedText.length);
        } else {
          range.setStart(from.node, from.offset);
          range.setEnd(to.node, to.offset);
          range.deleteContents();
          if (insertedText) {
            const node = doc.createTextNode(insertedText);
            range.insertNode(node);
            range.setStartAfter(node);
          }
        }
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return { changed: true, native: false, valid: true };
      },
    };
  }

  function allowed(root, event) {
    return settings.enabled && settings.mode === 'bangla'
      && !event.isComposing && !composing.has(root);
  }

  function save(edit) {
    // One DOM walk via snapshot(); text() + selection() would walk twice.
    const snap = typeof edit.snapshot === 'function'
      ? edit.snapshot()
      : { text: edit.text(), selection: edit.selection() };
    snapshots.set(edit.root, snap);
  }

  function focused(root) {
    let active = root.ownerDocument.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return root.isConnected && editable(active) === root;
  }

  // ── Section 2: caret repair ─────────────────────────────────────────────
  // Rerender recovery is bounded (MAX_CARET_CHECKS microtasks + one task) and
  // never fights deliberate navigation: callers require a lost DOM anchor or
  // an explicit boundary reset before repairing, and stop on focus/mode/text
  // changes via interactionRevision/focused() checks.

  function repairCaret(edit, expected, position) {
    if (!focused(edit.root) || edit.text() !== expected) return false;
    const selection = edit.selection();
    // An outside selection or a selected range is not a collapsed rerender reset.
    if (!selection || selection.start !== selection.end) return false;
    if (selection.end !== position && edit.setCaret(position) === false) return false;
    return true;
  }

  function watchCaret(edit, expected, position, afterInput = false) {
    const ticket = { node: edit.caretNode?.() };
    caretRepair = ticket;
    ticket.check = (allowInput = true) => {
      if (caretRepair !== ticket) return false;
      const selection = edit.selection();
      const moved = selection?.start !== position || selection?.end !== position;
      // Rich text must actually have lost its old DOM anchor; a simple caret
      // move on surviving nodes is user navigation, not a rerender to repair.
      const reset = ticket.node ? edit.resetCaret() : selection?.start === 0 && selection?.end === 0;
      if ((moved && (!reset || (!ticket.node && !allowInput) || (ticket.node && edit.root.contains(ticket.node))))
        || !repairCaret(edit, expected, position)) {
        commit();
        return false;
      }
      ticket.node = edit.caretNode?.();
      if (moved) {
        save(edit);
        showSuggestions(edit);
      }
      return true;
    };
    function check(remaining) {
      if (ticket.check() && remaining > 1) queueMicrotask(() => check(remaining - 1));
    }
    // Native input is observed in capture, before the site's input callbacks can
    // queue their rerender. Arm after dispatch, then use bounded checks.
    queueMicrotask(() => {
      if (afterInput) queueMicrotask(() => check(MAX_CARET_CHECKS));
      else check(MAX_CARET_CHECKS);
    });
    // Chrome checkpoints microtasks between propagation callbacks. Keep the
    // verified ticket until one task after dispatch/model reconciliation, and
    // consume it before a subsequent keystroke or selectionchange if necessary.
    setTimeout(() => {
      if (caretRepair === ticket) {
        ticket.check();
        if (caretRepair === ticket) caretRepair = null;
      }
    }, 0);
  }

  function flushCaret(allowInput = false) {
    return caretRepair?.check(allowInput);
  }

  function watchNative(edit, plan, result) {
    // If a prior deferred-native ticket is still waiting, abandon it now.
    // Two rapid keystrokes can each produce a deferred result; without this,
    // the second call overwrites caretRepair and the first ticket's commit()
    // is never reached, leaving a stale word buffer.
    if (caretRepair?.waiting) commit();
    const ticket = { waiting: true };
    const revision = interactionRevision;
    const normalized = result.expected.replace(/\n/g, '');
    const before = edit.text();
    caretRepair = ticket;
    ticket.check = (_allowInput, final = false) => {
      if (caretRepair !== ticket) return false;
      const actual = edit.text();
      if (revision !== interactionRevision || !focused(edit.root)) { commit(); return false; }
      if (actual.replace(/\n/g, '') !== normalized) {
        if (!final && actual === before) return true;
        commit();
        return false;
      }
      // Rebase through the model's native block/BR normalization, without
      // changing any of its text or markup.
      const length = result.expected.slice(0, result.caret).replace(/\n/g, '').length;
      let caret = 0;
      let count = 0;
      while (caret < actual.length && count < length) {
        if (actual[caret] !== '\n') count += 1;
        caret += 1;
      }
      const start = caret - plan.rendered.length;
      if (actual.slice(start, caret) !== plan.rendered || !repairCaret(edit, actual, caret)) {
        commit();
        return false;
      }
      word = plan.word && { ...plan.word, start: start + plan.word.start - plan.start };
      save(edit);
      watchCaret(edit, actual, caret);
      showSuggestions(edit);
      return true;
    };
    queueMicrotask(() => ticket.check());
    setTimeout(() => ticket.check(true, true), 0);
  }

  function currentWord(edit, selection, cachedText) {
    if (!word) return null;
    if (!edit.root.isConnected || word.root !== edit.root || !selection
      || selection.start !== selection.end
      || selection.start !== word.start + word.rendered.length) {
      commit();
      return null;
    }
    // Callers on the hot path pass their already-read text to avoid a second
    // DOM walk; otherwise read once here.
    const text = cachedText !== undefined ? cachedText : edit.text();
    if (text.slice(word.start, selection.start) !== word.rendered) {
      commit();
      return null;
    }
    return word;
  }

  // ── Section 3: Latin-word plans (pure, no DOM writes) ───────────────────
  // Only the inserted text / current Latin word is converted. Existing Latin or
  // Bangla around it is never scanned or rewritten. A backtick starts one raw
  // Latin word: it remains visible until a letter arrives, then is consumed.
  function insertion(root, start, data, active) {
    if (!/[A-Za-z`]/.test(data)) return null;
    const continued = active && /^[A-Za-z]/.test(data);
    const source = continued ? (active.raw ? '`' : '') + active.latin + data : data;
    if (continued) start = active.start;
    const parts = source.match(/`[A-Za-z]*|[A-Za-z]+|[^A-Za-z`]+/g) || [];
    let rendered = '';
    let nextWord = null;
    try {
      for (const part of parts) {
        const raw = part[0] === '`';
        const latin = raw ? part.slice(1) : part;
        const isWord = raw || /^[A-Za-z]+$/.test(part);
        const value = raw ? latin || '`' : isWord ? engine.transliterate(latin) : part;
        if (typeof value !== 'string') return null;
        nextWord = isWord
          ? { root, start: start + rendered.length, latin, raw, rendered: value } : null;
        rendered += value;
      }
    } catch (_) { return null; }
    return { start, rendered, word: nextWord };
  }

  function deletion(active) {
    const latin = active.latin.slice(0, -1);
    let rendered;
    try {
      rendered = active.raw ? latin || (active.latin ? '`' : '')
        : latin ? engine.transliterate(latin) : '';
    } catch (_) { return null; }
    if (typeof rendered !== 'string') return null;
    return {
      start: active.start,
      rendered,
      word: rendered ? { ...active, latin, rendered } : null,
    };
  }

  function replace(edit, plan, end, notify, inputType) {
    const revision = settingsRevision;
    const interaction = interactionRevision;
    emitting = true;
    let result;
    try {
      result = edit.replace(plan.start, end, plan.rendered, notify);
      if (!result?.changed) return false;
      if (result.deferred) {
        if (revision === settingsRevision && interaction === interactionRevision) watchNative(edit, plan, result);
        else commit();
        return true;
      }
      word = result.valid && revision === settingsRevision && interaction === interactionRevision && settings.enabled
        && settings.mode === 'bangla' ? plan.word : null;
      if (word && typeof result.start === 'number') {
        word = { ...word, start: result.start + word.start - plan.start };
      }
      if (!word) commit(true);
      const expected = edit.text();
      const caret = (typeof result.start === 'number' ? result.start : plan.start) + plan.rendered.length;
      // execCommand already notifies model-driven editors and joins native undo.
      if (notify && !result.native) {
        edit.root.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType,
          data: inputType === 'deleteContentBackward' ? null : plan.rendered,
          isComposing: false,
        }));
      }
      if (result.valid && revision === settingsRevision && interaction === interactionRevision
        && repairCaret(edit, expected, caret)) watchCaret(edit, expected, caret);
      else commit();
      save(edit);
    } finally { emitting = false; }
    showSuggestions(edit);
    return true;
  }

  // ── Section 4: event wiring (delegated, document-level) ───────────────────

  document.addEventListener('beforeinput', event => {
    if (emitting || event.defaultPrevented) return;
    flushCaret(true);
    caretRepair = null;
    interactionRevision += 1;
    const root = editable(targetOf(event));
    const edit = adapter(root);
    if (!edit) { commit(); return; }
    const snap = typeof edit.snapshot === 'function'
      ? edit.snapshot() : { text: edit.text(), selection: edit.selection() };
    const selection = snap.selection;
    const active = currentWord(edit, selection, snap.text);
    const record = { text: snap.text, selection, active: active && { ...active },
      data: event.data, inputType: event.inputType, revision: settingsRevision };
    snapshots.set(root, record);
    pending.set(root, record);
    if (compositionCommits.has(root)) {
      const committed = compositionCommits.get(root);
      compositionCommits.delete(root);
      if (event.data === committed && event.inputType?.startsWith('insert')) {
        record.ignoreComposition = true;
        commit();
        return;
      }
    }
    if (!allowed(root, event) || !selection) { commit(); return; }

    let plan = null;
    if (event.inputType === 'insertText' && typeof event.data === 'string') {
      plan = insertion(root, selection.start, event.data, active);
    } else if (event.inputType === 'deleteContentBackward' && active) {
      plan = deletion(active);
    }
    if (plan && edit.canReplace && !edit.canReplace(plan.start, selection.end)) plan = null;
    if (plan && event.cancelable) {
      if (replace(edit, plan, selection.end, true, event.inputType)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pending.delete(root);
      } else {
        commit();
        record.active = null;
      }
    } else if (!plan) {
      // Separators, paste, Enter, undo and other native operations commit the word.
      commit();
      record.active = null;
    }
  }, true);

  document.addEventListener('input', event => {
    if (emitting) return;
    caretRepair = null;
    interactionRevision += 1;
    const root = editable(targetOf(event));
    const edit = adapter(root);
    if (!edit) { commit(); return; }
    const record = pending.get(root) || snapshots.get(root);
    pending.delete(root);
    const selection = edit.selection();
    const finalComposition = compositionCommits.has(root)
      && (event.data === compositionCommits.get(root)
        || ['insertCompositionText', 'insertFromComposition'].includes(event.inputType));
    compositionCommits.delete(root);
    if (!allowed(root, event) || !selection || selection.start !== selection.end
      || record?.ignoreComposition || finalComposition
      || (record?.revision !== undefined && record.revision !== settingsRevision)) {
      commit();
      save(edit);
      return;
    }
    const text = edit.text();
    const type = event.inputType || record?.inputType;
    let data = typeof event.data === 'string' ? event.data : record?.data;
    const separator = type === 'insertText' && typeof data === 'string' && data.length > 0
      && !/[A-Za-z`]/.test(data);
    const newline = ['insertLineBreak', 'insertParagraph'].includes(type);
    if (separator || newline) {
      const before = record?.selection;
      const expected = before && record.text.slice(0, before.start)
        + (separator ? data : '') + record.text.slice(before.end);
      // Enter markup varies between editors. Capture its native logical text
      // only when non-newline content is unchanged, then require exact equality
      // during repair. Separators must match the complete expected insertion.
      const verified = before && (separator
        ? text === expected && selection.end === before.start + data.length
        : text.replace(/\n/g, '') === expected.replace(/\n/g, ''));
      commit();
      save(edit);
      if (verified) watchCaret(edit, text, selection.end, true);
      return;
    }
    // Model-owned DOM still has no direct transliteration fallback. Protecting
    // an already-native separator above changes only its collapsed selection.
    if (edit.nativeOnly) {
      commit();
      save(edit);
      return;
    }
    let plan = null;
    const active = record?.active || word;
    if (type === 'deleteContentBackward' && active && record?.selection
      && record.selection.start === record.selection.end
      && record.selection.end === active.start + active.rendered.length
      && selection.end >= active.start && selection.end < record.selection.end
      && text.slice(0, active.start) === record.text.slice(0, active.start)
      && text.slice(selection.end) === record.text.slice(record.selection.end)) {
      plan = deletion(active);
    } else if (type === 'insertText') {
      let start = selection.end - (typeof data === 'string' ? data.length : 0);
      if (typeof data !== 'string' && record?.selection) {
        // Fallback for an input event that omits data, bounded by the old selection.
        const suffix = record.text.slice(record.selection.end);
        start = record.selection.start;
        if (text.startsWith(record.text.slice(0, start)) && text.endsWith(suffix))
          data = text.slice(start, text.length - suffix.length);
      }
      if (typeof data === 'string' && start >= 0
        && text.slice(start, selection.end) === data) {
        const continued = active && record
          && record.selection?.start === record.selection?.end
          && start === active.start + active.rendered.length
          && text.slice(active.start, start) === active.rendered;
        plan = insertion(root, start, data, continued ? active : null);
      }
    }
    if (plan && (!edit.canReplace || edit.canReplace(plan.start, selection.end))
      && replace(edit, plan, selection.end, false, type)) return;
    commit();
    save(edit);
  }, true);

  function panelTarget(target) {
    if (!suggestions || !target) return false;
    const element = target.nodeType === 1 ? target : target.parentElement;
    // Pointer events are retargeted at the panel's host outside its shadow tree.
    // Keep the selection alive until the candidate click callback can validate it.
    const selector = '[data-shobdo-suggestions],#shobdo-suggestions';
    return !!element && (!!element.closest(selector)
      || !!element.getRootNode()?.host?.matches(selector));
  }

  document.addEventListener('focusin', event => {
    if (panelTarget(targetOf(event))) return;
    caretRepair = null;
    interactionRevision += 1;
    const edit = adapter(editable(targetOf(event)));
    if (word && word.root !== edit?.root) commit();
    if (edit) save(edit);
  }, true);
  document.addEventListener('focusout', event => {
    if (!panelTarget(event.relatedTarget)) commit();
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!panelTarget(targetOf(event))) commit();
  }, true);
  document.addEventListener('keydown', event => {
    const root = editable(targetOf(event));
    if (root && !event.isComposing) compositionCommits.delete(root);
    const navigation = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End',
      'PageUp', 'PageDown', 'Escape', 'Tab', 'Enter'].includes(event.key)
      || event.ctrlKey || event.metaKey || event.altKey;
    if (emitting) { if (navigation) commit(); return; }
    if (!navigation && !event.isComposing) flushCaret(true);
    if (!event.isComposing && word && !composing.has(word.root)) {
      const edit = adapter(editable(word.root));
      if (edit && currentWord(edit, edit.selection()) && suggestions?.handleKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (navigation) { commit(); return; }
    // These editors handle the original keystroke themselves. Insert via the
    // browser before that event stream begins, retaining its native input/model
    // notification, and swallow the original key only when insertion succeeds.
    // The original event is suppressed exclusively on a verified replace();
    // a refused/failed insert leaves DOM, selection and the event untouched.
    if (!root?.closest(earlyNativeEditor) || root.childNodes.length === 0
      || !root.isConnected || !focused(root)
      || !allowed(root, event) || event.defaultPrevented
      || !event.cancelable || !execCommandSupported(root.ownerDocument)) {
      if (root && !execCommandSupported(root.ownerDocument)) warnExecCommandOnce();
      return;
    }
    const edit = adapter(root);
    const selection = edit.selection();
    if (!selection) return;
    const active = currentWord(edit, selection);
    const type = event.key === 'Backspace' ? 'deleteContentBackward' : 'insertText';
    const plan = /^[A-Za-z`]$/.test(event.key) ? insertion(root, selection.start, event.key, active)
      : event.key === 'Backspace' && active ? deletion(active) : null;
    if (plan && edit.canReplace(plan.start, selection.end)
      && replace(edit, plan, selection.end, true, type)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pending.delete(root);
    }
  }, true);
  document.addEventListener('selectionchange', event => {
    if (emitting) return;
    // Only a lost anchor collapsed to a DOM boundary can be repaired. A move on
    // surviving nodes or a deliberate selection invalidates the pending ticket.
    flushCaret(event.isTrusted);
    if (caretRepair?.waiting) return;
    if (word) {
      const edit = adapter(editable(word.root));
      if (!edit) commit();
      else currentWord(edit, edit.selection());
    }
  });
  document.addEventListener('compositionstart', event => {
    const root = editable(targetOf(event));
    if (root) {
      composing.add(root);
      compositionCommits.delete(root);
    }
    commit();
  }, true);
  document.addEventListener('compositionend', event => {
    const root = editable(targetOf(event));
    if (root) {
      composing.delete(root);
      compositionCommits.set(root, event.data);
      pending.delete(root);
      // Guard adapter() explicitly: focusin does the same, and adapter()
      // is a separate step from editable() that could return null.
      const edit = adapter(root);
      if (edit) save(edit);
    }
    commit();
  }, true);
})();
