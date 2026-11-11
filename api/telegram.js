'use strict';
// Vercel serverless webhook for the GlowGrid Telegram bot.
// Env: TELEGRAM_BOT_TOKEN, optionally TELEGRAM_WEBHOOK_SECRET (derived from the
// token when unset, see webhookSecret()) and Upstash Redis (see telegram/store.js).
// Register with `make telegram-webhook`.

const crypto = require('crypto');
const { createApi, handleUpdate, webhookSecret } = require('../telegram/bot');
const { createStore } = require('../telegram/store');

const store = createStore();

function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async function telegramWebhook(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).send('Bot not configured');
  const secret = webhookSecret();
  if (req.method !== 'POST') return res.status(405).send('POST only');
  if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'] || '', secret)) {
    return res.status(401).send('Bad secret');
  }
  try {
    await handleUpdate(req.body || {}, { api: createApi(token), store });
  } catch (e) {
    // Still answer 200: Telegram would otherwise retry the same update
    console.error(e);
  }
  res.status(200).send('ok');
};
