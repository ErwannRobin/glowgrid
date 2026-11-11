# Telegram Widget

GlowGrid runs inside Telegram as an [HTML widget](https://core.telegram.org/bots/widgets) (Bot API 10.4, November 2026): an interactive block drawn right in a chat message. A bot sends the widget; the player solves the daily puzzle in the message and the bot keeps their streak.

## What's in it

The widget is a small rewrite of the game, not a build of `index.html`: widgets must fit in **4096 bytes after zlib compression** (32768 raw), and the full game is ~31 KB compressed.

| Kept | Dropped |
|---|---|
| Daily puzzle — identical to the website's (checked at build time) | Sound (no audio in widgets) |
| `+` / `×` toggle rules, rainbow cells, move counter | Hints and solver |
| Long-press preview of the cells a tap flips | Replay, heatmap, video export, share links |
| Telegram haptics on taps and on a win | Song mode, settings, past puzzles |
| Progress saved per message (`localStorage`) | PWA / offline (not needed) |
| Streak and best streak, kept by the bot | |

The widget plays the current day's puzzle (player's local date, like the website) and switches to the new puzzle when the day changes, so a single message serves every day.

## Files

| File | Role |
|---|---|
| `telegram/widget.html` | Widget source: one HTML document with inline CSS and JS |
| `telegram/minify.js` | Dependency-free minifier, used by both the build and the bot |
| `telegram/bot.js` | Bot logic: commands, `sendWidget`, solve queries, streaks |
| `telegram/store.js` | Streak storage: Upstash Redis REST, or in-memory |
| `api/telegram.js` | Vercel webhook (`POST /api/telegram`) |
| `scripts/build-telegram-widget.js` | Builds `dist/telegram/` and checks the limits |
| `scripts/telegram.js` | CLI: `poll` (local bot), `webhook <url>`, `info` |
| `scripts/telegram-widget-mock.js` | `window.TelegramWidget` stand-in for the local preview |
| `telegram/bot.test.js` | Bot tests (`node --test`) |

## Build and preview

```sh
make telegram           # → dist/telegram/widget.html (exactly what the bot sends)
make telegram-preview   # → http://127.0.0.1:8000/dist/telegram/preview.html
make telegram-test      # build checks + bot tests
```

The build fails if the widget:

- exceeds 32768 bytes raw or 4096 bytes after zlib level 9 (it is currently ~2.5 KB);
- has an inline script that doesn't compile, an external URL, or an API the widget sandbox lacks (`fetch`, `AudioContext`, `navigator.vibrate`, …);
- generates a different puzzle from `index.html` for any day of 2025–2026. The widget's `// core … // /core` region is compared with `generatePuzzleForKey()` and its helpers in `index.html`, so change both together.

The preview shows the widget in a resizable 360 × 440 "bubble" (Telegram allows 200–600 px wide, 50–600 px tall). The mock simulates the bot: a solve updates a streak kept in `localStorage`. From the console: `tgMock.setChatData('{"s":3,"b":5,"l":20261109}')`, `tgMock.reset()`.

## Widget constraints that shaped the code

Widgets run in a QuickJS sandbox, not a browser. From the [limits](https://core.telegram.org/bots/widgets):

- **No network, no audio**, no `navigator.vibrate` → haptics go through `TelegramWidget.HapticFeedback`.
- **At most 16 "heavy" elements** (blurred `box-shadow`, `filter`, `backdrop-filter`, `opacity < 1`). The website's glow uses blurred shadows on 25 cells, which would stop the widget, so cells use gradients and unblurred inset borders only, and the win overlay uses a translucent background color instead of `opacity`.
- **No `vh` units, no scrolling.** The grid is sized from the body's box with a `ResizeObserver`.
- **`TelegramWidget.request()` only from a tap handler.** The solve is reported from the click that completes the puzzle.

## Bot protocol

| Step | Detail |
|---|---|
| `/start`, `/play` | `sendWidget` with `allow_queries: true`, `height: 440`, and the player's streak record as `chat_data` |
| Solve | Widget calls `TelegramWidget.request("w" + YYYYMMDD + moves)` (e.g. `w2026111012`) |
| Bot | Validates the date (UTC today ± 1 day, for time zones), updates the record, `answerWidgetQuery` with the record, then `editMessageWidgetData` to store it in the message's `chat_data` |
| Widget | Shows the streak from the answer, and from `chat_data` (`chatDataChanged` event) on later views |
| `/streak` | Text reply with current and best streak |

Streak record (JSON, stored under `gg:tg:<user id>` and in `chat_data`): `{"s": current streak, "b": best streak, "l": last solved day as YYYYMMDD}`. Solving the same day again doesn't change it; missing a day resets `s` to 1.

The bot trusts the client's "solved" claim, like the website trusts its own `localStorage`. Requests are rate-limited by Telegram (5 per 5 s per user).

## Deploy

1. **Create the bot** with [@BotFather](https://t.me/BotFather) and copy the token.
2. **Storage.** Add an Upstash Redis database to the Vercel project (Marketplace). It sets `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`). Without it, streaks live in memory and are lost whenever the function cold-starts.
3. **Vercel env vars:** `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET` (any random string, e.g. `openssl rand -hex 32`). The webhook refuses requests without the matching `X-Telegram-Bot-Api-Secret-Token` header.
4. **Deploy**, then point Telegram at it:

   ```sh
   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... make telegram-webhook URL=https://glow-grid.erwann.app
   ```

   This calls `setWebhook` with `allowed_updates` including `widget_query`, and registers the `/play` and `/streak` commands. Check it with `node scripts/telegram.js info`.

`vercel.json` adds `telegram/widget.html` to the function bundle; the bot minifies it on cold start.

### Local bot

```sh
TELEGRAM_BOT_TOKEN=... make telegram-poll
```

Runs the bot with long polling and an in-memory store. Telegram refuses long polling while a webhook is set: remove it with `node scripts/telegram.js webhook --delete` (and set it again afterwards).

## Current Telegram limitations

- In production, widgets can be sent **only to private chats** with the bot, and those messages are protected: they **can't be forwarded**. Groups, inline mode and forwarding work only on Telegram's test server for now, so there is no in-Telegram sharing yet.
- Widget payments use a TON wallet (`TelegramWidget.wallet`), not Telegram Stars. GlowGrid doesn't use them.
