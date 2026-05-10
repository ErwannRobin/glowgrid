# Solver Algorithm

GlowGrid includes a built-in solver that finds **optimal solutions** (minimum number of moves) for any puzzle state. It powers the hint system and verifies puzzle solvability.

## Algorithm: Bidirectional BFS

The solver uses [bidirectional breadth-first search](https://en.wikipedia.org/wiki/Bidirectional_search) — searching simultaneously from the current state (forward) and from the goal state (backward) until the two frontiers meet.

```
Current state ──→ ← ← ← ←── Goal state (all ON)
     forward BFS            backward BFS
          ↘     meeting point    ↙
              optimal path
```

This is significantly faster than unidirectional BFS because the search space grows exponentially with depth. Two searches of depth `d/2` explore far fewer states than one search of depth `d`.

---

## State Representation

The 5×5 grid has 25 cells, each ON or OFF. The entire state fits in a **single 32-bit integer** (bitmask):

```
bit 0  = cell 0   (top-left)
bit 1  = cell 1
...
bit 24 = cell 24  (bottom-right)
```

- **Goal state:** all bits set = `0x1FFFFFF` (2²⁵ − 1)
- **Toggle:** XOR with a precomputed mask

### Precomputed Masks

At startup, the solver precomputes two masks per cell (25 × 2 = 50 masks):

```javascript
plusMasks[i]  = bitmask of cells toggled by plus (+) pattern at cell i
crossMasks[i] = bitmask of cells toggled by cross (×) pattern at cell i
```

A move on cell `i` is a single XOR:

```javascript
// Forward: which pattern applies depends on the cell's current state
newState = state ^ (state & (1 << i) ? plusMasks[i] : crossMasks[i])
```

### Reverse Moves

The backward search needs the **inverse** operation: given a result state, what state would produce it by clicking cell `i`?

Since clicking always flips the clicked cell itself:
- If the cell is ON in the result → it was OFF before → cross pattern was used
- If the cell is OFF in the result → it was ON before → plus pattern was used

```javascript
// Backward: pattern logic is swapped
prevState = state ^ (state & (1 << i) ? crossMasks[i] : plusMasks[i])
```

---

## Search Procedure

```
1. Initialize:
   - Forward frontier  = { current state }
   - Backward frontier = { goal state (all ON) }
   - Forward visited   = Map(current state → null)
   - Backward visited  = Map(goal state → null)

2. Alternate expanding forward and backward, one BFS level at a time:

   For each state in the current frontier:
     For each possible move (0–24):
       Compute the resulting state (XOR with mask)
       If already visited in this direction → skip
       If visited in the OTHER direction → path found! Reconstruct and return
       Otherwise → add to next frontier, record parent + move

3. Stop conditions:
   - Frontiers meet → optimal solution found
   - Total visited states > 300,000 → fall back to greedy
   - Time elapsed > 400ms → fall back to greedy
```

### Path Reconstruction

When the frontiers meet at a state `M`:

1. **Forward half:** trace back from `M` through forward parents → gives moves from start to `M`
2. **Backward half:** trace forward from `M` through backward parents → gives moves from `M` to goal
3. **Concatenate** both halves → complete optimal solution

---

## Greedy Fallback

If the BFS exhausts its budget (300K states or 400ms), a greedy heuristic provides a suboptimal hint:

```javascript
function greedyHint(stArr) {
  // Try each of the 25 possible moves
  // Pick the one that results in the most ON cells
  let bestMove = 0, bestOn = -1;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const on = onBitCount(applyMoveToBits(bits, i));
    if (on > bestOn) { bestOn = on; bestMove = i; }
  }
  return [bestMove];
}
```

This only returns a single next move (not a full path), and it's not guaranteed to be optimal. In practice, the BFS solver handles all generated puzzles within budget, so the greedy fallback rarely triggers.

---

## Hint System Integration

The solver feeds into the hint system as follows:

1. **Trigger conditions:**
   - First hint: unlocks when ≤ 3 cells are OFF, after 20s idle
   - Subsequent hints: button stays enabled once any hint has been used

2. **Solution caching:** `hintPath` stores the full solution from the current state. It's cleared on every player move (since the state changed).

3. **Progressive reveal:** each press of the Hint button reveals the **next move** in the optimal path:
   - The target cell gets a `hint-highlight` class (pulsing ring animation)
   - The hint counter text updates ("1 of N", "2 of N", etc.)
   - When the player clicks the highlighted cell, it's recorded as a hint-guided move (lowercase letter in the replay encoding)

4. **Path invalidation:** if the player clicks a non-hinted cell, `hintPath` is set to `null` and the solver re-runs from the new state on the next hint request.

---

## Complexity Analysis

### State Space

- 25 cells, each ON or OFF → 2²⁵ = **33,554,432** possible states
- Not all states are reachable from a given puzzle (the toggle mechanics create equivalence classes)

### BFS Performance

- Each BFS level expands up to 25 moves per state
- Bidirectional search with depth `d` explores roughly `2 × 25^(d/2)` states vs `25^d` for unidirectional
- Budget: 300K states, 400ms timeout — sufficient for all puzzles generated by the 10-move scramble method

### Memory

- Each visited state is stored in a `Map` with its parent pointer and move
- At budget cap: ~300K entries × ~40 bytes ≈ **12 MB** worst case
- Typical puzzles solve in far fewer states (usually under 10K)

| Puzzle difficulty | Optimal moves | ~States explored | Time    |
|-------------------|---------------|------------------|---------|
| Easy (3–4 moves)  | 3–4           | ~2,000           | < 1ms   |
| Medium (5–7)      | 5–7           | ~15,000          | < 10ms  |
| Hard (8–10)       | 8–10          | ~100,000         | < 100ms |
