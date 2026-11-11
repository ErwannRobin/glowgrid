#!/usr/bin/env node
// GlowGrid Telegram bot CLI. Needs TELEGRAM_BOT_TOKEN, from the environment or
// from a gitignored .env file at the repo root (see .env.example).
//
//   node scripts/telegram.js poll                 Run the bot locally (long polling).
//   node scripts/telegram.js webhook [base-url]   Point the bot at <base-url>/api/telegram
//                                                 (default: TELEGRAM_WEBHOOK_BASE_URL).
//                                                 The secret is derived from the token, unless
//                                                 TELEGRAM_WEBHOOK_SECRET is set (then it must
//                                                 match the deployment's).
//   node scripts/telegram.js info                 Show the bot and its webhook.

const path = require('path');

// .env at the repo root, if any; variables already set in the shell win
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

const { ALLOWED_UPDATES, createApi, handleUpdate, webhookSecret } = require('../telegram/bot');
const { createStore } = require('../telegram/store');

const COMMANDS = [
  { command: 'play', description: 'Today\'s puzzle' },
  { command: 'yesterday', description: 'Yesterday\'s puzzle' },
  { command: 'archive', description: 'Past puzzles' },
  { command: 'streak', description: 'Your streak' },
  { command: 'leaderboard', description: 'Best players: today, or /leaderboard_all' },
];

function fail(msg) {
  console.error('telegram: ' + msg);
  process.exit(1);
}

async function poll(api) {
  const info = await api('getWebhookInfo', {});
  if (info.url) fail(`a webhook is set (${info.url}); long polling would fail. Remove it with: node scripts/telegram.js webhook --delete`);
  await api('setMyCommands', { commands: COMMANDS });
  const store = createStore();
  const me = await api('getMe', {});
  console.log(`Polling as @${me.username} (store: ${store.kind}). Ctrl+C to stop.`);
  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ALLOWED_UPDATES });
    } catch (e) {
      console.error(e.message);
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const kind = Object.keys(update).find(k => k !== 'update_id');
      console.log(`← ${kind}${update.widget_query ? ' ' + update.widget_query.data : ''}`);
      try { await handleUpdate(update, { api, store }); } catch (e) { console.error(e.message); }
    }
  }
}

async function webhook(api, base) {
  if (base === '--delete') {
    await api('deleteWebhook', {});
    return console.log('✅ Webhook removed');
  }
  base = base || process.env.TELEGRAM_WEBHOOK_BASE_URL;
  if (!/^https:\/\//.test(base || '')) {
    fail('usage: node scripts/telegram.js webhook https://your-deployment.example (or set TELEGRAM_WEBHOOK_BASE_URL in .env)');
  }
  const url = base.replace(/\/+$/, '') + '/api/telegram';
  const secret = webhookSecret();
  const from = process.env.TELEGRAM_WEBHOOK_SECRET ? 'TELEGRAM_WEBHOOK_SECRET' : 'derived from the bot token';
  // Check that the deployment accepts this secret before switching Telegram to it:
  // an empty update is a no-op for the bot.
  let status;
  try {
    status = (await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: '{"update_id":0}',
      redirect: 'manual',
    })).status;
  } catch (e) {
    fail(`can't reach ${url}: ${e.message}`);
  }
  if (status === 401) {
    fail(`${url} rejected the secret (${from}). The deployment has a different TELEGRAM_WEBHOOK_SECRET: ` +
      'pass the same value, or remove it from the Vercel env vars and redeploy. The webhook was not changed.');
  }
  if (status === 503) fail(`${url} has no TELEGRAM_BOT_TOKEN. The webhook was not changed.`);
  if (status !== 200) fail(`${url} answered ${status} (redirect or not deployed?). The webhook was not changed.`);
  await api('setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
  await api('setMyCommands', { commands: COMMANDS });
  console.log(`✅ Webhook set to ${url} (secret: ${from})`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail('set TELEGRAM_BOT_TOKEN (from @BotFather) in .env or in the environment; see .env.example');
  const api = createApi(token);
  if (cmd === 'poll') return poll(api);
  if (cmd === 'webhook') return webhook(api, arg);
  if (cmd === 'info') {
    const [me, hook] = await Promise.all([api('getMe', {}), api('getWebhookInfo', {})]);
    return console.log(`@${me.username}\nwebhook: ${hook.url || '(none)'}${hook.last_error_message ? '\nlast error: ' + hook.last_error_message : ''}`);
  }
  fail('usage: node scripts/telegram.js poll | webhook [base-url] | webhook --delete | info');
}

main().catch(e => fail(e.message));
