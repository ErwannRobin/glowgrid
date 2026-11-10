'use strict';
// GlowGrid Telegram bot: sends the daily-puzzle widget and keeps streaks.
//
// Framework-agnostic: handleUpdate() takes one Telegram Update. It runs behind
// the Vercel webhook (api/telegram.js) or the local long-polling loop
// (scripts/telegram.js poll). See docs/telegram-widget.md.

const fs = require('fs');
const path = require('path');
const { minifyWidget } = require('./minify');

const SITE_URL = 'https://glow-grid.vercel.app';
const WIDGET_HEIGHT = 440;

let widgetHtml = null;
function getWidgetHtml() {
  if (!widgetHtml) widgetHtml = minifyWidget(fs.readFileSync(path.join(__dirname, 'widget.html'), 'utf8'));
  return widgetHtml;
}

// ── Dates as YYYYMMDD integers ───────────────────────────────

function utcYmd(date) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function shiftYmd(ymd, days) {
  const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100;
  return utcYmd(new Date(Date.UTC(y, m - 1, d + days)));
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

// ── Handlers ─────────────────────────────────────────────────

const storeKey = userId => `gg:tg:${userId}`;

async function getRecord(store, userId) {
  try { return JSON.parse(await store.get(storeKey(userId))) || null; } catch { return null; }
}

async function sendPuzzle(api, store, chatId, userId) {
  const rec = await getRecord(store, userId);
  return api('sendWidget', {
    chat_id: chatId,
    html: getWidgetHtml(),
    height: WIDGET_HEIGHT,
    chat_data: rec ? JSON.stringify(rec) : '',
    allow_queries: true,
    caption: 'Light up all 25 cells. ON cells flip their + neighbours, OFF cells their × neighbours. A new puzzle every day, right here in this message.',
    reply_markup: { inline_keyboard: [[{ text: 'Play on the web', url: SITE_URL }]] },
  });
}

async function onMessage(api, store, msg) {
  const text = (msg.text || '').trim();
  const command = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : '';
  const chatId = msg.chat.id;
  if (command === '/start' || command === '/play') {
    return sendPuzzle(api, store, chatId, msg.from.id);
  }
  if (command === '/streak') {
    const rec = await getRecord(store, msg.from.id);
    const alive = rec && rec.l >= shiftYmd(utcYmd(new Date()), -2);
    return api('sendMessage', {
      chat_id: chatId,
      text: rec ? `🔥 Current streak: ${alive ? rec.s : 0}\n🏆 Best streak: ${rec.b}` : 'No solves yet. Send /play to start.',
    });
  }
  return api('sendMessage', {
    chat_id: chatId,
    text: '/play — today\'s puzzle\n/streak — your streak\n\nThe puzzle message updates itself every day, so you can keep playing in the same one.',
  });
}

async function onWidgetQuery(api, store, q, now) {
  const solve = parseSolve(q.data);
  if (!solve || !isPlausibleDay(solve.ymd, now)) {
    return api('answerWidgetQuery', { widget_query_id: q.id });
  }
  const before = await getRecord(store, q.from.id);
  const rec = nextRecord(before, solve.ymd);
  const data = JSON.stringify(rec);
  if (!before || rec.l !== before.l) await store.set(storeKey(q.from.id), data);
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
  if (update.message) return onMessage(api, store, update.message);
  if (update.widget_query) return onWidgetQuery(api, store, update.widget_query, now);
  // Not used: GlowGrid widgets are not shared. Answer so the tap doesn't hang.
  if (update.shared_widget_query) return api('answerWidgetQuery', { widget_query_id: update.shared_widget_query.id });
}

const ALLOWED_UPDATES = ['message', 'widget_query', 'shared_widget_query'];

module.exports = {
  ALLOWED_UPDATES, createApi, getWidgetHtml, handleUpdate,
  isPlausibleDay, nextRecord, parseSolve, shiftYmd, utcYmd,
};
