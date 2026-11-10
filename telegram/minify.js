'use strict';
// Dependency-free minifier for telegram/widget.html. Used by the build script
// (to check the size limits) and by the bot (to send the exact same bytes).
//
// It relies on how widget.html is written: JS statements end with semicolons
// or newlines (newlines are kept), no `//` inside strings, CSS without
// meaningful spaces around { } ; , and no <pre>/<textarea>.

function minifyCss(css) {
  return css
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();
}

function minifyJs(js) {
  return js
    .split('\n')
    .map(line => line.replace(/^\s+/, '').replace(/\s+\/\/ .*$/, '').replace(/\s+$/, ''))
    .filter(line => line && !line.startsWith('//'))
    .join('\n');
}

function minifyWidget(html) {
  return html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<style>([^]*?)<\/style>/g, (_, css) => `<style>${minifyCss(css)}</style>`)
    .replace(/<script>([^]*?)<\/script>/g, (_, js) => `<script>${minifyJs(js)}</script>`)
    .replace(/>\s+</g, '><')
    .trim();
}

module.exports = { minifyWidget };
