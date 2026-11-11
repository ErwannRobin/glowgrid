'use strict';
// Key-value store for streak records and leaderboards.
//
// Uses Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL/TOKEN (or
// the Vercel KV names KV_REST_API_URL/TOKEN) are set. Otherwise falls back to
// an in-memory store: fine for local polling, but serverless instances forget it.
//
// Both stores expose the same small API: strings (get/set), sorted sets (z*)
// and hashes (hset/hmget). Sorted-set ties are ordered by member, like Redis.

function createRedisStore(url, token, fetchImpl = fetch) {
  async function command(args) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    const json = await res.json();
    if (json.error) throw new Error(`Redis ${args[0]} failed: ${json.error}`);
    return json.result;
  }
  const pairs = flat => {
    const out = [];
    for (let i = 0; i < (flat || []).length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
    return out;
  };
  const num = v => (v === null || v === undefined ? null : Number(v));
  return {
    kind: 'redis',
    get: key => command(['GET', key]),
    // With {nx: true}: only if the key doesn't exist; returns whether it was set
    set: async (key, value, { nx } = {}) => (await command(nx ? ['SET', key, value, 'NX'] : ['SET', key, value])) === 'OK',
    // mode 'GT' / 'LT': only update an existing member to a higher / lower score
    zadd: (key, member, score, mode) => command(mode ? ['ZADD', key, mode, score, member] : ['ZADD', key, score, member]),
    zincrby: (key, member, by) => command(['ZINCRBY', key, by, member]),
    zscore: async (key, member) => num(await command(['ZSCORE', key, member])),
    zcard: key => command(['ZCARD', key]),
    zcountAbove: (key, score) => command(['ZCOUNT', key, `(${score}`, '+inf']),
    zcountBelow: (key, score) => command(['ZCOUNT', key, '-inf', `(${score}`]),
    // First n members, lowest score first (or highest with desc)
    ztop: async (key, n, { desc } = {}) =>
      pairs(await command(desc ? ['ZRANGE', key, 0, n - 1, 'REV', 'WITHSCORES'] : ['ZRANGE', key, 0, n - 1, 'WITHSCORES'])),
    // Remove the members scoring at most max; returns them
    zpopUpTo: async (key, max) => {
      const members = await command(['ZRANGE', key, '-inf', max, 'BYSCORE']);
      if (members.length) await command(['ZREMRANGEBYSCORE', key, '-inf', max]);
      return members;
    },
    zrem: (key, members) => (members.length ? command(['ZREM', key, ...members]) : 0),
    hset: (key, field, value) => command(['HSET', key, field, value]),
    hmget: (key, fields) => (fields.length ? command(['HMGET', key, ...fields]) : []),
  };
}

function createMemoryStore() {
  const strings = new Map(), zsets = new Map(), hashes = new Map();
  const zset = key => zsets.get(key) || zsets.set(key, new Map()).get(key);
  const sorted = key => [...zset(key)].map(([member, score]) => ({ member, score }))
    .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
  return {
    kind: 'memory',
    get: async key => (strings.has(key) ? strings.get(key) : null),
    set: async (key, value, { nx } = {}) => {
      if (nx && strings.has(key)) return false;
      strings.set(key, String(value));
      return true;
    },
    zadd: async (key, member, score, mode) => {
      const z = zset(key), old = z.get(String(member));
      if (old !== undefined && ((mode === 'GT' && score <= old) || (mode === 'LT' && score >= old))) return 0;
      z.set(String(member), Number(score));
      return old === undefined ? 1 : 0;
    },
    zincrby: async (key, member, by) => {
      const z = zset(key), v = (z.get(String(member)) || 0) + by;
      z.set(String(member), v);
      return v;
    },
    zscore: async (key, member) => (zset(key).has(String(member)) ? zset(key).get(String(member)) : null),
    zcard: async key => zset(key).size,
    zcountAbove: async (key, score) => [...zset(key).values()].filter(v => v > score).length,
    zcountBelow: async (key, score) => [...zset(key).values()].filter(v => v < score).length,
    ztop: async (key, n, { desc } = {}) => {
      const all = sorted(key);
      return (desc ? all.reverse() : all).slice(0, n);
    },
    zpopUpTo: async (key, max) => {
      const out = sorted(key).filter(e => e.score <= max).map(e => e.member);
      out.forEach(m => zset(key).delete(m));
      return out;
    },
    zrem: async (key, members) => members.filter(m => zset(key).delete(String(m))).length,
    hset: async (key, field, value) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key).set(String(field), String(value));
    },
    hmget: async (key, fields) => fields.map(f => (hashes.get(key) && hashes.get(key).get(String(f))) ?? null),
  };
}

function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? createRedisStore(url, token) : createMemoryStore();
}

module.exports = { createStore, createMemoryStore, createRedisStore };
