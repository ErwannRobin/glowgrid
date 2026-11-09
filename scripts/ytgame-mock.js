// Minimal local stand-in for the YouTube Playables SDK (dev builds only: `make playables-dev`).
// Saves go to localStorage. Drive it from the console:
//   ytgameMock.pause() / ytgameMock.resume() / ytgameMock.setAudio(false) / ytgameMock.clearSave()
(function () {
  const SAVE_KEY = 'ytgame-mock-save';
  const listeners = { audio: [], pause: [], resume: [] };
  const log = (...args) => console.log('%c[ytgame mock]', 'color:#f87171', ...args);
  const on = (type) => (cb) => {
    listeners[type].push(cb);
    return () => { listeners[type] = listeners[type].filter((f) => f !== cb); };
  };
  let audioEnabled = true;
  let loaded = false;
  let firstFrame = false;

  window.ytgame = {
    IN_PLAYABLES_ENV: true,
    SDK_VERSION: 'mock',
    game: {
      firstFrameReady() { firstFrame = true; log('firstFrameReady'); },
      gameReady() {
        if (!firstFrame) console.error('[ytgame mock] gameReady() called before firstFrameReady()');
        log('gameReady');
      },
      loadData() {
        loaded = true;
        const data = localStorage.getItem(SAVE_KEY) || '';
        log('loadData', data);
        return new Promise((resolve) => setTimeout(() => resolve(data), 300));
      },
      saveData(data) {
        if (!loaded) return Promise.reject(new Error('saveData() before loadData()'));
        if (typeof data !== 'string' || data.length * 2 > 3 * 1024 * 1024) {
          return Promise.reject(new Error('invalid or too large save'));
        }
        localStorage.setItem(SAVE_KEY, data);
        log('saveData', data);
        return Promise.resolve();
      },
    },
    system: {
      isAudioEnabled: () => audioEnabled,
      onAudioEnabledChange: on('audio'),
      onPause: on('pause'),
      onResume: on('resume'),
      getLanguage: () => Promise.resolve('en-US'),
    },
    engagement: {
      sendScore(score) { log('sendScore', JSON.stringify(score)); return Promise.resolve(); },
      openYTContent(content) { log('openYTContent', content); return Promise.resolve(); },
    },
    health: {
      logError() { log('health.logError'); },
      logWarning() { log('health.logWarning'); },
    },
  };

  window.ytgameMock = {
    pause() { log('pause'); listeners.pause.forEach((cb) => cb()); },
    resume() { log('resume'); listeners.resume.forEach((cb) => cb()); },
    setAudio(enabled) { audioEnabled = !!enabled; log('audio', audioEnabled); listeners.audio.forEach((cb) => cb(audioEnabled)); },
    clearSave() { localStorage.removeItem(SAVE_KEY); log('save cleared'); },
  };
})();
