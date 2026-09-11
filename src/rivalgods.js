// ---------------------------------------------------------------------------
// rivalgods.js - the other gods, and the hands they raise their creatures with.
//
// For nineteen phases this game had one participant. The rivals had towns,
// farms, armies and a war council; what they did not have was the thing the
// whole game is about. There was one creature on the island, it belonged to the
// player, and combat.js said so in as many words - "the creature is the
// player's, so only a rival's men will come at it".
//
// A RIVAL GOD IS NOT A SECOND PLAYER, and that is deliberate. It cannot sculpt
// the land, it casts no miracles, and it has no hand to pick a villager up
// with. What it has is a creature and the three levers that raise one:
//
//   THE LEASH      it picks a stance from its situation, the same four modes
//   THE SUMMONS    it sends the creature where it wants it, same call
//   THE HAND       it praises and punishes, through `creature.reinforce` -
//                  the identical path a stroke and a slap take
//
// There is no fourth lever and no cheating one. A rival's beast learns on the
// same decaying curve, forgets nothing faster, fights at the same numbers and
// can be driven off the field the same way. That is the point: it can be beaten
// for the same reasons it can be raised.
//
// LIKE EVERY SYSTEM HERE IT IMPORTS NO OTHER SYSTEM. It reads the world through
// `state` and acts only through the creature's own public API.
//
// Publishes state.rivalGods.
// ---------------------------------------------------------------------------
import { mulberry32 } from './lib/noise.js';
import { RIVAL_GOD, TOWN } from './state.js';

/**
 * THE STANCES. A god's whole personality is which of these it is in and what it
 * makes of what the creature did while it was there.
 *
 * `praise` and `scold` are desires, and they are fed straight to
 * `reinforce(+1)` / `reinforce(-1)` - the same one-lesson-per-deed rule the
 * player's hand obeys, including the decay that makes the first lessons stick
 * hardest.
 *
 * NOTHING SCOLDS `eat`, `sleep` OR `groom`, and that is not a style choice.
 * state.js records what happens when it does: "the creature stopped eating
 * anything at all and starved". Those three are how it stays alive, they are
 * driven by needs rather than by opinion, and a god that punishes them kills
 * its own creature by degrees over about four minutes. The guard below is
 * asserted rather than trusted to this comment.
 */
const STANCES = {
  /** Someone is in our streets, or we are in theirs. */
  war: { leash: 'aggression', praise: ['attack'], scold: [] },
  /** The granary is emptying. Fetch, and stop playing. */
  hunger: { leash: 'compassion', praise: ['help'], scold: ['play'] },
  /** At peace and well fed: go and be a wonder at somebody's gate. */
  awe: { leash: 'compassion', praise: ['impress', 'help'], scold: ['attack'] },
  /** Nothing pressing. Let it be an animal and see what it becomes. */
  idle: { leash: 'learning', praise: ['help', 'play'], scold: [] }
};

/**
 * WHAT KIND OF GOD EACH ONE IS. See RIVAL_GOD.DISPOSITIONS.
 *
 * `warOn` is the only difference, and it is the whole difference: a conqueror
 * treats its army being out as a war worth attending, a missionary only counts
 * men in its own streets.
 */
const DISPOSITIONS = {
  conqueror: { warOn: (s, f) => !!s.combat?.frontFor?.(f) },
  missionary: { warOn: (s, f) => !!s.combat?.homeThreatFor?.(f) }
};

/** Desires a god may never punish. See the note above STANCES. */
const NEVER_SCOLD = ['eat', 'sleep', 'groom'];
for (const [name, s] of Object.entries(STANCES)) {
  for (const d of s.scold) {
    if (NEVER_SCOLD.includes(d)) {
      throw new Error(`[rivalgods] stance "${name}" scolds "${d}", which starves the creature`);
    }
  }
}

export function initRivalGods(state) {
  const gods = [];

  /**
   * One god per faction that is not the player's.
   *
   * Built from `state.creatures` rather than from the faction list, so a god
   * exists only where a creature actually landed - a body that failed to load
   * would otherwise leave a god thinking about an animal that is not there.
   */
  for (const creature of state.creatures) {
    if (creature.isHuman) continue;
    gods.push({
      faction: creature.faction,
      creature,
      /** Staggered, or every god in the game thinks on the same tick. */
      timer: RIVAL_GOD.GRACE + creature.faction * (RIVAL_GOD.THINK_INTERVAL / 3),
      stance: 'idle',
      /** Dealt round-robin, so a five-civ island gets a mix. */
      disposition: RIVAL_GOD.DISPOSITIONS[
        (creature.faction - 1) % RIVAL_GOD.DISPOSITIONS.length],
      /** Hysteresis on the food test. See RIVAL_GOD.NEED_FOOD_DAYS. */
      wantsFood: false,
      /** Where it currently has the creature posted, for the debug panel. */
      posting: 'home',
      lessons: 0,
      rand: mulberry32((state.seed ^ 0x60d5 ^ (creature.faction * 0x2545f49)) >>> 0)
    });
  }

  // --- what a god can see --------------------------------------------------

  /** Every town this god holds. */
  function myTowns(g) {
    return state.towns.filter((t) => t.owner === g.faction);
  }

  /**
   * Food per head across everything it holds, or Infinity if it holds nothing.
   *
   * Per head rather than absolute: a hundred food is a famine for eighty people
   * and a fortune for six, and a god that reads the raw number sends its
   * creature fetching timber while its villagers starve.
   */
  function foodPerHead(g) {
    const mine = myTowns(g);
    if (!mine.length) return Infinity;
    let pop = 0;
    for (const t of mine) pop += state.town.populationOf(t);
    if (pop <= 0) return Infinity;
    // Every town of a faction shares one pool, so this is read once.
    return (mine[0].resources.food ?? 0) / pop;
  }

  /** Is this god's kind of war happening? See DISPOSITIONS. */
  function atWar(g) {
    return DISPOSITIONS[g.disposition].warOn(state, g.faction);
  }

  /**
   * The nearest town this god does not own, and could plausibly go and dazzle.
   *
   * Nearest rather than weakest on purpose: a creature sent across the island
   * spends the whole match walking, and a god whose beast is never home is a
   * god who loses its towns while being impressive somewhere else.
   */
  function nearestForeignTown(g) {
    const from = state.town.capitalOf(g.faction);
    if (!from) return null;
    let best = null;
    let bestD = Infinity;
    for (const t of state.towns) {
      if (t.owner === g.faction) continue;
      const d = Math.hypot(t.centre.x - from.centre.x, t.centre.z - from.centre.z);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  // --- deciding ------------------------------------------------------------

  /**
   * Which stance this god is in.
   *
   * Ordered by what cannot wait. War first because a creature dancing at a
   * neighbour's gate while its own castle is being breached reads as broken,
   * then food, and only a god with nothing to worry about goes courting.
   */
  function chooseStance(g) {
    if (atWar(g)) return 'war';

    // Hysteresis, not a threshold. A town hovering at the food line flips
    // stance every four seconds otherwise, and its creature learns nothing at
    // all because every lesson contradicts the one before it.
    const food = foodPerHead(g);
    if (g.wantsFood) {
      if (food > RIVAL_GOD.NEED_FOOD_CLEAR) g.wantsFood = false;
    } else if (food < RIVAL_GOD.NEED_FOOD_DAYS) {
      g.wantsFood = true;
    }
    if (g.wantsFood) return 'hunger';

    // Courting is the awe route, and it is only worth setting out on while
    // there is somebody left to court - and not before COURT_AFTER, so the
    // island's quiet opening stays quiet.
    if (state.time < RIVAL_GOD.COURT_AFTER) return 'idle';
    return nearestForeignTown(g) ? 'awe' : 'idle';
  }

  /** Post the creature where the stance wants it - or take the hand off. */
  function post(g, stance) {
    const c = g.creature;

    if (stance === 'war') {
      // REACH DOWN, same as the player does with V.
      //
      // Only in a war, and only while the creature is actually in the fight -
      // a rival god casting on the walk out would burn its long cooldown on an
      // empty field and arrive with nothing. It pays no belief because it has
      // none; BLESSING.RIVAL_COOLDOWN is what it pays instead.
      if (c.fighting && c.blessCooldown <= 0 && c.blessMult === 1) c.bless();

      const front = state.combat?.frontFor?.(g.faction);
      if (front) {
        c.summon(front.x, front.z, RIVAL_GOD.FRONT_RADIUS);
        g.posting = 'front';
        return;
      }
    }

    if (stance === 'awe') {
      const target = nearestForeignTown(g);
      if (target) {
        // IN THEIR STREETS, which is where the audience is.
        //
        // I tried this two ways and the first was wrong twice over. It summoned
        // to `target.centre` - inside the keep, which is solid - and then, to
        // fix the siege it caused, out past COMBAT.SIEGE_RANGE + FRONT_RADIUS,
        // which is 64 units from a town whose whole built-up area is a ring
        // 16 to 40 units wide. A two-minute probe at that standoff logged the
        // creature choosing between trees: `help the tree`, `play the tree`,
        // over and over. There were no houses and no people in reach, so there
        // was nothing to be impressive AT, and the awe meter never moved.
        //
        // The siege was the wrong thing to solve with distance. It is solved in
        // combat.js instead - only a creature at WAR counts as a besieger - so
        // this can stand where the buildings actually are: clear of the keep,
        // well inside the town, on the side its own god's land is on.
        const home = state.town.capitalOf(g.faction);
        const bx = (home?.centre.x ?? target.centre.x) - target.centre.x;
        const bz = (home?.centre.z ?? target.centre.z) - target.centre.z;
        const d = Math.hypot(bx, bz) || 1;
        const stand = Math.max(
          TOWN.CENTRE_CLEARANCE + 8,
          target.influenceRadius * RIVAL_GOD.COURT_STANDOFF
        );
        c.summon(
          target.centre.x + (bx / d) * stand,
          target.centre.z + (bz / d) * stand,
          RIVAL_GOD.FRONT_RADIUS
        );
        g.posting = 'courting ' + target.name;
        return;
      }
    }

    const home = state.town.capitalOf(g.faction);
    if (!home) { c.dismiss(); g.posting = 'homeless'; return; }

    // A GOD WITH NOTHING PRESSING TAKES ITS HAND OFF.
    //
    // A creature pinned inside a summons circle for the whole match never
    // wanders into a lesson, and the utility AI - the part of this that is
    // actually interesting to watch - only runs on what it can reach. So an
    // idle god lets it roam a fraction of the time.
    if (stance === 'idle' && g.rand() < RIVAL_GOD.IDLE_ROAM) {
      c.dismiss();
      g.posting = 'roaming';
      return;
    }
    c.summon(home.centre.x, home.centre.z, RIVAL_GOD.HOME_RADIUS);
    g.posting = 'home';
  }

  /**
   * The hand. Praise or punish the last thing it did, sometimes.
   *
   * SOMETIMES IS THE WHOLE DESIGN. A god that judges every single deed drives
   * the learning-rate decay into the floor inside two minutes, and its creature
   * is then frozen as whatever it happened to be at minute two - it cannot be
   * taught anything for the rest of the match, by its own god or by the world.
   * The player teaches in bursts with long stretches of nothing between, and
   * that shape is what makes the arc work, so the gods teach in bursts too.
   */
  function judge(g, stance) {
    const c = g.creature;
    const last = c.lastAction;
    if (!last) return;
    if (c.lastActionAge > RIVAL_GOD.JUDGE_WINDOW) return;
    if (g.rand() > RIVAL_GOD.JUDGE_CHANCE) return;

    const s = STANCES[stance];
    if (s.praise.includes(last.desire)) {
      c.reinforce(+1);
      g.lessons++;
    } else if (s.scold.includes(last.desire)) {
      c.reinforce(-1);
      g.lessons++;
    }
  }

  // --- simulation ----------------------------------------------------------

  function simStep(dt) {
    // Nothing after the bell. The match is decided and a god still shuffling
    // its creature around would keep moving numbers the reckoning has frozen.
    if (state.outcome && !state.postGame) return;

    for (const g of gods) {
      // A god with no land still has a creature, and it still thinks - it has
      // simply lost the argument. Its beast roams, which is what `post` does
      // with a homeless one.
      g.timer -= dt;
      if (g.timer > 0) continue;
      g.timer = RIVAL_GOD.THINK_INTERVAL;

      const stance = chooseStance(g);
      // Judged against the stance it was in WHEN THE DEED HAPPENED, not the one
      // it is moving into. A god that changes its mind and then punishes the
      // creature for having obeyed the old order is teaching noise.
      judge(g, g.stance);
      g.stance = stance;

      g.creature.setLeash(STANCES[stance].leash);
      post(g, stance);
    }
  }

  const api = {
    enabled: true,
    gods,
    /** One line per god, for the debug panel. */
    describe() {
      return gods.map((g) => ({
        name: state.factions[g.faction]?.name ?? 'god ' + g.faction,
        animal: g.creature.animal,
        disposition: g.disposition,
        stance: g.stance,
        posting: g.posting,
        lessons: g.lessons,
        leash: g.creature.leash,
        health: Math.round(g.creature.health),
        towns: myTowns(g).length
      }));
    },
    simStep
  };
  state.rivalGods = api;
  return api;
}
