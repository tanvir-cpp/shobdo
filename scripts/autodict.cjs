'use strict';

// Convert the pristine upstream Avro autocorrect dictionary
// (extension/vendor/autodict.dct) into a content-script-ready JS bridge
// (extension/vendor/autodict.js).
//
// The generated file is committed, so installing or building the extension
// never needs this step; rerun it only when the upstream dictionary changes:
//   npm run autodict
//
// Filtering (documented in extension/vendor/AUTODICT-NOTICE.txt):
// - keep only single-space Latin-to-Latin pairs that differ;
// - drop any pair containing a backtick: upstream uses ` to break conjuncts,
//   but Shobdo reserves ` as the keep-English escape, so those corrections
//   cannot be expressed and would emit literal backticks;
// - drop all-caps keys: engine.js returns them unchanged as acronyms, so an
//   alias could never fire;
// - drop no-ops where both sides parse to identical Bangla.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const vendor = path.resolve(__dirname, '..', 'extension', 'vendor');
const source = fs.readFileSync(path.join(vendor, 'autodict.dct'), 'utf8');
assert.ok(
  source.includes('Avro Phonetic Autocorrect dictionary') && source.includes('OmicronLab'),
  'Unexpected autodict.dct: refusing to generate from an unknown source.'
);

const phonetic = require(path.join(vendor, 'avro.js'));
const entries = new Map();
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z`]+) ([A-Za-z`]+)$/);
  if (!match || match[1] === match[2]) continue;
  const [key, value] = [match[1], match[2]];
  if (key.includes('`') || value.includes('`')) continue;
  if (!/^[A-Za-z]+$/.test(key)) continue;
  if (/^[A-Z]{2,}$/.test(key)) continue;
  let before;
  let after;
  try {
    before = phonetic.parse(key);
    after = phonetic.parse(value);
  } catch (_) {
    continue;
  }
  if (before === after) continue;
  entries.set(key, value);
}
assert.ok(entries.size >= 3000, `Suspiciously few entries: ${entries.size}.`);

const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const header = `/*
 * Generated from autodict.dct (Avro Phonetic Autocorrect dictionary).
 * Upstream: https://github.com/omicronlab/Avro-Keyboard
 * Copyright (C) OmicronLab. All Rights Reserved.
 * License: Mozilla Public License Version 1.1 (MPL-1.1); see MPL-1.1.txt
 * and AUTODICT-NOTICE.txt in this directory. Do not edit by hand;
 * rerun scripts/autodict.cjs instead. The phonetic behavior below is
 * unchanged upstream data; Shobdo's filtering is documented in the notice.
 */`;
const body = `var OmicronLab = globalThis.OmicronLab || {};
OmicronLab.Avro = OmicronLab.Avro || {};
OmicronLab.Avro.Autocorrect = new Map(${JSON.stringify(sorted)});
globalThis.OmicronLab = OmicronLab;
if (typeof module === "object" && module.exports) {
  module.exports = OmicronLab.Avro.Autocorrect;
}
`;
const output = path.join(vendor, 'autodict.js');
fs.writeFileSync(output, header + '\n' + body);
new vm.Script(fs.readFileSync(output, 'utf8'), { filename: 'vendor/autodict.js' });
const built = require(output);
assert.equal(built.size, entries.size);
assert.equal(built.get('sonar'), 'sOnar');
console.log(`Built vendor/autodict.js: ${entries.size} autocorrect entries (MPL-1.1, OmicronLab).`);
