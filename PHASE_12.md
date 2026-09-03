# Phase 12 — New Terrain, and the Kits Come Out

Two requests, and they turned out to be the same job. First: *"I want more out of a
redesign — new terrain also."* Then: *"I would like to use more of the assets in the
castle kit, the fantasy town kit and the nature kit."*

They are the same job because the reason the island looked plain was never the
number of props on it. It was that the ground had one shape everywhere and the
settlements were sheds dropped on a lawn.

---

## Part 1 — Terracing

The island used to be smooth rolling heightfield. It is now cut into steps.

This is the nature kit's own idiom — its whole cliff family exists to build
stepped, blocky dioramas — and it is the biggest change available for the money,
because it changes the **silhouette** rather than the dressing on top of it.

It stays a heightfield, which is the only reason it was affordable at all. Every
system in this game asks the terrain exactly one question, `heightAt`, and none
of them care whether the answer came from a smooth surface or a staircase.
Buildings still flatten, props still seat, villagers still walk, the creature
still pathfinds. Not one system outside `terrain.js` was touched.

```js
const t = y / TERRACE.STEP;
const step = Math.floor(t);
const f = t - step;                        // where we are between two steps
const k = TERRACE.SHARPNESS;
const fk = Math.pow(f, k);
const shaped = fk / (fk + Math.pow(1 - f, k));   // S-curve: steep but FINITE
```

The S-curve is the load-bearing part. A plain `floor()` gives a vertical wall,
and a vertical wall is an *infinite slope* — `maxSlopeIn` refuses to build
anywhere near one and the lighting renders it as a black seam.

### Three attempts, and what each one taught

| Attempt | Change | Result |
|---|---|---|
| 1 | Terrace after the fine detail | Jagged spikes. Stepping noise gives staircased noise. |
| 2 | Terrace before the detail, `STEP 5.2` | Still jagged, **and towns fell 3 → 2** |
| 3 | Terrace before the mountains | Towns back to 3, but **1 flat terrace** across a 240-unit transect |
| 4 | **Broaden the mountains, then terrace everything** | **23 flat terraces**, buildable 65% → **89%** |

Attempt 2 is the one worth remembering: the terracing looked like a cosmetic
change and it silently cost the player a rival, because the risers were steep
enough that town siting could no longer find three valid places on the island.
**Changing the shape of the ground is a gameplay change.** It was caught by
counting towns on every run, not by looking at a screenshot.

Attempt 4 was the fix, and it was not about the terracing at all:

```js
// Two octaves at half the frequency: broad massifs rather than a field of
// fine ridges. Four octaves produced detail finer than a terrace step, so
// stepping the result staircased noise and the terraces never read.
const r = ridged(noise, x * 0.0058 + 50, z * 0.0058 - 50, 2, 0.5, 2.1);
```

You cannot cut a step into something whose own detail is smaller than the step.
Three attempts went into tuning the quantiser when the problem was upstream of it.

### Repainting the ground

The terrain was olive-and-slate under teal-and-orange trees; the two did not
belong to the same island. The palette is now the kit's own `grass`, `dirt` and
`stone`, desaturated a little — the ground is the largest surface on screen and
at full saturation it shouts over everything standing on it.

---

## Part 2 — Scenery

A new system, `scenery.js`. Flora is the small stuff underfoot; scenery is
everything larger the game still does not *reason* about. No physics, cannot be
picked up or harvested, never simulated — which is exactly why it can be numerous.

Two placement moments, and the difference matters:

- **The landscape** (cliffs, landmarks, shore) at startup, because the island
  exists at startup and never changes shape.
- **The town dressing** per building as it goes up, because most of a town does
  not exist yet when the island is generated. `town.js` calls `dressBuilding` the
  same way it already calls `flora.clearAround` — through state, with no import
  between the two systems.

### What went in, from all three kits

| Source | What | Where |
|---|---|---|
| nature kit | 202 cliff outcrops | terrace risers, banded by altitude |
| nature kit | 14 statues, obelisks, columns | high open ground, clear of towns |
| nature kit | canoes, driftwood, flat stones | the beach |
| nature kit | wheat, corn, pumpkins, carrots, dirt rows | **behind every farm** |
| nature kit | fences, bushes, stumps | houses, cattle pens, lumber camps |
| town kit | lanterns, carts, market stalls, stools, fences | ringed on every town square |
| castle kit | rubble, felled logs | town squares |
| castle kit | **pennants on the four corner towers** | mounted, in `makeCastleGeo` |

Cliffs are banded the same way the trees are — earthy low down, stony higher,
bare stone above the treeline — so the rock agrees with the forest about where
the mountain starts.

Trees were also cut by about a third. A 13-unit tree beside a 5-unit house is
botanically defensible and visually wrong, and it only became obvious once the
towns had street furniture to judge them against.

### Cost

| | Before | After |
|---|---|---|
| Draw calls | 107 | **124** |
| Triangles | 975k | **977k** |
| Scenery objects | 0 | **471** |

Seventeen draw calls for the whole thing, because everything added is instanced
and pieces are shared: `log` is both beach driftwood and lumber-camp dressing and
is still one mesh.

---

## Bugs found and fixed

**The same bug, three times, in three costumes.** Every one of them was *sizing a
kit piece by the wrong dimension*:

1. Cliffs sized by `sizeToHeight` → the island was paved in giant flat slabs.
2. Cliffs sized by `sizeToWidth` → the highland became a field of grey tower blocks.
3. `path_stone` and `log` in the dressing tables, sized by height → hexagonal
   paving slabs the size of a house, and driftwood like felled trees.

Scaling is uniform, so whichever dimension you pin, the other two follow the
model's own ratio. There is now **one rule**, applied to everything in scenery
without exception:

```js
/** Uniformly scale so the LARGEST dimension - any of the three - measures `size`. */
export function sizeToMax(geo, size) { … }
```

It guarantees the result fits inside a `size`-cubed box whatever shape went in,
which is what you actually want from a kit you are scattering by the hundred.

**`b.def.id` does not exist.** The per-building dressing table was keyed on it.
`BUILDINGS` entries carry `key`. So the lookup returned `undefined` every single
time and every building in the game — farm, cattle pen, lumber camp — silently
got the generic dressing. It threw nothing and warned nothing; it was found by
printing the building counts and seeing `{"undefined": 14}`.

**Boot order deadlock.** Scenery needs `state.towns` to keep landmarks clear of
settlements; `town.js` needs `state.scenery` to dress each building. Scenery now
runs *after* the town and back-dresses whatever is already standing, which is
also what makes the rivals' opening buildings get their crops.

---

## What I'd do differently

- **A kit is not a bag of props.** Most of a kit's parts are authored for one
  context and are meaningless out of it. `planks` is a floor; `fountain-round` is
  one arc of a basin; `banner-red` hangs off a wall; the town kit's hedges are
  meant to be laid end to end. Scattered on open grass those became a raft, a
  grey disc, a rug and a row of green capsules. **What survives being scattered
  is what already stands on its own legs** — everything else needs to be *mounted*
  by whatever assembles the thing it belongs to, which is why the pennants ended
  up in `makeCastleGeo` and look better there than they ever would have on a lawn.
- **Terrain changes need a gameplay assertion, not a screenshot.** Town count and
  buildable percentage caught a regression that looked fine in a picture.
- **The lowland cliff band almost never fires** — 3 of 202. Low ground is gentle,
  which is realistic, but it means the earthy `cliff_*_rock` pieces are effectively
  unused and the island's rock is all one colour.
- **Scenery is cleared by buildings and by nothing else.** A fireball crater, a
  felled forest or a battle that levels a district all leave the crops and
  lanterns pristine.
- **Still unused**: the 16 bridges and 7 paths. Both need *laying* — a sequence of
  pieces end to end between two points — rather than scattering, and that is a
  real placement algorithm, not another table. A road running from the castle gate
  out to the farms is the single biggest thing left on the shelf.
