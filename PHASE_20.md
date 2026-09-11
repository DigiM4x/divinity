# Phase 20 — The Other Gods

For nineteen phases this was a game one participant could play.

The rivals had everything that looks like a civilisation. Towns, farms, walls, a
population that grew, a war council that picked who to raid. What they did not
have was the thing the whole game is about — and combat.js said so in as many
words:

> The creature is the player's, so only a rival's men will come at it.

> **ONLY THE PLAYER TAKES TOWNS.** The game has no notion of ownership beyond
> `isPlayer`, so a rival cannot meaningfully take a town from another rival.
> What it can do is sack one.

Every word of that was true, and between them those two comments describe a
world where rivals fought, bled, breached walls and razed buildings, and at the
end of it the map said exactly what it had said at the start. There was exactly
one way for a match to end that was not the player's own failure.

Now every civilisation has a god, a creature, and the same two routes to a town.

---

## Ownership becomes real

The whole phase rests on one change, and it is a small one.

A town has an **owner** — an index into `state.factions`, one faction per
civilisation — and `isPlayer` is a **getter** over it rather than a field.

```js
get isPlayer() { return this.owner === 0; },
get captured() { return this.owner !== this.index; },
```

That choice is why this is a change and not a rewrite. Seventy-odd reads of
`town.isPlayer` across ten files keep working untouched, and the boolean can
never disagree with the owner, because there is one number and the other is a
window onto it.

The hostility rule has now been written three times, and each version was
correct for the ownership model of its day:

| | |
|---|---|
| `a.isPlayer !== b.isPlayer` | made every rival an ally of every other rival |
| `!(a.isPlayer && b.isPlayer)` | fixed that — but could not tell two rivals' towns from one rival's two towns |
| `a.owner !== b.owner` | says the right thing about a case the others could not express |

A faction's towns share one stockpile, exactly as the player's captured towns
always have. `capture()` was already written to move a town from one owner to
another; it simply had "the player" hard-coded as the destination in four
places.

---

## A rival god is not a second player

Deliberately. It cannot sculpt the land, it casts no miracles, and it has no
hand. What it has is a creature and the three levers that raise one:

| | |
|---|---|
| **The leash** | it picks a stance from its situation — the same four modes |
| **The summons** | it sends the creature where it wants it — the same call |
| **The hand** | it praises and punishes through `creature.reinforce` — the identical path a stroke and a slap take |

There is no fourth lever and no cheating one. A rival's beast learns on the same
decaying curve, fights at the same numbers, and can be driven off the field the
same way. That is the point: **it can be beaten for the same reasons it can be
raised.**

`creature.js` stops being a singleton in all but name. A creature belongs to a
`faction` — fixed at birth, deliberately *not* read off `home.owner`, because a
god who loses their capital has lost a town, not their creature.

### Two kinds of god

The first soak with every god running identical logic produced four gods
permanently in the war stance and every awe meter on the island at zero — because
a god's war is on whenever its army is out, and with `RAID_INTERVAL` at twenty
seconds somebody's army is always out. One of the game's two routes to a town
existed and nobody ever took it.

So gods are dealt a **disposition**:

- a **conqueror** sends its creature wherever its war is;
- a **missionary** sends it to somebody's streets to perform, and calls it home
  only when there are men in its *own*.

Its army still raids either way. The war council is the town's business; a god
commands a creature, not an army.

---

## The desire that paid nothing

`impress` has been in the desire table since Phase 3. It burned a little energy,
threw some sparkles, and was — mechanically — the creature doing nothing at all.
No player ever had a reason to teach it.

It buys **awe** now, at `TOWN.IMPRESS_PER_DANCE`, from every town that can see
it and does not belong to the god whose beast it is. The same meter the miracles
fill, the same capture at 1. A creature is a wonder that walks.

Getting there took three bugs of my own, and each one is the same lesson from a
different angle.

**It could never be chosen.** At a starting weight of 0.15 against an opinion
baseline of 0.38, an impress act scored about 0.03 where eating a nearby tree
scored 0.79 — a fortieth. It never won, so it was never performed, so it was
never reinforced, so it never rose. **The desire was unreachable from its own
starting value**, and that did not matter for seventeen phases because the act
paid nothing.

**It could not see an audience.** `gatherCandidates` gathered buildings from
`state.town.buildings` — the player's own capital, and nothing else in the
world. So no creature could see a *foreign* building, and the desire whose entire
point is performing for somebody who is not yours could only ever be aimed at the
home village, where it earns nothing.

**And it could not get near one.** My first fix for "a courting beast besieges
the town it visits" was distance: stand outside `SIEGE_RANGE + FRONT_RADIUS`, 64
units out. A two-minute probe at that standoff logged the creature choosing
between trees — `help the tree`, `play the tree`, over and over — because a
town's built-up area is a ring roughly 16 to 40 units wide and there was nothing
in reach to be impressive at.

The siege was the wrong thing to solve with distance:

> **A beast putting on a show is not laying siege.** Only a creature at *war*
> counts as a besieger.

Which frees it to stand where the buildings are.

### The leash finally means something

Two rules, one flag — `LEASH_MODES.compassion.peaceful`:

- a creature in foreign streets on any other leash makes its own war there, as
  it always has;
- on the Leash of Compassion it is a guest, and does not go to war at all.

Until now, changing the leash could not call your creature off a fight — the
banner outranked it — which made *Leash of Compassion* a label on a control that
could not do the one thing its name promised. It is a stand-down order now, and
it is the same rule a rival god plays by: its courting stance sets exactly that
leash.

---

## Balance, measured rather than guessed

Every number below moved because a soak said so.

**A rival creature took my capital at 1:56.** `CREATURE_SIEGE_WORTH` is 3 and
`CAPTURE_ATTACKERS` is 3, so a creature alone was exactly a capturing force —
a power the player had earned and nobody could use against them. Symmetric, it
meant a rival's beast wandering into an undefended square knocked the wall down
on its own and had the town before the raid grace expired. So: the creature
still brings the wall down and still holds the ground, but **a monster cannot
accept a surrender.** Somebody has to come and take the keys.

**Eleven captures in seven minutes.** Marrow went 3 → 2 → 4 → 1 → 3; Duncove
changed hands four times in a hundred seconds. Nothing was wrong with any single
capture — a capture resets the wall and every other army in the square simply
starts again. The sequence was absurd and unreadable. `CAPTURE_GRACE` is the new
garrison getting the gate shut.

**Awe 0 → 1.0 in ninety seconds.** My arithmetic assumed a dance every three
seconds; a probe measured eleven every thirty. `IMPRESS_PER_DANCE` came down to
0.030, which puts a peaceful conquest near three minutes — and three minutes is
a real price, because the creature is standing in a hostile town where the
garrison will attack it, and a courting beast does not fight back.

**And the player, unattended, died at 4:38 every time.** Traced at the moment of
the fall:

```
284s wall=116 bes=7 men=7(2) beasts=0 garrison=0 pop=26
...
291s wall=20  bes=8 men=8(2/4) beasts=0 garrison=0 pop=24
```

Wall 116 to 0 in six seconds, **garrison zero** — no creature involved at all. An
unattended player never builds a barracks, and `SELF_BUILD.ALLOWED` forbade
their people from building one, because the grand and the warlike were left to
the player on purpose. That was a fair division while nobody could take your
seat; once rivals could, it was a hole with a five-minute fuse on it.

Twenty-six villagers with no soldiers is not a difficulty setting. It is a town
that cannot play. Your people may now raise a barracks **once somebody has
marched on them** — gated on a declared raid, so a peaceful game still looks
peaceful, and the choice to militarise is still yours right up to the moment
somebody makes it for you.

| | before | after |
|---|---:|---:|
| Player survives, unattended, 5 civs | 4:38 | **11:09** |

---

## Bugs this phase uncovered in older code

**Rival soldiers would not fight each other.** `nearestEnemy` ran its own
hostility test — `o.town.isPlayer === s.town.isPlayer` — and disagreed with
`hostile()` twenty lines below it. Two rivals were both `false`, so under *that*
test their soldiers were allies: they marched on each other, arrived, and stood
in the same field without drawing a sword.

**The player was blamed for demolitions on the far side of the island.** Razing
credited `!b.town.isPlayer` — "razed by whoever it did not belong to" — which is
an inference, and it was already wrong before this phase. Two rivals fighting
razed rival buildings; the test asked only who *owned* the rubble. Who swung is
recorded now.

**`creature-grown` could never be earned by anybody.** The test read
`state.creature.size >= 0.98`. There is no `size` on that object — it is
`scale`, and it runs 0.85 to 2.3. So the expression was `undefined ?? 0 >= 0.98`:
permanently false, permanently silent, for nineteen phases. Exactly the shape
Phase 17 wrote down twice — *a statistic declared and never written looks like a
working feature.*

**Villagers ignored a rival raiding party.** `threatNear` used the same
`isPlayer !== isPlayer` test, so a rival's soldiers were no threat to another
rival's farmers: an army could walk into a village and nobody in it would look up.

**Kills and razings were scored for the player only.** `enemiesKilled` feeds
`efficiencyOf`, which divides kills by losses to weight the Military score.
Every rival would have gone into that division with a numerator of zero.

---

## And one I introduced, then reverted

The first version of the witness rule was "learn from any deed you did not do
yourself". It is philosophically tidy and it is wrong, and a soak said so in one
line: the player's creature came out of five minutes with its `attack` weight
pinned at the 2.00 ceiling and a log full of *watched you strike villager* — none
of which the player had done. It was standing near somebody else's war.

Under that rule, **being attacked would teach your creature to attack.**

The faithful mirror of the original is `e.by === faction`: a creature learns
from what its own god does, through anything other than itself. Your creature's
morals are yours, and they should come from you.

---

## Performance

| | |
|---|---|
| Sim tick, 5 civs, 5 creatures, 40 min | **0.147 ms** |
| Sim tick, 2 civs | 0.069 ms |
| `rivalGods.simStep` | inside the noise — one decision per god per 4 s |

Four extra creatures are four extra minds at `DECIDE_INTERVAL`, two extra draw
calls each, and no extra lights. A rival god thinks fifteen times a minute; it
is not an RTS macro.

A 40-minute five-civilisation soak: no errors, the reckoning validates
(`ok: true`, zero drift, zero duplicates blocked), and the summary reads

> *Marrow ends the age ascendant, strongest in Civilization, on 2 taken by
> force, 63 buildings standing. Your Kingdom was the nearest rival, strongest in
> Divine Influence, but finished 6,447 behind.*

Which is a sentence this game could not produce a day ago.

---

## Deferred

- **Rival gods still cast no miracles and move no earth.** They command a
  creature and nothing else. Giving them the hand is a phase of its own, and
  probably a worse game — a god who can raise a mountain under your town is not
  an opponent, it is weather.
- **`capitalOf` picks the biggest town a faction holds** when its founding town
  is lost. That is a guess, not a strategy; a god driven out of its capital does
  not currently *try* to take it back.
- **No diplomacy.** Everyone who is not you is hostile to everyone who is not
  them. Two rivals cannot ally against the leader, which is the obvious next
  thing a five-way game wants.
- **The awe route is still hard to discover** — now for four more participants
  than before.


---

## Addendum — the beasts fight each other

Reported after the first launch: *"the animals are not defending against other
animals."* Exactly right, and for a reason that reads as an oversight only in
hindsight.

`warTargets` gathered **soldiers, villagers and buildings** — a complete
enumeration of everything hostile in the world, right up until this phase put a
creature behind every banner. After it, two monsters could stand in the same
square razing each other's villages and neither would look up.

Four things had to change, and three of them were only visible once the first
one worked.

**They can see each other.** Creatures join the target list, `swipe` gets its
own branch for them — damage through `takeDamage`, so the other animal applies
its own defense and banks its own pain — and emphatically *not* the villager
branch, which would have had one beast eat another.

**A hostile beast in your borders is a war.** `nearestIntruder` reads the
soldier grid, so an intrusion meant men. Without this a rival's monster could
walk into your streets, start pulling your houses down, and never become a war —
so your own creature had no front to be called to and stood at home watching it
happen.

**Being attacked is a war too.** The first test was an execution, not a fight:
the beast standing in the player's square was not at war by its own god's
reckoning — its army was home and nobody was in its land — so it never fought
back and never doubled its defense. Twenty health to routed in five seconds
without swinging once. An animal being mauled does not wait for orders.

**And you cannot bind your wounds with a lion standing over you.** `WAR_REGEN`
was tuned against soldiers, who do not follow a creature that has broken off.
Another creature does, and both sides withdraw and rejoin at the same
thresholds, so they mirror each other exactly:

> fight to 7 → both break off → both heal to 18 → fight to 7 → …

A ten-minute duel ran four full cycles and **neither animal routed.** My fox got
as low as 1.9 and walked away at 20. Regeneration now stops while a hostile
beast is within `HEAL_BLOCK_RANGE`, and a hurt animal has to actually get clear.
The same duel now settles in fifteen seconds.

### One near-miss

`nearestBeastIntruder` first asked whether the intruding creature was `atWar`,
which is the obvious question and would have blown the stack on the first frame
two beasts stood near each other's towns: `A.atWar` → `frontFor(A)` → *is
anything in A's land?* → `B.atWar` → `frontFor(B)` → `A.atWar` → …

The **leash** answers the same question and cannot recurse, because it is a
setting rather than a derivation — and it is the identical rule `warFront`
already used for the player's own beast. A creature on a peaceful leash is
courting; anything else in your land is an invasion whatever it thinks it is
doing.

### What it looks like

Sized from the arithmetic and then checked. Both sides double attack *and*
defense under `WAR_MULT`, so the multipliers cancel and an even fight runs at
`WAR_ATTACK_CREATURE` per second over 20 health:

| | |
|---|---:|
| 3.2 (first guess) | 6 s — too fast to see, let alone react to |
| **0.9** | **22 s** — long enough to watch it turn and get a hand in |

Temperament decides it. Fox *(Ferocious/Clever)* against lion
*(Ferocious/Thick-hided)* is not an even fight, and the lion won it in fifteen
seconds.

A 22-minute unattended five-god soak, with nothing placed by hand:

- **all ten possible pairings met and fought**
- beasts driven off the field repeatedly — Kelvedon's polar bear six times
- and every creature on the island independently learned
  `creature.threat = 1.00`, through the existing pain-teaching path, with no new
  code at all

Which is the nicest thing about it: **the creatures worked out on their own that
other creatures are dangerous.**


---

## Addendum — five more things to ask for

Reported after playing: *"we need more variety of prayers, not just starving."*

There were already five categories. Four of them were nearly invisible, and one
line was most of the reason.

### The bug underneath the complaint

A town may hold `MAX_PER_TOWN` open prayers. Communal ones are one-per-town by
construction, but **individual hunger is one per starving villager and nothing
capped it** - so in a town of sixty, four hungry people filled all four slots
and every other condition in the game was rejected before it was looked at.

| A 30-minute soak, before | |
|---|---:|
| Hunger prayers raised | **40 of 55** |
| Rejected as `townFull` | **947** |

So it was not that the other conditions were rare. They could not get in.
`MAX_PER_CATEGORY: 2` is the fix, and it is worth more than any of the five
categories below.

### The five

Each asks for a **different action**. Five prayers all answered by the food
miracle would be one prayer wearing five hats.

| | asks | answered by |
|---|---|---|
| **Ruins** | *they pulled down our mill; raise it again* | **build** that kind of thing |
| **Barren Ground** | *the ground here will take nothing we build* | **sculpt** — level the land |
| **Faith** | *it has been a long age since we saw your hand* | **cast** anything, where they can see |
| **The Beast** | *Ashfell's beast is in our fields* | **drive it off** — your creature or your army |
| **Parched Fields** | *our fields are cut to the root* | the **Water** miracle, over the fields |

Two of those are worth calling out.

**Barren Ground is the only prayer that has ever asked for the sculpting tool** —
the player's signature power, requested by nobody in twenty phases.

**Parched Fields is the only reason the Water miracle exists.** It is the
cheapest of the four and, until now, the one with the least to do. The prayer
is specific: a fireball over their fields does not answer it, and a soak
confirms that.

### Every threshold here was measured, and my first guess was wrong four times

I wrote the conditions from what the code looked like it did, then ran them.

| | guessed | measured | set to |
|---|---:|---:|---:|
| Crop average that counts as parched | 0.35 | floor is **0.36**, median 1.00 | **0.55** |
| Town mood that counts as flagging | 0.62 | a working town sits **0.70–1.00** | **0.85** |
| Buildable land that counts as stuck | 0.32 | settled sites run **0.60–0.98** | **0.55** |
| Seconds homeless before praying | 40 | see below | *category deleted* |

Three were simply below anything the game ever produces, so the prayers could
not fire at all — the same shape as `impress` earlier this phase, and I walked
into it again.

### The prayer I deleted

**Shelter** was to fire when `growthBlocker` reported `housing`. It read
beautifully. Measured over four hundred seconds of a real town, that condition
was true for **none of it**: Phase 20's self-build raises a house every fourteen
seconds out of a stockpile holding four thousand timber, so your people are
never short of a roof for long enough to pray about it.

A prayer whose condition is always false is not a prayer. What *is* always
happening is raids pulling buildings down, and nobody had ever asked for one
back — same verb, live trigger, and a better moment: the quiet after the
fighting, when somebody points at a gap.

### Who gets the credit

Phase 19 wrote the rule when the rain stopped counting as the player's doing,
and three of these needed it:

- your own villagers rebuilding it themselves closes as **`nobody`** — no
  belief, no mercy, no reset of the neglect streak. `building-placed` now
  carries `by: 'player' | 'people' | 'rival'`, because it could not tell before;
- a beast that **wanders off** is `nobody`; one **driven off the field** is you;
- fields that come back on their own are the soil's doing, not yours.

And Barren Ground **re-measures the land** rather than trusting the event:
`terrain-changed` fires for any deformation, including a crater. Verified —
digging a pit beside them leaves the prayer open at 0.38; levelling closes it
at 0.75.

### A guard, which immediately earned itself

Every category needs three things: a `CATEGORIES` entry, a `LIFETIME`, and a
`byCategory` counter. Miss the lifetime and `expires` is `NaN`, `t >= NaN` is
false forever, and the prayer never leaves the active list — this project's
oldest failure mode arriving through a typo. Miss the counter and the statistic
is silently `NaN` for the session.

`assertCategoriesComplete` checks all three at boot and throws. It caught me
renaming `shelter` to `rebuild` in two places out of three, on the first run
after I wrote it.

### Result

One 35-minute five-god game, unattended:

| | before | after |
|---|---:|---:|
| Hunger's share of all prayers | 73% | **38%** |
| Distinct kinds seen in one game | 3 | **7** |
| Rejected as `townFull` | 947 | **0** |

No errors, the reckoning validates, 0.119 ms/tick, and the active list ends at
zero with history at its bounded ceiling.

### Deferred

- **`supply` still barely fires.** It needs growth blocked on wood or ore *and*
  under 25 of it, and a town with four thousand timber never qualifies. It is
  the same "condition that is never true" problem as the shelter prayer, and it
  wants the same treatment - measured, then re-aimed or replaced.
- **Barren Ground is terrain-dependent** by design, and on a generous island it
  correctly never fires. That is right, but it does mean a player may go several
  games without meeting it.


---

## Addendum — the cattle farm has cattle in it

Asked for after playing: *"redesign the cattle farm and make it look like a
cattle farm."* Fair. Here is the honest description of what was there:

> four runs of fence around an empty square, with a lean-to and a cart in it

Nothing in that says cattle, and the reason is embarrassing once you see it:
**there were no cattle.** The town kit has no animal in it, so the building had
been standing in for livestock with a fence since the day it was added.

### Where a cow comes from

`animal-cow` — from the Cube Pets kit, the same twenty-four models the creature
picks from, flattened to a static geometry. No mixer, no skinning.

That immediately rules out putting them in the building. The town kit and the
pets kit are **different texture atlases**, and a cow merged into the paddock's
geometry would sample the town colormap and come out as garbage. So the herd is
a second instanced mesh riding the paddock's own instance matrices:

> It holds **no state of its own.** Every sync copies the cattle mesh's matrices
> wholesale, so the herd is incapable of disagreeing with the pens — including
> on the demolish path, where the last slot is swapped down into the freed one
> and a herd keeping its own list would be one cluster out of step forever.

One extra draw call for every cow on the island.

### Four passes, each one a screenshot

I could not reason my way to this. Every version had to be looked at.

**v1 — the cows were bigger than the barn.** I sized them with
`sizeToWidth(0.95)`, and the kit's fence is 1.0 long but only **0.38 tall**, so
they came out at nearly three times the height of the rail. Width is the wrong
axis for an animal: measure the thing it stands next to. `sizeToHeight(0.5)`.

**v1 — two roof slabs hanging in the air.** I put the gable end caps a cell
*beyond* the barn instead of on its end bays. They roofed nothing.

**v2 — the fence was scattered posts.** Panels are 1.0 long and the old paddock
stepped them by **1.15**, leaving a 15% gap between every pair and open corners.
This is what measuring the pieces fixed rather than guessing at them:

> A `fence` is 1.0 on Z, 0.38 tall, and its geometry sits on the **+X face** of
> its cell (bbox centre x = 0.46) — the convention every wall module in this kit
> uses. A rail along Z is `rotY 0` placed half a panel in; one along X is
> `rotY ±90°`. Step by exactly 1.0 and they abut.

**v3 — the barn looked like it was outside the pen.** I had broken the back rail
where the barn stood, and a gap *beside* a wall reads as a hole in the fence. A
rail that disappears behind a building is fine; run it the whole way.

**v4 — the trough was a village water feature.** The kit has no trough, so I
used `fountain-square`, which is exactly right — a low stone basin is what an
animal drinks from — at exactly the wrong size. At 0.85 it filled a quarter of
the yard. At **0.45** two cows can get their heads in it. (The version before
that used `stall`, which is a *market* stall, canopy and all. Two of them in a
field read as a village fete.)

### What it is now

A **two-bay barn** with a gabled roof and the door facing into the yard — long
and low, which is the difference between a byre and a hut. A **continuous rail**
on all four sides with a **gate** hung in the front of it. A **water trough**, a
**hay cart** drawn up against the fence, a hay rack by the barn door — and
**six cows**, at irregular angles and slightly irregular sizes, because four
animals on a grid facing the same way is a diagram and a herd is a huddle.

Verified at scale: 31 paddocks built, the herd mesh grew 24 → 48 alongside the
pens, three demolished from the middle, and **zero matrix mismatches** between
pens and cattle afterwards. 127 draw calls, nothing over budget.


---

## Addendum — the animals were getting stuck around the castles

Reported after playing: *"the animals are getting stuck around the castles late
in the game."* Both halves of that were exactly right, and "late" was the clue.

A creature is pushed out of a keep by `TOWN.CENTRE_SOLID` **plus its own bulk**,
and its bulk grows with it. So the radius it is held at climbs all match:

| scale | held at |
|---:|---:|
| 0.85 (hatchling) | 12.0 |
| 1.69 | 13.5 |
| 2.30 (full grown) | **14.6** |

Every stuck creature in the soaks sat at exactly that number. Instrumenting for
"has not moved a metre in sixty seconds" found **five separate causes**, all of
which get worse as the animals grow, and one of which I introduced the day
before.

### 1. A razed town still counted as a war

Kelvedon ended a soak with **pop 0 and 0 buildings** — a castle standing alone in
a field. `warFront` still called it hostile ground, so the player's fox was at
war *because* it was standing there and standing there *because* it was at war.
Five minutes at a stretch, seeing zero soldiers, zero villagers, zero buildings.

`worthFighting` now asks whether anything is left. The castle instance
deliberately does not count: it cannot be attacked or captured once the town is
empty, and treating it as a prize is the whole bug.

### 2. The healing deadlock I built on Wednesday

`HEAL_BLOCK_RANGE` stops a creature binding its wounds with an enemy standing
over it. It tested `inField` — alive and not routed — which is **also true of an
animal that has broken off and is bleeding.** So two beaten creatures near the
same keep each blocked the other from healing, neither could reach `WAR_REJOIN`,
and neither had any reason to move. One was found motionless for **eleven
minutes on 0.2 health**.

The test is `fighting` now: alive, not routed, **not withdrawn**, not peaceful.
You cannot bind your wounds with a lion standing over you. You can bind them
next to a lion that is also lying down.

### 3. Retreat walked into a wall

`retreat` aimed at `homeTown().centre` with a stop distance of `ARRIVE_DIST` —
and the middle of a castle is solid. `walkToward` correctly reported "blocked and
getting no closer, so this is as near as I will ever be", the animal stopped dead
against the stone, and every retreating creature converged on the same few metres
of masonry. It now lies up **beside** its keep, clear by its own bulk plus a
margin, on the far side from whatever is still standing over it.

### 4. A tug of war between the summons and the war

`simStep` has claimed since Phase 3 that a summons outranks the war, and the
ordering does hold — the war branch will not clobber a summoned action. What
nothing stopped was the oscillation: outside its circle the summons pulled it
back, once inside the war marched it toward a front on the far side of the
island, a step later it was outside its circle again. A soak caught one
alternating **89 ticks summoned against 111 at war over ten seconds**, shuffling
on the spot. A summoned creature now fights what comes to *it*.

### 5. Walking at a boulder inside a castle

`foundTown` flattens ground and drops a castle on it — but unlike `place`, it
never clears the trees and rocks that were already there. So a prop can end up
sitting inside a keep, and a creature that decides to eat it walks at the wall
forever. The `approach` phase is an older, second copy of the movement loop and
**never got the blocked-and-no-closer guard** `walkToward` has had for phases.

Both ends fixed: things buried in a keep are not candidates, and the approach
walk gives up rather than standing there.

### ...and two that were not about castles at all

**A god with no land still has a creature.** `homeTown` is null for a faction
driven off the island, `retreatSpot` had nowhere to point, and the retreat branch
answers that with `speed = 0` — for the rest of the match. Worse, `withdrawn` is
sticky between `WAR_WITHDRAW` and `WAR_REJOIN`, so the action was *recreated
every tick* and the ordinary mind never got a turn.

**There was no wandering.** The mind scores objects it can see, plus self-acts
that need no object. A creature standing where nothing is in `SENSE_RADIUS`
always picked a self-act, and neither sleeping nor grooming moves it — so it
groomed, slept, and groomed again in the same square metre, and nothing new could
ever come into range because it never went anywhere. Nearly five minutes in open
country, and it would have stood there until the bell. It roams now, but only
when the candidate list is genuinely empty, so it can never outcompete a real
decision.

### Result

Same seed, same island, forty minutes, five gods:

| | before | after |
|---|---:|---:|
| Longest a creature stood still | **2,135 s** | 69 s |
| Stuck events (a minute motionless) | 6 | **1** |
| ...of those, at a castle | 6 | **0** |

The one survivor is a creature mid-action **89 units from any castle**, which is
just an animal eating something.

Tested against the worst order a player can actually give: a minimum-radius
summons dropped dead on a castle centre. `summon` now pushes the spot clear of
any keep — by the bulk of a **fully grown** creature rather than its bulk today,
because an order that quietly stops working twenty minutes after you gave it is
worse than one that was never accepted. It resolved to 14.6 and the creature
obeyed it without sticking.


---

## Addendum — the phantom births

Reported after playing: *"citizens are reproducing fast enough."* I have read
that as **"aren't"** - say the word if you meant it the other way and I will put
the ceiling back where it was. Either way there was a real bug underneath, and
it cost food.

### The town asked the wrong question

`villagers.spawn` refuses once **the whole island** holds `VILLAGER.MAX` people.
`growthBlocker` asked whether **this town** had reached it.

So on a full island a town of thirty answered "nothing is stopping you", paid
`GROWTH_FOOD_COST`, called `spawn`, got `null` back, and announced a birth that
never happened. Every fourteen seconds. Forever.

A thirty-minute soak, before:

| | |
|---|---:|
| Births announced | 534 |
| Deaths | 225 |
| People actually alive | **150** |

534 − 225 = 309 net against 150 real, so roughly **159 of those births were
phantoms** - and about 1,900 food went with them. It also inflated the
reckoning's birth statistic, because `villager-born` fired for each one.

The order was wrong as well as the test: it paid first and announced regardless
of what `spawn` gave back. Now it pays for what actually arrived, so if this
ever refuses again it costs nothing and says nothing.

### And the ceiling was one number for any number of gods

`VILLAGER.MAX` was a flat 150 - **island-wide**, every town drawing from one
pool. That was a fine number when there were three towns and only one of them
was being played. Split five ways it is thirty people each, and a
thirty-person civilisation does not feel like one.

It is the fifth number `setCivilisations` writes, for the same reason as the
other four: leaving it fixed means every extra civilisation quietly makes all of
them smaller.

| civs | cap |
|---:|---:|
| 2 | 150 *(floored - small games are exactly as they were)* |
| 3 | 180 |
| 4 | 240 |
| 5 | 300 |

Ceilinged at 320, because this number is the size of a dozen instanced buffers
and the per-tick cost of every villager mind on the island.

### Result

Thirty minutes, five gods, same seed:

| | before | after |
|---|---|---|
| Island population | 150 by minute 22, then flat | **34 → 263, still climbing** |
| Biggest town | 76 | **89** |
| Births vs deaths vs alive | 534 / 225 / 150 — *does not reconcile* | 619 / 390 / 263 — **exact** |
| Sim cost | 0.26 ms/tick | **0.34 ms/tick** |

263 villagers cost a third of a millisecond in a fifty-millisecond tick. The
reckoning still validates.

### Left alone deliberately

`TOWN.GROWTH_INTERVAL` is still 14 seconds **per town**, regardless of how many
people are in it - so growth is linear, not compounding, and a town of eighty
gains people no faster than a town of eight. That may well be the next thing to
look at if it still feels slow, but it is a much bigger balance lever than the
cap and nothing in the measurements said it was wrong.


---

## Addendum — a breach is permanent

Asked for after playing: *"once it is breached they are done playing the game."*

Walls rebuilt at `WALL_REGEN` 1.5/s whenever the siege lifted, so a 120-point
wall was whole again in eighty seconds. An army that broke through, was beaten
off and came back found the same wall waiting. **Nothing an attacker ever did
left a mark**, which made a siege something you could only win in one
uninterrupted go and made losing one cost nothing at all.

`town.breached` latches the first time the wall reaches zero and is never
cleared - not by time, not by the siege lifting, and **not by the town changing
hands.** That last one is the important half: `capture` used to set
`wallHp = WALL_HP`, which would have undone the whole thing, since every town
worth taking has been breached by definition. Taking a town does not hand you an
intact fortress. It hands you the ruin you made of one.

Damage still repairs. Masons work on a cracked wall; nobody rebuilds a breached
one. So the breach is the thing you are fighting for, and it is worth fighting
for because it is the only part that lasts.

### What it did to the game

I expected churn - a town with no wall is a town anyone can walk into - and got
the opposite. Two forty-minute five-god soaks:

| | seed 5150 | seed 31337 |
|---|---:|---:|
| Towns breached | 4 | 2 |
| Captures in 40 minutes | 5 | **2** |
| Towns still holding an intact wall at the end | 1 | 2 |

Sieges became **rarer and decisive** rather than frequent and reversible,
because `CAPTURE_GRACE`, `CAPTURE_NEEDS_A_SOLDIER` and the garrison test all
still stand between a breach and a capture. And a breach is not instant death:
the player's capital was opened at 899s and did not actually fall until 1439s -
**nine minutes** to hold the gap.

Both matches were won by the god whose walls never broke, taking towns off gods
whose had. That is a better story than either soak told before.

### One thing this turned up

With walls permanent they are worth scoring properly, and they were not:

```js
g.wallFrac += clamp((town.wallHp ?? 0) / 900, 0, 1);
```

The wall maxes at **120**. So `wallFrac` - a value the code and its own name say
runs 0 to 1 - could never exceed **0.133**, and walls contributed an eighth of
what they were designed to in both Military and Stability. A stale literal from
back when `WALL_HP` was a bigger number.

It is `CFG.WALL_FULL` now. reckoning.js may import no gameplay system - that is
its whole contract - so the value is mirrored in scoreconfig.js with a note
saying, in capitals, to move it if `COMBAT.WALL_HP` moves. A duplicated constant
is a hazard; this is the one that already bit.


---

## Addendum — your creature turning on your own

Reported after playing: *"my animal is destroying my properties"* - and then,
*"and citizens."*

The intent had been written down since the creature could see people at all:

> People are not all alike to it. An enemy is prey and a rival's town is a
> larder; **its own people are not.**

The comment was right. The number never delivered it. `FRIEND_RESTRAINT` is
0.35 - a 65% discount - and `attack` trains up to 2.0 against a leash bias of
2.6. So the moment you raise the war-beast the game invites you to raise, it
comes home and starts on your own village, which is where it spends most of its
time and where the nearest living thing always is.

A 65% discount is not a taboo. It is a mild preference.

### Measured, before

Well fed, on the Leash of Aggression, `attack` trained to its 2.0 ceiling,
standing in its own town:

> **Four of its own people in five minutes.**

Not hunger - hunger was pinned at 0.2 the whole time. And a friendly building
does not even have hit points: `attack` on one **demolishes it outright**, in a
single act.

An unattended soak found almost none of this, which is why it had never shown
up: nothing trains the player's creature when nobody is playing it. This is a
bug you can only find by doing what a player does.

### The rule now

- **Never attack your own** - people or buildings, at any hunger, however
  trained. There is nothing to be gained from it: a friendly building is
  demolished outright and a friendly villager simply dies. Pure loss, and no
  amount of training should buy it.
- **Eat your own only when genuinely starving** - `FRIEND_PREY_HUNGER` 0.85,
  which is a beast that has not eaten in well over a minute and has ignored
  everything else it could have eaten first.

That second one is deliberate. A creature left to starve turning on the people
feeding it is a consequence the player earned, and it is worth keeping. A
well-fed one doing it because somebody trained it for the war is the complaint.

### Measured, after

Two and a half minutes each, on a quiet island inside the raid grace so the
utility mind is actually the thing being tested (`atWar: false` in both):

| | fed + trained to fight | starving + gentle |
|---|---:|---:|
| Own villagers killed | **0** *(was 4)* | 1 |
| Own buildings razed | **0** | 0 |

What the fed one did instead, over 2,500 sampled ticks: **`play/villager` 2020,
`play/house` 216, `play/tree` 291, `groom`, `eat/tree`.** Not one `attack` on
anything of its own. An aggressive beast at home is boisterous, not murderous -
which is what it should have been all along.

And the starving one worked through **`eat/boulder` 218 and `eat/tree` 330**
before it touched anybody. It eats the scenery first. It turns on your people
last, and only if you have let it get that far.


---

## Addendum — three from one session

### The battle flag was house-sized

*"The battle flag needs to be bigger, when it gets real populated I can't see
it."*

It was `sizeToHeight(flag, 7)`. A house is 7 wide and about as tall, a manor is
10.8 and a barracks 11.9 - so the one object the player must be able to find was
the same size as the forty objects around it, and any decent building simply
stood in front of it.

**13 now**, which clears every building on the island except the castle (21,
and meant to dominate). Sized against the things beside it rather than against
the scene - the mistake this project has now made with the barracks, with a
lantern, and with a cow, and this is the fourth time.

Height alone is not the fix, though. A pole tall enough to see over the roofs is
still hidden by the keep from half the angles this game is played at, so the
banner also gets **a ring on the ground drawn through everything** - the same
`depthTest: false` mark prayermarks.js uses, for the reason it gives:

> a marker is an affordance, not scenery

It pulses slowly so the eye finds it in a crowd without it shouting, and it is a
flat ring rather than a second flag because it needs to say WHERE without adding
another silhouette to a busy skyline. The grab volume is now derived from the
height instead of written twice, so the next person to resize the banner cannot
leave the invisible handle behind.

### Watering the fields did nothing

*"Raining the fields with water does nothing for the prayers."*

Right, and the arithmetic says why in one line. The Parched Fields prayer asks
for *"water, over the fields themselves"*. It was matched by
`near(prayerPos(p), pos, ANSWER_RADIUS)`, and `prayerPos` for a communal prayer
is **the town centre**.

| | |
|---|---:|
| Water miracle reaches farms within | **22** of where it falls |
| Prayer matched a cast within | **34 of the keep** |
| Farms actually sit | **20 to 120** from the keep |

So the cast that does the mechanical work - water on the crops - was almost
always too far from the centre to count, and the cast that counted did nothing
for the fields. **Doing exactly what the prayer asked for could not answer it.**

Two fixes, and the first is the one that matters:

- the prayer is answered if the water falls on **any of that town's farms**,
  which is the question it was always about;
- and its marker now hovers over the fields rather than the keep, so the game
  points at the place it wants you to cast.

Proven on a farm **62 units** from the keep - a distance the old rule could
never have matched - which now answers, with the crop going 0.1 to 0.8.

### A god with nothing to spend

*"Start the game with 500 belief."*

It started at zero, and belief only trickles in from a happy population at about
fifteen a minute. The four miracles cost 20, 30, 45 and 55, so the opening of a
god game was ninety seconds before you could do anything at all and closer to
four minutes before you could do anything dramatic.

`MIRACLE.START_BELIEF` is 500 - a dozen or so miracles, enough to *be* a god
from the first second, and not enough to coast on: the trickle still matters and
the 999 ceiling is still somewhere to climb to.

**It lives in MIRACLE and not beside START_FOOD**, and that is worth writing
down because I put it in the wrong place first. Seeding it in town.js next to
food, wood and ore reads correctly, builds clean, and does nothing: miracles.js
initialises *after* town.js and opens with `state.resources.belief = 0`. Belief
is miracles.js's to own, so the constant belongs where the assignment is. The
test caught it - opening belief came back as 0.118 instead of 500.


---

## Addendum — a panel for the beast

*"Need a UI for the creature with HP and stamina. Make it cool."*

Everything about the animal was either invisible or buried in the debug panel.
Its health only existed as a number you could not see, and stamina - `energy` -
drove whether it would work, fight or lie down, with nothing on screen saying so.

### What it shows

Bottom-centre-left, in the strip between the controls and the build hint, which
was the one piece of the frame nothing else wanted and is near where the eye
already is while you are commanding it.

| | |
|---|---|
| **Health** | green above 60%, amber to 30%, red below - and the bar itself breathes when it is under a third |
| **Stamina** | `needs.energy`, in the pale blue the Leash of Learning uses |
| **Fed** | `1 - hunger`, gold, turning red under 35% and reading **starving** under 18% |
| Species and its two born traits | the reason it fights and learns the way it does |
| How grown it is | `scale` between START_SCALE and MAX_SCALE, as a percentage |
| The leash | with a pip in that leash's own colour |
| What it is doing | *In the fight, Hurt, Hauling wood, Sleeping, Performing, Driven off…* |

The whole panel takes a warning border and a red glow while it is at war or has
been driven off the field. One cue for "something is happening to your animal",
not five.

### The bit that makes it feel like a game

**A damage tail.** Each bar is a track, a *ghost*, and the fill. On a hit the
fill snaps down in 180ms and the ghost drains after it - 220ms later, over
550ms - so a blow reads as a red tail bleeding away rather than a number
changing. Verified rather than assumed: 320ms after an 11-point hit the fill
measured **179px against the ghost's 219px**, and a second later both sat at 179.

It costs nothing, because it is entirely CSS. Which is the whole reason for the
one rule this panel is built on:

> **Built once, then only measured.**

Every bar width is an inline style on a cached element. Rewriting `innerHTML`
each frame - which is how every other panel here works, and is fine for them -
would recreate the nodes and throw the transitions away, so the ghost would
never lag and the bars would jump. The refresh is 10Hz; the CSS carries the
motion in between.

The bars are also notched, with a repeating gradient, so they read as gauges
rather than smears of colour.


---

## Addendum — surfacing the peaceful victory

Asked for: make the awe route discoverable. It works, rival missionary gods use
it, and the game said nothing about it whatsoever - `awe 0%` in a corner panel,
with no verb attached.

### It was never announced

`addImpressiveness` has moved the meter since Phase 9 and the only trace it ever
left was a line in `debug.lastLog`, **for the player alone**. So it is a fact on
the bus now - `awe-changed`, carrying `from` and `to` so a listener can spot a
crossing without keeping its own copy - and three things listen:

- **The HUD speaks at the quarters**, in both directions. A rival god courting
  one of your towns is a way to lose one and it was completely silent.
- **The bar explains itself.** `awe 0%` became *"wonders in their sight win them
  over"*, then *"100% and they join you"*, then *"almost yours"* - and while your
  creature is standing in their streets it reads **"they can see your beast"**,
  or **"your beast is winning them over"** while it performs, with the bar
  glowing. That is the moment the act and the meter connect.
- **Your own towns show it too**, in the courting god's colour.

Plus one line in the controls: *"**2** + send it into a rival town — it performs,
they come over."*

### ...and then it turned out not to work

Surfacing a route that cannot be finished is worse than leaving it hidden: the
player gets to watch it fail. The first ten-minute soak climbed to 21% and slid
back to zero.

The arithmetic says why, and it is not subtle:

| | |
|---|---:|
| `IMPRESS_DECAY` 0.004/s | **24 points a minute** off a meter that runs to 100 |
| `IMPRESS_PER_DANCE` | **3 points** |
| Dances needed just to stand still | **8 a minute** |
| A miracle's 0.16 evaporates in | **40 seconds** |

The decay is right in principle - awe you stop earning should fade - but it was
running **while you were earning it**, which turned courting into a race against
a clock nobody could win. `IMPRESS_GRACE` holds it off for 45 seconds after a
god last impressed that town, and starts it the moment they walk away.

Forty-five rather than twenty because **performing costs energy**: a creature
that dances keeps dancing until it is tired and then sleeps. That self-limiting
tension is worth keeping; a nap that undoes the whole courtship is not.

### The clean result

Fresh island, creature parked in Ashfell's streets on the Leash of Compassion,
nothing else touched:

```
  0s   0%     42s  "Ashfell is 25% won over"
 60s  36%    261s  "Ashfell is 50% won over"
180s  22%  <- it wandered off; attention matters
320s  80%    311s  "Ashfell is 75% won over"
380s  95%    370s  "Ashfell is nearly yours - 90% in awe of you"
492s  TAKEN  472s  "Ashfell has joined you"        how=awe
```

**Eight minutes for a bloodless conquest**, legible the whole way, with a real
dip in the middle when the animal lost interest.

### The mistake I made measuring it

Between the broken run and the working one I spent four probes chasing a bug
that did not exist - the meter reading 0% while the creature was demonstrably
performing 22 times in three minutes. The grant events eventually gave it away:

```
townName: "Your people"
```

**I was watching the wrong town.** Every probe had been running in the same
long-lived page, and seventeen minutes of simulation later the world had moved
on: towns had changed hands, and the creature was courting one I was not
measuring. Two of my "findings" in between - that villagers walk away mid-dance,
that the grace was not firing - were artefacts of a contaminated fixture.

A soak is a fixture. Reusing one across experiments is the same mistake as
reusing a database between tests, and it cost more time here than the feature.

---

## Addendum — the fifth civilisation had no ring

Reported while zoomed out: the fifth empire has no coloured band around it.

```js
const MAX_RINGS = 4;          // and, separately, in the shader:
uniform vec3 uInfCenter[4];
for (int i = 0; i < 4; i++)
```

Correct when the island held the player and three rivals. The Phase 20 picker
lets you start **five**, and `setInfluenceRings` clamps with `Math.min` - so the
fifth ring was not dropped loudly, it simply never appeared.

The number was written **twice**, once in JavaScript and once as a literal
inside the shader source, which is exactly how it got out of step. It is
`CIVS.MAX` now, interpolated into the GLSL, so the picker and the shader cannot
disagree again - the same "one number moves them all" rule `setCivilisations`
already follows for the other five.
