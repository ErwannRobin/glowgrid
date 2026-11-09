#!/usr/bin/env node
// Builds the YouTube Playables version of Glow-Grid from index.html.
//
//   node scripts/build-playables.js          → dist/playables/index.html (real SDK)
//   node scripts/build-playables.js --mock   → dist/playables-dev/index.html (local SDK mock)
//
// index.html stays the single source. The build:
//   1. strips every `<!-- web-only -->…<!-- /web-only -->` (HTML) and
//      `// web-only…` → `// /web-only` (JS) region: site metadata, PWA,
//      sharing, video export, URL replays, external links;
//   2. loads the Playables SDK before any game code and sets window.GG_PLAYABLES;
//   3. checks the result compiles and uses no API that Playables forbids.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SDK_URL = 'https://www.youtube.com/game_api/v1';
const ROOT = path.resolve(__dirname, '..');
const mock = process.argv.includes('--mock');
const outDir = path.join(ROOT, 'dist', mock ? 'playables-dev' : 'playables');

function fail(msg) {
  console.error('build-playables: ' + msg);
  process.exit(1);
}

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1. Strip web-only regions
let stripped = 0;
html = html.replace(/[ \t]*<!-- web-only\b[^]*?<!-- \/web-only -->[ \t]*\n?/g, () => { stripped++; return ''; });
html = html.replace(/^[ \t]*\/\/ web-only\b[^]*?^[ \t]*\/\/ \/web-only[ \t]*\n/gm, () => { stripped++; return ''; });
if (/web-only/.test(html)) fail('unbalanced web-only marker left in output');
if (stripped === 0) fail('no web-only regions found');

// 2. Inject the SDK (or the local mock) before any game code
const HEAD_MARKER = /<!-- playables-head\b[^>]*-->/;
if (!HEAD_MARKER.test(html)) fail('missing <!-- playables-head --> marker in index.html');
const sdk = mock
  ? `<script>\n${fs.readFileSync(path.join(__dirname, 'ytgame-mock.js'), 'utf8')}</script>`
  : `<script src="${SDK_URL}"></script>`;
html = html.replace(HEAD_MARKER, () =>
  `${sdk}\n<script>window.GG_PLAYABLES = true; document.documentElement.classList.add('playables');</script>`);

// 3. Checks
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc=/.test(m[1])) continue;
  try { new vm.Script(m[2], { filename: 'playables/index.html' }); }
  catch (e) { fail('inline script does not compile: ' + e.message); }
}
const urls = [...html.matchAll(/https?:\/\/[^\s"'`)<]+/g)].map(m => m[0])
  .filter(u => u !== SDK_URL && !u.startsWith('http://www.w3.org/'));
if (urls.length) fail('external URLs left in output: ' + [...new Set(urls)].join(', '));
const FORBIDDEN = {
  'navigator.share': 'in-game sharing',
  'navigator.clipboard': 'clipboard access',
  'MediaRecorder': 'video export',
  'serviceWorker': 'service worker',
  'navigator.language': 'language detection (use ytgame.system.getLanguage)',
  'visibilitychange': 'Page Visibility API (use ytgame onPause/onResume)',
  'target="_blank"': 'external link',
};
for (const [needle, why] of Object.entries(FORBIDDEN)) {
  if (html.includes(needle)) fail(`forbidden API in output: ${needle} (${why})`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);

const kib = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`✅ ${path.relative(ROOT, outDir)}/index.html (${kib} KiB, ${stripped} web-only regions stripped${mock ? ', SDK mock' : ''})`);
