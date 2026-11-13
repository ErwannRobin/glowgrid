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

## Stats page

`stats.html` (linked from the About page) shows:

- **Your stats**, read from this browser's `localStorage`: games played, success rate and puzzles solved with hints (`glowgrid-my-stats`: `{g, w, h, since}`, written by the game on the first move and on each win; every puzzle counts except song challenges), plus puzzles solved and the current streak from the game's save. Nothing is sent to the server.
- **Today** and **All time** totals for the website and the Telegram bot, from `GET /api/stats?d=YYYYMMDD` (the player's local date; the server falls back to UTC today). The response (cached 60 s at the edge):

```json
{
  "day": 20261113,
  "web": { "today": { "players": 120, "solvers": 80, "games": 150, "wins": 95 }, "allTime": { "games": 4200, "wins": 2900 } },
  "telegram": { "today": { "players": 30, "games": 41, "wins": 27 }, "allTime": { "players": 310, "games": 1900, "wins": 1300 }, "since": 20261101 }
}
```

The website has no all-time player count: it stores no ids, so players can't be told apart across days.

## Privacy and trust

No user id, IP or name is stored: only per-day counters and a moves histogram. Results are not verified (nothing to win), so anyone can skew a day's numbers by posting events; add a Vercel Firewall rate limit on `/api/stats` if that becomes a problem.

## Redis keys

| Key | Type | Content |
|---|---|---|
| `gg:web:stats:<YYYYMMDD>` | hash | `players`, `games`, `solvers`, `wins` |
| `gg:web:moves:<YYYYMMDD>` | hash | moves → number of first solves |
| `gg:web:stats` | hash | `games`, `wins` (all time) |
