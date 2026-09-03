# Phase 10 — It Can End

**Status: complete.** The last act of the three-way split, and the last thing the
game was missing: it now begins, runs, and finishes.

---

## An ending

Since Phase 5 the honest answer to "how do you win?" was that you did not.
Capturing every rival left the meters reading *joined you* and the world carrying
on regardless. Losing was impossible by construction — `siegeTick` had an early
return with a comment promising an ending, sitting there for three phases.

**Victory** is every rival flying your colours, however they came to it. A town
won over with awe counts exactly as much as one taken at the sword's point, and
the route you took is written into the ending rather than gating it: *every town
came to you willingly*, *every town was taken by force*, or the mix.

**Defeat** comes two ways. Your seat taken by force — that early return finally
does something — or, quieter and in an unattended game far more likely, your
people are gone.

`state.endGame(kind, reason)` is **idempotent**: the first ending wins. A town
falling on the same tick the last rival is captured cannot produce two endings or
overwrite the one already on screen. Verified by calling it twice.

The verdict is the whole screen: **YOU WIN** or **YOU LOSE** at 76px, in gold or
in red, with the flavour name (*Divinity*, *Forsaken*) demoted to a small line
beneath it. The first version led with the flavour and buried the result, which
is a lovely way to leave someone unsure whether they had just won.

The world stops when the game ends, but **rendering carries on**, so the ending
is read over the island it happened on rather than over a black screen. The
screen names the run: how long you reigned, how many people you had at the end,
how many towns you took, whether you are remembered as Merciful or Cruel, and how
many lessons your creature was taught.

Ending checks run **once a second**, not per tick — they walk every town, and
nothing they turn on can change between two frames in a way anyone could notice.

---

## Siege engines

The castle kit has shipped a catapult, trebuchet, ballista, ram and siege tower,
each with a demolished variant, since Phase 5. Nothing has ever asked for them,
and wall damage has been an abstract number ticking down the whole time.

**The rule that makes an engine worth building:** soldiers can only break a wall
once the garrison is dead, but an engine batters it *whatever is happening around
it*. That is the entire point of one. Your men hold the line, the engine does the
work, and the enemy knows exactly what to go for.

Engines are built from the barracks panel, capped per barracks, and cost about
what a dozen men cost. They lumber at half a soldier's march, they have six hit
points, and every hostile soldier in sight prefers them to anything else on the
field (`THREAT_WEIGHT.engine` 0.3, below even an armed man).

When one dies it leaves a **wreck** — the kit's demolished variant — which stays
on the field for the rest of the game. A broken siege train should be visible,
because it cost the same as a dozen men.

**Measured, the same engine at the same wall, twice:**

| | Result |
|---|---|
| Unescorted, 6 defenders | all six swarm it, **dead in 6 seconds**, 30 off the wall |
| Escorted by 12 under the banner | survives, **wall breached at 9.3s**, town taken |

And the old rule still holds: soldiers alone against a defended wall moved it
**120 → 120** across fifteen seconds. Nothing about how a siege worked before has
been softened; there is simply now a thing that changes it.

---

## Tunable constants

| Constant | Value | Effect |
|---|---|---|
| `ENGINE_COST` | 90 wood, 70 ore | About a dozen soldiers. |
| `ENGINES_PER_BARRACKS` | 1 | A siege train is a serious investment. |
| `ENGINE_SIEGE_DPS` | 4.8 | Against `WALL_HP` 120, one engine is about 25s of work. |
| `ENGINE_SPEED_FRAC` | 0.5 | Half a soldier's march, so it must be escorted. |
| `ENGINE_HP` | 6 | Six seconds against six men. |
| `ENGINE_RANGE` | 34 | How close it must get. Longer than a sword, shorter than safety. |
| `THREAT_WEIGHT.engine` | 0.3 | Everyone goes for the engine first. |
| `ENDING.CHECK_INTERVAL` | 1.0s | How often the game asks whether it is over. |

---

## Bugs found and fixed

Four in a row, all mine, all in the same twenty lines — a useful sequence
because each one hid the next.

1. **The models were never requested.** `siege-catapult` was on disk and absent
   from the boot load list, so `models.get` threw on the very first frame.
   Kit pieces have to be named at boot; being in the folder is not enough.
2. **Wrong registry.** Castle pieces come back from `loadKitPieces` into
   `state.castlePieces` — they are never registered in the global model store,
   so `models.get` was the wrong door entirely.
3. **Wrong container.** `state.castlePieces` is a **Map**, and I indexed it like
   an object. `undefined` reached `sizeToHeight` and died on
   `computeBoundingBox`.
4. **Wrong order.** The engine meshes referenced `mesh.material` before `mesh`
   existed — I had inserted them directly after the geometry they needed, which
   was several lines above the material they also needed.

---

## Afterword — witnessed miracles, and the floating trees

### A wonder nobody sees is a wonder wasted

Belief has only ever trickled in from a happy population, which made the miracle
economy a tap you waited on rather than something you could work at. A miracle
cast in front of a crowd now pays some of itself back, weighted by each witness's
own devotion — so **Devout and Doubter reach into this too**, and a congregation
is worth more than a mob.

The refund is **capped at a fraction of the cost** (`WITNESS_MAX_REFUND` 0.6).
Without that cap, a big enough crowd makes casting free and then profitable, and
the whole economy collapses into: stand in the square, press the button. Showing
off should make a miracle cheap, never free.

Only your own people count. A rival's villagers watching you work a wonder feeds
their *awe*, not your belief — they are impressed, not converted, and that route
already existed.

**Measured**, the same Food miracle costing 30: cast over five of your own
people it refunds 4 for a net **26**; cast on empty ground inside your border it
costs the full **30**. The cast message now names it — *"Food — 5 saw it,
+4 belief"* — so the rule is learned by seeing it rather than by being told.

| Constant | Value | Effect |
|---|---|---|
| `WITNESS_RADIUS` | 42 | How close you must be to see a wonder. |
| `BELIEF_PER_WITNESS` | 1.15 | Belief per witness, times their devotion. |
| `WITNESS_MAX_REFUND` | 0.6 | Hard ceiling as a fraction of the cost. |

### Belief for being seen to help

Belief still only came from a happy population and, since the last change, from
miracles cast in front of a crowd. The hand — the thing you touch the world with
most — earned nothing at all. Two additions, both the same idea at different
sizes: **belief for being SEEN doing something for your people.**

**Clearing their land.** Lift a rock or a felled trunk out of a lived-in place
and carry it away, and the people who watched you do it believe a little harder.
It pays only for a real move (`CLEAR_MIN_DIST` 14), only where someone was
standing to see the ground cleared, and only once per object per
`CLEAR_COOLDOWN` — otherwise the whole mechanic is juggling one rock in a
crowded square. **Measured**: +4.0 belief with 31 witnesses; the same rock again
immediately, a three-unit nudge, and the same act out in the empty wilderness
all earn **0**.

**Throwing your believers.** A god who picks a farmer up and hurls him across
the square is doing something nobody there will forget. It pays **only if they
live** — a throw that drowns them or breaks them on the rocks earns nothing and
still costs alignment, which is the difference between a wonder and a murder.
Everyone who saw it counts, including the one who was thrown; being flung by
your god and living is the most direct evidence of him anyone in that town will
ever get. **Measured**: a 27-unit flight with 19 watching pays **+6.0**; the
same villager again inside the cooldown pays 0; a three-unit toss pays 0.

| Constant | Value | Effect |
|---|---|---|
| `CLEAR_MIN_DIST` / `CLEAR_COOLDOWN` | 14 / 25s | What counts as clearing, and how often the same object can pay. |
| `BELIEF_PER_CLEARED` / `CLEAR_MAX_BELIEF` | 0.55 / 4 | Per witness, and the ceiling per act. |
| `THROW_MIN_DIST` / `THROW_COOLDOWN` | 18 / 20s | What counts as a flight, and per-person cooldown. |
| `BELIEF_PER_THROW_WITNESS` / `THROW_MAX_BELIEF` | 0.9 / 6 | Per witness, and the ceiling. |

### Two buildings that work without hands

The town had one food source and one wood source, and both were **labour**: a
crop farm wants three villagers standing in it, and timber wants villagers
walking to trees. So the moment a raid arrives and your people flee or die, the
whole economy stops at once. Two new buildings break that, and they are a
deliberate pair — each works with nobody tending it, and each pays for that with
something other than hands.

**The Cattle Farm** — 34 wood, 8 ore — grazes whatever is happening. It needs
flat ground (`maxSlope` 0.16, the strictest in the game) and a wide pad, yields
less per acre than a staffed crop farm, and keeps feeding you through the
disaster that empties your fields. Measured one tick at a time so nothing else
could confound it: **0.0077 food per tick against a predicted 0.0077**, and two
paddocks give exactly double. That is 9.3 a minute, or about **nine people fed
forever** per paddock.

**The Lumber Camp** — 30 wood, 12 ore — is not a producer. It is a **multiplier**:
a saw, a whetstone and somewhere to stack timber, and every woodcutter working
within `LUMBER_RADIUS` of it swings **1.5x faster**. It cuts nothing itself.

That is the honest version of the building, and it is the second one. The first
draft had the camp felling trees on its own — which worked, and measured
correctly at 0.60 wood a second, and was a building with no reason to exist next
to villagers who already chop. A camp full of lumberjacks that does the cutting
*for* them is a strange thing to own. Making it multiply the labour instead
gives it the one job nothing else in the game does, and makes **where you put it**
the entire decision: in the middle of your woodland it speeds up every axe in
that wood, and in the town square it does nothing whatsoever.

It applies at the TREE rather than at the villager, which matters — the help is
at the stump, and the walk home with the load is no quicker for it.

**Measured**, chop times normalised so traits cancel out: **0.694 of normal
inside the camp's reach against 1.000 outside**, where the arithmetic predicts
0.667. The small gap is a handful of samples that began before the camp was
built and were observed after, not a discrepancy in the multiplier.

Both appear in the build menu without anyone adding them to it — the radial is
built from `Object.keys(BUILDINGS)` — and rivals build both, so the resilient
options are not the player's alone.

| Constant | Value | Effect |
|---|---|---|
| `CATTLE_FOOD_RATE` | 0.155/s | Food per paddock. A villager eats 0.017. |
| `LUMBER_SPEED` | 1.5 | Chopping speed multiplier inside a camp's reach. |
| `LUMBER_RADIUS` | 34 | How far that help extends. |

### A town you could destroy but never take

Reported: send the creature in, annihilate the garrison, the people and the
houses — and then stand in the ruins with no way to take the place.

Capture asked for `CAPTURE_ATTACKERS` **soldiers** inside a breached wall, and
the creature was not one. So a god who fought with his beast instead of an army
could reduce a rival to nothing and never own it. Worse, victory is *every rival
flying your colours*, so that route did not merely fail to capture a town — it
made the game unwinnable for anyone playing that way.

The creature now counts as `CREATURE_SIEGE_WORTH` soldiers, both for bringing
the wall down and for holding what is behind it. At 3 it is exactly a capturing
force on its own, and none of the sequencing is relaxed: the garrison still has
to fall before the wall will come down, and the wall still has to come down
before anyone surrenders.

**Measured**, with the player owning no soldiers whatsoever and the banner left
at home: a rival at 22 population, 21 buildings and an **11-man garrison behind
a full wall** was taken by the creature alone in **30 seconds** — about eight
seconds to break the garrison and fifteen to chew through the wall, which is
what the arithmetic predicts. Alignment finished at **-0.95**, near the floor.

That is fast, and deliberately reportable rather than quietly tuned:
`CREATURE_SIEGE_WORTH` is the single dial, and dropping it to 2 leaves the beast
able to hold a breach but much slower to make one.

### Four things the wear feature broke

Trees kept misbehaving, and every one of them traced back to Phase 7's wear
shrink or Phase 8's regrowth. Grouped, because they are one story.

1. **Held trees shook.** My own fix from earlier in this phase — lowering a worn
   prop so its base stays planted — used `supportOffset`, which depends on
   ORIENTATION. A prop in the hand is tumbled every tick, so the correction swung
   across most of the tree's length several times a second. It is now applied
   only while a prop is actually resting on something: in the air or in your grip
   there is no base to keep planted.
2. **Regrown trees hung in mid-air when dropped.** The `growing` branch in
   `simStep` returned early to save work on undisturbed saplings — which also
   skipped physics entirely, so a sapling you picked up never integrated and
   simply stopped wherever you let go. Since Phase 8 most trees near a town ARE
   regrown ones, so this was most of them. The early return now applies only to
   a sapling nobody is touching.
3. **Trees stood up in the sea instead of sinking.** Drowning was judged on the
   prop's CENTRE, which was described in the code as conveniently scaling with
   the object. It does not: a tree is eighteen units tall, so dropped into seven
   units of coastal water it stands on the bottom with its middle in the air and
   never counts as submerged. Whether something is in the water is a question
   about the water, so it is now judged on the ground beneath — anything over
   real sea sinks, while a tree in a puddle on the beach is left alone.
   **Measured**: sinks in 1.9s in water 2.4 deep; survives on ground 0.7 high.
4. **The creature "mined trees three-quarters and threw them away".** The wear
   hook fired for every prop action, so `play` shrank a tree exactly as felling
   would — and a play action ends by hurling the thing across the field. Only
   `help` and `eat` wear a node down now. **Measured**: wear stays at 0.00
   through an entire observed play action.

### Trees growing through the walls

Placement clears props inside its pad, and then every one of them grew straight
back a minute later, because a stump remembers where it grew and Phase 8 made it
come back. Towns filled up with trees pushing through their own walls.

A stump now checks before it sprouts, and if a building has gone up there since,
that ground is spoken for permanently. The margin is **per structure** — the
building's own pad plus `REGROW.CLEARANCE` — so a farm keeps a wide skirt and a
storage pit only its doorstep. **Measured**: a stump under a new house never
sprouts and clears its timer; one out in the fields still comes back, exactly at
its old spot.

### A beast in their streets needs no orders

Asked for: lure the creature into enemy territory and it should go for their
people and their town.

It would not. Fighting was gated entirely on the banner — an attack order, or an
enemy near your own flag — so a creature standing in the middle of a rival's
market square just grazed.

**Standing on hostile ground is now its own order.** The town it is in becomes
the front, which matters for two reasons: `WAR_LEASH` holds it to *that* town
rather than letting it chain onward through the countryside, and taking it out of
their land removes the front with it. That is what lets you call it off simply by
sending it somewhere else, with no separate "stop" command to remember.

It costs nothing you have not already spent, either — the war behaviour, the
leash, the devouring and the attribution were all built in Phases 6 and 7. This
is one more way to reach them.

**Measured**, banner deliberately left at home so nothing else could be
responsible: dropped inside a rival's border it is at war immediately, and over
two minutes takes them from **21 population and 20 buildings to nothing**, 51
kills. Ordered home, it disengages, walks back, and they lose nothing further.

Worth stating plainly: this also means a creature that **wanders** into their
land on its own will start sacking it, and the alignment for that is charged to
you. That is a consequence rather than an oversight — the leash and the summons
are how you keep hold of it — but it is a real change in what an unattended
creature can cost you.

### The creature became a man-eater

Reported as: the animal runs around never finishing a tree or a rock, working
each for a few seconds and moving on.

The churn was real and the cause was two of my own changes meeting.

**Villagers were the most nutritious thing in the world.** Phase 9 gave them
`NUTRITION` 1.15, above a tree's 1.0, at the same time as outcomes started
teaching — so every person it ate raised `villager.edibility`, which raised the
score, which made it keener to eat the next. A runaway. Measured over four
minutes: **110 eat actions against 23 hauls**, and a thought log that was
nothing but *eat the villager*.

A person is a mouthful, not a meal. Villager nutrition is now 0.35, and a
`NUTRITION_GOOD` threshold decides which way the lesson runs — anything below it
teaches *downward*. So the world itself teaches the creature that people are not
worth eating, rather than that being a rule imposed on it.

**Nothing but hauling was ever committed.** The re-decision guard covered
`help` and war and nothing else, so any other action could be dropped mid-swing
1.1 seconds after starting. The creature would reach a tree, work at it for a
moment, change its mind and wander off — exactly as reported. It now sees
through anything it has actually begun: changing your mind belongs on the walk
over, not with your teeth already in something.

**Measured after**, same four minutes: eat actions **110 → 31**, own villagers
eaten **0**, prop work run to completion **82%** — and it had taught itself
`villager.edibility` **−0.37** while `tree` climbed to **+0.71**. It worked out
what people are for on its own, which is the loop doing exactly what it was
built to do.

A third, smaller thing fell out of the same test: a creature in a long fight
banked a "lesson" every few seconds that moved `soldier.threat` from 1.00 to
1.00. Opinions clamp, so those were pure noise in the thought log — and each one
still counted toward `lessons`, quietly draining its curiosity. Lessons that
cannot move anything are no longer taken.

### The trees hung in the air

Reported during this phase: trees being chopped floated and shook.

Prop geometry is centred vertically, so a prop's `pos` is its **middle** — and
the wear shrink from Phase 7 scaled the instance about that point, which lifts
the bottom clear of the ground. Measured on a tree mid-chop: the base sat
**5.26 units above the terrain**. The taller the prop the worse it looked, which
is exactly why it was the trees that gave it away and the rocks never did.

The fix is one line, and the right quantity was already in the file:
`supportOffset()` returns the distance from a prop's origin down to its contact
point **in its current orientation**, so lowering the drawn position by that,
scaled, is correct for an upright tree, a felled one on its side, and a tumbling
rock alike. Only the wear factor is corrected — the harvest shrink is meant to
sink into the ground, and still does.

**Measured after**: base at ground level, 0.00, across scales from 0.87 down to
0.62; largest single-frame movement 0.053 units over 60 frames, where the
shaking was the changing size of something hanging in mid-air.

---

## What I'd do differently

- **The creature is close to being the only army you need.** It can now sack a
  fortified town and take it, alone, in half a minute. The alignment price is
  real and the risk of a rout is real, but nothing else in the game asks so
  little for so much - and a barracks costs food, ore and time to do less. If
  the military route is meant to matter, this is the number to look at first.
- **The creature can now start a war you did not declare.** Wandering into a
  rival's borders is enough, and the alignment lands on you. A warning when it
  drifts toward someone else's land - or a leash mode that simply forbids it -
  would make that a choice rather than a surprise.
- **Two safe changes can be unsafe together.** Nutrition and outcome-learning
  were each defensible; the pair made a feedback loop, and the number that
  closed it (villagers being the best food) was one I had typed without
  thinking about what a creature that LEARNS would do with it. Anything that
  turns an outcome into a preference needs its inputs read again with that loop
  in mind.
- **A render-only transform can still be a bug.** Wear never touched physics,
  so I treated it as cosmetic and did not check where the thing actually
  ENDED UP. Anything that changes a scale needs to answer what happens to the
  parts of the object that were touching something.
- **One engine model does the work of five.** The catapult is instanced for
  every engine; the trebuchet, ballista, ram and siege tower are still unused.
  Distinct engines with distinct ranges and rates - a ram that must touch the
  gate, a trebuchet that outranges the wall entirely - is the obvious next step
  and needs no new systems, only a table.
- **Rivals never build engines.** `buildEngine` takes a town and charges it
  correctly, so the machinery is symmetric; nothing in `rivalTick` calls it. A
  rival that brought a siege train to your gate would be the sharpest threat in
  the game, and it is perhaps ten lines.
- **"Begin again" reloads the page.** Every system builds its world at
  construction, so a true reset would mean teardown paths in nine modules. The
  reload is honest and instant, but it loses the seed, so you cannot replay the
  island you just lost.
- **Victory has one shape.** Taking every town is the only win. A score, a time
  limit, or a wonder to build would give the sandbox more than one thing to aim
  at, and the ending screen already collects the numbers a score would need.
- **The ending cannot be dismissed.** You read it and restart. Letting it fade
  to a spectator view of the island you ended on would cost nothing and would
  suit a game that has spent ten phases making that island worth looking at.
