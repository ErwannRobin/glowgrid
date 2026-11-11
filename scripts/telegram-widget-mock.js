// Local stand-in for window.TelegramWidget (dev preview only).
// Simulates the bot: a solve request ("w" + YYYYMMDD + moves) updates the
// streak record kept in localStorage and fires chatDataChanged.
(function () {
  const KEY = 'tgMockChatData';
  const handlers = {};
  const fire = type => (handlers[type] || []).forEach(h => h.call(window.TelegramWidget));
  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const haptic = name => function (arg) { console.log('[haptic]', name, arg || ''); return this; };
  const ymdShift = (ymd, days) => {
    const d = new Date(Date.UTC(ymd / 1e4 | 0, (ymd / 100 | 0) % 100 - 1, ymd % 100 + days));
    return d.getUTCFullYear() * 1e4 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  };

  window.TelegramWidget = {
    profile: 1,
    colorScheme: 'dark',
    isActive: true, isPreview: false, isForward: false,
    chatType: 'private',
    viewer: { id: 1, first_name: 'Dev' },
    publicData: null,
    get chatData() { return read(); },
    HapticFeedback: {
      impactOccurred: haptic('impact'),
      notificationOccurred: haptic('notification'),
      selectionChanged: haptic('selection'),
    },
    onEvent(type, h) { (handlers[type] = handlers[type] || []).push(h); },
    offEvent(type, h) { handlers[type] = (handlers[type] || []).filter(x => x !== h); },
    ready() { console.log('[widget] ready'); },
    request(data) {
      console.log('[request]', data);
      // "Yesterday's puzzle" on the win screen: the bot sends a /yesterday message
      if (data === 'y') { setTimeout(() => window.tgMock.archive(), 300); return Promise.resolve({ result: null }); }
      const m = /^w(\d{8})(\d+)$/.exec(data);
      if (!m) return Promise.resolve({ result: null });
      const ymd = +m[1];
      let r = { s: 0, b: 0, l: 0 };
      try { r = { ...r, ...JSON.parse(read()) }; } catch (e) {}
      if (ymd > r.l) {
        const s = r.l === ymdShift(ymd, -1) ? r.s + 1 : 1;
        r = { s, b: Math.max(r.b, s), l: ymd };
      }
      const result = JSON.stringify(r);
      return new Promise(resolve => setTimeout(() => {
        resolve({ result });
        window.tgMock.setChatData(result);
      }, 300));
    },
  };

  window.tgMock = {
    setChatData(s) { try { localStorage.setItem(KEY, s); } catch (e) {} fire('chatDataChanged'); },
    reset() { try { localStorage.clear(); } catch (e) {} location.reload(); },
    // Archive mode, as sent by /archive or /yesterday: tgMock.archive(20261005) or tgMock.archive()
    archive(ymd) {
      try {
        localStorage.clear();
        localStorage.setItem(KEY, JSON.stringify(ymd ? { d: ymd } : { t: Math.floor(Date.now() / 1000) }));
      } catch (e) {}
      location.reload();
    },
  };
})();
