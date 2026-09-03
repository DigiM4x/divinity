# Phase 3 — The Creature

The core of the game. Same stack and rules as before: no asset files, systems
talk only through `state`, sim on a fixed 20 Hz clock.

---

## What was built

**The body.** Procedural, from primitives: a merged torso (chest, hips, belly),
a head on a neck pivot with horns, eyes and a hinged jaw, four limbs each built
as hip → knee → foot groups, and a four-segment tail chain. Animated by hand at
render rate — legs and arms swing in opposition, the body bobs twice per stride,
the tail swishes with each segment lagging the one before it, the head dips to
eat and the jaw works while it chews. Dirt darkens the hide; a slap or stroke
flashes it red or green.

**Growth.** Size runs from 0.85 to 2.3, half driven by age and half by meals
eaten, so a well-fed creature grows visibly faster than a neglected one.

**Needs.** Hunger, energy and cleanliness, decaying on the sim clock. These
never decide *what* it does — only how badly it wants a category of thing.

### The mind

Scoring one candidate action is:

```
utility = desire[d] × leashBias[d] × needDrive(d) × opinionScore(d, type)
          × proximity  +  curiosityNoise
```

- **Desires** — `eat, sleep, play, attack, help, impress`, one learned weight
  each. Starting values are deliberately lopsided: a newborn mostly wants to eat
  and play, and has almost no aggression, so a violent creature is something you
  *taught*, not a default. (`groom` exists as an action but is a fixed instinct,
  not a seventh learnable desire.)
- **Opinions** — `objectType → { edibility, fun, threat }`, every one starting at
  zero. No innate knowledge of anything. `OPINION_BASELINE` is added when
  scoring, so an unknown object still looks mildly worth trying — which is
  exactly why a young creature attempts to eat a boulder.
- **Curiosity** — exploration noise that decays as lessons accumulate. This is
  the main lever on "readably dumb early, deliberate later".

**Reinforcement.** Drag on the creature: slow is a stroke, a fast whip is a slap.
Both move two things at once, which is the whole trick — the **desire** it was
acting on, and its **opinion of the object involved**. The learning rate decays
with repetition (`rate = BASE / (1 + reps × DECAY)`), so the first lesson lands
about five times harder than the tenth and early teaching sticks.

**Imitation.** The creature watches you. Throwing a prop hard demonstrates play;
where it lands decides whether it also demonstrated violence — a landing that
kills villagers teaches `attack`, one that flattens a building teaches `attack`
against buildings, and something set down gently among villagers reads as
feeding them and teaches `help`. Imitation is deliberately weaker than a slap so
deliberate teaching always beats accidental copying.

**Leashes.** Four modes on keys `1`–`4`. Each multiplies desire weights when
scoring without overwriting anything learned — take the leash off and the
creature's own personality is intact underneath. The leash of learning also
amplifies reinforcement by 1.6×.

**The mind panel** (`G`) shows live needs, all six desire weights as bars, the
opinion table colour-coded red-to-green per axis, the current action and phase,
and a rolling log of its decisions with the score and curiosity that produced
each one.

### Verified behaviour

Driven headlessly and through real pointer events, not by calling internals:

| Check | Result |
|---|---|
| Learning-rate decay over 10 repetitions | 0.200 → 0.043 |
| Untaught newborn's meals | tree ×54, rock ×33, boulder ×4 — indiscriminate |
| **One** slap for eating a rock | `rock.edibility` 0.00 → **−0.80** |
| Meals after that single lesson | tree ×152, rock ×**0**, boulder ×11 |
| Stroke raises the desire | `eat` 0.75 → 0.91 |
| Slap lowers it | `eat` 0.91 → 0.81 |
| Second lesson on same opinion moves less | 0.80 then 0.52 |
| Hand never grabs the creature while petting | ✔ |

The boulder column is the nicest evidence that the system works the way it
should: the creature was taught *rocks* aren't food, and it still tries
boulders, because that lesson was about rocks specifically.

Running everything together: 60 fps, 51 draw calls, 325k triangles.

---

## Tunable constants

All in `src/state.js` under `CREATURE`. The five that define the personality:

| Constant | Value | Effect |
|---|---|---|
| `LEARN_DESIRE_BASE` | 0.10 | How far one slap moves a desire. **Keep this small** — see bug 1. |
| `LEARN_OPINION_BASE` | 0.50 | How far one slap moves an opinion. This should carry the lesson. |
| `LEARN_DECAY` | 0.55 | Higher = the first lessons dominate and later ones barely register. |
| `CURIOSITY_BASE` | 0.85 | Raise for a sillier infancy. |
| `CURIOSITY_DECAY` | 0.07 | How fast it settles into competence. |

Others worth knowing:

| Constant | Value | Effect |
|---|---|---|
| `OPINION_BASELINE` | 0.38 | Appeal of an unknown object. 0 = never tries anything new. |
| `HAUL_WOOD` / `HAUL_ORE` | 26 / 18 | Load per trip. A beast of burden should out-carry a villager several times over. |
| `HAUL_GATHER_TIME` | 2.6s | How long it spends tearing a node down before shouldering it. |
| `HAUL_SHORTAGE_WEIGHT` / `HAUL_SATED` | 2.2 / 120 | How hard a shortage steers what it fetches, and the stockpile level that counts as plentiful. |
| `LOOSE_FOOD_BONUS` / `PLANTED_FOOD_PENALTY` | 3.2 / 0.22 | Felled timber is the preferred meal; a standing tree is barely worth the effort. Makes the creature a cleanup crew and keeps it off the villagers' timber. |
| `NEED_URGENCY` | 2.4 | Peak multiplier on a fully-unmet survival need. |
| `DESIRE_MIN` / `DESIRE_MAX` | 0.08 / 2.0 | Floor exists so a desire can never become unrecoverable. |
| `IMITATE_BASE` / `IMITATE_DECAY` | 0.20 / 0.40 | Strength of learning by watching. |
| `LEARNING_LEASH_GAIN` | 1.6 | Reinforcement multiplier under the leash of learning. |
| `SLAP_SPEED` | 3200 px/s | Smoothed cursor speed that turns a pat into a slap. |
| `SLAP_SUSTAIN` | 0.03s | How long that speed must hold. Rejects one-frame spikes. |
| `SPEED_SMOOTH` | 0.05s | Cursor-speed smoothing constant. Larger = calmer, laggier. |
| `STROKE_MAX_SPEED` | 1800 px/s | Below this, movement banks stroke credit. |
| `STROKE_DISTANCE` | 90 px | Unhurried travel per emitted stroke. Lower = easier to praise. |
| `GROOM_INSTINCT` | 0.5 | Fixed weight for the non-learnable grooming action. |
| `DECIDE_INTERVAL` / `ACT_TIME` | 1.1s / 2.2s | How often it reconsiders, and how long an act takes. |
| `MATURE_AGE` / `FOOD_TO_MATURE` | 600s / 45 meals | The two halves of the growth curve. |

`LEASH_MODES` and `DESIRE_AXIS` (which opinion axis each desire consults) are
also exported from `state.js` and are the easiest structural things to change.

---

## Bugs found and fixed during the build

1. **Slapping it for eating rocks made it stop eating anything, and starve.**
   `LEARN_DESIRE_BASE` was 0.34, so six slaps drove `eat` from 0.75 to its floor.
   The lesson "boulders are not food" is not "eating is bad" — the desire should
   take a gentle nudge while the *opinion* carries the meaning. Dropped the
   desire rate to 0.10 and raised the opinion rate to 0.50. This was a design
   error, not a typo, and it is the single most important number in the file.
2. **Mashing slap punished one deed five times over**, blowing straight through
   the decay curve and making the system untunable. `lastAction` is now consumed
   on reinforcement: one lesson per deed.
3. **`NaN` poisoning, via a hard crash.** `groom` is an action but was not in the
   desires table, so reinforcing it read `undefined`, crashed on `.toFixed()` in
   the render loop, and would otherwise have written `NaN` into a weight that
   every later comparison silently fails against. Non-learnable instincts are now
   guarded explicitly.
4. **A starving creature would play with a rock until it dropped.** Need urgency
   was linear, so `hunger 1.0 × baseline 0.38` lost to anything it had learned
   was fun. Survival drives now use a steep curve scaled by `NEED_URGENCY`.
5. **Gentle pats registered as slaps.** Slap detection measured the *hand's*
   world velocity, but the hand chases the cursor on a spring and whips across
   the map whenever the pointer jumps. Moved to cursor speed in screen pixels,
   and the frame the press landed on is now excluded — otherwise "move the mouse
   over the creature, then click" reads as a whip.
6. **Strokes silently did nothing.** The input layer clears `capturedBy` inside
   its own pointerup handler, so the next frame's `capturedBy === 'creature' &&
   released[0]` check could never be true. Petting state is now owned locally.

### Later revision — slap too sensitive, stroke not sensitive enough

Both complaints turned out to be the same bug. The slap threshold was 1500px/s
tested against a **raw single-frame** cursor speed — that is only 25px in one
frame, which is ordinary petting motion. So most strokes were being classified
as slaps, and since a slap suppressed the stroke, stroking rarely fired at all.
Fixing the slap fixed most of the stroke problem by itself.

Three changes:

1. **Speed is smoothed** (a 0.05s EMA) before anything is decided, and a slap
   additionally has to *sustain* that speed for `SLAP_SUSTAIN`. One jittery
   frame can no longer read as violence. Threshold raised to 3200px/s.
2. **Stroking accumulates distance** rather than firing once on release. Every
   `STROKE_DISTANCE` of unhurried travel emits a stroke, so petting back and
   forth gives continuous feedback instead of feeling dead until you let go.
3. **A motionless hold still counts** as a gentle pat on release, so praise
   never requires a specific motion.

Measured classification after the change:

| Gesture | Cursor speed | Verdict |
|---|---|---|
| hold still | 0 | STROKE |
| slow pet | 240 px/s | STROKE |
| normal pet | 600 px/s | STROKE |
| brisk pet | 1200 px/s | STROKE |
| fast reposition | 1680 px/s | STROKE |
| ambiguous | 2700 px/s | STROKE |
| whip | 4200 px/s | **SLAP** |
| hard whip | 7200 px/s | **SLAP** |

### Later addition — the creature hauls wood and ore

The `help` desire used to be a placeholder that conjured 4 wood out of nothing
regardless of what the creature was standing next to. It now does real work:
walk to a node, tear it down, shoulder the load, and carry it to the nearest
storage pit (or the castle). The load is visible on its back the whole way home.

Which node it picks is weighted by what the town is short of, so it fills the
gap rather than piling up what you already have. Measured over seven minutes
with villagers frozen out, so every gram is the creature's:

| Stockpile | Wood fetched | Ore fetched |
|---|---|---|
| 400 wood, 0 ore | 78 | **126** |
| 0 wood, 400 ore | **130** | **0** |

It still eats, sleeps and grooms in between — `help` competes with the other
desires rather than overriding them, so a creature you never taught to help
will mostly ignore the job. Stroke it after a delivery and it takes to hauling.

Two bugs, both from the same root:

1. **It reserved 117 nodes and never released one.** Hauling claims a node so
   villagers do not walk to the same tree, but `decide()` overwrote the current
   action without handing back what the old one had reserved. Every change of
   mind stranded another node, and because claimed nodes are skipped, the
   creature progressively excluded the entire map from being hauled — while
   never actually completing a single trip.
2. **It never finished a haul anyway.** Re-deciding every 1.1s meant it kept
   swapping target halfway across the map. A haul is now committed once begun,
   in both legs: it will not drop a half-felled tree, or a full load of ore,
   because something else looked interesting.

---

## What I'd do differently

- **Opinions are per-type, not per-object, and there is no generalisation.**
  Teaching it that rocks are inedible says nothing about boulders — which reads
  as charming stupidity now, but past a certain number of object types it will
  feel like the creature never learns. A similarity table (stone-like,
  plant-like, person-like) that leaks a fraction of each lesson to neighbours is
  the natural next step, and it is about ten lines.
- **The creature never learns from consequences, only from you.** Eating a
  boulder should hurt on its own. Right now nothing in the world teaches it
  anything — every lesson comes from the player. A small intrinsic-feedback
  channel (pain, satiation, disgust) would make an unattended creature drift
  toward competence instead of staying frozen.
- **Actions are instantaneous at the end of a timer.** There is no interruption,
  no failure, and no partial progress, so a creature that decides to eat a tree
  across the island will walk the whole way and cannot change its mind except at
  the decide interval. A proper interrupt when a much better option appears would
  make it feel far more alive.
- **The leash is drawn with `THREE.Line`,** whose width is stuck at one pixel on
  every desktop GL backend. It reads as a faint thread. It wants to be a thin
  tube or a ribbon, which is also where the leash-mode colour would actually
  carry.
- **`witness()` is called from props.js and hand.js**, which is the first real
  crack in the "systems only touch state" rule — they're reaching into another
  system's behaviour, not just reading its data. It works, but an event bus on
  `state` (`state.events.emit('impact', …)`) that the creature subscribes to
  would keep the dependency one-directional, and Phase 4's alignment tracking
  will want exactly the same feed.
- **The mind panel rebuilds its whole DOM 5× a second.** Fine at this size, but
  it's the kind of thing that quietly costs 2ms/frame later. Worth diffing if it
  grows.
