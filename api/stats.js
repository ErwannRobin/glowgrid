'use strict';
// Anonymous play statistics for the website: the page posts game starts and
// wins, and gets today's totals back after a win. GET returns the web and
// Telegram totals for the stats page. See web/stats.js.

const { createStore } = require('../telegram/store');
const { overview, parseDay, parseEvent, recordEvent } = require('../web/stats');

const store = createStore();

module.exports = async function stats(req, res) {
  if (req.method === 'GET') {
    // Shared by everyone asking for the same day: a minute of staleness is fine
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    try {
      return res.status(200).json(await overview(store, parseDay(req.query)));
    } catch (e) {
      console.error(e);
      res.setHeader('cache-control', 'no-store');
      return res.status(500).json({ error: 'store unavailable' });
    }
  }
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
  const ev = parseEvent(req.body);
  if (!ev) return res.status(400).json({ error: 'bad event' });
  try {
    res.status(200).json((await recordEvent(store, ev)) || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'store unavailable' });
  }
};
