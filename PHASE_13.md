# Phase 13 — Achievements

Fifty of them, a menu on **I**, and a card that comes up when you earn one.

Also two bug fixes that arrived mid-phase and were worth more than the feature.

---

## The shape of it

One new module, `achievements.js`, and one new table in `state.js`. The design
rule is a single sentence:

> **Every achievement is "a counter reached a number."**

`state.js` owns the table of thresholds; `achievements.js` owns the counters.
That split is what keeps the feature from leaking. **No other system in the game
knows achievements exist** — nothing imports the module, nothing calls into it,
and adding a fifty-first achievement is a row in a table and nothing else.

```js
{ id: 'storm-caller', group: 'Faith', name: 'Storm Caller',
  blurb: 'Call lightning thirty times.', stat: 'miracle_lightning', need: 30 },
```

Counters come from two places, and the difference matters:

- **The event bus**, for things that happen at a moment — a birth, a throw, a
  town taken. Exact: every occurrence counted once.
- **Polling state**, twice a second, for things that are a *level* rather than an
  event — population, food, how big the creature has grown.

Polling is deliberate, not lazy. Adding an emit to `villagers.js` every time the
population changed would put an achievement concern inside a system with no
business carrying one, and a progress bar does not need 20Hz.

Several polled counters are **peaks**, not levels: the most food you ever held at
once, kept after you spend it. Belief needed special handling for the same
reason in reverse — it is *spent* on miracles, so the running total is not a
measure of what you have been given, and only the rises are counted.

---

## The fifty

| Group | Count | Range |
|---|---|---|
| Beginnings | 5 | your first building, birth, miracle, throw, kill |
| The Settlement | 8 | 10 → 100 buildings; hoards of food, wood, ore; one of every kind at once |
| The People | 7 | 20 → 75 population; 50 → 150 births; feeding them |
| Faith | 7 | 250 → 3,000 belief; 50 miracles; 30 each of water, lightning, fire |
| The Creature | 9 | earned traits, 200 lessons, full growth, 25 → 100 kills, four bodies |
| War | 8 | 50 → 150 enemies, 25 → 75 buildings razed, towns taken, raids weathered |
| Divinity | 6 | 50 → 250 throws, a 40 u/s hurl, ten thrown believers, saint, tyrant |

They persist in `localStorage`, because an achievement that vanishes on refresh
is not an achievement. A corrupt or unavailable store is swallowed — losing the
record is a disappointment, failing to boot is a bug.

---

## The menu and the card

**`I`** opens the menu; `Escape` or a click outside closes it. Grouped, with a
progress bar and `have/need` on everything unearned, and a star and the date on
everything earned — once you have it, what you want to know is *when*.

It renders **on open and never on a timer**. The list only changes when something
is earned, and rebuilding fifty rows of DOM every frame to animate a bar that
moves once a minute would be the most expensive thing in the HUD. The one moment
it can go stale is an unlock while it is open, so that path re-renders it.

Earning one raises a card at the top of the screen — gold, a pulsing star,
"ACHIEVEMENT UNLOCKED", the name, the blurb, your running total and a reminder
that `I` opens the list. Not a toast: a toast is for *"not enough wood"*, and
earning something should not look like being told off.

Cards are **queued, not stacked**. Several land on the same tick — laying a
fiftieth building trips Hamlet, Village and Township at once — and three cards
fighting over the same patch of screen reads as a glitch. Measured: seven
unlocks fired together played one at a time, in order, one DOM node.

---

## Two bugs, found from a report mid-phase

Both came from *"when sieging with the animal he destroys everything, it stops at
the castle and won't obey any movement commands"*.

### The creature went deaf

The summons check was gated behind `!atWar()`. Once a war front existed, **every
movement command was discarded** — and razing a rival's town does not end the
front, so it parked in the ruins and stayed there.

The sharp part: `combat.js` documents the opposite behaviour in its own comment —
*"Take it out of their land and the front disappears with it, which is what lets
you call it off simply by sending it somewhere else."* That was never true while
the gate stood. A direct order now outranks the war; ordering it *into* enemy
land still starts a fight, because on arrival it is inside its circle and war
resumes.

### Why it was stuck at all

The siege asked `countFor(town)` for the defenders — **every soldier that town
owns anywhere on the island.** Their raiding party marching on *your* capital was
counted as holding the wall behind them, so a town with every building razed and
every villager dead could never fall while one of their soldiers lived over the
horizon.

Now `defendersAt(town)` counts only soldiers within siege range. `countFor` is
unchanged: it is the right number for "how big is their army", just the wrong one
for "is this wall still held". Verified with six enemy soldiers alive and pinned
on the far side of the island — the town falls.

### And "NO ROOM FOR MORE OF THESE"

Reported alongside: five houses, then refusal. `CAPACITY = 256` was a **hard
ceiling on a number that only grows**, shared by every town for the whole game.
Three towns and a couple of captures reaches it; those five houses were 252–256.

The mesh now doubles when it fills. Verified 256 → 512 with 404 houses and zero
refusals, and the reallocation preserves instance order so every stored `index`
stays valid — 50 demolished afterwards with no bad or duplicate indices.

Worth noting separately: the capacity check sat *after* `terrain.flatten` and
after the wood was deducted, so a refusal charged you and left a flattened pad.

---

## Tuning: getting back from cruelty

Reported afterwards — *"make it easier to become less cruel"* — and the problem
turned out to be the **shape** of the system rather than any one weight.

Alignment was a pure accumulator with no way back but grinding. Cruel deeds
weigh about twice the best repeatable kind one, they arrive in bursts (a fireball
takes several at once, a hungry man-eater eats all day, taking a town is −0.30 in
a single stroke), and kind deeds are small and occasional. **Winning a war put
you on the floor, and there was no passive recovery of any kind.**

Two mechanisms, rather than re-tuning every weight:

**A redemption curve.** A kindness is worth more the further you have fallen; a
further cruelty costs less once you are already down there. Both scale with depth
and vanish at neutral, so a player who never went into the red never notices.
Deliberately one-sided — it is *not* correspondingly hard to stay good, because
that was not the complaint, and punishing sainthood to balance a table nobody
asked about is how you fix one thing and break another.

**Penance.** A slow pull toward neutral whenever you are in the red, doubled once
you have gone 25 seconds without a cruel deed. Always running rather than gated
on being clean, because a man-eating creature commits a cruelty every few seconds
and a gate would mean a player who chose that creature could never do penance at
all. It never pushes past neutral: this is absolution, not virtue.

| | Before | After |
|---|---|---|
| Feedings to climb from the floor to neutral | 34 | **10** |
| Doing nothing cruel, floor to neutral | never | **~83s** |
| Still cruel but easing off | never | ~167s |
| Two conquests and a dozen kills | −1.00 | **−0.97** |

That last row is the one that mattered: evil still has to be reachable, and it
is. Measured against the live system, not just the formula — 10 feeds and
0.0077/second of drift, matching the model.

---

## Tuning: mercy needed something to DO

Reported as *"make being merciful more easy"*, and then more precisely:
*"placing buildings should also influence mercy."*

Mercy was not hard because the numbers were mean. It was hard because there was
almost nothing to do. The only repeatable kind acts were feeding people and
waiting for children to be born — both occasional, both small — while cruelty had
a dozen sources and arrived in bursts. Adding a weight would not have fixed that.
Adding a *source* does, and the obvious one was sitting in plain sight: building
is the core loop, and putting a roof over someone is the plainest good deed a god
has available.

Raising a building now moves alignment by `+0.035 × mercy`, where `mercy` is a
property of each building type:

| Building | mercy | per placement |
|---|---|---|
| House, Farm, Cattle Farm | 1.0 | **+0.035** |
| Lumber Camp, Storage Pit, Workshop | 0.5 | +0.018 |
| Barracks | 0.0 | **nothing** |

A war-house is not a kindness, and raising one should not launder anything.

This is the **only** thing placing a building does beyond existing. An earlier
pass had it paying belief and widening your borders too; both were wrong and were
taken back out. Belief is what your people give you for wonders. Mercy is what
raising something for them says about you. They are not the same currency and
building should only touch one of them.

**Measured**: a house or farm gives +0.035 mercy, 0 belief, 0 reach; a storage
pit half that; a barracks nothing at all. From the very floor of cruelty, fifteen
homes bring you back to neutral — and combined with the redemption curve and
penance above, coming back from a war is now a thing you can actually do by
rebuilding what you burned, which is the right shape for it.

`town.js` announces the placement on the event bus and does none of this itself;
`miracles.js` and `achievements.js` listen, and neither imports the other. As a
side effect the `built` achievement counter is now a true lifetime total rather
than "the most you ever had standing at once", which is what deriving it from a
poll had quietly meant.

---

## The war machine: three reports

### "If a soldier dies in battle the barracks needs to reproduce it"

Replacement already happened — a death frees a garrison slot and the next cycle
refills it — but at **one man per 12 seconds for the whole town**, however many
barracks you had built. A skirmish costing eight men took a minute and a half to
undo, and the second barracks you paid for did nothing but raise the ceiling. So
losing a fight left you unable to answer for long enough that the fight was
effectively over twice.

A town now remembers how many men it owes itself, and pays the debt at
`REPLACE_INTERVAL` instead of `TRAIN_INTERVAL`. Both rates divide by the number
of barracks, to a limit of three. Replacements still cost food and ore — this
buys speed, not free soldiers. The debt is capped at the garrison cap, so a
garrison wiped out along with its barracks cannot carry an unpayable debt and
then dump an instant army when one is rebuilt.

A blocked cycle now retries in 1.5s rather than burning a whole interval. Waiting
twelve seconds because you were four food short when the clock struck was a
punishment for nothing.

**Measured**: five losses out of six, made good in **12.7 seconds**. It was about
sixty. The barracks panel says "replacing 5" while it works, so a rebuild does
not look like nothing happening.

### "The siege engine is not working correctly"

It was not the building, the cost, the cap, the click handler, the firing or the
damage — I tested all six and every one was fine. It was that **engines had never
been given orders.**

`engineTick` picked the nearest enemy wall and marched on it the moment the
engine existed. No banner, no army, no order. Ninety wood and seventy ore would
set off alone at half march speed, cross the island over about a minute, and
arrive by itself in front of a garrison. Soldiers have obeyed the banner since
Phase 5 through `goalFor`; engines simply never asked.

They ask now, by the same rule `warFront` uses, so the banner means one thing to
everything you own. With no order an engine holds with the army — but it still
batters any hostile wall already in reach of where it stands, so one parked at
the rally beside an enemy town is not idle and one defending home still fights.
It just will not go looking for a war on its own.

| | Before | After |
|---|---|---|
| No banner planted | marched 145 units at the nearest rival | **holds with the army** |
| Banner on the rival | — | advances 98 units, batters the wall |

### "I'm afraid the knight won't be either"

Tested, and the knights are fine: Militia → Men-at-arms → Knights upgrades in
order, the third upgrade is correctly refused, and a knight fields at 3.2 hp and
1.80 power — exactly the tier table. The suspicion was reasonable, since the
engine and the upgrade are two rows of the same panel, but only one of them was
broken.

One thing did turn up while checking: `spawnSoldier` stored the level *number* in
a field called `tier`, with the tier *object* sitting in scope under the same
name. Nothing was wrong — the only reader wanted the number — but it caught me
writing a test against `s.tier.label`, which is the definition of a trap. It is
`tierLevel` now.

---

## Tidy-up pass

An audit afterwards turned up one real bug and some dead weight.

**Rivals were gifting you their conquests.** `raidScore` considers every town,
not just yours, so rivals raid each other — and `capture()` unconditionally sets
`isPlayer`. Two rivals fighting on the far side of the island would silently hand
you a settlement, its whole stockpile, a Conqueror achievement and a **-0.30
alignment hit for a massacre you had no part in**. The achievement and alignment
work of this phase is what made it visible; it had been there since Phase 5.

Only the player takes towns now. The game has no ownership concept beyond
`isPlayer`, so a rival cannot meaningfully hold a title — what it can do is
*sack* one, leaving the wall down and the buildings razed. That removes the wrong
outcome without inventing a faction system to fix a case nobody is watching.

Verified both directions: six rival besiegers in an empty rival's breach capture
nothing and move nothing, while the creature alone and player soldiers alone both
still take a town.

Also removed: a dead `jitterGeometry` helper left over from the Phase 11 props
overhaul, and an `upgrades` counter nothing read. Renamed `CLIFFS.WIDTH` to
`SIZE`, since after the `sizeToMax` fix it is a bounding-box limit and not a
width — a name that lies is a slower bug than one that crashes.

Two events, `game-over` and `achievement-earned`, have no listeners. Both are
deliberate: the UI reads `state.outcome` directly, and the second is a hook for
whatever wants it later.

---

## Performance: measured, then mostly left alone

Asked how to optimise the game. The `performance-optimization` skill's method is
profile → find the one bottleneck → fix that → measure again, and its first
pitfall is optimising without profiling. Following it produced two surprises.

**The first was a methodology error of mine.** I had profiled the Vite dev
server. The skill is explicit that debug builds lie, and it was right:

| | Dev build | Production |
|---|---|---|
| p50 | 16.6–22.2 ms | **16.6 ms** |
| p90 | 21–25 ms | **17–18 ms** |
| p99 | 24–31 ms | **21 ms** |
| JS heap | 257 MB | **32 MB** |

The frame-time tail I had been chasing was largely the dev server. My earlier
"the tail is bad" was wrong.

**The second was that there is no bottleneck.** Against a 16.67 ms budget:

| | Cost | Budget slice |
|---|---|---|
| All eight sim systems, per 20 Hz step | **0.10–0.20 ms** | ~5 ms |
| Render submit | **0.50–0.70 ms** | ~4 ms |

About 5% utilisation. Hiding the ocean, every shadow, all 2,600 flora and all
1,340 props moved frame time less than run-to-run noise. Allocation is 137 KB a
frame with five collections per 400 frames, only one of which landed on a slow
frame. Neither CPU nor GPU is the constraint, so there was nothing to speed up.

What the skill says to do in that case is its step 6: set budgets. That, plus two
pieces of straightforward waste, is what actually got done.

### The sea was three times bigger than the visible world

135,200 triangles: a 4,480-unit plane at 260x260. Two facts made most of it free
to give back. The plane recentres on the camera every frame and the fog far
plane is at `EXTENT * 2.3`, so a 7x span was paying for water nobody can see.
And the swells are three sine waves in the vertex shader, the shortest about 55
units — what that needs is a CELL SIZE, not a segment count.

`WATER.SPAN` and `WATER.CELL` are now the tunables and the segment count is
derived from them. **135,200 → 32,768 triangles**, with cells slightly finer than
before, so the waves came out marginally better.

### Guessed capacities, replaced by growth

83% of every instance slot in the game was empty — 25,401 allocated to hold
4,412. `growInstances` (extracted from the `growMesh` written for buildings
earlier this phase) is now shared by props, flora, scenery and town, so every
system opens at roughly what it expects and rises if it is wrong.

**25,401 → 11,011 slots**, and props gained something it never had: `makeProp`
wrote straight into the buffer with no capacity guard, protected only by a 1.4x
allocation. That is precisely the silent `GL_INVALID_OPERATION` from Phase 11,
waiting for a scatter that came out denser than the guess.

### A budget that means something

`BUDGET` in `state.js`, checked in dev builds every ten seconds, reporting to
`state.debug.budget` and warning on breach. The ceilings sit about 5x above
measured cost so it stays quiet until something regresses.

The instance-waste ceiling is 0.65 and that number took two corrections to get
honest. Growth **doubles**, so a buffer that has just grown is half empty by
definition. And eleven villager pose meshes are each sized for the whole
population, because any villager can be any cast in any pose — that is the
animation design, not a bad guess, and it cannot be shrunk without changing it.
A budget that is permanently red is worthless; this one is green, and if it goes
red a new fixed-buffer system has appeared.

---

## What I'd do differently

- **A hard cap on a monotonic quantity is a bug with a delay on it.** 256 looked
  generous when it was written and was reached by ordinary play. If a number only
  ever goes up, either grow the buffer or be certain of the bound — "surely not"
  is not a bound.
- **A comment describing behaviour is not that behaviour.** The `warFront` comment
  described the escape hatch correctly and the code eleven hundred lines away
  disabled it. Neither file was wrong on its own.
- **Achievements are a superb integration test and I should have used them as one
  sooner.** Writing counters against every system's public surface immediately
  showed which facts the game does *not* expose — there is no event for a felled
  tree, none for a villager thrown, and no notion of "raid survived" as distinct
  from "raid declared". Two of the fifty had to be reworded around that.
- **`b.def.id` does not exist** — entries carry `key`. The per-building dressing
  table in Phase 12 was keyed on `id` and silently matched nothing. Same family of
  mistake as `rock_*` in Phase 11: assuming a field or a name means what it looks
  like instead of opening the definition.
- **Nothing is hidden or secret.** Every achievement is visible and its progress
  legible from the first minute, which is friendlier but gives up the small
  pleasure of an unexpected one. A `hidden: true` flag would be four lines.
- **There are no achievements for losing**, or for anything ironic — no "watch
  your last villager starve", no "be driven off by your own people". The table has
  a lot of thresholds and not much character, and character is the cheap part.
