# Phase 2 — Town and Economy

Builds on Phase 1. Same stack, same rules: no asset files, systems talk only
through `state`, sim on a fixed 20 Hz clock with interpolated rendering.

---

## What was built

**Town centre.** Sited at boot by scoring ~4000 candidate points for local
flatness, and — importantly — by sampling a ring at building range and rejecting
anything less than 80% dry land. The first version scored on slope alone, picked
a flat beach every time, and then half the buildable ring turned out to be sea.
A 30-unit pad is levelled under it so the player's first buildings have
somewhere to go.

**Influence radius.** Grows with population (`BASE + pop × PER_POP`, capped) and
eases toward its target rather than snapping. Rendered by patching the terrain's
own `MeshStandardMaterial` through `onBeforeCompile` — a distance-field ring
computed per fragment against the town centre. That means it follows every fold
of the ground exactly, with no decal mesh, no z-fighting and no extra draw call.
Building and (later) casting are gated on it.

**Resources and buildings.** Food, wood and ore, with a four-entry building
catalogue in `state.js`. Each building is an InstancedMesh built from primitives,
so the whole town is four draw calls regardless of size. Placement levels a pad
via a new `terrain.flatten()`, deducts the cost, and clears any props standing
in the footprint.

**The Phase 1 props became the economy.** Trees are felled for wood and stone is
broken for ore — the same grabbable objects you can already pick up and throw.
Harvested nodes shrink away over 0.7s and then stop being pickable, physical or
findable. Food comes from farms the player places, which regrow their crop so
food is a renewable trickle rather than a one-off harvest.

**Villagers.** Up to 150 agents in two InstancedMeshes (body plus the bundle they
carry), driven by a small state machine:

```
idle -> seek -> gather -> deliver -> idle
idle -> wander            (nothing to do)
any  -> eat               (hunger past threshold)
any  -> sleep             (energy spent)
```

Job choice is a simple utility score over how short the town is of each resource,
weighted so food dominates when the larder is thin. Villagers claim a node before
walking to it so twelve of them don't converge on one tree. They refuse to wade —
if the next step is underwater they abandon the destination. Needs run 0..1;
prolonged starvation with an empty store kills them. Walk animation is a bob plus
a roll about the forward axis, since instanced meshes can't be skinned.

**Build mode.** `B` opens an SVG radial menu with four wedges showing cost and
affordability. Picking one starts placement: a translucent ghost follows the
cursor, green when valid and red with the specific reason when not (too steep,
outside influence, too close to another building, in water, can't afford).
Shift-click keeps the tool active for laying down a row. While placing, build
mode claims the pointer so the hand can't grab and the camera can't pan.

**Verified in-browser**, driving the real event path rather than calling
internals: `B` opens the menu, clicking the House wedge starts placement, the
ghost validates, a click places the building and deducts exactly 20 wood, and the
hand correctly does not grab through the ghost. A 4-minute headless sim run took
food 30 → 75 with one farm, wood 60 → 408, and grew population 8 → 12 until
housing capped it. 60 fps, 35 draw calls, 323k triangles.

---

## Tunable constants

All in `src/state.js`, alongside the Phase 1 block.

| Constant | Value | Effect |
|---|---|---|
| `TOWN.BASE_INFLUENCE` / `INFLUENCE_PER_POP` | 52 / 1.35 | Starting territory and how fast it grows. This is the main progress dial. |
| `TOWN.MAX_INFLUENCE` | 190 | Ceiling, so one town can't swallow the island before Phase 5. |
| `TOWN.GROWTH_INTERVAL` / `GROWTH_FOOD_COST` / `GROWTH_FOOD_RESERVE` | 14s / 12 / 20 | Birth rate, its price, and the surplus that must remain afterwards. |
| `TOWN.CROP_REGROW` | 0.075/s | Farm output. One farm feeds roughly 6–8 villagers. |
| `TOWN.START_POP` / `START_WOOD` | 8 / 60 | Opening position. 60 wood buys exactly a farm and two houses. |
| `TOWN.START_FOOD` | 48 | Must stay clearly above `GROWTH_FOOD_RESERVE + GROWTH_FOOD_COST` (32) or a new town can never grow at all. |
| `TOWN.MIN_SPACING` | 5.5 | Baseline gap between buildings, before their pads are added. |
| `BUILDINGS.*.cost / pad / maxSlope` | — | Per-building price, levelled area, and how steep a site it tolerates. |
| `VILLAGER.SCALE` | 1.5 | Villagers are drawn larger than life; at true scale they're a few pixels. |
| `VILLAGER.WALK_SPEED` | 5.0 | Also scales with energy (0.65–1.0×). |
| `VILLAGER.CHOP_TIME` / `MINE_TIME` / `FARM_TIME` | 4 / 5.5 / 5 s | Work time per node. |
| `VILLAGER.WOOD_PER_TREE` / `ORE_PER_ROCK` / `FOOD_PER_HARVEST` | 8 / 6 / 10 | Yields. |
| `VILLAGER.HUNGER_RATE` / `ENERGY_RATE` | 0.0125 / 0.0085 per s | Need decay. Hunger reaching the eat threshold takes ~58s. |
| `VILLAGER.HUNGER_EAT_AT` / `ENERGY_SLEEP_AT` | 0.72 / 0.18 | When needs interrupt work. |
| `VILLAGER.SEARCH_SLACK` | 12 | How far past the influence edge a villager will go for a job. |
| `VILLAGER.IDLE_RETRY` | 0.8s | Idle re-evaluation rate; spreads job-search cost across ticks. |

---

## Bugs found and fixed during the build

1. **Every villager fell asleep permanently.** `move()` early-returned when state
   was `sleep`, so a villager who decided to go to bed could never walk to the
   bed, never arrived, and so never recovered energy. Within 90 seconds the
   entire population was frozen. Arrival now clears the destination instead, and
   a separate `resting` flag drives the lie-down pose.
2. **The town centre kept landing on a beach.** Scoring on flatness alone made
   sand the best site on the island. Added a land-fraction test over a sampled
   ring plus a minimum height.
3. **Nowhere to put the first farm.** The pad was levelled over radius 16 but
   `flatten` only held truly flat out to 45% of its radius, and building is
   blocked within 9 units of the centre — leaving almost no level ground in the
   legal band. Widened the pad to 30 and the flat core to 65%. Usable farm sites
   in the inner ring went from a handful to 71 of 108 sampled positions.
4. **Escape leaked the input capture.** Placement claims the pointer every frame,
   and that claim is normally released on pointerup. Cancelling with Escape
   involves no pointer event, so the hand and camera stayed dead permanently.
5. **The influence ring was invisible.** The shader injection compiled correctly,
   but the rim was a ~2 unit band added *after* tone mapping — a couple of pixels
   at gameplay zoom. Widened to ~10 units and rebalanced.

### Later revision — building houses did nothing

Reported during Phase 4 play: "why doesn't the population increase with the
houses?" Measured, and it was a genuine trap rather than a misunderstanding.

A birth needs `food >= GROWTH_FOOD_RESERVE + GROWTH_FOOD_COST`, which is **32**.
`START_FOOD` was **30**. A fresh town was therefore two food short of ever
growing — and since farms are the only food source, an eight-villager town could
only fall further behind. Building six houses produced 28 empty beds, zero
births, and then starvation deaths:

| Time | Pop | Food | Beds free |
|---|---|---|---|
| 0s | 8 | 30 | 28 |
| 60s | 8 | 22 | 28 |
| 180s | 8 | 10 | 28 |
| 300s | 6 | 4 | 28 |

Two fixes. `START_FOOD` raised to 48, so a new town can grow a couple of times
on its opening stockpile and *then* needs a farm — which teaches the mechanic
instead of silently gating it. And `town.growthBlocker()` now reports what is
actually holding growth back, surfaced in the HUD where the pop readout is: the
bare "8/28 pop" implied a housing limit at precisely the moment the real problem
was an empty larder, which is the most misleading thing the economy could have
said.

The loop now alternates legibly: blocked on **housing** at the start → build
houses → blocked on **food** → build a farm → blocked on **housing** again.

---

## What I'd do differently

- **Villagers walk through everything.** There's no obstacle avoidance and no
  prop-vs-agent collision, so they stroll through tree trunks and each other. At
  this zoom it mostly reads as fine, but a boulder thrown into a crowd in Phase 3
  should squash people, and that needs a broad-phase grid the agents also consult
  for steering.
- **Job search is O(props) per idle villager.** Throttled to every 0.8s and
  staggered, so at 150 villagers × 576 props it's still cheap, but it's the first
  thing that will bite when Phase 5 adds three more towns doing the same thing. A
  spatial hash over resource nodes is the fix, and it's the same structure the
  collision work needs.
- **No resource regrowth for wood or ore.** Trees and stone are finite: strip the
  island and the economy stops permanently. That may even be the right pressure
  for a god game, but it should be a decision rather than an omission — a slow
  sapling respawn inside influence is a two-line addition.
- **`state.js` is getting long.** The constants block is now most of the file.
  Splitting into `tuning/` per-system files would keep it readable, though having
  every dial in one place is genuinely useful while hand-tuning.
- **The town centre can't be moved or destroyed**, and there is no building
  removal at all. Phase 4's fireball will need both, so a `demolish()` that
  refunds partial cost and re-runs the influence calculation is coming anyway.
- **main.js now names five systems in two places** (sim order and render order).
  As predicted at the end of Phase 1, this wants a small registry. I left it
  explicit for one more phase because the ordering constraints between town,
  hand and camera are subtle and worth keeping visible.
