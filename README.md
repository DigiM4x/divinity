# Divinity

A browser god game. Almost everything is generated at runtime — procedural
geometry and canvas-drawn textures, no image files, no audio.

The exceptions are five CC0 Kenney kits in `src/lib/assets/` — trees and rocks,
the creature (24 selectable animals, animated), the town buildings, the
villagers, and the castle at the town centre. Terrain, water, sky, the hand and
all particles are still generated at runtime. See `src/lib/assets/ASSETS.md`.

```bash
npm install
npm run dev      # http://localhost:5173
```

## Controls

| Input | Action |
|---|---|
| Left-drag on ground | Pan the camera |
| Left-hold on an object | Pick it up; release to throw |
| Wheel | Zoom — raises/lowers the object while carrying |
| Right-drag | Draw a miracle gesture (○ food, ∿ water, ∧ fireball, Z lightning) |
| Both buttons held | Orbit (also middle-drag, Alt+drag, or `Q` `E`) |
| Drag on the creature | Slow = stroke (praise), fast whip = slap (scold) |
| `1` `2` `3` `4` | Leash: learning / compassion / aggression / free |
| Drag the banner | Send your platoon to where you plant it |
| `B` | Build menu (shift-click to place several; esc or right-click cancels) |
| `C` | Choose your creature — 24 animals, keeps everything it learned |
| `G` | Creature mind panel — watch it think |
| `R` | Regenerate the island |
| `F` | Debug overlay |
| `P` | Pause the simulation |

`window.DIVINITY` exposes the live game state for console tuning.

## Layout

```
src/
  main.js       renderer, lighting, sky, and the two clocks
  state.js      shared state object + every tunable constant
  input.js      pointer/keyboard -> per-frame flags
  terrain.js    heightmap, vertex-coloured ground, water shader, deformation
  camera.js     RTS orbit rig
  hand.js       the divine hand: grab, carry, throw
  props.js      instanced rocks/trees + ballistic physics, resource nodes
  town.js       town centre, influence, buildings, build mode, growth
  villagers.js  instanced agents + gather/deliver/eat/sleep state machine
  creature.js   the companion: body, needs, desires, opinions, learning
  miracles.js   belief, gesture recognition, the four miracles, alignment
  fx.js         pooled particles
  ui.js         DOM overlay, resource bar, build menu, mind panel, grimoire
  combat.js     soldiers, the platoon banner, siege and conquest
  lib/          noise, procedural geometry helpers, canvas textures
  lib/models.js GLB kit loader; prepares kit geometry for instancing
  lib/assets/   the Kenney model kit (CC0) — see ASSETS.md
```

Boot is async: the model kit is fetched before any system initialises, so
systems can build their geometry synchronously as they always have.

Systems do not import each other. Each publishes its API onto `state` at init
and reaches everything else through there. Where one system needs to *react* to
another's actions rather than read its data, it subscribes to `state.events`
instead of calling in.

Simulation is a fixed 20 Hz step; rendering runs at display refresh and
interpolates between the last two sim ticks.

See `PHASE_1.md` through `PHASE_20.md` for what is built, what to tune, and known
gaps. The creature's learning constants are the most tuning-sensitive part of
the game and are documented in detail in `PHASE_3.md`.
