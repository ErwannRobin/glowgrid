'use strict';
// Anonymous play statistics for the website: the page posts game starts and
// wins, and gets today's totals back after a win. See web/stats.js.

const { createStore } = require('../telegram/store');
const { parseEvent, recordEvent } = require('../web/stats');

const store = createStore();

module.exports = async function stats(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ev = parseEvent(req.body);
  if (!ev) return res.status(400).json({ error: 'bad event' });
  try {
    res.status(200).json((await recordEvent(store, ev)) || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'store unavailable' });
  }
};
