# Phase 5 — Rival Towns and Conquest

**Status: complete.** Both victory routes are built and tested — winning a town
over with awe, and taking it by force.

---

## What was built

### Multi-town refactor

The foundation, and the part that had to come first. Villagers and buildings
were one flat global list that assumed a single town.

Every settlement is now the same record — centre, stockpile, influence radius,
buildings, happiness, growth timer — and the *only* difference between yours and
a rival's is who decides where to build. Rivals run the identical economy: the
same happiness formula, the same growth rules, the same `validate()` before
every placement. No cheating stockpiles, no free buildings.

Two decisions kept the blast radius small:

- **`state.town` still means "the player's town", with every method still
  player-bound and unchanged in signature.** Forty-odd call sites across
  creature, hand, miracles, props and UI kept working untouched. The multi-town
  versions are `*In`/`*Of` variants (`placeIn`, `findBuildingIn`, `populationOf`).
- **All towns share one InstancedMesh per building type**, told apart by a
  per-instance banner tint. Adding rivals costs zero extra draw calls. The slot
  registry is global per type, so `demolish` swapping the last instance down has
  to fix up whichever building moved, whoever owns it.

Villagers carry `v.town` and consult it for every job, meal and bed. Their
banner tint is their town's, so you can see whose people are whose. The
influence ring shader now draws **up to four territories**, each in its town's
colour.

### Rival AI

A deliberately small utility tick: every ~12s, work out what the town is
shortest of and build the thing that fixes it — housing if growth is blocked, a
farm if food is short (capped against population so it doesn't build eleven),
then storage, a workshop, and a barracks once it can defend itself. It then
probes outward in rings for a legal spot.

Measured over five minutes from a 6-villager, 4-building start: both rivals
reached **27 population and 24–29 buildings** unaided, with sensible mood and
territory growth.

### Impressiveness and peaceful defection

Each rival tracks awe, 0..1, shown as a meter in the HUD.

- Nurturing miracles cast where a rival can see them raise it, scaled by cost —
  a bigger wonder impresses more.
- Cruel miracles in their sight **lower** it. You cannot terrorise a town into
  loving you.
- Finishing a large building within sight of them adds a little.
- Awe decays slowly, so it has to be maintained.

Miracles can now be cast inside a rival's land — casting was previously gated to
your own influence, which would have made the whole route impossible.

Measured end to end, without violence: Ashfell at 19 population and 19 buildings
took **7 food miracles** to win over. All 19 villagers survived and kept working
for the player, all 19 buildings transferred, food went 27 → 391, and the second
rival was untouched. A minute later the absorbed population had grown to 24.

### Soldiers, the platoon banner, siege and conquest

**Soldiers** are trained at a **barracks** out of the same food and ore the town
eats and builds with, so an army is a real economic choice rather than free.
Each barracks supports six. They render as one InstancedMesh of the kit's
archer, tinted by banner — the same instancing the villagers use.

**The platoon banner** is a physical flag you pick up and plant with the hand.
Where it lands, the platoon marches. A god should move his army by moving a
thing in the world, not by clicking a menu.

**Rivals raise their own garrison** once they pass six population, so the
military route is a fight rather than a walkover. Their soldiers hold their own
centre and defend it.

**Taking a town by force needs three things in order:** kill its defenders,
break its curtain wall, then hold the ground inside with at least three
soldiers. That sequencing is what stops one stray soldier claiming a city. Walls
knit back together if the siege is abandoned.

**Conquest costs you.** The spec listed "sparing vs. razing towns" as an
alignment driver, so taking a town by force swings alignment −0.30 while winning
it peacefully gives +0.18. That is the heaviest single moral act in the game,
and it is what finally gives the alignment axis teeth.

Measured, on a rival grown to 23 population with a 6-soldier garrison behind a
full wall: **the town fell 35 seconds after the banner was planted** — roughly
30s of marching, the garrison broken, the wall breached, the town taken. 19 of
20 attackers survived, 26 of its people became the player's, alignment moved
−0.288, and the third town was untouched.

---

## Tunable constants

`TOWN` in `src/state.js`:

| Constant | Value | Effect |
|---|---|---|
| `RIVALS` | 2 | How many rival settlements. The ring shader supports 3 rivals + you. |
| `TOWN_SPACING` | 150 | Minimum distance between any two town centres. |
| `COLOURS` / `NAMES` | — | Banner colour and name, index 0 being the player. |
| `RIVAL_START_POP` / `RIVAL_START_BUILD` | 6 / house,farm,house | A rival's opening position. |
| `RIVAL_BUILD_INTERVAL` | 12s | How often a rival considers building. |
| `IMPRESS_PER_MIRACLE` | 0.16 | Awe per nurturing miracle, scaled by its cost. |
| `IMPRESS_MIRACLE_CRUELTY` | −0.22 | Awe lost per cruel miracle in their sight. |
| `IMPRESS_PER_BUILDING` | 0.05 | Awe per building they can see you finish. |
| `IMPRESS_SIGHT_MARGIN` | 45 | How far beyond their border still counts as "in sight". |
| `IMPRESS_DECAY` | 0.004/s | Awe fades if you stop impressing them. |
| `TINT_MIX` | 0.7 | How far a banner colour is pulled toward white when tinting. |

`COMBAT` in `src/state.js`:

| Constant | Value | Effect |
|---|---|---|
| `TRAIN_INTERVAL` / `TRAIN_FOOD` / `TRAIN_ORE` | 12s / 8 / 5 | The price of a soldier. |
| `GARRISON_PER_BARRACKS` | 6 | Army size is gated on barracks, not just resources. |
| `ENGAGE_RANGE` / `SIGHT_RANGE` | 7 / 30 | Swinging distance, and how far a soldier will charge. |
| `DPS` / `SOLDIER_HP` | 0.26 / 1 | About four seconds to kill, one on one. |
| `CIVILIAN_DPS` | 0.8 | Killing an unarmed villager. Fast, but not instant — you can still call the platoon off. |
| `BUILDING_HP` / `BUILDING_DPS` | 40 / 2.4 | How long a building stands under the axe. |
| `THREAT_WEIGHT` | 0.45 / 0.85 / 1.0 | Distance multiplier per target kind (soldier / villager / building). Lower is more attractive. |
| `ALIGN_PER_CIVILIAN` | −0.05 | The price, per head, of putting a town to the sword. |
| `WALL_HP` / `SIEGE_DPS` / `SIEGE_RANGE` | 120 / 2.6 / 30 | How long a wall holds, against how many. |
| `CAPTURE_ATTACKERS` | 3 | Soldiers needed inside a breached town to force surrender. |
| `WALL_REGEN` | 1.5/s | Walls repair if you give up. |
| `ALIGN_CONQUEST` / `ALIGN_PEACEFUL` | −0.30 / +0.18 | The moral price of each route. |

---

## Bugs found and fixed

1. **The player's town starved to death while the rivals thrived.** Rewriting
   `initTown` for multiple towns dropped the three lines that seed
   `state.resources` from `TOWN.START_*`. The player opened with zero food, and
   because the player's stockpile *is* `state.resources` there was no second
   copy to fall back on — all eight villagers starved inside five minutes while
   Ashfell and Duncove grew to 28. Caught by comparing all three towns in the
   same run rather than testing the player's alone.
2. **Rivals built eleven farms each.** The "am I short of food?" test had no
   ceiling, so a large town kept laying down farms forever. Capped against
   population.
3. **Two armies stood in a ring and refused to fight.** Both sides marched to the
   same point and stopped at their rally spread, settling into a hollow ring with
   the nearest enemy pair **exactly 7.0 units apart** — the engage range to the
   decimal — and zero pairs inside it. They stared at each other for six
   simulated minutes. A soldier now charges any enemy it can see within
   `SIGHT_RANGE` and closes to well inside swinging distance rather than halting
   on its mark. Found by measuring the actual pair distances instead of guessing
   at the combat maths.
4. **The platoon banner could not be picked up.** Two causes in sequence.
   `combat.update()` ran last in the frame, so the camera had already claimed the
   left button for a pan — moved ahead of hand and camera. Then the raycast still
   missed, because a flag is a thin pole and a thin sheet of cloth, and a ray
   aimed at its bounding-box centre passes through the empty air between them. It
   now has an invisible solid pick volume, the same trick the creature uses for
   petting.

### Later addition — soldiers sack towns

Soldiers previously only saw other soldiers; enemy civilians and buildings were
invisible to them, so a "war" was two garrisons trading blows around an
untouched town. They now kill enemy villagers and raze enemy buildings.

**Targeting is weighted, not tiered.** The first attempt ranked strictly —
soldiers, then civilians, then buildings — and buildings were never touched at
all: with two dozen civilians milling about, the third tier never came up, and a
town could be taken without a single wall being scratched. Distance is now
scaled per kind (`THREAT_WEIGHT`), so an armed enemy twice as far away still
wins over a farmer, but a soldier standing beside a house pulls it down rather
than sprinting across town.

Measured on a rival grown to 26 population and 29 buildings, with the wall held
shut so the sack could be observed rather than cut short by capture: reduced to
**0 population and 3 buildings**, 30 civilians killed, 31 buildings razed,
alignment driven to the −1 floor. Both routes remain reachable — leave the wall
alone and the town is simply captured with its buildings intact.

**Attribution was the subtle half.** `villagers-killed` and `building-destroyed`
carried no notion of *who did it*, and alignment charged the player for every
one. Once rivals could raid, that meant a rival butchering your farmers made
*you* evil. Both events now carry `byPlayer`, and alignment and the creature's
imitation both ignore anything the player did not do. Events without the flag
default to the player's, so every older emitter still behaves.

Verified: a rival army killing **19 of the player's villagers and razing 6 of
their buildings** moves the player's alignment **+0.024** (two births,
unrelated) and teaches the creature nothing — its `attack` desire does not budge
and it gains zero lessons.

---

## What I'd do differently

- **Siege engines are on disk and unused.** The castle kit ships a catapult,
  trebuchet, ballista, battering ram and siege tower, each with a *demolished*
  variant. Wall damage is currently an abstract number ticking down; an actual
  engine that has to be escorted to the wall would make a siege a scene rather
  than a stat.
- **Rivals defend but never attack.** They garrison their centre and will fight
  anyone who comes, and they will sack a town they are standing in — but nothing
  ever sends them anywhere. A rival that decided to raid would make the mid-game
  far less safe, and every piece needed is already built: the marching, the
  targeting and the razing all work, tested by spawning a rival army on the
  player's doorstep by hand. It only needs a reason to pick a destination.
- **Villagers do not flee.** They keep farming while soldiers cut them down,
  which reads badly up close. Running for the town centre when an enemy soldier
  is near would cost one proximity check per villager per tick — cheap now, and
  another reason to want the spatial hash.
- **Combat is focus-fire on the nearest enemy**, so a large force melts a small
  one almost instantly: six defenders died in about a second and a half to
  twenty attackers. It resolves correctly and reads fine at a glance, but a
  target-spreading rule would make it feel less like arithmetic.
- **The flat lists are now the real ceiling.** Villagers, soldiers, buildings and
  props are each one global array scanned linearly several times per tick by
  jobs, targeting and siege checks. At three towns it is comfortably inside
  budget; the spatial hash flagged back in Phase 2 is the fix, and this is the
  first phase where it would actually earn its keep.
- **Nothing ends the game.** Capturing every rival is the obvious win condition
  and there is no screen for it — the meters just all read "joined you".
