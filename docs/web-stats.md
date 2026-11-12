# Web play statistics

After a win on today's puzzle, the website shows how the day is going:

> 👥 1,234 players today · 68% solved it
> Median 9 moves · you beat 72% of solvers

## How it works

The page posts events to `POST /api/stats` (`api/stats.js`, logic in `web/stats.js`) and the server keeps daily totals in the same Upstash Redis database as the Telegram bot (keys under `gg:web:*`). Without Redis env vars it falls back to memory, like the bot.

| Event | Sent when | Body |
|---|---|---|
| start | first move on a fresh grid (also after "Start over") | `{"e":"s","d":20261112,"f":1}` |
| win | the puzzle is solved | `{"e":"w","d":20261112,"m":9,"f":1}` |

- `d` is the player's local date; the server accepts UTC today ± 1 day.
- `f` on a start: first game of the day in this browser (counts a player). The browser remembers the last day it was counted in `localStorage` (`glowgrid-stats-played`).
- `f` on a win: first solve of that puzzle in this browser. Only those go into the moves distribution (median, "you beat").
- Only today's puzzle is reported: no archive days, no song mode, no shared replays. The YouTube Playables build strips it all (web-only regions).

The win response returns `{players, solvers, games, wins, median, beat}`; the page shows nothing if the request fails (offline, `make serve`).

## Privacy and trust

No user id, IP or name is stored: only per-day counters and a moves histogram. Results are not verified (nothing to win), so anyone can skew a day's numbers by posting events; add a Vercel Firewall rate limit on `/api/stats` if that becomes a problem.

## Redis keys

| Key | Type | Content |
|---|---|---|
| `gg:web:stats:<YYYYMMDD>` | hash | `players`, `games`, `solvers`, `wins` |
| `gg:web:moves:<YYYYMMDD>` | hash | moves → number of first solves |
| `gg:web:stats` | hash | `games`, `wins` (all time) |
