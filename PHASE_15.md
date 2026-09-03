# Phase 15 — A New Island Every Game

Every game of Divinity ever played had been played on **the same island**.
`WORLD.SEED` was a hardcoded `20260815` feeding all eight generators, so the
coastline, the mountains, the forests and all three town sites were identical
every single run. The only thing that ever varied was what the player did.

Now the seed is rolled per game, the world is built from one of five archetypes,
and the island's name and seed are printed under the title so a good one can be
kept.

---

## Archetypes

An archetype is a set of **ranges**, not values. The seed picks the archetype and
then picks a point inside every one of its ranges, so two Highlands are both
recognisably highlands and are not the same island.

| | Shape | Land | Feel |
|---|---|---|---|
| **Highland** | one lobe | ~39% | the island of the first fourteen phases |
| **Continent** | one broad lobe | ~58% | flat interior, low hills, lots of building room |
| **Archipelago** | 3–5 lobes | ~27% | deep bays and narrow necks |
| **Spine** | 3–4 lobes in a line | ~26% | a mountain ridge with coastal plains either side |
| **Fjordland** | 1–2 lobes, heavy warp | ~34% | ragged inlets and headlands, the highest peaks |

The mechanism behind all five is one line: the landmass mask is the **union of N
radial lobes** rather than a single circle. A continent is one big lobe, an
archipelago is four scattered ones, a spine is three elongated ones in a row.
Everything else — warp, base frequency, peak height, relief exponent — is tuning
on top of that.

`?seed=<number>` replays an island. `?island=Spine` forces an archetype, which is
for looking at one on purpose rather than for playing.

---

## The part that mattered: a random island is allowed to be unplayable

A shipped one is not. Town siting needs three spots 230 apart, on ground between
9 and 26 units high, with four fifths of a 30-unit ring out of the water. That is
tight even on a hand-tuned island, and when it fails `foundTown` returns null and
the player quietly gets fewer rivals with nothing on screen to say why.

So every island is generated, **tested, and rejected if it cannot host the towns**
— averaging 5.7 attempts and 415ms, with a fallback to the known-good original if
sixty rolls all fail. A known good island always beats a novel broken one.

### And the check found a real bug that had been there for fourteen phases

The first pass of archetypes produced **Archipelagos with two towns and Spines
with one**, despite passing viability. The cause was not the generator:

> Towns were sampled inside a radius of 198 and must sit `TOWN_SPACING` (230)
> apart. **If the first town lands near the centre, no second town can ever
> exist** — every point in the disc is within 198 of it, and 198 < 230.

`foundTown` was greedy: each town took the best-scoring spot left, one after
another, and the best-scoring spot is usually the nicest valley in the middle.
The one island shipped for fourteen phases happened to score best 185 units out,
so it never showed. Rolling a new world every game turned "never" into "most
Spines".

Fixed by choosing **all the sites together**: the search band is widened to 0.80
of half-world, and the first pick is backtracked — try the best candidate, and if
the rest cannot be spaced around it, try the next best.

**Measured**: 25 runs across five archetypes and five seeds — 25 with three
towns, no warnings, no fallbacks.

---

## Two tuning corrections worth recording

**The archetype is now held across retries.** Re-picking it every attempt looked
equivalent and was not: shapes that fail viability more often are simply replaced
by shapes that pass, so the easy archetype crowds out the hard ones. Measured
over 40 rolls that put Highland at 45% against an intended 27%, and Spine and
Fjordland at 7% against 18% — **the two most distinctive shapes were the two you
would almost never see**, in a phase whose entire purpose is that no two games
look alike. Holding the archetype for the first two thirds of the attempts moved
the spread to 13–25%.

**The viability check demands a spare site.** It is a proxy for `pickSites`, not
the same code — it cannot be, because terrain is built before towns exist and has
no access to `siteScore`. It samples on a grid where the real thing samples 9,000
random points and anchors on the best. The two disagreed at the margin: one Spine
in fifteen passed here and still yielded two towns there. Requiring
`SITES_NEEDED + 1` turns "exactly enough" into "enough with room to be wrong",
and islands are cheap to reject.

---

## Cost

| | |
|---|---|
| Islands rolled per game | 1 |
| Generation attempts, average | **5.7** |
| Time to find a playable island | **415 ms** average, 2.4 s worst observed |
| Fallbacks to the known-good island | **0** in 37 rolls |

Against a twelve-second asset load, the headroom is free — which is why
`MAX_ATTEMPTS` is 60 rather than 24. Running out means silently handing the
player a Highland when they were promised a Spine.

---

## What I'd do differently

- **The Archipelago is not an archipelago.** Its lobes have to keep touching:
  villagers walk, soldiers march, and the creature has no boat, so genuinely
  separated land would strand a town with no way to reach it. It is deep bays and
  narrow necks, and the name is the closest honest word rather than a promise.
  Real separate islands need boats, and that is a different phase.
- **The viability check duplicates knowledge that lives in town.js.** Two places
  now encode what makes a town site, and they have already disagreed once. The
  right shape is for siting to be a shared module both can call, rather than a
  proxy plus a margin to cover the proxy being wrong.
- **Rejected islands are thrown away whole.** A shape that fails only because its
  towns cluster could often be saved by nudging one parameter rather than
  re-rolling everything, and 33 attempts for one Spine is a lot of discarded work.
- **Nothing uses the archetype except the terrain.** A Continent should probably
  start you with more villagers and a Spine with fewer and better ore; the rivals
  should raid differently on a Fjordland where the coast is all inlets. The shape
  of the world is currently scenery, not a variable the game plays differently on.
