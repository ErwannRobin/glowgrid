#!/usr/bin/env node
// Builds and checks the GlowGrid Telegram widget from telegram/widget.html.
//
//   node scripts/build-telegram-widget.js
//     → dist/telegram/widget.html   exactly what the bot sends
//     → dist/telegram/preview.html  the widget in a resizable frame with a
//                                   TelegramWidget mock, for local testing
//
// Checks (https://core.telegram.org/bots/widgets#limits):
//   - at most 32768 bytes of HTML and 4096 bytes after zlib level 9;
//   - the inline script compiles, no external URLs, no API the sandbox lacks;
//   - the widget generates the same daily puzzles as index.html.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { minifyWidget } = require('../telegram/minify');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'telegram');
const MAX_RAW = 32768;
const MAX_ZLIB = 4096;

function fail(msg) {
  console.error('build-telegram-widget: ' + msg);
  process.exit(1);
}

const source = fs.readFileSync(path.join(ROOT, 'telegram', 'widget.html'), 'utf8');
const html = minifyWidget(source);

// 1. Size limits
const raw = Buffer.byteLength(html);
const packed = zlib.deflateSync(Buffer.from(html), { level: 9 }).length;
if (raw > MAX_RAW) fail(`${raw} bytes of HTML (limit ${MAX_RAW})`);
if (packed > MAX_ZLIB) fail(`${packed} bytes after zlib level 9 (limit ${MAX_ZLIB})`);
if (html.includes('\u0000')) fail('HTML contains U+0000');

// 2. Script compiles; no network, external resources or missing APIs
const scripts = [...html.matchAll(/<script>([^]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 1) fail('expected exactly one inline <script>');
try { new vm.Script(scripts[0], { filename: 'telegram/widget.html' }); }
catch (e) { fail('inline script does not compile: ' + e.message); }
if (/https?:\/\//.test(html)) fail('external URL in widget (nothing external ever loads)');
const UNAVAILABLE = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'AudioContext', 'navigator.vibrate',
  'navigator.share', 'navigator.clipboard', 'alert(', 'confirm(', 'prompt(', 'getImageData', 'toDataURL', 'vh;'];
for (const needle of UNAVAILABLE) if (html.includes(needle)) fail(`unavailable in widgets: ${needle}`);

// 3. Same puzzles as the website: compare 2 years of daily puzzles
const core = /\/\/ core\b[^\n]*\n([^]*?)\/\/ \/core/.exec(source);
if (!core) fail('missing // core … // /core region in telegram/widget.html');
const widgetGen = vm.runInNewContext(`const FULL = 33554431;\n${core[1]}\ngen`);

const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fnSource = name => {
  const m = new RegExp(`^function ${name}\\([^]*?^}\\n`, 'm').exec(index);
  if (!m) fail(`function ${name} not found in index.html`);
  return m[0];
};
const webGen = vm.runInNewContext(
  ['mulberry32', 'seedFromKey', 'plusPattern', 'crossPattern', 'affectedCells', 'applyToggle', 'generatePuzzleForKey']
    .map(fnSource).join('\n') +
  `\nconst SIZE = ${/^const SIZE = (\d+);/m.exec(index)[1]};\nvar state = [], puzzleState = null;
  (key) => { generatePuzzleForKey(key); return state.reduce((bits, on, i) => on ? bits | (1 << i) : bits, 0) >>> 0; }`);

for (let day = 0; day < 730; day++) {
  const d = new Date(Date.UTC(2025, 0, 1 + day));
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  if (widgetGen(key) !== webGen(key)) fail(`puzzle for ${key} differs from index.html`);
}

// 4. Output
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'widget.html'), html);

const mock = fs.readFileSync(path.join(__dirname, 'telegram-widget-mock.js'), 'utf8');
const framed = html.replace('<head>', () => `<head><script>\n${mock}</script>`);
fs.writeFileSync(path.join(OUT, 'widget-preview.html'), framed);
fs.writeFileSync(path.join(OUT, 'preview.html'), `<!doctype html>
<meta charset="utf-8"><title>GlowGrid widget preview</title>
<style>
  body { background: #17212b; color: #aaa; font: 13px system-ui; display: grid; place-items: center; min-height: 100vh; margin: 0 }
  .bubble { width: 360px; height: 440px; resize: both; overflow: hidden; border-radius: 12px; min-width: 200px; min-height: 50px; max-height: 600px }
  iframe { border: 0; width: 100%; height: 100% }
</style>
<div><div class="bubble"><iframe src="widget-preview.html"></iframe></div>
<p>Drag the corner to resize (200–600 px). Console: <code>tgMock.setChatData('{"s":3,"b":5,"l":20260101}')</code>, <code>tgMock.reset()</code></p></div>
`);

console.log(`✅ dist/telegram/widget.html (${raw} bytes, ${packed}/${MAX_ZLIB} after zlib, puzzles match index.html)`);
