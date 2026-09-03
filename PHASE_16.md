# Phase 16 — The People Pray

Belief has been a tap that runs on its own since Phase 4: a happy population
trickles faith whether you ever do anything for them or not. This phase turns it
into a conversation. A villager in real trouble asks for a specific thing; you
answer it or you do not; both are recorded.

---

## The shape of it

One new simulation module, `prayers.js`, and one render-only companion,
`prayermarks.js`.

**`prayers.js` commands nothing.** It never casts a miracle, moves a villager,
changes a resource or touches belief. It reads the world for conditions worth
praying about, listens to the bus for facts that might answer them, and emits
two facts of its own:

```
prayer-raised     someone is asking for something
prayer-resolved   it ended, and here is how
```

`miracles.js` subscribes to the second and turns it into belief and alignment,
because **belief is miracles.js's to own**. Nothing in the prayer system writes
another system's numbers.

It makes exactly two read-only queries through `state` — `town.growthBlockerOf`
and `town.townAt` — and both are used rather than reimplemented on purpose.
`townAt` in particular decides which town a feeding happened in, and getting that
subtly wrong is precisely how you end up answering one village's prayer by
feeding another.

---

## The four categories

Weather is **deliberately absent**. There is no weather, season or crop-failure
state in this game, and the brief was explicit about not inventing one to hang a
category on. Everything below reads a condition the simulation was already
tracking and had never said out loud.

| | Raised when | Answered by |
|---|---|---|
| **Hunger** | town food per head below 2.2, or one villager past 0.72 hunger | a food miracle or a gift dropped in *their* town |
| **Peril** | a villager under 0.55 health, or with a raider swinging at them | carried clear of what threatened them by hand or by beast |
| **Raid** | a raid declared on the town, or an active siege | the threat actually ending — not one dead attacker |
| **Shortage** | wood or ore under 25 **and** `growthBlocker` says that is what is stopping them | timber or stone set down within the town's reach |

The shortage category leans on `growthBlocker` rather than the raw number for a
reason: a town with 20 wood that has nowhere left to build is not short of
timber, and praying for it would be noise.

---

## Keeping it bounded

The recurring bug in this project is a list that only grows — Phase 8 was almost
entirely that and Phase 13 hit it again — so lifecycle got the most care:

- **Three independent ceilings**: one active prayer per villager, four per town,
  twelve globally.
- **One exit.** `close()` is the only way out of `active`, it splices, and it
  refuses to act twice on the same prayer.
- **Bounded history** of 40, as a ring. Nothing else is retained.
- **Cooldowns** of 90s per villager and 45s per town-and-category, because a
  condition is continuous and a prayer is an event.
- **The sweep iterates backwards**, since `close` splices and a forward loop over
  a shrinking array skips entries.

Verified over twenty simulated minutes: **generated − (answered + failed +
expired + invalidated + active) = 0.** Every prayer ever raised is in exactly one
bucket.

---

## Duplicate protection

`villagers-fed` is emitted from two different systems, and one food miracle over
a crowd would otherwise answer, credit and pay for the same prayer repeatedly. An
event can resolve at most one prayer, tracked in a bounded consumed-event set.

Tested directly: feeding the correct town twice increments `answered` once and
moves belief once.

---

## The creature

Perception and learning, no new abilities.

It subscribes to `prayer-raised` and keeps a **bounded** map of at most sixteen
prayers it could plausibly have noticed — anything further than 90 units is
something a beast standing in your fields cannot hear. Entries are deleted on
resolution.

The only behavioural effect is a multiplier on `help` actions near an open
prayer. It does not make the creature hungrier or more violent; it makes helping
*there* more attractive than helping somewhere else, and a strong desire still
beats it comfortably. When it completes a haul it emits the same
`resource-offered` fact the hand does, and if that answered a prayer it
self-teaches through the existing path — subject to the same decay and the same
leash as everything else it has ever learned.

**Deferred extension point:** the creature can currently satisfy *shortage*
prayers only, because hauling is the one "help" action it knows. Feeding a
specific starving villager or carrying someone out of danger would each need a
new creature action, which is a creature-AI phase rather than a footnote here.

---

## Presentation

- A procedural spire-and-ring over the requester, or over the keep for a
  town-wide prayer. Gold for ordinary, orange for urgent — the same orange the
  rival panel already uses for a raid, so it needs no legend.
- The mark **shrinks as its time runs out**, so you can see a prayer dying.
- Depth test off, like the sculpt brush ring. The first version was
  depth-tested and town-wide marks were buried inside the keep they hovered over.
- Culled past 340 units, capped at 16 instances, two draw calls total.
- **`R`** toggles a panel listing prayers loudest-first. Clicking one selects it,
  focuses the camera through `camera.focus` (the camera's own entry point, so it
  cannot destabilise the controls) and opens a detail card with who, where,
  urgency, seconds remaining and what would answer it.
- "Close — leave it unanswered" dismisses the card, not the prayer.
- A quiet toast on resolution. Deliberately **not** the achievement card: a
  prayer resolving is ordinary life, not a trophy.

Villagers also got **names** this phase. They have had two traits and a life
story since Phase 6 and nothing to put it on. "Save Ines" is a different sentence
from "save villager 41".

---

## Mercy and cruelty

The first version paid belief for answering and almost no mercy — `+0.012`, and
only for an urgent prayer answered inside twenty seconds. That was wrong on its
face: someone asked for help by name and you came, and it counted for a third of
what putting up a shed counts for.

**Answering is now the largest repeatable kindness in the game.**

| Act | Mercy |
|---|---|
| A child is born | +0.006 |
| Raise a building | +0.035 |
| **Answer a prayer** | **+0.045** |
| Feed your people | +0.05 |
| A food miracle | +0.07 |
| **Answer an urgent prayer** | **+0.075** |

It compounds with the Phase 13 redemption curve, and that is the point: positive
shifts amplify the further into cruelty you are, so at the floor an urgent
answered prayer is worth about **+0.24**. The way back from being a monster is to
start listening to your people again, which is the right story for this mechanic
to tell.

**And every unanswered prayer leans cruel** — `-0.018` expired, `-0.04` failed
(they died still asking), ×1.6 if it was urgent. Not every fourth: a god who
never comes is not neutral.

### The arithmetic that shaped this

Simply adding a per-prayer penalty would have done **nothing**, and the numbers
said so before any of it was written. Penance from Phase 13 pulls a cruel god
back toward neutral at **+0.36 a minute**; measured neglect runs about 1.5
prayers a minute. Any believable penalty loses by roughly ten to one — an idle
god ignoring every plea would still have drifted *toward* neutral at +0.3/min.

Two attempts:

1. **Suspend penance while prayers go ignored.** Too blunt, and measured as such:
   it did not merely stop neglect being washed away, it removed the safety valve
   for *every other* cruelty, and fifteen idle minutes pinned a god at −1 mostly
   on the strength of their creature eating people. Ignoring prayers came out
   equal to conquering two towns.
2. **Neglect sets a floor instead.** Penance still runs and still forgives what
   you did and stopped doing; it simply cannot lift you above the level your
   unanswered prayers hold you at. Answer one, the streak resets, the floor
   returns to zero, and the road opens the same second.

One quieter bug fell out of this: a crisis that solves itself closes as
`answered` with `by: 'nobody'`, and that was **resetting the neglect streak**.
A raid petering out on its own was letting a god who answered nothing off the
hook. Only somebody actually coming resets it now.

**Measured**: fifteen minutes ignoring every plea settles at **−0.55, Cruel** —
held at the floor, with −1 still reserved for what you do rather than what you
fail to do. Then answering four prayers from there runs −0.55 → −0.35 → −0.19 →
−0.06 → **+0.07**.

---

## Verification

Ten required cases, all passing:

| Case | Result |
|---|---|
| Legitimate food prayer generated from a real condition | ✓ |
| Delivering food to the correct town answers it | ✓ |
| Delivering food elsewhere does **not** answer it | ✓ |
| No duplicate prayer every tick (1 active after 30 ticks) | ✓ |
| Urgent raid prayer survives one dead attacker, resolves when safe | ✓ |
| Dead requester's prayer invalidated, counted as failed | ✓ |
| Ignored prayer expires and moves belief once | ✓ |
| Same event cannot resolve a prayer twice | ✓ |
| Town and villager caps hold | ✓ |
| Resolved prayers leave the active collection | ✓ |

**Twenty-minute soak**, driving the fixed step directly in `main.js`'s exact
order — the real simulation, just not waiting twenty minutes to see twenty
minutes:

| | |
|---|---|
| Prayers raised | 40 (**2 per minute**) |
| Peak active / cap | **4 / 12** |
| Peak history / cap | **36 / 40** |
| Accounting discrepancy | **0** |
| Population | stable at 12 for the full run |
| Belief | climbed to the cap — no collapse from expiry |
| Alignment | +0.03 |
| Heap growth | 6.1 MB (whole simulation) |
| Prayer tick cost | **0.0007 ms** |
| Frame time | p50 16.7 ms, p99 17.4 ms, 60 fps |

The first soak showed the player town dying by minute 12. A control run with
`prayers.simStep` omitted died **identically**, so it is not this feature: an
unattended player town has nobody to build its farms, because rivals have a build
AI and the player *is* the AI. With four farms placed at the start — a minimally
played town — population held at 12 for the full twenty minutes.

No gameplay module imports another; audited across all thirteen.

---

## What I'd do differently

- **The proxy problem again.** Prayer generation reads conditions that
  `villagers.js` and `town.js` own. It agrees with them today because the
  thresholds are simple; the moment hunger or growth gets more subtle, the two
  will drift, exactly as the island-viability check drifted from town siting in
  Phase 15.
- **Expiry dominates in unattended play** — 29 expired against 8 answered over
  twenty minutes. That is correct for a game nobody is playing, but it means the
  neglect-alignment path is easy to trigger by simply walking away, which is not
  quite the same thing as being callous.
- **Food is 78% of prayers.** The town lives close to the line, so hunger is
  genuinely the common crisis, but the mix is monotonous and a second food source
  or a higher threshold would spread it.
- **A prayer cannot be refused.** You can ignore one and you can close the card,
  but there is no way to say no on purpose — which is the action a cruel god
  would most want, and the only honest route to an intent-based alignment
  penalty. Right now cruelty is inferred from neglect, which is weaker.
- **No save system exists**, so nothing is persisted. If one is ever added, the
  active list, both cooldown maps and the consumed-event set are what it needs,
  restored by villager and town id.
