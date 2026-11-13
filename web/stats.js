'use strict';
// Anonymous play statistics for the website (POST /api/stats).
//
// No user id is sent or stored: the page reports events and the server only
// keeps daily totals. The browser remembers what it already reported, so a
// player counts once per day and a puzzle's first solve counts once.
//
// Events (JSON body):
//   {e: 's', d: YYYYMMDD, f: 0|1}            a game starts (first move on a fresh grid);
//                                            f: first game of the day in this browser
//   {e: 'w', d: YYYYMMDD, m: moves, f: 0|1}  a win; f: first solve of that puzzle in this
//                                            browser (only those make the moves distribution)
// d is the player's local date and only today's puzzle is reported (no archive).
//
// Redis keys:
//   gg:web:stats:<YYYYMMDD>  hash  players, games, solvers, wins
//   gg:web:moves:<YYYYMMDD>  hash  moves → first solves with that many moves
//   gg:web:stats             hash  games, wins (all time)
//
// GET /api/stats?d=YYYYMMDD returns overview(): the day's and all-time totals
// for the website and the Telegram bot (keys in telegram/stats.js), for the
// stats page (stats.html).

const { shiftYmd, utcYmd } = require('../telegram/dates');
const { K: TG } = require('../telegram/stats');

const K = {
  day: ymd => `gg:web:stats:${ymd}`,
  moves: ymd => `gg:web:moves:${ymd}`,
  total: 'gg:web:stats',
};

const MAX_MOVES = 999;

// The player's date is within a day of UTC today in any time zone
function isPlausibleDay(ymd, now) {
  const today = utcYmd(now);
  return ymd >= shiftYmd(today, -1) && ymd <= shiftYmd(today, 1);
}

function parseEvent(body, now = new Date()) {
  if (!body || typeof body !== 'object') return null;
  const { e, d, m, f } = body;
  if (e !== 's' && e !== 'w') return null;
  if (!Number.isInteger(d) || shiftYmd(d, 0) !== d || !isPlausibleDay(d, now)) return null;
  if (e === 'w' && !(Number.isInteger(m) && m >= 1 && m <= MAX_MOVES)) return null;
  return { e, d, m: e === 'w' ? m : 0, first: f === 1 || f === true };
}

const count = v => Number(v) || 0;

// Today's totals, and how a solve in `moves` compares with the first solves
async function dayStats(store, ymd, moves) {
  const [day, dist] = await Promise.all([
    store.hmget(K.day(ymd), ['players', 'games', 'solvers', 'wins']),
    store.hgetall(K.moves(ymd)),
  ]);
  const [players, games, solvers, wins] = day.map(count);
  const entries = Object.entries(dist).map(([k, v]) => [Number(k), count(v)]).sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  let median = null, seen = 0;
  for (const [m, n] of entries) {
    seen += n;
    if (seen * 2 >= total) { median = m; break; }
  }
  const out = {
    players: Math.max(players, solvers), // a solve whose start wasn't reported still counts
    solvers,
    games: Math.max(games, wins),
    wins,
    median,
  };
  if (moves) {
    const more = entries.filter(([m]) => m > moves).reduce((s, [, n]) => s + n, 0);
    // Share of the other solvers who needed more moves (this solve is among them once)
    out.beat = total > 1 ? Math.round(more / (total - 1) * 100) : null;
  }
  return out;
}

async function recordEvent(store, ev) {
  const writes = [];
  if (ev.e === 's') {
    writes.push(store.hincrby(K.day(ev.d), 'games', 1), store.hincrby(K.total, 'games', 1));
    if (ev.first) writes.push(store.hincrby(K.day(ev.d), 'players', 1));
  } else {
    writes.push(store.hincrby(K.day(ev.d), 'wins', 1), store.hincrby(K.total, 'wins', 1));
    if (ev.first) {
      writes.push(store.hincrby(K.day(ev.d), 'solvers', 1), store.hincrby(K.moves(ev.d), ev.m, 1));
    }
  }
  await Promise.all(writes);
  return ev.e === 'w' ? dayStats(store, ev.d, ev.m) : null;
}

// GET query: ?d=YYYYMMDD (player's local date), else UTC today
function parseDay(query, now = new Date()) {
  const d = Number(query && query.d);
  return Number.isInteger(d) && shiftYmd(d, 0) === d && isPlausibleDay(d, now) ? d : utcYmd(now);
}

// Totals for the stats page: web and Telegram, for `ymd` and all time
async function overview(store, ymd) {
  const [webDay, webTotal, tgDayPlayers, tgDay, tgPlayers, tgTotal, tgSince] = await Promise.all([
    store.hmget(K.day(ymd), ['players', 'games', 'solvers', 'wins']),
    store.hmget(K.total, ['games', 'wins']),
    store.zcard(TG.dayPlayers(ymd)),
    store.hmget(TG.dayStats(ymd), ['games', 'wins']),
    store.zcard(TG.players),
    store.hmget(TG.stats, ['games', 'wins']),
    store.get(TG.since),
  ]);
  const [players, games, solvers, wins] = webDay.map(count);
  // Never fewer games than wins, or players than solvers (see dayStats)
  const totals = (g, w) => ({ games: Math.max(count(g), count(w)), wins: count(w) });
  return {
    day: ymd,
    web: {
      today: { players: Math.max(players, solvers), solvers, ...totals(games, wins) },
      allTime: totals(...webTotal),
    },
    telegram: {
      today: { players: count(tgDayPlayers), ...totals(...tgDay) },
      allTime: { players: count(tgPlayers), ...totals(...tgTotal) },
      since: tgSince ? Number(tgSince) : null,
    },
  };
}

module.exports = { K, MAX_MOVES, dayStats, isPlausibleDay, overview, parseDay, parseEvent, recordEvent };
