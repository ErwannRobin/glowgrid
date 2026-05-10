# GlowGrid Sound Design

All sounds are synthesized in real-time using the Web Audio API — no audio files are used.

## Frequency Grid

Each cell in the 5×5 grid is assigned a base frequency using the **C major pentatonic scale** (C, D, E, G, A) across columns, shifted by octave-related multipliers across rows.

### Base frequencies (columns)

| Column | Note | Frequency (Hz) |
|--------|------|-----------------|
| 0      | C4   | 261.63          |
| 1      | D4   | 293.66          |
| 2      | E4   | 329.63          |
| 3      | G4   | 392.00          |
| 4      | A4   | 440.00          |

### Row multipliers

| Row | Multiplier | Effective range       |
|-----|------------|-----------------------|
| 0   | 0.5×       | One octave below      |
| 1   | 0.75×      | Perfect fifth below   |
| 2   | 1.0×       | Base octave           |
| 3   | 1.5×       | Perfect fifth above   |
| 4   | 2.0×       | One octave above      |

### Formula

```
cellFreq(i) = PENTA_BASE[i % 5] × ROW_MULT[floor(i / 5)]
```

This produces a 5×5 frequency grid spanning roughly 2.5 octaves (C3 to A5).

### Full frequency grid (Hz)

|        | Col 0 (C) | Col 1 (D) | Col 2 (E) | Col 3 (G) | Col 4 (A) |
|--------|-----------|-----------|-----------|-----------|-----------|
| Row 0  | 130.8     | 146.8     | 164.8     | 196.0     | 220.0     |
| Row 1  | 196.2     | 220.2     | 247.2     | 294.0     | 330.0     |
| Row 2  | 261.6     | 293.7     | 329.6     | 392.0     | 440.0     |
| Row 3  | 392.4     | 440.5     | 494.4     | 588.0     | 660.0     |
| Row 4  | 523.3     | 587.3     | 659.3     | 784.0     | 880.0     |

> **Note:** Rows 1 and 3 use ×0.75 and ×1.5 (perfect fifth intervals), which are harmonically consonant but not octave-aligned with the pentatonic base. This is intentional — it adds harmonic richness while staying musically pleasant.

---

## Sound Types

### 1. Glass Click (regular cell interaction)

Used when the player clicks any cell during normal gameplay.

**Two sine oscillators** create a bell/glass-like timbre:
- **Primary oscillator:** `cellFreq × 1.8` (turning off) or `cellFreq × 2.2` (turning on)
- **Overtone oscillator:** primary frequency `× 2.756` (inharmonic partial for glass shimmer)

| Parameter       | Turning ON (was off)     | Turning OFF (was on)     |
|-----------------|--------------------------|--------------------------|
| Frequency mult  | ×2.2 (brighter)          | ×1.8 (duller)            |
| Volume          | 0.09                     | 0.07                     |
| Decay           | 1.2s (longer sustain)    | 0.8s (shorter)           |
| Overtone volume | 0.03                     | 0.02                     |

The ×1.8 and ×2.2 multipliers are intentionally **non-musical intervals** — they create an inharmonic, shimmery quality similar to striking glass or a bell, rather than a clean pitched note.

### 2. Musical Click (hint-guided interaction)

Used when the player clicks a cell highlighted by the hint system.

**Single oscillator** with a pitch bend, producing a cleaner, more musical tone:

| Parameter       | Turning ON               | Turning OFF              |
|-----------------|--------------------------|--------------------------|
| Waveform        | Triangle                 | Sine                     |
| Frequency       | `cellFreq` → ×0.92 bend | `cellFreq` → ×0.92 bend |
| Attack          | 8ms                      | 8ms                      |
| Decay           | 280ms                    | 180ms                    |
| Volume          | 0.14 peak                | 0.14 peak                |

The downward pitch bend (×0.92 over 120ms) gives a soft, chime-like character.

### 3. Hover Sound (desktop mouse hover)

A very subtle, short pop when hovering over cells on desktop.

- **Frequency:** `cellFreq × 1.12` (cell off) or `cellFreq × 0.88` (cell on)
- **Duration:** ~45ms
- **Volume:** 0.04–0.05 (barely audible)
- **Waveform:** Sine

### 4. Win Fanfare

An ascending arpeggio played when the puzzle is solved.

| Note | Frequency (Hz) | Timing     |
|------|-----------------|------------|
| C4   | 261.63          | +0ms       |
| E4   | 329.63          | +110ms     |
| G4   | 392.00          | +220ms     |
| C5   | 523.25          | +330ms     |
| E5   | 659.25          | +440ms     |
| G5   | 783.99          | +550ms     |

This is a **C major arpeggio** ascending over two octaves, with each note spaced 110ms apart. Each note has a 20ms attack and 700ms exponential decay.

---

## Audio Pipeline

```
Oscillators → GainNode → _masterGain → AudioContext.destination (speakers)
                                     ↘ MediaStreamDestination (video recording)
```

All sounds route through a shared `_masterGain` node. During video recording, this node is additionally connected to a `MediaStreamDestination` to capture audio into the exported video.

### iOS Audio Unlock

iOS Safari requires a user gesture to enable audio. On the first touch interaction:
1. A silent `<audio>` element is played to switch the iOS audio session to "playback" mode
2. The `AudioContext` is created and resumed
3. A silent buffer is played through the `AudioContext`

This ensures audio works even when the iPhone mute/ringer switch is on.
