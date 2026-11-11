'use strict';
// Leaderboards for the Telegram bot (/leaderboard).
//
// Current: fewest moves on today's puzzle, and the longest streaks still alive.
// All time: most days won (fewest moves of the day), and the best streaks ever.
//
// Redis keys (see docs/telegram-widget.md):
//   gg:tg:day:<YYYYMMDD>  zset  user → moves × 1e10 + solve unix time (lowest = best,
//                               ties go to the earlier solve)
//   gg:tg:streak          zset  user → current streak (dropped once it's broken)
//   gg:tg:last            zset  user → last solved day, to find broken streaks
//   gg:tg:best            zset  user → best streak
//   gg:tg:wins            zset  user → days won
//   gg:tg:won:<YYYYMMDD>  string, set once that day's win is counted
//   gg:tg:won-through     string, last day whose win is counted
//   gg:tg:names           hash  user → display name

const { shiftYmd, utcYmd, formatYmd, puzzleNumberFromYmd } = require('./dates');

const K = {
  day: ymd => `gg:tg:day:${ymd}`,
  streak: 'gg:tg:streak',
  last: 'gg:tg:last',
  best: 'gg:tg:best',
  wins: 'gg:tg:wins',
  won: ymd => `gg:tg:won:${ymd}`,
  wonThrough: 'gg:tg:won-through',
  names: 'gg:tg:names',
};

const TOP = 5;
const TIME_SCALE = 1e10; // > any unix time in seconds; moves × 1e10 stays exact in a double
const MEDALS = ['🥇', '🥈', '🥉'];

const dayScore = (moves, now) => moves * TIME_SCALE + Math.floor(now / 1000);
const movesOf = score => Math.floor(score / TIME_SCALE);

// A streak is alive while its last day is at most 2 days before UTC today
// (yesterday in the player's time zone can be 2 UTC days back), like /streak.
const streakCutoff = today => shiftYmd(today, -3);

// A day's puzzle can be solved until that day ends in UTC−12, and the bot accepts
// days up to UTC today ± 1: day D is final once UTC today is D + 2.
const lastFinalDay = today => shiftYmd(today, -2);

function displayName(from = {}) {
  let name = [from.first_name, from.last_name && from.last_name[0] + '.'].filter(Boolean).join(' ')
    || (from.username && '@' + from.username) || 'Player';
  name = name.replace(/\s+/g, ' ').trim();
  return name.length > 24 ? name.slice(0, 23) + '…' : name;
}

const saveName = (store, from) => store.hset(K.names, from.id, displayName(from));

// After a solve: record = the player's new streak record {s, b, l}
async function recordSolve(store, from, { ymd, moves }, record, now) {
  await Promise.all([
    store.zadd(K.day(ymd), from.id, dayScore(moves, now), 'LT'),
    indexRecord(store, from.id, record),
    saveName(store, from),
  ]);
}

// Puts a streak record in the streak leaderboards (also for players whose
// record predates them)
function indexRecord(store, userId, rec) {
  if (!rec || !rec.l) return Promise.resolve();
  return Promise.all([
    store.zadd(K.streak, userId, rec.s),
    store.zadd(K.last, userId, rec.l),
    store.zadd(K.best, userId, rec.b, 'GT'),
  ]);
}

async function pruneBrokenStreaks(store, today) {
  const broken = await store.zpopUpTo(K.last, streakCutoff(today));
  await store.zrem(K.streak, broken);
}

// Counts the winner of each finished day not counted yet (at most 14 days back)
async function countWins(store, today) {
  const final = lastFinalDay(today);
  const through = Number(await store.get(K.wonThrough)) || 0;
  let d = Math.max(through ? shiftYmd(through, 1) : 0, shiftYmd(final, -13));
  if (d > final) return;
  for (; d <= final; d = shiftYmd(d, 1)) {
    const [top] = await store.ztop(K.day(d), 1);
    // The marker makes this safe when two requests count the same day
    if (top && await store.set(K.won(d), 1, { nx: true })) await store.zincrby(K.wins, top.member, 1);
  }
  await store.set(K.wonThrough, final);
}

// Rank with ties sharing a place: 1 + players strictly better
async function rank(store, key, score, higherIsBetter) {
  return 1 + await (higherIsBetter ? store.zcountAbove(key, score) : store.zcountBelow(key, score));
}

// One board: top entries with names, and the asker's place
async function board(store, key, userId, { higherIsBetter }) {
  const [top, mine, total] = await Promise.all([
    store.ztop(key, TOP, { desc: higherIsBetter }),
    store.zscore(key, userId),
    store.zcard(key),
  ]);
  const names = await store.hmget(K.names, top.map(e => e.member));
  // Places: ties share one, except day scores where the time breaks them
  const places = [];
  top.forEach((e, i) => places.push(i && top[i - 1].score === e.score ? places[i - 1] : i + 1));
  return {
    top: top.map((e, i) => ({ place: places[i], name: names[i] || 'Player', score: e.score, me: e.member === String(userId) })),
    me: mine === null ? null : { place: await rank(store, key, mine, higherIsBetter), score: mine },
    total,
  };
}

function formatBoard(title, b, fmt, empty, missing) {
  const lines = [title];
  if (!b.top.length) return lines.concat(empty).join('\n');
  for (const e of b.top) {
    lines.push(`${MEDALS[e.place - 1] || e.place + '.'} ${e.name}${e.me ? ' (you)' : ''} — ${fmt(e.score)}`);
  }
  if (!b.me) lines.push(missing);
  else if (!b.top.some(e => e.me)) lines.push(`You: #${b.me.place} of ${b.total} — ${fmt(b.me.score)}`);
  return lines.join('\n');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The day the asker is on: their last solve if it's "today" in some time zone
// (UTC today ± 1), else UTC today
function currentDay(rec, now) {
  const today = utcYmd(now);
  return rec && rec.l >= shiftYmd(today, -1) && rec.l <= shiftYmd(today, 1) ? rec.l : today;
}

async function currentLeaderboard(store, userId, rec, now) {
  const today = utcYmd(now), day = currentDay(rec, now);
  await pruneBrokenStreaks(store, today);
  const [moves, streaks] = await Promise.all([
    board(store, K.day(day), userId, { higherIsBetter: false }),
    board(store, K.streak, userId, { higherIsBetter: true }),
  ]);
  return [
    `🏆 Leaderboard — puzzle #${puzzleNumberFromYmd(day)} (${formatYmd(day)})`,
    '',
    formatBoard('Fewest moves today', moves, s => plural(movesOf(s), 'move'),
      'Nobody has solved it yet. Be the first: /play', 'You: not solved yet — /play'),
    '',
    formatBoard('Current streaks', streaks, s => `🔥 ${plural(s, 'day')}`,
      'No streaks yet.', 'You: no streak yet — /play'),
    '',
    'All-time records: /leaderboard_all',
  ].join('\n');
}

async function allTimeLeaderboard(store, userId) {
  const [wins, best] = await Promise.all([
    board(store, K.wins, userId, { higherIsBetter: true }),
    board(store, K.best, userId, { higherIsBetter: true }),
  ]);
  return [
    '🏆 All-time leaderboard',
    '',
    formatBoard('Days won (fewest moves of the day)', wins, s => plural(s, 'day'),
      'No days won yet.', 'You: no days won yet'),
    '',
    formatBoard('Longest streaks', best, s => `🔥 ${plural(s, 'day')}`,
      'No streaks yet.', 'You: no streak yet — /play'),
    '',
    'A day is won with the fewest moves (ties: first to solve), counted 2 days later once every time zone is done.',
    'Today: /leaderboard',
  ].join('\n');
}

// "/leaderboard [all]" (or "/leaderboard_all", which Telegram makes tappable as
// one command): argument → mode, or null if unknown
function parseLeaderboardMode(arg) {
  const a = (arg || '').toLowerCase();
  if (['', 'today', 'now', 'current', 'actual'].includes(a)) return 'current';
  if (['all', 'alltime', 'all-time', 'ever'].includes(a)) return 'all';
  return null;
}

async function leaderboardText(store, from, rec, mode, now) {
  await Promise.all([saveName(store, from), indexRecord(store, from.id, rec)]);
  await countWins(store, utcYmd(now));
  return mode === 'all' ? allTimeLeaderboard(store, from.id) : currentLeaderboard(store, from.id, rec, now);
}

module.exports = { K, displayName, leaderboardText, parseLeaderboardMode, recordSolve };
