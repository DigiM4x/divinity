# Divinity — Rebuild Prompts

Nineteen phase write-ups turned into nineteen build prompts, plus a charter and
one inferred step (the asset kits) that the phase docs never recorded on their
own. Feed them to a coding agent one at a time, in order. Each prompt is
self-contained: what to build, the numbers that were hard-won, the traps that
cost time the first time round, and what to measure before calling it done.

Three places where the original took a detour that a rebuild can skip are
flagged inline as **Shortcut**. Take them or not; the phase order still works
either way.

---

## Prompt 0 — Project charter (paste at the top of every phase)

You are building **Divinity**, a browser god game in the Black & White
tradition. Stack: Vite, vanilla ES modules, Three.js r160. `npm run dev` on
port 5173.

Non-negotiable architecture rules. Every later prompt assumes these:

1. **One shared state object.** `src/state.js` holds `state` plus every tunable
   constant, grouped by system (`WORLD`, `HAND`, `PHYS`, `TOWN`, `VILLAGER`,
   `CREATURE`, `MIRACLE`, `COMBAT`, …). Tuning means editing one file.
2. **Systems never import each other.** Each module exports `init`, `simStep`,
   `update` (render), and publishes its public API onto `state` at init
   (`state.terrain.heightAt`, `state.props.raycast`, `state.town.place`, …).
   Everything reaches everything else through `state`. `main.js` is the only
   module that knows all of them and owns the sim and render order.
3. **React through the event bus, never by calling in.** `state.events` is an
   emit/subscribe map. A system that needs to *react* to another's action
   subscribes; it never calls the other system's behaviour. Events carry
   attribution (`byPlayer`) and a `cause`.
4. **Two clocks.** Simulation is a fixed 20 Hz step. Rendering runs at display
   refresh and interpolates between the last two sim ticks via `state.alpha`.
   Moving things store `prev` alongside `pos` purely so the renderer can lerp.
   A frame simulates at most 5 catch-up ticks and then drops the backlog.
5. **Instance everything.** Any population of similar objects is one
   `InstancedMesh` per type. Draw calls are the budget you protect.
6. **Observers observe.** Late modules (achievements, prayers, reckoning,
   graveyard, sound) read `state` and the bus and command nothing.
7. **Lists must not only grow.** Every array of live entities is compacted;
   every fixed buffer either grows or refuses at the point of use. This was the
   single most repeated bug in the original build.
8. **Measure, don't guess.** Verify through the real input path
   (`PointerEvent`s on the canvas), not by calling internals. Anything touching
   the economy gets a 20-minute unattended run, not a 5-minute one. Print the
   numbers.
9. **Silent gates are bugs.** Anything that can stop a player-visible process
   (growth, training, placement) must say why in the HUD at the moment it stops.

Debug conventions: `F` debug overlay, `P` pause, `window.DIVINITY = state` for
console tuning. Boot is async so asset kits can load before any system inits.

Final module layout to aim for:

```
src/
  main.js       renderer, lighting, the two clocks, boot sequence
  state.js      shared state + every tunable constant
  input.js      pointer/keyboard -> per-frame flags, capture ownership
  terrain.js    heightmap, vertex-coloured ground, water shader, deformation
  camera.js     RTS orbit rig
  hand.js       the divine hand: grab, carry, throw
  props.js      instanced rocks/trees + ballistic physics, resource nodes
  town.js       town centres, influence, buildings, build mode, growth, rival build AI
  villagers.js  instanced agents + state machine
  creature.js   the companion: body, needs, desires, opinions, learning, war
  miracles.js   belief, the four miracles, alignment
  combat.js     soldiers, banner, siege, raids, engines
  fx.js         pooled particles
  ui.js         DOM overlay, resource bar, build menu, mind panel, grimoire
  flora.js / scenery.js       decoration (never simulated)
  achievements.js  prayers.js / prayermarks.js  graveyard.js
  reckoning.js / reckoningui.js / scoreconfig.js
  sound.js / soundconfig.js   sky.js / skyconfig.js   sculpt.js
  lib/          noise.js, geo.js, textures.js, grid.js (spatial hash), models.js
  lib/assets/   Kenney CC0 kits (arrive at Prompt 4.5)
```

---

## Prompt 1 — World and Hand

Build the foundation: island, water, camera, the hand, and throwable props.
For this phase there are **no asset files**: every mesh is built from
primitives at boot and every texture is drawn into a `<canvas>`.

### Build

**Architecture.** Set up `state.js`, `main.js` with the two clocks, `input.js`,
and empty stubs for `town`, `villagers`, `creature`, `miracles`, `combat` so
the shape of the finished game is visible from day one.

**Terrain.** 256×256 heightmap. Domain-warped radial mask (a ragged coastline,
not a circle) multiplied by an fBm continental base, plus ridged noise pushed
inland by `mask²` so peaks never reach the sea. Squash heights in the 0–6 band
for wide walkable beaches. Vertex colours blend sand → grass → dry grass → rock
by height and slope with noise-jittered band edges, converted to linear before
upload. Compute normals analytically from the heightfield (not
`computeVertexNormals`) so patch updates are cheap. Multiply a canvas grain
texture over the whole thing. Expose `heightAt(x, z)`, `normalAt`, and a
`deform`/patch-update path that rewrites only affected position/normal/colour
ranges.

**Water.** One shader plane. Three crossing sine swells displace vertices; the
fragment stage rebuilds the normal from the analytic derivative of those same
swells. Hand the heightmap to the shader as a float texture for per-fragment
depth (deep/shallow gradient, wobbling foam line at the shore). Recentre the
plane on the camera every frame so its edge is always past the fog.

**Camera.** RTS orbit rig. Left-drag on empty ground pans by re-projecting the
cursor onto the drag plane each frame and shoving the target by the residual,
so the grabbed point stays under the cursor. Right-drag orbits (this changes in
Prompt 4), wheel zooms. Clamp the target to the island disc, follow the
ground, never let the eye inside a hillside.

**The hand.** Procedural: squashed-sphere palm, tapering wrist, five fingers of
three nested capsule joints so one `curl` value closes them. Build orientation
as an explicit orthonormal basis (fingers away from viewer, palm leaning partway
toward the terrain normal, banking into movement). Do not use Euler angles.

**Grab and throw.** This is the feel of the game; spend time here.
- Lateral movement is 1:1 with the mouse. While carrying, project the cursor
  onto a *horizontal plane at carry height*, never onto terrain. Height is a
  separate axis on the wheel.
- A held object is pulled by a damped spring, sub-stepped 5× per tick. Divide
  spring constants by `mass^MASS_LAG` so a boulder trails and a pebble snaps.
- Release velocity = `mix(objectVelocity, cursorVelocity, THROW_BLEND) * GAIN`
  plus upward lift proportional to horizontal speed. Average cursor velocity
  over a ~90 ms window so one stuttered frame can't launch something.
- **Two-stage pick**: exact raycast first, then a forgiving screen-space snap to
  the nearest prop within `PICK_TOLERANCE_PX`, each prop's projected radius
  also counting. A warm highlight marks what a click would take, and the
  highlight and the grab must call the *same* function.

**Props.** 576 grabbable objects (three rock silhouettes, boulders, three tree
shapes) as seven InstancedMeshes sharing one vertex-coloured material.
Rejection-sampled scatter with a minimum-spacing grid. Physics: gravity,
terrain collision split into normal/tangential response, rolling spin,
angle-of-repose friction, buoyancy (wood floats, stone sinks), sleep. Fast
movers adaptively sub-step so nothing tunnels through a ridge. Hard impacts
gouge a crater (real patch update), throw dust from a pooled particle system,
and shockwave nearby props awake.

### Constants (`state.js`)

| Constant | Value | Effect |
|---|---|---|
| `HAND.GRAB_STIFFNESS` / `GRAB_DAMPING` | 150 / 19 | Carry spring |
| `HAND.MASS_LAG` | 0.55 | How much heavier objects lag |
| `HAND.THROW_BLEND` | 0.45 | 0 = object momentum, 1 = cursor flick |
| `HAND.THROW_GAIN` | 1.22 | Hard flick clears ~140 units |
| `HAND.THROW_ARC_BIAS` | 0.2 | Lift as fraction of horizontal speed |
| `HAND.VELOCITY_WINDOW` | 0.09 s | Flick averaging |
| `HAND.CARRY_LIFT_SPEED` | 0.017 | Wheel sensitivity while carrying |
| `HAND.PICK_TOLERANCE_PX` | 22 | Grab forgiveness |
| `HAND.PICK_RADIUS_SCALE` | 1.25 | Extra grab zone by on-screen size |
| `HAND.HIGHLIGHT` | 2.4 / 1.85 / 0.95 | Albedo multiplier under cursor |
| `HAND.NORMAL_FOLLOW` / `REST_PITCH` | 0.3 / 0.5 | Palm follows ground; nose-down angle |
| `PHYS.GRAVITY` | −34 | Heavier than real; 9.8 feels floaty at this scale |
| `PHYS.RESTITUTION` / `FRICTION` | 0.3 / 0.7 | |
| `PHYS.REPOSE` | 0.20 | Angle of repose as `1 − normal.y` (≈36°) |
| `PHYS.IMPACT_THRESHOLD` | 14 | Speed at which landings crater |
| `PHYS.CRATER_DEPTH` / `MAX_CRATER_DEPTH` | 0.02 / 2.4 | |
| `PHYS.SHOCKWAVE_RADIUS` / `FORCE` | 9 / 0.55 | |
| `PHYS.DROWN_TIME` / `SINK_PULL` | 2.0 s / 9 | Submerged wood is lost; stone settles |
| `PHYS.UPROOT_DIST` / `UPRIGHT_DOT` | 2.0 / 0.85 | When a tree stops counting as planted |
| `WORLD.SIZE` / `EXTENT` / `MAX_HEIGHT` | 256 / 420 / 62 | (grows in Prompt 8) |
| `CAMERA.SMOOTH` | 14 | Chase rate |

### Traps

1. `IcosahedronGeometry` is non-indexed. Jittering vertices with independent
   random offsets shreds the surface. The offset must be a pure function of
   the original position.
2. Props on any slope will creep forever without a real angle of repose and a
   relaxing sleep threshold. Floating props need the sleep test too.
3. A capsule support function must keep the constant radius term or upright
   trees sink by their canopy radius.
4. A prop's `pos` is its centre. Any later scale change (wear, growth) must
   correct the drawn position by `supportOffset()` or the base floats.
5. A missed grab must not fall through to a camera pan. That is what makes
   grabbing feel hostile rather than fiddly.

### Acceptance

- Scripted grab → drag → flick → release through real pointer events produces
  a ~140-unit arc that lands and settles within ~5 s.
- Rock, boulder and tree all rest exactly at their computed contact offset.
- Grab succeeds 8/8 at cursor offsets of 4, 8, 12, 16, 20 px; fails at 24 px.
- 60 fps, ~30 draw calls.

---

## Prompt 2 — Town and Economy

Add a town, three resources, four buildings, and up to 150 villagers with a
job economy that turns the Prompt 1 props into wood and ore.

### Build

**Town centre siting.** Score ~4000 candidates for local flatness **and**
sample a ring at building range, rejecting anything under 80% dry land, plus a
minimum height. Level a 30-unit pad under it with the flat core at 65% of the
radius. Expose `flatten(x, z, r, strength = 1)` on terrain.

**Influence radius.** `BASE + pop × PER_POP`, capped, eased toward its target.
Render it by patching the terrain's own `MeshStandardMaterial` through
`onBeforeCompile` — a per-fragment distance-field ring, ~10 units wide, so it
follows every fold of the ground with no decal mesh. Building and casting are
gated on it.

**Resources and buildings.** Food, wood, ore. A `BUILDINGS` catalogue in
`state.js` (house, farm, storage pit, workshop) with `cost`, `pad`, `maxSlope`,
`key`. One InstancedMesh per type. Placement flattens the pad, deducts cost,
clears props in the footprint. Trees are felled for wood, stone broken for ore;
harvested nodes shrink over 0.7 s then stop being pickable, physical, or
findable. Farms regrow crop, so food is renewable.

**Villagers.** Up to 150 in two InstancedMeshes (body + carried bundle):

```
idle -> seek -> gather -> deliver -> idle
idle -> wander            (nothing to do)
any  -> eat               (hunger past threshold)
any  -> sleep             (energy spent)
```

Job choice is a utility score over how short the town is of each resource,
weighted so food dominates when the larder is thin. Villagers **claim** a node
before walking so twelve don't converge on one tree. They refuse to wade. Needs
run 0..1; prolonged starvation with an empty store kills. Walk animation is bob
plus roll about the forward axis.

**Build mode.** `B` opens an SVG radial menu built from `Object.keys(BUILDINGS)`
showing cost and affordability. A translucent ghost follows the cursor, green
when valid, red with the specific reason (too steep, outside influence, too
close, in water, can't afford). Shift-click keeps the tool active. Placement
claims the pointer so the hand can't grab and the camera can't pan.

**Growth blocker.** `town.growthBlocker()` reports what is holding growth back
(housing / food) and the HUD shows it next to the population readout.

### Constants

| Constant | Value | Effect |
|---|---|---|
| `TOWN.BASE_INFLUENCE` / `INFLUENCE_PER_POP` / `MAX_INFLUENCE` | 52 / 1.35 / 190 | Territory |
| `TOWN.GROWTH_INTERVAL` / `GROWTH_FOOD_COST` / `GROWTH_FOOD_RESERVE` | 14 s / 12 / 20 | Birth rate and price |
| `TOWN.CROP_REGROW` | 0.075/s | One farm feeds ~6–8 |
| `TOWN.START_POP` / `START_WOOD` / `START_FOOD` | 8 / 60 / **48** | 48 must exceed reserve + cost (32) or a new town can never grow |
| `TOWN.MIN_SPACING` | 5.5 | Gap between buildings before pads |
| `VILLAGER.SCALE` | 1.5 | Drawn larger than life |
| `VILLAGER.WALK_SPEED` | 5.0 | Scales with energy 0.65–1.0× |
| `VILLAGER.CHOP_TIME` / `MINE_TIME` / `FARM_TIME` | 4 / 5.5 / 5 s | |
| `VILLAGER.WOOD_PER_TREE` / `ORE_PER_ROCK` / `FOOD_PER_HARVEST` | 8 / 6 / 10 | |
| `VILLAGER.HUNGER_RATE` / `ENERGY_RATE` | 0.0125 / 0.0085 per s | |
| `VILLAGER.HUNGER_EAT_AT` / `ENERGY_SLEEP_AT` | 0.72 / 0.18 | |
| `VILLAGER.SEARCH_SLACK` | 12 | Past the influence edge for a job |
| `VILLAGER.IDLE_RETRY` | 0.8 s | Staggers job search cost |

### Traps

1. Don't early-return from `move()` when state is `sleep` — the villager must
   walk to bed. Use a separate `resting` flag for the pose.
2. Scoring the town site on flatness alone picks a beach every time.
3. Escape-cancelling placement involves no pointer event, so release the
   pointer claim explicitly or the hand and camera stay dead.
4. The influence rim added after tone mapping at 2 units wide is invisible.
5. `START_FOOD` below `GROWTH_FOOD_RESERVE + GROWTH_FOOD_COST` makes houses
   do nothing and the HUD say "housing" while the town starves.

### Acceptance

- Through real events: `B` opens the menu, clicking House starts placement,
  the ghost validates, a click places and deducts exactly 20 wood, the hand
  does not grab through the ghost.
- 4-minute headless run: one farm takes food 30 → ~75, wood 60 → ~400,
  population 8 → 12 until housing caps it.
- The blocker readout alternates legibly: housing → build houses → food →
  build a farm → housing.

---

## Prompt 3 — The Creature

The core of the game: a companion animal with needs, learned desires, learned
opinions, and a mind panel that lets the player watch it think.

**Shortcut:** the original built a procedural body here and replaced it with
the Kenney Cube Pets kit in Prompt 4.5. If you already have the kits, skip
the procedural body and go straight to the animated kit animal; everything
below about the mind is unchanged.

### Build

**Body (procedural version).** Merged torso, head on a neck pivot with horns,
eyes and a hinged jaw, four limbs as hip → knee → foot groups, four-segment
tail chain. Animate at render rate: legs and arms swing in opposition, body
bobs twice per stride, tail segments lag each other, head dips to eat, jaw
works while chewing. Dirt darkens the hide; slap/stroke flash it red/green.
Give it an invisible solid pick volume so petting hits reliably.

**Growth.** Size 0.85 → 2.3, half driven by age (`MATURE_AGE` 600 s), half by
meals (`FOOD_TO_MATURE` 45).

**Needs.** Hunger, energy, cleanliness, decaying on the sim clock. Needs never
decide *what* it does, only how badly it wants a category.

**The mind.** Score each candidate action:

```
utility = desire[d] × leashBias[d] × needDrive(d) × opinionScore(d, type)
          × proximity + curiosityNoise
```

- **Desires**: `eat, sleep, play, attack, help, impress`, one learned weight
  each, floor `DESIRE_MIN` 0.08, ceiling 2.0. Newborn starts lopsided toward
  eat and play with almost no aggression. `groom` is a fixed instinct
  (`GROOM_INSTINCT` 0.5), not a learnable desire. `DESIRE_AXIS` maps each
  desire to the opinion axis it consults.
- **Opinions**: `objectType → { edibility, fun, threat }`, all starting at 0.
  `OPINION_BASELINE` 0.38 is added when scoring so unknown things look mildly
  worth trying.
- **Curiosity**: noise that decays as lessons accumulate.
- Survival drives use a steep curve scaled by `NEED_URGENCY` 2.4, not linear.

**Reinforcement.** Drag on the creature: slow is a stroke, fast is a slap. Both
move the **desire** it was acting on *and* its **opinion of the object**.
Rate = `BASE / (1 + reps × DECAY)`. Consume `lastAction` on reinforcement so
mashing slap is one lesson per deed. Guard non-learnable instincts or you get
`NaN` in a weight.

**Slap vs stroke detection.** Measure *cursor* speed in screen px, smoothed by
a 0.05 s EMA; a slap needs `SLAP_SPEED` 3200 px/s sustained for `SLAP_SUSTAIN`
0.03 s; exclude the press frame. Stroking accumulates distance: every
`STROKE_DISTANCE` 90 px of travel under `STROKE_MAX_SPEED` 1800 px/s emits a
stroke; a motionless hold counts as a pat on release. Own the petting state
locally, not via `input.capturedBy`.

**Imitation.** Throwing a prop hard demonstrates play; where it lands decides
whether it also taught `attack` (kills villagers, flattens a building) or
`help` (set down gently among villagers). Weaker than a slap
(`IMITATE_BASE` 0.20).

**Leashes.** Keys `1`–`4`: learning / compassion / aggression / free. Each
multiplies desire weights when scoring without overwriting anything learned.
Learning leash also amplifies reinforcement by `LEARNING_LEASH_GAIN` 1.6.

**Hauling.** The `help` desire does real work: walk to a node, tear it down
(`HAUL_GATHER_TIME` 2.6 s), shoulder `HAUL_WOOD` 26 / `HAUL_ORE` 18, carry to
the nearest storage or the centre, load visible on its back. Node choice is
weighted by what the town is short of (`HAUL_SHORTAGE_WEIGHT` 2.2,
`HAUL_SATED` 120). Felled timber is preferred over standing trees
(`LOOSE_FOOD_BONUS` 3.2, `PLANTED_FOOD_PENALTY` 0.22). **A haul is committed
once begun**, both legs. `decide()` must release any node the old action
claimed.

**Mind panel** (`G`): live needs, six desire bars, colour-coded opinion table,
current action and phase, rolling decision log with score and curiosity.

### Constants

| Constant | Value | Note |
|---|---|---|
| `LEARN_DESIRE_BASE` | **0.10** | Keep small. The single most important number in the file |
| `LEARN_OPINION_BASE` | **0.50** | The opinion carries the lesson |
| `LEARN_DECAY` | 0.55 | First lessons dominate |
| `CURIOSITY_BASE` / `CURIOSITY_DECAY` | 0.85 / 0.07 | |
| `IMITATE_BASE` / `IMITATE_DECAY` | 0.20 / 0.40 | |
| `SPEED_SMOOTH` | 0.05 s | |
| `DECIDE_INTERVAL` / `ACT_TIME` | 1.1 s / 2.2 s | |

### Traps

1. A high `LEARN_DESIRE_BASE` (0.34) means six slaps for eating rocks drives
   `eat` to the floor and the creature starves. "Rocks aren't food" ≠ "eating
   is bad".
2. Measuring the *hand's* world velocity for slaps is wrong — it chases the
   cursor on a spring and whips across the map on any pointer jump.
3. Re-deciding every 1.1 s without commitment means it never finishes a haul
   and strands every node it ever claimed.

### Acceptance

| Check | Expected |
|---|---|
| Learning-rate decay over 10 reps | 0.200 → ~0.043 |
| Untaught newborn's meals | indiscriminate across tree/rock/boulder |
| One slap for eating a rock | `rock.edibility` 0 → −0.80; rock meals thereafter 0, boulder still tried |
| Stroke / slap on `eat` | 0.75 → 0.91 / 0.91 → 0.81 |
| Gesture classification | 0–2700 px/s = stroke, 4200+ = slap |
| 7 min hauling, villagers frozen, 400 wood / 0 ore | fetches ore far more than wood |

---

## Prompt 4 — Miracles and Alignment

Add the event bus, belief, four miracles, and a moral axis that recolours the
world.

**Shortcut:** the original used drawn-gesture casting here and replaced it in
Prompt 7 with Ctrl-held casting. Build the Prompt 7 version directly if you
want to skip the recogniser.

### Build

**Event bus first.** `state.events` — ~20 lines of emit/subscribe. Convert the
direct `creature.witness()` calls from props/hand into facts:
`villagers-killed`, `building-destroyed`, `villagers-fed`, `prop-thrown`,
`miracle-cast`, `villager-born`. Creature and alignment each subscribe.

**Belief.** Generated by villagers, scaled by town happiness — a blend of food
per head, spare beds, and how many are currently hungry, eased so one bad tick
can't crash it. Floor `TOWN.MIN_HAPPINESS` 0.15. Miracles cost belief and
nothing else: a cruel god who starves his people loses the power to be cruel.

**Casting (gesture version).** Hold right mouse and draw. $1-style: resample to
32 points, centre on centroid, scale longer axis to 1, compare point-for-point.
No rotation invariance. Reject outright below `MATCH_THRESHOLD` 0.45; report
ambiguous if the best doesn't beat the runner-up by `MATCH_MARGIN` 0.02. Draw
the trail as SVG; a grimoire panel renders glyphs from the same template data.

| Gesture | Miracle | Cost | Effect | Align |
|---|---|---|---|---|
| ○ | Food | 30 | +45 food, feeds villagers in range | + |
| ∿ | Water | 20 | Boosts crops, washes the creature | + |
| ∧ | Fireball | 55 | Craters, razes, kills, blasts props | − |
| Z | Lightning | 45 | Tight strike, small radius | − |

Radii 9–22 per miracle. Right-drag given to gestures means orbit moves to
middle-drag, Alt+left-drag, and `Q`/`E` (`KEY_ROTATE_SPEED` 1.5 rad/s).

**Alignment.** One float −1..+1, moved by deeds on the bus and by casts,
eased by `ALIGNMENT.SMOOTH` 0.7/s. Cosmetic only for now:
- Terrain saturation shifts in the existing shader patch (cruel = grey/cold).
- Buildings swap geometry variant past `GEOMETRY_SWAP_AT` 0.3 — **one** builder
  function with an `evil` flag (taller dark spiked roofs, taller chimney);
  farms and storage pits change by tint alone.
- Creature darkens and reddens with a faint eye glow. Hand goes ashen and
  red-lit — and the glow must *decrease* toward evil or it clips to white.

**Opinion generalisation.** A `KINSHIP` table groups object types (stone,
plant, person, structure); `KINSHIP_LEAK` 0.4 of each lesson reaches relatives.

### Constants

`MIRACLE.BELIEF_PER_VILLAGER` 0.055/s (the master dial),
`MIRACLE.MIN_PATH_LENGTH` 90 px, `MIN_POINT_SPACING` 6 px,
`ALIGNMENT.CRUSH_VILLAGER` −0.07, miracle `align` −0.06..+0.05.

### Traps

1. Alt+left-drag must suppress grabbing too, or the forgiving pick claims the
   button before the camera sees it.
2. Emissive on a darkened red albedo clips under ACES to a pale blob.
3. The event bus has no schema yet; Prompt 8 adds one. Decide event names in a
   frozen constant now if you'd rather not retrofit.

### Acceptance

- Gesture recognition 48/48 on noisy trials; random scribble rejected.
- 7 villagers at 58% mood for 60 s: belief ~8 → ~22.
- Kinship: one slap → rock −0.80, boulder −0.32, tree 0.00.
- Camera rebinding all verified through real events.

---

## Prompt 4.5 — The Kenney kits *(inferred; not a numbered phase)*

Replace the procedural props, creature, villagers and buildings with five CC0
Kenney kits, confined to `src/lib/models.js` so every system still receives a
plain `BufferGeometry` and neither knows nor cares where it came from. Boot
becomes async: fetch the kit before any system inits.

| Pack | Used for | How loaded |
|---|---|---|
| Mini Forest | trees, rocks, boulders (until Prompt 11) | eagerly at boot, before `initProps` |
| Cube Pets 2.0 | the creature — 24 animals, 8 node-animation clips each (`static idle walk run eat dance gesture-positive gesture-negative`) | one animal on demand, cached; `C` opens a picker; switching keeps everything learned |
| Fantasy Town Kit | house, workshop, storage, farm | only the 16 of 167 pieces used; modular 1×1 grid; `composeParts()` assembles walls/roofs; good/evil variants swap parts |
| Mini Characters | villagers | 2 of 12 characters; **skinned meshes can't be instanced**, so bake 5 static poses (1 idle + 4 walk frames) per character on the CPU and re-bucket every villager into the matching pose mesh each frame — a flipbook driven by stride phase |
| Castle Kit | the town centre: keep of three storeys under a pointed roof, curtain wall, corner turrets, gate — ~28 pieces merged into one geometry | 11 of 76 pieces; also holds catapult/trebuchet/ballista/ram/siege tower with demolished variants for later |

One `loadKitPieces(pack, names)` serves both modular kits. Nature pieces later
use a separate GLTF glob.

### Traps

1. All packs reference an *external* `Textures/colormap.png`. Works in dev,
   404s in a production build. Import each palette so it bundles and rewrite
   the request via a `LoadingManager` URL modifier. Derive the pack from the
   path, never from a hardcoded folder list.
2. Dim kit materials to `0xb9b9b9`; pure white under a 2.35-intensity sun with
   ACES blows out.
3. Mini Forest rocks are wide and flat: use an ellipsoid support function.
4. `TOWN.CENTRE_CLEARANCE` must exceed half `TOWN.CASTLE_WIDTH` or houses grow
   through the battlements.
5. Kit pieces must be *named* at boot; being in the folder is not enough.

### Acceptance

146 villagers at 60 fps in 11 draw calls. Two `colormap-*.png` in `dist/`.

---

## Prompt 5 — Rival Towns and Conquest

Add rival settlements running the identical economy, two routes to take one
(awe or force), soldiers, and the platoon banner.

### Build

**Multi-town refactor.** Every settlement is the same record: centre,
stockpile, influence, buildings, happiness, growth timer. The only difference
is who decides where to build. Keep `state.town` meaning "the player's town"
with every method unchanged in signature; add `*In`/`*Of` variants
(`placeIn`, `findBuildingIn`, `populationOf`). All towns share one
InstancedMesh per building type, told apart by a per-instance banner tint. The
slot registry is global per type. Villagers carry `v.town`. The influence
shader draws up to four territories in their colours.

**Rival AI.** Every ~12 s: build what fixes the biggest shortfall — housing if
growth is blocked, a farm if food is short (capped against population), then
storage, workshop, and a barracks once it can defend. Probe outward in rings
for a legal spot. Run the same `validate()` as the player.

**Awe.** Each rival tracks awe 0..1, shown as a HUD meter. Nurturing miracles
in their sight raise it (scaled by cost); cruel ones lower it; finishing a
large building in sight adds a little; it decays. Miracles must be castable
inside a rival's land. At 1.0 the town joins you with all people and buildings.

**Soldiers.** Trained at a **barracks** from food and ore, six per barracks.
One InstancedMesh of the kit archer, banner-tinted. **The platoon banner** is a
physical flag you pick up and plant with the hand; the platoon marches to it.
Give it an invisible solid pick volume. Rivals raise a garrison past six
population and hold their centre.

**Siege.** Taking a town needs three things in order: kill its defenders,
break its curtain wall, hold the inside with `CAPTURE_ATTACKERS` soldiers.
Walls regenerate if the siege is abandoned. Soldiers also sack: they kill
civilians and raze buildings, with **weighted** targeting (distance ×
`THREAT_WEIGHT` per kind), not tiered.

**Attribution.** `villagers-killed` and `building-destroyed` carry `byPlayer`.
Alignment and creature imitation ignore anything the player didn't do.

### Constants

`TOWN`: `RIVALS` 2, `TOWN_SPACING` 150, `COLOURS`/`NAMES`,
`RIVAL_START_POP` 6, `RIVAL_START_BUILD` house/farm/house,
`RIVAL_BUILD_INTERVAL` 12 s, `IMPRESS_PER_MIRACLE` 0.16,
`IMPRESS_MIRACLE_CRUELTY` −0.22, `IMPRESS_PER_BUILDING` 0.05,
`IMPRESS_SIGHT_MARGIN` 45, `IMPRESS_DECAY` 0.004/s, `TINT_MIX` 0.7.

`COMBAT`: `TRAIN_INTERVAL` 12 s, `TRAIN_FOOD` 8, `TRAIN_ORE` 5,
`GARRISON_PER_BARRACKS` 6, `ENGAGE_RANGE` 7, `SIGHT_RANGE` 30, `DPS` 0.26,
`SOLDIER_HP` 1, `CIVILIAN_DPS` 0.8, `BUILDING_HP` 40, `BUILDING_DPS` 2.4,
`THREAT_WEIGHT` soldier 0.45 / villager 0.85 / building 1.0,
`ALIGN_PER_CIVILIAN` −0.05, `WALL_HP` 120, `SIEGE_DPS` 2.6, `SIEGE_RANGE` 30,
`CAPTURE_ATTACKERS` 3, `WALL_REGEN` 1.5/s, `ALIGN_CONQUEST` −0.30,
`ALIGN_PEACEFUL` +0.18.

### Traps

1. When rewriting `initTown`, keep seeding `state.resources` from `START_*`.
   The player's stockpile *is* `state.resources`; drop it and they open with
   zero food. Compare all towns in the same run.
2. Cap rival farms against population or they build eleven.
3. Two armies will stand in a ring exactly `ENGAGE_RANGE` apart and never
   fight. A soldier must charge anything visible within `SIGHT_RANGE` and
   close well inside swinging distance.
4. `combat.update()` must run before hand and camera or the camera claims the
   left button before the banner can be picked up.
5. Strict tiered targeting means buildings are never touched.

### Acceptance

- Two rivals reach ~27 pop and 24–29 buildings unaided in 5 min.
- A rival at 19 pop is won over in ~7 food miracles; everything transfers.
- Banner planted on a 23-pop rival with 6 soldiers and a full wall: falls in
  ~35 s; alignment −0.29.
- A rival army killing your villagers moves your alignment by ~0 and teaches
  the creature nothing.

---

## Prompt 6 — The Banner Calls, and Everyone Is Someone

The creature goes to war under the banner, and villagers and animals get
traits that actually do something.

### Build

**War under the banner.** A flag on hostile ground (inside a rival's border or
on top of an enemy army) is an attack order. There is no toggle. Under it the
creature marches to the flag, holds `WAR_HOLD` short of it when nothing is
left, swipes every `WAR_INTERVAL` catching the nearest `WAR_SWEEP` enemies in
`WAR_RANGE` (soldiers, villagers, buildings), and fights at `WAR_MULT` × attack
and defense. **War is an override, not a utility candidate** — a direct order
from a god is obeyed. Every kill sets `lastAction` so slap/stroke still teach.

**Derived stats.** Attack and defense are never stored: derived every read from
constants × species temperament × whether the banner is an attack order.
Damage runs through `takeDamage()` which applies defense.

**Rout, not death.** At zero health it leaves the field, sulks at home for
`WAR_ROUT_TIME` while `WAR_REGEN` heals it. `WAR_REGEN × WAR_ROUT_TIME` must
exceed `WAR_HEALTH` so it always returns at full strength.

**Villager traits.** Two per villager, fixed for life, from different groups:

| Group | Traits |
|---|---|
| body | Hardy, Sickly, Glutton |
| temper | Swift, Plodding, Diligent, Lazy |
| craft | Woodsman, Miner, Grower, Strong |
| spirit | Devout, Doubter |
| nerve | Brave, Timid |

A trait is a set of multipliers (hunger, energy drain, walk speed, job time
generally and per resource, yield, meal size, starvation damage, damage taken,
belief generated). Fold both into a flat `v.mods` at birth; nothing reads the
trait list per tick. The `TRAITS` table in `state.js` *is* the system.

**Creature temperament.** Two traits from **species**, hand-authored for all 24
Cube Pets animals (a lion must read as a lion on the card). Bends attack,
defense, speed, hunger, food value, learning rate, memory, curiosity, and
desire leanings: Clever 1.4× learning; Stubborn 0.65× but longer memory;
Gentle learns aggression 0.6× and kindness 1.4×, Ferocious the reverse;
Thick-hided trades 12% speed for +50% defense, Fleet the opposite. Show
temperament on the creature card and the mind panel; show the town's trait
census on the mind panel.

**Belief per head.** Count belief from the player's *own* villagers weighted by
devotion, not from `state.villagers.count` (which is global). This is a real
balance change; `BELIEF_PER_VILLAGER` is the dial.

### Constants

`CREATURE`: `WAR_ATTACK` 0.55, `WAR_ATTACK_BUILDING` 6, `WAR_DEFENSE` 1,
`WAR_MULT` 2.0, `WAR_RANGE` 9, `WAR_SWEEP` 3, `WAR_INTERVAL` 1.0 s,
`WAR_HEALTH` 20, `WAR_REGEN` 0.9, `WAR_ROUT_TIME` 25 s, `WAR_HOLD` 12
(becomes 16 in Prompt 17).
`COMBAT`: `DPS_VS_CREATURE` 0.35, `THREAT_WEIGHT.creature` 0.5.
Tables: `TRAITS`, `TRAIT_COUNT`, `CREATURE_TRAITS`, `PET_TEMPERAMENT`.

### Traps

1. Imitation must filter on `cause` as well as `byPlayer`, or the creature
   learns aggression from watching its own rampage.
2. Without `WAR_SWEEP` one swipe clears a field and the army is pointless.

### Acceptance

- Elephant 0.55/1.5, Tiger 0.80/0.8, Lion 0.80/1.5 attack/defense; doubled
  under the banner.
- Creature alone vs 21-pop rival with 30 soldiers: kills ~24, finishes on ~3
  of 20 HP — wins, and can lose.
- Over ~4,500 job samples: Diligent ~0.73× time, Lazy ~1.45×, Woodsman
  ~0.57× chop, Miner ~0.61× mine, Strong ~13 per load vs ~8.

---

## Prompt 7 — The World Fights Back

Rivals raid, villagers run and fight, the creature grows into its history,
the hand picks up people, casting becomes a held key, and a famine that had
been killing every town gets found.

### Build

**Fix the famine first.** Run a 20-minute unattended game and watch every town
starve at minute eight with fields at full crop. Three fixes:
1. Resource targets scale with population: `TOWN.FOOD_PER_HEAD` 5 +
   `FOOD_FLOOR` 40, wood 2/80, ore 1.5/40.
2. Rival soldiers train only from surplus above a flat floor. **Rivals only** —
   the player pays `TRAIN_FOOD` and nothing more.
3. **Farm worker slots leak.** `releaseTarget()` must decrement the farm's
   `workers` count itself; a decrement after it has nulled `targetBuilding` is
   dead code. Print `claimedWorkers` vs villagers actually holding each farm.

**Rivals raid.** A war council in `combat.js`. Each rival scores neighbours by
`(distance + defenders × RAID_DEFENCE_WEIGHT) / spoils`, commits for
`RAID_COMMIT`, marches `RAID_FRACTION` of the garrison, and gives up on
`RAID_DURATION`, when cut to `RAID_BREAK`, or when home is threatened.
`hostile(a, b)` is "different towns, not both the player's" — *not*
`a.isPlayer !== b.isPlayer`, which makes all rivals allies. `siegeTick` is
general (any hostile force breaches any wall) but a breached player town does
not yet fall; leave one early return with a comment for Prompt 10.

**Villagers flee.** A `flee` state that outranks every need including sleep.
Run for the centre unless the threat lies that way, then directly away trying
several fanned bearings. Full speed regardless of energy.

**Villagers fight back.** `FIGHT_DPS` 0.045 (a soldier is ~5.8× a farmer).
Stand or run by local friends-to-enemies ratio scaled by nerve: Brave holds at
~1.6:1, Timid needs >4:1. Counted locally via a second spatial hash over
villagers. Test at raid density, not in a packed square.

**Spatial hash.** `src/lib/grid.js`, a utility like `noise.js`, rebuilt from
scratch each tick (O(n), no stale buckets). Systems build private instances.

**Earned traits.** Battle-scarred (2 routs, defense ×1.25), Bloodied (25
kills, attack ×1.20), Beloved (20 strokes, learns 1.15× faster). Stored apart
from species traits and re-merged on body change. Toast on earning.

**War leash and rout.** Targets must lie within `WAR_LEASH` of the *flag*; off
the leash it walks back first. Withdraw at `WAR_WITHDRAW` health and keep the
war defense multiplier while withdrawing. Rout is one-shot: `inField` false,
`takeDamage` ignores it, soldiers stop targeting it. Audit every system that
can touch an "out of play" flag.

**Home defence.** An enemy inside your border is its own order. Soldiers
*standing at home* respond (troops sent away stay on their order). The
creature goes to the intruder, not the flag; an explicit attack order still
wins.

**The hand takes people.** Villagers get pos/vel/mass/radius so the same spring
carries them, `GRAB_MASS` 0.5. Pick by whichever of prop/person is nearer the
cursor in pixels. Held = suspended. On landing: below `FALL_SAFE_SPEED` they
flee shaken; above it damage; sea drowns. Emit `cause: 'drowned'` /
`'dropped'`, `byPlayer: true`. Villagers need a `quat` or the carry spring
throws and, because hand sims first, **halts the entire simulation**.

**Devouring.** Enemy villagers score `ENEMY_APPETITE` 3.5 vs
`FRIEND_RESTRAINT` 0.35. At the front an enemy civilian is eaten:
`DEVOUR_MULT` damage, eat animation, hunger *and health* restored.

**Casting becomes a held key.** Delete the gesture recogniser. **Hold Ctrl**:
wheel picks the miracle (consumed, so the camera doesn't zoom), left click
casts, release puts it away. A ring in the miracle's colour at the radius the
effect *actually uses*, dimmed when unaffordable. Grimoire rows pick. The HUD
is `pointer-events: none`; every interactive panel must opt back in.

**The right button commands the creature.** Right-click ground = go there;
right-drag = go there and hold a circle sized by the drag (commit on the
release *edge*, not on "button no longer held"); right-click the creature =
dismissed. Blue ring for the standing order, amber while dragging, hidden at
war. The circle filters *candidates* so it appears to choose to stay.

**Nodes wear.** A worked node shrinks toward `WEAR_MIN_SCALE` via the existing
`shrink` channel; recovers at `WEAR_RECOVER` when abandoned. Cosmetic only.

**Barracks ranks.** Militia 1.0 HP / 1.00 power / cap 6; Men-at-arms 1.9 /
1.35 / 8 (70 wood, 55 ore); Knights 3.2 / 1.80 / 10 (140 wood, 120 ore).
Stats taken at training, kept for life. Rivals upgrade too. Each tier
`TIER_SCALE` taller. Upgrade panel above the grimoire. HUD shows `army n/cap`
with *need food* / *need ore* / *at cap* in amber.

### Constants

`COMBAT`: `RAID_MIN_ARMY` 6, `RAID_FRACTION` 0.65, `RAID_INTERVAL` 20 s,
`RAID_COMMIT` 45 s, `RAID_DURATION` 150 s, `RAID_BREAK` 0.35,
`RAID_GRACE` 240 s, `RAID_DEFENCE_WEIGHT` 6.
`VILLAGER`: `FLEE_RADIUS` 22, `FLEE_HYSTERESIS` 1.45, `FLEE_CALM` 3.0 s,
`FLEE_SPEED` 1.55, `FLEE_AWAY_DIST` 30.
`EARNED_TRAITS` table.

### Acceptance

- Rivals reach 56–69 pop at minute 18, zero starvation.
- 20 min unattended: ~7 raids, most rival-on-rival, first just after grace.
- 40 soldiers on working villagers: ~86 fleeing at peak, ~70% survive.
- Brave stands 100%, Timid ~61%. Standing loses 12 vs 21 always running.
- Six waves of 108 soldiers: ≤4 routs, never enters rival land.
- Throw a villager at ~100 u/s: dead; 4-unit drop: full health, fleeing.
- 8 Knights vs 8 Militia: 7 knights standing.
- 22 villagers killed by rivals during a raid on you: 0 charged to you.

---

## Prompt 8 — It Sustains Itself

Make the world survivable indefinitely. No new toys.

### Build

**Compact the live arrays.** `soldiers` and `villagers` are compacted **in
place** every tick (other systems hold the reference). Villager ids come from
a monotonic counter, never array position — props record `claimedBy = v.id`.

**Farms per bed.** `TOWN.FARMS_PER_CAPACITY` 6: farms allowed per housing
capacity, never per current population, so a raided town keeps its farms.

**Forests regrow; stone doesn't.** A felled tree leaves a stump that sprouts
after `REGROW.DELAY` 50 s and grows over `REGROW.TIME` 70 s by reviving the
*same* prop slot, exactly where it stood. Growth reuses the wear channel in
reverse. Saplings are invisible to woodsmen until `REGROW.HARVESTABLE_AT`
0.75. Quarried stone is final — that makes ore worth fighting over.

**Event schema.** Required fields per event; a missing one is a dev-only
console warning naming the event and field. Expect it to find emit sites
relying on the `byPlayer` default.

**Grow the island.** `WORLD.EXTENT` 420 → 640, `WORLD.SIZE` 256 → 384 (hold
1.67 units per sample), scatter counts scale with area (790/490/60),
`TOWN_SPACING` 150 → 230. Instance capacities **derived from the scatter
budget** with headroom. Building `CAPACITY` 256 and `place()` refuses rather
than overflowing (Prompt 13 makes it grow). `CAMERA.MAX_DIST` 430; the plate
edge stays just out of shot.

### Traps

1. `GL_INVALID_OPERATION: Vertex buffer is not big enough` from inside ANGLE
   means an InstancedMesh count exceeds its buffer. WebGL does not throw; it
   renders garbage.
2. A diagnostic that returns the first matching reason from a fixed list will
   confidently misattribute anything outside the list.

### Acceptance

- 45 min unattended: villager array peaks under the cap, every entry alive,
  ~380 distinct people lived, towns still growing (one past 100).
- Forest holds at 250–320 trees against ~320 at start with two towns logging.
- Schema warnings: zero after fixing the emit sites.

---

## Prompt 9 — It Teaches Itself, and Can Be Read

The creature learns from consequences, and the world stops hiding its state.

### Build

**Nutrition.** `CREATURE.NUTRITION` per eaten type (tree 1.0, villager 1.15 —
Prompt 10 lowers this to 0.35), default 0. Stone costs `INEDIBLE_COST` 0.07
energy and feeds nothing.

**Self-teaching.** `selfTeach()` runs the slap machinery (same opinion table,
kinship leak, decaying rate) at `SELF_TEACH_BASE` 0.15 / `SELF_TEACH_DECAY`
0.30. Two channels: eating outcome → `edibility`; damage → `threat`, banked in
lumps of `PAIN_PER_LESSON` 4.0. It plateaus by design; the hand is still the
strongest teacher.

**The leash is a tube.** `THREE.Line` width is 1 px on every desktop driver.
24 segments, frames from a fixed world-up (never `computeFrenetFrames`, which
is on `Curve` and allocates), only the position attribute rewritten.

**Traits show in the crowd.** `TRAIT_BUILD` 0.90–1.13 varies draw scale by
trait. Kept slight.

**Raids can be seen coming.** A panel under the resource bar in alarm colours
listing every army on the march and its strength, raids aimed at you picked
out. Reads `state.combat.raids`.

**Alignment does something.** `TOWN.ALIGNMENT_MOOD` 0.18: alignment moves a
town's happiness, happiness drives belief. Cruelty charges interest.

### Acceptance

- Alone in a forest, no input: `tree.edibility` 0 → ~0.6. In a stone desert:
  rock/boulder → ~−0.28, log turns from eating rocks to playing with them.
- Same town, saintly vs monstrous: happiness ~0.885 vs ~0.615.
- Eleven distinct villager builds visible in one town.

---

## Prompt 10 — It Can End

Win and lose conditions, siege engines, witnessed miracles, two hands-free
buildings, and a pile of creature and prop fixes.

### Build

**Endings.** Victory = every rival flying your colours, by any route; the route
is written into the ending text. Defeat = your seat taken by force (remove the
Prompt 7 early return) or your people gone. `state.endGame(kind, reason)` is
**idempotent**. Checks run once a second. The world stops, rendering continues.
Screen leads with **YOU WIN** / **YOU LOSE** at 76 px in gold/red; flavour name
beneath. Names the run: time reigned, population, towns taken, Merciful/Cruel,
lessons taught.

**Siege engines.** From the castle kit (catapult instanced; others available).
Built from the barracks panel, `ENGINE_COST` 90 wood / 70 ore,
`ENGINES_PER_BARRACKS` 1, `ENGINE_SIEGE_DPS` 4.8, `ENGINE_SPEED_FRAC` 0.5,
`ENGINE_HP` 6, `ENGINE_RANGE` 34, `THREAT_WEIGHT.engine` 0.3. **An engine
batters a wall whatever is happening around it**; soldiers still can't until
the garrison is dead. A dead engine leaves a permanent wreck (demolished
variant). Castle pieces live in `state.castlePieces`, a **Map**.

**The creature can capture.** It counts as `CREATURE_SIEGE_WORTH` 3 soldiers
for breaking and holding. Sequencing unchanged.

**Hostile ground is its own order.** Standing inside a rival's border makes
that town the front; `WAR_LEASH` holds it there; removing it removes the
front. A wandering creature can now start a war charged to you — document it.

**Witnessed miracles.** A cast refunds `BELIEF_PER_WITNESS` 1.15 × devotion per
own villager within `WITNESS_RADIUS` 42, capped at `WITNESS_MAX_REFUND` 0.6 of
cost. Rival witnesses feed awe, not belief. Message: *"Food — 5 saw it, +4
belief"*.

**Belief for being seen to help.** Clearing a rock/log from lived-in land
(`CLEAR_MIN_DIST` 14, `CLEAR_COOLDOWN` 25 s, `BELIEF_PER_CLEARED` 0.55,
`CLEAR_MAX_BELIEF` 4). Throwing a believer who *lives* (`THROW_MIN_DIST` 18,
`THROW_COOLDOWN` 20 s, `BELIEF_PER_THROW_WITNESS` 0.9, `THROW_MAX_BELIEF` 6).

**Cattle Farm** — 34 wood, 8 ore, `maxSlope` 0.16, `CATTLE_FOOD_RATE` 0.155/s,
no workers. **Lumber Camp** — 30 wood, 12 ore, a *multiplier*: woodcutters
within `LUMBER_RADIUS` 34 chop `LUMBER_SPEED` 1.5× faster, applied at the tree.
Both appear in the radial automatically; rivals build both.

**Creature fixes.** Villager `NUTRITION` → 0.35 with a `NUTRITION_GOOD`
threshold (below it the lesson runs *downward*). Commit to *any* action once
begun, not just hauling. Skip lessons that can't move a clamped opinion.

**Prop fixes.** Apply the wear `supportOffset` correction only while resting
on something. The `growing` early-return applies only to an untouched sapling.
Judge drowning on the ground under the prop, not its centre. Only `help` and
`eat` wear a node; `play` doesn't. A stump checks for a building (own pad +
`REGROW.CLEARANCE`) before sprouting.

### Acceptance

- `endGame` called twice produces one ending.
- Engine unescorted vs 6 defenders: dead in ~6 s. Escorted by 12: wall
  breached in ~9 s. Soldiers alone vs defended wall: 120 → 120.
- Creature alone, no army: 22-pop rival with 11 garrison behind a full wall
  taken in ~30 s.
- Food miracle over 5 believers nets 26; on empty ground costs 30.
- One paddock: 0.0077 food/tick. Camp: chop 0.69× inside, 1.00× outside.
- 4 min: eat actions ~30 not ~110; own villagers eaten 0;
  `villager.edibility` self-taught negative, `tree` positive.

---

## Prompt 11 — The Island Gets a Landscape

Integrate the Kenney nature kit, sort trees into biomes, and add thousands of
pure-decoration flora.

### Build

**Kit integration.** The nature kit ships `GLTF format` (add a glob) and has
**no textures** — colour lives in the material. Add `flattenByMaterial` that
bakes each mesh's material colour into vertex colours before merging. Draw
nature pieces with no `map` on vertex colours alone. Load it *before*
`initProps`.

**Biomes by altitude.**

| Band | Up to | Species |
|---|---|---|
| shore | 5.5 | palms |
| lowland | 17 | oak, default, fat, detailed + `_dark` |
| upland | 30 | cone, tall + `_fall` |
| timberline | — | pines, thin |

Per-band scale spread. Stone from the same kit's `stone_*` family (not
`rock_*`, whose materials are grass and dirt). Size stone by **width**, not
height.

**Flora.** `flora.js`: ~2,600 grass, flowers, mushrooms, bushes, stumps, logs,
pebbles in ~13 instanced meshes. No physics, not pickable, never simulated,
written once. Grass dominates; flowers and mushrooms rare. Buildings clear it
with a wider skirt than props, and the clear **compacts** the instance buffer.

### Traps

1. Kenney writes picker colours into `baseColorFactor`, which glTF defines as
   linear. Read them back as sRGB (foliage should measure `#29c9ab`, bark
   `#e28357`) or trees glow mint.
2. Chalky trees = a pure-white base material. Use `0xb9b9b9`.
3. Read the asset's material table before trusting a file name.

### Acceptance

~760 trees across ~17 species in distinct regions. Rock average width ~2.3,
boulder ~4.0 (a villager is 2.25 tall, a house 5.2). Draw calls ~80, still
60 fps.

---

## Prompt 12 — New Terrain, and the Kits Come Out

Terrace the island and dress it with scenery from all three kits.

### Build

**Terracing.** Stay a heightfield. Quantise with an S-curve, not `floor()`:

```js
const t = y / TERRACE.STEP, step = Math.floor(t), f = t - step;
const fk = Math.pow(f, TERRACE.SHARPNESS);
const shaped = fk / (fk + Math.pow(1 - f, TERRACE.SHARPNESS));
```

Terrace **before** the fine detail. Broaden the mountains first — two ridged
octaves at half frequency (`0.0058`) — because you cannot cut a step into
detail finer than the step. **Assert town count and buildable percentage on
every run**; a terrain change is a gameplay change.

**Repaint** the ground with the kit's `grass`/`dirt`/`stone`, desaturated.

**Scenery.** `scenery.js`: landscape (202 cliff outcrops on terrace risers
banded by altitude, statues on high ground clear of towns, canoes and
driftwood on beaches) at startup; town dressing (crops behind farms, fences
and bushes at houses/pens/camps, lanterns/carts/stalls/stools around squares,
rubble and logs, pennants on the castle's four corner towers mounted in
`makeCastleGeo`) per building via `state.scenery.dressBuilding`. Scenery runs
*after* town and back-dresses what already stands. Cut tree scale by about a
third.

**One sizing rule** for everything scattered: `sizeToMax(geo, size)` —
uniform scale so the largest dimension measures `size`.

### Traps

1. `BUILDINGS` entries carry `key`, not `id`. Print the counts.
2. What survives scattering is what stands on its own legs; wall-mounted and
   tileable pieces must be mounted by whatever assembles their parent.

### Acceptance

23+ flat terraces across a 240-unit transect; buildable ~89%; three towns on
every seed; ~17 extra draw calls for ~470 scenery objects.

---

## Prompt 13 — Achievements, Capacity, Redemption, and the War Machine

Fifty achievements, then a run of fixes and tuning.

### Build

**Achievements.** One rule: *every achievement is a counter reached a number*.
Table in `state.js` (`{ id, group, name, blurb, stat, need }`), counters in
`achievements.js`. Nothing else knows it exists. Counters come from the bus
(events) and from 2 Hz polling (levels; several are *peaks*; belief counts
only rises). Persist in `localStorage`, swallowing failures. Groups:
Beginnings 5, Settlement 8, People 7, Faith 7, Creature 9, War 8, Divinity 6.
`I` opens the menu (renders on open, never on a timer). Earning raises a gold
card — **queued**, one at a time.

**Creature fixes.** Direct orders outrank the war (don't gate the summons on
`!atWar()`). Siege uses `defendersAt(town)` — soldiers within siege range —
not `countFor(town)`.

**Instance growth.** `growMesh`/`growInstances` doubles a full InstancedMesh
preserving order; shared by buildings, props, flora, scenery. Capacity check
runs *before* charging and flattening.

**Redemption.** Kindness worth more the further you've fallen, cruelty cheaper
once down there, both vanishing at neutral, one-sided. **Penance**: slow pull
toward neutral while in the red, doubled after 25 s without a cruel deed,
never past zero.

**Building is mercy.** `+0.035 × mercy` per placement: house/farm/cattle 1.0,
camp/storage/workshop 0.5, barracks 0. Nothing else — no belief, no reach.
`town.js` emits; `miracles.js` and `achievements.js` listen.

**Replacement debt.** A town remembers how many men it owes and refills at
`REPLACE_INTERVAL`; both intervals divide by barracks count up to three;
capped at the garrison cap; blocked cycles retry in 1.5 s. Panel says
"replacing N".

**Engines obey the banner** through the same `warFront` rule as soldiers; with
no order they hold with the army but still batter a hostile wall in reach.

**Only the player captures.** Rivals *sack* (wall down, buildings razed) but
never take ownership. Rename `tier` → `tierLevel`.

**Performance.** Profile the **production** build. Expect ~5% utilisation and
no bottleneck. Do the two honest wins: `WATER.SPAN`/`WATER.CELL` derive the
segment count (135k → 33k triangles); replace guessed capacities with growth.
Add a `BUDGET` in `state.js` checked every 10 s in dev.

### Acceptance

- Seven unlocks on one tick play as seven cards in order.
- 404 houses with zero refusals; 50 demolished with valid indices.
- Floor → neutral: 10 feedings (was 34); ~83 s of doing nothing cruel.
- Five losses of six replaced in ~13 s.
- Engine with no banner: holds. With banner: advances and batters.

---

## Prompt 14 — Sculpting

Give the player the terrain deformation that buildings and fireballs have
used since Prompt 1.

### Build

**Hold Shift.** Left-drag raises, right-drag lowers, **both buttons level**,
wheel sizes the brush. Held key, not a mode. While held it claims the mouse;
camera, hand and creature all test the claim.

**Lock a horizontal plane at the height the stroke began** and re-project onto
it every frame. Raycasting the terrain each frame makes the brush creep toward
the camera as the ground rises.

**Cost** is belief by *area*. Refusals named on a red ring: *outside your
reach*, *the ground under it will not move*, *high enough* / *deep enough*,
*not enough belief*.

**Buildings are protected by masking, not vetoing.** `terrain.deform` and
`terrain.flatten` take an optional list of `{x, z, r}` circles to skip. The
brush runs right up to a wall. Levelling targets the stroke plane and passes a
small per-frame `strength` to `flatten`.

Clear buried flora/scenery, throttled to 5/s. Props re-settle via the
existing `terrain-changed` event.

**Also:** the **Mine** (42 wood, 12 ore, `MINE_RADIUS` 28, `MINE_SPEED` 1.5,
`maxSlope` 0.34) — generalise `nearLumberCamp` to `nearCamp(town, at, flag,
radius)`; expose `workTimeFor` on the villagers API so the bonus is
measurable. The **Manor** (2×2, 8 beds, 58 wood, 18 ore, own window pieces,
**one** roof; rivals build past 14 pop). **Fix the hand**: fingers thicker
and shorter, splay ~8°, wrist smaller than the palm, and tune skin in
`update()` where alignment rewrites the colour every frame.

### Constants

`SCULPT`: `RATE` 9 u/s, `BELIEF_PER_SEC` 6.0 at radius 15, brush 7–34,
height −5…52, `CENTRE_CLEARANCE` 11, `BUILD_CLEARANCE` 1.0.

### Traps

`growInstances` must create and **white-fill** the colour buffer explicitly;
three's lazy allocation zero-fills, and zero is black.

### Acceptance

Raise then lower at the same cursor: centre 7.8 → 18.5 → 9.0, ground 24 units
out untouched. Ten units from a house: slope 0.286 → 0.003, house unmoved.
Mine: 5.50 s → 3.67 s at 9 units, unchanged at 126.

---

## Prompt 15 — A New Island Every Game

Roll the seed per game and build the world from one of five archetypes.

### Build

Archetypes are **ranges**, and the seed picks a point in each. Landmass mask =
**union of N radial lobes**.

| | Lobes | Land | Feel |
|---|---|---|---|
| Highland | 1 | ~39% | the original island |
| Continent | 1 broad | ~58% | flat interior, building room |
| Archipelago | 3–5 | ~27% | deep bays, narrow necks (lobes must touch) |
| Spine | 3–4 in a line | ~26% | ridge with coastal plains |
| Fjordland | 1–2, heavy warp | ~34% | ragged inlets, highest peaks |

`?seed=N` replays; `?island=Spine` forces. Print name and seed under the title.

**Vet every island.** Generate, test for `SITES_NEEDED + 1` viable town sites
(spare site on purpose — the check is a proxy for `pickSites`), reject and
re-roll up to `MAX_ATTEMPTS` 60, fall back to the known-good seed. **Hold the
archetype for the first two-thirds of attempts** or easy shapes crowd out hard
ones.

**Fix greedy siting.** Choose all sites together: widen the band to 0.80 of
half-world and backtrack the first pick if the rest can't be spaced.

### Acceptance

25 runs × 5 archetypes × 5 seeds: three towns every time, no fallbacks.
Average ~6 attempts, ~400 ms. Archetype spread roughly 13–25% each.

---

## Prompt 16 — The People Pray

Turn belief from a tap into a conversation.

### Build

`prayers.js` (sim) + `prayermarks.js` (render). **Prayers command nothing.**
Emits `prayer-raised` and `prayer-resolved`; `miracles.js` pays belief and
alignment. Exactly two read-only queries: `town.growthBlockerOf` and
`town.townAt(x, z)` — two numbers, not a position.

| Category | Raised when | Answered by |
|---|---|---|
| Hunger | food/head < 2.2, or a villager past 0.72 hunger | food miracle or gift dropped in *their* town |
| Peril | health < 0.55, or a raider on them | carried clear by hand or beast |
| Raid | raid declared or siege active | the threat ending |
| Shortage | wood/ore < 25 **and** `growthBlocker` says so | timber/stone set down in reach |

**Bounds**: 1 active per villager, 4 per town, 12 global; `close()` is the
only exit and refuses twice; history ring of 40; cooldowns 90 s per villager,
45 s per town-and-category; sweep backwards. One event resolves at most one
prayer (bounded consumed set).

**Creature**: bounded map of ≤16 prayers within 90 units; `help` multiplier
near an open prayer; emits `resource-offered` on a haul like the hand does.

**Presentation**: spire-and-ring over the requester, gold/orange, shrinks as
time runs out, depth test off, culled past 340, 16-instance cap. `R` toggles
a loudest-first panel; click focuses via `camera.focus`. Quiet toast on
resolve. Villagers get **names**.

**Mercy**: answer +0.045, urgent +0.075 (largest repeatable kindness);
expired −0.018, failed −0.04, ×1.6 urgent. **Neglect sets a floor** that
penance can't lift you above; only somebody *actually coming* resets the
streak (`by: 'nobody'` does not).

### Acceptance

Ten cases: real condition raises; correct town answers; wrong town doesn't;
no duplicate per tick; raid prayer survives one dead attacker; dead requester
invalidates; expiry moves belief once; same event can't resolve twice; caps
hold; resolved leaves active. 20-min soak: raised − (answered + failed +
expired + invalidated + active) = 0. Fifteen minutes ignoring everything
settles at ~−0.55; four answers climb back past neutral.

---

## Prompt 17 — The Divine Reckoning, and the Big Addenda

Score every participant on eight axes, then: scale, collision, ground
shaping, graveyards, a backlog of silent bugs, and a build AI for the player's
town.

### Build

**Reckoning.** `scoreconfig.js` (data), `reckoning.js` (observes only, emits
`score-milestone` and `reckoning-final`), `reckoningui.js`. Teams are town
lineages **snapshotted at init** (`capture()` overwrites `town.colour`).
`Final = Current Power + Historical Legacy + Ending Bonuses − Penalties`.
Current Power recomputed every 0.5 s and *assigned*, never accumulated. Legacy
is event-driven against unique keys. Eight categories target ~1,000 each with
logarithmic compression past target; Military target 700. Achievements score
nothing (account-wide, AI can't earn them); 20 team-neutral Legacy milestones
do. A debug validator recomputes everything from source. Rings: 24 events per
team, 60 timeline. **Continue Playing**: `state.outcome` stays set, sim gate
is `!state.outcome || state.postGame`, `Tab` reopens. Four modes in `MODE`,
`endless` ships.

**Scale.** Everything ~⅓ bigger together: castle 23×28.4, barracks 11.9×24.3,
manor 10.8×15.2, workshop 8.1×14.6, house 7.0×9.5. `TOWN.CENTRE_CLEARANCE`
20, `SCULPT.CENTRE_CLEARANCE` 14, `MIN_SPACING` 6.5.

**The keep is solid.** `town.pushOutOfCentres(x, z, pad)` projects a point
out of any centre circle (gives sliding for free), called from every mover.
`gateOf` returns a threshold point so deposits work. Push in `spawn`.
`walkToward` treats *blocked and not closing* as arrived; `WAR_HOLD` 16.
`Math.sqrt(d2) || 1e-4` does not guard dead centre.

**Placement shapes the ground.** `maxSlope` is where the earth moves, not a
refusal; only `SHAPE_MAX_SLOPE` 0.85 refuses. Pad levelled, then a skirt at
1.9× eased into the hill. Neighbours protected by the Prompt 14 mask list.
`FLATTEN_RATE` 4.0.

**Graveyard.** `graveyard.js` observes `villagers-killed` only. Sited lazily on
flat ground clear of buildings and keeps. Cause-varied stones (`PEACEFUL`
list, violence the default); landmark ladder by *true* toll (lamp, cross,
obelisk, crypt, great crypt, mausoleum at 80); stones capped at 44.

**Backlog.** Starvation goes through `kill(v, 'starved', false)`. Add
`unit-trained` / `unit-lost`. Emit `villager-born` for every town; filter in
`achievements.js`. `refreshPatch` uses one `addUpdateRange` per row and
`rebuildAll` calls `clearUpdateRanges()` first. `colormapFor` derives the pack
from the path.

**Your people build for themselves.** Shared `wantedBuilding(town, allowed)`.
The player's town builds subsistence only (house, farm, paddock, storage, camp,
mine) from a reserve it won't dig into unless homeless or starving; barracks,
manor, workshop stay the god's. No default-to-house for the player.
`chooseJob` returns the least-oversupplied resource. Villagers range to
`FAR_SLACK` before idling.

### Acceptance

30 sim minutes across four seeds validate; bit-stable over five recomputes;
0.0023 ms/tick. Storage demolished: wood still climbs. 20-min soak: 0 keep
intrusions. Land taking a house 40.6% → 77.2%. 709 deaths → 89 grave
instances. Unattended 25 min: alive, 7 → 83 pop, 0 idle.

---

## Prompt 18 — Voice of the World

Add sound. Observe only.

### Build

`soundconfig.js` (clips, gains, cooldowns, radii) + `sound.js` (Web Audio,
pooled `AudioBufferSourceNode`s, never `<audio>`). Hooks are the existing
events; add exactly one, `villager-worked`. Three CC0 Kenney audio packs:
`rpg-audio` for hands and timber (chop, page turns for panels), `impact-sounds`
for things hitting things (`impactBell_heavy` when a town changes hands),
`digital-audio` for the god layer and interface. Recorded foley for the
village, synthesis for magic and UI.

Bounded voice pool 24, oldest stolen. Per-clip cooldowns (`count: 20` deaths =
one sound). Cull before allocating a voice. Autoplay gate: suspended until
first gesture, every call a no-op. Decoding never blocks. Mute persisted.
`MISSING` list in config for loops (wind, sea, forest), horn, fire, creature
call.

### Acceptance

All clips decode; locked audio throws nothing; 200-event storm plays 1; 20
deaths = 1 sound; 30 distant events = 0; real-pace peak ~3 of 24 voices.

---

## Prompt 19 — The Turning Sky

A day cycle, weather, and a civilisation picker.

### Build

`skyconfig.js` + `sky.js`. **It publishes numbers and never reaches in**:
`state.sky.hour`, `.weather`, `.cropMultiplier`, `.isNight`, `.nightness`
(0 by day, 1 in full dark, ramped as a function of the hour).

Seven-minute day through seven keyframes; **noon is exactly the Prompt 1
look**. Night is blue, not black — keep a real key light. Widen the shadow
frustum as the sun drops. Call `terrain.setSunDirection` from sky *before*
terrain updates.

Weather: Clear / Overcast / Rain (crops ×1.6, 900 drops in a fixed pool
following the camera) / Drought (crops ×0.35), one at a time, cross-faded,
seeded, opening clear with a grace period. Touches exactly one number,
`TOWN.CROP_REGROW`, for all towns alike. Fifth prayer category, weather, for
farming towns once drought bites; closes as `by: 'nobody'` when it ends on its
own. Add it to `stats.byCategory`.

Lanterns: build the instanced emissive lantern + additive flame, then ship
with `VILLAGER.TORCH.ENABLED = false` until the flame is ~⅕ the size and
depth-tested.

**Civilisation picker** on the boot screen, 2–5, before generation.
`setCivilisations(n)` writes `TOWN.RIVALS`, `ISLANDS.SITES_NEEDED`,
`TOWN.TOWN_SPACING`, `ISLANDS.SITE_SPACING` together: spacing 260 / 230 /
195 / 165 for 2 / 3 / 4 / 5. `N` reloads for a new island (`R` stays prayers;
check no key is bound twice). Scan configs for non-ASCII.

### Acceptance

`sky.update` ~0.04 ms/frame; rain inside render noise. Clear 0.750, drought
0.262, rain 1.000 crop over the same interval. Five civilisations: 25 islands,
no fallbacks. Playwright can't verify the picker — it lands a trusted click
on it; log `isTrusted`.
