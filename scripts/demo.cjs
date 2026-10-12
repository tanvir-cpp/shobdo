'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const server = http.createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/index.html') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(path.join(__dirname, '../demo/index.html')));
});
server.listen(4173, '127.0.0.1', () => console.log('Shobdo playground: http://localhost:4173 (install the unpacked extension first).'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
