'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');

const icons = path.join(__dirname, '../extension/icons');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePng(filename) {
  const png = fs.readFileSync(filename);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'PNG signature');
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + 12 + length <= png.length, `${type} fits file`);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(png.subarray(offset + 4, offset + 8 + length)), png.readUInt32BE(offset + 8 + length), `${type} checksum`);
    chunks.push({ type, data });
    offset += length + 12;
  }
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks.at(-1).type, 'IEND');
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert.equal(header[8], 8, '8-bit channels');
  assert.equal(header[9], 6, 'RGBA for transparent rounded corners');
  assert.deepEqual([...header.subarray(10)], [0, 0, 0], 'standard non-interlaced PNG');
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
  const stride = width * 4;
  assert.equal(raw.length, height * (stride + 1), 'complete pixel data');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, 'valid PNG filter');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const above = y ? pixels[index - stride] : 0;
      const upperLeft = y && x >= 4 ? pixels[index - stride - 4] : 0;
      const estimate = left + above - upperLeft;
      const a = Math.abs(estimate - left), b = Math.abs(estimate - above), c = Math.abs(estimate - upperLeft);
      const paeth = a <= b && a <= c ? left : b <= c ? above : upperLeft;
      const predictor = [0, left, above, Math.floor((left + above) / 2), paeth][filter];
      pixels[index] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

for (const size of [16, 32, 48, 128]) {
  test(`Shobdo ${size}px icon is a valid transparent green-and-white PNG`, () => {
    const { width, height, pixels } = decodePng(path.join(icons, `icon-${size}.png`));
    assert.equal(width, size);
    assert.equal(height, size);
    for (const index of [0, size - 1, size * (size - 1), size * size - 1]) {
      assert.equal(pixels[index * 4 + 3], 0, 'rounded outer corners are transparent');
    }
    let green = 0, white = 0, opaque = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const [r, g, b, a] = pixels.subarray(index, index + 4);
      if (a !== 255) continue;
      opaque++;
      if (g > r * 2 && g > b) green++;
      // Toolbar-sized curves are antialiased; count their near-white interiors.
      if (r > 225 && g > 225 && b > 225) white++;
    }
    assert.ok(opaque > size * size * .6, 'substantial visible artwork');
    assert.ok(green > size * size * .35, 'green brand tile');
    assert.ok(white > size * size * .07, 'recognizable white mark even at toolbar size');
  });
}

test('editable logo is self-contained and the popup uses its accessible local asset', () => {
  const source = fs.readFileSync(path.join(icons, 'shobdo.svg'), 'utf8');
  const svg = new JSDOM(source, { contentType: 'image/svg+xml' }).window.document;
  assert.equal(svg.documentElement.getAttribute('viewBox'), '0 0 128 128');
  assert.ok(svg.querySelectorAll('path').length >= 2);
  assert.equal(svg.querySelectorAll('text, image, script, foreignObject, style, [href]').length, 0, 'no fonts or external resources');
  const popup = new JSDOM(fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8')).window.document;
  const image = popup.querySelector('.brand-mark');
  assert.equal(image.tagName, 'IMG');
  assert.equal(image.getAttribute('src'), 'icons/icon-48.png');
  assert.equal(image.getAttribute('alt'), 'Shobdo logo');
  const suggestions = popup.getElementById('suggestions');
  assert.equal(suggestions.type, 'checkbox');
  assert.equal(suggestions.getAttribute('role'), 'switch');
  assert.ok(popup.querySelector('label[for="suggestions"]'));
  const description = popup.getElementById(suggestions.getAttribute('aria-describedby')).textContent;
  assert.match(description, /local candidate list/);
  assert.match(description, /Tab accepts.*↑\/↓ chooses.*Esc closes/s);
});
