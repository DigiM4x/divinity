# Phase 8 — It Sustains Itself

**Status: complete.** The world can now be left running.

This is the first act of what was going to be one enormous phase covering
everything left over from Phases 1–7. Split deliberately: this act is about the
world surviving indefinitely, and nothing in it is a new toy. Acts 2 and 3 — the
creature learning from consequences, legibility, and an actual ending — are
Phases 9 and 10.

The theme turned out to be sharper than intended. **Three of the four things
fixed here were the same bug wearing different clothes: a list that only ever
grew.**

---

## The lifetime caps

`MAX_SOLDIERS` and `VILLAGER.MAX` both read as concurrent limits. Neither was.
Dead entries were never removed from either array, so both were really caps on
*how many had ever existed*, and every long game walked into them.

**Soldiers.** Past 120 men ever trained, `spawnSoldier` returned null forever and
no town could raise another soldier. It never announced itself — training simply
stopped working. It had already silently swallowed 25 spawns in one of my own
Phase 7 tests, which I noted at the time and did not chase.

**Villagers, which was much worse.** Past 150 people ever born, every town in the
world was permanently barren. Worse than the soldier version because it stopped
*births*, and worse again because it lied about why: `growthBlocker` reported
`housing`, since housing capacity was genuinely fine and the real ceiling was
invisible to it. A 40-minute game hit it every time.

The measurement that exposed it: a town gutted from 64 to 20 by a raid, left to
recover for **400 seconds** with 113 houses standing and 182 food in store, which
did not grow by a single person. The array held **150 slots: 36 alive, 114
corpses.**

Both are now compacted in place each tick — in place rather than reassigned,
because both arrays are handed out on their module's api and other systems hold
the same reference. Nothing indexes either by array position; the instanced
meshes rebuild their counts every frame.

Compacting villagers forced one related change: ids must not be reused. Props
record `claimedBy = v.id`, so a recycled id could let a live worker release, or
be blocked by, a claim that was never theirs. Villagers now take ids from a
monotonic counter rather than from their array position.

**Measured**, 45 minutes unattended: the villager array peaks at **149 of 150 and
never hits the ceiling**, every entry in it is alive, **381 distinct people
lived**, and towns are still growing at the end — one reaching 111.

---

## The farm cap fought recovery

`ceil(pop / 6) + 1` allowed fewer farms to a town whose population had just been
cut down, so the cap resisted recovery from exactly the disaster that caused it.

Farms are now allowed per **bed** rather than per head
(`TOWN.FARMS_PER_CAPACITY`). Houses survive a raid; the right to feed the people
who will refill them survives with them. Verified: a town cut from 64 to 20 keeps
all three of its farms through the crash.

---

## Forests come back. Stone does not.

Trees and stone were finite, and with towns now reaching 111 people the map
genuinely stripped.

A felled tree leaves a stump that sprouts again after `REGROW.DELAY` and takes
`REGROW.TIME` to reach full size. It regrows **exactly where it grew**, by
reviving the same prop — the instance slot is still there holding a zero-scale
matrix — so the forest recovers its own shape and no allocation happens at all.
Growth reuses the wear channel from Phase 7 in reverse: a sapling is a tree at
full wear, and it grows by wearing back down to nothing.

**Saplings are invisible to woodsmen** until they are three-quarters grown.
Without that, a regrowing forest becomes a treadmill that never actually
recovers, because a villager will happily walk out to chop a shoot.

**Stone is deliberately final.** Quarried land stays quarried, which is what
makes ore the thing worth going to war over rather than a renewable both sides
can simply wait out.

**Measured**: felled → dead → sprouts at 48s → sapling at 0.46 of full size,
ignored by woodsmen → 0.75 half way → full size, harvestable again, standing
exactly at its old spot, while the rock felled beside it stays gone. Across 45
unattended minutes the forest holds at **249–321 trees against 319 at the
start**, with two towns logging and a third at war.

---

## The event bus has a schema

Payloads were loose bags of whatever the emitter felt like attaching. That is how
the same bug happened twice: `byPlayer` went missing from an emit, alignment
defaulted to blaming the player, and you were charged for a massacre a rival
committed in your own streets. Neither time did anything complain — the field was
simply `undefined`.

Required fields are now listed per event, and a missing one is a console warning
at the moment of the emit, naming the event and the field, in development only.
It costs one loop over three strings.

**It paid for itself immediately.** Switching it on produced 53 warnings across a
40-minute run, from **six emit sites** that had never carried attribution at all:
the creature's ordinary eating and attacking, fireball, lightning, and a villager
crushed by a thrown prop. Every one happened to be a genuine player deed, so the
behaviour was correct *by accident* — they were relying on the default rather
than stating the fact. All six now say so. The run is clean.

---

## Tunable constants

| Constant | Value | Effect |
|---|---|---|
| `REGROW.DELAY` | 50s | How long a stump lies dormant before sprouting. |
| `REGROW.TIME` | 70s | Sapling to full size. |
| `REGROW.HARVESTABLE_AT` | 0.75 | How grown a tree must be before a villager will walk to it. |
| `TOWN.FARMS_PER_CAPACITY` | 6 | Beds per farm allowed. Keyed to housing, never to current population. |

---

## Afterword — the island grew

Done after the phase proper, before starting Phase 9.

`WORLD.EXTENT` 420 → 640: **about 2.3x the land**. Terrain noise is sampled in
world coordinates rather than normalised ones, so this makes genuinely more
island — more bays, more mountains, at the same feature size — instead of
scaling one island up.

Four things had to move with it, and one of them was not obvious:

- **`WORLD.SIZE` 256 → 384.** These two together set `CELL`, the world distance
  between heightmap samples, and `CELL` is what decides whether ground looks
  carved or faceted. Growing the island alone would just stretch 256 samples
  over half again as much ground. Held at 1.67 units per sample, identical to
  before; the cost is 293k triangles against 130k.
- **Scatter counts scale with AREA, not extent**, or a bigger island is a barer
  one: 340/210/26 became 790/490/60.
- **`TOWN_SPACING` 150 → 230**, so three towns spread across the island instead
  of huddling in the middle. Measured gap between the nearest pair: 238.
- **Instance capacities**, which is the one that bit.

### Two buffer overflows

Raising the scatter counts immediately produced
`GL_INVALID_OPERATION: Vertex buffer is not big enough for the draw call`, from
deep inside ANGLE, pointing nowhere near the cause. The prop meshes had
hardcoded per-variant capacities — 160 trees each for three variants, sized for
the old 340 — and 790 trees do not fit in 480 slots. They are now **derived from
the scatter budget** with headroom, so the next resize cannot repeat it.

Chasing that turned up a second one that had nothing to do with the island.
Buildings reserve `CAPACITY` instances per type, shared across all towns, and it
was **64** — while a rival in a Phase 8 test had reached **113 houses**.
Measured directly: a mesh reporting `count: 97` against a buffer of `64`. WebGL
does not throw for this; it logs from inside ANGLE and renders garbage, so it
had never announced itself. Capacity is now 256 **and** `place()` refuses rather
than overflowing, because any fixed cap is eventually reached and a refusal the
player can read beats silently corrupting the draw.

**Measured after**: 60fps median (16.7ms), 32 draw calls, no instanced mesh over
its buffer, no console warnings.

### The edge of the world

Raising the zoom limit to match the island brought the seam into frame: the
terrain is a finite plate, so past its boundary you see water over nothing
instead of water over seabed, and the join is a straight line.

Sinking the rim into deep water improved the framing but could not remove it —
that seam is the plate ending, not a depth problem. Only extending the plate
past the horizon would truly fix it, and that is vertices spent on ocean nobody
plays in. So `MAX_DIST` stops at 430 instead of 520: the whole island frames
comfortably, and the edge of the world stays just out of shot. **It is still
faintly visible in the far corners at maximum zoom-out**, and that is a known
limit rather than a solved problem.

---

## What I'd do differently

- **I found the soldier version of this bug in Phase 7 and wrote it down instead
  of fixing it.** The note even said it was "a slow fuse". The villager twin —
  strictly worse, since it sterilised the world — was sitting in the same shape
  of code the whole time, and one grep for the pattern would have found it. A
  bug worth documenting is worth checking for siblings.
- **`growthBlocker` lied.** It reported `housing` when the real cause was a full
  villager array, because it only knows the reasons it was taught. A diagnostic
  that returns the first matching reason from a fixed list will confidently
  misattribute anything outside that list, which is worse than returning
  "unknown".
- **Hardcoded capacities are the same bug as the growing lists.** Both are a
  number that silently stops being true. The lists announced it by refusing to
  spawn; the buffers announced it by rendering garbage through a WebGL warning
  that names a file in ANGLE. Every fixed capacity in this codebase should
  either be derived from what fills it or guarded at the point of use, and now
  the prop and building ones are both.
- **Stone never coming back is a design bet, not a certainty.** It makes ore the
  scarce strategic resource, which is the intent, but a very long game will
  eventually quarry the island bare and there is no fallback. A slow deep-stone
  yield from the mountains would be the honest hedge.
- **Rival towns still fight each other to extinction.** In the 45-minute run one
  rival ground the other from 52 to 12 while growing to 111 itself. Nothing
  lets a losing town sue for terms and nothing lets a winner consolidate, so the
  late world tends toward one giant and one corpse. That is Phase 9 or 10 work,
  but it is now the most visible thing wrong with a long game.
