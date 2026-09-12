// ---------------------------------------------------------------------------
// achievements.js - the record of what you have done.
//
// Every achievement in the game is "a counter reached a number". This system
// owns the counters; state.js owns the table of thresholds. That split is the
// whole design, and it is what keeps the feature from leaking into everything
// else: NOT ONE other system knows achievements exist. Nothing calls in here.
//
// Counters come from two places:
//
//   * The EVENT BUS, for things that happen at a moment - a birth, a throw, a
//     town taken. These are exact: every occurrence is counted once.
//   * POLLING state, for things that are a level rather than an event - how
//     many people you have, how much food, how big the creature has grown.
//     These are sampled, and several are PEAKS: the most you ever held, kept
//     even after you spend it.
//
// Polling is deliberate rather than lazy. Adding an emit to villagers.js every
// time the population changed would put an achievement concern inside a system
// that has no business carrying one, and the sample rate a progress bar needs
// is nowhere near 20Hz.
//
// Earned achievements persist in localStorage, because an achievement that
// vanishes when you refresh the page is not an achievement.
//
// Publishes state.achievements.
// ---------------------------------------------------------------------------
import { ACHIEVEMENTS, CREATURE } from './state.js';

/** Bumped if the table ever changes meaning; old saves are then ignored. */
const STORE_KEY = 'divinity.achievements.v1';

/** Seconds between polls. A progress bar does not need the sim rate. */
const POLL_INTERVAL = 0.5;

export function initAchievements(state) {
  /**
   * Every counter the table can name. Declared up front rather than created on
   * demand so a typo in a `stat` shows up as a bar that never moves, not as a
   * silent `undefined >= need` that is false forever.
   */
  const stats = {
    // event-driven totals
    built: 0,
    births: 0,
    feeds: 0,
    miracles: 0,
    miracle_water: 0,
    miracle_food: 0,
    miracle_fireball: 0,
    miracle_lightning: 0,
    throws: 0,
    fastestThrow: 0,
    enemiesKilled: 0,
    razed: 0,
    townsTaken: 0,
    raidsOnYou: 0,
    /** Towns that came over WITHOUT a fight. See town.capture's `how`. */
    townsAwed: 0,
    // polled levels and peaks
    buildingsStanding: 0,
    buildingKinds: 0,
    peakPop: 0,
    peakFood: 0,
    peakWood: 0,
    peakOre: 0,
    beliefEarned: 0,
    peakGood: 0,
    peakEvil: 0,
    creatureTraits: 0,
    creatureLessons: 0,
    creatureKills: 0,
    creatureBodies: 0,
    creatureGrown: 0,
    believersThrown: 0,
    shrinesStanding: 0,
    /**
     * The highest awe you have ever held over a rival town, 0..100.
     *
     * Stored as a percentage for the same reason as peakGood: the underlying
     * meter is 0..1 and a progress bar that only moves in its last hundredth
     * tells the player nothing.
     */
    peakAwe: 0
  };

  // --- what has already been earned, across every session ------------------
  /** id -> ISO timestamp it was first earned. */
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    // A corrupt or unavailable store must never stop the game booting. Losing
    // the record is a disappointment; failing to start is a bug.
    store = {};
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch { /* private browsing, quota, no storage at all - play on */ }
  }

  /** Earned during THIS game, which is what gets a toast and a highlight. */
  const freshlyEarned = new Set();

  function unlock(def) {
    if (store[def.id]) return;
    store[def.id] = new Date().toISOString();
    freshlyEarned.add(def.id);
    persist();
    // A card of its own rather than a toast. A toast is for "not enough wood";
    // earning something should not look like being told off.
    state.ui?.announceAchievement(def);
    state.events?.emit('achievement-earned', {
      id: def.id, name: def.name, at: state.time
    });
    state.debug.lastLog = `achievement: ${def.name}`;
  }

  function check() {
    for (const def of ACHIEVEMENTS) {
      if (store[def.id]) continue;
      if ((stats[def.stat] ?? 0) >= def.need) unlock(def);
    }
  }

  // --- event counters ------------------------------------------------------
  //
  // `byPlayer` is what separates "you did this" from "it happened". A rival
  // razing another rival's barracks is not your Wrecker medal.
  const ev = state.events;
  // YOUR children only. The event fires for every town on the island now, so
  // that an AI can earn the same birth milestone you can - without this filter
  // your New Life medal would be handed out for a rival's baby.
  ev.on('villager-born', (e) => {
    if (state.town?.townAt?.(e?.pos?.x, e?.pos?.z)?.isPlayer) stats.births++;
  });
  ev.on('villagers-fed', () => { stats.feeds++; });

  ev.on('miracle-cast', (e) => {
    stats.miracles++;
    const key = e?.def?.key;
    if (key && `miracle_${key}` in stats) stats[`miracle_${key}`]++;
  });

  ev.on('prop-thrown', (e) => {
    stats.throws++;
    if (e?.speed > stats.fastestThrow) stats.fastestThrow = e.speed;
  });

  ev.on('villagers-killed', (e) => {
    if (!e?.byPlayer) return;
    // `count` because one lightning bolt can take several at once.
    stats.enemiesKilled += e.count ?? 1;
  });

  ev.on('building-destroyed', (e) => {
    if (e?.byPlayer) stats.razed++;
  });

  // A true lifetime total now there is an event for it. It used to be derived
  // from the standing count, which quietly meant "the most you ever had up at
  // once" - close enough for a first-building achievement, wrong in general.
  ev.on('building-placed', (e) => { if (e?.byPlayer) stats.built++; });

  ev.on('town-captured', (e) => {
    stats.townsTaken++;
    // Only the player's bloodless conversions. `by` is the faction that won it,
    // and a rival awing a town away from another rival is not your achievement.
    if (e?.how === 'awe' && e.by === 0) stats.townsAwed++;
  });

  ev.on('raid-declared', (e) => {
    if (e?.to?.isPlayer) stats.raidsOnYou++;
  });

  // --- polled counters -----------------------------------------------------

  /**
   * Villagers thrown, counted on the rising edge of `flying`.
   *
   * There is no event for this: hand.js throws props, and a person is not a
   * prop. Watching the flag means one count per throw rather than one per tick
   * spent in the air, and the id set is cleared as they land so the same
   * believer can be thrown again - which, being honest about the audience, is
   * exactly what will happen.
   */
  const inFlight = new Set();

  let pollTimer = 0;
  let lastBelief = 0;
  const bodiesWorn = new Set();

  function poll() {
    const res = state.resources;
    if (res) {
      if (res.food > stats.peakFood) stats.peakFood = res.food;
      if (res.wood > stats.peakWood) stats.peakWood = res.wood;
      if (res.ore > stats.peakOre) stats.peakOre = res.ore;
      // Belief is SPENT on miracles, so the running total is not a measure of
      // how much you have ever been given. Only the rises are counted.
      if (res.belief > lastBelief) stats.beliefEarned += res.belief - lastBelief;
      lastBelief = res.belief;
    }

    const align = state.alignment ?? 0;
    // Stored 0..100 so the progress bar has something to show; the underlying
    // value is -1..+1 and a bar that only moves in the last tenth is useless.
    stats.peakGood = Math.max(stats.peakGood, Math.round(Math.max(0, align) * 100));
    stats.peakEvil = Math.max(stats.peakEvil, Math.round(Math.max(0, -align) * 100));

    // `isPlayer` is the only test needed: town.capture sets it on a town you
    // take, so a conquered settlement's houses count as yours from that moment
    // without this having to know anything about conquest.
    // The most anyone has ever been impressed by you, and how many shrines are
    // doing the impressing. Polled rather than evented because both are levels:
    // awe rises and falls continuously, and a shrine can be destroyed.
    let shrines = 0;
    for (const t of state.town?.towns || []) {
      if (!t.isPlayer) {
        stats.peakAwe = Math.max(stats.peakAwe, Math.round((t.impressedBy?.[0] ?? 0) * 100));
      }
    }
    for (const b of state.town?.allBuildings || []) {
      if (b.def?.shrine && b.town?.isPlayer) shrines++;
    }
    stats.shrinesStanding = shrines;

    let standing = 0;
    const kinds = new Set();
    for (const b of state.town?.allBuildings || []) {
      if (!b.town?.isPlayer) continue;
      standing++;
      kinds.add(b.def.key);
    }
    stats.buildingsStanding = standing;
    stats.buildingKinds = kinds.size;

    let pop = 0;
    for (const v of state.villagers?.list || []) {
      if (v.alive && v.town?.isPlayer) pop++;
      // Bookkeeping runs for the dead too: someone who does not survive the
      // landing would otherwise sit in this set forever, and their id would
      // stop a later villager from ever being counted if ids were ever reused.
      if (v.alive && v.flying && v.thrownFrom) {
        if (!inFlight.has(v.id)) { inFlight.add(v.id); stats.believersThrown++; }
      } else {
        inFlight.delete(v.id);
      }
    }
    if (pop > stats.peakPop) stats.peakPop = pop;

    const beast = state.creature;
    if (beast) {
      stats.creatureTraits = beast.earned?.length ?? 0;
      stats.creatureLessons = beast.lessons ?? 0;
      stats.creatureKills = beast.deeds?.kills ?? 0;
      if (beast.animal?.key) bodiesWorn.add(beast.animal.key);
      stats.creatureBodies = bodiesWorn.size;
      // Within a whisker of maximum: growth is driven by age and meals through
      // a clamped ratio, and waiting on exact equality with a float is asking
      // for an achievement that never fires.
      if (beast.scale >= CREATURE.MAX_SCALE * 0.99) stats.creatureGrown = 1;
    }
  }

  function simStep(dt) {
    pollTimer -= dt;
    if (pollTimer > 0) return;
    pollTimer = POLL_INTERVAL;
    poll();
    check();
  }

  const api = {
    /** Every achievement, with its state - what the menu renders from. */
    get list() {
      return ACHIEVEMENTS.map((def) => {
        const have = stats[def.stat] ?? 0;
        return {
          ...def,
          earned: !!store[def.id],
          earnedAt: store[def.id] ?? null,
          fresh: freshlyEarned.has(def.id),
          have: Math.min(have, def.need),
          progress: Math.max(0, Math.min(1, have / def.need))
        };
      });
    },
    get total() { return ACHIEVEMENTS.length; },
    get earnedCount() { return ACHIEVEMENTS.filter((d) => store[d.id]).length; },
    /** Read-only view of the counters, for the debug panel. */
    get stats() { return { ...stats }; },
    /** Wipe the record. Nothing calls this; it is here for the console. */
    reset() {
      store = {};
      freshlyEarned.clear();
      persist();
    },
    simStep
  };

  state.achievements = api;
  return api;
}
