'use strict';
// Dates as YYYYMMDD integers, and puzzle numbers

function utcYmd(date) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function shiftYmd(ymd, days) {
  const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100;
  return utcYmd(new Date(Date.UTC(y, m - 1, d + days)));
}

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const formatYmd = ymd => `${ymd % 100} ${MONTHS[Math.floor(ymd / 100) % 100 - 1]} ${Math.floor(ymd / 10000)}`;

// Puzzle numbers, as on the website: #1 is 1 Jan 2025
const FIRST_DAY = 20250101;
const ymdFromPuzzleNumber = n => shiftYmd(FIRST_DAY, n - 1);
const puzzleNumberFromYmd = ymd => {
  const utc = v => Date.UTC(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100);
  return Math.round((utc(ymd) - utc(FIRST_DAY)) / 86400000) + 1;
};

module.exports = { FIRST_DAY, formatYmd, puzzleNumberFromYmd, shiftYmd, utcYmd, ymdFromPuzzleNumber };
