"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transliterate } = require("../extension/engine.js");

test("requested common words and phrases", () => {
  const examples = [
    ["ami", "আমি"],
    ["hi", "হি"],
    ["hai", "হাই"],
    ["tumi", "তুমি"],
    ["kemon acho", "কেমন আছো"],
    ["tomar", "তোমার"],
    ["bhalo", "ভালো"],
    ["valo", "ভালো"],
    ["bangla", "বাংলা"],
    ["ami banglay likhi", "আমি বাংলায় লিখি"],
    ["sona", "সোনা"],
    ["amar sonar bangla", "আমার সোনার বাংলা"]
  ];
  for (const [input, expected] of examples) {
    assert.equal(transliterate(input), expected, input);
  }
});

test("vowels use independent letters initially and vowel signs after consonants", () => {
  assert.equal(transliterate("a i I u U e O OI OU rri"), "আ ই ঈ উ ঊ এ ও ঐ ঔ ঋ");
  assert.equal(transliterate("ka ki kI ku kU ke kO kOI kOU krri"), "কা কি কী কু কূ কে কো কৈ কৌ কৃ");
  assert.equal(transliterate("o ko oo koo ee kee"), "অ ক উ কু ঈ কী");
});

test("conjuncts and phonetic alternatives come from contextual Avro rules", () => {
  assert.equal(transliterate("kkh kSh kx ksh"), "ক্ষ ক্ষ ক্ষ কশ");
  assert.equal(transliterate("jNG gg"), "জ্ঞ জ্ঞ");
  assert.equal(transliterate("bh v ph f"), "ভ ভ ফ ফ");
  assert.equal(transliterate("nk ng ndh kt kri pra"), "ঙ্ক ং ন্ধ ক্ত ক্রি প্রা");
  assert.equal(transliterate("dh Dh th Th n N t T"), "ধ ঢ থ ঠ ন ণ ত ট");
  assert.equal(transliterate("ry kry"), "র‍্য ক্র্য");
});

test("whole-word aliases leave explicit Avro alternatives and other words usable", () => {
  assert.equal(transliterate("acho achO tomar tOmar bhalo bhalO valo valO"), "আছো আছো তোমার তোমার ভালো ভালো ভালো ভালো");
  assert.equal(transliterate("sona sOna sonar sOnar"), "সোনা সোনা সোনার সোনার");
  assert.equal(transliterate("achola"), "আছলা");
  assert.equal(transliterate("bhalobasha"), "ভালবাশা");
  assert.equal(transliterate("valobasha"), "ভালবাশা");
  assert.equal(transliterate("Valo VALO vAlO"), "ভাল VALO ভালো");
});

test("common phonetic words work in phrases and mixed text", () => {
  assert.equal(transliterate("hi, ami valo achi! hai, bhalo?"), "হি, আমি ভালো আছি! হাই, ভালো?");
  assert.equal(
    transliterate("বাংলায়\thi: valo/bhalo, valO bhalO; API OI OU🙂\nআমি ami"),
    "বাংলায়\tহি: ভালো/ভালো, ভালো ভালো; API ঐ ঔ🙂\nআমি আমি"
  );
});

test("punctuation, spacing, numbers and existing Bangla are preserved exactly", () => {
  assert.equal(
    transliterate("  ami,\ttumi!\r\nkemon acho? (bhalo)... : ^ $ ` 123 বাংলা🙂\u00a0ami  "),
    "  আমি,\tতুমি!\r\nকেমন আছো? (ভালো)... : ^ $ ` 123 বাংলা🙂\u00a0আমি  "
  );
  const existing = "বাংলায় য় য় ড় ড় বাংলা। ১২৩\n";
  assert.equal(transliterate(existing), existing);
  assert.equal(transliterate("আমি ami বাংলায় banglay"), "আমি আমি বাংলায় বাংলায়");
  assert.equal(transliterate(""), "");
});

test("acronyms survive while uppercase phonetic vowel/conjunct controls work", () => {
  assert.equal(transliterate("ami API NASA HTML HTTP USA"), "আমি API NASA HTML HTTP USA");
  assert.equal(transliterate("OI OU NG NN DD TT"), "ঐ ঔ ঞ ণ্ণ ড্ড ট্ট");
});

test("repeated conversions are deterministic and Bangla output is idempotent", () => {
  const input = "ami banglay likhi, kemon acho? kri kOI ry";
  const first = transliterate(input);
  for (let i = 0; i < 10; i += 1) {
    assert.equal(transliterate(input), first);
    assert.equal(transliterate(first), first);
  }
});

test("public API rejects non-string input", () => {
  for (const value of [undefined, null, 12, {}, ["ami"]]) {
    assert.throws(() => transliterate(value), TypeError);
  }
});

test("vendored autocorrect dictionary fixes common colloquial spellings", () => {
  for (const [input, expected] of [
    ["abong", "এবং"],
    ["school", "স্কুল"],
    ["dhaka", "ঢাকা"],
    ["sotti", "সত্যি"],
    ["sondha", "সন্ধ্যা"],
    ["thanda", "ঠান্ডা"],
    ["sonar", "সোনার"],
  ]) {
    assert.equal(transliterate(input), expected, input);
  }
  // Local aliases take precedence and agree with the dictionary.
  assert.equal(transliterate("sona sOna sonar sOnar"), "সোনা সোনা সোনার সোনার");
});

test("classic extension scripts expose ShobdoEngine without CommonJS or networking", () => {
  const context = vm.createContext({});
  for (const file of ["vendor/avro.js", "engine.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../extension", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  assert.equal(context.ShobdoEngine.transliterate("ami banglay likhi"), "আমি বাংলায় লিখি");
  assert.equal(context.ShobdoEngine.transliterate("API, kemon acho?"), "API, কেমন আছো?");
  // Local aliases work even when the optional dictionary is not loaded.
  assert.equal(context.ShobdoEngine.transliterate("amar sonar bangla"), "আমার সোনার বাংলা");
  assert.equal(typeof context.fetch, "undefined");
});

test("browser globals apply the autocorrect dictionary when loaded first", () => {
  const context = vm.createContext({});
  for (const file of ["vendor/avro.js", "vendor/autodict.js", "engine.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../extension", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  assert.equal(context.ShobdoEngine.transliterate("abong school dhaka"), "এবং স্কুল ঢাকা");
  assert.equal(typeof context.fetch, "undefined");
});

test("missing browser dependency has a useful load-order error", () => {
  const source = fs.readFileSync(path.join(__dirname, "../extension/engine.js"), "utf8");
  assert.throws(() => vm.runInNewContext(source), /Load vendor\/avro\.js before engine\.js/);
});
