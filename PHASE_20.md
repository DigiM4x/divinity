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
