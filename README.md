# miasma1Here’s a **README.md** you can drop in root.
It’s short, just enough to remind *me* (and you) how the repo is structured and what rules we’re following.

---

**path:** `/README.md`

```markdown
# Miasma 1

Parallel prototype of **Derelict Drifters**.  
Goal: clean slate, nimble, infinite world + miasma + beam, performance-first.

---

## Project layout

```

src/
core/       → engine glue (loop, input, camera, config)
world/      → world data + accessors (store, chunks later)
systems/    → self-contained gameplay systems (miasma, beam, etc.)
entities/   → actors (player, enemies later)
render/     → drawing only, no logic

```

### Current files

- **core/**
  - `game.js` – entry point + loop
  - `config.js` – tunables & flags
  - `input.js` – WASD + mouse axes
  - `camera.js` – follow/lerp camera
- **world/**
  - `store.js` – tile accessor stub
- **systems/**
  - `miasma/index.js` – density/sample/clear/draw
  - `beam/index.js` – mode, raycast, draw
- **entities/**
  - `player.js` – player state, update, draw
- **render/**
  - `draw.js` – clear + ground fill
- **index.html** – canvas + script hook
- **package.json** – vite scripts

---

## Update order (per frame)

```

input
→ player.update(dt)
→ miasma.update(dt)
→ camera.follow(player)
→ render: clear → entities.draw → miasma.draw → beam.draw

````

---

## Contracts (stable APIs)

- `store.getTile(wx, wy) -> { id, solid }`
- `miasma.sample(wx, wy) -> 0|1`
- `miasma.clearArea(wx, wy, r, budget?) -> count`
- `beam.raycast(origin, dir, params) -> { hits, clearedFog }`

---

## Rules

1. One-way deps: `core → world → systems → entities → render`.
2. No direct cross-writes; always use public APIs.
3. Files stay ~200 lines max; split if bigger.
4. Feature flags in `config.flags`.
5. Budgets: max 1 chunk gen per frame, renderer draw cap.
6. No globals; pass state in, export functions.

---

## Dev

```bash
npm install
npm run dev     # start local server
npm run build   # production bundle
````

---

## Notes

* Player is separate file for easy swap/refactor.
* Systems must be removable: comment out `beam/` import → game still runs.
* Determinism: seed in `config.seed` for world gen.

```

---

Want me to also drop a **“Next Steps”** section in the README (like a living TODO for you + me), or keep it strictly structural?
```
