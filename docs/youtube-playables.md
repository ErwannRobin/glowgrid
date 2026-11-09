# YouTube Playables

Glow-Grid ships to [YouTube Playables](https://developers.google.com/youtube/gaming/playables) from the same `index.html` as the website. A small build step produces the Playables bundle.

## Build

```sh
make playables       # → dist/glowgrid-playables.zip (upload this)
make playables-dev   # → dist/playables-dev/, served with a local SDK mock
```

`make playables-dev` serves `http://127.0.0.1:8000/dist/playables-dev/`. The mock (`scripts/ytgame-mock.js`) stores the cloud save in `localStorage` and can be driven from the console:

```js
ytgameMock.pause(); ytgameMock.resume();
ytgameMock.setAudio(false);   // YouTube mute button
ytgameMock.clearSave();
```

Before submitting, also run the real bundle through YouTube's Playables test suite.

## How the build works

`scripts/build-playables.js` reads `index.html` and:

1. **Strips web-only regions.** HTML between `<!-- web-only … -->` and `<!-- /web-only -->`, and JS between a `// web-only …` line and a `// /web-only` line: site metadata and PWA tags, the Share button, the footer link, sharing/video export, shared-replay URLs, browser history and the service worker.
2. **Loads the SDK first.** At the `<!-- playables-head -->` marker it injects `<script src="https://www.youtube.com/game_api/v1">` and sets `window.GG_PLAYABLES = true` plus the `playables` class on `<html>`.
3. **Checks the output.** Inline scripts must compile, and the bundle must contain no external URL other than the SDK and no forbidden API (`navigator.share`, clipboard, `MediaRecorder`, service worker, `navigator.language`, Page Visibility, `target="_blank"`).

On the website the markers are plain comments and `IS_PLAYABLE` is `false`, so the web game behaves as before.

In the game code:

- `IS_PLAYABLE` means this is the Playables build. It drives UI choices.
- `YT` is the `ytgame` SDK object, set only when actually running in Playables (`ytgame.IN_PLAYABLES_ENV`). Every SDK call goes through `YT`.

## Requirement → implementation

| Requirement | Implementation |
|---|---|
| SDK loaded before game code | Injected first in `<head>` |
| `firstFrameReady()` while a loading screen is visible, then `gameReady()` when interactive | `bootPlayable()`: `#gg-loading` covers the page, then `firstFrameReady()` → `await loadData()` → `gameReady()` |
| Cloud save is the only save; `loadData` before `saveData`; tolerate old or corrupt saves | The `save` object is one JSON string `{ v, streak, lastStreakDate, solved, musicMode, haptics }`. `_applySaveData()` copies only well-typed fields. Saves stay disabled if `loadData` fails |
| Save on progress and on pause | `persistSave()` runs after each win, setting change and `onPause`. The save is a few KiB at most, under the 64 KiB exit-flush limit |
| `sendScore` best score must match the save | Score = number of puzzles solved (`Object.keys(save.solved).length`). It never decreases. Sent on each new solve and at boot |
| Respect YouTube mute (`isAudioEnabled` / `onAudioEnabledChange`), no in-game mute | `soundEnabled` follows YouTube and the `AudioContext` is suspended when muted. The speaker button and the `S` key are disabled |
| Respect the device silent switch | The iOS silent-`<audio>` unlock trick is skipped in Playables |
| Pause everything on `onPause`, resume only on `onResume` (no Page Visibility API) | `pauseGame()` / `resumeGame()` handle replay playback, autoplay, the hint timer, audio, CSS animations (`html.paused`) and input |
| Haptics need a toggle | Vibration button (touch devices only), saved in `save.haptics` |
| All aspect ratios 9:32 → 32:9, no orientation lock | Cells are sized from both `vw` and `vh`. On wide, short viewports the grid sits next to the controls. The win card shrinks to fit (`fitWinCard()`) |
| No sharing, external links, navigation, downloads, clipboard | Stripped (see build). Song challenges (URL-based) are web-only |
| Esc must not be `preventDefault`ed | Esc closes the confirm dialog without `preventDefault()` |
| Tell players when there is no more content | Win screen: "New puzzle tomorrow · N earlier puzzles left", or "You've solved every puzzle!" |
| Bundle size | One file, about 95 KiB (limits: 30 MiB initial, 250 MiB total) |

## Submitting

Playables publishing goes through YouTube's developer program and a Partner Manager. The Developer Portal also needs a title, description, genre and thumbnails in several aspect ratios, with no logos or branding in them.
