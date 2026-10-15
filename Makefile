PORT ?= 8000

.DEFAULT_GOAL := help
.PHONY: help serve check og bump-cache

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

serve: ## Serve the game on http://127.0.0.1:8000 (override with PORT=...)
	@python3 -m http.server $(PORT) --bind 127.0.0.1

check: ## Syntax-check inline JS, JSON-LD, sw.js and manifest.json
	@node -e "$$CHECK_JS"

og: ## Regenerate og-image.png from og-image.html (needs Google Chrome)
	@./generate-og.sh

bump-cache: ## Bump the service worker cache version (after changing cached assets)
	@perl -pi -e 's/glowgrid-v(\d+)/"glowgrid-v".($$1+1)/e' sw.js
	@grep -o "glowgrid-v[0-9]*" sw.js

# Compiles each script without running it; errors point at index.html lines
define CHECK_JS
const fs = require('fs'), vm = require('vm');
let failed = 0;
function ok(label, fn) {
  try { fn(); console.log('ok    ' + label); }
  catch (e) { failed++; console.log('FAIL  ' + label + '\n      ' + e.message); }
}
function compile(code, filename, lineOffset) {
  try { new vm.Script(code, { filename: filename, lineOffset: lineOffset }); }
  catch (e) { throw new Error(e.stack.split('\n')[0] + ': ' + e.message); }
}
const html = fs.readFileSync('index.html', 'utf8');
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  const attrs = m[1], body = m[2];
  if (/\bsrc=/.test(attrs)) continue;
  const bodyStart = m.index + m[0].indexOf('>') + 1;
  const line = html.slice(0, bodyStart).split('\n').length;
  if (/application\/ld\+json/.test(attrs)) {
    ok('index.html JSON-LD (line ' + line + ')', () => JSON.parse(body));
  } else {
    ok('index.html inline script (line ' + line + ')', () => compile(body, 'index.html', line - 1));
  }
}
ok('sw.js', () => compile(fs.readFileSync('sw.js', 'utf8'), 'sw.js', 0));
ok('manifest.json', () => JSON.parse(fs.readFileSync('manifest.json', 'utf8')));
process.exit(failed ? 1 : 0);
endef
export CHECK_JS
