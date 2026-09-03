# Phase 7 — The World Fights Back

**Status: complete.** Both criteria that were once outstanding are now closed:
Brave and Timid separate properly (100% against 61% standing to fight), and the
stand-versus-run comparison has been run as a controlled pair (12 losses against
21). The lose condition is deferred to Phase 8 by design, not by omission: a
breached player town bleeds but does not fall.

Rivals decide to raid. Villagers run. The creature grows into its history. And
the spatial hash finally earns its keep, because fleeing is what made the flat
arrays hurt.

The largest thing in this phase is not on that list. It is a famine that had
been killing every town in the world since long before Phase 7, and which had to
be found and fixed before a raid mechanic meant anything at all.

---

## The famine

**Every town in the world starved to death at around minute eight**, with its
fields at full crop.

It went unseen because Phase 5 measured rival growth over *five minutes* and
stopped. The rivals reached 27 population and looked healthy. They were already
dying. Phase 7 needed towns that survive long enough to raise an army, so a
twenty-minute unattended run was the first thing this phase asked for, and all
three towns were at zero population by minute ten.

Three things were wrong, and only the third one mattered.

**1. Resource targets did not scale with population.** `chooseJob` aimed to hold
a flat 60 food whether the town held six villagers or twenty-nine. Targets are
now per-head plus a floor (`TOWN.FOOD_PER_HEAD`, `FOOD_FLOOR`, and the same for
wood and ore). Real, but not the cause.

**2. Soldiers ate the town.** Training checked only that the food *could* be
paid, never that it *should* be. Static garrisons made that harmless; raiding
made it fatal, because losses were replaced continuously at `TRAIN_FOOD` apiece.
Rival soldiers now come out of surplus above a flat floor, so a rival at war that
cannot feed itself stops replacing its dead, shrinks, and recovers. Also real,
also not the cause — and it took three attempts to land. Gating on the full
pop-scaled target was so strict that no army ever reached raiding strength at
all; and the flat floor that replaced it was applied to **every** town,
including the player's. See *The barracks that produced nothing*, below.

**3. Farm worker slots leaked, and this was the whole thing.**

`releaseTarget()` cleared `v.targetBuilding` without ever decrementing that
farm's `workers` count. The sleep path in `checkNeeds` calls it — so every
villager who happened to get sleepy while assigned to a farm walked off to bed
and never gave the slot back. The leak is monotonic. Given enough time every
farm in the world reads 3/3 workers, `findBuildingIn` can never match a farm
with a free slot again, no villager is ever assigned to farm, and the town
starves surrounded by ripe fields.

The measurement that ended the guessing:

```
farms: [ {claimedWorkers: 3, slots: 3, actualVillagersHoldingIt: 0, crop: 1.0}, ... ]
farmsBelievedFull: 6 of 6
```

Six farms, all believing they were fully staffed, with **zero** villagers
actually holding any of them.

What made it survive this long is that it *looked* handled. Two call sites did
this:

```js
releaseTarget(v);
if (v.targetBuilding?.def?.farm) v.targetBuilding.workers--;   // dead code
```

`releaseTarget` had already nulled `targetBuilding`, so the guard never fired.
The decrement now lives inside `releaseTarget` itself, which is the one place
that clears the field and therefore the only place that can own the bookkeeping.

**Result.** Rivals now reach **56 and 69 population at minute eighteen**, with
zero starvation deaths, where they previously peaked at 27 and were extinct by
minute ten.

---

## Rivals raid

A **war council** in `combat.js` rather than `town.js` — town.js is the economy,
and military decisions belong with the soldiers.

Each rival scores its neighbours by `(distance + defenders × weight) / spoils`,
so near, weakly-held and rich wins. It commits for `RAID_COMMIT` so it cannot
dither, marches `RAID_FRACTION` of the garrison and leaves the rest as a home
guard, and **gives up** — on `RAID_DURATION`, or when the party is cut to
`RAID_BREAK` of its strength, or when home itself comes under threat. Survivors
walk home. Without that ending, a party that breaches a wall it cannot exploit
camps in the streets for the rest of the game.

### Rivals were secretly allies

`hostile()` was `a.isPlayer !== b.isPlayer`, which quietly made **every rival an
ally of every other rival**. Rival-on-rival raiding was impossible by
construction — the score function returned Infinity for every rival target and I
spent a run wondering why only the player was ever attacked. Two towns are now
enemies unless they are the same town or both are yours. Captured towns set
`isPlayer`, so they still come over to your side correctly.

**Measured**, twenty minutes unattended: **7 raids declared, 5 of them
rival-on-rival**, first at t=243s — immediately after the 240s `RAID_GRACE`,
which is what that constant is for.

### You can be hurt; you cannot yet lose

`siegeTick` was hardcoded so that only the player besieged and only rivals fell.
It is now general: any hostile force breaches any wall, including yours. But a
breached player town **does not fall**. Losing the game is a lose condition and
it wants a proper ending rather than a silent change of ownership, so it is held
for Phase 8 alongside the win condition. The seam is one early return with a
comment on it, not an oversight.

---

## Villagers flee

A `flee` state that outranks every other need, interrupting meals and sleep too —
a villager asleep in a burning house was the most obviously broken thing about a
raid.

They run for the town centre, unless the threat lies that way, in which case they
run directly away — trying several fanned bearings so that a villager cornered
against water picks a different line instead of freezing with a soldier behind
them. Terror overrides tiredness: a fleeing villager runs flat out regardless of
energy, which also stops an exhausted crowd being wiped out because it could only
shamble.

**Measured**: 40 enemy soldiers dropped onto working villagers, **86 fleeing at
peak**, 71% survival.

**Brave and Timid cancelled out here, and it took a new mechanic to fix.**
Survival was 64% Brave against 65% Timid — no separation, because the two effects
are opposed by construction: Timid runs 55% earlier but takes 35% more damage
when caught, Brave holds on 40% longer but takes 45% less. On those numbers they
were worth the same, which made them flavour rather than a decision. Rather than
retune until the table flattered itself, the pair was left alone until there was
something for nerve to actually decide — see *Villagers fight back*, where Brave
stands 100% of the time and Timid 61%.

---

## The spatial hash

`src/lib/grid.js` — a **utility, not a system**: no game state, not registered on
`state`, systems build their own private instances. It sits beside `noise.js`,
which is the precedent, and so it does not violate the no-cross-imports rule.

Rebuilt from scratch each sim tick rather than maintained incrementally.
Rebuilding is O(n) with a tiny constant and needs no bookkeeping when things
move or die mid-tick; incremental updates would be faster in theory and a source
of stale-bucket bugs in practice.

**Measured** — the threat scan the grid replaced, 117 villagers against 83 living
soldiers, per sim tick:

| | Cost |
|---|---|
| Linear scan | 0.067 ms |
| Spatial hash | 0.029 ms |
| | **2.3× faster** |

Honest framing: both numbers are trivial against a 50 ms tick. The grid is not
rescuing the frame rate today. It matters because fleeing added a per-villager,
per-tick query that scales as villagers × soldiers, and that product is the one
that grows fastest as the game gets bigger. At 12 living soldiers the same
measurement gives only 1.7×; the gap widens with the army.

---

## The creature grows into its history

Three traits earned rather than born with, appended to whatever the species gave
it, each announced with a toast so the player learns they have it:

| Trait | Earned by | Effect |
|---|---|---|
| Battle-scarred | 2 routs | defense ×1.25 |
| Bloodied | 25 kills | attack ×1.20, leans toward wanting it |
| Beloved | 20 strokes | learns 1.15× faster, leans toward helping |

Earned traits are stored separately from species traits and re-merged whenever
the body changes, or swapping animal would wipe everything the creature had been
through. **Measured**: earned *Bloodied* at 37 kills, then changed elephant →
bunny; `Bloodied` survived, temperament swapped Thick-hided/Greedy →
Gentle/Fleet, and defense moved 1.5 → 0.8 accordingly.

### The creature defends its home, by accident

The banner rule is "an attack order is a flag on hostile ground *or on top of an
enemy army*". The second clause runs both ways: when a raiding party reaches your
town it arrives within sight of the banner standing there, the banner becomes an
attack order, and the creature turns out to fight for its own streets.

This was not designed. It is kept, and now documented in `warFront()`, because it
is the behaviour you would want anyway and it falls out of the one rule already
there rather than needing a second one. Confirmed directly: `warFront` false with
the town at peace, true the moment an enemy army stands in it.

---

## The barracks that produced nothing

Reported straight after the phase landed, and my own regression.

The food reserve above was applied to every town, the player's included. A player
town sitting on an entirely ordinary 30 food had a barracks that produced
**nothing at all**, silently, with no indication why. Measured: 0 soldiers in 90
seconds at 30 food, and 6 in the same 90 seconds at 200.

The reserve is an **AI brake and belongs to rivals only**. A rival replaces its
losses automatically and will starve itself doing so; that is what the floor is
for. The player built the barracks deliberately and decides for themselves what
their food is for — they now pay `TRAIN_FOOD` and nothing more, exactly as before
Phase 7. Verified: 30 food trains 3 soldiers where it trained none, while a rival
on the same 30 food still holds back and resumes at 60.

The deeper fault was silence. The population readout has said *need food* / *need
beds* since Phase 2, and the army readout said nothing — so a barracks that was
working exactly as designed was indistinguishable from a broken one. Training now
records **why** it is held up every tick, and the HUD shows `army n/cap` with
*need food*, *need ore* or *at cap* in the same amber as the population blocker.

---

## The creature that ran off to die

Reported as "the animal keeps running off to kill the other players, and I get
YOUR CREATURE IS DRIVEN OFF on screen". Three separate faults, all mine, all in
the war code.

**1. There was no leash.** `warTargets()` scanned the creature's own sense radius
and nothing else, so it walked to the nearest enemy — and by arriving, brought
fresh enemies into range. It chained itself target by target out of the town it
was defending and into a rival's streets, where the full garrison drove it off.
The banner was supposed to be the order and nothing enforced that. Targets must
now lie within `WAR_LEASH` of the **flag**: the creature's senses decide what it
can see, the banner decides what it may go after. Off the leash entirely, it
walks back to the flag before doing anything else.

**2. Pulling back made it weaker.** I added a withdrawal at `WAR_WITHDRAW` health
so it would break off instead of fighting to a rout — but defense was tied to
`atWar()`, which goes false the moment it withdraws. Its defense therefore
**halved at the exact instant it turned to leave**, and soldiers kept swinging at
it all the way out. Defense now holds the war multiplier while withdrawing: a
retreating animal is still in the battle until it is clear of it. Withdrawing
also actually moves it now — it heads home to heal rather than resuming ordinary
life in the middle of the fighting that just hurt it.

**3. Being routed did not mean leaving.** This is where the message came from.
Regeneration lifted health a hair above zero between hits, soldiers immediately
knocked it back down, and `rout()` fired again — **2101 "your creature is driven
off" toasts in a single six-wave test.** A routed creature is now genuinely off
the field: `inField` is false while the rout timer runs, `takeDamage` ignores it,
and soldiers stop targeting it. `rout()` is a one-shot.

**Measured.** Six waves, 108 soldiers thrown at it — far more punishment than
play produces: **4 routs, down from 2101**, and it never once entered rival
territory (86 units from home against a 220-unit gap between towns). At a
realistic raid size of 3, across four waves: **0 routs, 0 withdrawals**, lowest
health 7/20, back to full afterwards, 99 raiders killed.

---

## Picking people up, and eating them

Two requests: be able to lift enemy villagers and drop them in the sea, and have
the creature be properly savage toward enemies rather than merely swatting them.

### The hand takes people now

Villagers gained the handful of fields the carry spring already reads — position,
velocity, mass, radius — so they are carried by **exactly the same damped spring
as a boulder**, with no second physics path. They are deliberately light
(`GRAB_MASS` 0.5 against a rock's several), so the spring barely lags and a flick
sends them a long way, which is most of the appeal.

Picking one out of a crowd uses the same forgiving screen-space snap as props,
for the same reasons: villagers are small, they move, and an exact raycast
against an InstancedMesh whose instances are re-bucketed every frame is both
awkward and unforgiving. When a prop and a person are both in reach, **whichever
is nearer the cursor in pixels wins** — "props first" makes people impossible to
grab in a busy street, and "people first" makes it hard to pick up the tree
someone is standing next to.

While held, a villager is fully suspended: no hunger, no jobs, no fleeing. On
release they fly ballistically and end one of two ways.

- **The sea.** They drown, with a splash, and the death is attributed to you.
- **The ground.** Below `FALL_SAFE_SPEED` they pick themselves up and run —
  shaken, not calmly resuming the job a god interrupted. Above it they take
  damage scaled by impact, and a hard enough throw kills.

**Measured**, through the real input path — press, drag, release: grabbed the
villager under the cursor, lifted them clear, thrown at **103 u/s**, dead on
landing. A 4-unit drop leaves them at full health and fleeing; a 90-unit drop
kills. Sea throws emit `cause: 'drowned'`, hard landings `cause: 'dropped'`, both
`byPlayer: true` — so drowning your *own* people costs you alignment exactly as
it should.

### The creature eats enemies alive

Two changes, one to what it wants and one to what it does.

**Appetite.** Enemy villagers now score **10× higher** than your own as targets
for eating and attacking (`ENEMY_APPETITE` 3.5 against `FRIEND_RESTRAINT` 0.35).
Before this it was exactly as happy to eat the farmer who feeds it as the soldier
marching on your gate, which reads as broken rather than as wild.

**Devouring.** At the front, an enemy civilian is no longer swatted with the same
swipe that kills a soldier. The beast takes them: `DEVOUR_MULT` damage, the
eating animation, hunger restored, and **health restored**. That last one is what
keeps it in the fight — every mouthful is health back, so a creature carving
through a town sustains itself instead of grinding down to a rout, and sacking a
defenceless town becomes a meaningfully different act from meeting an army.

**Measured**, creature alone against a rival town of 23: reduced it to **1
population, 36 killed**, hunger 0.90 → 0.07, and it finished on **full health**
having never dropped below 19.3 — where the same creature against an army of 30
came out on 3.1. Your own town, standing right there, lost nobody.

---

## Home defence

Everything else about soldiers is about armies you *send* somewhere. This is the
other half, and it was missing: an enemy walking into your land was answered only
by whatever happened to be standing within sight of it. Troops held their post at
the banner and the creature only reacted to enemies near the flag, so an
incursion at the far side of your circle went unopposed.

Now, an enemy inside your borders is its own order.

**Soldiers** defend what they are standing in. The rule is deliberately gated on
*the soldier being home*, not on the town being invaded: troops you have sent out
on an attack stay on it, and only the garrison actually present turns to meet the
incursion. Gated the other way, every raid you launched would be recalled by the
first enemy scout who wandered over your border.

**The creature** goes to the intruder rather than to the flag, so it defends the
whole of your land instead of only the patch the banner happens to stand on. An
explicit attack order still wins — if you have planted the flag on someone's
town, that is a decision and it is respected. The defensive front moves with the
intruder and vanishes when they are dead or gone, which is what brings the
creature home again afterwards.

**Measured.** Six enemies walked in at the far edge of the circle, 56 units from
the banner: all six detected, the creature answered **from 112 units away without
the banner being moved**, the garrison marched, all six died, no losses, and the
creature stood down afterwards on full health.

And the guard, with the army split: four soldiers at home, the rest sent far away
under a standing attack order, then five enemies dropped on the border. The home
four closed to contact (42 units → 0); the away group **stayed on its target**
(4 units from the enemy centre). Both halves did the right thing at once.

---

## The summons: gestures out, orders in

Gestures are gone. The $1-style recogniser was a pleasing thing to build and a
poor thing to use: a miracle you meant to cast could fail because your circle
came out too oval, the failure message told you your handwriting was bad, and it
spent the entire right button on the privilege. It cost 160 lines of recogniser,
templates and glyph rendering, all deleted.

**Miracles are now armed and placed.** Click one in the grimoire, then click the
world. It stays armed after a successful cast, so a rain of fireballs is a rain
rather than a ritual, and disarms on failure, since the usual reason is running
out of belief and re-clicking would only repeat the refusal. Right-click or
Escape puts it away — the same cancel that building placement already used.

**The right button now commands the creature**, which is what it was always
worth more for. There was no way to say *where*: the leash modes could express
what you wanted it to care about, never where you wanted it to be.

| Input | Order |
|---|---|
| Right-click the ground | Go there. A point order at the minimum radius. |
| Right-drag | Go there and hold this much ground — the drag sizes the circle. |
| Right-click the creature | Dismissed. Free to roam again. |

A ring on the ground shows the standing order in blue, and the circle you are
dragging out in amber, so a pending order reads differently from a live one. The
ring is simply not drawn while the creature is at war: the banner is the order
then, and two rings competing for the same meaning would be worse than neither.

Inside its circle the creature's own mind runs exactly as before. The circle
filters the *candidates* rather than vetoing the walk afterwards, which is what
makes it appear to choose to stay: it never sets off for the tree it cannot have.
Straying outside is the only thing overridden — it walks back first, then resumes.
An attack order still outranks a summons, because a banner planted on a town is a
more specific instruction than a circle drawn on grass.

**Measured**, through real pointer events: a click orders it to the clicked point
and it walked **63 units down to 7**; drag length scales the circle (18 for a
click, 27 for a long drag); right-clicking the creature clears the order; and
arming *food* then clicking the world spent 30 belief and stayed armed for a
repeat.

---

## Villagers fight back

Farmers now swing at raiders, and they are emphatically not soldiers:
`FIGHT_DPS` 0.045 against `COMBAT.DPS` 0.26, so **a soldier is 5.8x the fighter
a villager is**. One farmer against an armed man is futile. Eight of them are
not. That ratio is the whole design: it makes a mob a real thing without making
the barracks pointless.

The kill itself is left to `combat.js`, which already sweeps for soldiers on
zero hit points and handles the effects — no reason for two systems to know how
a man dies.

### Courage, and what finally separated Brave from Timid

Whether a villager stands or runs is decided by the friends around them against
the enemies around them, and the threshold is scaled by their own nerve. Brave
holds at about 1.6 to one; Timid needs better than 4 to one. It is counted
locally rather than town-wide, so a lone farmer at the treeline runs while a mob
holds the square a hundred units away — which is both truer and the reason one
raid produces flight in one place and a brawl in another.

Counting neighbours meant a second spatial hash, this time over villagers: done
against the flat list it is 150 x 150 distance tests per tick, the same product
the soldier grid was built to kill.

**This is the fix for the null result recorded above.** Brave and Timid used to
pair each trait's advantage with its own drawback and cancel out — 64% against
65% survival, no separation, flavour rather than a decision. Measured now, at
the density a raid actually meets: **Brave villagers stood and fought 100% of
the time, Timid 61%.** The traits finally mean opposite things.

The first measurement of this looked like a total success and was worthless: I
had crammed 90 villagers into the town square, where 40 friends are within
arm's reach and even Timid's threshold is trivially met, so everyone stood
regardless of nerve. Density is the variable the whole rule turns on, and the
test had removed it.

### Fighting is better than running

The obvious worry is that standing to fight just gets people killed. Measured as
a controlled pair — same cohort size, same dispersal, same six raiders, the only
difference being whether courage is reachable at all:

| | Villagers lost |
|---|---|
| Standing and fighting | **12** |
| Always running | **21** |

A mob shortens the raid, and a raid that ends sooner kills fewer people. Note
that the creature was active in both arms — `enabled` on the systems turns out
to be a vestigial flag that `main.js` never checks — so this is a like-for-like
contrast rather than a clean isolation of villagers.

Isolated properly, with the creature not stepped at all and no player soldiers
on the field: **ten villagers brought a raider down in 4.3 seconds, alone.**

---

## Nodes wear down as they are worked

Purely cosmetic, and the cheapest good-looking thing in the phase. A tree or a
seam of ore now shrinks steadily while someone works it, down to
`WEAR_MIN_SCALE`, instead of standing at full size until it blinks out of
existence. Chopping reads as chopping rather than as a villager standing still
next to a tree that suddenly is not there.

It rides on machinery that already existed: props carry a `shrink` factor for
the harvest-away animation, so wear simply multiplies into the same rendered
scale. Nothing else moves — the collision radius, the pick target and the yield
are all untouched, so a half-chopped tree still blocks, still grabs and still
pays a full load.

Villagers drive it from their work timer, the creature from its own, so hauling
a tree home and eating one both take it apart the same way.

**Abandoned nodes grow back.** Wear only advances while someone is actually
working it; left alone it recovers at `WEAR_RECOVER` per second. Without that,
a forest slowly fills with permanently half-size trees from every job that was
dropped because the villager got hungry.

**Measured**: wear climbing smoothly 0.38 → 0.97 over a single chop, the node
rendering down to 0.44 of full size just before it is stripped, and a node left
alone recovering 0.90 → 0.22 in two seconds.

---

## The miracles you could not click

Reported as "miracles aren't working", and they were not: **the grimoire could
not be clicked at all.**

The HUD is `pointer-events: none` as a whole, so the overlay never blocks the
world. Panels meant to be operated opt back in — the build radial and the
creature-select screen both already did. When miracles stopped being drawn and
started being picked, the grimoire became the first interactive thing in the
main HUD and I never gave it the same opt-in. The rows had a pointer cursor and
a hover highlight and were, at the browser level, not there at all: a hit test
at the centre of a row returned the canvas behind it. Every click fell through
to the world.

### Casting is a held key

Arm-then-place was replaced almost immediately by something better: **hold Ctrl
and the mouse becomes a casting tool.** The wheel picks the miracle, a left
click places it, and letting go puts it away.

The win is that there is no mode to get stuck in and nothing to disarm — the
state lasts exactly as long as you hold the key, so a miracle can never be left
armed to surprise you on your next click. One miracle is always *selected*, but
that is a preference rather than a mode: it does nothing at all until Ctrl is
down. The grimoire rows still pick, they just no longer arm.

The wheel is **consumed** while casting, or the camera would zoom out from under
you as you chose. Miracles update before the hand and the camera, which is what
makes that possible.

A ring follows the cursor in the miracle's own colour, sized to **the radius the
effect actually uses** rather than a decorative one, and dimmed when you cannot
afford it — so a miracle you cannot pay for does not look identical to one you
can.

**Measured**, end to end through real input: wheel without Ctrl still zooms
(130 → 80) and leaves the selection alone; holding Ctrl raises a 22-unit water
ring in `#4fc3e8`; Ctrl+wheel cycles water → lightning, resizes the ring, and
leaves the camera exactly where it was; Ctrl+click spends 45 on Lightning; and
after releasing Ctrl the ring is gone and a plain click casts nothing.

**Measured**, through real clicks end to end: the row is now the top element at
its own centre; clicking arms it; clicking the world casts, spends 30 belief and
stays armed for a repeat; right-click puts it away; clicking the row again
toggles it off; and arming Fireball raises a 14-unit ring, matching
`MIRACLE.FIRE_RADIUS` exactly.

---

## Barracks ranks

A barracks can be upgraded twice, and the men it turns out are better for it.

| Rank | HP | Power | Garrison | Upgrade cost |
|---|---|---|---|---|
| Militia | 1.0 | 1.00 | 6 | — |
| Men-at-arms | 1.9 | 1.35 | 8 | 70 wood, 55 ore |
| Knights | 3.2 | 1.80 | 10 | 140 wood, 120 ore |

**Power is one number that multiplies everything they deal** — to soldiers,
civilians, buildings and the creature alike. Splitting it into four separate
damage figures would have meant four numbers to keep in step and four ways for a
rank to be accidentally strong against one thing and weak against another.

Three decisions worth recording:

- **Stats are taken at training and kept for life.** Upgrading does not
  retroactively improve the garrison you already have — you have to train
  through it, so an upgrade is an investment rather than a button that makes
  your existing army better.
- **Each rank raises the garrison cap too**, so upgrading is also how you field
  more men without laying more foundations.
- **Rivals upgrade as well.** A rival with a full garrison and money spare
  promotes it rather than laying yet another building. Without that the player
  would be the only side ever fielding anything better than militia, and the
  whole feature would read as a difficulty slider pointing the wrong way.

Rank reads at a glance in the world: each tier stands `TIER_SCALE` taller.

Upgrading is a panel above the grimoire, listing each barracks with its rank and
what the next one costs — buildings have never been clickable in this game and
adding world-picking for them would have collided with a left button already
spoken for by the hand and the camera.

**Measured**: a fresh barracks starts at Militia with a cap of 6; upgrading
raises it to Men-at-arms and the cap to 8, and the militia already trained keeps
`power` 1 and tier 0; the next man out is 1.9 HP and 1.35 power; a second
upgrade gives Knights and a cap of 10; a third is refused with *already at the
highest rank*; the cost is charged exactly (70 wood, 55 ore) and refused with
*needs 140 wood* when the stores are empty. And the point of the whole thing —
**8 Knights against 8 Militia, nothing else on the field: 7 knights standing,
0 militia.**

---

## Attribution still holds

The Phase 5 rule — you are blamed only for what you ordered — survives rivals
being able to raid you, which is the first time it has been under real pressure.

Measured during a raid on the player's town: **22 villagers killed by rival
soldiers, 0 of them charged to the player.** Two killed by the player's own
creature, both charged, for a total alignment shift of −0.12 = 2 × −0.06.
Exactly right, and the only alignment movement in the run.

---

## Tunable constants

`COMBAT` in `src/state.js`:

| Constant | Value | Effect |
|---|---|---|
| `RAID_MIN_ARMY` | 6 | No raid below this. Must be under the garrison cap or no army ever qualifies. |
| `RAID_FRACTION` | 0.65 | How much of the garrison marches; the rest is the home guard. |
| `RAID_INTERVAL` | 20s | How often a town considers raiding. |
| `RAID_COMMIT` | 45s | Committed before it will reconsider, so parties do not dither. |
| `RAID_DURATION` | 150s | A raid gives up after this regardless. |
| `RAID_BREAK` | 0.35 | Called off if the party falls to this fraction of its strength. |
| `RAID_GRACE` | 240s | No raiding at all before this. A save sacked in its first minute is not difficulty. |
| `RAID_DEFENCE_WEIGHT` | 6 | How strongly a garrison puts an attacker off. Higher = timid. |

`VILLAGER`:

| Constant | Value | Effect |
|---|---|---|
| `FLEE_RADIUS` | 22 | An enemy this close sends them running. Multiplied by the villager's `flee` trait. |
| `FLEE_HYSTERESIS` | 1.45 | Widened radius for deciding it is safe again. |
| `FLEE_CALM` | 3.0s | Quiet needed before going back to work. |
| `FLEE_SPEED` | 1.55 | Running against walking. |
| `FLEE_AWAY_DIST` | 30 | How far they run when the centre is the wrong way. |

`TOWN`:

| Constant | Value | Effect |
|---|---|---|
| `FOOD_PER_HEAD` / `FOOD_FLOOR` | 5 / 40 | What a town tries to hold. **Must scale with population** — see the famine. |
| `WOOD_PER_HEAD` / `WOOD_FLOOR` | 2 / 80 | Same, for timber. |
| `ORE_PER_HEAD` / `ORE_FLOOR` | 1.5 / 40 | Same, for stone. |

`EARNED_TRAITS` in `src/state.js` holds the creature's earned traits, each with
its threshold and the deed counter it is measured against.

---

## What I'd do differently

- **Dead soldiers are never removed from the array.** `soldiers` only grows;
  `MAX_SOLDIERS` is therefore a lifetime cap rather than a concurrent one, and a
  long enough game will refuse to train anyone. It has not bitten yet — 61
  entries after twenty minutes against a cap of 120 — but it is a slow fuse, and
  it cost me one wasted test where 25 spawns silently returned null.
- **The farm cap fights recovery.** `ceil(pop/6) + 1` means a town whose
  population has just been halved by a raid is also allowed fewer farms, which is
  precisely backwards. Any cap keyed to current population will resist recovery
  from exactly the disaster this phase introduced.
- **Rivals never coordinate or make peace.** Two rivals will grind each other
  down while you watch, and nothing lets a losing town sue for terms or a winning
  one consolidate. The war council has one verb.
- **Raids cannot be seen coming.** A toast fires when someone marches on you and
  that is all — no banners on the horizon, no scouts, no warning at the border.
  The information exists in `state.combat.raids`; nothing draws it.
- **Committing an order on "the button is no longer held" was wrong.** The held
  state reads false for the odd frame, so the summons committed on the press and
  every drag collapsed to the minimum radius. Dragging interactions want the
  release *edge*, not the absence of the press.
- **Moving an interaction between input layers moves its whole set of
  assumptions.** Casting went from the canvas to the DOM, and everything the
  canvas gave for free — receiving clicks at all — had to be re-established. The
  grimoire looked finished, hovered like a button, and was inert.
- **Not every red result is a bug in the game.** Three rounds of "right-click
  does nothing" turned out to be the test harness never delivering right-button
  events to the canvas at all — `input.buttons[2]` was false even mid-hold.
  Driving the same code through real `PointerEvent`s worked first time. When an
  input test fails, confirm the input arrived before touching the feature.
- **Long test runs change the board underneath you.** Twice now a measurement
  came back reading zero because the world had moved on: once because 25 soldier
  spawns silently returned null, and once because the rival town I was spawning
  "enemies" from had been captured by the player forty simulated minutes earlier,
  making them my own troops. Neither was a code fault. Any test that runs the
  world for minutes has to re-establish who is who at the moment it asserts,
  rather than trusting the setup it wrote at the start.
- **The hand simulates first, so anything it touches can halt the world.**
  Villagers had no `quat`, and one `p.prevQuat.copy(p.quat)` in the carry spring
  threw every frame a person was held. Because `hand.simStep` runs first in the
  tick, that aborted the *entire* simulation — props, town, villagers, creature,
  combat — for as long as you held someone. It presented as "carrying does
  nothing", which is a long way from the cause.
- **A state that means "gone" has to be checked by everyone who can act on it.**
  Routing set health to zero and cleared the action, and I assumed that was
  enough. Three separate places — the damage path, the targeting scan and the
  aim-validity test — each independently decided the creature was still there.
  Any "out of play" flag needs auditing against every system that can touch it,
  not just the one that raises it.
- **Any silent gate is a bug report waiting to happen.** The food reserve was
  eight lines and correct for rivals; it still cost a round trip because a
  building that quietly does nothing looks broken. Anything that can stop a
  player-visible process needs to say so at the moment it stops, not be
  discoverable by reading the source.
- **Five-minute tests were the real bug.** The famine survived two phases of
  measurement because every economy test stopped at five minutes and every town
  still looked healthy there. Long unattended runs should be the default for
  anything touching the economy, not a thing reached for when something already
  looks wrong.
