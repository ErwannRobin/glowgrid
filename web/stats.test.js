'use strict';
// Run with: node --test web/stats.test.js   (or make test)

const test = require('node:test');
const assert = require('node:assert/strict');
const { K, parseEvent, recordEvent } = require('./stats');
const { createMemoryStore } = require('../telegram/store');

const NOW = new Date(Date.UTC(2026, 10, 12, 12));

test('parseEvent validates the event, day and moves', () => {
  assert.deepEqual(parseEvent({ e: 's', d: 20261112, f: 1 }, NOW), { e: 's', d: 20261112, m: 0, first: true });
  assert.deepEqual(parseEvent({ e: 'w', d: 20261113, m: 9, f: 0 }, NOW), { e: 'w', d: 20261113, m: 9, first: false });
  assert.equal(parseEvent({ e: 's', d: 20261110 }, NOW), null); // too old
  assert.equal(parseEvent({ e: 's', d: 20261114 }, NOW), null); // too far ahead
  assert.equal(parseEvent({ e: 's', d: '20261112' }, NOW), null);
  assert.equal(parseEvent({ e: 'w', d: 20261112 }, NOW), null); // no moves
  assert.equal(parseEvent({ e: 'w', d: 20261112, m: 0 }, NOW), null);
  assert.equal(parseEvent({ e: 'w', d: 20261112, m: 1000 }, NOW), null);
  assert.equal(parseEvent({ e: 'x', d: 20261112 }, NOW), null);
  assert.equal(parseEvent(null, NOW), null);
});

test('starts count games and first-of-day players', async () => {
  const store = createMemoryStore();
  assert.equal(await recordEvent(store, { e: 's', d: 20261112, first: true }), null);
  await recordEvent(store, { e: 's', d: 20261112, first: false });
  assert.deepEqual(await store.hmget(K.day(20261112), ['players', 'games']), ['1', '2']);
  assert.deepEqual(await store.hmget(K.total, ['games']), ['2']);
});

test('wins return totals, median and the share of solvers beaten', async () => {
  const store = createMemoryStore();
  const d = 20261112;
  for (let i = 0; i < 4; i++) await recordEvent(store, { e: 's', d, first: true });
  await recordEvent(store, { e: 'w', d, m: 12, first: true });
  await recordEvent(store, { e: 'w', d, m: 10, first: true });
  await recordEvent(store, { e: 'w', d, m: 20, first: true });
  const out = await recordEvent(store, { e: 'w', d, m: 9, first: true });
  assert.deepEqual(out, { players: 4, solvers: 4, games: 4, wins: 4, median: 10, beat: 100 });
  // A repeat solve counts as a win but stays out of the distribution
  const again = await recordEvent(store, { e: 'w', d, m: 15, first: false });
  assert.equal(again.solvers, 4);
  assert.equal(again.wins, 5);
  assert.equal(again.games, 5); // never fewer games than wins
  assert.equal(again.beat, 33); // 1 of the 3 others needed more than 15
});

test('the first solver has nobody to compare with', async () => {
  const store = createMemoryStore();
  const out = await recordEvent(store, { e: 'w', d: 20261112, m: 7, first: true });
  assert.deepEqual(out, { players: 1, solvers: 1, games: 1, wins: 1, median: 7, beat: null });
});
