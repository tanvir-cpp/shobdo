'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'extension');
const destination = path.join(root, 'dist', 'shobdo');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.content_scripts[0].js,
   ['vendor/avro.js', 'vendor/autodict.js', 'engine.js', 'suggestions.js', 'settings.js', 'content.js']);
assert.ok(manifest.commands['toggle-mode']);
assert.equal(manifest.version, require('../package.json').version);

const assets = new Set([
  'manifest.json', manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(script => script.js),
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  'icons/shobdo.svg',
  'popup.js', 'popup.css', 'vendor/MPL-1.1.txt', 'vendor/AVRO-NOTICE.txt',
  'vendor/autodict.dct', 'vendor/AUTODICT-NOTICE.txt',
]);
for (const [size, asset] of Object.entries(manifest.icons)) {
  const png = fs.readFileSync(path.join(source, asset));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), Number(size), `Wrong icon width: ${asset}`);
  assert.equal(png.readUInt32BE(20), Number(size), `Wrong icon height: ${asset}`);
}
for (const asset of assets) {
  assert.ok(fs.statSync(path.join(source, asset)).isFile(), `Missing asset: ${asset}`);
  if (asset.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(source, asset), 'utf8'), { filename: asset });
}
const html = fs.readFileSync(path.join(source, manifest.action.default_popup), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(assets.has(match[1]), `Unbundled popup asset: ${match[1]}`);
}

// Copy only the audited allowlist, not tests, dev dependencies or private files.
// The destination is the project-owned dist/shobdo (git-ignored build output),
// so it is cleaned first to avoid stale assets lingering after source deletions.
// This never touches a user-selected load directory (extension/ or a Chrome profile).
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const asset of assets) {
  const output = path.join(destination, asset);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(source, asset), output);
}
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
// Fail loudly if cleaning/copying left anything unexpected (e.g. stale files).
function listedFiles(directory, prefix = '') {
  const entries = [];
  for (const name of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) entries.push(...listedFiles(path.join(directory, name.name), relative));
    else entries.push(relative.replace(/\\/g, '/'));
  }
  return entries.sort();
}
const expected = new Set([...assets, 'LICENSE']);
const actual = listedFiles(destination);
for (const file of actual) assert.ok(expected.has(file), `Stale build output: ${file}`);
assert.deepEqual(new Set(actual), expected);
console.log(`Built dist/shobdo: ${assets.size + 1} local files, Manifest V3, storage permission only.`);
