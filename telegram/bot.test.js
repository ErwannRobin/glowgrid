'use strict';
// Run with: node --test telegram/bot.test.js   (or make telegram-test)

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const {
  getWidgetHtml, handleUpdate, isPlausibleDay, nextRecord, parseArchiveDay, parseSolve,
  puzzleNumberFromYmd, shiftYmd, webhookSecret,
} = require('./bot');
const { createMemoryStore } = require('./store');

test('shiftYmd crosses month and year boundaries', () => {
  assert.equal(shiftYmd(20261231, 1), 20270101);
  assert.equal(shiftYmd(20260301, -1), 20260228);
  assert.equal(shiftYmd(20240301, -1), 20240229);
});

test('parseSolve accepts "w" + YYYYMMDD + moves only', () => {
  assert.deepEqual(parseSolve('w2026111012'), { ymd: 20261110, moves: 12 });
  assert.equal(parseSolve('w20261110'), null);
  assert.equal(parseSolve('w2026023112'), null); // Feb 31st
  assert.equal(parseSolve('x2026111012'), null);
  assert.equal(parseSolve(undefined), null);
});

test('isPlausibleDay allows ±1 day around UTC today', () => {
  const now = new Date(Date.UTC(2026, 10, 10, 12));
  assert.ok(isPlausibleDay(20261109, now));
  assert.ok(isPlausibleDay(20261111, now));
  assert.ok(!isPlausibleDay(20261108, now));
  assert.ok(!isPlausibleDay(20261112, now));
});

test('nextRecord builds, keeps and resets streaks', () => {
  let r = nextRecord(null, 20261109);
  assert.deepEqual(r, { s: 1, b: 1, l: 20261109 });
  r = nextRecord(r, 20261110);
  assert.deepEqual(r, { s: 2, b: 2, l: 20261110 });
  assert.deepEqual(nextRecord(r, 20261110), r); // same day twice
  assert.deepEqual(nextRecord(r, 20261101), r); // older day
  assert.deepEqual(nextRecord(r, 20261113), { s: 1, b: 2, l: 20261113 }); // missed days
});

test('the widget the bot sends fits the limits', () => {
  const html = getWidgetHtml();
  assert.ok(Buffer.byteLength(html) <= 32768);
  assert.ok(zlib.deflateSync(Buffer.from(html), { level: 9 }).length <= 4096);
});

function fakeApi() {
  const calls = [];
  const api = async (method, params) => { calls.push({ method, params }); return true; };
  return { api, calls };
}

test('/start sends the widget with the stored record as chat data', async () => {
  const { api, calls } = fakeApi();
  const store = createMemoryStore();
  await store.set('gg:tg:7', '{"s":3,"b":4,"l":20261109}');
  await handleUpdate({ message: { text: '/start', chat: { id: 7 }, from: { id: 7 } } }, { api, store });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendWidget');
  assert.equal(calls[0].params.chat_id, 7);
  assert.equal(calls[0].params.allow_queries, true);
  assert.equal(calls[0].params.chat_data, '{"s":3,"b":4,"l":20261109}');
});

test('a solve query updates the streak, answers, then edits chat data', async () => {
  const { api, calls } = fakeApi();
  const store = createMemoryStore();
  await store.set('gg:tg:7', '{"s":3,"b":4,"l":20261109}');
  const now = new Date(Date.UTC(2026, 10, 10, 12));
  await handleUpdate({
    widget_query: { id: 'q1', from: { id: 7 }, chat: { id: 7 }, message_id: 42, data: 'w2026111015' },
  }, { api, store, now });
  const rec = '{"s":4,"b":4,"l":20261110}';
  assert.equal(await store.get('gg:tg:7'), rec);
  assert.deepEqual(calls.map(c => c.method), ['answerWidgetQuery', 'editMessageWidgetData']);
  assert.deepEqual(calls[0].params, { widget_query_id: 'q1', data: rec });
  assert.deepEqual(calls[1].params, { chat_id: 7, message_id: 42, chat_data: rec });
});

test('an implausible solve is answered without data and stores nothing', async () => {
  const { api, calls } = fakeApi();
  const store = createMemoryStore();
  const now = new Date(Date.UTC(2026, 10, 10, 12));
  await handleUpdate({
    widget_query: { id: 'q2', from: { id: 7 }, chat: { id: 7 }, message_id: 42, data: 'w2030010110' },
  }, { api, store, now });
  assert.equal(await store.get('gg:tg:7'), null);
  assert.deepEqual(calls, [{ method: 'answerWidgetQuery', params: { widget_query_id: 'q2' } }]);
});

test('puzzle numbers match the website (#1 is 2025-01-01)', () => {
  assert.equal(puzzleNumberFromYmd(20250101), 1);
  assert.equal(puzzleNumberFromYmd(20260512), 497);
  assert.equal(puzzleNumberFromYmd(20261111), 680);
});

test('parseArchiveDay accepts puzzle numbers and dates up to UTC today', () => {
  const now = new Date(Date.UTC(2026, 10, 11, 12));
  assert.equal(parseArchiveDay('497', now), 20260512);
  assert.equal(parseArchiveDay('#1', now), 20250101);
  assert.equal(parseArchiveDay('2026-10-05', now), 20261005);
  assert.equal(parseArchiveDay('2026-11-11', now), 20261111);
  assert.equal(parseArchiveDay('2026-11-12', now), null); // future
  assert.equal(parseArchiveDay('681', now), null);        // future
  assert.equal(parseArchiveDay('0', now), null);
  assert.equal(parseArchiveDay('2024-12-31', now), null); // before #1
  assert.equal(parseArchiveDay('2026-02-30', now), null);
  assert.equal(parseArchiveDay('oct', now), null);
});

test('/yesterday and bare /archive send an archive widget anchored on the message time', async () => {
  for (const text of ['/yesterday', '/archive', '/archive@GlowGridBot']) {
    const { api, calls } = fakeApi();
    await handleUpdate({ message: { text, date: 1794398400, chat: { id: 7 }, from: { id: 7 } } },
      { api, store: createMemoryStore() });
    assert.equal(calls.length, 1, text);
    assert.equal(calls[0].method, 'sendWidget');
    assert.equal(calls[0].params.chat_data, '{"t":1794398400}');
    assert.equal(calls[0].params.allow_queries, undefined); // archive solves aren't reported
  }
});

test('/archive <day> sends that day, and explains bad input', async () => {
  const now = new Date(Date.UTC(2026, 10, 11, 12));
  let { api, calls } = fakeApi();
  await handleUpdate({ message: { text: '/archive 497', chat: { id: 7 }, from: { id: 7 } } }, { api, store: createMemoryStore(), now });
  assert.equal(calls[0].method, 'sendWidget');
  assert.equal(calls[0].params.chat_data, '{"d":20260512}');
  assert.match(calls[0].params.caption, /^Puzzle #497 \(12 May 2026\)/);

  ({ api, calls } = fakeApi());
  await handleUpdate({ message: { text: '/archive 2030-01-01', chat: { id: 7 }, from: { id: 7 } } }, { api, store: createMemoryStore(), now });
  assert.equal(calls[0].method, 'sendMessage');
  assert.match(calls[0].params.text, /\/archive 497/);
});

test('webhookSecret: explicit value, else derived from the token', () => {
  assert.equal(webhookSecret({ TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_WEBHOOK_SECRET: 'mine' }), 'mine');
  assert.equal(webhookSecret({}), null);
  const derived = webhookSecret({ TELEGRAM_BOT_TOKEN: '1:abc' });
  assert.match(derived, /^[0-9a-f]{64}$/); // Telegram allows 1-256 of A-Z a-z 0-9 _ -
  assert.equal(webhookSecret({ TELEGRAM_BOT_TOKEN: '1:abc' }), derived);
  assert.notEqual(webhookSecret({ TELEGRAM_BOT_TOKEN: '1:abd' }), derived);
  assert.ok(!derived.includes('abc'));
});

test('"y" widget query (win screen button) sends yesterday\'s puzzle', async () => {
  const { api, calls } = fakeApi();
  const now = new Date(Date.UTC(2026, 10, 10, 12));
  await handleUpdate({ widget_query: { id: 'q1', data: 'y', from: { id: 7 }, chat: { id: 7 }, message_id: 3 } },
    { api, store: createMemoryStore(), now });
  assert.deepEqual(calls.map(c => c.method), ['answerWidgetQuery', 'sendWidget']);
  assert.equal(calls[1].params.chat_id, 7);
  assert.equal(calls[1].params.chat_data, JSON.stringify({ t: Math.floor(now / 1000) }));
  assert.ok(!calls[1].params.allow_queries);
});

// ── Leaderboard ──────────────────────────────────────────────

const { parseLeaderboardMode } = require('./leaderboard');

async function solve(store, id, first_name, data, now) {
  await handleUpdate({ widget_query: { id: 'q', from: { id, first_name }, data } }, { api: fakeApi().api, store, now });
}

const NAMES = { 1: 'Ann', 2: 'Bob' };
async function leaderboard(store, id, text, now) {
  const { api, calls } = fakeApi();
  await handleUpdate({ message: { text, chat: { id }, from: { id, first_name: NAMES[id] || 'P' + id } } }, { api, store, now });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  return calls[0].params.text;
}

test('parseLeaderboardMode: current by default, "all" for all time', () => {
  for (const a of [undefined, '', 'today', 'current', 'actual', 'NOW']) assert.equal(parseLeaderboardMode(a), 'current');
  for (const a of ['all', 'all-time', 'alltime', 'ever']) assert.equal(parseLeaderboardMode(a), 'all');
  assert.equal(parseLeaderboardMode('foo'), null);
});

test('/leaderboard ranks today by fewest moves (ties: first solve) and shows the asker', async () => {
  const store = createMemoryStore();
  const t = h => new Date(Date.UTC(2026, 10, 11, h));
  await solve(store, 1, 'Ann', 'w2026111120', t(8));
  await solve(store, 1, 'Ann', 'w2026111112', t(9));  // better replay counts
  await solve(store, 1, 'Ann', 'w2026111118', t(10)); // worse replay doesn't
  await solve(store, 2, 'Bob', 'w2026111112', t(11)); // same moves, later
  await solve(store, 3, 'Cy', 'w2026111109', t(12));
  for (let i = 10; i < 17; i++) await solve(store, i, 'X' + i, 'w2026111130', t(13));
  await solve(store, 20, 'Zed', 'w2026111140', t(14));

  const text = await leaderboard(store, 20, '/leaderboard', t(15));
  assert.match(text, /puzzle #680 \(11 Nov 2026\)/);
  const moves = text.split('\n\n')[1];
  assert.match(moves, /🥇 Cy — 9 moves\n🥈 Ann — 12 moves\n🥉 Bob — 12 moves\n4\. X1\d — 30 moves/);
  assert.match(moves, /You: #11 of 11 — 40 moves/);

  assert.match(text, /All-time records: \/leaderboard_all$/);

  const none = await leaderboard(store, 99, '/leaderboard', t(15));
  assert.match(none.split('\n\n')[1], /You: not solved yet/);
});

test('/leaderboard current streaks drop broken ones; all-time keeps best streaks', async () => {
  const store = createMemoryStore();
  const day = d => new Date(Date.UTC(2026, 10, d, 12));
  for (let d = 1; d <= 5; d++) await solve(store, 1, 'Ann', `w202611${String(d).padStart(2, '0')}10`, day(d)); // 5, then stops
  for (let d = 4; d <= 11; d++) await solve(store, 2, 'Bob', `w202611${String(d).padStart(2, '0')}10`, day(d)); // 8, alive

  const cur = await leaderboard(store, 1, '/leaderboard', day(11));
  const streaks = cur.split('\n\n')[2];
  assert.match(streaks, /🥇 Bob — 🔥 8 days/);
  assert.doesNotMatch(streaks, /Ann/);
  assert.match(streaks, /You: no streak yet/);

  const all = await leaderboard(store, 1, '/leaderboard all', day(11));
  assert.equal(await leaderboard(store, 1, '/leaderboard_all', day(11)), all);
  const best = all.split('\n\n')[2];
  assert.match(best, /🥇 Bob — 🔥 8 days\n🥈 Ann \(you\) — 🔥 5 days/);
});

test('/leaderboard all counts a day win once, after the day is final', async () => {
  const store = createMemoryStore();
  const at = (d, h = 12) => new Date(Date.UTC(2026, 10, d, h));
  await solve(store, 1, 'Ann', 'w2026110912', at(9));
  await solve(store, 2, 'Bob', 'w2026110910', at(9, 13));
  await solve(store, 1, 'Ann', 'w2026111010', at(10));

  let all = await leaderboard(store, 1, '/leaderboard all', at(10));
  assert.match(all.split('\n\n')[1], /No days won yet/); // the 9th isn't final on the 10th

  all = await leaderboard(store, 1, '/leaderboard all', at(11));
  assert.match(all.split('\n\n')[1], /🥇 Bob — 1 day\nYou: no days won yet/);
  all = await leaderboard(store, 2, '/leaderboard all', at(11)); // asked again: not counted twice
  assert.match(all.split('\n\n')[1], /🥇 Bob \(you\) — 1 day$/);

  all = await leaderboard(store, 2, '/leaderboard all', at(12));
  const wins = all.split('\n\n')[1];
  assert.match(wins, /🥇 Ann — 1 day/); // tied: same place
  assert.match(wins, /🥇 Bob \(you\) — 1 day/);
});

test('/leaderboard with an unknown option explains the two', async () => {
  const text = await leaderboard(createMemoryStore(), 1, '/leaderboard week', new Date());
  assert.match(text, /\/leaderboard_all/);
});
