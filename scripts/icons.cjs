'use strict';

// Rebuild the checked-in assets using the project's existing Playwright Chromium.
// The committed PNGs in extension/icons/ are canonical; run this only when the
// source SVG changes, then commit the regenerated PNGs together with the SVG.
// The editable SVG contains only vector paths: no fonts, downloads, or runtime
// image-generation dependencies are needed by the extension.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const directory = path.resolve(__dirname, '../extension/icons');
  const svg = await fs.readFile(path.join(directory, 'shobdo.svg'), 'utf8');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>' + svg + '</body></html>');
    for (const size of [16, 32, 48, 128]) {
      await page.setViewportSize({ width: size, height: size });
      const destination = path.join(directory, `icon-${size}.png`);
      await page.screenshot({ path: destination, type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size }, animations: 'disabled' });
      console.log(`extension/icons/icon-${size}.png (${size} × ${size}, ${(await fs.stat(destination)).size} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
