'use strict';
// Key-value store for streak records.
//
// Uses Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL/TOKEN (or
// the Vercel KV names KV_REST_API_URL/TOKEN) are set. Otherwise falls back to
// an in-memory Map: fine for local polling, but serverless instances forget it.

function createRedisStore(url, token, fetchImpl = fetch) {
  async function command(args) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    const json = await res.json();
    if (json.error) throw new Error(`Redis ${args[0]} failed: ${json.error}`);
    return json.result;
  }
  return {
    kind: 'redis',
    get: key => command(['GET', key]),
    set: (key, value) => command(['SET', key, value]),
  };
}

function createMemoryStore() {
  const map = new Map();
  return {
    kind: 'memory',
    get: async key => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => { map.set(key, value); },
  };
}

function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? createRedisStore(url, token) : createMemoryStore();
}

module.exports = { createStore, createMemoryStore, createRedisStore };
