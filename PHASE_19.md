# Phase 19 — The Turning Sky

The sun had been nailed to one spot since Phase 1 — `SUN_DIR` at roughly
sixty-five degrees, chosen because anything lower cast huge dead-black valleys
across half the island. It never moved. Every game looked identical at minute one
and minute forty.

Now the sky turns, and there is weather under it.

---

## The shape of it

| | |
|---|---|
| `skyconfig.js` | Keyframes, weather table, rain. Pure data, imports nothing. |
| `sky.js` | Owns the clock and the weather. Simulation at 20 Hz, painting on the render clock. |

**This is the first system in this project that is not purely an observer.** It
owns state that other systems read, and that needed an explicit rule, because
"everything reads the weather" is how a codebase turns into mud:

> **It publishes numbers. It never reaches into another system.**
> `state.sky.hour`, `.weather`, `.cropMultiplier`, `.isNight`. Systems that care
> read them the way every system already reads `terrain.heightAt`. Nothing is
> pushed, and `sky.js` imports no gameplay system.

---

## The day

A seven-minute cycle through seven keyframes — night, dawn, morning, noon,
afternoon, dusk, night. Everything between two of them is interpolated: the sun's
colour and intensity, its elevation and bearing, the hemisphere bounce, the fog,
and the sky shader's three stops.

Noon is deliberately **the game exactly as it looked in Phase 1**. Everything
else is a departure from it.

### Night is blue, not black

The whole design risk of the phase. A god game you cannot see is not
atmospheric, it is broken — so night keeps a real key light and a lifted
hemisphere, and only the mood changes.

Verified where it actually matters, at the darkest combination the game can
produce — **dusk in the rain, sun at 0.463** — by looking at it rather than by
reading a number. The castle, the coastline, the trees and the creature all read
clearly, with rain streaking across the scene. A number could not have answered
that question.

### Two things that had to move with the sun

**The shadow frustum.** `sun.shadow.camera` was fitted tightly to the island,
which is correct for a fixed high sun and wrong the moment it moves: a low sun
throws shadows several times longer than the thing casting them, and a tight
frustum clips them mid-hillside. It now widens as the sun drops, so noon keeps
the crisp shadows it has always had.

**The water's specular**, through `terrain.setSunDirection` — the entry point
that already existed for it. The sky updates before terrain in the render loop,
because painting the sea with last frame's sun is a seam you can see at dusk.

---

## The weather

Four states on a bounded machine — one at a time, with a cross-fade, never a hard
cut. Seeded like everything else, so a given seed gives a given sky.

| | Look | What it does |
|---|---|---|
| Clear | as before | nothing |
| Overcast | flatter, greyer, desaturated | nothing |
| **Rain** | dark, fogged in, 900 drops | **crops ×1.6** |
| **Drought** | bleached, hard light | **crops ×0.35** |

**Two of the four have teeth, and they reach exactly one number** —
`TOWN.CROP_REGROW`, through a multiplier the town reads. That is the entire
mechanical footprint. Weather that changes everything is weather nobody can plan
around.

Measured: clear 0.750, drought 0.262, rain 1.000 over the same interval.

A drought is **a slow famine you can see coming**, which is a far better problem
than one that simply happens. Rivals are on the same multiplier — a drought that
only touched the player's crops would be the fairness bug Phase 17 spent a whole
phase rooting out, arriving by the front door.

**A new game always opens clear**, with a grace period. Rolling a drought at
second zero would start a match already failing before the player had done
anything.

---

## The prayer Phase 16 refused

That phase was explicit, and right at the time:

> Weather is **deliberately absent**. There is no weather, season or crop-failure
> state in this game, and the brief was explicit about not inventing one to hang
> a category on.

There is now, so the fifth category is honest. *"The fields are dying. Send us
rain."* It only rises for a town that actually farms, and only once the drought
has run long enough to bite — praying the instant the sky turns would be noise.

**And the sky does not earn the player credit.** When a drought simply ends, the
prayer closes as answered by `nobody`. Phase 16 learned this exact lesson and
wrote it down: `miracles.js` pays belief and mercy for anything else, and the
neglect streak resets on it, so crediting the player for weather they had no hand
in would be paying them for waiting. Feeding a town *through* a drought does
answer it, and that one is the player.

---

## Bugs this phase produced

**Two winners' worth of credit.** The first version closed the drought prayer
with `by: 'rain'`, which reads as somebody having come — paying belief, paying
mercy, and resetting the neglect streak for a cloud.

**A statistic that would have been silently NaN.** `stats.byCategory` in
`prayers.js` declares its four categories up front, and adding a fifth without
adding it there turns every count into `undefined + 1`. Caught because the test
printed the table and `weather` was missing from it.

**A corrupted hex literal.** A colour keyframe came out as `0xe0a храм` while I
was writing the config — caught by scanning the file for non-ASCII rather than by
waiting for it to fail somewhere confusing.

---

## Performance

| | |
|---|---|
| `sky.update` | **0.038 ms/frame** |
| `sky.simStep` | **0.0004 ms/tick** |
| Render, dry | 0.9 ms |
| Render, 900 rain drops | **0.8 ms** — inside the noise |

Rain is a fixed pool recycled in a box that follows the camera: `RAIN_DROPS` *is*
the instance count, always, whatever the weather is doing, so the worst case is
the only case.

A 25-minute soak passed through all six phases and three weathers, the town grew
7 → 83 with food climbing throughout, and the reckoning still validates.

---

## Deferred

- **No seasons.** A day cycle is enough for a match of this length.
- **Standing lamps are still unlit.** The graveyard's lightposts and the town
  kit's lamps do not glow. The villagers' own lanterns landed (below); the
  fixed ones want the same emissive treatment and have not had it yet.
- **No ambient loops**, still. Phase 18's one gap, and rain now has a visual
  with no sound to go under it. That remains a nature pack away.


---

## Addendum — the people carry lanterns *(built, then switched off)*

Phase 19 gave the island a night and lit it only from the sky. A crowd moving
through the dark with nothing in their hands reads as a crowd that cannot see,
so after dusk every villager who is awake carries one, and the village becomes a
scatter of moving lights.

`lantern-candle` from the graveyard kit — a hand lantern that was already sitting
there unused. Held in the off hand, so somebody carrying a load carries both.

**Two instanced meshes for the whole population, and not one real light.** The
lantern is the kit piece made emissive; the flame is a small additive sphere,
each breathing on its own offset so a hundred of them do not pulse in unison.
Eighty shadow-casting point lights would have ended the frame budget, and under
ACES an emissive this bright reads as a flame anyway.

**Measured cost: zero.** Render p50 0.40 ms with 28 lanterns lit, 0.40 ms with
them hidden — two extra draw calls, inside the noise.

### The bug this turned up

The first version eased `lanternLit` toward `isNight` by a fixed step per frame.
But `syncRender` is handed an interpolation alpha and **no delta time** — so the
step was hardcoded against an assumed 60 Hz, and lanterns would have come up
more than twice as fast on a 144 Hz monitor.

The fix belonged in the sky rather than in a timer here: `sky.nightness` is 0 by
day, 1 in full dark, ramped across dusk and dawn as **a function of the hour**.
Frame-rate independent by construction, and the next thing that wants to fade
with the dark — lit windows, the standing lamps — reads the same number instead
of keeping its own clock.


### ...and switched off again

It engulfed them. The numbers say why plainly, and I should have run them before
building it:

| | |
|---|---|
| Villager | `BODY_HEIGHT 1.5 x SCALE 1.5` = **2.25 units tall** |
| Flame | sphere radius 0.5 x `GLOW_SIZE 1.5` = **1.5 units across** |

An orange ball two thirds the height of the person — and drawn additively with
`depthWrite: false` and `renderOrder: 6`, so it painted **over** the body instead
of being occluded by it. Not a lantern; a halo with someone inside it.

`VILLAGER.TORCH.ENABLED` is now `false`. The lantern mesh, the hand placement and
`sky.nightness` all stay — the placement was never the problem. Bringing them
back needs the flame at roughly a fifth of that size and **depth-tested**, so the
villager occludes it. The note is in `villagers.js` beside the switch.

**The lesson, and it is not a new one for this project:** I checked the flame
against the *scene* and never against the *villager*. The same mistake as sizing
the barracks against its own drill yard — a number that looks reasonable until
you compare it to the thing it sits next to.


---

## Addendum — how many civilisations

Asked on the boot screen, **every time**, before the island is generated. Two to
five: you and one rival, up to you and four.

It has to be asked first and it cannot be changed later. The terrain is raised
and then *vetted* for a specific number of settlements, so by the time there is a
world the answer is already baked into it — an island cannot gain a civilisation
afterwards, because there may simply be nowhere to put one.

### One number moves four

`setCivilisations(n)` is the only place any of these are written:

| | |
|---|---|
| `TOWN.RIVALS` | how many towns are founded |
| `ISLANDS.SITES_NEEDED` | how many the island is vetted for |
| `TOWN.TOWN_SPACING` | how far apart town.js places them |
| `ISLANDS.SITE_SPACING` | how far apart the check believes they need to be |

Letting any one lag is the Phase 12 regression exactly: an island vetted for
three towns that then has to host five does not fail loudly, it **silently hands
the player fewer rivals than they asked for**.

### Spacing shrinks as the count rises, and the geometry says by how much

Sites are searched inside a radius of about 256, and N points spread evenly in a
circle of radius R sit `2R·sin(π/N)` apart at best:

| Towns | Theoretical best | Spacing used |
|---|---:|---:|
| 2 | 512 | 260 |
| 3 | 443 | 230 |
| 4 | 362 | 195 |
| 5 | 301 | 165 |

Those ceilings assume a perfect disc of usable land; a real island is a fraction
of it, so each spacing sits well under its ceiling. Verified at five: 25 islands
rolled, **none fell back** to the known-good map, median 1 attempt, worst 43 of
the 60 allowed.

### Two bugs this turned up

**`KeyR` was bound twice** — once to open the prayers panel and once, forty lines
lower in the same function, to regenerate the island. Both fired on the same
press, so **every time anyone opened their prayers the island was quietly rebuilt
underneath them.** It went unnoticed because the old regenerate only swapped the
heightmap while the towns stayed put. New island is `N` now.

**And that regenerate was wrong anyway.** It raised a fresh island *under*
standing towns, whose pads are flattened to a baked height with an instance
matrix to match — so they kept their old altitude while a new coastline appeared
around and through them. `N` does a full reload, which also means every new map
asks the question again.

### A note on testing this

The picker cannot be verified through the Playwright harness: its virtual mouse
lands a **trusted** click on whichever button appears under the stale cursor,
about 1.2 seconds in. Two runs answered 5 and then 2 without any instruction.
That is the "test the real input path" lesson inverted — here the automation was
*generating* the input. Proven by logging `event.isTrusted`, which is exactly
what that flag is for.
