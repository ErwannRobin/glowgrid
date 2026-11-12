'use strict';
// GlowGrid Telegram bot: sends the daily-puzzle widget and keeps streaks.
//
// Framework-agnostic: handleUpdate() takes one Telegram Update. It runs behind
// the Vercel webhook (api/telegram.js) or the local long-polling loop
// (scripts/telegram.js poll). See docs/telegram-widget.md.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { minifyWidget } = require('./minify');
const { FIRST_DAY, formatYmd, puzzleNumberFromYmd, shiftYmd, utcYmd, ymdFromPuzzleNumber } = require('./dates');
const { currentDay, leaderboardText, parseLeaderboardMode, recordSolve } = require('./leaderboard');
const { parseStart, recordStart, recordWin, statsText } = require('./stats');

const SITE_URL = 'https://glow-grid.erwann.app';
const WIDGET_HEIGHT = 440;

let widgetHtml = null;
function getWidgetHtml() {
  if (!widgetHtml) widgetHtml = minifyWidget(fs.readFileSync(path.join(__dirname, 'widget.html'), 'utf8'));
  return widgetHtml;
}

// ── Archive ──────────────────────────────────────────────────

// "/archive" argument: a puzzle number ("497", "#497") or a date ("2026-10-05").
// Returns YYYYMMDD, or null if invalid or not yet in the archive. Days up to UTC
// today are accepted; the widget stops at yesterday in the player's time zone.
function parseArchiveDay(arg, now = new Date()) {
  let ymd, m;
  if ((m = /^#?(\d{1,5})$/.exec(arg || ''))) {
    ymd = ymdFromPuzzleNumber(Number(m[1]));
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(arg || ''))) {
    ymd = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    if (shiftYmd(ymd, 0) !== ymd) return null; // not a real calendar date
  } else {
    return null;
  }
  return ymd >= FIRST_DAY && ymd <= utcYmd(now) ? ymd : null;
}

// ── Streaks ──────────────────────────────────────────────────

// Widget request data for a solve: "w" + YYYYMMDD (player's local date) + moves
function parseSolve(data) {
  const m = /^w(\d{8})(\d{1,4})$/.exec(data || '');
  if (!m) return null;
  const ymd = Number(m[1]);
  if (shiftYmd(ymd, 0) !== ymd) return null; // not a real calendar date
  return { ymd, moves: Number(m[2]) };
}

// The player's local date can be up to a day ahead of or behind UTC
function isPlausibleDay(ymd, now = new Date()) {
  const today = utcYmd(now);
  return ymd >= shiftYmd(today, -1) && ymd <= shiftYmd(today, 1);
}

// Record: {s: current streak, b: best streak, l: last solved day (YYYYMMDD)}
function nextRecord(rec, ymd) {
  const r = { s: 0, b: 0, l: 0, ...rec };
  if (ymd <= r.l) return r; // already counted (or an older day)
  const s = r.l === shiftYmd(ymd, -1) ? r.s + 1 : 1;
  return { s, b: Math.max(r.b, s), l: ymd };
}

// ── Telegram API ─────────────────────────────────────────────

function createApi(token, fetchImpl = fetch) {
  return async function api(method, params) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`${method} failed: ${json.description}`);
    return json.result;
  };
}

// Webhook secret (X-Telegram-Bot-Api-Secret-Token): TELEGRAM_WEBHOOK_SECRET if
// set, else derived from the bot token, so the webhook and the CLI only need the
// token. HMAC-SHA256 in hex: allowed by Telegram, and it doesn't reveal the token.
function webhookSecret(env = process.env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  return crypto.createHmac('sha256', env.TELEGRAM_BOT_TOKEN).update('glowgrid-telegram-webhook').digest('hex');
}

// ── Handlers ─────────────────────────────────────────────────

const storeKey = userId => `gg:tg:${userId}`;

async function getRecord(store, userId) {
  try { return JSON.parse(await store.get(storeKey(userId))) || null; } catch { return null; }
}

function sendWidget(api, chatId, params) {
  return api('sendWidget', {
    chat_id: chatId,
    html: getWidgetHtml(),
    height: WIDGET_HEIGHT,
    reply_markup: { inline_keyboard: [[{ text: 'Play on the web', url: SITE_URL }]] },
    ...params,
  });
}

// Today's puzzle; chat data is the player's streak record
async function sendPuzzle(api, store, chatId, userId) {
  const rec = await getRecord(store, userId);
  return sendWidget(api, chatId, {
    chat_data: rec ? JSON.stringify(rec) : '',
    allow_queries: true,
    caption: 'Light up all 25 cells. ON cells flip their + neighbours, OFF cells their × neighbours. A new puzzle every day, right here in this message.',
  });
}

// Past puzzles. Chat data gives the first day: {"d": YYYYMMDD}, or {"t": unix
// time} for "yesterday", which the widget works out in the player's time zone.
// No queries: archive solves don't count for the streak.
function sendArchive(api, chatId, start) {
  const first = start.d ? `Puzzle #${puzzleNumberFromYmd(start.d)} (${formatYmd(start.d)})` : 'Yesterday\'s puzzle';
  return sendWidget(api, chatId, {
    chat_data: JSON.stringify(start),
    caption: `${first}. Use ‹ › to browse every puzzle since #1 (1 Jan 2025). Archive solves don't count for your streak.`,
  });
}

const HELP = '/play — today\'s puzzle\n/yesterday — yesterday\'s puzzle\n/archive — past puzzles (/archive 497 or /archive 2026-10-05)\n/streak — your streak\n/leaderboard — today\'s best players and current streaks (/leaderboard_all for all time)\n/stats — players, games and win rate, today and all time\n/about — about GlowGrid\n\nThe puzzle message updates itself every day, so you can keep playing in the same one.';

const ABOUT = [
  '✨ GlowGrid: a free daily puzzle inspired by Lights Out.',
  '',
  'Light up all 25 cells. Tapping an ON cell flips it and its + neighbours (up, down, left, right); an OFF cell flips it and its × neighbours (diagonals). Fewer moves is better.',
  '',
  'Everyone gets the same grid each day. It is made by scrambling a solved grid, so it can always be solved.',
  '',
  `Also on the web, with music, hints and song challenges: ${SITE_URL}`,
  'Open source: https://github.com/ErwannRobin/glowgrid',
  '',
  'Play: /play · All commands: /help',
].join('\n');

async function onMessage(api, store, msg, now) {
  const text = (msg.text || '').trim();
  const command = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : '';
  const arg = text.split(/\s+/)[1];
  const chatId = msg.chat.id;
  if (command === '/start' || command === '/play') {
    return sendPuzzle(api, store, chatId, msg.from.id);
  }
  if (command === '/yesterday' || (command === '/archive' && !arg)) {
    return sendArchive(api, chatId, { t: msg.date || Math.floor(now / 1000) });
  }
  if (command === '/archive') {
    const d = parseArchiveDay(arg, now);
    if (d) return sendArchive(api, chatId, { d });
    return api('sendMessage', {
      chat_id: chatId,
      text: 'Pick a puzzle number or a date from 1 Jan 2025 to yesterday, e.g. /archive 497 or /archive 2026-10-05.',
    });
  }
  if (command === '/streak') {
    const rec = await getRecord(store, msg.from.id);
    const alive = rec && rec.l >= shiftYmd(utcYmd(new Date()), -2);
    return api('sendMessage', {
      chat_id: chatId,
      text: rec ? `🔥 Current streak: ${alive ? rec.s : 0}\n🏆 Best streak: ${rec.b}` : 'No solves yet. Send /play to start.',
    });
  }
  if (command === '/leaderboard' || command === '/leaderboard_all') {
    const mode = command === '/leaderboard_all' ? 'all' : parseLeaderboardMode(arg);
    if (!mode) {
      return api('sendMessage', { chat_id: chatId, text: 'Use /leaderboard for today and current streaks, or /leaderboard_all for all time.' });
    }
    const rec = await getRecord(store, msg.from.id);
    return api('sendMessage', { chat_id: chatId, text: await leaderboardText(store, msg.from, rec, mode, now) });
  }
  if (command === '/about') {
    return api('sendMessage', { chat_id: chatId, text: ABOUT, link_preview_options: { is_disabled: true } });
  }
  if (command === '/stats') {
    const rec = await getRecord(store, msg.from.id);
    return api('sendMessage', { chat_id: chatId, text: await statsText(store, currentDay(rec, now)) });
  }
  return api('sendMessage', { chat_id: chatId, text: HELP });
}

async function onWidgetQuery(api, store, q, now) {
  // "y": the "Yesterday's puzzle" button on today's win screen, same as /yesterday
  if (q.data === 'y') {
    await api('answerWidgetQuery', { widget_query_id: q.id });
    return sendArchive(api, q.chat ? q.chat.id : q.from.id, { t: Math.floor(now / 1000) });
  }
  // "s" + YYYYMMDD: a game started (first move), for /stats
  const start = parseStart(q.data);
  if (start) {
    await api('answerWidgetQuery', { widget_query_id: q.id });
    if (isPlausibleDay(start, now)) {
      try { await recordStart(store, q.from.id, start); } catch (e) { console.error(e.message); }
    }
    return;
  }
  const solve = parseSolve(q.data);
  if (!solve || !isPlausibleDay(solve.ymd, now)) {
    return api('answerWidgetQuery', { widget_query_id: q.id });
  }
  const before = await getRecord(store, q.from.id);
  const rec = nextRecord(before, solve.ymd);
  const data = JSON.stringify(rec);
  if (!before || rec.l !== before.l) await store.set(storeKey(q.from.id), data);
  try {
    await Promise.all([recordSolve(store, q.from, solve, rec, now), recordWin(store, q.from.id, solve.ymd)]);
  } catch (e) {
    console.error(e.message); // the streak is saved; don't fail the answer over the leaderboard or stats
  }
  // Answer first (15 s deadline), then persist the record in the message
  await api('answerWidgetQuery', { widget_query_id: q.id, data });
  if (q.chat && q.message_id) {
    try {
      await api('editMessageWidgetData', { chat_id: q.chat.id, message_id: q.message_id, chat_data: data });
    } catch (e) {
      console.error(e.message);
    }
  }
}

async function handleUpdate(update, { api, store, now = new Date() }) {
  if (update.message) return onMessage(api, store, update.message, now);
  if (update.widget_query) return onWidgetQuery(api, store, update.widget_query, now);
  // Not used: GlowGrid widgets are not shared. Answer so the tap doesn't hang.
  if (update.shared_widget_query) return api('answerWidgetQuery', { widget_query_id: update.shared_widget_query.id });
}

const ALLOWED_UPDATES = ['message', 'widget_query', 'shared_widget_query'];

module.exports = {
  ALLOWED_UPDATES, createApi, getWidgetHtml, handleUpdate, webhookSecret,
  isPlausibleDay, nextRecord, parseArchiveDay, parseSolve, puzzleNumberFromYmd, shiftYmd, utcYmd,
};
