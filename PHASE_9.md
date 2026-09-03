# Phase 9 — It Teaches Itself, and Can Be Read

**Status: complete.** Acts 2 and 3 of the split. Act 4 — an actual ending — is
Phase 10.

Two halves. The creature stops depending on you for every lesson it will ever
learn, and the world stops keeping its state to itself.

---

## The creature learns from consequences

Until now it learned from exactly two things: your hand, and watching you. Eating
a boulder taught it nothing whatsoever unless you happened to be there to slap
it. A neglected creature stayed permanently stupid, which is a strange property
for the system the game is named after.

### The lesson had to exist before it could be learned

The blocker was not the learning code. It was that **eating a boulder fed it
exactly as much as eating a tree** — `EAT_RESTORE` was applied whatever went in
its mouth. There was no outcome to notice.

So nutrition is now a property of the thing eaten (`CREATURE.NUTRITION`, default
0), and stone genuinely does nothing except cost energy. Only then can the
creature draw a conclusion from it.

### Learning by doing

`selfTeach()` runs the same machinery a slap does — same opinion table, same
kinship leak to related types, same rate decaying with repetitions — at a much
lower base: `SELF_TEACH_BASE` 0.15 against `LEARN_OPINION_BASE` 0.50. **You
remain by far the fastest teacher**, and the one whose lessons stick. You are
simply no longer the only one.

Two channels feed it:

- **Eating.** Fed or not fed, the outcome writes `edibility`.
- **Pain.** Damage teaches `threat` about whatever dealt it, banked into lumps of
  `PAIN_PER_LESSON` rather than taught per tick — otherwise one fight buries
  every other lesson it has under a thousand tiny ones.

**Measured, with no player input at any point.** Left in a forest it worked out
that trees are food: `tree.edibility` 0 → **0.613** over 21 lessons. Left in a
stone desert with nothing edible in reach it worked out the opposite:
`rock` → **−0.285**, `boulder` → **−0.271** over 30 attempts, and its behaviour
changed — the log turns from eating rocks to playing with them.

Worth being straight about the ceiling: self-teaching **plateaus**, because the
rate decays with repetitions. Stone settles near −0.28, which against
`OPINION_BASELINE` 0.38 still leaves a faint positive pull, so a creature raised
by nobody will keep occasionally trying a rock forever. Driving an opinion
properly to the floor still takes a hand. That is deliberate, and
`SELF_TEACH_DECAY` is the dial if it should learn further on its own.

---

## The leash is a rope

It was a `THREE.Line`, and `LineBasicMaterial` ignores `linewidth` on every
Windows driver — so the most characterful object in the game was a one-pixel
thread that disappeared against pale ground.

It is now a tube: 24 segments, 150 vertices, lit like everything else.

The frames are built inline from a fixed world-up rather than with
`computeFrenetFrames`, which lives on `Curve` rather than on the geometry — and
allocates three arrays every call. A leash sags in a plane and never loops, so a
fixed reference vector is stable enough and costs nothing per frame. Only the
position attribute is rewritten; nothing is allocated.

---

## Traits show in the crowd

Traits lived in the simulation and on a HUD census. You could not look at your
people and see anything about them.

Build is the one channel a baked-pose flipbook has spare — the tunic already
carries the town colour — so `TRAIT_BUILD` varies how large a villager is drawn.
Strong and Plodding stand bigger, Swift and Sickly smaller. Measured across a
live town: **eleven distinct builds from 0.88 to 1.23**, where before every
villager was identical.

Kept slight on purpose. This is a tell, not a caricature.

---

## Raids can be seen coming

A toast fired when someone marched on you and that was the whole warning —
`state.combat.raids` had everything needed and nothing drew it.

There is now a panel under the resource bar, in alarm colours, listing every army
on the march and its strength, with a raid aimed at **you** picked out. It
appears when a raid is declared and clears when the last one ends. Verified both
ways.

---

## Alignment finally does something

It has recoloured the world since Phase 4 and driven nothing, which made the
entire moral axis decorative — and it is the axis the whole frame hangs on.

Alignment now moves a town's mood, and mood drives belief. **A merciful god's
people are gladder to be his; a cruel one's are not, and an unhappy town prays
less — which costs him the belief he needs to go on being cruel.** That loop is
the point: cruelty is affordable, but it charges interest.

Measured, same town, everything else equal: happiness **0.885 saintly against
0.615 monstrous**, a swing of 0.27. `TOWN.ALIGNMENT_MOOD` is the dial, set at
0.18 — enough to feel, not enough to make cruelty unplayable.

---

## Tunable constants

| Constant | Value | Effect |
|---|---|---|
| `CREATURE.NUTRITION` | tree 1.0, villager 1.15 | What actually feeds it. Anything absent is 0. |
| `CREATURE.INEDIBLE_COST` | 0.07 | Energy wasted swallowing something with no food in it. |
| `CREATURE.SELF_TEACH_BASE` | 0.15 | Outcome teaching, against 0.50 for a slap. |
| `CREATURE.SELF_TEACH_DECAY` | 0.30 | How fast it stops learning by itself. Lower = keeps going. |
| `CREATURE.PAIN_PER_LESSON` | 4.0 | Damage banked before pain teaches once. |
| `TOWN.ALIGNMENT_MOOD` | 0.18 | How far alignment swings a town's happiness. |
| `TRAIT_BUILD` | 0.90–1.13 | Per-trait draw scale. |

---

## Bugs found and fixed

1. **The leash rewrite deleted `LEASH_POINTS`.** The constant sat between two
   lines I replaced as a block, and the game failed to boot. Replacing a span
   by its endpoints takes whatever is in the middle with it.
2. **`computeFrenetFrames` is not a geometry method.** It belongs to `Curve`.
   Calling it on the geometry threw every frame — 199 errors before I looked.
   The replacement does not call it at all.

---

## What I'd do differently

- **Self-teaching only has two channels.** Eating and pain. Playing with
  something that hurts, helping and being praised for it, attacking something
  that fights back and wins — all of these are outcomes the creature currently
  draws nothing from. The mechanism is general; only two things call it.
- **Nutrition is a flat table, so nothing is ever spoiled or poisonous.** A
  drowned tree is exactly as good a meal as a fresh one. A negative nutrition
  entry would teach a much sharper lesson than a zero one, and the code already
  handles the sign.
- **Build reads as size, not as strength.** A Strong villager and a Glutton are
  both simply bigger, so the tell says "notable" rather than saying which trait.
  Silhouette or a carried tool would say more, at the cost of more baked poses.
- **Alignment still only touches mood.** One hook is not the same as being
  load-bearing. Rival awe, what the creature finds easy to learn, and how
  readily villagers flee are all places it should plausibly reach.
