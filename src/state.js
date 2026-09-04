// ---------------------------------------------------------------------------
// state.js - the single shared brain of the game.
//
// ARCHITECTURE RULE: systems (terrain, hand, props, camera, villagers, ...)
// never import each other. They import this module only. Each system, on init,
// publishes its public API onto `state` (e.g. state.terrain.heightAt) and every
// other system reaches it through there. That keeps the dependency graph a star
// instead of a web, and makes it trivial to stub or disable a system.
// ---------------------------------------------------------------------------

/** Fixed simulation rate. Rendering is decoupled and interpolates between ticks. */
export const SIM_HZ = 20;
export const SIM_DT = 1 / SIM_HZ;
/** Never simulate more than this many catch-up ticks in one frame (spiral-of-death guard). */
export const MAX_SIM_STEPS_PER_FRAME = 5;

// --- World ------------------------------------------------------------------
export const WORLD = {
  /**
   * Heightmap resolution (vertices per side). 384 -> 147k verts / 294k tris.
   *
   * This MUST rise with EXTENT. The two together set CELL, the world distance
   * between heightmap samples, and CELL is what decides whether the ground
   * looks carved or faceted. Growing the island without growing this just
   * stretches the same 256 samples over half again as much ground.
   */
  SIZE: 384,
  /**
   * Island extent in world units, corner to corner.
   *
   * Terrain noise is sampled in WORLD coordinates, not in normalised ones, so
   * raising this genuinely makes more island - more bays, more mountains, at
   * the same feature size - rather than scaling the same island up. 640 against
   * the original 420 is about 2.3x the land.
   */
  EXTENT: 640,
  /** Water surface sits at y = 0. Everything else is measured from there. */
  SEA_LEVEL: 0,
  /** Highest peak, roughly. */
  MAX_HEIGHT: 62,
  SEED: 20260815
};
WORLD.HALF = WORLD.EXTENT / 2;
WORLD.CELL = WORLD.EXTENT / (WORLD.SIZE - 1);

// --- Camera -----------------------------------------------------------------
/**
 * THE SEA. Size and tessellation of the water plane, derived rather than typed.
 *
 * It was a 4,480-unit plane at 260x260 segments - 135,200 triangles, the second
 * heaviest thing in the scene after the terrain itself. Two facts made most of
 * that free to give back:
 *
 *   * The plane is recentred on the camera every frame, and the fog far plane is
 *     at EXTENT * 2.3. Anything past that is fully fogged and can never be seen,
 *     so a span of 7x EXTENT was paying for three times more water than exists
 *     as far as the player is concerned.
 *   * The wave displacement is three sine swells in the vertex shader, the
 *     shortest about 55 units. What that needs is a CELL SIZE, not a segment
 *     count - so the cell is the tunable and the segments are computed from it.
 *
 * The result is 4x fewer triangles with slightly BETTER waves, because the
 * smaller span at a fixed cell size ends up finer than it was.
 */
export const WATER = {
  /**
   * Multiples of WORLD.EXTENT the plane spans. MUST stay above the fog far
   * plane (2.3) with margin, or the edge of the world appears as a seam.
   */
  SPAN: 3.2,
  /** Target world units per grid cell. Lower = smoother swells, more triangles. */
  CELL: 16
};
WATER.SEGMENTS = Math.round((WORLD.EXTENT * WATER.SPAN) / WATER.CELL);

/**
 * PERFORMANCE BUDGET. What this game is allowed to cost.
 *
 * Measured on the production build: the whole simulation is ~0.2ms per 20Hz
 * step and a full render submit is ~0.7ms, against a 16.67ms frame - about 5%
 * utilisation. These are not aspirations, they are ceilings roughly 5x above
 * where things actually sit, so they catch a regression rather than nagging.
 *
 * Checked in dev builds only, and only every BUDGET.CHECK_EVERY seconds - a
 * budget check that itself costs frame time would be a poor joke.
 */
export const BUDGET = {
  /** 60 FPS. Everything below has to fit inside this. */
  FRAME_MS: 16.67,
  /** All simulation systems together, per fixed step. */
  SIM_MS: 1.5,
  /** CPU cost of submitting one frame to the GPU. */
  RENDER_MS: 3.0,
  /** Ceilings on what the scene is allowed to contain. */
  DRAW_CALLS: 200,
  TRIANGLES: 1_200_000,
  /**
   * Wasted instance slots, as a fraction of total capacity.
   *
   * 0.65 is the honest floor, not a target anyone should try to beat, and two
   * things set it:
   *
   *   * GROWTH DOUBLES. A buffer that has just doubled is half empty by
   *     definition, so a healthy growing system averages 50-75% occupancy.
   *   * POSE MESHES ARE POPULATION-CAPPED. A villager can be any of two casts
   *     in any of five poses, and any one of those eleven meshes might have to
   *     hold the entire population at once - so each is sized for everyone even
   *     though it typically carries a tenth of them. That is the animation
   *     design, not a bad guess, and it cannot be shrunk without changing it.
   *
   * What this catches is the thing that actually went wrong before: a system
   * pre-allocating a fixed several-hundred-slot buffer and never growing into
   * it. Those are gone; if this goes red again, a new one has appeared.
   */
  INSTANCE_WASTE: 0.65,
  CHECK_EVERY: 10
};

/**
 * SCULPTING. Raising and lowering the ground, which is the verb this genre is
 * built on and the one this game did not have.
 *
 * `terrain.deform` has existed since Phase 1 and was written, tested and
 * exposed on the public API - buildings flatten pads with it, fireballs dig
 * craters with it. The player could never call it. This is the interface to
 * something that was already there.
 *
 * Held-key, not a mode: Shift makes the cursor a shovel for exactly as long as
 * you hold it, the same bargain Ctrl makes for miracles. There is nothing to
 * arm and nothing to get stuck in.
 */
export const SCULPT = {
  /** Brush radius, and what the wheel multiplies it by per notch. */
  RADIUS: [7, 34],
  RADIUS_START: 15,
  RADIUS_STEP: 1.12,

  /** World units of height per second at the centre of the brush. */
  RATE: 9,

  /**
   * LEVELLING. How fast the flatten brush converges on its target, per second.
   *
   * Flatten is the tool you actually reach for before building - the raise and
   * lower brushes shape a landscape, this one prepares a site - and it was the
   * obvious gap left at the end of Phase 14.
   *
   * 2.4 means a full stroke levels a patch in well under a second while still
   * being something you hold rather than click, so a half-second of it leaves a
   * usable slope rather than a table. The target height is wherever the ground
   * was when you pressed: the stroke plane the brush already locks to stop
   * itself drifting is exactly the height you were pointing at.
   */
  /**
   * How fast the level gesture pulls ground toward the stroke's height.
   *
   * Up from 2.4. The tool always converged - measured, a steep spot went from
   * 0.27 slope to 0.00 and became buildable - but it took a couple of seconds
   * of holding to get there, which reads as "this is not doing anything". Now
   * it settles in about half a second, so you can see it working.
   */
  FLATTEN_RATE: 4.0,

  /**
   * Levelling is ALSO on Alt, not only on both mouse buttons together.
   *
   * Both-buttons was the whole binding, and it is a gesture a lot of hardware
   * simply cannot make - it is awkward on many mice and impossible on a laptop
   * trackpad. The tool itself was never broken: driven directly it takes a
   * hillside from 7.93 units of spread to 0 in three seconds. It just could not
   * be reached, which from the outside is the same thing as not working.
   *
   * Alt is already a modifier in this game (alt+drag orbits) and sculpt claims
   * the mouse before the camera looks at it, so there is no conflict.
   */
  LEVEL_ON_ALT: true,

  /**
   * Belief per second at RADIUS_START, scaled by AREA - a brush twice as wide
   * moves four times the earth and costs four times as much.
   *
   * Cut from 6.0, which priced a single building pad at roughly a whole miracle
   * and made shaping ground something you saved up for rather than something
   * you did. A god who has to budget for a hillside is not really a god, and the
   * tool stops being fun long before it stops being affordable.
   *
   * MEASURED, because the first version of this comment guessed and was out by
   * half: a nine-villager town earns about 0.25 belief a second (15 a minute),
   * not 30. So 2.0/sec buys roughly seven seconds of digging per minute early
   * on, rising as the town grows and prays harder.
   *
   * Seven seconds is two or three building pads, which is the right shape - you
   * can level ground whenever you need to without saving up, and you still
   * cannot reshape the island on a whim. If it wants to be cheaper again, this
   * is the one number to move.
   *
   * The AREA scaling stays. Charging by radius instead would make the widest
   * brush the cheapest way to move any given amount of earth, and then there
   * would be no reason to ever use a small one.
   */
  BELIEF_PER_SEC: 2.0,

  /**
   * Limits, so you cannot raise a spire into the fog or dig through to the
   * seabed. MAX is below WORLD.MAX_HEIGHT because the generator's own peaks
   * should stay the tallest things on the island.
   */
  MAX_H: 52,
  MIN_H: -5,

  /**
   * How much ground around a building is frozen.
   *
   * NOT a keep-out for the brush any more - a skirt around the building itself.
   * The first version refused the whole stroke if any part of the brush
   * overlapped a building, which meant you could not level the ground beside
   * your own houses, which is exactly where you want to level.
   *
   * Now `terrain` is handed these circles and simply skips those cells: the
   * brush works right up to the wall and the earth under the foundation never
   * moves. Small, because the point is to protect the pad and nothing more.
   */
  BUILD_CLEARANCE: 1.0,

  /**
   * The same, around any town centre. Castles are not in `allBuildings` - they
   * have their own mesh and slot - so they need their own circle, and it is
   * wider because a keep is wider than a hut.
   *
   * Down from 22: that was a brush keep-out and had to clear the whole keep
   * plus the brush; this only has to cover the castle's own footprint, which is
   * about 17 across.
   */
  CENTRE_CLEARANCE: 14,

  /**
   * How often the brush clears the flora and scenery it is burying. Throttled
   * because clearing walks every instance of every decorative mesh, and doing
   * that sixty times a second to hide grass is a poor trade.
   */
  CLEAR_INTERVAL: 0.2
};

/**
 * ISLANDS. What shape of world a game is played on.
 *
 * Every game until now was played on THE SAME ISLAND. `WORLD.SEED` was a
 * hardcoded constant feeding all eight generators, so the coastline, the
 * mountains, the forests and all three town sites were identical every single
 * run - the only thing that ever varied was what the player did.
 *
 * An archetype is a set of RANGES, not values. Two Highlands are both
 * recognisably highlands and are not the same island, because the seed picks a
 * point inside every range as well as picking the archetype.
 *
 * `lobes` is the mechanism behind the shapes: the landmass mask is the union of
 * N radial lobes rather than one circle. One big lobe is a continent, four
 * small scattered ones are an archipelago, three elongated ones in a row are a
 * spine. Everything else is tuning on top of that.
 */
/**
 * HOW MANY CIVILISATIONS SHARE THE ISLAND. Chosen at boot.
 *
 * The count cannot be changed later: the island is vetted for a specific number
 * of settlements before it is generated, so this is a decision that has to be
 * made before there is a world at all.
 *
 * The floor is two. One civilisation is not a game - the Phase 10 victory is
 * "every rival is gone", which with no rivals is true on the first tick.
 */
export const CIVS = {
  MIN: 2,
  MAX: 5,
  DEFAULT: 3,

  /**
   * How far apart settlements must sit, per civilisation count.
   *
   * THIS HAS TO SHRINK AS THE COUNT RISES, and the geometry says by how much.
   * Sites are searched inside a radius of about 256, and N points spread evenly
   * in a circle of radius R sit `2R sin(pi/N)` apart at best:
   *
   *   3 towns  443 apart at the theoretical best
   *   4 towns  362
   *   5 towns  301
   *   6 towns  256   <- five civs plus the spare site the check demands
   *
   * Those are ceilings on a perfect disc of usable land. A real island is a
   * fraction of that disc, so the spacing below sits well under each ceiling -
   * otherwise the viability check rejects island after island and the player is
   * silently handed a fallback map, or worse, one civilisation fewer.
   */
  SPACING: { 2: 260, 3: 230, 4: 195, 5: 165 },

  /**
   * People the island can hold, per civilisation on it.
   *
   * The cap is ISLAND-WIDE - one pool every town draws from - so a fixed number
   * means the more gods there are, the smaller each of their nations can be. At
   * five civs the old flat 150 worked out at thirty people each, and a soak
   * ended with three towns permanently at the ceiling.
   *
   * FLOORED at the old value so small games are exactly as they were, and
   * CEILINGED because this number is the size of a dozen instanced buffers and
   * the per-tick cost of every villager mind on the island.
   */
  POP_PER_CIV: 60,
  POP_FLOOR: 150,
  POP_CEILING: 320,

  /** Shown on the picker. */
  LABELS: {
    2: 'You and one rival',
    3: 'You and two rivals',
    4: 'You and three rivals',
    5: 'You and four rivals'
  }
};

/**
 * THE RIVAL GODS (Phase 20).
 *
 * Every civilisation has a god, and until this phase only one of them did
 * anything. The rivals had towns, armies, farms and a council that decided who
 * to raid - but no creature, no miracles, and no route to victory. The player
 * was the only participant in the only game being played.
 *
 * A rival god is deliberately NOT a second player. It cannot sculpt, and it has
 * no hand. What it has is the one thing that mattered: a creature, and the
 * three levers the player uses on theirs.
 *
 *   THE LEASH     it picks a stance from its situation, the same four modes
 *   THE SUMMONS   it sends the creature where it wants it
 *   THE HAND      it praises and punishes what the creature does, which is the
 *                 whole learning system, unchanged
 *
 * That is the entire AI. It teaches through `creature.reinforce` exactly as a
 * slap or a stroke does, so a rival's creature grows a personality out of the
 * same machinery - and it is beatable for the same reasons a player is: a god
 * that keeps its creature on the Leash of Aggression raises a monster that
 * cannot haul, and one that never fights raises a pet.
 */
export const RIVAL_GOD = {
  /** Seconds between decisions. Deliberately slow - a god is not an RTS macro. */
  THINK_INTERVAL: 4.0,

  /**
   * WHAT KIND OF GOD EACH ONE IS, dealt round-robin by faction index.
   *
   * Not decoration. A soak with every god running the same logic produced four
   * gods permanently in the war stance and every awe meter on the island at
   * zero - because `frontFor` is true whenever a god's army is out raiding, and
   * with RAID_INTERVAL at 20 seconds somebody's army is always out. One of the
   * game's two routes to a town existed and nobody ever took it.
   *
   * A CONQUEROR sends its creature wherever its war is. A MISSIONARY sends it
   * to somebody's streets to perform, and calls it home only when there are men
   * in its OWN - its army still raids, because the war council is the town's
   * business and a god commands a creature, not an army.
   *
   * Dealt rather than rolled, so the second civilisation is always a conqueror
   * and a player who has played twice knows which neighbour is which.
   */
  DISPOSITIONS: ['conqueror', 'missionary'],

  /**
   * Seconds before the first rival god acts.
   *
   * The player spends the opening minute learning what a creature is. A rival
   * creature ransacking a village in that window teaches the wrong lesson about
   * what the game is, so the gods hold their hands until the player has had a
   * turn.
   */
  GRACE: 100,

  /**
   * ...and how long before a god will send its creature to somebody's gate.
   *
   * Deliberately RAID_GRACE. A rival's beast standing at your border is the
   * opening move of the awe war, and it should not land before the shooting war
   * is allowed to start - the first soak had four creatures at four gates at 75
   * seconds, which read as the island ganging up on the player during what is
   * supposed to be the quiet opening.
   */
  COURT_AFTER: 240,

  /**
   * How much of what its creature does the god actually judges, 0..1.
   *
   * NOT 1. A god that reinforces every single deed drives the learning-rate
   * decay straight into the floor inside two minutes, and the creature then
   * cannot be taught anything for the rest of the match - it is frozen as
   * whatever it happened to be at minute two. The player teaches in bursts,
   * with long stretches of nothing, and that is what makes the arc work.
   */
  JUDGE_CHANCE: 0.35,

  /** Seconds after a deed past which the god no longer bothers judging it. */
  JUDGE_WINDOW: 6,

  /**
   * How badly the town has to want something before the god changes stance.
   *
   * Hysteresis, not a threshold: without it a town hovering at the food line
   * flips between compassion and aggression every four seconds, and its
   * creature learns nothing because every lesson contradicts the last.
   */
  NEED_FOOD_DAYS: 2.2,      // food per head below this and the god wants hauling
  NEED_FOOD_CLEAR: 3.4,     // ...and above this before it stops wanting it

  /** Radius the god summons its creature to hold, at home and at the front. */
  HOME_RADIUS: 46,
  FRONT_RADIUS: 34,

  /**
   * How far into a foreign town a courting creature stands, as a fraction of
   * that town's influence radius.
   *
   * IN THE STREETS, not at the gate. A town's buildings occupy a ring from
   * TOWN.CENTRE_CLEARANCE out to its influence radius, and a creature has to be
   * among them to have anything to perform to - a probe at three quarters of
   * the way OUT found nothing in reach but trees. Floored against the keep
   * clearance in rivalgods.js, because the middle of a castle is solid ground
   * the creature can never stand on.
   */
  COURT_STANDOFF: 0.45,

  /**
   * Chance per think that a god with nothing pressing lets the creature roam.
   *
   * A creature permanently pinned to a summons circle never wanders into a
   * lesson, and the utility AI is the interesting half of it. Idle gods take
   * their hands off.
   */
  IDLE_ROAM: 0.4,

  /**
   * Which animals the rivals get, in order.
   *
   * Fixed rather than random, so the lion is always the second civilisation and
   * a player who has played twice knows what is coming over the hill. These are
   * keys in the Cube Pets kit and are checked against it at boot - a typo here
   * silently leaves a rival with no body, which is a creature that cannot be
   * seen, fought or beaten.
   *
   * Chosen for TEMPERAMENT SPREAD, since temperament is most of what makes two
   * rival gods play differently:
   *
   *   lion      ferocious + thickHided   a brawler that survives what it starts
   *   elephant  thickHided + greedy      slow, hard to kill, always hungry
   *   tiger     ferocious + fleet        hits hard, dies faster, arrives first
   *   polar     ferocious + greedy       a man-eater if its god lets it be one
   */
  ANIMALS: ['animal-lion', 'animal-elephant', 'animal-tiger', 'animal-polar'],

  /**
   * How much of a rival creature's own colour shows through.
   *
   * The player's creature is tinted by ALIGNMENT, which is a number rivals do
   * not have. Theirs carry their banner instead: enough to name the owner at a
   * glance, not enough to stop the animal looking like the animal.
   */
  BANNER_TINT: 0.34
};

export const ISLANDS = {
  /**
   * How many islands to generate and test before giving up and using the known
   * good one.
   *
   * Not optional. Town siting needs three spots at TOWN_SPACING (230) apart,
   * inside a radius of 198, on ground between 9 and 26 units high - which is
   * geometrically tight even on a hand-tuned island. A random island that
   * cannot host three towns silently costs the player a rival, which is exactly
   * the regression terracing caused in Phase 12.
   *
   * 60 rather than 24 because the awkward archetypes sit close to the old cap -
   * Spine routinely needed 17 to 21 - and running out means silently handing
   * the player a Highland when they were promised a Spine. One rejected island
   * is a single heightfield generation against a twelve-second asset load, so
   * the headroom is free.
   */
  MAX_ATTEMPTS: 60,

  /** Sites must be this far apart to count as distinct - mirrors TOWN_SPACING. */
  SITE_SPACING: 230,
  /**
   * ...and there must be at least this many of them, one per town.
   *
   * MOVED WITH TOWN.RIVALS, and it has to: an island vetted for three towns
   * that then has to host four does not fail loudly, it silently hands the
   * player one fewer rival. That is precisely the regression terracing caused
   * in Phase 12 and it took a soak to notice, so the two numbers are bound
   * together here in the comment as well as in fact.
   */
  SITES_NEEDED: 4,

  /**
   * Spare sites the check demands beyond SITES_NEEDED.
   *
   * The check is a PROXY for town.js's `pickSites`, not the same code - it
   * cannot be, because terrain is built before towns exist and has no access to
   * `siteScore`. It samples on a grid where the real thing samples 9,000 random
   * points and anchors on the best-scoring one, so the two disagree at the
   * margin: an island where exactly three sites fit can pass here and still
   * yield two towns there, which happened to one Spine in fifteen test rolls.
   *
   * Demanding a spare costs nothing - islands are cheap to reject - and turns
   * "exactly enough" into "enough with room to be wrong".
   */
  SITES_MARGIN: 1,

  ARCHETYPES: [
    {
      /** The island every game has been played on so far. */
      name: 'Highland', weight: 3,
      lobes: [1, 1], spread: 0, line: false,
      radius: [0.92, 0.96], elongate: [1.0, 1.0],
      inner: [0.36, 0.44], warp: [34, 52],
      baseFreq: [0.0038, 0.0048], peaks: [0.48, 0.62],
      ridgeFreq: [0.0050, 0.0068], relief: [1.40, 1.52]
    },
    {
      /** Broad and flat: a lot of buildable interior, low hills at the edges. */
      name: 'Continent', weight: 2,
      lobes: [1, 1], spread: 0, line: false,
      radius: [0.94, 0.99], elongate: [1.0, 1.0],
      inner: [0.54, 0.64], warp: [26, 40],
      baseFreq: [0.0030, 0.0040], peaks: [0.28, 0.40],
      ridgeFreq: [0.0044, 0.0058], relief: [1.20, 1.34]
    },
    {
      /**
       * Deep bays and narrow necks. NOT separate islands, and the name is the
       * closest honest word rather than a promise.
       *
       * The lobes have to keep touching: villagers walk, soldiers march and the
       * creature has no boat, so a genuinely broken-up archipelago would strand
       * a town with no way to reach anything. The first attempt at this had the
       * lobes overlapping so heavily they fused into one blob and the archetype
       * was indistinguishable from a Highland; these numbers push them apart
       * until the coastline is deeply indented and stop before the land parts.
       *
       * Real separate islands are a different feature and they need boats.
       */
      name: 'Archipelago', weight: 2,
      lobes: [3, 5], spread: 0.46, line: false,
      radius: [0.38, 0.50], elongate: [1.0, 1.0],
      inner: [0.24, 0.34], warp: [40, 62],
      baseFreq: [0.0044, 0.0058], peaks: [0.42, 0.56],
      ridgeFreq: [0.0058, 0.0076], relief: [1.42, 1.56]
    },
    {
      /** A long mountainous ridge with coastal plains either side. */
      name: 'Spine', weight: 2,
      lobes: [3, 4], spread: 0.40, line: true,
      radius: [0.52, 0.64], elongate: [0.52, 0.66],
      inner: [0.30, 0.40], warp: [30, 46],
      baseFreq: [0.0040, 0.0052], peaks: [0.62, 0.78],
      ridgeFreq: [0.0050, 0.0064], relief: [1.46, 1.60]
    },
    {
      /** Deep inlets and headlands: heavy domain warp, ragged everything. */
      name: 'Fjordland', weight: 2,
      lobes: [1, 2], spread: 0.18, line: false,
      radius: [0.86, 0.96], elongate: [1.0, 1.0],
      inner: [0.32, 0.42], warp: [78, 104],
      baseFreq: [0.0042, 0.0056], peaks: [0.52, 0.68],
      ridgeFreq: [0.0056, 0.0072], relief: [1.48, 1.62]
    }
  ]
};

/**
 * PRAYERS. What the people ask of you, and what it costs you to ignore them.
 *
 * Belief has been a tap that runs on its own since Phase 4: a happy population
 * trickles faith whether you ever do anything for them or not. A prayer turns
 * that into a conversation - a villager in real trouble asks for a specific
 * thing, and you either answer it or you do not, and both are recorded.
 *
 * Every prayer comes from a condition already in the simulation. Nothing here
 * invents a need: hunger, health, a declared raid and a growth blocker are all
 * things the game was already tracking and never said out loud.
 */
export const PRAYER = {
  /**
   * Ticks between generation passes. The sim runs at 20Hz and prayers are not
   * an emergency - checking four times a second is already far more often than
   * a condition can meaningfully change.
   */
  SCAN_EVERY: 5,

  /** How long a prayer waits to be answered before it expires, in sim seconds. */
  /**
   * `weather` is long because a drought is long. A prayer for rain that expired
   * while the drought was still running would count as neglect for something
   * the player may have had no way to answer yet.
   */
  LIFETIME: {
    food: 75, rescue: 40, safety: 90, supply: 110, weather: 150,
    // --- Phase 20 addendum: five more things to ask for --------------------
    // Each is sized by how long the thing being asked for actually takes to
    // do. `ground` is the longest because levelling a hillside is the slowest
    // answer in the game, and a prayer that expires while you are still
    // holding the mouse button down would be counted as neglect.
    rebuild: 130, ground: 170, wonder: 100, beast: 80, thirst: 95
  },

  /**
   * Caps. The historical failure mode in this project is a list that only
   * grows, so there are three independent ceilings and a bounded history.
   */
  MAX_PER_TOWN: 6,
  MAX_ACTIVE: 12,

  /**
   * ...AND AT MOST THIS MANY OF THE SAME KIND, per town.
   *
   * THE REASON THE OTHER NINE CATEGORIES WERE INVISIBLE. Communal prayers are
   * one-per-town by construction (`townHasCategory`), but INDIVIDUAL hunger is
   * one per starving villager and nothing capped it - so in a town of sixty,
   * four hungry people filled all four slots and every other condition in the
   * game was rejected as `townFull` before it could be looked at. A
   * thirty-minute soak raised 40 food prayers out of 55 and `townFull` turned
   * away 947.
   *
   * Which is exactly the complaint: every prayer was about starving. It was not
   * that the others were rare - they could not get in.
   *
   * Two, so a famine still reads as a famine rather than one polite request.
   */
  MAX_PER_CATEGORY: 2,
  /** Resolved prayers kept for the debug panel and the recent-events feed. */
  HISTORY: 40,

  /**
   * Cooldowns in sim seconds. Without these a villager who is hungry for two
   * minutes prays sixty times: the condition is continuous and the prayer is
   * an event.
   */
  COOLDOWN_VILLAGER: 90,
  COOLDOWN_TOWN_CATEGORY: 45,

  /**
   * Thresholds. Deliberately well past mild discomfort - a villager who is
   * peckish does not pray, a villager who is starving does.
   */
  /**
   * A drought must have run this long before anyone prays about it.
   *
   * Rain is weather; a DROUGHT is a crisis, and the difference is how long it
   * has gone on. Praying the instant the sky turns would make it noise.
   */
  DROUGHT_SECONDS: 45,

  HUNGER: 0.72,
  HEALTH: 0.55,

  // --- the five added in the Phase 20 addendum -----------------------------
  //
  // THE RULE THIS FILE HAS FOLLOWED SINCE PHASE 16 IS THAT THE MECHANIC COMES
  // FIRST. Phase 16 refused a weather prayer because there was no weather;
  // Phase 19 built one and the prayer became honest. Every threshold below
  // reads a condition that already existed and asks for an action the player
  // already has - and between them the five ask for five DIFFERENT actions,
  // which is the point. Five prayers all answered by the food miracle would be
  // one prayer wearing five hats.

  /**
   * REBUILDING. Seconds after an enemy pulls a building down that its town
   * still wants it back.
   *
   * THIS REPLACED A PRAYER FOR SHELTER, and the measurement is why. Shelter was
   * to fire when `growthBlocker` said 'housing' - a condition that read
   * beautifully on paper and, measured over four hundred seconds of a real
   * town, was true for EXACTLY NONE OF IT. Phase 20's self-build raises a house
   * every fourteen seconds out of a stockpile holding four thousand timber, so
   * your people are never short of a roof for long enough to pray about it. A
   * prayer whose condition is always false is not a prayer.
   *
   * What IS always happening is raids pulling buildings down, and nobody ever
   * asked for one back. Same verb - build - but a live trigger and a much
   * better moment: the quiet after the fighting, when somebody points at a gap.
   */
  RAZED_SECONDS: 90,

  /**
   * BARREN GROUND. The fraction of a town's own land that will take a building
   * before its people give up on it.
   *
   * This is the only prayer in the game that asks for the SCULPTING TOOL, which
   * is the player's signature power and had never once been requested. Placing
   * shapes the ground automatically up to TOWN.SHAPE_MAX_SLOPE, so anything
   * steeper is a genuine refusal and not a nuisance.
   *
   * 0.55 IS A MEASURED NUMBER. Across every settled site on a Highland: small
   * towns 0.88 to 0.98, and the player's own - grown out to an influence radius
   * of 122 - down at 0.60. The fraction falls as a town SPREADS, because a
   * growing town reaches past the good ground into the rough edges, which is
   * exactly the moment this prayer is about. My first guess of 0.32 was below
   * anything a real site ever reaches and could not fire at all.
   */
  BUILDABLE_FRACTION: 0.55,
  /** Points sampled around the town to measure that. Cheap, and it is a ratio. */
  BUILDABLE_SAMPLES: 24,
  /**
   * ...and how big a town has to be before it cares about the far hillside.
   *
   * A hamlet has all the room it will ever need. The fraction only falls once a
   * town has spread far enough to reach the rough edges, so asking below this
   * would be asking about ground nobody wants yet.
   */
  GROUND_MIN_POP: 16,
  /** ...and it is clear again once this much of their land will take a building. */
  BUILDABLE_CLEAR: 0.68,
  /**
   * MEASURED ON SLOPE, NOT ON `validate`.
   *
   * The first version asked `validate` whether a house could go at each sample,
   * which sounds more honest and is not: `validate` also refuses ground that is
   * merely OCCUPIED, so a big successful town measured as unbuildable simply
   * for being full of buildings, and would have prayed for a hillside to be
   * levelled when the real answer was "you have built on all of it".
   *
   * The prayer is about the LAND. Slope and water are the land.
   */

  /**
   * FAITH. Seconds without seeing a miracle before a town starts to wonder
   * whether anybody is still up there.
   *
   * A god game where the people never ask you to BE a god is missing something.
   * Gated on mood as well as time, so a contented town does not nag.
   */
  WONDER_SECONDS: 240,
  /**
   * 0.85, not 0.62. Measured: a fed, housed town sits between 0.70 and 1.00 and
   * spends much of its time at the ceiling, so the first threshold I picked was
   * below anything a working town ever reaches and the prayer could not fire at
   * all. This asks whenever they are merely doing all right, and leaves a town
   * that is genuinely delighted with you to get on with it.
   */
  WONDER_MOOD: 0.85,

  /**
   * THE BEAST. A creature belonging to another god, inside their borders.
   *
   * New in Phase 20 and impossible before it - there was one creature in the
   * world and it was yours. Answered by driving it off, which is the platoon
   * banner or your own beast, and it is the only prayer either of those can
   * settle.
   */
  BEAST_URGENCY: 0.7,

  /**
   * PARCHED FIELDS. Average crop across a town's farms below this is fields
   * that are being cut faster than they come back.
   *
   * Deliberately NOT during a drought - that is `weather`'s prayer and two
   * voices asking for the same rain is the noise this system exists to avoid.
   * This is the ordinary kind: too many mouths, not enough green.
   *
   * It is also the only thing in the game that ever asks for the WATER miracle,
   * which is the cheapest of the four and, until now, the one with the least
   * reason to exist.
   */
  /**
   * Measured over five minutes of a working town: the average across its farms
   * sits at 1.00 most of the time, dips to 0.92 at the lower quartile and
   * bottoms out near 0.36. So 0.35 - my first guess - was BELOW the floor and
   * the prayer was unreachable. 0.55 catches a real dip without firing every
   * time somebody cuts a field.
   */
  CROP_LOW: 0.55,
  CROP_CLEAR: 0.8,
  /** Farms a town needs before its fields are worth praying about. */
  CROP_MIN_FARMS: 2,
  /** Town food per head below which the whole town is in trouble. */
  TOWN_FOOD_PER_HEAD: 2.2,
  /** Wood or ore below this, while growth is blocked on it, is a real shortage. */
  SUPPLY_FLOOR: 25,

  /**
   * Chance a qualifying condition actually becomes a prayer, per scan. Below 1
   * so that a crisis produces a few voices rather than one per villager per
   * tick, and so identical conditions do not all fire on the same frame.
   */
  CHANCE: 0.22,

  /** Urgency above this is drawn and announced differently. */
  URGENT_AT: 0.6,

  /** How close an answer has to happen to count as answering THIS prayer. */
  ANSWER_RADIUS: 34,
  /** A rescue counts if the villager ends up this far from what threatened it. */
  SAFE_DISTANCE: 40,

  /**
   * Belief and alignment consequences, applied by miracles.js when it hears
   * `prayer-resolved`. Small on purpose: one prayer must never swing a town.
   * For scale, the passive trickle is about 15 belief a minute.
   */
  BELIEF_ANSWERED: 6,
  /** Extra for answering an urgent prayer inside PROMPT_SECONDS. */
  BELIEF_PROMPT_BONUS: 4,
  PROMPT_SECONDS: 20,
  /** Lost when a prayer expires unanswered. Smaller than the gain, by design. */
  BELIEF_EXPIRED: -2.5,
  /** Lost when the requester dies with the prayer still open. */
  BELIEF_FAILED: -4,

  /**
  /**
   * CRUELTY, for not answering. Every one of them, not every fourth.
   *
   * Turning your back on someone who asked for help by name is a cruel act in
   * itself, and the first version only registered it as a pattern - four
   * ignored prayers for one small penalty. A god who never comes is not
   * neutral.
   *
   * `FAILED` is heavier than `EXPIRED` because it means they died still asking,
   * rather than simply giving up on you.
   *
   * Sized against the rest of the moral economy rather than in isolation. At
   * -0.03 an unanswered prayer, with penance suspended, fifteen idle minutes
   * pinned a god at the FLOOR - the same -1 as conquering two towns and killing
   * a dozen people, for doing nothing. Neglect should be damning, not the most
   * damning thing available.
   *
   * At these values fifteen minutes of ignoring everyone lands around -0.45:
   * unambiguously Cruel, with the floor still reserved for what you do rather
   * than what you fail to do.
   */
  ALIGN_EXPIRED: -0.018,
  ALIGN_FAILED: -0.04,
  /** Ignoring a desperate plea is worse than ignoring an ordinary one. */
  URGENT_NEGLECT_MULT: 1.6,

  /**
   * How many unanswered in a row suspend penance. No separate escalation any
   * more: when every ignored prayer charges its own cost, an extra penalty on
   * top of a running total is the same crime billed twice.
   */
  NEGLECT_STREAK: 4,

  /**
   * NEGLECT SETS A FLOOR THAT PENANCE CANNOT LIFT YOU ABOVE.
   *
   * Penance (ALIGNMENT.PENANCE_RATE) pulls a cruel god back toward neutral at
   * about +0.36 a minute, so that cruelty fades if you stop feeding it. That
   * swamps any believable per-prayer penalty by roughly ten to one: the numbers
   * said a god who ignored every plea would still drift toward neutral at +0.3
   * a minute, which makes the whole mechanic decorative.
   *
   * The first fix was to suspend penance outright while prayers went ignored,
   * and it was too blunt - measured, it did not merely stop neglect being
   * washed away, it removed the safety valve for EVERY other cruelty too, and
   * fifteen idle minutes pinned a god at the floor mostly on the strength of
   * their creature eating people.
   *
   * So neglect instead sets a floor. Penance still runs, still forgives what
   * you did and stopped doing, and simply cannot lift you above the level your
   * unanswered prayers hold you at. Answer one and the streak resets, the floor
   * returns to zero, and the road back opens immediately.
   */
  NEGLECT_FLOOR_PER: 0.07,
  NEGLECT_FLOOR_MAX: 0.55,

  /**
   * MERCY, for answering. The largest repeatable kindness in the game.
   *
   * The first version paid belief for an answered prayer and almost no mercy -
   * +0.012, and only for an urgent one answered inside twenty seconds. That was
   * wrong on its face: someone asked you for help by name and you came, and it
   * counted for a third of what putting up a shed counts for.
   *
   * For scale against the rest of ALIGNMENT: a birth is +0.006, a building
   * +0.035, feeding your people +0.05, a food miracle +0.07. An answered prayer
   * sits at the top of that band and an urgent one clears it, because it is the
   * only act in the game that is a RESPONSE - the difference between being
   * generous and being asked.
   *
   * It compounds with the redemption curve from Phase 13, and that is the point:
   * positive shifts are amplified the further into cruelty you are, so at -1 an
   * urgent answered prayer is worth about +0.24. The way back from being a
   * monster is to start listening to your people again, which is the right
   * story for this mechanic to tell.
   */
  ALIGN_ANSWERED: +0.045,
  /** On top of the above, when the prayer was urgent. */
  ALIGN_ANSWERED_URGENT: +0.03,

  /** How near the creature has to be to notice a prayer at all. */
  CREATURE_NOTICE: 90
};

/**
 * Names, so a prayer can come from someone rather than from a unit.
 *
 * Villagers have had two traits and a life story since Phase 6 and no name to
 * put on any of it. "Save Mara" is a different sentence from "save villager 41".
 */
export const VILLAGER_NAMES = [
  'Mara', 'Bram', 'Ines', 'Cael', 'Tova', 'Rhys', 'Nell', 'Oskar',
  'Sella', 'Fenn', 'Lira', 'Doran', 'Wren', 'Halvo', 'Perrin', 'Ysolde',
  'Corin', 'Maeve', 'Sten', 'Anwen', 'Rook', 'Tamsin', 'Gareth', 'Isolde',
  'Bevan', 'Nia', 'Alder', 'Sorcha', 'Emrys', 'Verity', 'Hale', 'Bryn'
];

export const CAMERA = {
  MIN_DIST: 22,
  /**
   * Raised with the island, but not as far as it could go.
   *
   * The terrain is a finite plate spanning WORLD.EXTENT. Pull back far enough
   * and you see where it stops: water over seabed inside the plate, water over
   * nothing outside it, and a straight seam between them. Deepening the rim
   * changes that seam's contrast but cannot remove it - only ending the plate
   * beyond the horizon would, and that costs vertices for ocean nobody plays
   * in. So the zoom stops just before the edge of the world comes into frame,
   * which still frames the whole island with room to spare.
   */
  MAX_DIST: 430,
  START_DIST: 130,
  MIN_POLAR: 0.16, // near-horizontal ceiling (radians from vertical axis)
  MAX_POLAR: 1.32, // near-ground floor
  START_POLAR: 0.78,
  ZOOM_SPEED: 0.0016,
  ROTATE_SPEED: 0.0052,
  /** Radians per second when orbiting with Q/E. */
  KEY_ROTATE_SPEED: 1.5,
  /**
   * WASD panning, as a fraction of the current camera distance per second.
   *
   * Scaled by distance rather than fixed, which is the thing that makes RTS
   * keyboard panning feel right: zoomed in on a street you want to creep, and
   * zoomed out over the whole island you want to cross it in a few seconds. A
   * fixed speed can only be correct at one zoom level, and is maddening at the
   * other. 0.85 puts a full screen-width of travel at roughly a second.
   */
  KEY_PAN_SPEED: 0.85,
  /** Exponential smoothing rate. Higher = snappier, lower = floatier. */
  SMOOTH: 14,
  /** Target is clamped to this fraction of the island half-extent. */
  BOUNDS_FRAC: 0.86,
  /** Camera eye is never allowed closer than this to the ground. */
  GROUND_CLEARANCE: 4
};

// --- The hand ---------------------------------------------------------------
// This block is the feel of the game. Tune here first.
export const HAND = {
  /** How high above the terrain the empty hand floats. */
  IDLE_HOVER: 6.5,
  /** Default carry height above the ground when you first grab something. */
  CARRY_HOVER: 9,
  MIN_CARRY_HOVER: 1.6,
  MAX_CARRY_HOVER: 55,
  /** Mouse wheel while carrying raises/lowers the object by this per notch. */
  CARRY_LIFT_SPEED: 0.017,

  /** Spring pulling a held object toward the hand. Critically-ish damped. */
  GRAB_STIFFNESS: 150,
  GRAB_DAMPING: 19,
  /** Heavier objects lag further behind the hand: k / mass^MASS_LAG. */
  MASS_LAG: 0.55,
  /** Held objects cannot exceed this speed - stops the spring exploding. */
  MAX_HELD_SPEED: 130,

  /** Release velocity = mix(objectVelocity, handVelocity, THROW_BLEND) * THROW_GAIN. */
  THROW_BLEND: 0.45,
  THROW_GAIN: 1.22,
  /** Fraction of horizontal throw speed added as upward lift, so flicks arc. */
  THROW_ARC_BIAS: 0.2,
  MAX_THROW_SPEED: 105,
  /** Window (seconds) of cursor history averaged to get the flick velocity. */
  VELOCITY_WINDOW: 0.09,

  /**
   * Grab forgiveness, in screen pixels.
   *
   * An exact raycast is tried first; if it misses, the nearest prop within this
   * many pixels of the cursor is grabbed instead. Without it the game is
   * effectively unplayable with rocks: a typical rock is only ~7px in radius at
   * default zoom, its silhouette is an irregular squashed polyhedron, and a
   * measured click 4px off centre missed every single time. Worse, a missed
   * grab falls through to the camera and starts a pan, so a near-miss actively
   * yanks the view around.
   */
  PICK_TOLERANCE_PX: 22,
  /** Large props get a proportionally larger grab zone than the flat tolerance. */
  PICK_RADIUS_SCALE: 1.25,
  /**
   * Albedo multiplier on the prop under the cursor. Warm rather than merely
   * brighter: a uniform brightness boost just washes a grey rock out against
   * sunlit sand, whereas a golden tint reads unmistakably as "this is targeted".
   */
  HIGHLIGHT: [2.4, 1.85, 0.95],

  /** Spin imparted on release, proportional to throw speed. */
  THROW_SPIN: 0.055,
  /** How fast the fingers open/close, in curl units per second. */
  FINGER_SPEED: 9,
  /** 0 = palm always level, 1 = palm fully matches the terrain normal. */
  NORMAL_FOLLOW: 0.3,
  /** Radians of lean per unit of hand speed when banking into a move. */
  BANK: 0.011,
  /** Constant nose-down pitch so the fingers are visible from an RTS camera. */
  REST_PITCH: 0.5
};

// --- Rigid-ish body physics for grabbable props -----------------------------
export const PHYS = {
  GRAVITY: -34,
  /** Bounce energy kept along the surface normal. */
  RESTITUTION: 0.3,
  /** Velocity kept along the surface tangent on impact. */
  FRICTION: 0.7,
  /**
   * How deep the water must be under a prop before it counts as being IN the
   * sea. Keeps trees standing in a puddle on the beach, drowns anything out
   * past the shelf.
   */
  DROWN_DEPTH: 1.5,

  /** Below this speed on the ground, the prop goes to sleep. */
  SLEEP_SPEED: 0.9,
  /** Relaxed sleep threshold once a prop has been grounded for SETTLE_GRACE. */
  SLEEP_SPEED_LATE: 3.0,
  SETTLE_GRACE: 6,
  SLEEP_TIME: 0.35,
  ANGULAR_DAMPING: 0.86,
  /**
   * Angle of repose, expressed as (1 - normal.y). 0.20 is about 36 degrees:
   * gentler than that and friction holds an object in place, steeper and it
   * slides. Raise it to make the island stickier, lower it for scree slopes.
   */
  REPOSE: 0.20,
  SLIDE_ACCEL: 55,
  SLIDE_DRAG: 2.5,
  GROUND_FRICTION: 9,
  /** Impact speed above which we gouge the terrain and throw dust. */
  IMPACT_THRESHOLD: 14,
  /** Crater depth per unit of impact speed above threshold, times object mass. */
  CRATER_DEPTH: 0.02,
  CRATER_RADIUS: 1.15,
  MAX_CRATER_DEPTH: 2.4,
  /** Radius within which an impact shoves other props around. */
  SHOCKWAVE_RADIUS: 9,
  SHOCKWAVE_FORCE: 0.55,
  /** Water drag + how fast submerged props sink and stop. */
  WATER_DRAG: 3.2,
  /** Extra downward pull on a drowning prop, so it visibly goes under. */
  SINK_PULL: 9,
  /** Seconds a tree survives with its centre underwater before it is lost. */
  DROWN_TIME: 2.0,
  /** A tree carried further than this from where it grew counts as felled. */
  UPROOT_DIST: 2.0,
  /** Minimum uprightness (local up . world up) for a tree to count as planted. */
  UPRIGHT_DOT: 0.85
};

// --- Scatter ----------------------------------------------------------------
export const REGROW = {
  /**
   * FORESTS COME BACK. STONE DOES NOT.
   *
   * A felled tree leaves a stump that sprouts again after REGROW_DELAY and
   * takes REGROW_TIME to reach full size. It regrows exactly where it grew, by
   * reviving the same prop - the instance slot is still there, holding a
   * zero-scale matrix - so a forest recovers its own shape and no allocation
   * happens at all.
   *
   * Stone is deliberately final. Quarried land stays quarried, which is what
   * makes ore the thing worth going to war over rather than a renewable both
   * sides can wait out.
   */
  DELAY: 50,
  TIME: 70,
  /**
   * Margin added to a building's own pad before a stump is allowed to sprout
   * near it. Placement already clears props inside `pad * 0.9`; without this,
   * every one of them grew straight back a minute later and the town filled up
   * with trees pushing through its own walls.
   *
   * Per-structure rather than a flat radius, so a farm keeps a wide skirt and a
   * storage pit only keeps its own doorstep.
   */
  CLEARANCE: 3.5,

  /** A sapling is not worth walking to; villagers ignore one until it is grown. */
  HARVESTABLE_AT: 0.75
};

/**
 * BIOMES. Which trees grow at which altitude, and what grows under them.
 *
 * The island used to carry three interchangeable conifers from sea to summit,
 * which made every part of it look like every other part. Sorting the nature
 * kit's trees into bands gives the place regions you can navigate by: palms on
 * the sand, broadleaf in the lowland, pine on the heights.
 *
 * `to` is the upper height of the band. Each band lists the kit pieces it may
 * use and how tall they are drawn, since the kit's own scales vary a lot.
 *
 * Heights were cut by about a third once the towns had street furniture to
 * judge them against: a 13-unit tree beside a 5-unit house is botanically
 * defensible and visually wrong, because the kit's canopies are wide as well as
 * tall and a single oak was swallowing a whole street.
 */
export const BIOMES = [
  {
    name: 'shore', to: 5.5, height: [5.0, 7.5],
    trees: ['tree_palm', 'tree_palmBend', 'tree_palmDetailedTall', 'tree_palmTall']
  },
  {
    name: 'lowland', to: 17, height: [6.0, 9.5],
    trees: ['tree_oak', 'tree_default', 'tree_fat', 'tree_detailed',
            'tree_oak_dark', 'tree_default_dark', 'tree_blocks']
  },
  {
    name: 'upland', to: 30, height: [6.5, 10.0],
    trees: ['tree_cone', 'tree_tall', 'tree_detailed_dark', 'tree_cone_dark',
            'tree_default_fall', 'tree_oak_fall']
  },
  {
    name: 'timberline', to: 999, height: [5.5, 8.5],
    trees: ['tree_pineDefaultA', 'tree_pineRoundA', 'tree_pineTallA',
            'tree_cone_dark', 'tree_thin']
  }
];

/**
 * Stone, drawn from the same kit so the whole island matches.
 *
 * These are the `stone_*` family, whose single material is `stone` (#b8e2e8) -
 * actual grey rock. The kit ALSO has a `rock_*` family, which is not what the
 * name suggests: those are chunks of ground, built from `grass` and `dirt`
 * materials, meant for stacking into terrain. Scattering them across the island
 * produced teal-and-orange lumps that were rocks in name only.
 */
export const STONE_PIECES = {
  rocks: ['stone_smallA', 'stone_smallB', 'stone_smallD', 'stone_smallFlatA',
          'stone_smallG'],
  boulders: ['stone_largeA', 'stone_largeC', 'stone_largeE', 'stone_tallC']
};

/**
 * FLORA. Decoration only: no physics, no picking up, no harvesting.
 *
 * This is the layer that actually changes what the island looks like. Props are
 * a few hundred objects you can interact with; flora is a few thousand you
 * cannot, and it is what fills the ground between them. One InstancedMesh per
 * piece, never simulated, written once at startup and never touched again.
 */
export const FLORA = {
  /** How many to try to place. Bounded by the terrain that will accept them. */
  COUNT: 2600,
  /** Kept off slopes and out of the sea. */
  MIN_H: 1.2,
  MAX_H: 34,
  MAX_SLOPE: 0.34,
  /** Nothing decorative within this of a building, so streets stay clear. */
  CLEARANCE: 4.0,
  /**
   * What may grow, with a weight and a drawn height. Grass dominates because a
   * meadow is mostly grass; flowers and mushrooms are the accents you notice
   * precisely because they are rare.
   */
  PIECES: [
    { name: 'grass', weight: 26, height: [0.7, 1.2] },
    { name: 'grass_large', weight: 16, height: [1.0, 1.6] },
    { name: 'grass_leafs', weight: 10, height: [0.8, 1.3] },
    { name: 'plant_bush', weight: 8, height: [1.1, 1.8] },
    { name: 'plant_bushLarge', weight: 5, height: [1.6, 2.4] },
    { name: 'flower_redA', weight: 4, height: [0.8, 1.1] },
    { name: 'flower_yellowA', weight: 4, height: [0.8, 1.1] },
    { name: 'flower_purpleA', weight: 3, height: [0.8, 1.1] },
    { name: 'mushroom_red', weight: 2, height: [0.5, 0.8] },
    { name: 'mushroom_redGroup', weight: 2, height: [0.6, 0.9] },
    { name: 'stump_old', weight: 3, height: [0.9, 1.4] },
    { name: 'log', weight: 2, height: [0.9, 1.3] },
    { name: 'stone_smallC', weight: 5, height: [0.6, 1.1] }
  ]
};

/**
 * TERRACING. The island is cut into steps rather than rolling smoothly.
 *
 * This is the nature kit's own idiom - its whole cliff family exists to build
 * stepped, blocky dioramas - and it is the single biggest change available to
 * how the place reads, because it changes the SILHOUETTE rather than the
 * dressing on top of it.
 *
 * It stays a heightfield, which is the whole reason it is affordable: every
 * system in the game asks the terrain one question, `heightAt`, and none of
 * them care whether the answer came from a smooth surface or a staircase.
 * Buildings still flatten, props still seat, villagers still walk.
 *
 * SHARPNESS shapes the riser between two steps. It must stay finite: a true
 * square edge is an infinite slope, and `maxSlopeIn` would refuse to let you
 * build anywhere near one.
 */
export const TERRACE = {
  /** 0 disables the whole thing and gives back the old rolling island. */
  STRENGTH: 0.82,
  /** Height of one step. Bigger means fewer, broader plateaus. */
  STEP: 4.6,
  /** Higher = flatter tops and steeper risers. Beyond about 8 it aliases. */
  SHARPNESS: 3.0,
  /** Beaches stay smooth; terracing fades in above this. */
  START_H: 3.0,
  FADE: 7.0
};

/**
 * SCENERY. Set-dressing drawn from all three Kenney kits.
 *
 * Flora is the small stuff underfoot; scenery is everything larger that the
 * game does not reason about - cliff faces on the terrace risers, crops behind
 * a farm, a lantern on a street corner, an obelisk on a summit. Like flora it
 * has no physics and is never simulated, so it costs one instance matrix each
 * and can be numerous.
 *
 * The reason it earns its place is that TERRACE gave the island a stepped
 * silhouette and nothing was dressing the steps: a riser was just a steeper
 * patch of grass. The nature kit's cliff family exists for exactly this.
 */
/**
 * GRAVEYARDS. Where the dead go, and the only lasting record of what it cost.
 *
 * This game kills a great many people - starvation, raids, the beast, a throw
 * that ended badly - and until now the world forgot each one instantly. Phase
 * 17 counts them per team and alignment already tracks how cruel you have
 * been; neither leaves a mark you can walk past.
 *
 * A burial ground grows outside every town, one stone per soul, and it is the
 * one piece of the map you cannot spend, harvest or undo.
 */
export const GRAVEYARD = {
  /** Sim seconds between attempts to site a town's plot, once it needs one. */
  SITE_EVERY: 4,
  /** How far out from the keep the plot is looked for. */
  SITE_RANGE: [34, 62],
  /** The plot's own radius. Stones are scattered inside this. */
  PLOT_RADIUS: 16,
  /** Ground steeper than this will not take a burial ground. */
  MAX_SLOPE: 0.5,
  /** Keep this clear of any building when siting. */
  BUILD_CLEARANCE: 14,

  /**
   * The hard ceiling on stones in one plot.
   *
   * A grave per death with no cap is this project's recurring bug wearing a
   * hat: a long cruel game kills hundreds and the field would grow without
   * limit. Past this the toll keeps counting and the ground stops changing -
   * see `buried` versus `stones` in graveyard.js.
   */
  MAX_STONES: 44,
  /** Stones this close together are refused, so the field does not fuse. */
  MIN_SPACING: 3.6,
  /** Tries to find a free spot for one stone before giving up on it. */
  PLACE_TRIES: 12,

  /** Ordinary graves, picked at random per burial. */
  STONES: ['gravestone-bevel', 'gravestone-round', 'gravestone-wide',
    'gravestone-cross', 'cross', 'cross-wood', 'gravestone-decorative'],
  /** Replaces a stone when the ground has been disturbed - raids, the beast. */
  BROKEN: ['gravestone-broken', 'gravestone-debris', 'grave'],

  /**
   * Deaths that earn a whole stone rather than a broken one.
   *
   * The full set the game emits is: starved, drowned, dropped, crushed,
   * soldiers, creature, fireball, lightning. Everything not listed here is
   * violent, so a new cause defaults to a broken stone - which is the safer
   * way round for a table that is easy to forget to update.
   */
  PEACEFUL: ['starved', 'drowned'],

  /**
   * Landmarks that appear as the toll mounts, once each.
   *
   * The point of the ladder: you can read how bad it has been from across the
   * valley without opening a panel. A field of stones is a hard winter; an
   * obelisk and a crypt is a reign.
   */
  LANDMARKS: [
    { at: 1, piece: 'lightpost-single', size: 4.8, ring: 0.0, tag: 'lamp' },
    { at: 8, piece: 'cross-column', size: 5.0, ring: 0.55, tag: 'cross' },
    { at: 18, piece: 'pillar-obelisk', size: 6.4, ring: 0.0, tag: 'obelisk' },
    { at: 30, piece: 'crypt-small', size: 7.0, ring: 0.62, tag: 'crypt' },
    { at: 50, piece: 'crypt', size: 8.6, ring: 0.70, tag: 'greatcrypt' },
    { at: 80, piece: 'crypt-large', size: 10.4, ring: 0.78, tag: 'mausoleum' }
  ],

  /** Iron railing around the plot. Segments are spaced around the perimeter. */
  FENCE_PIECE: 'iron-fence',
  FENCE_GATE: 'iron-fence-border-gate',
  FENCE_SEGMENTS: 22,
  FENCE_SIZE: 4.0,

  /**
   * Sizes for the ordinary stones, randomised a little per grave.
   *
   * Up by about a third with everything else on this island. At the old size
   * they were literally life-sized against a house that is now 9.5 tall, which
   * from a playing camera read as gravel rather than gravestones.
   */
  STONE_SIZE: [2.4, 3.2],

  /** Beyond this the plot is not drawn at all. */
  VIEW: 420
};

export const SCENERY = {
  CLIFFS: {
    /**
     * How many to try.
     *
     * Restrained on purpose. Terracing made most of the island's interior a
     * riser of some kind, so a high count does not read as "rocky hillsides",
     * it reads as rubble tipped over everything. Outcrops are punctuation.
     */
    COUNT: 420,
    /**
     * Only on risers. Below this the ground is a terrace top, and a cliff
     * standing on flat grass reads as a dropped box.
     */
    MIN_SLOPE: 0.46,
    MIN_H: 3.5,
    /**
     * The size of the box a cliff must fit inside, on its largest axis.
     *
     * Not height and not width: the family contains flat plates AND tall
     * columns, so pinning either one lets the other run away. Sized against
     * the terrace STEP so an outcrop spans about one riser.
     */
    SIZE: [3.5, 6.5],
    /**
     * Buried by this fraction of their width. A cliff block is a box, and a box
     * set down on a curved heightfield shows daylight under one corner unless
     * it is sunk in.
     */
    SINK: 0.30,
    /**
     * The kit's cliff faces point +Z. Rotating that to face downhill is the
     * whole trick: an outcrop that faces INTO the hill is invisible, and one
     * that faces across it looks dropped.
     */
    FACE_YAW: 0,
    /**
     * Grass-topped and earthy low down, grass-topped and stony higher, bare
     * stone above the treeline - the same banding the trees already use, so
     * the rock agrees with the forest about where the mountain starts.
     */
    BANDS: [
      { to: 14, pieces: ['cliff_block_rock', 'cliff_half_rock', 'cliff_blockSlope_rock',
                         'cliff_rock', 'cliff_diagonal_rock', 'cliff_blockQuarter_rock'] },
      { to: 30, pieces: ['cliff_block_stone', 'cliff_half_stone', 'cliff_blockSlope_stone',
                         'cliff_diagonal_stone', 'cliff_blockHalf_stone'] },
      { to: 999, pieces: ['cliff_stone', 'cliff_large_stone', 'cliff_blockQuarter_stone',
                          'cliff_cornerLarge_stone'] }
    ]
  },

  /** Rare, large, and on open high ground: things to navigate by. */
  LANDMARKS: {
    COUNT: 14,
    MIN_H: 12,
    MAX_SLOPE: 0.16,
    /** Kept well clear of towns - a landmark inside a village is street furniture. */
    TOWN_CLEARANCE: 40,
    PIECES: [
      { name: 'statue_obelisk', height: [9, 14] },
      { name: 'statue_head', height: [5, 7] },
      { name: 'statue_column', height: [7, 10] },
      { name: 'statue_columnDamaged', height: [5, 8] },
      { name: 'statue_ring', height: [6, 9] }
    ]
  },

  /** The beach: what washes up and what is pulled up onto it. */
  SHORE: {
    COUNT: 90,
    /** The band of sand between the waterline and the grass. */
    H: [0.6, 3.2],
    MAX_SLOPE: 0.30,
    PIECES: [
      { name: 'canoe', height: [1.1, 1.5], weight: 3 },
      { name: 'log', height: [1.0, 1.4], weight: 4 },
      { name: 'stone_smallFlatA', height: [0.7, 1.2], weight: 6 },
      { name: 'plant_bushDetailed', height: [1.4, 2.0], weight: 4 }
    ]
  },

  /**
   * The TOWN SQUARE. Street furniture from the fantasy town and castle kits,
   * laid around each settlement's centre when it is founded.
   *
   * These come from textured kits, not the untextured nature kit, so they draw
   * with the town colormap and match the houses rather than the hillside. That
   * is the whole point of taking them from the town kit: a lantern that matches
   * the roof it stands under reads as part of the same place.
   */
  SQUARE: {
    /** Laid in a ring at this radius from the town centre, jittered. */
    RING: [13, 26],
    JITTER: 3.0,
    MAX_SLOPE: 0.30,
    /**
     * From the fantasy town kit.
     *
     * FREE-STANDING PIECES ONLY, and that restriction is the whole lesson of
     * this table. A kit is not a bag of props: most of its parts are authored
     * for one context and are meaningless out of it. `planks` is a floor,
     * `fountain-round` is one arc of a basin, `banner-red` hangs off a wall.
     * Set any of them on open grass and you get a raft, a grey disc and a rug.
     * What survives being scattered is what already stands on its own legs.
     */
    TOWN: [
      { name: 'lantern', count: 5, size: [2.4, 3.2] },
      { name: 'cart', count: 2, size: [2.6, 3.2] },
      { name: 'cart-high', count: 1, size: [2.8, 3.4] },
      { name: 'stall-green', count: 1, size: [3.4, 4.0] },
      { name: 'stall-red', count: 1, size: [3.4, 4.0] },
      { name: 'stall-stool', count: 3, size: [0.9, 1.2] },
      // No hedges: the town kit's are long low boxes meant to be laid end to
      // end into a garden wall. One on its own, sized to fit a box, is a green
      // capsule lying on the grass. Same failure as the banners - a piece that
      // needs neighbours to make sense does not survive being scattered.
      { name: 'fence', count: 5, size: [1.8, 2.4] },
      { name: 'tree-crooked', count: 2, size: [4.5, 6.0] }
    ],
    /**
     * From the castle kit. The flags and banners are deliberately absent: they
     * are the best-looking things in the pack and they belong ON the castle,
     * mounted by town.js where the geometry is assembled, not lying in a field.
     */
    CASTLE: [
      { name: 'rocks-small', count: 3, size: [1.6, 2.4] },
      { name: 'rocks-large', count: 2, size: [2.6, 3.6] },
      { name: 'tree-log', count: 2, size: [2.0, 2.8] }
    ]
  },

  /**
   * DRESSING. Applied per building as it goes up, not scattered at startup,
   * because most of a town does not exist yet when the island is generated.
   *
   * This is what makes a settlement read as lived in: a farm with no crops on
   * it is a shed in a field.
   */
  DRESSING: {
    farm: { ring: [4.5, 8.0], count: 14, pieces: [
      'crops_wheatStageB', 'crops_cornStageC', 'crops_leafsStageB',
      'crops_dirtRow', 'crop_carrot', 'crop_pumpkin'
    ], height: [1.6, 2.6] },
    cattle: { ring: [5.0, 8.5], count: 10, pieces: ['fence_simple', 'fence_planks',
      'fence_simpleHigh', 'crops_wheatStageA'], height: [1.8, 2.8] },
    house: { ring: [3.4, 5.4], count: 3, pieces: ['fence_simple', 'crops_leafsStageA',
      'plant_bush'], height: [1.4, 2.2] },
    manor: { ring: [4.6, 7.4], count: 7, pieces: ['fence_simple', 'plant_bushDetailed',
      'plant_bush', 'crops_leafsStageB', 'flower_redA'], height: [1.5, 2.4] },
    lumber: { ring: [4.0, 7.0], count: 8, pieces: ['log', 'stump_old', 'stump_oldTall',
      'fence_planks'], height: [1.5, 2.4] },
    mine: { ring: [4.2, 7.2], count: 8, pieces: ['stone_smallA', 'stone_smallB',
      'stone_smallFlatA', 'stone_largeA', 'fence_planks'], height: [1.2, 2.2] },
    /**
     * The drill yard. Dressing rather than geometry - see makeBarracksGeo for
     * why putting fences in the model made the building itself come out a third
     * the size of a hut.
     */
    barracks: { ring: [5.0, 8.0], count: 12, pieces: ['fence_planks', 'fence_simpleHigh',
      'fence_simple', 'stump_old'], height: [1.6, 2.5] },
    default: { ring: [3.8, 6.2], count: 4, pieces: ['plant_bush', 'fence_simple',
      'plant_bushDetailed'], height: [1.4, 2.2] }
  }
};

export const SCATTER = {
  // Counts scale with AREA, not with extent, or a bigger island is a barer one.
  // These are the original 340 / 210 / 26 multiplied by the 2.3x change in land.
  TREES: 790,
  ROCKS: 490,
  BOULDERS: 60,
  /** Trees only grow between these heights and below this slope. */
  TREE_MIN_H: 2.6,
  TREE_MAX_H: 30,
  TREE_MAX_SLOPE: 0.38,
  ROCK_MIN_H: 1.2,
  ROCK_MAX_H: 52,
  ROCK_MAX_SLOPE: 0.62,
  /** Minimum spacing between scattered props, so they never interpenetrate. */
  TREE_MIN_DIST: 7.5,
  ROCK_MIN_DIST: 9
};

// --- Town, buildings and economy (Phase 2) ----------------------------------
export const TOWN = {
  /** Influence radius with zero population. */
  BASE_INFLUENCE: 52,
  /** Extra radius per villager. Growth is the main "progress" feedback loop. */
  INFLUENCE_PER_POP: 1.35,
  MAX_INFLUENCE: 190,
  /** How fast the ring eases toward its target radius, per second. */
  INFLUENCE_SMOOTH: 1.4,

  /**
   * Population growth: needs surplus food AND a spare bed.
   * A birth requires food >= GROWTH_FOOD_RESERVE + GROWTH_FOOD_COST (32).
   * START_FOOD must sit clearly above that or a fresh town can never grow even
   * once - see the note on START_FOOD below.
   */
  GROWTH_FOOD_COST: 12,
  GROWTH_FOOD_RESERVE: 20,
  GROWTH_INTERVAL: 14,

  /**
   * Starting stockpile, enough to put up the first few buildings.
   *
   * START_FOOD was 30 against a breeding threshold of 32, which meant a new
   * town was two food short of ever growing and, since farms are the only food
   * source, could only ever fall further behind. Building houses did nothing at
   * all until a farm went up, with no feedback saying so. Keep this comfortably
   * above GROWTH_FOOD_RESERVE + GROWTH_FOOD_COST.
   */
  START_FOOD: 48,
  START_WOOD: 60,
  START_ORE: 10,
  START_POP: 8,

  /**
   * Rival settlements. Each runs the same economy on the same tick as the
   * player's; the only difference is that a rival decides its own building
   * placement instead of waiting for a god to point.
   */
  /**
   * How many rivals. SET AT BOOT by `setCivilisations` - see CIVS below.
   *
   * Everything downstream was already written for N: the reckoning builds one
   * team per town it finds, awe and raids iterate `state.towns`, the graveyard
   * sites a plot per town. The whole cost of another civilisation is GEOMETRY.
   */
  RIVALS: 2,
  /** Minimum distance between any two town centres. */
  /** Raised with the island, so towns spread out instead of huddling mid-map. */
  TOWN_SPACING: 230,
  /** How far a banner colour is pulled back toward white when tinting. */
  TINT_MIX: 0.7,
  /** Banner colours: index 0 is the player, the rest are rivals in order. */
  COLOURS: [0xa8ddff, 0xff9d6b, 0xb59bff, 0x8ee08a, 0xe8d27a],
  NAMES: ['Your people', 'Ashfell', 'Duncove', 'Marrow', 'Kelvedon'],
  /** A rival opens with this many villagers and these buildings. */
  RIVAL_START_POP: 6,
  RIVAL_START_BUILD: ['house', 'farm', 'house'],
  /** How often a rival considers putting up a new building. */
  RIVAL_BUILD_INTERVAL: 12,

  /**
   * Winning a rival over by awe rather than force. Impressiveness runs 0..1;
   * at 1 the town defects peacefully, bringing its people and land with it.
   */
  IMPRESS_PER_MIRACLE: 0.16,
  /** A cruel miracle in their sight sets the relationship back instead. */
  IMPRESS_MIRACLE_CRUELTY: -0.22,
  /** Awarded once when the player finishes a large building they can see. */
  IMPRESS_PER_BUILDING: 0.05,

  /**
   * ...and awe from a CREATURE putting on a show in somebody's streets.
   *
   * The `impress` desire has existed since Phase 3 and paid nothing. It burned
   * a little energy, threw some sparkles and was, mechanically, the creature
   * doing nothing at all - which is why no player ever had a reason to teach
   * it. It is a wonder that walks, and it now buys awe like any other wonder.
   *
   * Sized against the decay it has to beat and then MEASURED, because the
   * arithmetic I did first was wrong: I assumed a dance every three seconds and
   * a probe showed eleven every thirty. At 0.045 the meter went 0 to 1.0 in
   * ninety seconds, which is a whole civilisation for a minute and a half of
   * standing about. 0.030 puts it near three minutes.
   *
   * Three minutes IS the price, and it is not a cheap one: the creature is
   * standing in a hostile town the whole time, where the garrison will attack
   * it - a courting beast is not at war and does not fight back - and it is not
   * at home hauling, defending or eating while it does this.
   *
   * EVERY god's creature, including the player's. A rate only the rivals had
   * would be the fairness bug this project keeps finding, pointed the other
   * way for once.
   */
  IMPRESS_PER_DANCE: 0.030,
  /** How far outside a rival's own territory still counts as "in their sight". */
  IMPRESS_SIGHT_MARGIN: 45,
  /** Awe fades if you stop impressing them, per second. */
  IMPRESS_DECAY: 0.004,

  /** Footprint of the castle at the town centre, corner to corner. */
  /**
   * Everything on this island got about a third larger this phase, the keep
   * included, so it still towers over the hall and the manor rather than being
   * caught by them.
   */
  CASTLE_WIDTH: 23,

  /**
   * The keep is SOLID. Nothing walks through it.
   *
   * A circle, because `sizeToWidth` normalises the larger horizontal extent and
   * a castle is roughly as deep as it is wide - and because a circle is the one
   * shape you can resolve against by projecting a point outward, which is both
   * cheap and gives sliding along the wall for free.
   *
   * Slightly inside the visual footprint (11.5) so people hug the stonework
   * instead of stopping a pace short of it in mid-air.
   */
  CENTRE_SOLID: 10.5,

  /**
   * Where a villager with nothing better to do puts down what it is carrying.
   *
   * The keep having become solid, the centre point itself is unreachable, and
   * `dropOffPoint` used to return exactly that - so a town with no storage hut
   * would have had every carrier walk to the wall, fail to arrive, and never
   * deposit anything again. This is the gate: far enough out to stand in.
   */
  GATE_OFFSET: 12.5,
  /**
   * No building may be placed within this of the centre. Must clear the
   * castle's curtain wall or houses grow through the battlements.
   */
  // Up from 12 with the keep. A building may not be laid inside this, and the
  // castle is now 23 across, so 12 would have buried huts in the walls.
  CENTRE_CLEARANCE: 20,

  /** Buildings cannot be dropped closer than this to each other. */
  MIN_SPACING: 6.5,

  /**
   * YOUR PEOPLE BUILD FOR THEMSELVES.
   *
   * Rivals have had a build AI since Phase 8. Your town has had none - it sat
   * there waiting to be told, which is why an unattended game starved out
   * around minute eight in every soak from Phase 16 onward. A civilisation that
   * cannot put up a hut without divine instruction is not a civilisation.
   *
   * The line drawn here matters more than the mechanic: THE TOWN BUILDS WHAT IT
   * NEEDS TO SURVIVE AND PRODUCE; THE GOD BUILDS WHAT MAKES IT GRAND OR WARLIKE.
   * Houses, farms, paddocks, storage, camps and mines are subsistence, and a
   * people who cannot manage those on their own are a chore rather than a
   * kingdom. Barracks, manors and workshops stay yours - they are the decisions
   * with strategy in them, and handing those over would leave you watching.
   */
  SELF_BUILD: {
    ENABLED: true,

    /**
     * Slower than a rival's tick on purpose.
     *
     * They are building out of YOUR stockpile, and a town that empties the
     * stores the instant you fill them is a worse problem than one that builds
     * nothing.
     */
    INTERVAL: 14,

    /** Only these. Everything else waits for you. */
    ALLOWED: ['house', 'farm', 'cattle', 'storage', 'lumber', 'mine'],

    /**
     * ...AND THESE, ONCE SOMEBODY IS COMING (Phase 20).
     *
     * The list above is subsistence, and the grand and the warlike were left to
     * the player deliberately: you decide whether this is a kingdom of soldiers.
     * That was a fair division while nobody could take your seat off you, and
     * once rivals could, it was a hole with a five-minute fuse on it.
     *
     * Measured, not guessed. Traced at the moment of the fall: a raiding party
     * of seven walks in at 284 seconds and the town is gone by 291 - wall 116
     * to 0 in six seconds, GARRISON ZERO, because an unattended player never
     * builds a barracks and their people were forbidden from building one.
     * Twenty-six villagers with no soldiers is not a difficulty setting, it is
     * a town that cannot play.
     *
     * Gated on a raid being DECLARED on them rather than always allowed, so a
     * peaceful game still looks peaceful and the choice to militarise is still
     * yours right up to the moment somebody makes it for you.
     */
    ALLOWED_UNDER_THREAT: ['barracks'],

    /**
     * Seconds after the last time somebody marched on them that your people go
     * on believing there is a war.
     *
     * A raid is called off the instant its party breaks, and a town that forgot
     * about it four seconds later would demolish nothing but would never get
     * round to raising the second barracks it plainly needs.
     */
    THREAT_MEMORY: 180,

    /**
     * Never spend the stockpile below this.
     *
     * The player's town shares `state.resources`, so without a floor your
     * people would cheerfully spend the timber you were saving for a barracks
     * on another row of huts. With it, you can always out-save them.
     */
    RESERVE: { wood: 70, ore: 45 },

    /**
     * ...unless the need is desperate. Homeless or starving overrides the
     * reserve, because a hoard you are saving for a manor is no comfort to a
     * town that is dying.
     */
    URGENT_RESERVE: { wood: 0, ore: 0 }
  },

  /**
   * THE GROUND IS SHAPED TO FIT THE BUILDING, not the other way round.
   *
   * `place` has flattened a pad since Phase 1 - and `validate` refused to place
   * anything unless the ground was ALREADY flat, so the game declined to do the
   * one thing that would have made the spot work. Measured on an ordinary
   * island: only 40% of the land inside your own borders would take a house,
   * and "ground too steep" was three refusals in five.
   *
   * So per-building `maxSlope` is no longer a wall. It is the point at which
   * the earth has to be moved, which the placement ghost now says out loud.
   * This is the real limit: ground steeper than this is a cliff, and levelling
   * it would gouge a visible shelf out of the hillside rather than settle a
   * building into it.
   */
  SHAPE_MAX_SLOPE: 0.85,

  /**
   * How far past the pad the shaping eases back to natural ground.
   *
   * Without a skirt the pad edge is a step: a disc of table-flat ground with a
   * lip all the way round it. This blends the shaped ground out into the hill.
   */
  SHAPE_SKIRT: 1.9,
  /**
   * How much of each resource a town tries to keep in hand, PER HEAD, plus a
   * flat floor. These drive what idle villagers go and do.
   *
   * They must scale with population. A fixed food target was a genuine death
   * spiral: a town of 27 aimed to hold the same 60 food as a town of 6, so once
   * consumption (~0.017 food/s a head) outran what that buffer covered between
   * job re-evaluations, the town starved - and because every town runs the same
   * economy, ALL of them died at around minute eight. Five-minute tests never
   * saw it.
   */
  FOOD_PER_HEAD: 5,
  FOOD_FLOOR: 40,
  WOOD_PER_HEAD: 2,
  WOOD_FLOOR: 80,
  ORE_PER_HEAD: 1.5,
  ORE_FLOOR: 40,

  /**
   * Farms allowed, per BED rather than per head.
   *
   * Keying this to current population meant a town halved by a raid was also
   * allowed fewer farms, so the cap resisted recovery from exactly the disaster
   * that caused it. Houses survive a raid; the right to feed the people who
   * will refill them should survive with them.
   */
  FARMS_PER_CAPACITY: 6,

  /**
   * Food a cattle farm puts in the store each second, with nobody tending it.
   *
   * A villager eats about 0.017 a second, so one paddock feeds about
   * twenty-five people forever.
   *
   * Up from 0.155, which fed nine - and nine is nothing. It was measured
   * producing exactly what it promised, 9.3 food a minute, against an ordinary
   * town of twenty eating 20 a minute: you built the thing, watched the stores
   * keep falling, and concluded it did nothing. Worse, it cost 34 wood to the
   * crop farm's 12 and needs the largest footprint in the game.
   *
   * A staffed crop farm still beats it comfortably - three farmers make about
   * 1.5 a second - and that is the trade the two buildings exist to offer:
   * THE PADDOCK REPLACES LABOUR, the field out-produces it. This number has to
   * be big enough that giving up the land is worth not spending the hands.
   */
  CATTLE_FOOD_RATE: 0.42,

  /**
   * Lumber camps. A camp does not cut anything itself - it makes the people who
   * do cut faster, by LUMBER_SPEED, on any tree within LUMBER_RADIUS of it.
   *
   * Expressed as a multiplier on SPEED, so 1.5 is the "50% faster" it says on
   * the tin and the work takes 1/1.5 of the time. Siting is the whole decision:
   * a camp in the middle of your woodland speeds up every axe in it, and one
   * next to the town hall speeds up nothing at all.
   */
  LUMBER_SPEED: 1.5,
  LUMBER_RADIUS: 34,

  /**
   * Mines. Exactly the lumber camp's bargain, for ore.
   *
   * A mine does not dig anything itself - it is a winch, a lamp and a barrow -
   * it makes whoever is working stone within MINE_RADIUS of it work faster, by
   * MINE_SPEED. Siting is the whole decision, same as the camp: a mine in the
   * middle of a boulder field speeds up every pick swinging in it, and one
   * next to the town hall speeds up nothing.
   *
   * The radius is tighter than the camp's because ore nodes cluster where the
   * rocks are, while trees carpet whole hillsides - the same radius would have
   * covered a rival's entire quarry from one building.
   */
  /**
   * The WORKSHOP. +50% to every kind of work within WORKSHOP_RADIUS.
   *
   * It had no economic effect at all: `def.workshop` was read in exactly two
   * places, one for how impressive the town looks and one for the rival build
   * AI's shopping list. It cost 30 wood and 15 ore to make the skyline nicer.
   *
   * The camp speeds up wood and the mine speeds up stone; the workshop speeds
   * up ALL THREE, including farming. Like both of them it is judged at the work
   * site, so a workshop in the town square still helps nobody - the decision is
   * which corner of your land gets the tools. It stacks with the other two,
   * deliberately: a
   * lumber camp inside a workshop's reach runs at 2.25x, which is a real reward
   * for planning a quarter of your town around one wood.
   */
  WORKSHOP_SPEED: 1.5,
  WORKSHOP_RADIUS: 30,

  MINE_SPEED: 1.5,
  MINE_RADIUS: 28,

  /** Farm crop regrowth per second. One farm should feed roughly 6-8 villagers. */
  CROP_REGROW: 0.075,
  /**
   * How far alignment swings a town's mood, either way. At 0.18 a saintly god
   * gains about a fifth more happiness - and so a fifth more belief - than a
   * monstrous one, which is enough to feel without making cruelty unplayable.
   */
  ALIGNMENT_MOOD: 0.18,

  /** Happiness floor, so even a miserable town trickles some belief. */
  MIN_HAPPINESS: 0.15
};

/**
 * Building catalogue. `cost` is deducted on placement, `maxSlope` is measured
 * as (1 - normal.y), and `pad` is the radius the terrain gets levelled over.
 */
export const BUILDINGS = {
  house: {
    label: 'House', key: 'house', color: 0xd8c9a8, mercy: 1.0,
    cost: { wood: 20 }, housing: 4, pad: 5.4, maxSlope: 0.26
  },
  /**
   * The MANOR. Eight beds instead of four.
   *
   * Not a house at a bigger scale - two bays wide and two storeys tall, so it
   * reads as a different building from across the valley rather than as a house
   * someone zoomed in on. That distinction is the whole reason to have it: a
   * town of manors should LOOK like a wealthier town, not a blurrier one.
   *
   * Priced above two houses and gated behind ore, so it is the thing you build
   * when you have run out of room rather than the thing you always build. It
   * also wants flatter ground than a hut does, which is where the shovel comes
   * in - the two features were designed in the same week and they should have
   * something to say to each other.
   */
  manor: {
    label: 'Manor', key: 'manor', color: 0xcbb894, mercy: 1.0,
    cost: { wood: 58, ore: 18 }, housing: 8, pad: 8.6, maxSlope: 0.19
  },
  farm: {
    label: 'Farm', key: 'farm', color: 0xc8b45e, mercy: 1.0,
    cost: { wood: 12 }, farm: true, workSlots: 3, pad: 8.8, maxSlope: 0.22
  },
  /**
   * The CATTLE FARM. Food that needs no farmer.
   *
   * The crop farm is the efficient option and the fragile one: it wants three
   * villagers standing in it, and the moment a raid arrives they flee or die and
   * it produces nothing at all. Cattle graze whatever is happening. It costs
   * more, it needs more flat ground, and it yields less per acre - but it feeds
   * you through the disaster that empties your fields, which is exactly the
   * trade the town economy was missing.
   */
  cattle: {
    label: 'Cattle Farm', key: 'cattle', color: 0x9db06a, mercy: 1.0,
    cost: { wood: 34, ore: 8 }, cattle: true, pad: 10.8, maxSlope: 0.16
  },
  /**
   * The LUMBER CAMP. It cuts nothing. It makes the people who cut faster.
   *
   * Not a producer - a MULTIPLIER. It is a saw, a whetstone and somewhere to
   * stack timber, and every woodcutter working within its reach swings faster
   * for it. Build it where the trees are and every axe in that wood speeds up;
   * build it in the square and it does nothing whatsoever.
   *
   * That is the difference between it and the cattle farm, which is the other
   * new building: the paddock replaces labour, the camp multiplies it.
   */
  lumber: {
    label: 'Lumber Camp', key: 'lumber', color: 0x8a7048, mercy: 0.5,
    cost: { wood: 30, ore: 12 }, lumber: true, pad: 7.3, maxSlope: 0.26
  },
  /**
   * The MINE. +50% to working stone, within MINE_RADIUS.
   *
   * Priced mostly in TIMBER on purpose. Charging much ore for the building that
   * produces ore is the kind of bootstrap problem that reads as a bug: you need
   * the thing to afford the thing. Twelve is a couple of boulders' worth.
   *
   * Allowed on steeper ground than anything else in the catalogue, because a
   * mine belongs in a hillside and the ore it exists to speed up is scattered
   * over exactly the slopes every other building refuses.
   */
  mine: {
    label: 'Mine', key: 'mine', color: 0x8e8a86, mercy: 0.5,
    cost: { wood: 42, ore: 12 }, mine: true, pad: 7.3, maxSlope: 0.34
  },
  storage: {
    label: 'Storage Pit', key: 'storage', color: 0xa9926c, mercy: 0.5,
    cost: { wood: 15 }, storage: true, pad: 5.4, maxSlope: 0.24
  },
  workshop: {
    label: 'Workshop', key: 'workshop', color: 0xb08d63, mercy: 0.5,
    cost: { wood: 30, ore: 15 }, workshop: true, pad: 6.2, maxSlope: 0.24
  },
  barracks: {
    label: 'Barracks', key: 'barracks', color: 0x9a6b52, mercy: 0.0,
    // Pad up from 5.0 with the building: the old one was sized for a one-bay
    // tower, and this is a two-bay hall with a watchtower over it.
    cost: { wood: 40, ore: 25 }, barracks: true, pad: 9.5, maxSlope: 0.24
  }
};

export const VILLAGER = {
  /**
   * HOW MANY PEOPLE THE WHOLE ISLAND CAN HOLD - every civilisation together,
   * not each.
   *
   * Written by `setCivilisations`, because 150 shared between five gods is
   * thirty each and a thirty-person civilisation stops feeling like one. It was
   * a fine number when the island had three towns on it and only one of them
   * was being played.
   *
   * See CIVS.POP_PER_CIV for the arithmetic. This is the value the instanced
   * meshes are sized to, so it must be settled before initVillagers runs -
   * which it is: the picker resolves at boot, long before any system is built.
   */
  MAX: 150,
  /**
   * Villagers are drawn larger than life. At true scale against 11-unit trees
   * they are a couple of pixels at normal zoom and the town looks empty.
   */
  SCALE: 1.5,
  /** Every character model is normalised to this height before SCALE. */
  BODY_HEIGHT: 1.5,
  /** Walk-cycle frames advanced per unit of stride phase. */
  STRIDE_RATE: 1.1,
  /** How far the per-villager tint is pulled back toward the model's own colours. */
  TINT_MIX: 0.72,
  WALK_SPEED: 5.0,
  /** Villagers refuse to path into water; this is the shallowest ground used. */
  MIN_WALK_HEIGHT: 0.4,

  /**
   * WEAR. A node being worked shrinks as it goes, so chopping reads as chopping
   * rather than as a villager standing still and a tree vanishing. Purely
   * cosmetic: the collision radius and the yield are untouched.
   */
  /** Scale a fully-worked node reaches just before it is stripped. */
  WEAR_MIN_SCALE: 0.42,
  /** How fast an abandoned node grows back, in wear units per second. */
  WEAR_RECOVER: 0.35,

  /** Seconds to strip one resource node, and how much it yields. */
  CHOP_TIME: 4.0,
  MINE_TIME: 5.5,
  FARM_TIME: 5.0,
  WOOD_PER_TREE: 8,
  ORE_PER_ROCK: 6,
  FOOD_PER_HARVEST: 10,

  /** Needs run 0..1. Hunger climbs, energy drains. */
  HUNGER_RATE: 0.0125,
  ENERGY_RATE: 0.0085,
  HUNGER_EAT_AT: 0.72,
  ENERGY_SLEEP_AT: 0.18,
  EAT_DURATION: 2.5,
  SLEEP_RATE: 0.13,
  FOOD_PER_MEAL: 1,

  /** Starving villagers lose health and eventually die. */
  STARVE_DAMAGE: 0.035,

  /** How far a villager will walk from the town centre to reach a job. */
  /**
   * TORCHES AT NIGHT.
   *
   * Phase 19 gave the island a night and left it lit only by the sky. A crowd
   * of people moving through the dark with nothing in their hands reads as a
   * crowd that cannot see - so they carry lanterns, and the village becomes a
   * scatter of moving lights instead of a grey field.
   *
   * `lantern-candle` from the graveyard kit, which is a hand lantern and was
   * already sitting there unused. Held in the off hand, so a villager carrying
   * a load carries both.
   *
   * EMISSIVE, NOT A LIGHT. Eighty shadow-casting point lights would end the
   * frame budget in an afternoon - this is a bright material plus a small
   * additive glow, which under ACES tone mapping reads as a flame and costs two
   * instanced meshes for the entire population.
   */
  /**
   * TORCHES AT NIGHT.
   *
   * Phase 19 gave the island a night lit only by the sky. A crowd moving
   * through the dark with nothing in their hands reads as a crowd that cannot
   * see, so after dusk they carry lanterns.
   *
   * EVERY SIZE HERE IS A FRACTION OF THE VILLAGER, not a world number, because
   * the first attempt was sized against the scene and engulfed them: the flame
   * came out 1.5 units across on a person 2.25 units tall, an orange ball two
   * thirds their height. A villager is `BODY_HEIGHT x SCALE` = 2.25 units, and
   * every value below is written as a share of that so the comparison is the
   * one that matters and is impossible to skip.
   */
  TORCH: {
    ENABLED: true,
    PIECE: 'lantern-candle',

    /**
     * The lantern itself, as a fraction of body height.
     *
     * 0.24 puts it at about 0.54 units - a thing you could carry in one hand.
     * It was 1.9 units flat, which on a 2.25-unit villager was a lantern nearly
     * as tall as the person holding it.
     */
    SIZE: 0.24,

    /** Out to the side into the hand, as a fraction of body height. */
    SIDE: 0.20,
    /** Up the body to hand height. */
    HEIGHT: 0.52,
    /** A little in front, so it does not sit inside the chest. */
    FORWARD: 0.07,

    /**
     * The flame, as a fraction of body height.
     *
     * 0.30 - about 0.68 units - and the number took three attempts, because the
     * two obvious answers are both wrong:
     *
     *   1.5 units (67% of a villager) engulfed them. An orange ball with
     *   someone inside it.
     *
     *   0.29 units (13%) was physically right and INVISIBLE. At the distance
     *   this game is played from, a villager is about eight pixels tall, so an
     *   honestly-sized lantern flame is smaller than one pixel.
     *
     * So a flame here is a halo rather than a physical object - deliberately
     * bigger than a real one, because the alternative is nothing at all. What
     * makes that safe is the DEPTH TEST plus the offset into the hand: it is
     * held 0.45 out to the side with a radius of 0.34, so it sits beside the
     * body rather than across it, and the body occludes whatever passes behind.
     * The first version failed on all three counts at once.
     */
    GLOW_SIZE: 0.30,
    /** Up from the lantern's base, so the flame sits at its top. */
    GLOW_LIFT: 0.16,
    GLOW_COLOR: 0xffb459,
    GLOW_OPACITY: 0.85,
    /** How much the flame breathes, and how fast. */
    FLICKER: 0.25,
    FLICKER_RATE: 7.5,

    EMISSIVE: 0xff9040,
    EMISSIVE_I: 1.8
  },

  SEARCH_SLACK: 12,

  /**
   * How far past their own border they will walk for work when the near stuff
   * is gone, before anyone stands about.
   *
   * Deliberately much wider than SEARCH_SLACK. Props regrow, so a stripped wood
   * is temporary - but "temporary" is minutes, and a town standing idle through
   * it looks broken rather than patient.
   */
  FAR_SLACK: 90,
  /** Re-evaluate an idle villager at most this often, to spread out CPU. */
  IDLE_RETRY: 0.8,

  ARRIVE_DIST: 1.6,

  /**
   * BEING PICKED UP. A villager is far lighter than a rock, so the carry spring
   * barely lags and a flick sends them a long way - which is the entire appeal.
   */
  GRAB_MASS: 0.5,
  GRAB_RADIUS: 1.1,
  /** Falls gentler than this are walked off. Faster ones hurt. */
  FALL_SAFE_SPEED: 22,
  /** Health lost per unit of impact speed above FALL_SAFE_SPEED. Health is 1. */
  FALL_DAMAGE: 0.05,

  /**
   * FLEEING. A villager who keeps hoeing while a soldier cuts them down reads
   * as broken, and it is what made Brave and Timid describe a reaction that
   * never happened.
   */
  /**
   * FIGHTING BACK. A villager with a hoe is not a soldier and must never read
   * like one: FIGHT_DPS is a fraction of COMBAT.DPS, so one farmer swinging at
   * an armed man is futile and eight of them are not. That ratio is the whole
   * design - it makes a mob a real thing without making the barracks pointless.
   *
   * Whether they stand or run is decided by COURAGE: a villager fights when the
   * friends around them outnumber the enemies by enough, and "enough" is scaled
   * by their own nerve. This is what finally separates Brave from Timid, which
   * until now paired each trait's advantage with its own drawback and cancelled
   * to nothing.
   */
  /** Damage a villager deals per second. COMBAT.DPS is 0.26 for a soldier. */
  FIGHT_DPS: 0.045,
  /** How close they have to be to swing. */
  FIGHT_RANGE: 2.4,
  /** How far around themselves they count friends and enemies. */
  COURAGE_RADIUS: 20,
  /**
   * Friends needed per enemy before an average villager will stand and fight,
   * multiplied by their own `flee` trait. Brave (0.60) stands at ~1.6 to one;
   * Timid (1.55) needs better than 4 to one before they will hold at all.
   */
  COURAGE_RATIO: 2.7,

  /** An enemy soldier inside this distance sends a villager running. */
  FLEE_RADIUS: 22,
  /**
   * The radius is multiplied by this before deciding it is safe again, so a
   * villager at the boundary does not flicker between working and bolting.
   */
  FLEE_HYSTERESIS: 1.45,
  /** Seconds of quiet before going back to work. */
  FLEE_CALM: 3.0,
  /** Running is faster than walking, on top of the villager's own speed trait. */
  FLEE_SPEED: 1.55,
  /**
   * A villager runs for the town centre, unless the threat lies that way - then
   * it runs directly away instead, this far, and re-decides on arrival.
   */
  FLEE_AWAY_DIST: 30
};

// --- The creature (Phase 3) -------------------------------------------------
// Everything here is meant to be hand-tuned. See creature.js for the reasoning
// behind each group; the short version of each is in the comments below.
export const CREATURE = {
  // --- body / growth ---
  /** Which Cube Pets animal to hatch as, before the player picks one. */
  DEFAULT_ANIMAL: 'animal-fox',
  /**
   * Every animal is normalised to this height at scale 1, so switching species
   * does not change how big your creature is or how its physics feel.
   */
  BODY_HEIGHT: 4.6,
  /**
   * Roughly how wide the body is at scale 1, for collision only.
   *
   * The creature is the one thing on the island big enough that treating it as
   * a point would bury half of it in a castle wall, so its own bulk widens the
   * circle it is pushed out of. Multiplied by `scale`, so a grown beast keeps
   * further out than a hatchling.
   */
  BODY_RADIUS: 1.8,
  /** Movement speed above which it plays `run` instead of `walk`. */
  RUN_SPEED: 5.5,
  /** How long a slap/stroke reaction clip holds the body before state resumes. */
  REACTION_TIME: 0.9,
  START_SCALE: 0.85,
  MAX_SCALE: 2.3,
  /** Seconds of life to reach full size on age alone. */
  MATURE_AGE: 600,
  /** Meals to reach full size on food alone. Age and food each supply half. */
  FOOD_TO_MATURE: 45,

  // --- movement ---
  MOVE_SPEED: 8.0,
  TURN_SPEED: 3.2,
  ARRIVE_DIST: 4.5,
  /** Won't stray further than this from the player's hand unless unleashed. */
  LEASH_RANGE: 60,

  // --- perception ---
  /** How far it looks for something to act on. */
  SENSE_RADIUS: 60,
  /** How far away it can witness the player doing something, for imitation. */
  VIEW_DIST: 85,

  // --- needs (0..1) ---
  HUNGER_RATE: 0.011, // hunger climbs
  ENERGY_RATE: 0.007, // energy drains
  DIRT_RATE: 0.004, // cleanliness drains
  EAT_RESTORE: 0.42,
  /**
   * NUTRITION. How much a mouthful of each thing actually feeds it, as a
   * multiplier on EAT_RESTORE. Anything absent from this table is 0: the
   * creature swallows it and nothing happens.
   *
   * This is what makes learning from consequences possible AT ALL. Until now
   * EAT_RESTORE was applied whatever it ate, so a boulder was exactly as
   * nourishing as a tree - and you cannot learn from an outcome that does not
   * differ. The lesson had to exist in the world before the creature could
   * notice it.
   */
  NUTRITION: { tree: 1.0, villager: 0.35 },
  /**
   * A meal at or above this counts as a GOOD one, and teaches the creature that
   * the thing is food. Below it, the lesson runs the other way.
   *
   * This is what stops a person being the best thing on the menu. Villagers were
   * briefly the most nutritious thing in the world (1.15), and because outcomes
   * now teach, every one it ate made it keener to eat the next: a runaway that
   * ended with a creature doing nothing but hunting your own people - 110 eat
   * actions against 23 hauls in a four-minute sample. A person is a mouthful,
   * not a meal, and the world should be what teaches it that.
   */
  NUTRITION_GOOD: 0.6,
  /** Eating something with no food in it is work for nothing, and costs. */
  INEDIBLE_COST: 0.07,
  SLEEP_RESTORE: 0.11,
  GROOM_RESTORE: 0.30,

  // --- decision loop ---
  /**
   * Peak multiplier on a fully-unmet survival need (hunger, energy, dirt).
   * Raise it and the creature becomes a slave to its stomach; lower it and it
   * will happily play until it starves.
   */
  /**
   * How much more attractive it is to put on a show for STRANGERS (Phase 20).
   *
   * `impress` paid nothing until this phase, so where it was aimed never
   * mattered. It buys awe now - TOWN.IMPRESS_PER_DANCE - and awe only accrues
   * from towns that are not yours, so a creature that prefers its own square is
   * a creature whose god has no peaceful route to anything.
   *
   * Sized like ENEMY_APPETITE, which does the same job for eating and for
   * violence, and for the same reason: it is a preference, not a rule. A
   * creature standing in its own village with nothing else nearby still dances.
   */
  STRANGER_AUDIENCE: 2.6,

  /**
   * Felled timber is the creature's preferred meal: a tree lying loose has its
   * eat-score multiplied by this, a standing one is damped by the penalty.
   *
   * Not a hard ban on eating living trees - starving it in a cleared forest
   * would be worse - but in practice it clears every felled tree in reach
   * before touching one still growing, which also stops it competing with the
   * villagers for timber.
   */
  LOOSE_FOOD_BONUS: 3.2,
  PLANTED_FOOD_PENALTY: 0.22,

  NEED_URGENCY: 2.4,

  /**
   * Grooming is an instinct, not one of the six learnable desires, so it has a
   * fixed weight instead of a trainable one. Raise it and the creature fusses
   * over its cleanliness instead of getting on with things.
   */
  GROOM_INSTINCT: 0.5,

  /**
   * Hauling. The creature fetches wood and ore for the town when the `help`
   * desire wins, carrying far more per trip than a villager can - which is the
   * point of having a beast of burden the size of a house.
   */
  HAUL_WOOD: 26,
  HAUL_ORE: 18,
  /** Seconds spent tearing a node down before it can be carried. */
  HAUL_GATHER_TIME: 2.6,
  /**
   * How much a town's shortage of a resource sways which node it fetches.
   * At 1 it ignores need; higher and it chases whatever the stockpile lacks.
   */
  HAUL_SHORTAGE_WEIGHT: 2.2,
  /** Stockpile level at or above which a resource counts as plentiful. */
  HAUL_SATED: 120,

  /**
   * WAR. Plant the platoon banner on hostile ground and the creature is called
   * to it: it drops whatever it was doing, marches to the flag and fights
   * beside the soldiers until the order is lifted or it is driven off.
   *
   * Its stats are deliberately expressed as a base pair plus a multiplier
   * rather than as two sets of numbers, because the doubling is the point: a
   * beast fighting under its god's banner is worth a platoon on its own, and
   * the same animal wandering into a rival's land alone is not.
   */
  /** Damage one swipe deals to a soldier or a villager. Villager health is 1. */
  WAR_ATTACK: 0.55,
  /** Damage one swipe deals to a building. COMBAT.BUILDING_HP is 40. */
  WAR_ATTACK_BUILDING: 6,
  /** Incoming damage is divided by this. */
  WAR_DEFENSE: 1,
  /**
   * Attack and defense are BOTH multiplied by this while the banner is an
   * attack order - a flat +100% to each. At 2.0 a swipe kills a soldier
   * outright instead of taking two, and it survives twice as long in the melee.
   */
  WAR_MULT: 2.0,
  /**
   * Appetite for other people's villagers, and restraint toward its own.
   * Multiplies the eat and attack scores for a villager candidate.
   */
  ENEMY_APPETITE: 3.5,
  /**
   * How much less appealing its OWN god's people are as a meal.
   *
   * Only reachable at all once the creature is genuinely starving - see
   * FRIEND_PREY_HUNGER. Below that it will not consider them, and it will never
   * attack them or its own god's buildings at any hunger, because there is
   * nothing to be gained from either.
   */
  FRIEND_RESTRAINT: 0.35,

  /**
   * How hungry it has to be before its own people look like food.
   *
   * HUNGER_RATE is 0.011/s, so hunger climbs from nothing to full in about
   * ninety seconds without a meal. 0.85 is a beast that has not eaten in well
   * over a minute and has ignored everything else it could have eaten first -
   * which is to say a beast its god has neglected.
   *
   * That outcome is deliberate and worth keeping. What was not worth keeping
   * was a WELL-FED creature doing it because somebody trained its `attack`
   * weight up for the war.
   */
  FRIEND_PREY_HUNGER: 0.85,
  /**
   * DEVOURING. At the front, an enemy civilian is eaten rather than swatted:
   * they take extra damage from a swipe, and each one feeds and heals the
   * creature. The healing is what lets it carve through a town without
   * grinding down to a rout, and it is why raiding a defenceless town is a
   * meaningfully different act from meeting an army.
   */
  DEVOUR_MULT: 2.5,
  DEVOUR_FEEDS: 0.30,
  DEVOUR_HEALS: 2.0,

  /** Reach of a swipe. It is the size of a house, so this is generous. */
  WAR_RANGE: 9,
  /**
   * How many enemies one swipe catches, nearest first. A sweep of a limb, not
   * an explosion: this is the number that decides whether a big enough force
   * can surround it and grind it down, or whether it soloes towns for free.
   */
  WAR_SWEEP: 3,

  /**
   * MONSTER AGAINST MONSTER (Phase 20 addendum).
   *
   * Creatures did not fight each other at all. `warTargets` gathered soldiers,
   * villagers and buildings, and nothing else - which was a complete list while
   * there was one creature in the world. Two beasts could stand in the same
   * square, each razing the other god's houses, and neither would so much as
   * look up.
   *
   * A creature is a much harder target than a man: it applies its own defense,
   * it heals, and it does not stay dead. So a swipe hurts it MORE than it hurts
   * a soldier, or the fight lasts forever and neither side can ever settle it.
   *
   * SIZED FROM THE ARITHMETIC, then checked. Both sides at war double their
   * attack AND their defense under WAR_MULT, so the multipliers cancel and an
   * even fight runs at exactly WAR_ATTACK_CREATURE per WAR_INTERVAL. Over
   * WAR_HEALTH 20 and WAR_INTERVAL 1.0s:
   *
   *   3.2 -> 6 seconds     far too fast to see, let alone react to
   *   1.4 -> 14 seconds
   *   0.9 -> 22 seconds    <- long enough to watch it turn and get a hand in
   *
   * Temperament still swings it hard either way: a Ferocious animal against a
   * Thick-hided one is a different fight from the reverse, which is most of the
   * reason the choice of species matters at all.
   */
  WAR_ATTACK_CREATURE: 0.9,

  /**
   * BEING ATTACKED IS A WAR, for this many seconds after the last blow.
   *
   * A creature's war comes from its god's front, and the first test of two
   * beasts fighting showed what that misses: the one standing in the player's
   * square was not at war by its own god's reckoning - its army was home and
   * nobody was in its land - so it never fought back and never doubled its
   * defense. It went from full health to routed in five seconds without
   * swinging once. That is not a fight, it is an execution.
   *
   * An animal being mauled does not wait for orders. Long enough to cover the
   * gap between blows several times over, short enough that a scuffle does not
   * leave it standing at war in an empty field.
   *
   * NOT for a creature on a peaceful leash. That is the price of the awe route:
   * a beast sent to perform in somebody's streets will stand there and take it,
   * and pulling it out before it is driven off is its god's job. A courting
   * creature that fought back would be an invading one.
   */
  WAR_PROVOKED: 8,

  /**
   * NO BINDING YOUR WOUNDS WITH A LION STANDING OVER YOU.
   *
   * WAR_REGEN is 0.9/s - a full heal in twenty-two seconds - and that was tuned
   * against soldiers, who do not follow a creature that has broken off. Another
   * creature does follow, and both withdraw at the same WAR_WITHDRAW and rejoin
   * at the same WAR_REJOIN, so two beasts mirror each other exactly:
   *
   *   fight to 7 -> both break off -> both heal to 18 -> fight to 7 -> ...
   *
   * A ten-minute duel measured four full cycles and NEITHER ANIMAL ROUTED. My
   * fox got as low as 1.9 and walked away at 20. A fight that cannot be settled
   * either way is not a fight.
   *
   * So regeneration stops while a hostile beast is this close, and a hurt
   * animal has to actually get clear to recover - which the retreat action
   * already tries to do. Deliberately about two and a half times WAR_RANGE:
   * out of reach is not the same as away.
   *
   * Only creatures. Soldiers do not stop it, because that IS the old tuning and
   * "carve through a town and sustain yourself" is the behaviour it buys.
   */
  HEAL_BLOCK_RANGE: 22,

  /**
   * How far clear of its own keep a hurt creature lies up.
   *
   * Far enough that it is standing on grass rather than pressed against the
   * wall - which is where it ended up when the retreat aimed at the centre of a
   * castle it can never enter, and looked exactly like the animal being stuck.
   */
  LAIR_MARGIN: 6,

  /**
   * ROAMING. How far it wanders when there is nothing at all within reach.
   *
   * The mind scores objects it can SEE, and self-directed acts - sleep, groom -
   * that need no object. So a creature standing where nothing is in
   * SENSE_RADIUS always picked a self act, and neither of those moves it: it
   * grooms, then sleeps, then grooms, in the same square metre, and nothing new
   * can ever come into range because it never goes anywhere. A soak found one
   * motionless in open country for nearly five minutes, and it would have stood
   * there until the match ended.
   *
   * Deliberately only when the candidate list is EMPTY, so it can never
   * outcompete a real decision - there is nothing to compete with.
   */
  ROAM_DIST: 55,
  /** ...and how tired it has to be before it would rather sleep than wander. */
  ROAM_MIN_ENERGY: 0.35,

  /**
   * WHAT A BEAST GOES FOR FIRST, as a multiplier on distance. Lower is more
   * attractive, so a rival's creature twice as far away still beats a farmer.
   *
   * Same shape as COMBAT.THREAT_WEIGHT, and for the same reason it exists
   * there: with two dozen civilians milling about, pure nearest-first means the
   * enemy monster is the last thing in the town it gets round to.
   */
  WAR_PRIORITY: { creature: 0.4, soldier: 0.75, villager: 1.0, building: 1.3 },
  /** Seconds between swipes. */
  WAR_INTERVAL: 1.0,
  /** Hit points. Mortals cannot kill a god's beast, but they can drive it off. */
  WAR_HEALTH: 20,
  /** Health regained per second when out of the fight. */
  WAR_REGEN: 0.9,
  /**
   * Seconds it sulks at home after being routed before it will answer the
   * banner again. WAR_REGEN * this must exceed WAR_HEALTH, or it returns to the
   * front already half dead and is routed again immediately.
   */
  WAR_ROUT_TIME: 25,
  /**
   * THE SUMMONS. Right-drag on the ground tells the creature where to be.
   *
   * A click is "go there"; a drag sizes the circle it is then free to roam
   * inside. It is a leash you draw rather than a leash you pick from a list,
   * which is the one thing the leash modes could never express: WHERE.
   */
  /** Radius of a plain right-click order, with no drag. */
  SUMMON_MIN_RADIUS: 18,
  SUMMON_MAX_RADIUS: 120,
  /** How close to the centre it settles when it has nothing else to do there. */
  SUMMON_ARRIVE: 6,
  /**
   * A summons more than this far outside its circle is walked back before
   * anything else is considered. Inside the circle the normal mind runs; it is
   * only the straying that is overridden.
   */
  SUMMON_SLACK: 8,

  /** How close it holds to the banner once there is nothing left to fight. */
  // Out from 12, so a full-grown creature can actually reach the distance it is
  // told to hold: the keep is solid at 10.5 and the beast's own bulk adds about
  // 3.6 on top of that.
  WAR_HOLD: 16,
  /**
   * How far from the BANNER the creature will fight. This is the leash, and it
   * is the whole reason the banner is an order rather than a suggestion.
   *
   * Without it the creature picked the nearest enemy within its own sense
   * radius, walked to it, and by arriving brought fresh enemies into range -
   * chaining itself target by target out of the town it was defending and all
   * the way into a rival's streets, where the full garrison drove it off. It
   * looked like the animal running away to pick fights on its own.
   */
  WAR_LEASH: 45,
  /**
   * Below this fraction of health it breaks off, walks back and heals instead
   * of fighting on until it is routed. Rejoins at WAR_REJOIN. The gap between
   * the two is what stops it flickering in and out of the line.
   */
  WAR_WITHDRAW: 0.35,
  WAR_REJOIN: 0.90,

  /** How often it reconsiders what to do, in seconds. */
  DECIDE_INTERVAL: 1.1,
  /** Time spent performing an action once it has walked to the target. */
  ACT_TIME: 2.2,

  // ---------------------------------------------------------------------
  // LEARNING. These five numbers are the whole personality of the game.
  // ---------------------------------------------------------------------
  /**
   * How hard one slap/stroke moves a DESIRE weight, before decay.
   *
   * Deliberately much smaller than LEARN_OPINION_BASE. When you slap a creature
   * for eating a boulder, the lesson is "boulders are not food" - it is NOT
   * "eating is bad". At 0.34 a handful of slaps drove `eat` to its floor and
   * the creature stopped eating anything at all and starved. The specific
   * opinion should carry the lesson; the desire only takes a gentle nudge.
   */
  LEARN_DESIRE_BASE: 0.10,
  /** How hard one slap/stroke moves an OPINION score, before decay. */
  LEARN_OPINION_BASE: 0.50,
  /**
   * Learning-rate decay per repetition: rate = BASE / (1 + reps * DECAY).
   * Higher = the first few lessons dominate and later ones barely register,
   * which is what makes early teaching stick. Lower = endlessly re-trainable.
   */
  LEARN_DECAY: 0.55,

  /**
   * LEARNING BY DOING. How hard an OUTCOME teaches, against LEARN_OPINION_BASE
   * of 0.50 for a slap.
   *
   * Deliberately much weaker. You remain by far the fastest teacher - the whole
   * game is that you are the one raising it - but you are no longer the ONLY
   * one. Left to itself for long enough the creature works out what food is,
   * which is what stops a neglected creature being a permanently stupid one.
   */
  SELF_TEACH_BASE: 0.15,
  SELF_TEACH_DECAY: 0.30,

  /**
   * PAIN. Damage taught in lumps rather than per tick, or a single fight would
   * bury every other lesson it has ever had under a thousand tiny ones.
   */
  PAIN_PER_LESSON: 4.0,
  PAIN_TEACH_BASE: 0.26,

  /** Watching the player do something is a weaker teacher than a slap. */
  IMITATE_BASE: 0.20,
  IMITATE_DECAY: 0.40,

  /**
   * Desire weights are clamped here. The floor is not cosmetic: a desire at
   * effectively zero is unrecoverable, because the creature can never perform
   * the act again and so can never be rewarded for it.
   */
  DESIRE_MIN: 0.08,
  DESIRE_MAX: 2.0,

  /**
   * Opinions start at 0 (no idea). This baseline is added when scoring, so an
   * unknown object still looks mildly worth trying - that is what makes a young
   * creature attempt to eat a boulder.
   */
  OPINION_BASELINE: 0.38,

  /**
   * Exploration noise, which decays as it accumulates lessons:
   *   curiosity = CURIOSITY_BASE / (1 + lessons * CURIOSITY_DECAY)
   * This is the single biggest lever on "readably dumb at first, competent
   * later". Raise CURIOSITY_BASE for a sillier infancy.
   */
  CURIOSITY_BASE: 0.85,
  CURIOSITY_DECAY: 0.07,

  // --- petting ---
  // --- telling a slap from a stroke ---
  // Slap and stroke are told apart by SMOOTHED cursor speed in screen pixels
  // per second, measured on the pointer rather than on the hand (the hand lags
  // the cursor on a spring and briefly moves very fast whenever the pointer
  // jumps).
  //
  // Below STROKE_MAX_SPEED, movement banks stroke credit. Above SLAP_SPEED,
  // sustained, it slaps. Between the two it does neither - though a real
  // back-and-forth pet dips below the lower threshold on every direction
  // change, so mid-speed petting still reads as stroking rather than dying in
  // the gap. Measured classification: everything up to ~2700px/s strokes,
  // 4200px/s and above slaps.
  /**
   * Speed a whip must sustain to count as a slap. At 60fps this is ~53px per
   * frame held for SLAP_SUSTAIN - a definite strike, not a brisk reposition.
   */
  SLAP_SPEED: 3200,
  /** How long the speed must stay above SLAP_SPEED. Rejects one-frame spikes. */
  SLAP_SUSTAIN: 0.03,
  /** Time constant for the cursor-speed smoothing. Larger = calmer, laggier. */
  SPEED_SMOOTH: 0.05,

  /** Below this speed, movement across the creature counts as stroking. */
  STROKE_MAX_SPEED: 1800,
  /** Pixels of unhurried travel that emit one stroke. Lower = easier to praise. */
  STROKE_DISTANCE: 90,
  /** A motionless hold this long still counts as a gentle pat on release. */
  STROKE_MIN_TIME: 0.18,
  /** Reinforcement is amplified while the leash of learning is attached. */
  LEARNING_LEASH_GAIN: 1.6,

  /** Lines kept in the creature's thought log. */
  LOG_LENGTH: 14
};

/**
 * Leash modes. Each multiplies desire weights when scoring, biasing what the
 * creature chooses without overwriting anything it has learned - take the leash
 * off and its own personality is intact underneath.
 */
export const LEASH_MODES = {
  learning: {
    label: 'Leash of Learning', color: 0x8fd8ff,
    bias: {}
  },
  compassion: {
    label: 'Leash of Compassion', color: 0x9be08a,
    bias: { help: 2.4, impress: 1.5, play: 1.2, attack: 0.2 },
    /**
     * A CREATURE ON THIS LEASH DOES NOT START A WAR BY BEING SOMEWHERE.
     *
     * combat.js has a rule that a creature standing inside a rival's borders
     * makes its own war on what it finds there - no banner needed. It is a good
     * rule and it is how you send a monster into a town. It also made the other
     * reason to go there impossible: `impress` buys awe since Phase 20, and awe
     * is the whole peaceful route to a town, but merely arriving to perform
     * declared war before the first step of the dance.
     *
     * So the leash decides which visit it is. Aggression means your beast makes
     * war where it stands; compassion means it is a guest. That is a real use
     * for a control the player already has, and it is the same rule a rival god
     * plays by - its courting stance sets exactly this leash.
     */
    peaceful: true
  },
  aggression: {
    label: 'Leash of Aggression', color: 0xe0553f,
    bias: { attack: 2.6, play: 1.2, help: 0.25, impress: 0.8 }
  },
  free: {
    label: 'Off the Leash', color: 0xd8c9a8,
    bias: {}
  }
};

/** Which opinion axis each desire consults when scoring a target. */
export const DESIRE_AXIS = {
  eat: 'edibility',
  play: 'fun',
  attack: 'threat',
  help: 'fun',
  impress: 'fun',
  sleep: null,
  groom: null
};

// --- Traits -----------------------------------------------------------------

/**
 * VILLAGER TRAITS. Two per villager, rolled at birth and fixed for life.
 *
 * Each trait is nothing but a set of multipliers on that villager's own
 * constants, so this table IS the system - you can retune every personality in
 * the game without opening villagers.js. Everything defaults to 1:
 *
 *   hunger  rate hunger climbs        energy  rate energy drains
 *   speed   walking speed             work    seconds to finish a job
 *   yield   resources carried a trip  meal    food eaten per meal
 *   starve  damage taken from hunger  armour  damage taken from soldiers
 *   belief  belief generated          idle    pause before looking for work
 *   flee    how early they run from a soldier
 *   wood / ore / food                 work multiplier for that job only
 *
 * `group` is what stops a villager being born both Hardy and Sickly: the two
 * rolls are drawn from different groups. Keep opposites in the same group.
 */
export const TRAITS = {
  // --- body: how well the flesh holds up ---
  hardy: { label: 'Hardy', group: 'body', hunger: 0.70, starve: 0.55 },
  sickly: { label: 'Sickly', group: 'body', starve: 1.90, energy: 1.30 },
  glutton: { label: 'Glutton', group: 'body', hunger: 1.45, meal: 2, yield: 1.15 },

  // --- temper: how they go about the day ---
  swift: { label: 'Swift', group: 'temper', speed: 1.35, energy: 1.15 },
  plodding: { label: 'Plodding', group: 'temper', speed: 0.80, energy: 0.70 },
  diligent: { label: 'Diligent', group: 'temper', work: 0.72 },
  lazy: { label: 'Lazy', group: 'temper', work: 1.45, idle: 2.4 },

  // --- craft: what they are good at ---
  woodsman: { label: 'Woodsman', group: 'craft', wood: 0.55 },
  miner: { label: 'Miner', group: 'craft', ore: 0.55 },
  grower: { label: 'Grower', group: 'craft', food: 0.55 },
  strong: { label: 'Strong', group: 'craft', yield: 1.60, speed: 0.92 },

  // --- spirit: what they make of you ---
  devout: { label: 'Devout', group: 'spirit', belief: 2.20 },
  doubter: { label: 'Doubter', group: 'spirit', belief: 0.35 },

  // --- nerve: what happens when soldiers come ---
  brave: { label: 'Brave', group: 'nerve', armour: 0.55, flee: 0.60 },
  timid: { label: 'Timid', group: 'nerve', armour: 1.35, speed: 1.15, flee: 1.55 }
};

/**
 * How much a trait may change the size a villager is drawn at.
 *
 * Traits lived entirely in the simulation and on a HUD census: you could not
 * look at a crowd and see anything about it. Build is the one channel a
 * baked-pose flipbook has spare - the tunic already carries the town colour -
 * so Strong and Plodding stand a little bigger, Swift and Sickly a little
 * smaller. Kept deliberately slight: this is a tell, not a caricature.
 */
export const TRAIT_BUILD = {
  strong: 1.13, plodding: 1.09, glutton: 1.07, hardy: 1.05,
  swift: 0.93, sickly: 0.90, timid: 0.95
};

/** How many traits each villager is born with, drawn from different groups. */
export const TRAIT_COUNT = 2;

/**
 * CREATURE TEMPERAMENT. The same idea for the animal, but it is one individual
 * rather than a crowd, so its two traits come from its SPECIES rather than from
 * a dice roll - which is what makes choosing your animal a real choice instead
 * of a skin. A lion is not a bunny with different fur.
 *
 * Multipliers, all defaulting to 1:
 *   attack / defense  war stats, applied BEFORE the banner's doubling
 *   speed             how fast it moves       hunger  rate hunger climbs
 *   eat               food value of a meal    learn   how fast it learns
 *   memory            multiplies LEARN_DECAY: higher = early lessons stick
 *   curiosity         exploration noise
 *   desire            per-desire multiplier on what it learns to want
 */
export const CREATURE_TRAITS = {
  ferocious: {
    label: 'Ferocious', group: 'blood',
    attack: 1.45, desire: { attack: 1.4, help: 0.8 }
  },
  gentle: {
    label: 'Gentle', group: 'blood',
    attack: 0.65, desire: { attack: 0.6, help: 1.4 }
  },
  thickHided: {
    label: 'Thick-hided', group: 'hide',
    defense: 1.50, speed: 0.88
  },
  fleet: {
    label: 'Fleet', group: 'hide',
    defense: 0.80, speed: 1.30
  },
  clever: {
    label: 'Clever', group: 'mind',
    learn: 1.40, curiosity: 0.70
  },
  stubborn: {
    label: 'Stubborn', group: 'mind',
    learn: 0.65, memory: 1.60, curiosity: 1.25
  },
  greedy: {
    label: 'Greedy', group: 'gut',
    hunger: 1.40, eat: 1.30, desire: { eat: 1.3 }
  },
  ascetic: {
    label: 'Ascetic', group: 'gut',
    hunger: 0.65, eat: 0.80, desire: { impress: 1.3 }
  }
};

/**
 * EARNED TRAITS. Not born with, but grown into - the animal's own history
 * showing on it. These are appended to whatever its species gave it, and are
 * kept separate from the species traits so that changing body does not wipe
 * everything the creature has been through.
 *
 * Same multiplier shape as CREATURE_TRAITS, plus a threshold and the counter it
 * is measured against.
 */
export const EARNED_TRAITS = {
  battleScarred: {
    label: 'Battle-scarred', counter: 'routs', at: 2,
    defense: 1.25,
    note: 'it has learned what surviving costs'
  },
  bloodied: {
    label: 'Bloodied', counter: 'kills', at: 25,
    attack: 1.20, desire: { attack: 1.15 },
    note: 'it has the taste for it now'
  },
  beloved: {
    label: 'Beloved', counter: 'praise', at: 20,
    learn: 1.15, desire: { help: 1.15 },
    note: 'it would do anything for you'
  }
};

/**
 * Which two traits each Cube Pets animal is born with. Hand-authored rather
 * than hashed from the name, because the whole point is that the lion should
 * read as a lion the moment you pick it.
 */
export const PET_TEMPERAMENT = {
  'animal-beaver': ['clever', 'thickHided'],
  'animal-bee': ['ferocious', 'fleet'],
  'animal-bunny': ['gentle', 'fleet'],
  'animal-cat': ['clever', 'ferocious'],
  'animal-caterpillar': ['greedy', 'stubborn'],
  'animal-chick': ['gentle', 'clever'],
  'animal-cow': ['gentle', 'greedy'],
  'animal-crab': ['thickHided', 'stubborn'],
  'animal-deer': ['fleet', 'ascetic'],
  'animal-dog': ['gentle', 'clever'],
  'animal-elephant': ['thickHided', 'greedy'],
  'animal-fish': ['fleet', 'stubborn'],
  'animal-fox': ['ferocious', 'clever'],
  'animal-giraffe': ['thickHided', 'ascetic'],
  'animal-hog': ['ferocious', 'greedy'],
  'animal-koala': ['ascetic', 'stubborn'],
  'animal-lion': ['ferocious', 'thickHided'],
  'animal-monkey': ['clever', 'greedy'],
  'animal-panda': ['gentle', 'ascetic'],
  'animal-parrot': ['fleet', 'clever'],
  'animal-penguin': ['gentle', 'thickHided'],
  'animal-pig': ['greedy', 'gentle'],
  'animal-polar': ['ferocious', 'greedy'],
  'animal-tiger': ['ferocious', 'fleet']
};

// --- Miracles, belief and alignment (Phase 4) -------------------------------
export const MIRACLE = {
  /** Belief per villager per second, at full happiness. */
  BELIEF_PER_VILLAGER: 0.055,
  MAX_BELIEF: 999,

  /**
   * WITNESSED MIRACLES. A wonder nobody sees is a wonder wasted.
   *
   * Belief has only ever trickled in from a happy population, which made the
   * miracle economy a tap you waited on rather than anything you could work at.
   * A miracle cast in front of a crowd now pays some of itself back, so WHERE
   * you cast matters as much as what: over the square at noon, not over an
   * empty field at the edge of your land.
   *
   * Weighted by each witness's own devotion, so Devout and Doubter reach into
   * this too - a congregation of believers is worth more than a mob.
   */
  /**
   * CLEARING THEIR LAND. The hand tidying clutter out of a town, in front of
   * the people who live in it, is a small wonder and pays like one.
   *
   * It is the same idea as a witnessed miracle, at a fraction of the size:
   * belief for being SEEN to do something for them. It also gives the hand -
   * which until now only ever moved things about - a reason to be used on the
   * town rather than only on the enemy.
   */
  CLEAR_RADIUS: 26,
  /** How far a thing must actually be moved before it counts as cleared. */
  CLEAR_MIN_DIST: 14,
  BELIEF_PER_CLEARED: 0.55,
  /** Ceiling per act, so a crowded square cannot be farmed with one rock. */
  CLEAR_MAX_BELIEF: 4,
  /** The same object cannot pay again for this long. */
  CLEAR_COOLDOWN: 25,

  /**
   * THROWING YOUR OWN PEOPLE. A god who picks a farmer up and hurls him across
   * the square is doing something unforgettable, and a crowd that sees it
   * believes harder.
   *
   * It pays only if they LIVE. A throw that drowns them or breaks them on the
   * rocks earns nothing and still costs alignment, so the spectacle has to be
   * survivable to be worth anything - which is the difference between a wonder
   * and a murder.
   */
  THROW_MIN_DIST: 18,
  BELIEF_PER_THROW_WITNESS: 0.9,
  THROW_MAX_BELIEF: 6,
  THROW_COOLDOWN: 20,

  WITNESS_RADIUS: 42,
  BELIEF_PER_WITNESS: 1.15,
  /**
   * The refund is capped as a fraction of what the miracle cost. Without this,
   * a big enough crowd makes casting free and then profitable, and the whole
   * economy becomes: stand in the square, press the button. Showing off should
   * make a miracle CHEAP, never free.
   */
  WITNESS_MAX_REFUND: 0.6,


  /** Cast radius on the ground for each effect. */
  WATER_RADIUS: 22,
  FOOD_RADIUS: 18,
  FIRE_RADIUS: 14,
  LIGHTNING_RADIUS: 9
};

/** Per-miracle cost, effect strength and alignment consequence. */
export const MIRACLES = {
  water: {
    label: 'Water', key: 'water', color: 0x4fc3e8, cost: 20,
    /** Crop growth added to farms in range, and cleanliness for the creature. */
    cropBoost: 0.55, align: +0.03
  },
  food: {
    label: 'Food', key: 'food', color: 0xe8c14f, cost: 30,
    foodGranted: 45, align: +0.07
  },
  fireball: {
    label: 'Fireball', key: 'fireball', color: 0xe8622f, cost: 55,
    craterDepth: 1.6, align: -0.06
  },
  lightning: {
    label: 'Lightning', key: 'lightning', color: 0xc9a6ff, cost: 45,
    craterDepth: 0.9, align: -0.05
  }
};

export const ALIGNMENT = {
  /** Alignment eases toward its target rather than snapping, per second. */
  SMOOTH: 0.7,

  /**
   * REDEMPTION. Coming back from cruelty used to be nearly impossible, and not
   * because any single number was wrong - because of the SHAPE of the system.
   *
   * Alignment was a pure accumulator with no way back but grinding: cruel deeds
   * weigh about twice what the best repeatable kind one does, they arrive in
   * bursts (a fireball takes several at once, a hungry man-eater eats all day,
   * conquering a town is -0.30 in a single stroke), and kind deeds are small and
   * occasional. Winning a war put you at the floor, and from the floor it took
   * something like thirty-three feedings to crawl back to neutral.
   *
   * These two numbers bend the curve instead of re-tuning every weight:
   *
   *   REDEMPTION  how much MORE a kind deed is worth, at full cruelty
   *   HARDENING   how much LESS a cruel deed costs, at full cruelty
   *
   * Both scale with how far down you are and vanish at neutral, so nothing
   * changes for a player who is not in the red. At -1 a kindness counts triple
   * and a further cruelty counts less than half: there is not much soul left to
   * lose, and the first step back is the one worth making cheap.
   *
   * Deliberately ONE-SIDED. It is not correspondingly hard to stay good - that
   * was not the complaint, and punishing sainthood to balance a table nobody
   * asked about is how you fix one thing and break another.
   */
  REDEMPTION: 2.2,
  HARDENING: 0.55,

  /**
   * PENANCE. A slow pull back toward neutral whenever you are in the red.
   *
   * Always running, so cruelty is a thing you have to keep DOING rather than a
   * mark you carry forever; doubled once you have gone PENANCE_AFTER seconds
   * without a cruel deed, so actually stopping is rewarded more than merely
   * easing off. It never pushes past neutral - this is absolution, not virtue,
   * and being good still has to be earned.
   *
   * Always-on rather than only-when-clean on purpose: a man-eating creature
   * commits a cruelty every few seconds, and a gate would have meant a player
   * who chose that creature could never do penance at all.
   */
  PENANCE_RATE: 0.006,
  PENANCE_AFTER: 25,

  /**
   * RAISING A BUILDING is a kindness, multiplied by that building's own `mercy`.
   *
   * This is the ONLY thing placing a building does beyond existing - it pays no
   * belief and widens no borders. Belief is what your people give you for
   * wonders; mercy is what raising something for them says about you.
   *
   * Until now the only repeatable merciful acts in the game were feeding people
   * and waiting for children to be born - both occasional, both small - while
   * cruelty had a dozen sources and arrived in bursts. Mercy was not hard
   * because the numbers were mean; it was hard because there was almost nothing
   * to DO. Building is the core loop, and putting a roof over someone is the
   * plainest good deed a god has available.
   *
   * `mercy` is per building in BUILDINGS: 1 for a home or a farm, 0.5 for the
   * useful-but-neutral sheds, and 0 for a barracks - a war-house is not a
   * kindness, and raising one should not launder anything.
   */
  RAISE_BUILDING: +0.035,

  /** Deed weights. Positive is merciful, negative is cruel. */
  FEED_VILLAGER: +0.05,
  MIRACLE_ON_OWN_TOWN: -0.04,
  CRUSH_VILLAGER: -0.07,
  DESTROY_OWN_BUILDING: -0.05,
  CREATURE_ATE_VILLAGER: -0.06,
  VILLAGER_BORN: +0.006,
  /**
   * Alignment past this magnitude swaps building geometry to the other variant.
   * Kept away from 0 so the silhouette does not flicker while hovering near
   * neutral.
   */
  GEOMETRY_SWAP_AT: 0.3
};

// --- Soldiers and conquest (Phase 5) ----------------------------------------
export const COMBAT = {
  MAX_SOLDIERS: 120,
  /** Soldiers are drawn a little larger than villagers so a platoon reads. */
  SOLDIER_HEIGHT: 2.6,

  /** A barracks turns food and ore into one soldier this often. */
  TRAIN_INTERVAL: 12,

  /**
   * REPLACING LOSSES. A barracks fills a gap in the line faster than it
   * recruits from nothing.
   *
   * Replacement already happened - a death frees a garrison slot and the next
   * cycle refills it - but at one man per TRAIN_INTERVAL for the whole town,
   * regardless of how many barracks you had built. A skirmish that cost eight
   * men took a minute and a half to undo, and the second barracks you paid for
   * did nothing except raise the ceiling. So losing a fight left you unable to
   * answer for long enough that the fight was effectively over twice.
   *
   * A town remembers how many men it owes itself and trains at this interval
   * until it has paid the debt off. Replacements still cost food and ore like
   * anyone else - this buys speed, not free soldiers.
   */
  REPLACE_INTERVAL: 3.5,

  /**
   * Training rate divides by the number of barracks, up to this many. Building
   * a second one should mean something beyond a bigger ceiling; past three the
   * returns stop, or a rich town simply prints an army.
   */
  MAX_TRAIN_BARRACKS: 3,

  /** When a cycle fires but cannot pay, retry this soon rather than waiting. */
  TRAIN_RETRY: 1.5,
  TRAIN_FOOD: 8,
  TRAIN_ORE: 5,
  /**
   * BARRACKS TIERS. A barracks can be upgraded, and the men it turns out are
   * better for it. A soldier takes its stats from the barracks that trained it
   * and keeps them for life, so upgrading does not retroactively improve the
   * garrison you already have - you have to train through it.
   *
   *   hp        hit points, against COMBAT.DPS of 0.26 a second
   *   power     multiplies EVERYTHING they deal: to soldiers, civilians,
   *             buildings and the creature alike, so one number is the whole
   *             difference in what a tier is worth in a fight
   *   garrison  how many this barracks supports
   *   cost      to upgrade INTO this tier; the first is what you start with
   */
  BARRACKS_TIERS: [
    { label: 'Militia', hp: 1.0, power: 1.00, garrison: 6, cost: null },
    { label: 'Men-at-arms', hp: 1.9, power: 1.35, garrison: 8, cost: { wood: 70, ore: 55 } },
    { label: 'Knights', hp: 3.2, power: 1.80, garrison: 10, cost: { wood: 140, ore: 120 } }
  ],
  /** Each tier draws its men a little larger, so a rank reads at a glance. */
  TIER_SCALE: 0.13,

  /** Each barracks supports this many soldiers; beyond it, training stops. */
  GARRISON_PER_BARRACKS: 6,

  MARCH_SPEED: 6.5,
  /** How close two enemies must be before they start swinging. */
  ENGAGE_RANGE: 7,
  /**
   * How far a soldier can see an enemy and charge it.
   *
   * Without this, both sides walk to the same rally point, stop at their spread
   * radius, and settle into a hollow ring exactly ENGAGE_RANGE apart - close
   * enough to see each other, too far to ever swing. A soldier must close on an
   * enemy it can see, not just stand on its mark.
   */
  SIGHT_RANGE: 30,
  /** Damage per second one soldier deals. SOLDIER_HP 1 => ~4s per kill 1v1. */
  DPS: 0.26,
  /**
   * Damage per second against an unarmed villager. Much faster than a fight
   * between soldiers - a farmer with a hoe is not a duel - but not instant, so
   * you can see a raid happening and still call the platoon off.
   */
  CIVILIAN_DPS: 0.8,
  SOLDIER_HP: 1,
  /** Soldiers hold this loosely around their rally point. */
  RALLY_SPREAD: 9,

  /**
   * SIEGE ENGINES.
   *
   * Wall damage has been an abstract number ticking down since Phase 5, and the
   * kit has shipped a catapult, trebuchet, ballista, ram and siege tower - each
   * with a demolished variant - unused the whole time.
   *
   * The rule that makes them worth building: soldiers can only break a wall
   * once the garrison is dead, but an ENGINE batters it whatever is happening
   * around it. That is the whole point of one. Your men hold the line, the
   * engine does the work, and the enemy knows to go for the engine.
   */
  ENGINE_COST: { wood: 90, ore: 70 },
  /** Engines per barracks. A siege train is a serious investment. */
  ENGINES_PER_BARRACKS: 1,
  /** Wall damage a second. Against WALL_HP 120, one engine is about 25s. */
  ENGINE_SIEGE_DPS: 4.8,
  /** They lumber. Half a soldier's march, so a siege train has to be escorted. */
  ENGINE_SPEED_FRAC: 0.5,
  ENGINE_HP: 6,
  /** How close an engine must be to batter a wall. Longer than a sword. */
  ENGINE_RANGE: 34,
  /** Engines are slow and precious, so the enemy goes for them first. */
  ENGINE_THREAT_WEIGHT: 0.3,

  /**
   * Siege. A town's curtain wall must be brought down before it can be taken,
   * which is what stops a single soldier walking in and claiming a city.
   */
  WALL_HP: 120,
  /** Wall damage per attacker per second, once inside SIEGE_RANGE. */
  SIEGE_DPS: 2.6,
  SIEGE_RANGE: 30,
  /**
   * What the creature is worth to a siege, counted in soldiers.
   *
   * Without this a god who sends his beast to annihilate a town's garrison, its
   * people and its houses is left standing in the ruins with no way to take the
   * place - the wall will not come down for him and the surrender needs three
   * MEN inside it. You could destroy a rival utterly and still never capture
   * them, which also made the victory condition unreachable by that route.
   *
   * At 3 the creature alone is exactly a capturing force. It has to break the
   * wall first like anyone else, and the garrison still has to fall first.
   */
  CREATURE_SIEGE_WORTH: 3,

  /**
   * A MONSTER CANNOT ACCEPT A SURRENDER (Phase 20).
   *
   * The comment above is from a phase when there was one creature in the world
   * and it was the player's, so "the creature alone is exactly a capturing
   * force" was a power the player had earned and nobody could use against them.
   * The first five-way soak showed what it becomes when it is symmetric: a
   * rival's beast wandered into the player's undefended square at 75 seconds,
   * knocked the wall down on its own and had taken the capital by 1:56, before
   * the player had raised a barracks or the raid grace had even expired.
   *
   * The creature still counts for everything else - it brings the wall down at
   * CREATURE_SIEGE_WORTH, it holds the ground, it is most of the force. What it
   * cannot do is be the ONLY thing standing there when the town gives in. A god
   * who wants a town has to send somebody to take the keys.
   *
   * Symmetric, and it costs the player almost nothing: whoever razed a town
   * with a monster has an army somewhere.
   */
  CAPTURE_NEEDS_A_SOLDIER: true,

  /** Attackers needed inside the walls to force a surrender once breached. */
  CAPTURE_ATTACKERS: 3,
  /**
   * Walls slowly rebuild if the siege is abandoned - UP TO THE FIRST BREACH.
   *
   * Damage repairs; a breach does not. Once the wall has actually been brought
   * to zero the town is open for the rest of the match, and `town.breached`
   * says so permanently.
   *
   * This is the difference between a siege that costs something and one that
   * does not. At 1.5/s a 120-point wall is whole again in eighty seconds, so an
   * army that broke through, was beaten off, and came back found the same wall
   * waiting - and nothing an attacker ever did left a mark. The breach is now
   * the thing you are fighting for, and it is worth fighting for because it is
   * permanent.
   *
   * Capture does not mend it either. Taking a town does not hand you an intact
   * fortress; it hands you the ruin you made of one.
   */
  WALL_REGEN: 1.5,

  /**
   * Seconds a town cannot change hands again after changing hands (Phase 20).
   *
   * A HOT POTATO IS NOT A WAR. The first five-way soak produced eleven captures
   * in seven minutes - Marrow went 3 to 2 to 4 to 1 to 3, and Duncove changed
   * owner four times in a hundred seconds - because capture resets the wall to
   * full and every other army standing in the square simply starts again on it.
   * Nothing was wrong with any single one of those captures; the sequence was
   * absurd, and unreadable to a player trying to follow who holds what.
   *
   * This is the garrison consolidating: the wall goes back up, the new owner's
   * men take the gate, and it takes a fresh siege to shift them. Long enough
   * that a town changing hands is an event, short enough that a bad conquest
   * can be punished inside the same war.
   */
  CAPTURE_GRACE: 45,

  /**
   * Target preference, as a multiplier on distance when choosing what to hit.
   * Lower is more attractive, so an armed enemy twice as far away still wins
   * over a farmer. Strict tiers were wrong: with two dozen civilians milling
   * about, buildings never came up at all and a town could be taken without a
   * single wall being touched.
   */
  THREAT_WEIGHT: { engine: 0.3, creature: 0.5, soldier: 0.45, villager: 0.85, building: 1.0 },

  /**
   * Damage per second one soldier deals to the creature, in creature health.
   * Kept separate from DPS because the two are on different scales: a soldier
   * has 1 hit point and the creature has twenty. Ten men take about eleven
   * seconds to drive off a creature fighting at its doubled war defense.
   */
  DPS_VS_CREATURE: 0.35,

  /**
   * Razing. Buildings soak damage rather than falling instantly, so a raid on a
   * town reads as a fight over its streets rather than things blinking out.
   */
  BUILDING_HP: 40,
  BUILDING_DPS: 2.4,

  /**
   * Putting a town's civilians to the sword. The single cruelest act available,
   * per head, and it is charged only to whoever ordered it.
   */
  ALIGN_PER_CIVILIAN: -0.05,

  /**
   * RAIDING. Rivals march on their neighbours - including each other - instead
   * of only ever standing in their own square. Every number here is a brake:
   * left ungoverned, a rival with two soldiers walks them into a garrison of
   * twelve on repeat and the world becomes a meat grinder.
   */
  /**
   * HOME DEFENCE. An enemy inside your borders is answered by whatever you have
   * standing there - the garrison at home and the creature - without you having
   * to move the banner.
   *
   * The margin is added to the influence radius on both tests: intruders count
   * a little outside the border, and a soldier counts as "at home" a little
   * outside it too, so a garrison camped on the edge still turns around.
   */
  DEFEND_MARGIN: 25,

  /** No raid until a town holds at least this many soldiers. */
  RAID_MIN_ARMY: 6,
  /** Fraction of the garrison that marches. The rest stays as a home guard. */
  RAID_FRACTION: 0.65,
  /** How often a town considers raiding, in seconds. */
  RAID_INTERVAL: 20,
  /**
   * Once declared, a raid is committed for this long before the town will
   * reconsider - otherwise the party turns round every time the score shifts
   * and never arrives anywhere.
   */
  RAID_COMMIT: 45,
  /**
   * A raid gives up after this long regardless. Without an end condition a
   * party that breaches a wall it cannot exploit simply camps in the streets
   * for the rest of the game.
   */
  RAID_DURATION: 150,
  /** A raid is called off if the party falls to this fraction of its strength. */
  RAID_BREAK: 0.35,
  /**
   * No raiding at all before this much game time. A fresh save that gets sacked
   * before it can raise a wall is not difficulty, it is a bad first minute.
   */
  RAID_GRACE: 240,
  /** How strongly a defender's garrison puts an attacker off. Higher = timid. */
  RAID_DEFENCE_WEIGHT: 6,

  /** Conquest is cruel; winning hearts is not. See ALIGNMENT below. */
  ALIGN_CONQUEST: -0.30,
  ALIGN_PEACEFUL: 0.26
};

/**
 * Opinion generalisation. Teaching the creature about one object type leaks a
 * fraction of that lesson to its relatives, so "rocks are not food" also says
 * something about boulders. Without this the creature reads as never learning
 * once there are more than a handful of object types.
 */
export const KINSHIP = {
  rock: 'stone', boulder: 'stone',
  tree: 'plant',
  villager: 'person',
  house: 'structure', farm: 'structure', storage: 'structure',
  workshop: 'structure', building: 'structure'
};
/** Fraction of a lesson that leaks to same-family types. */
export const KINSHIP_LEAK = 0.4;

/**
 * Minimal event bus. Systems emit facts about the world; other systems
 * subscribe. This replaces props.js and hand.js reaching directly into
 * creature.witness(), which was the one place the "systems only touch state"
 * rule had broken down - and alignment needs exactly the same feed, so the
 * indirection now pays for itself twice.
 */
/**
 * What each event must carry.
 *
 * The bus was a Map of string to callbacks and payloads were loose bags of
 * whatever the emitter felt like attaching. That is how the SAME bug happened
 * twice: `byPlayer` went missing from an emit, alignment defaulted to blaming
 * the player, and you were charged for a massacre a rival committed in your own
 * streets. Neither time did anything complain - the field was simply undefined.
 *
 * Listed here, a missing field is a console warning at the moment of the emit,
 * naming the event and the field, in development only. It costs one loop over
 * three strings and would have caught both bugs at the source.
 */
const EVENT_FIELDS = {
  /**
   * `by` is the FACTION RESPONSIBLE, added in Phase 20, or -1 for the world -
   * starvation, drowning, a rock falling on somebody. It is required rather
   * than optional so that "who did this" always has an answer: a creature asks
   * it to know whether it is watching its own rampage and learning from it.
   *
   * `byPlayer` stays alongside it rather than being derived at every listener,
   * because six of them guard on that exact word and all six are still right.
   */
  'villagers-killed': ['count', 'pos', 'cause', 'byPlayer', 'by'],
  'building-destroyed': ['building', 'pos', 'cause', 'byPlayer', 'by'],
  'town-captured': ['town', 'how', 'by', 'from', 'byPlayer'],
  'raid-declared': ['from', 'to', 'strength'],
  'building-upgraded': ['building', 'level'],
  'miracle-cast': ['def', 'pos'],
  'prop-thrown': ['type', 'pos'],
  'villagers-fed': ['pos'],
  'villager-born': ['pos'],
  // `by` separates 'player' from 'people': your own villagers build for
  // themselves since Phase 20's self-build, and a prayer for shelter that THEY
  // answered must not pay you belief for it - the same rule Phase 19 wrote down
  // when the rain stopped counting as the player's doing.
  'building-placed': ['building', 'def', 'pos', 'byPlayer', 'by'],

  // --- Phase 16 ------------------------------------------------------------
  // Facts the prayer system needs that no existing emitter was reporting.
  /** A villager who was in danger is out of it, and who to thank. */
  'villager-rescued': ['villager', 'pos', 'by'],
  /** A raid against a town is over, one way or another. */
  'raid-ended': ['town', 'why'],
  /** A harvestable prop was set down inside a town's reach. */
  'resource-offered': ['type', 'pos', 'town', 'by'],
  /** Prayers announce themselves; the creature and the HUD listen. */
  'prayer-raised': ['id', 'category', 'villagerId', 'town', 'urgency', 'pos'],
  /** ...and announce how they ended. miracles.js turns this into belief. */
  'prayer-resolved': ['id', 'category', 'status', 'town', 'urgency', 'by', 'age'],
  'achievement-earned': ['id', 'name', 'at'],

  // --- Phase 17 ------------------------------------------------------------
  /**
   * A soldier or a siege engine was raised, or lost.
   *
   * Both were silent: they set `alive = false` and spliced themselves out, so
   * `soldiersLost`, `soldiersTrained`, `enginesBuilt` and `enginesLost` were
   * declared in reckoning.js and never written once - and `efficiencyOf`, which
   * divides kills by losses to weight the Military score, was quietly dividing
   * by a number that was always zero.
   */
  /**
   * A villager finished a piece of work - a tree felled, a rock broken, a crop
   * cut. The thing they spend most of their lives doing, and the only part of a
   * villager's day that was never announced.
   */
  /** The sky turned over to a new weather. */
  'weather-changed': ['from', 'to', 'at'],

  'villager-worked': ['job', 'pos', 'town'],

  'unit-trained': ['town', 'kind', 'pos'],
  'unit-lost': ['town', 'kind', 'pos'],

  /** A team earned a one-time Legacy award. Announced, never re-awarded. */
  'score-milestone': ['team', 'key', 'points', 'category', 'label', 'at'],
  /** The match is scored and the result is frozen. Emitted exactly once. */
  'reckoning-final': ['at', 'kind', 'winner']
};


/**
 * ACHIEVEMENTS.
 *
 * Deliberately pure data. Every entry is "this counter reached this number",
 * and achievements.js owns the counters - so adding an achievement is a row in
 * this table and nothing else, and no other system in the game has to know the
 * feature exists.
 *
 * `stat` names a counter in achievements.js, `need` is the threshold, `group`
 * is only for how the menu lays them out. Some counters are PEAKS rather than
 * totals - the most food you have ever held at once, not the sum of all food
 * ever gathered - which is why "Full Larder" cannot be earned by trickling.
 */
export const ACHIEVEMENTS = [
  // --- beginnings ---------------------------------------------------------
  { id: 'first-stone', group: 'Beginnings', name: 'Foundation Stone',
    blurb: 'Lay your first building.', stat: 'built', need: 1 },
  { id: 'first-birth', group: 'Beginnings', name: 'New Life',
    blurb: 'A child is born in your town.', stat: 'births', need: 1 },
  { id: 'first-miracle', group: 'Beginnings', name: 'A Sign',
    blurb: 'Work your first miracle.', stat: 'miracles', need: 1 },
  { id: 'first-throw', group: 'Beginnings', name: 'Hands of God',
    blurb: 'Pick something up and throw it.', stat: 'throws', need: 1 },
  { id: 'first-blood', group: 'Beginnings', name: 'First Blood',
    blurb: 'Kill someone who is not yours.', stat: 'enemiesKilled', need: 1 },

  // --- the settlement -----------------------------------------------------
  { id: 'hamlet', group: 'The Settlement', name: 'Hamlet',
    blurb: 'Ten buildings standing at once.', stat: 'buildingsStanding', need: 10 },
  { id: 'village', group: 'The Settlement', name: 'Village',
    blurb: 'Twenty-five buildings standing at once.', stat: 'buildingsStanding', need: 25 },
  { id: 'township', group: 'The Settlement', name: 'Township',
    blurb: 'Fifty buildings standing at once.', stat: 'buildingsStanding', need: 50 },
  { id: 'metropolis', group: 'The Settlement', name: 'Metropolis',
    blurb: 'One hundred buildings standing at once.', stat: 'buildingsStanding', need: 100 },
  { id: 'full-larder', group: 'The Settlement', name: 'Full Larder',
    blurb: 'Hold 500 food at once.', stat: 'peakFood', need: 500 },
  { id: 'lumber-baron', group: 'The Settlement', name: 'Lumber Baron',
    blurb: 'Hold 800 wood at once.', stat: 'peakWood', need: 800 },
  { id: 'deep-veins', group: 'The Settlement', name: 'Deep Veins',
    blurb: 'Hold 400 ore at once.', stat: 'peakOre', need: 400 },
  { id: 'master-planner', group: 'The Settlement', name: 'Master Planner',
    blurb: 'One of every kind of building, standing at the same time.',
    stat: 'buildingKinds', need: Object.keys(BUILDINGS).length },

  // --- the people ---------------------------------------------------------
  { id: 'congregation', group: 'The People', name: 'Congregation',
    blurb: 'Twenty people follow you.', stat: 'peakPop', need: 20 },
  { id: 'multitude', group: 'The People', name: 'Multitude',
    blurb: 'Forty people follow you.', stat: 'peakPop', need: 40 },
  { id: 'teeming', group: 'The People', name: 'Teeming',
    blurb: 'Seventy-five people follow you.', stat: 'peakPop', need: 75 },
  { id: 'generations', group: 'The People', name: 'Generations',
    blurb: 'Fifty children born.', stat: 'births', need: 50 },
  { id: 'dynasty', group: 'The People', name: 'Dynasty',
    blurb: 'One hundred and fifty children born.', stat: 'births', need: 150 },
  { id: 'breadline', group: 'The People', name: 'Breadline',
    blurb: 'Feed your people twenty-five times.', stat: 'feeds', need: 25 },
  { id: 'provider', group: 'The People', name: 'Provider',
    blurb: 'Feed your people one hundred times.', stat: 'feeds', need: 100 },

  // --- faith --------------------------------------------------------------
  { id: 'faithful', group: 'Faith', name: 'Faithful',
    blurb: 'Earn 250 belief.', stat: 'beliefEarned', need: 250 },
  { id: 'devout', group: 'Faith', name: 'Devout',
    blurb: 'Earn 1,000 belief.', stat: 'beliefEarned', need: 1000 },
  { id: 'almighty', group: 'Faith', name: 'Almighty',
    blurb: 'Earn 3,000 belief.', stat: 'beliefEarned', need: 3000 },
  { id: 'miracle-worker', group: 'Faith', name: 'Miracle Worker',
    blurb: 'Work fifty miracles.', stat: 'miracles', need: 50 },
  { id: 'deluge', group: 'Faith', name: 'Deluge',
    blurb: 'Call water thirty times.', stat: 'miracle_water', need: 30 },
  { id: 'storm-caller', group: 'Faith', name: 'Storm Caller',
    blurb: 'Call lightning thirty times.', stat: 'miracle_lightning', need: 30 },
  { id: 'scorched-earth', group: 'Faith', name: 'Scorched Earth',
    blurb: 'Call fire thirty times.', stat: 'miracle_fireball', need: 30 },

  // --- the creature -------------------------------------------------------
  { id: 'it-learns', group: 'The Creature', name: 'It Learns',
    blurb: 'Your creature earns a trait of its own.', stat: 'creatureTraits', need: 1 },
  { id: 'well-raised', group: 'The Creature', name: 'Well Raised',
    blurb: 'Three earned traits.', stat: 'creatureTraits', need: 3 },
  { id: 'paragon', group: 'The Creature', name: 'Paragon',
    blurb: 'Six earned traits.', stat: 'creatureTraits', need: 6 },
  { id: 'schooled', group: 'The Creature', name: 'Schooled',
    blurb: 'Two hundred lessons learned.', stat: 'creatureLessons', need: 200 },
  { id: 'full-grown', group: 'The Creature', name: 'Full Grown',
    blurb: 'Raise your creature to its full size.', stat: 'creatureGrown', need: 1 },
  { id: 'man-eater', group: 'The Creature', name: 'Man-Eater',
    blurb: 'Your creature takes twenty-five lives.', stat: 'creatureKills', need: 25 },
  { id: 'beast-of-war', group: 'The Creature', name: 'Beast of War',
    blurb: 'Your creature takes one hundred lives.', stat: 'creatureKills', need: 100 },
  { id: 'shapeshifter', group: 'The Creature', name: 'Shapeshifter',
    blurb: 'Give your creature a second body.', stat: 'creatureBodies', need: 2 },
  { id: 'menagerie', group: 'The Creature', name: 'Menagerie',
    blurb: 'Wear four different bodies.', stat: 'creatureBodies', need: 4 },

  // --- war ----------------------------------------------------------------
  { id: 'reaper', group: 'War', name: 'Reaper',
    blurb: 'Fifty of their people dead by your hand.', stat: 'enemiesKilled', need: 50 },
  { id: 'harvest-of-souls', group: 'War', name: 'Harvest of Souls',
    blurb: 'One hundred and fifty of their people dead by your hand.',
    stat: 'enemiesKilled', need: 150 },
  { id: 'wrecker', group: 'War', name: 'Wrecker',
    blurb: 'Raze twenty-five of their buildings.', stat: 'razed', need: 25 },
  { id: 'ruin', group: 'War', name: 'Ruin',
    blurb: 'Raze seventy-five of their buildings.', stat: 'razed', need: 75 },
  { id: 'conqueror', group: 'War', name: 'Conqueror',
    blurb: 'Take a rival town for your own.', stat: 'townsTaken', need: 1 },
  { id: 'warlord', group: 'War', name: 'Warlord',
    blurb: 'Take two rival towns.', stat: 'townsTaken', need: 2 },
  { id: 'besieged', group: 'War', name: 'Besieged',
    blurb: 'Have a raid declared against you.', stat: 'raidsOnYou', need: 1 },
  { id: 'stonewall', group: 'War', name: 'Stonewall',
    blurb: 'Weather ten declared raids.', stat: 'raidsOnYou', need: 10 },

  // --- divinity -----------------------------------------------------------
  { id: 'airborne', group: 'Divinity', name: 'Airborne',
    blurb: 'Throw fifty things.', stat: 'throws', need: 50 },
  { id: 'catapult', group: 'Divinity', name: 'Catapult',
    blurb: 'Throw two hundred and fifty things.', stat: 'throws', need: 250 },
  { id: 'long-shot', group: 'Divinity', name: 'Long Shot',
    blurb: 'Hurl something at forty units a second or better.',
    stat: 'fastestThrow', need: 40 },
  { id: 'apostle', group: 'Divinity', name: 'Apostle',
    blurb: 'Throw ten of your own believers.', stat: 'believersThrown', need: 10 },
  { id: 'saint', group: 'Divinity', name: 'Saint',
    blurb: 'Be known as wholly good.', stat: 'peakGood', need: 90 },
  { id: 'tyrant', group: 'Divinity', name: 'Tyrant',
    blurb: 'Be known as wholly cruel.', stat: 'peakEvil', need: 90 }
];

/**
 * How a game ends. Checked once a second rather than every tick - it walks
 * every town, and nothing here can change between one frame and the next in a
 * way a player could notice.
 */
export const ENDING = {
  CHECK_INTERVAL: 1.0,
  /** Below this population, with no food and no way back, you are finished. */
  EXTINCTION_POP: 0
};

/**
 * Declare the game over. Idempotent: the first ending wins, so a town falling
 * on the same tick that the last rival is captured cannot produce two endings
 * or overwrite the one already shown.
 */
export function endGame(state, kind, reason) {
  if (state.outcome) return false;
  state.outcome = { kind, reason, at: state.time };
  state.events?.emit('game-over', { kind, reason, at: state.time });
  state.debug.lastLog = `game over: ${kind} - ${reason}`;
  return true;
}

/**
 * Apply a civilisation count. Called once, at boot, before the island exists.
 *
 * FOUR NUMBERS MOVE TOGETHER and they must not drift apart:
 *
 *   TOWN.RIVALS           how many towns are founded
 *   ISLANDS.SITES_NEEDED  how many the island is vetted for
 *   TOWN.TOWN_SPACING     how far apart town.js will place them
 *   ISLANDS.SITE_SPACING  how far apart the check believes they need to be
 *   VILLAGER.MAX          how many people the island can hold in total
 *
 * Letting any one of them lag is the Phase 12 regression exactly: an island
 * vetted for three towns that then has to host five does not fail loudly, it
 * silently hands the player fewer rivals than they asked for. They are set in
 * one place, from one number, so that cannot happen.
 */
export function setCivilisations(n) {
  const count = Math.max(CIVS.MIN, Math.min(CIVS.MAX, Math.round(n) || CIVS.DEFAULT));
  const spacing = CIVS.SPACING[count] ?? CIVS.SPACING[CIVS.DEFAULT];
  TOWN.RIVALS = count - 1;
  TOWN.TOWN_SPACING = spacing;
  ISLANDS.SITES_NEEDED = count;
  ISLANDS.SITE_SPACING = spacing;
  // ...and how many people the island can hold. A FIFTH number moved by the one
  // the player chose, and it belongs here for the reason the other four do: the
  // cap is island-wide, so leaving it fixed means every extra civilisation
  // makes all of them smaller.
  const pop = Math.max(CIVS.POP_FLOOR,
    Math.min(CIVS.POP_CEILING, CIVS.POP_PER_CIV * count));
  VILLAGER.MAX = pop;
  // Returned AND recorded, because a dynamic `import()` from the page gives a
  // separate module instance from the running app's graph - so reading
  // `TOWN.TOWN_SPACING` in a console test reports the untouched default and
  // quietly says the setting never applied. Anything verifying this has to
  // read it back off the live state, so put it there.
  return { count, spacing, sitesNeeded: count, villagerCap: pop };
}

export function createEvents() {
  const listeners = new Map();
  const DEV = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.DEV : false;
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      return () => {
        const l = listeners.get(type);
        const i = l.indexOf(fn);
        if (i >= 0) l.splice(i, 1);
      };
    },
    emit(type, payload) {
      if (DEV) {
        const want = EVENT_FIELDS[type];
        if (want) {
          for (const k of want) {
            if (payload == null || payload[k] === undefined) {
              console.warn(`event "${type}" is missing "${k}"`, payload);
            }
          }
        }
      }
      const l = listeners.get(type);
      if (!l) return;
      // Iterate a copy: a handler may unsubscribe itself mid-dispatch.
      for (const fn of l.slice()) fn(payload);
    }
  };
}

/** Freshly-created game state. Systems attach their APIs to this object. */
export function createState() {
  return {
    // --- clock ---
    time: 0, // seconds of simulated time
    tick: 0, // fixed-step counter
    /** Interpolation factor [0,1) between the last two sim ticks, for rendering. */
    alpha: 0,
    paused: false,

    /** Shared event bus; see createEvents(). main.js installs it. */
    events: null,

    /** Loaded model kit (see lib/models.js). Available before any system init. */
    models: null,

    // --- systems publish themselves here ---
    scene: null,
    renderer: null,
    input: null,
    terrain: null,
    camera: null,
    hand: null,
    props: null,
    fx: null,
    ui: null,

    // --- phase 2+ placeholders, present so the shape of the game is visible ---
    town: null,
    villagers: null,
    /** THE PLAYER'S creature. Also the first entry in `creatures`. */
    creature: null,
    /**
     * EVERY creature on the island, the player's first (Phase 20).
     *
     * Kept as a separate list rather than making `creature` an array, because
     * roughly thirty call sites across the UI, the hand, the miracles and the
     * achievements mean "the one the player is petting" when they say
     * `state.creature`, and every one of them is still right.
     */
    creatures: [],
    /** One per civilisation. See town.js. */
    factions: null,
    miracles: null,
    combat: null,
    /** The rival gods. See rivalgods.js. */
    rivalGods: null,

    /**
     * The seed for THIS game. Every system that scatters anything derives its
     * own stream from this, so one number reproduces an entire world.
     * Resolved in main.js from ?seed=, or rolled fresh.
     */
    seed: WORLD.SEED,
    /** Optional ?island= override, for looking at one archetype on purpose. */
    islandName: null,
    /** Filled in by initTerrain: { seed, name, lobes, attempts, fallback }. */
    island: null,

    resources: { food: 0, wood: 0, ore: 0, belief: 0 },
    /**
     * How the game ended, or null while it is still going.
     * { kind: 'victory'|'defeat', reason, at } - `at` is game seconds.
     */
    outcome: null,
    /**
     * True once the player has chosen "Continue Playing" at the Reckoning.
     *
     * The world starts turning again, but `outcome` deliberately STAYS set:
     * it is what stops a second competitive ending, since endGame() refuses to
     * fire while it is there. The frozen final scores are unaffected either
     * way - nothing after the bell can reach them.
     */
    postGame: false,
    alignment: 0, // -1 evil .. +1 good

    // --- debug / readout ---
    debug: {
      fps: 0,
      simSteps: 0,
      awakeProps: 0,
      lastLog: ''
    }
  };
}
