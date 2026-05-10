# Replay URL Encoding

GlowGrid encodes puzzle solutions directly in the URL, enabling shareable links that replay a game step by step — with sound.

## URL Format

```
https://glowgrid.netlify.app/?p=<puzzle>&r=<moves>[&own=1]
```

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `p`       | Number | Puzzle number (day count since epoch) |
| `r`       | String | Encoded move sequence |
| `own`     | Flag   | If `1`, show win screen as if it were the viewer's own game |

### Example

```
?p=497&r=AKGLf
```

Puzzle #497, 5 moves: cells 0, 10, 6, 11 (regular clicks), then cell 5 (hint-guided).

---

## Puzzle Number (`p`)

The puzzle number is the number of days since **January 1, 2025** (UTC), starting at 1.

```
puzzleNumber = floor((targetDate - epoch) / 86400000) + 1
```

Where `epoch = Date.UTC(2025, 0, 1)`.

| Date           | Puzzle # |
|----------------|----------|
| Jan 1, 2025    | 1        |
| Jan 2, 2025    | 2        |
| May 10, 2026   | 496      |

The puzzle number uniquely determines the grid's initial state via a seeded random generator.

---

## Move Sequence (`r`)

Each character in the `r` string encodes one move — which cell was clicked and whether it was a hint-guided click.

### Encoding

The 5×5 grid has 25 cells, indexed 0–24 (left to right, top to bottom):

```
 0  1  2  3  4
 5  6  7  8  9
10 11 12 13 14
15 16 17 18 19
20 21 22 23 24
```

Each move is encoded as a single ASCII character:

| Click type     | Character range | Formula                              |
|----------------|-----------------|--------------------------------------|
| Regular click  | `A` – `Y`      | `String.fromCharCode(65 + cellIndex)` |
| Hint-guided    | `a` – `y`      | `String.fromCharCode(97 + cellIndex)` |

### Mapping table

| Cell | Regular | Hint |
|------|---------|------|
| 0    | A       | a    |
| 1    | B       | b    |
| 2    | C       | c    |
| 3    | D       | d    |
| 4    | E       | e    |
| 5    | F       | f    |
| 6    | G       | g    |
| 7    | H       | h    |
| 8    | I       | i    |
| 9    | J       | j    |
| 10   | K       | k    |
| 11   | L       | l    |
| 12   | M       | m    |
| 13   | N       | n    |
| 14   | O       | o    |
| 15   | P       | p    |
| 16   | Q       | q    |
| 17   | R       | r    |
| 18   | S       | s    |
| 19   | T       | t    |
| 20   | U       | u    |
| 21   | V       | v    |
| 22   | W       | w    |
| 23   | X       | x    |
| 24   | Y       | y    |

### Decoding

```javascript
for (const ch of encoded) {
  const code = ch.charCodeAt(0);
  const isHint = code >= 97;         // lowercase = hint
  const cellIndex = code - (isHint ? 97 : 65);
}
```

---

## The `own` Flag

By default, a shared URL opens in **replay mode** — the viewer watches the solution play back automatically with sound and animation.

When `own=1` is set, the game instead:

1. Silently simulates all the moves
2. Shows the win screen as if the viewer just solved the puzzle themselves
3. Pushes the URL into browser history so the back button works

This is used internally when the player wins — the URL is updated with `own=1` so refreshing or navigating back restores the win screen.

---

## Share Text Format

When sharing, the game generates a text block alongside the URL:

```
GlowGrid #497 · May 10 ✨
⬛🟦🟦⬛⬛
🟦🟦⬛🟦⬛
⬛⬛⬛🟦🟦
🟦⬛⬛⬛🟦
⬛🟦🟦⬛⬛
Solved in 12 moves 🔥3

🎵 Hear my solution:
https://glowgrid.netlify.app/?p=497&r=AKGLBFQMRCHSN
```

- `🟦` = cell was clicked at least once
- `⬛` = cell was never clicked
- Streak count appears only when playing today's puzzle with a streak > 1
- Hint count is appended if hints were used
