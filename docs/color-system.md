# Color System

GlowGrid assigns each cell a unique color from a rainbow gradient. Colors are determined by grid position and rendered using CSS custom properties and HSL color space.

## Hue Assignment

Each cell's hue is computed from its row and column:

```javascript
const hue = (180 + col * 40 + row * 50) % 360;
```

- **Starting point:** 180° (cyan)
- **Column step:** +40° per column
- **Row step:** +50° per row
- **Wrapping:** modulo 360°

### Full Hue Grid (degrees)

|        | Col 0 | Col 1 | Col 2 | Col 3 | Col 4 |
|--------|-------|-------|-------|-------|-------|
| Row 0  | 180   | 220   | 260   | 300   | 340   |
| Row 1  | 230   | 270   | 310   | 350   | 30    |
| Row 2  | 280   | 320   | 0     | 40    | 80    |
| Row 3  | 330   | 10    | 50    | 90    | 130   |
| Row 4  | 20    | 60    | 100   | 140   | 180   |

### Visual Color Map

|        | Col 0      | Col 1      | Col 2       | Col 3      | Col 4      |
|--------|------------|------------|-------------|------------|------------|
| Row 0  | 🟦 Cyan    | 🔵 Blue    | 🟣 Violet   | 🟪 Magenta | 🌸 Pink    |
| Row 1  | 🔵 Azure   | 🟣 Indigo  | 🌸 Rose     | 🔴 Red     | 🟠 Orange  |
| Row 2  | 🟣 Purple  | 🌸 Fuchsia | 🔴 Red      | 🟠 Orange  | 🟡 Yellow  |
| Row 3  | 🌸 Magenta | 🔴 Scarlet | 🟠 Amber    | 🟡 Yellow  | 🟢 Green   |
| Row 4  | 🟠 Orange  | 🟡 Gold    | 🟢 Lime     | 🟢 Green   | 🟦 Cyan    |

The gradient sweeps diagonally from cyan (top-left) through blues, purples, pinks, reds, oranges, yellows, and greens — cycling back to cyan at the bottom-right corner.

---

## CSS Custom Properties

Each cell receives three CSS custom properties set in JavaScript:

```javascript
cell.style.setProperty('--hue', hue);    // 0–360
cell.style.setProperty('--sat', '75%');   // saturation
cell.style.setProperty('--light', '58%'); // lightness
```

All cell styling references these variables, making the color system consistent across all visual states.

---

## Cell States

### ON State (lit)

A radial gradient creates a glowing, 3D-lit appearance:

```css
.cell.on {
  background: radial-gradient(
    circle at 38% 32%,                                        /* highlight offset top-left */
    hsl(var(--hue), calc(var(--sat) - 15%), calc(var(--light) + 20%)),  /* bright center */
    hsl(var(--hue), var(--sat), var(--light)) 55%,           /* base color */
    hsl(var(--hue), calc(var(--sat) + 5%), calc(var(--light) - 10%))   /* darker edge */
  );
}
```

Three gradient stops:
1. **Center highlight** (38%, 32%) — less saturated, brighter (+20% lightness)
2. **Base color** at 55% — the cell's true color
3. **Edge shadow** — more saturated, darker (−10% lightness)

A `::before` pseudo-element adds a white specular highlight in the top-left quadrant.

### Glow Effect

ON cells emit a colored glow:

```css
box-shadow:
  0 0 22px hsla(var(--hue), var(--sat), var(--light), 0.5),   /* inner glow */
  0 0 50px hsla(var(--hue), var(--sat), var(--light), 0.18),  /* outer glow */
  inset 0 1px 2px rgba(255,255,255,0.45);                     /* inner rim light */
```

### OFF State (dark)

Minimal, transparent appearance:

```css
.cell {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
}
```

OFF cells are nearly invisible — just a faint outline against the dark background.

### Transition

State changes animate smoothly:

```css
transition:
  transform 0.15s ease,
  background 0.22s ease,
  border-color 0.22s ease,
  box-shadow 0.22s ease;
```

---

## Special Visual States

### Preview (hover / long-press)

Cells that would be affected by a click get a yellow highlight:

```css
.cell.preview {
  border-color: rgba(250,204,21,0.5);
  box-shadow: 0 0 0 2px rgba(250,204,21,0.25),
              0 0 18px rgba(250,204,21,0.2);
  transform: scale(1.02);
}
```

### Hint Highlight

The hinted cell gets a pulsing ring animation using the cell's own hue:

```css
.cell.hint-highlight {
  animation: hint-ring 1.2s ease-in-out infinite;
  box-shadow: 0 0 0 2px hsla(var(--hue), 80%, 65%, 0.85),
              0 0 20px hsla(var(--hue), 80%, 55%, 0.4);
}
```

### Click Ripple

A brief scale-down on click:

```css
.cell:active { transform: scale(0.94); }
```

### Grid Entrance

Cells enter with a staggered scale+fade animation:

```css
.cell.cell-entering {
  animation: cell-in 0.35s ease both;
  animation-delay: calc(var(--idx) * 18ms);
}
```

Cell 0 appears first, cell 24 appears ~450ms later, creating a wave effect.

---

## Canvas Rendering (Video Export)

The same color formula is used when drawing frames for the video export:

```javascript
const hue = (180 + col * 40 + row * 50) % 360;

// ON cell: radial gradient
grad.addColorStop(0, `hsl(${hue}, 75%, 68%)`);  // lighter center
grad.addColorStop(1, `hsl(${hue}, 75%, 48%)`);  // darker edge

// OFF cell
ctx.fillStyle = 'rgba(255,255,255,0.04)';
```

The canvas version uses slightly simplified colors (no CSS custom property interpolation) but maintains the same visual identity.

---

## Win Screen Grid

The replay and heatmap grids on the win screen reuse the exact same color variables:

```css
.win-grid-cell.cell-on {
  background: radial-gradient(/* same as .cell.on */);
  box-shadow: 0 0 10px hsla(var(--hue), var(--sat), var(--light), 0.4);
}
```

---

## Design Rationale

| Choice | Why |
|--------|-----|
| **HSL color space** | Hue rotation creates a natural rainbow; easy to compute programmatically |
| **180° start (cyan)** | Avoids starting on red (too aggressive); cyan feels "cool" and techy |
| **40° col + 50° row** | Different step sizes prevent diagonal cells from sharing hues |
| **Radial gradient** | Creates a 3D-lit glass/gem appearance without textures |
| **Colored glow** | Reinforces each cell's identity; makes the grid feel alive |
| **Dark background** | Maximizes contrast for the glowing ON state; modern aesthetic |
