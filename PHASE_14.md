# Phase 14 — Sculpting

*"You're a god who can't touch the land."*

The machinery was never missing. `terrain.deform` has been written, tested and
public since Phase 1 — buildings flatten pads with it, fireballs dig craters with
it. The player simply had no way to reach it. This phase is the interface, the
cost, and the rules about what may not be moved.

---

## The tool

**Hold `Shift`.** Left-drag raises, right-drag lowers, the wheel sizes the brush.

Held-key rather than a mode, which is the bargain `Ctrl` already makes for
miracles: nothing to arm, nothing to get stuck in, and the moment you let go you
are back to playing normally. While it is held it claims the mouse, so the left
button digs instead of panning or grabbing a tree and the right button digs
instead of ordering the creature somewhere — `camera.js`, `hand.js` and
`creature.js` all test that claim, the same way they already test each other's.

It costs **belief**, by area rather than radius: a brush twice as wide moves four
times the earth and is charged four times as much, or the big brush would be
strictly better than the small one at everything. Moving the world should be the
most expensive thing a god does.

| Refusal | When |
|---|---|
| *outside your reach* | beyond your influence radius |
| *something is built here* | a building or a town centre is in the brush |
| *high enough* / *deep enough* | at the height limits |
| *not enough belief* | out of faith |

The ring turns red and names the reason rather than silently doing nothing.

Ground under a building will not move. A building sits on a pad flattened to a
baked height with an instance matrix to match — raise the earth under one and it
is buried, lower it and it hangs in the air. Re-seating every affected building
mid-drag is a different feature; refusing is honest and something the player can
see and work around.

---

## The bug that mattered

The first version raycast the terrain every frame to find the cursor. That seems
obvious and is wrong:

> Raising the ground moves the surface **toward the camera**, so the ray starts
> hitting it sooner, so the brush creeps toward the viewer while you hold the
> button.

It carved a ridge running back at you instead of the dome you asked for, and the
longer you held it the further it wandered. It also meant a raise and a lower
from the same cursor position hit different ground — which is how it was caught:
the raise moved the terrain 7.8 → 20.8, and the lower charged belief and changed
nothing at the sample point.

The fix is the trick `camera.js` already uses to pan: lock a horizontal plane at
the height the stroke began and re-project onto that. Grab a plane, project onto
it, and the world stops sliding under the thing you are pointing at.

**Measured after**: centre 7.8 → 18.5 raising, → 9.0 lowering, ground 24 units
out untouched at both ends. Same place, both directions, correct falloff.

---

## A black-silhouette bug, inherited from an hour earlier

Twenty prop instances were rendering as **solid black polygons** — visible on a
fresh load with no interaction. It looked like a shadow artifact.

It was `growInstances`, written earlier the same day for the instance-capacity
work. Copying colours with `getColorAt`/`setColorAt` lets three allocate the
colour buffer lazily, sized to the new capacity and **zero-filled** — and zero in
a colour buffer is black. Every instance written after a growth was black.

The tell was that the black indices were always a *contiguous run starting
exactly where the mesh had last grown*: rock4's blacks were 98–111, and 98 was
its last growth point. The buffer is now created and white-filled explicitly
rather than left to three's internal behaviour.

Verified at zero black instances across 40 buildings and full prop growth. It
would have hit buildings too — every house past the twenty-fourth.

---

## Tunables

All in `SCULPT`. `RATE` 9 units/sec at the brush centre, `BELIEF_PER_SEC` 6.0 at
the starting radius of 15, brush 7–34, heights clamped to −5…52 so you cannot
raise a spire into the fog or dig through to the seabed. `CENTRE_CLEARANCE` 22
around any town centre, because a castle is not in `allBuildings` — it has its
own mesh and its own slot, and checking only that list left every keep in the
game sitting on ground the player could pull out from under it.

Sculpting clears the flora and scenery it buries, throttled to five times a
second — clearing walks every instance of every decorative mesh, and doing that
per frame to hide grass is a poor trade. Props re-settle on their own: `deform`
already emits `terrain-changed`, which `props.js` has listened to since Phase 1.

---

## Also in this phase

### The Mine — +50% to working stone

The lumber camp's bargain, for ore. A mine digs nothing itself; it makes whoever
is swinging a pick within `MINE_RADIUS` work `MINE_SPEED` faster. Siting is the
whole decision, exactly as with the camp: a mine in the middle of a boulder field
speeds up every pick in it, one next to the town hall speeds up nothing.

`nearLumberCamp` became `nearCamp(town, at, flag, radius)` rather than being
copied — the two buildings are the same idea with different nouns.

Three deliberate differences from the camp:

- **Radius 28, not 34.** Ore clusters where the rocks are; trees carpet whole
  hillsides. The same radius would have covered a rival's entire quarry from one
  building.
- **Priced mostly in timber** (42 wood, 12 ore). Charging much ore for the
  building that produces ore is a bootstrap problem that reads as a bug.
- **`maxSlope` 0.34** — the steepest in the catalogue. A mine belongs in a
  hillside, and the ore it exists to speed up is scattered over exactly the
  slopes every other building refuses.

**Measured**: an ore node 9.2 units away drops 5.50s → 3.667s, a **1.50×**
speedup. A node 126 units away is unchanged at 5.50s. Chopping wood beside the
mine is unchanged at 4.00s.

Getting that measurement took two goes, and the first was a bad test. Timing ore
income for 40 seconds with and without a mine said the mine made things *worse* -
because I had zeroed ore to start, so villagers mined hard to hit the target,
then reassigned once it was met, and building three mines cost 36 ore and 126
wood. **The economy swamped the mechanic by a factor of three.** `workTimeFor` is
now on the villagers API for exactly this reason: a work-camp bonus cannot be
seen from the outside.

### The Manor — eight beds

Two storeys on a 2x2 footprint with shuttered windows, timber framing and one
roof spanning the whole thing, at 58 wood and 18 ore. Rivals build them past 14
population, so their towns get grand too.

It took two corrections. Two bays wide and one deep stretched to 12.3 tall
against 4.5 deep, because `fit` normalises on WIDTH - a tower, not a house. And
built from the house's four blank walls with a point-roof per cell it read as a
warehouse; it needed its own window pieces and **one** roof over the whole
footprint. Four pitched roofs on a 2x2 is a row of sheds.

### The hand stopped being creepy

Reported as *"the fingers are long and creepy"*, and there were three faults.

The fingers were **half the thickness they should be** relative to the palm -
four of them came to half the palm's width - and splayed at twenty-three degrees
where a relaxed hand splays about eight. That is a spider. They are thicker,
shorter and barely splayed now, with the mitten risk handled by a hair of
daylight and shading rather than by fanning them out.

The **wrist was the largest object on screen** from the usual overhead angle,
with the palm sitting on top of it: the whole thing read as a mushroom.

And the skin was **clipping to white**. The material's `color` turned out to be
dead code - `update` rewrites it every frame from alignment, and the neutral
value was a bright tan with a strong red emissive on top. Under a 2.35-intensity
sun with ACES that is white, and a white blob has no shading left to describe
form with, which is why no amount of reshaping fixed the fingers on its own.
There is now a note at the base material saying where to actually tune it.

---

## Levelling — added after the fact

Reported as *"I need to be able to flatten the land better so I can place
buildings"*, which is the gap this phase's own notes had already identified:
raise and lower shape a landscape, but the tool you actually reach for before
building is one that makes ground level, and `terrain.flatten` had existed since
Phase 1 for exactly that.

**Shift + both buttons levels.** That is the same "third gesture" the camera
already uses for orbit, and it reads without a legend: left raises, right lowers,
both flatten.

Two things made it fit rather than bolt on:

- **The target height is the stroke plane.** The plane locked at the start of a
  stroke to stop the brush drifting is, it turns out, exactly the height you were
  pointing at — so levelling converges on the ground where you pressed, and needs
  no separate concept at all.
- **`terrain.flatten` gained a `strength` argument**, defaulting to 1. Buildings
  still get their pad in a single call, which is what a foundation is; the brush
  passes a small per-frame slice so levelling costs time and belief, and so you
  can stop half way and keep a slope.

The ring turns pale while levelling and the HUD names the mode.

### Levelling up to a wall

The first version protected buildings by refusing the whole stroke whenever the
brush came near one — a keep-out of brush radius plus pad plus clearance, which
worked out at about **20 units around a hut**. Reported immediately, and fairly:
*"levelling near an existing building should level right up to it"*. Beside your
own houses is precisely where you want to level, and that was the one place you
could not.

Buildings are now protected by **masking the ground instead of vetoing the
stroke**. `terrain.deform` and `terrain.flatten` take an optional list of
`{x, z, r}` circles and skip those cells. Terrain has no idea what a building is
and does not need one — it is handed circles.

So the brush runs right up to the wall, the earth under the foundation never
moves, and the only refusal left is aiming *squarely at* a building, which says
so: *"the ground under it will not move"*. `CENTRE_CLEARANCE` came down from 22
to 11 and `BUILD_CLEARANCE` from 2.5 to 1.0, because these are now skirts around
the building rather than keep-outs for the brush.

**Measured** ten units from a house — inside the old keep-out entirely: stroke
allowed, slope **0.286 → 0.003**, foundation height unchanged, building unmoved.

**Measured** on ground a manor refused: slope **0.206 → 0**, `"ground too steep"`
→ `"OK — buildable"`, manor placed, **3 belief** for the site.

---

## What I'd do differently

- **Buildings refuse rather than re-seat.** Being able to terrace a hillside and
  have the houses ride up with it is the version you actually want. It needs the
  instance matrix, the stored pad height and the props around it all updated
  together, which is a phase and not a footnote.
- **No undo.** Belief is spent and the ground is changed, and a misplaced drag is
  paid for twice.
- **Height-banded colour makes a raised dome go grey**, because the palette
  treats altitude as rock. Raising a small hill near a beach gives a pale scar
  rather than a green hill, which is correct by the rules and wrong to the eye.
