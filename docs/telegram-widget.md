# Telegram Widget

GlowGrid runs inside Telegram as an [HTML widget](https://core.telegram.org/bots/widgets) (Bot API 10.4, November 2026): an interactive block drawn right in a chat message. A bot sends the widget; the player solves the daily puzzle in the message and the bot keeps their streak.

## What's in it

The widget is a small rewrite of the game, not a build of `index.html`: widgets must fit in **4096 bytes after zlib compression** (32768 raw), and the full game is ~31 KB compressed.

| Kept | Dropped |
|---|---|
| Daily puzzle — identical to the website's (checked at build time) | Sound (no audio in widgets) |
| `+` / `×` toggle rules, rainbow cells, move counter | Hints and solver |
| Long-press preview of the cells a tap flips | Replay, heatmap, video export, share links |
| Telegram haptics on taps and on a win | Song mode, settings |
| Progress saved per message and per day (`localStorage`) | PWA / offline (not needed) |
| Streak and best streak, kept by the bot | |
| Past puzzles: `/yesterday`, `/archive` (browse with ‹ ›) | |
| Leaderboards: `/leaderboard` (today), `/leaderboard all` (all time) | |

The widget plays the current day's puzzle (player's local date, like the website) and switches to the new puzzle when the day changes, so a single message serves every day.

`/yesterday` and `/archive` send the same widget in **archive mode**: it opens on a past day and the player browses every puzzle from #1 (1 Jan 2025, numbered like the website) to yesterday with ‹ ›. Each day's game is kept, so the player can switch days and come back to an unfinished one (the 60 most recently played days fit in the message's 4 KB of `localStorage`). Archive solves are marked ✓ in that message but don't count for the streak, as on the website. The win screen has a "‹ Day before" button to go to the previous puzzle; on today's puzzle it has a "‹ Yesterday's puzzle" button that makes the bot send a `/yesterday` message.

## Files

| File | Role |
|---|---|
| `telegram/widget.html` | Widget source: one HTML document with inline CSS and JS |
| `telegram/minify.js` | Dependency-free minifier, used by both the build and the bot |
| `telegram/bot.js` | Bot logic: commands, `sendWidget`, solve queries, streaks |
| `telegram/leaderboard.js` | `/leaderboard`: daily moves, streak and win rankings |
| `telegram/dates.js` | YYYYMMDD dates and puzzle numbers |
| `telegram/store.js` | Storage (strings, sorted sets, hashes): Upstash Redis REST, or in-memory |
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

The preview shows the widget in a resizable 360 × 440 "bubble" (Telegram allows 200–600 px wide, 50–600 px tall). The mock simulates the bot: a solve updates a streak kept in `localStorage`. From the console: `tgMock.setChatData('{"s":3,"b":5,"l":20261109}')`, `tgMock.reset()`, and `tgMock.archive(20261005)` or `tgMock.archive()` (yesterday) for archive mode.

## Widget constraints that shaped the code

Widgets run in a QuickJS sandbox, not a browser. From the [limits](https://core.telegram.org/bots/widgets):

- **No network, no audio**, no `navigator.vibrate` → haptics go through `TelegramWidget.HapticFeedback`.
- **At most 16 "heavy" elements** (blurred `box-shadow`, `filter`, `backdrop-filter`, `opacity < 1`). The website's glow uses blurred shadows on 25 cells, which would stop the widget, so cells use gradients and unblurred inset borders only, and the win overlay uses a translucent background color instead of `opacity`.
- **No `vh` units, no scrolling.** The grid is sized from the body's box with a `ResizeObserver`.
- **Don't trust the body's height.** Telegram for iPhone doesn't give `html`/`body` a height, so the body is only as tall as its content and sizes measured from it hit their minimum (tiny grid at the top of the message). `fit()` measures the window instead (`innerWidth`/`innerHeight`, `documentElement`), falls back to 360 × 440 (the height the bot sends) when that looks wrong, sets the body's height and font size from it, and all other sizes are in `em`. Not confirmed on a device which of these values iOS reports.
- **`TelegramWidget.request()` only from a tap handler.** The solve is reported from the click that completes the puzzle.

## Bot protocol

| Step | Detail |
|---|---|
| `/start`, `/play` | `sendWidget` with `allow_queries: true`, `height: 440`, and the player's streak record as `chat_data` |
| Solve | Widget calls `TelegramWidget.request("w" + YYYYMMDD + moves)` (e.g. `w2026111012`) |
| Bot | Validates the date (UTC today ± 1 day, for time zones), updates the record, `answerWidgetQuery` with the record, then `editMessageWidgetData` to store it in the message's `chat_data` |
| Widget | Shows the streak from the answer, and from `chat_data` (`chatDataChanged` event) on later views |
| `/streak` | Text reply with current and best streak |
| `/leaderboard` | Text reply: top 5 by fewest moves on today's puzzle, top 5 current streaks, and the asker's place |
| `/leaderboard all` | Text reply: top 5 by days won, top 5 best streaks ever, and the asker's place |
| "‹ Yesterday's puzzle" (today's win screen) | Widget calls `TelegramWidget.request("y")`; the bot answers and sends a `/yesterday` message |
| `/yesterday`, `/archive` | `sendWidget` without queries; `chat_data` is `{"t": <message unix time>}`, which the widget turns into yesterday in the player's time zone |
| `/archive 497`, `/archive 2026-10-05` | Same, starting on that day: `chat_data` is `{"d": 20260512}`. Accepts #1 / 2025-01-01 up to UTC today; the widget stops at the player's yesterday |

The widget tells the modes apart by `chat_data`: `d` or `t` means archive, anything else is a streak record.

Streak record (JSON, stored under `gg:tg:<user id>` and in `chat_data`): `{"s": current streak, "b": best streak, "l": last solved day as YYYYMMDD}`. Solving the same day again doesn't change it; missing a day resets `s` to 1.

### Leaderboards

Each solve also updates sorted sets in the store (see the top of `telegram/leaderboard.js`):

- **Today**: `gg:tg:day:<YYYYMMDD>` keeps each player's fewest moves for that day (a better replay replaces it, a worse one doesn't). Ties go to the first to solve. "Today" is the asker's last solved day if it is UTC today ± 1 (their time zone), else UTC today.
- **Current streaks**: only streaks still alive (last solve at most 2 UTC days ago, like `/streak`). Broken ones are removed when someone asks for the leaderboard.
- **Days won** (all time): the player with the fewest moves of the day (ties: first to solve) wins it. A day is counted 2 days later, once no time zone can still play it, when someone next asks for `/leaderboard`; at most the 14 last days are counted, so days are lost if nobody asks for 2 weeks.
- **Longest streaks** (all time): each player's best streak.

Names are the player's Telegram first name and last-name initial, saved on each solve and `/leaderboard`. Players who solved before the leaderboard existed appear in the streak boards after their next solve or `/leaderboard`.

The bot trusts the client's "solved" claim, like the website trusts its own `localStorage`. Requests are rate-limited by Telegram (5 per 5 s per user).

## Deploy

1. **Create the bot** with [@BotFather](https://t.me/BotFather) and copy the token.
2. **Storage.** Add an Upstash Redis database to the Vercel project (Marketplace). It sets `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`). Without it, streaks live in memory and are lost whenever the function cold-starts.
3. **Vercel env var:** `TELEGRAM_BOT_TOKEN`. The webhook refuses requests without the right `X-Telegram-Bot-Api-Secret-Token` header. That secret is derived from the token (HMAC-SHA256), so there is nothing else to set or keep. To use your own secret instead, set `TELEGRAM_WEBHOOK_SECRET` on Vercel and pass the same value to the command below.
4. **Local config.** The CLI reads `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_BASE_URL` from a gitignored `.env` at the repo root, so you set them once: `cp .env.example .env` and paste the token. A variable set in the shell takes precedence.
5. **Deploy**, then point Telegram at it:

   ```sh
   make telegram-webhook
   ```

   It uses `TELEGRAM_WEBHOOK_BASE_URL`; pass `URL=https://...` to target another deployment once.

   This calls `setWebhook` with `allowed_updates` including `widget_query`, and registers the `/play`, `/yesterday`, `/archive`, `/streak` and `/leaderboard` commands (run it again after adding a command). Check it with `node scripts/telegram.js info`. Before switching, it sends an empty update to the deployment and stops without changing anything if the deployment rejects the secret (for example, a `TELEGRAM_WEBHOOK_SECRET` is still set on Vercel).

`vercel.json` adds `telegram/widget.html` to the function bundle; the bot minifies it on cold start.

### Local bot

```sh
make telegram-poll   # token from .env
```

Runs the bot with long polling and an in-memory store. Telegram refuses long polling while a webhook is set: remove it with `node scripts/telegram.js webhook --delete` (and set it again afterwards).

## Current Telegram limitations

- In production, widgets can be sent **only to private chats** with the bot, and those messages are protected: they **can't be forwarded**. Groups, inline mode and forwarding work only on Telegram's test server for now, so there is no in-Telegram sharing yet.
- Widget payments use a TON wallet (`TelegramWidget.wallet`), not Telegram Stars. GlowGrid doesn't use them.
