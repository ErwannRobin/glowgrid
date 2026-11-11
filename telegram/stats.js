'use strict';
// Play statistics for the Telegram bot (/stats): players, games and win rate,
// for the asker's current day and all time. Only today's puzzle counts (archive
// widgets don't report to the bot).
//
// A game starts with the first move on a fresh grid (also after "Reset"): the
// widget sends "s" + YYYYMMDD. A win is a solve ("w" + YYYYMMDD + moves) by a
// player whose start was recorded that day, so solves from widgets sent before
// start reports existed don't push the win rate past 100%.
//
// Redis keys:
//   gg:tg:players:<YYYYMMDD>  zset  user → games started that day (0: solved only)
//   gg:tg:players             zset  user → first day played
//   gg:tg:stats:<YYYYMMDD>    hash  games, wins
//   gg:tg:stats               hash  games, wins (all time)
//   gg:tg:stats-since         string, first day counted

const { formatYmd, puzzleNumberFromYmd } = require('./dates');

const K = {
  dayPlayers: ymd => `gg:tg:players:${ymd}`,
  players: 'gg:tg:players',
  dayStats: ymd => `gg:tg:stats:${ymd}`,
  stats: 'gg:tg:stats',
  since: 'gg:tg:stats-since',
};

// Widget request data for a game start: "s" + YYYYMMDD (player's local date)
function parseStart(data) {
  const m = /^s(\d{8})$/.exec(data || '');
  return m ? Number(m[1]) : null;
}

function seen(store, userId, ymd) {
  return Promise.all([
    store.zadd(K.players, userId, ymd, 'LT'),
    store.set(K.since, ymd, { nx: true }),
  ]);
}

async function recordStart(store, userId, ymd) {
  await Promise.all([
    store.zincrby(K.dayPlayers(ymd), userId, 1),
    store.hincrby(K.dayStats(ymd), 'games', 1),
    store.hincrby(K.stats, 'games', 1),
    seen(store, userId, ymd),
  ]);
}

async function recordWin(store, userId, ymd) {
  // +0 adds a player who solved without a recorded start, and returns their games
  const [games] = await Promise.all([store.zincrby(K.dayPlayers(ymd), userId, 0), seen(store, userId, ymd)]);
  if (Number(games) > 0) {
    await Promise.all([store.hincrby(K.dayStats(ymd), 'wins', 1), store.hincrby(K.stats, 'wins', 1)]);
  }
}

const count = v => Number(v) || 0;

function formatBlock(title, players, games, wins) {
  const rate = games ? `${Math.round(Math.min(wins, games) / games * 100)}% (${Math.min(wins, games)} of ${games})` : '—';
  return [title, `👥 Players: ${players}`, `🎮 Games: ${games}`, `✅ Win rate: ${rate}`].join('\n');
}

// day: the asker's current day (see currentDay in leaderboard.js)
async function statsText(store, day) {
  const [dayPlayers, dayStats, players, stats, since] = await Promise.all([
    store.zcard(K.dayPlayers(day)),
    store.hmget(K.dayStats(day), ['games', 'wins']),
    store.zcard(K.players),
    store.hmget(K.stats, ['games', 'wins']),
    store.get(K.since),
  ]);
  return [
    `📊 Stats — puzzle #${puzzleNumberFromYmd(day)} (${formatYmd(day)})`,
    '',
    formatBlock('Today', count(dayPlayers), count(dayStats[0]), count(dayStats[1])),
    '',
    formatBlock(`All time${since ? ` (since ${formatYmd(Number(since))})` : ''}`, count(players), count(stats[0]), count(stats[1])),
    '',
    'A game starts with the first move (Reset starts a new one) and is won when solved. Archive puzzles don\'t count.',
  ].join('\n');
}

module.exports = { K, parseStart, recordStart, recordWin, statsText };
