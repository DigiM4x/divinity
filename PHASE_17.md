# Phase 17 — The Divine Reckoning

Sixteen phases of building, feeding, praying and conquering, and the game's
verdict on all of it was five numbers and a reload button. This phase scores
every participant on the same eight axes, all the way through the match, and
ends it with a screen that shows exactly how each score was earned.

---

## The shape of it

Three new modules, and the split between them is the point:

| | |
|---|---|
| `scoreconfig.js` | Every weight, threshold, target and table. Pure data, imports nothing. |
| `reckoning.js` | The engine. Simulation-side, 20Hz, observes and announces. |
| `reckoningui.js` | The live panel and the results screen. Render-only. |

`reckoning.js` makes the same bargain `prayers.js` does: **it commands nothing.**
It never moves a villager, spends a resource, ends a game or writes another
system's numbers. It reads the world through `state`, listens to the bus, and
emits two facts of its own:

```
score-milestone   a team earned a one-time Legacy award
reckoning-final   the match is scored and the result is frozen
```

It imports no gameplay system.

---

## Teams, when the game has no team model

This was the first real design problem, and it is the one everything else rests
on. **Divinity has no teams. Towns *are* the factions.** There is `isPlayer`, and
that is the whole model.

So a team is a *town lineage*, fixed at match start:

- the player's team owns every town where `isPlayer` is true, which **grows** as
  towns are captured or come over willingly;
- each rival town is its own team, and becomes **eliminated** when it is taken.

Nothing is hardcoded to two sides and nothing is named `player` or `enemy`; the
engine builds one team per town it finds and works for any number.

**Team identity is snapshotted at init and never re-read.** That is not tidiness:
`capture()` overwrites `town.colour` with the player's banner, so reading it live
would have made a conquered rival retroactively *always* the player's colour in
the results table — a rival that had never existed under its own flag.

---

## Two kinds of score

The whole anti-exploit design is this distinction.

**Current Power** is recomputed from live state every half second. It is
**idempotent by construction** — it assigns rather than accumulates, and reads
only what a team holds right now. There is nowhere for it to build up, so
rebuilding what you destroyed cannot farm it, and losing an army takes it away.

**Historical Legacy** is event-driven and awarded against a **unique key** in a
bounded set. An event delivered twice awards nothing the second time.

```
Final Divinity Score = Current Power + Historical Legacy
                     + Ending Bonuses − Final Penalties
```

---

## The eight categories

Each targets ~1,000, for an ~8,000 base. Past the target, everything is
compressed logarithmically rather than capped — twice the target scores about
1,240, four times about 1,480 — so exceptional late-game play still counts
without letting one category run away with the match. The panel says so on its
own face rather than leaving the player to work it out.

Targets were **measured, not guessed**. A 30-minute soak set them, and one of
them was badly wrong on the first pass: **Military at a target of 420 pinned at
1,281 and became the largest single score in the game from minute ten onward.**
A standing army is not worth more than an entire civilisation. It is 700 now,
and the spread across a 20-minute three-team run sits at means of 267–659.

---

## Achievements, and the fairness problem

The Phase 13 table is 50 entries of "a counter reached a number", persisted to
localStorage **account-wide**. Two things follow, and they point the same way:

- a returning player who has already unlocked everything would either start a new
  match with free points, or (as the code actually behaves) earn nothing at all;
- **no AI can ever unlock one**, because the counters are the player's.

So achievements score **nothing**. What scores is a table of twenty team-neutral
**Legacy milestones** computed from live per-team state — ten buildings standing,
six kinds of building, two towns held, a raid turned back, ten minutes without
famine — which an AI earns on exactly the same terms a human does.

Achievements still appear, on the results screen's showcase, ranked by a rarity
**inferred** from how demanding each threshold is (the table has no rarity
field). It ranks cards and nothing else. AI teams show their Legacy milestones
instead, because pretending an AI unlocked a player-account achievement would be
a lie the scoreboard told.

---

## What could not be calculated

Reported rather than faked:

- **There is no construction-in-progress state.** A building exists the instant
  it is placed, so "placed vs completed" collapses. `buildingsPlaced` is kept as a
  statistic and scoring uses only *currently standing* buildings — which is the
  anti-exploit form anyway.
- **No temple, no repair, no trade or aid, no rebellion, no formal surrender.**
  `BUILDING_VALUE.temple` sits in the config unused, as the extension point.
- **Only the player is a god.** Rivals have no miracles and no prayers. They are
  judged by the same formula on the inputs they actually have, and the statistics
  screen says so plainly rather than showing an AI a row of zeroes as if it had
  failed at something.

---

## Bugs this phase produced and the checks that caught them

The debug validator recomputes every score from source and reports anything that
disagrees. It earned its place immediately.

**Itemisation that did not add up.** Civilization clamped its raw figure at zero
while the itemised terms summed to −26.4, so a razed town displayed a breakdown
that contradicted its own total. The clamp belongs in `normalise`, not in the
category.

**A score that changed when you looked at it twice.** `divine()` read alignment
from the *previous* pass, since a rival's alignment is itself derived from
devotion and dread. It converged, but recomputing identical state moved a team's
power by 0.6. Both figures are now built without the alignment term, alignment is
derived from them, and only then does it contribute.

**A meaningless diagnostic.** `duplicatesBlocked` read **6,958** after a
25-minute soak in which not one duplicate event had been delivered — the
milestone re-check runs twice a second forever and every routine re-test fell
through to the guard. The callers test the key themselves now, so the counter
means what it says.

**Two winners on one screen.** A player victory made `decideWinner` return the
player while the podium labelled rank 1 the winner — and a test ending duly
rendered "1. Ashfell … winner" directly above the player who had just won. The
Phase 10 verdict is now worth `ENDING.won` *toward* your rank; rank 1 wins.

**A row that did not reconcile.** The breakdown showed each category's Legacy in
its own row — "347 current, +150 legacy, −17 penalties, final 330" — but Legacy
is *pooled* into the Legacy category. And Population's total is a 70/30 blend, so
pro-rating its penalties produced "base −31 … final 43". Legacy now shows on the
Legacy row alone, blended categories are not split, and every rendered row was
verified against the DOM text to satisfy `base + legacy − penalties = final`.

**A lowercased proper noun.** The summary folded the first character to fit "the
age turned at 9:02, when …", turning `Ashfell is no more` into `ashfell is no
more`. Every one of those lines starts with a name.

**A rival maximally cruel for employing a guard.** A rival with one soldier and
no history scored dread 4 against devotion 0, divided, and came out at alignment
−1 — worth 150 dread points before the first minute. Derived alignment is damped
by an evidence term now: it has to be earned.

Also fixed while adjacent: `state.reckoning.final` was assigned over a getter and
threw the moment any game ended.

---

## Lifecycle

This project's recurring bug is a list that only grows, so:

- score events **24 per team**, timeline **60**, both hard-capped rings;
- milestone keys are a fixed table plus per-town keys, so the key space is
  bounded by the number of towns on the island;
- one delegated DOM listener per root, attached once — opening and closing the
  screens twelve times over changed nothing;
- the final snapshot is deeply frozen plain data, so "Continue Playing" cannot
  reach it.

Measured over 30 simulated minutes: keys 14 → 25, timeline 4 → 17, events 16 →
37 against a cap of 72. The growth **decelerates**, which is the signature of a
bounded system rather than a leaking one.

---

## Continue Playing

`state.outcome` deliberately **stays set**. It is what stops a second competitive
ending — `endGame()` already refuses to fire while it is there — and the sim gate
became `!state.outcome || state.postGame`. The world turns again, the frozen
scores cannot move, and `Tab` reopens the results.

---

## Verified

30 simulated minutes across four seeds. Every periodic validation OK; bit-stable
across five consecutive recomputes; two natural leader changes; a conquest that
moved Current Power from the loser to the winner while the loser kept its Legacy.

**0.0023 ms per tick** — under 0.005% of the 50 ms budget.

Twenty-five behavioural assertions pass, including: a destroyed building stops
contributing; place/destroy cycling cannot farm Legacy; repeated cheap buildings
diminish; dead villagers stop contributing while peak survives as a statistic;
five forced town flips award one conquest; four `raid-ended` events resolve one
battle; the snapshot freezes exactly once under repeated `game-over`.

---

## Deferred

- **No game-mode selector.** All four modes (`endless`, `timed`, `domination`,
  `ascension`) are implemented and driven from `MODE` in `scoreconfig.js`;
  `endless` ships, preserving Phase 10's behaviour exactly. Adding the UI is a
  menu, not a feature — this game boots straight into a world and has no main
  menu to hang one on, which is also why "Return to Main Menu" is a clean restart.
- **No save/load**, because the project has none. Nothing was built for this
  phase alone.
- The **unattended player town still starves out around minute eight** — it has
  no build AI, being meant to be played. Pre-existing, confirmed by a control run
  back in Phase 16, and the soaks feed it to keep a match running.

---

## Addendum — scale, and the first collision in the project

Two follow-on requests: make every structure bigger, the way the barracks was
sized; and make the town centre solid.

### Scale

Everything grew by about a third, together, so the silhouette hierarchy the game
reads by survives:

| | Width | Height |
|---|---:|---:|
| Castle | 23.0 | 28.4 |
| Barracks | 11.9 | 24.3 |
| Manor | 10.8 | 15.2 |
| Workshop | 8.1 | 14.6 |
| House | 7.0 | 9.5 |

Pads moved with them — a building that outgrows its pad stands on a shelf — and
so did the three clearances that are really functions of the castle's size:
`TOWN.CENTRE_CLEARANCE` 12 → 20 (or huts end up inside the walls),
`SCULPT.CENTRE_CLEARANCE` 11 → 14 (the sculpt brush must not pull ground out
from under a keep that is now 23 across), and `MIN_SPACING` 5.5 → 6.5.

### The keep is solid

**This project had no collision of any kind.** Since Phase 1, villagers,
soldiers, siege engines and the beast have walked straight through every castle
on the island.

`town.pushOutOfCentres(x, z, pad)` is the whole of it: a circle per town centre,
and a point inside one is projected back out onto the surface. Projecting rather
than refusing the step is what gives **sliding** for free — an agent meeting the
wall at an angle keeps its tangential motion and rounds the corner instead of
pressing into the stone. It is called from the five places anything moves
(villagers, soldiers and engines, and the creature's three movement sites), and
it returns a shared reused holder because it runs for every agent every tick.

### What it nearly broke

**The economy, silently and completely.** Villagers deposit at `town.centre`
when a town has no storage hut, and consider themselves arrived at 1.6 units —
against stonework starting at 10.5. Every carrier would have walked to the wall,
failed to arrive, and never deposited again. Castles need a door: `gateOf`
returns a point on the threshold, on the side the caller is standing. Tested
with every storage building demolished — wood 81 → 637, ore 10 → 52, nobody
jammed.

**Newborns living in the stonework.** Both spawn callers place villagers *at*
`town.centre`. They were only pushed out once they happened to walk somewhere, so
a 20-minute soak found 111 intrusions in 273,873 samples. Fixed inside `spawn`
rather than at the call sites, so any future caller inherits it. Re-run: **0 in
249,114.**

**The creature grinding at a wall forever.** It is told to hold 12 from a war
front while its own bulk keeps it 14 out, so the arrival test could never pass —
it would step, be pushed back, and vibrate there for the rest of the game.
`walkToward` now treats *blocked and getting no closer* as arrived, and
`WAR_HOLD` went 12 → 16. Measured against a control: 2 direction changes over 600
ticks blocked, versus 0 free — collision adds nothing.

**A guard that did not guard.** `Math.sqrt(d2) || 1e-4` looks like it handles a
point at dead centre and does not: the offsets are still zero, so `0/1e-4` is 0
and the point stays exactly where it was. A traverse straight through the middle
of a keep left one sample inside it.

Sieges are unaffected — `SIEGE_RANGE` is 30 against stonework at 10.5 — and were
tested end to end: 18 soldiers besieged and took a keep, closest man 17.2 out.

Deliberately **not** collided: thrown props and the hand. "Walk through" is about
walkers, and rigid-body collision for the physics props is its own piece of work.

---

## Addendum — the ground is shaped to fit the building

The complaint was that the levelling tool does not flatten enough to place a
building. The tool was not the problem.

**`place()` has flattened a pad since Phase 1 — and `validate()` refused to
place anything unless the ground was already flat.** The game declined to do the
one thing that would have made the spot work, and the player was left doing it
by hand first.

Measured on an ordinary island, inside the player's own borders:

| | Before | After |
|---|---:|---:|
| Land that will take a house | **40.6%** | **77.2%** |
| Refused "ground too steep" | 343 samples | 0 |

Over half the dry land inside your own reach refused a house.

### What changed

Per-building `maxSlope` is no longer a wall. It is now the point at which the
earth has to be moved, and the placement ghost says so — *"click to place · the
ground will be levelled"*. The only hard refusal left is `SHAPE_MAX_SLOPE`
(0.85): ground steeper than that is a cliff, where levelling would gouge a shelf
out of the hillside rather than settle a building into it.

Shaping is two passes, and the second is what makes it look built rather than
stamped:

1. the **pad**, levelled flat to the average height beneath it;
2. a **skirt** at 1.9× the pad, eased from that level back into the hillside.

Without the skirt a building on a slope sits on a disc of table-flat ground with
a lip all the way round. Measured across five placements on slopes of 0.36–0.50,
height variation under the footprint fell from **5.2–7.5 units to under 0.5**,
with a largest pad-edge step of 1.4 rather than a cliff.

Neighbours are protected, reusing the Phase 14 protect list rather than
reinventing it: every existing building sits on a pad flattened to a baked
height with an instance matrix to match, so shaping ground out from under one
buries it. After a 20-minute soak with 77 buildings standing, **none floating and
none buried**.

### The tool itself

It was never broken — measured, a steep spot went 0.272 → 0.000 slope and became
buildable. It just took a couple of seconds of holding, which reads as "this is
not doing anything". `FLATTEN_RATE` 2.4 → 4.0 settles it in about half a second.
With placement shaping its own ground, the tool is now for deliberate
landscaping rather than a chore standing between you and a house.

---

## Addendum — the graveyard kit, and a bug it uncovered

`kenney_mini-forest_1.0.zip` turned out to be **already installed** — byte-identical
to what sits at `assets/Models/`, the kit the soldiers and the original trees
already come from. Only the graveyard kit was new.

### Graveyards that grow

`graveyard.js`, one new module, observing only. This game has killed people
since Phase 6 and never showed it: they starve, they are raided, the beast eats
them, and the world forgets each one on the tick it happens.

A burial ground now grows outside every town, one stone per soul. It listens for
a single fact — `villagers-killed`, which already carried how many, where, and
what did it — so **no other system changed for burial grounds to exist**.

- The plot is **sited lazily**: a town with no dead has no graveyard. It looks
  for flat ground clear of the buildings and of every keep, and if a town is
  hemmed in it simply tries again later while the toll keeps counting.
- **Hunger and violence leave different ground** — a raid gets a broken stone.
- A **landmark ladder** climbs with the toll: a lamp at the first death, then a
  cross, an obelisk, a crypt, a great crypt, a mausoleum at eighty. You can read
  how bad a reign has been from across the valley without opening a panel.

**Bounded, because "a grave per death" is this project's recurring bug written
as a feature.** `buried` is the true toll and rises forever; `stones` is what is
in the ground and stops at 44. The landmarks check the *true* toll, so a full
plot still raises its monuments. Measured: **709 deaths produced 89 instances**,
and a 20-minute real game finished at 77 of a possible 216. Cost: **0.0001 ms
per tick.**

### The bug it uncovered

Copying `state.town.townAt(e.pos)` into the new module made it fail immediately —
`townAt` takes **two numbers, not a position**. `prayers.js` had it right;
`reckoning.js` did not, in three places.

So for the whole of Phase 17, `villager-born`, `villagers-killed` and
`villagers-fed` **resolved to no team at all**. Births, deaths and feeds were
silently zero, enemy and civilian kills were never credited, and the rolling
death window that Stability reads never filled. My Phase 17 tests missed it
because they killed villagers by clearing `villagers.list` directly rather than
through the event. Confirmed fixed in a live game: a rival town now reports 40
deaths where it previously reported 0.

### A fairness gap this surfaced, not yet fixed

`town.js` emits `villager-born` **only for the player's town**. That makes the
`first-birth` Legacy milestone unearnable by an AI, which contradicts the
team-neutral claim above. Fixing it means emitting for every town *and* filtering
in `achievements.js`, or the player's own achievement counter would start
counting rival children. Left alone rather than expanded into unasked, and
recorded here so it is not lost.

---

## Addendum — clearing the backlog

Six bugs, each of which had been sitting in the code without announcing itself.

### 1. The commonest death in the game was silent

Starvation set `v.alive = false` by hand and **never emitted `villagers-killed`**,
bypassing `kill()` entirely. Nothing that listens ever heard about a famine: no
grave was dug, Phase 17 never counted it, and the rolling death window Stability
reads never saw one. It goes through `kill(v, 'starved', false)` now.

`byPlayer` was hardcoded `true` — right for the two original callers, dropped and
drowned, since both need somebody to have thrown you. Starvation passes `false`,
and every existing listener already guarded on it correctly: **a famine still
does not make you cruel**, and the creature does not learn violence from one.

### 2. The graveyard tested for causes that do not exist

`graveyard.js` treated `'starved'` and `'age'` as peaceful — but `'age'` is not a
cause anywhere in the game and `'starved'` was never emitted. Every death read as
violent and the entire whole-stone table was unreachable. Now a `PEACEFUL` list
in the config, tested against what the game actually emits, with violence as the
default so a new cause fails safe.

### 3. Four statistics declared and never written

`soldiersTrained`, `soldiersLost`, `enginesBuilt`, `enginesLost` were in
`freshStats()` and written **zero times**. Not cosmetic: `efficiencyOf` divides
kills by losses to weight the Military score, so every team scored as though it
had never lost a man. Two new facts, `unit-trained` and `unit-lost`, since
soldiers and engines were the only things in the game that could die without
anyone being told. A 20-minute soak now reports `27 trained / 27 lost`.

### 4. AI teams could not be born

`town.js` emitted `villager-born` **only for the player's town**, making the
`first-birth` milestone unearnable by an AI. Now emitted for every town, with
`achievements.js` filtering by town so your New Life medal is not handed out for
a rival's baby. Soak: rivals recorded 87 and 55 births where both had always
been zero, and the player's achievement counter stayed correct at 0.

### 5. 5.3 MB pushed to the GPU to move five rows

`refreshPatch` set `needsUpdate` on position, normal and colour, which re-sends
the **whole** attribute — 147,456 vertices, 5.3 MB, every frame of a sculpt
drag, and now on every building placement too since placing shapes ground.

One `addUpdateRange` per row instead, the grid being row-major: **1,656 floats of
442,368, or 0.37%.** Verified the buffer still matches the heightfield to 2.8e-14
inside the patch, that untouched ground stays untouched, and that a second stroke
does not leave the first stale. Sculpting went from **0.50 ms a frame to
unmeasurable**.

`rebuildAll` had to learn to `clearUpdateRanges()` first — an attribute with any
range set uploads *only* those, so a regenerate after a sculpt stroke would have
re-sent five rows and left the rest of the island showing its old shape.

### 6. A kit list that broke only in the build

`colormapFor` matched the pack against a **hardcoded chain of four folder names**.
A kit missing from it got no URL rewriter, which is invisible in dev — there the
GLB is served from its real folder and its relative `Textures/colormap.png`
resolves on its own. Only the production build breaks, where every model is
fingerprinted into `/assets/`. The graveyard kit landed exactly there: **eighteen
"Couldn't load texture" errors in the build and none in dev.** The pack is
derived from the path now, so the next kit cannot repeat it.

---

## Addendum — your people build for themselves

Rivals have had a build AI since Phase 8. **Your town had none** — it sat waiting
to be told, which is why an unattended game starved out around minute eight in
every soak from Phase 16 onward. A civilisation that cannot put up a hut without
divine instruction is a chore, not a kingdom.

The line drawn matters more than the mechanic: **the town builds what it needs to
survive and produce; the god builds what makes it grand or warlike.** Houses,
farms, paddocks, storage, camps and mines are subsistence. Barracks, manors and
workshops stay the player's — those are the decisions with strategy in them, and
handing them over would leave you watching your own game.

One shared `wantedBuilding(town, allowed)` rather than a parallel implementation;
the only difference between a rival and your people is what they are allowed to
build. They spend **your** stockpile, so there is a reserve they will not dig
into unless the town is homeless or starving, and every foundation is announced.

### Two corrections the soak forced

**Building to fill time, not to need.** The first run gave 55 houses against 2
farms with 1,534 timber still piled up — the decision falls through to `house`
by default, so your people laid a hut every fourteen seconds forever. That
default is right for a rival, whose sprawl is how it becomes a power worth
fearing, and wrong for a town told to build *when it needs to*. Rivals keep it;
your town stops.

**Busy but useless.** With the town fed, 83 of 95 villagers were cutting wood
onto a pile of 8,035. `chooseJob` fell back to a hardcoded `'wood'` once every
store was full. The scores are already "how far below target", so the highest is
the least-oversupplied thing — returning it instead keeps the stores level.

### Result

An unattended 25-minute run, nothing given:

| | Before | After |
|---|---|---|
| Outcome | starved at 8:00 | **alive at 25:00** |
| Population | 0 | **7 → 83** |
| Idling | most of them | **0 of 83** |
| Stores | famine | f698 w710 o654, tracking together |

Villagers also walk further for work now — one sweep of `influenceRadius + 12`
meant a stripped wood left the whole town milling about until it regrew, which
reads as a lazy population rather than a worked-out one. They range to
`FAR_SLACK`, then take the other resource, before anyone stands idle.
