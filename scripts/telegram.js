#!/usr/bin/env node
// GlowGrid Telegram bot CLI. Needs TELEGRAM_BOT_TOKEN in the environment.
//
//   node scripts/telegram.js poll                 Run the bot locally (long polling).
//   node scripts/telegram.js webhook <base-url>   Point the bot at <base-url>/api/telegram
//                                                 (needs TELEGRAM_WEBHOOK_SECRET too).
//   node scripts/telegram.js info                 Show the bot and its webhook.

const { ALLOWED_UPDATES, createApi, handleUpdate } = require('../telegram/bot');
const { createStore } = require('../telegram/store');

const COMMANDS = [
  { command: 'play', description: 'Today\'s puzzle' },
  { command: 'streak', description: 'Your streak' },
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
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) fail('set TELEGRAM_WEBHOOK_SECRET (same value as on Vercel), e.g. `openssl rand -hex 32`');
  if (!/^https:\/\//.test(base || '')) fail('usage: node scripts/telegram.js webhook https://your-deployment.example');
  const url = base.replace(/\/+$/, '') + '/api/telegram';
  await api('setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
  await api('setMyCommands', { commands: COMMANDS });
  console.log(`✅ Webhook set to ${url}`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail('set TELEGRAM_BOT_TOKEN (from @BotFather)');
  const api = createApi(token);
  if (cmd === 'poll') return poll(api);
  if (cmd === 'webhook') return webhook(api, arg);
  if (cmd === 'info') {
    const [me, hook] = await Promise.all([api('getMe', {}), api('getWebhookInfo', {})]);
    return console.log(`@${me.username}\nwebhook: ${hook.url || '(none)'}${hook.last_error_message ? '\nlast error: ' + hook.last_error_message : ''}`);
  }
  fail('usage: node scripts/telegram.js poll | webhook <base-url> | webhook --delete | info');
}

main().catch(e => fail(e.message));
