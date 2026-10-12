'use strict';
const path = require('node:path');
const esbuild = require('esbuild');
// These editor libraries are test-only. The extension build never includes this.
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../tests/fixtures/social-editors.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"development"', global: 'globalThis' },
  outfile: path.join(__dirname, '../test-results/social-fixture.js'),
  logLevel: 'warning',
});
