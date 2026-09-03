# Phase 6 — The Banner Calls, and Everyone Is Someone

Two additions after Phase 5: the creature goes to war on the player's order, and
every villager and every animal has traits that actually do something.

---

## Part 1 — The creature marches under the banner

### The rule

Plant the platoon banner on hostile ground and the creature is called to it.
There is no toggle and no button: **you declare war by where you put the thing**,
which is the rule the platoon already obeyed. A flag in your own fields is a
posting; a flag inside a rival's border, or on top of an enemy army in the field,
is an attack order.

Under that order the creature:

- **marches to the flag** at its full movement speed, holding `WAR_HOLD` short of
  it once there is nothing left to fight;
- **fights** — a swipe every `WAR_INTERVAL` that catches the nearest `WAR_SWEEP`
  enemies inside `WAR_RANGE`, hitting soldiers, villagers and buildings alike;
- **fights at double strength** — attack and defense are both multiplied by
  `WAR_MULT`, a flat +100% to each.

### Why war overrides the utility AI

This is a deliberate exception to how everything else in the creature works, and
it is worth being explicit about.

Routed through the normal scoring, a creature whose `attack` desire sat at its
0.08 floor would score the war somewhere below eating a shrub and simply ignore
the order. That is defensible as simulation and indefensible as a game: a direct
order from a god has to be obeyed. So the war is an override, not a candidate.

Teaching still happens — it just happens through *what it does at the front*
rather than through *whether it chooses to go*. Every kill sets `lastAction`, so
a slap or a stroke in the next few seconds lands on it exactly as it would after
any other deed, and you can raise a beast that relishes war or one that hates it.

### Stats, and why they are a base pair times a multiplier

Attack and defense are never stored. They are derived from the constants, the
species temperament and whether the banner is currently an attack order, every
time they are read. That is what stops the doubling from ever falling out of step
with the actual order — there is no cached "war mode" to leave stale.

Damage runs through `takeDamage()`, which applies the creature's own defense.
Nothing outside the creature needs to know the multiplier exists.

### It cannot be killed, only driven off

At zero health the creature **routs**: it leaves the field, walks off the order,
and sulks at home for `WAR_ROUT_TIME` while `WAR_REGEN` puts it back together.
`WAR_REGEN * WAR_ROUT_TIME` is deliberately larger than `WAR_HEALTH`, so it
always returns at full strength or not at all — a creature that trickled back to
the front at four hit points would just be routed again on arrival.

No death, no respawn screen, no lost save. Mortals do not get to kill a god's
beast; they get to make it go home.

### Measured

Against a rival grown to 21 population and 21 buildings behind a **30-soldier**
garrison, the creature alone killed 24 soldiers and reduced the town to 1
population and 2 buildings — and came out on **3.1 of its 20 hit points**. That
is the balance the numbers are aimed at: a monster that wins, and can lose.

Attack and defense readouts, confirming both the species spread and the doubling:

| Animal | Temperament | Attack | Defense | Under the banner |
|---|---|---|---|---|
| Elephant | Thick-hided, Greedy | 0.55 | 1.5 | 1.10 / 3.0 |
| Tiger | Ferocious, Fleet | 0.80 | 0.8 | 1.59 / 1.6 |
| Lion | Ferocious, Thick-hided | 0.80 | 1.5 | 1.59 / 3.0 |

---

## Part 2 — Traits

### Villagers

Every villager is born with **two traits, fixed for life**, drawn from different
groups so nobody is both Hardy and Sickly.

A trait is nothing but a set of multipliers on that villager's own constants. At
birth the two are folded once into a flat `v.mods` table, and every system
downstream reads `v.mods` and never looks at the trait list again — so a trait
costs nothing per tick no matter how many exist. The `TRAITS` table in `state.js`
**is** the system: you can retune every personality in the game without opening
`villagers.js`.

| Group | Traits |
|---|---|
| body | Hardy, Sickly, Glutton |
| temper | Swift, Plodding, Diligent, Lazy |
| craft | Woodsman, Miner, Grower, Strong |
| spirit | Devout, Doubter |
| nerve | Brave, Timid |

They reach into hunger, energy drain, walking speed, job time (generally and per
resource), yield per trip, meal size, starvation damage, damage taken from enemy
soldiers, and belief generated.

**Measured**, over 4,478 job samples: Diligent works at 0.73x the baseline time,
Lazy at 1.45x, a Woodsman chops at 0.57x, a Miner mines at 0.61x, and Strong
carries 13 per load against a baseline of 8.2. Those are the table's numbers
coming out the other end of the simulation.

### The animal

The creature gets two traits too, but from its **species** rather than a dice
roll — which is what turns "choose your creature" from a wardrobe into a
decision. A lion is not a bunny with different fur. All 24 Cube Pets animals are
hand-authored rather than hashed from the name, because the lion has to read as a
lion the moment you see the card.

Temperament bends attack, defense, movement speed, hunger, food value, learning
rate, memory, curiosity, and what the animal is inclined to *want*:

- **Clever** takes lessons 1.4x faster. **Stubborn** resists them at 0.65x but
  holds the few it accepts far longer (`memory` multiplies the decay term, so
  early lessons dominate even more than usual).
- **Gentle** learns aggression at 0.6x and kindness at 1.4x; **Ferocious** is the
  reverse. Punishment is inverted against the same figure, so a Gentle animal is
  genuinely hard to make cruel rather than merely slow to start.
- **Thick-hided** trades 12% of its speed for 50% more defense; **Fleet** does the
  opposite.

The temperament is shown on the card in the creature-select screen and on the
mind panel, and the town's trait census is on the mind panel too — one villager
out of 150 is not worth clicking on, but knowing your people are mostly Doubters
is.

---

## Tunable constants

`CREATURE` in `src/state.js`, war block:

| Constant | Value | Effect |
|---|---|---|
| `WAR_ATTACK` | 0.55 | Damage per swipe to a soldier or villager (villager health is 1). |
| `WAR_ATTACK_BUILDING` | 6 | Damage per swipe to a building (`BUILDING_HP` 40). |
| `WAR_DEFENSE` | 1 | Incoming damage is divided by this. |
| `WAR_MULT` | 2.0 | **The +100%.** Multiplies attack and defense under the banner. |
| `WAR_RANGE` / `WAR_SWEEP` | 9 / 3 | Reach of a swipe, and how many it catches. |
| `WAR_INTERVAL` | 1.0s | Seconds between swipes. |
| `WAR_HEALTH` / `WAR_REGEN` | 20 / 0.9 | Hit points, and how fast they come back. |
| `WAR_ROUT_TIME` | 25s | Time at home after a rout. Must exceed `WAR_HEALTH / WAR_REGEN`. |
| `WAR_HOLD` | 12 | How close it holds to the banner with nothing left to fight. |

`COMBAT` in `src/state.js`:

| Constant | Value | Effect |
|---|---|---|
| `DPS_VS_CREATURE` | 0.35 | Damage per second one soldier deals to the creature. Kept separate from `DPS` because a soldier has 1 hit point and the creature has twenty. |
| `THREAT_WEIGHT.creature` | 0.5 | How attractive a target the creature is. Just above a soldier. |

`TRAITS`, `TRAIT_COUNT`, `CREATURE_TRAITS` and `PET_TEMPERAMENT` in `src/state.js`
are the trait tables themselves, all multipliers, all defaulting to 1.

---

## Bugs found and fixed

1. **The creature taught itself aggression.** The first war test ended with its
   `attack` desire driven 0.10 to 0.72 and five log lines reading *"watched you
   destroy building"* — for buildings it had flattened itself. The imitation
   handler filtered on `byPlayer` but not on `cause`, so the creature's own
   rampage came back to it as a lesson about what its god liked. Now filtered on
   both. Re-measured: `attack` unchanged at 0.10, zero lessons gained, across a
   raid that levelled a town.
2. **One swipe cleared a field.** With no cap on how many enemies a swipe caught,
   the creature killed eight men standing round it in a single swing and walked
   out of a razed town having lost **0.1 of its 20 hit points**, which makes both
   the army and the risk pointless. A swipe now catches the nearest `WAR_SWEEP`.
   Re-measured against 30 soldiers, it finished on 3.1.
3. **Belief was funded by rival towns.** Making Devout and Doubter mean anything
   required counting belief per head instead of per population, and doing that
   exposed the fact that `state.villagers.count` is *global* — belief had been
   drawing on every villager in the world, including two rival towns. It now
   draws on the player's own people, weighted by how devout they are. **This is a
   real balance change**: at game start belief accrues from ~6 villagers rather
   than ~20. `MIRACLE.BELIEF_PER_VILLAGER` is the dial if the new pace is too
   slow.

---

## What I'd do differently

- **Villagers still do not flee.** Now that Brave and Timid exist, the traits are
  sitting there describing a reaction that never happens — a Timid villager takes
  35% more damage and does not run, which is the worst of both. Fleeing toward
  the town centre when an enemy soldier is near is the obvious next move, and the
  traits are already in place to modulate it.
- **Traits are invisible in the world.** They exist in the simulation and on the
  mind panel, but you cannot look at a villager and see that they are Strong. A
  per-instance tint or a held tool would make the crowd legible at a glance;
  right now the census is the only way to know your town.
- **No inheritance.** Traits are rolled fresh at every birth, so you cannot breed
  a town of Devout farmers, and there is no reason to care which particular
  villagers survive a famine. Parentage would give the population a memory.
- **The creature's temperament never changes.** Traits earned through play —
  *battle-scarred* after enough routs, *beloved* after enough praise — would let
  the animal's history show on it, which is the natural extension of a learning
  system that already tracks everything it has done.
- **`WAR_SWEEP` is doing a lot of load-bearing work.** It is the single number
  standing between "the creature soloes towns for free" and "the army matters",
  and it is a hard cap rather than anything physical. Damage falling off with
  distance across the arc would be less arbitrary and would not need the number.
