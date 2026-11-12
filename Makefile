PORT ?= 8000

.DEFAULT_GOAL := help
.PHONY: help serve check test og bump-cache playables playables-dev telegram telegram-size telegram-preview telegram-test telegram-poll telegram-webhook

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-17s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

serve: ## Serve the game on http://127.0.0.1:8000 (override with PORT=...)
	@python3 -m http.server $(PORT) --bind 127.0.0.1

check: ## Syntax-check inline JS, JSON-LD, sw.js and manifest.json
	@node -e "$$CHECK_JS"

og: ## Regenerate og-image.png from og-image.html (needs Google Chrome)
	@./generate-og.sh

playables: ## Build the YouTube Playables bundle (dist/glowgrid-playables.zip)
	@node scripts/build-playables.js
	@rm -f dist/glowgrid-playables.zip
	@cd dist/playables && zip -qr ../glowgrid-playables.zip .
	@echo "✅ dist/glowgrid-playables.zip"

playables-dev: ## Build the Playables version with a local SDK mock and serve it
	@node scripts/build-playables.js --mock
	@echo "Open http://127.0.0.1:$(PORT)/dist/playables-dev/ (console: ytgameMock.pause(), .resume(), .setAudio(false))"
	@python3 -m http.server $(PORT) --bind 127.0.0.1

telegram: ## Build and check the Telegram widget (dist/telegram/widget.html)
	@node scripts/build-telegram-widget.js

telegram-size: ## Show the Telegram widget size against its limits (4096 bytes after zlib)
	@node scripts/build-telegram-widget.js --size

telegram-preview: telegram ## Serve the Telegram widget with a local TelegramWidget mock
	@echo "Open http://127.0.0.1:$(PORT)/dist/telegram/preview.html"
	@python3 -m http.server $(PORT) --bind 127.0.0.1

test: telegram ## Run all tests (Telegram bot and web stats)
	@node --test telegram/bot.test.js web/stats.test.js

telegram-test: telegram ## Run the Telegram bot tests
	@node --test telegram/bot.test.js

telegram-poll: telegram ## Run the Telegram bot locally (needs TELEGRAM_BOT_TOKEN)
	@node scripts/telegram.js poll

telegram-webhook: ## Point the bot at TELEGRAM_WEBHOOK_BASE_URL (.env), or URL=https://...
	@node scripts/telegram.js webhook $(URL)

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
