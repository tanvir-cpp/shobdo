'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const engine = require('../extension/engine.js');
const suggestions = require('../extension/suggestions.js');
const source = fs.readFileSync(path.join(__dirname, '../extension/suggestions.js'), 'utf8');

function setup(t, markup = '<textarea aria-label="Message" aria-autocomplete="none"></textarea>', parse = engine.transliterate) {
  const dom = new JSDOM(markup, { runScripts: 'outside-only', url: 'https://example.test/' });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.ShobdoEngine = { transliterate: parse };
  vm.runInContext(source, dom.getInternalVMContext(), { filename: 'suggestions.js' });
  const root = window.document.querySelector('textarea,input,[contenteditable]');
  const accepted = [];
  const controller = window.ShobdoSuggestions.create(candidate => accepted.push(candidate));
  t.after(() => controller.hide());
  const host = () => window.document.querySelector('[data-shobdo-suggestions]');
  const options = () => Array.from(host()?.shadowRoot.querySelectorAll('[role=option]') || []);
  function show(latin = 'bhalo', extra = {}) {
    controller.show({ root, latin, rendered: engine.transliterate(latin), ...extra });
  }
  function key(name, extra = {}) {
    const event = new window.KeyboardEvent('keydown', { key: name, cancelable: true, ...extra });
    return { handled: controller.handleKey(event), event };
  }
  return { dom, window, root, accepted, controller, host, options, show, key };
}

test('everyday vocabulary includes over 100 curated correct word spellings', () => {
  // An independently enumerated acceptance sample, including pronouns, food,
  // family, time, places and verbs; not a claim of general dictionary coverage.
  const words = [
    ['ami', 'আমি'], ['tumi', 'তুমি'], ['tomar', 'তোমার'], ['bhalo', 'ভালো'],
    ['bangla', 'বাংলা'], ['kemon', 'কেমন'], ['acho', 'আছো'], ['amra', 'আমরা'],
    ['amar', 'আমার'], ['amader', 'আমাদের'], ['tomra', 'তোমরা'], ['tomader', 'তোমাদের'],
    ['apni', 'আপনি'], ['apnar', 'আপনার'], ['apnara', 'আপনারা'], ['apnader', 'আপনাদের'],
    ['se', 'সে'], ['tar', 'তার'], ['tara', 'তারা'], ['tader', 'তাদের'],
    ['eta', 'এটা'], ['ota', 'ওটা'], ['ekhane', 'এখানে'], ['okhane', 'ওখানে'],
    ['ki', 'কি'], ['keno', 'কেন'], ['kothay', 'কোথায়'], ['kokhon', 'কখন'],
    ['kibhabe', 'কীভাবে'], ['ha', 'হ্যাঁ'], ['na', 'না'], ['ache', 'আছে'],
    ['achi', 'আছি'], ['achhen', 'আছেন'], ['chilo', 'ছিল'], ['chilam', 'ছিলাম'],
    ['hobe', 'হবে'], ['hoy', 'হয়'], ['nei', 'নেই'], ['nai', 'নাই'], ['ebong', 'এবং'],
    ['ar', 'আর'], ['kintu', 'কিন্তু'], ['jodi', 'যদি'], ['tai', 'তাই'],
    ['tobe', 'তবে'], ['abar', 'আবার'], ['onek', 'অনেক'], ['ektu', 'একটু'],
    ['khub', 'খুব'], ['sob', 'সব'], ['sobai', 'সবাই'], ['kichu', 'কিছু'],
    ['shudhu', 'শুধু'], ['beshi', 'বেশি'], ['kom', 'কম'], ['boro', 'বড়'],
    ['chhoto', 'ছোট'], ['notun', 'নতুন'], ['purono', 'পুরোনো'], ['sundor', 'সুন্দর'],
    ['kharap', 'খারাপ'], ['thik', 'ঠিক'], ['bhul', 'ভুল'], ['sotti', 'সত্যি'],
    ['dhonnobad', 'ধন্যবাদ'], ['dukkhito', 'দুঃখিত'], ['swagotom', 'স্বাগতম'],
    ['bondhu', 'বন্ধু'], ['ma', 'মা'], ['baba', 'বাবা'], ['bhai', 'ভাই'],
    ['bon', 'বোন'], ['dada', 'দাদা'], ['didi', 'দিদি'], ['chele', 'ছেলে'],
    ['meye', 'মেয়ে'], ['manush', 'মানুষ'], ['poribar', 'পরিবার'],
    ['aj', 'আজ'], ['kal', 'কাল'], ['ekhon', 'এখন'], ['pore', 'পরে'],
    ['age', 'আগে'], ['ajke', 'আজকে'], ['gotokal', 'গতকাল'], ['agamikal', 'আগামীকাল'],
    ['sokal', 'সকাল'], ['dupur', 'দুপুর'], ['bikel', 'বিকেল'], ['sondha', 'সন্ধ্যা'],
    ['rat', 'রাত'], ['din', 'দিন'], ['shomoy', 'সময়'], ['ghonta', 'ঘণ্টা'],
    ['shoptaho', 'সপ্তাহ'], ['mash', 'মাস'], ['bochor', 'বছর'], ['bari', 'বাড়ি'],
    ['ghor', 'ঘর'], ['dorja', 'দরজা'], ['janala', 'জানালা'], ['rasta', 'রাস্তা'],
    ['shohor', 'শহর'], ['gram', 'গ্রাম'], ['desh', 'দেশ'], ['bangladesh', 'বাংলাদেশ'],
    ['dhaka', 'ঢাকা'], ['kolkata', 'কলকাতা'], ['dokan', 'দোকান'], ['bajar', 'বাজার'],
    ['school', 'স্কুল'], ['college', 'কলেজ'], ['hashpatal', 'হাসপাতাল'], ['ofis', 'অফিস'],
    ['khabar', 'খাবার'], ['bhat', 'ভাত'], ['dal', 'ডাল'], ['mach', 'মাছ'],
    ['mangsho', 'মাংস'], ['dim', 'ডিম'], ['dudh', 'দুধ'], ['cha', 'চা'],
    ['kofi', 'কফি'], ['pani', 'পানি'], ['jol', 'জল'], ['ruti', 'রুটি'],
    ['alu', 'আলু'], ['peyaj', 'পেঁয়াজ'], ['lobon', 'লবণ'], ['chini', 'চিনি'],
    ['mishti', 'মিষ্টি'], ['fol', 'ফল'], ['kola', 'কলা'], ['aam', 'আম'],
    ['lebu', 'লেবু'], ['ranna', 'রান্না'], ['khai', 'খাই'], ['khao', 'খাও'],
    ['khabo', 'খাবো'], ['jao', 'যাও'], ['jabo', 'যাবো'], ['jai', 'যাই'],
    ['esho', 'এসো'], ['ashbo', 'আসবো'], ['kori', 'করি'], ['koro', 'করো'],
    ['korbo', 'করবো'], ['korchi', 'করছি'], ['bolo', 'বলো'], ['bolbo', 'বলবো'],
    ['bolchi', 'বলছি'], ['dekhi', 'দেখি'], ['dekho', 'দেখো'], ['dekhbo', 'দেখবো'],
    ['shuni', 'শুনি'], ['shono', 'শোনো'], ['jani', 'জানি'], ['jano', 'জানো'],
    ['bujhi', 'বুঝি'], ['bujho', 'বুঝো'], ['chai', 'চাই'], ['parbo', 'পারবো'],
    ['pari', 'পারি'], ['dao', 'দাও'], ['debo', 'দেবো'], ['dibo', 'দিবো'], ['nao', 'নাও'],
    ['kinbo', 'কিনবো'], ['likhi', 'লিখি'], ['lekha', 'লেখা'], ['pora', 'পড়া'],
    ['ghum', 'ঘুম'], ['bosho', 'বসো'], ['cholo', 'চলো'], ['thako', 'থাকো'],
    ['bhalobashi', 'ভালোবাসি'], ['bhalobasha', 'ভালোবাসা'], ['kaj', 'কাজ'],
    ['taka', 'টাকা'], ['dam', 'দাম'], ['boi', 'বই'], ['khata', 'খাতা'],
    ['kolom', 'কলম'], ['chithi', 'চিঠি'], ['bhasha', 'ভাষা'], ['kotha', 'কথা'],
    ['gan', 'গান'], ['golpo', 'গল্প'], ['chhobi', 'ছবি'], ['khela', 'খেলা'],
    ['khobor', 'খবর'], ['nam', 'নাম'], ['shorir', 'শরীর'], ['matha', 'মাথা'],
    ['chokh', 'চোখ'], ['hat', 'হাত'], ['pa', 'পা'], ['mon', 'মন'], ['koshto', 'কষ্ট'],
    ['hashi', 'হাসি'], ['kanna', 'কান্না'], ['alo', 'আলো'], ['akash', 'আকাশ'],
    ['batash', 'বাতাস'], ['brishti', 'বৃষ্টি'], ['megh', 'মেঘ'], ['rod', 'রোদ'],
    ['chand', 'চাঁদ'], ['gach', 'গাছ'], ['ful', 'ফুল'], ['pata', 'পাতা'],
    ['nodi', 'নদী'], ['mati', 'মাটি'], ['pahar', 'পাহাড়'], ['pakhi', 'পাখি'],
    ['biral', 'বিড়াল'], ['kukur', 'কুকুর'], ['gorom', 'গরম'], ['thanda', 'ঠান্ডা'],
    ['lal', 'লাল'], ['nil', 'নীল'], ['sobuj', 'সবুজ'], ['shada', 'সাদা'],
    ['kalo', 'কালো'], ['ek', 'এক'], ['dui', 'দুই'], ['tin', 'তিন'], ['char', 'চার'],
    ['pach', 'পাঁচ'], ['chhoy', 'ছয়'], ['sat', 'সাত'], ['at', 'আট'],     ['noy', 'নয়'],
    ['dosh', 'দশ'], ['sona', 'সোনা'], ['sonar', 'সোনার'],
  ];
  assert.ok(words.length > 100);
  for (const [latin, text] of words) {
    assert.deepEqual(suggestions.getCandidates(latin, 1), [{ text, latin:
      latin === 'ache' ? 'achhe' : latin,
    kind: 'exact' }], latin);
  }
});

test('common variants and mixed-case phonetic input rank canonical Bangla first', () => {
  for (const [latin, text] of [['accho', 'আছো'], ['achho', 'আছো'], ['valo', 'ভালো'],
    ['bhalO', 'ভালো'], ['tumar', 'তোমার'], ['Ami', 'আমি'], ['shundor', 'সুন্দর'],
    ['bristi', 'বৃষ্টি'], ['chobi', 'ছবি'], ['valobashi', 'ভালোবাসি']]) {
    assert.equal(suggestions.getCandidates(latin)[0].text, text, latin);
    assert.equal(suggestions.getCandidates(latin)[0].kind, 'exact', latin);
  }
});

test('short prefix completions follow exact matches and precede typo corrections', () => {
  const complete = suggestions.getCandidates('ban');
  assert.equal(complete[0].text, 'বাংলা');
  assert.equal(complete[0].kind, 'completion');
  assert.ok(!complete.some(word => word.text === 'বাংলাদেশ'), 'long completions are excluded');
  const exact = suggestions.getCandidates('am');
  assert.equal(exact[0].text, 'আম');
  assert.equal(exact[0].kind, 'exact');
  assert.equal(exact[1].kind, 'completion');
  assert.ok(exact.some(word => word.text === 'আমি'));
});

test('adjacent transpositions, omissions and substitutions yield likely corrections', () => {
  for (const [latin, text] of [['banlga', 'বাংলা'], ['bhlo', 'ভালো'], ['tmoar', 'তোমার'],
    ['kemom', 'কেমন'], ['brishit', 'বৃষ্টি']]) {
    assert.equal(suggestions.getCandidates(latin)[0].text, text, latin);
    assert.equal(suggestions.getCandidates(latin)[0].kind, 'correction', latin);
  }
});

test('literal fallback uses ShobdoEngine; results dedupe spellings and bound limits', () => {
  assert.deepEqual(suggestions.getCandidates('qxzv'), [
    { text: engine.transliterate('qxzv'), latin: 'qxzv', kind: 'literal' },
  ]);
  for (const word of ['ami', 'am', 'banlga', 'bhlo', 'tara', 'accho', 'bhalO']) {
    const result = suggestions.getCandidates(word, 100);
    assert.ok(result.length <= 5);
    assert.equal(new Set(result.map(candidate => candidate.text)).size, result.length);
    assert.deepEqual(result, suggestions.getCandidates(word, 100));
    assert.deepEqual(suggestions.getCandidates(word, 2), result.slice(0, 2));
    assert.deepEqual(Object.keys(result[0]).sort(), ['kind', 'latin', 'text']);
  }
  assert.deepEqual(suggestions.getCandidates('ami', 0), []);
  assert.deepEqual(suggestions.getCandidates('ami', -2), []);
  assert.equal(suggestions.getCandidates('ami', 1.9).length, 1);
});

test('acronyms, raw escapes, non-Latin input and long tokens never produce suggestions', t => {
  let calls = 0;
  const page = setup(t, undefined, input => { calls++; return input; });
  for (const input of ['NASA', 'API', 'HTML', 'BHALO', 'OI', '\\ami', '`ami',
    'ami ', 'a1', 'আমি', '', null, {}, 'x'.repeat(100000)]) {
    assert.equal(page.window.ShobdoSuggestions.getCandidates(input).length, 0);
  }
  assert.equal(calls, 0, 'no unbounded transliteration work for rejected tokens');
  const maximum = 'x'.repeat(48);
  const result = page.window.ShobdoSuggestions.getCandidates(maximum);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'literal');
  assert.equal(calls, 1);
});

test('panel is lazy, marked, isolated, limited and accessible without changing field attributes', t => {
  const page = setup(t, '<style>button { display:none !important }</style><textarea aria-label="Message" aria-autocomplete="none" aria-expanded="false"></textarea>');
  const before = page.root.outerHTML;
  assert.equal(page.host(), null);
  page.show('a');
  assert.equal(page.host(), null);
  page.show('am');
  assert.ok(page.host().shadowRoot);
  assert.equal(page.host().children.length, 0, 'all visible controls are in the shadow tree');
  assert.ok(page.options().length <= 5);
  assert.equal(page.options()[0].getAttribute('aria-selected'), 'true');
  const list = page.host().shadowRoot.querySelector('[role=listbox]');
  assert.match(list.getAttribute('aria-label'), /Bangla spelling/);
  assert.equal(list.getAttribute('aria-activedescendant'), page.options()[0].id);
  assert.equal(page.root.outerHTML, before);
  assert.equal(page.host().style.getPropertyValue('z-index'), '2147483647');
  assert.equal(page.host().style.getPropertyPriority('position'), 'important');
  assert.ok(page.options().every(option => option.tabIndex === -1 && option.type === 'button'));
  page.controller.hide();
  assert.equal(page.host(), null);
});

test('Up/Down changes the highlight; Tab accepts once; Escape dismisses', t => {
  const page = setup(t);
  page.show('am');
  const count = page.options().length;
  assert.ok(count > 1);
  assert.equal(page.key('ArrowUp').handled, true);
  assert.equal(page.options()[count - 1].getAttribute('aria-selected'), 'true');
  assert.equal(page.key('ArrowDown').handled, true);
  assert.equal(page.options()[0].getAttribute('aria-selected'), 'true');
  page.key('ArrowDown');
  const next = page.window.ShobdoSuggestions.getCandidates('am')[1];
  const tab = page.key('Tab');
  assert.equal(tab.handled, true);
  assert.equal(tab.event.defaultPrevented, true);
  assert.equal(page.accepted.length, 1);
  assert.equal(page.accepted[0].text, next.text);
  assert.equal(page.host(), null);
  assert.equal(page.key('Tab').handled, false);
  page.show();
  assert.equal(page.key('Escape').handled, true);
  assert.equal(page.host(), null);
  assert.equal(page.accepted.length, 1);
});

test('Enter, modifier shortcuts, Shift-Tab and IME stay native while suggestions are visible', t => {
  const page = setup(t);
  page.show();
  for (const [name, extra] of [['Enter', {}], ['Tab', { shiftKey: true }],
    ['ArrowDown', { shiftKey: true }], ['ArrowDown', { ctrlKey: true }],
    ['ArrowUp', { metaKey: true }], ['Tab', { altKey: true }],
    ['Tab', { isComposing: true }], ['Process', {}], ['a', {}]]) {
    const result = page.key(name, extra);
    assert.equal(result.handled, false, name);
    assert.equal(result.event.defaultPrevented, false, name);
  }
  assert.equal(page.accepted.length, 0);
  assert.ok(page.host());
});

test('pointerdown preserves field focus and selection; click accepts only once', t => {
  const page = setup(t);
  page.root.value = 'আমি';
  page.root.focus();
  page.root.setSelectionRange(1, 2);
  page.show('ami');
  const option = page.options()[0];
  for (const name of ['pointerdown', 'mousedown']) {
    const down = new page.window.MouseEvent(name, { bubbles: true, composed: true, cancelable: true });
    option.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.equal(page.window.document.activeElement, page.root);
    assert.deepEqual([page.root.selectionStart, page.root.selectionEnd], [1, 2]);
  }
  assert.equal(page.accepted.length, 0);
  option.click();
  option.click();
  assert.equal(page.accepted.length, 1);
  assert.equal(page.accepted[0].text, 'আমি');
  assert.equal(page.host(), null);
  assert.equal(page.window.document.activeElement, page.root);
});

test('pointer interaction preserves a rich-text range and hover updates the selected option', t => {
  const page = setup(t, '<div contenteditable="true">আমি</div>');
  page.root.focus();
  const range = page.window.document.createRange();
  range.setStart(page.root.firstChild, 1);
  range.setEnd(page.root.firstChild, 2);
  const selection = page.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  page.show('am');
  const option = page.options()[1];
  option.dispatchEvent(new page.window.Event('pointerenter'));
  assert.equal(option.getAttribute('aria-selected'), 'true');
  const down = new page.window.MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true });
  option.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(selection.getRangeAt(0).startOffset, 1);
  assert.equal(selection.getRangeAt(0).endOffset, 2);
  assert.equal(page.window.document.activeElement, page.root);
  page.key('Tab');
  assert.equal(page.accepted[0].text, page.window.ShobdoSuggestions.getCandidates('am')[1].text);
});

test('old detached options cannot accept a later composition', t => {
  const page = setup(t);
  page.show('ami');
  const stale = page.options()[0];
  page.show('tumi');
  stale.click();
  assert.equal(page.accepted.length, 0);
  page.options()[0].click();
  assert.equal(page.accepted.length, 1);
  assert.equal(page.accepted[0].text, 'তুমি');
});

test('callback reentrancy cannot accept the same candidate twice', t => {
  const page = setup(t);
  let option;
  let calls = 0;
  const controller = page.window.ShobdoSuggestions.create(() => {
    calls++;
    option.click();
  });
  t.after(() => controller.hide());
  controller.show({ root: page.root, latin: 'ami', rendered: 'আমি' });
  option = page.options()[0];
  option.click();
  assert.equal(calls, 1);
});

test('site scrolling and resizing reposition without detaching options or losing highlight', t => {
  const page = setup(t, '<div><textarea></textarea></div>');
  let top = 100;
  page.root.getBoundingClientRect = () => ({ left: 20, top, bottom: top + 20, width: 100, height: 20 });
  page.show();
  const host = page.host();
  const option = page.options()[0];
  page.key('ArrowDown');
  top = 50;
  page.root.parentElement.dispatchEvent(new page.window.Event('scroll'));
  assert.equal(page.host(), host);
  assert.equal(page.options()[0], option);
  assert.equal(page.host().style.top, '74px');
  assert.equal(page.options()[1].getAttribute('aria-selected'), 'true');
  page.window.dispatchEvent(new page.window.Event('resize'));
  assert.equal(page.host(), host);
  assert.equal(page.accepted.length, 0);
});

test('removed roots dismiss via MutationObserver and cannot accept even before its callback', async t => {
  const page = setup(t);
  page.show();
  const option = page.options()[0];
  page.root.remove();
  option.click();
  assert.equal(page.accepted.length, 0);
  assert.equal(page.host(), null);
  page.window.document.body.append(page.root);
  page.show();
  page.root.remove();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.host(), null);
  assert.equal(page.key('Tab').handled, false);
});

test('open-shadow roots support panel mounting, shadow scroll and nested disconnection', async t => {
  const page = setup(t);
  const outer = page.window.document.createElement('div');
  page.window.document.body.append(outer);
  const first = outer.attachShadow({ mode: 'open' });
  const inner = page.window.document.createElement('div');
  first.append(inner);
  const second = inner.attachShadow({ mode: 'open' });
  second.append(page.root);
  page.show();
  assert.ok(page.host());
  page.root.dispatchEvent(new page.window.Event('scroll'));
  assert.ok(page.host());
  page.show();
  inner.remove();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.host(), null);
});

test('position follows supplied caret or field rect and fits near viewport edges', t => {
  const page = setup(t);
  page.show('am', { rect: { left: 100, top: 100, bottom: 120 } });
  assert.equal(page.host().style.left, '100px');
  assert.equal(page.host().style.top, '124px');
  page.show('am', { rect: { left: 2000, top: 750, bottom: 770 } });
  const box = page.host().style;
  assert.ok(parseFloat(box.left) + parseFloat(box.width) <= page.window.innerWidth);
  assert.ok(parseFloat(box.top) < 750, 'panel flips above a low caret');
  page.root.getBoundingClientRect = () => ({ left: 20, top: 30, bottom: 50, width: 100, height: 20 });
  page.show('ami');
  assert.equal(page.host().style.left, '20px');
  assert.equal(page.host().style.top, '54px');
});

test('document_start without a body stays lazy, then mounts on a later edit', t => {
  const page = setup(t);
  page.window.document.documentElement.append(page.root);
  page.window.document.body.remove();
  page.show('ami');
  assert.equal(page.host(), null);
  const body = page.window.document.createElement('body');
  page.window.document.documentElement.append(body);
  body.append(page.root);
  page.show('ami');
  assert.ok(page.host());
});

test('candidate text and rendered input are text, never executable HTML', t => {
  const payload = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>';
  const page = setup(t, undefined, () => payload);
  page.controller.show({ root: page.root, latin: 'qxzv', rendered: payload });
  assert.equal(page.options().length, 1);
  assert.ok(page.options()[0].textContent.includes(payload));
  assert.equal(page.host().shadowRoot.querySelector('img,script'), null);
  assert.equal(page.window.pwned, undefined);
});

test('show on short input or raw escapes hides an existing panel', t => {
  const page = setup(t);
  for (const latin of ['a', '', 'NASA', '\\ami', '`ami', 'hello world']) {
    page.show('ami');
    assert.ok(page.host());
    page.show(latin);
    assert.equal(page.host(), null, latin);
  }
});
