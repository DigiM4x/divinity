// ---------------------------------------------------------------------------
// prayers.js - what the people ask of you.
//
// Belief has been a tap that runs on its own since Phase 4: a happy population
// trickles faith whether you ever do anything for them or not. A prayer turns
// that into a conversation. A villager in real trouble asks for a specific
// thing; you answer it or you do not; both are recorded.
//
// THIS MODULE ONLY OBSERVES AND ANNOUNCES. It commands nothing: it never casts
// a miracle, moves a villager, changes a resource, or touches belief. It reads
// the world to find conditions worth praying about, listens to the event bus
// for facts that might answer them, and emits two facts of its own:
//
//   prayer-raised     someone is asking for something
//   prayer-resolved   it ended, and here is how
//
// miracles.js turns the second into belief and alignment, because belief is
// miracles.js's to own. Nothing here touches another system's numbers.
//
// It does make two READ-ONLY queries through `state`, the way every system in
// this project reads the world: `town.growthBlockerOf` and `town.townAt`. Both
// are pure functions of town state and neither changes anything. They are used
// rather than reimplemented deliberately - `townAt` in particular decides which
// town a feeding happened in, and getting that subtly wrong is exactly how you
// end up answering one village's prayer by feeding another.
//
// LIFECYCLE IS THE WHOLE RISK. This project's recurring bug is a list that only
// grows - Phase 8 was almost entirely that, and Phase 13 hit it again. So there
// are three independent ceilings (per villager, per town, global), a bounded
// history, and every path out of `active` is a splice.
//
// Publishes state.prayers.
// ---------------------------------------------------------------------------
import { PRAYER, TOWN } from './state.js';
import { mulberry32 } from './lib/noise.js';

/**
 * What each category is, in one place.
 *
 * `text` builds the sentence a player reads. `want` is the one-line statement
 * of what would answer it. Kept as data so adding a category is a table entry
 * and a condition, not a new branch in five functions.
 */
const CATEGORIES = {
  food: {
    label: 'Hunger',
    want: 'Food, for them or their town',
    text: (p) => p.communal
      ? `${p.townName}: our stores are nearly empty.`
      : `${p.who} is starving. Please, anything to eat.`
  },
  rescue: {
    label: 'Peril',
    want: 'Carry them clear, or drive off what threatens them',
    text: (p) => `Save ${p.who} before it is too late.`
  },
  safety: {
    label: 'Raid',
    want: 'End the raid on their town',
    text: (p) => `${p.townName}: protect us. They are coming.`
  },
  /**
   * THE CATEGORY PHASE 16 REFUSED.
   *
   * That phase was explicit: "Weather is deliberately absent. There is no
   * weather, season or crop-failure state in this game, and the brief was
   * explicit about not inventing one to hang a category on."
   *
   * That was right then. Phase 19 built a real drought that really slows real
   * crops, so the condition now exists and the category is honest. Nothing was
   * invented to justify it - the prayer was waiting for the mechanic.
   */
  weather: {
    label: 'Drought',
    want: 'Rain, or food enough to outlast it',
    text: (p) => `${p.townName}: the fields are dying. Send us rain.`
  },
  supply: {
    label: 'Shortage',
    want: (p) => `${p.resource === 'wood' ? 'Timber' : 'Stone'} within their reach`,
    text: (p) => `${p.townName}: we need ${p.resource} to keep building.`
  },

  // --- five more, added after the first real game ---------------------------
  //
  // The complaint was that every prayer was about starving, and it was fair:
  // of the five above, `food` is the one that fires constantly and `weather`
  // is also about food. So these five deliberately ask for FIVE DIFFERENT
  // ACTIONS. Five prayers all answered by the food miracle would be one prayer
  // wearing five hats.
  //
  //   rebuild  put back what a raid pulled down
  //   ground   LEVEL THE LAND - the sculpting tool, which nothing has ever asked for
  //   wonder   cast anything at all, where they can see it
  //   beast    drive off another god's creature
  //   thirst   the Water miracle, which until now had no reason to exist
  //
  // And every condition below is read from state that was already there. The
  // rule this file has kept since Phase 16 is that the mechanic comes first.

  rebuild: {
    label: 'Ruins',
    want: (p) => `Raise them another ${p.razedLabel.toLowerCase()}`,
    text: (p) => `${p.townName}: they pulled down our ${p.razedLabel.toLowerCase()}. Raise it again.`
  },
  ground: {
    label: 'Barren Ground',
    want: 'Level the land, so something can be built on it',
    text: (p) => `${p.townName}: the ground here will take nothing we build.`
  },
  wonder: {
    label: 'Faith',
    want: 'Work a wonder where they can see it',
    text: (p) => `${p.townName}: it has been a long age since we saw your hand.`
  },
  beast: {
    label: 'The Beast',
    want: 'Drive it off, or call it away',
    text: (p) => `${p.townName}: ${p.beastOwner}'s beast is in our fields.`
  },
  thirst: {
    label: 'Parched Fields',
    want: 'Water, over the fields themselves',
    text: (p) => `${p.townName}: our fields are cut to the root. Send water.`
  }
};

/**
 * EVERY CATEGORY NEEDS THREE THINGS, and forgetting one is silent.
 *
 * A missing `LIFETIME` makes `expires` NaN, and `t >= NaN` is false forever -
 * so the prayer never expires, never leaves `active`, and permanently occupies
 * one of the twelve slots. That is this project's oldest failure mode (a list
 * that only grows) arriving through a typo.
 *
 * A missing `byCategory` counter turns every count into `undefined + 1` and
 * the statistic is NaN for the rest of the session - which is exactly what
 * adding `weather` in Phase 19 nearly did, and what adding five at once could
 * have done five times over.
 *
 * Checked once, at boot, loudly.
 */
function assertCategoriesComplete(counters) {
  const missing = [];
  for (const key of Object.keys(CATEGORIES)) {
    if (typeof PRAYER.LIFETIME[key] !== 'number') missing.push(`PRAYER.LIFETIME.${key}`);
    if (typeof counters[key] !== 'number') missing.push(`stats.byCategory.${key}`);
  }
  if (missing.length) {
    throw new Error('[prayers] incomplete category wiring: ' + missing.join(', '));
  }
}

export function initPrayers(state) {
  // Seeded like every other simulation decision in the project, so a given
  // seed produces a given set of prayers.
  const rand = mulberry32((state.seed ?? 0) ^ 0x9a17e);

  /** Live prayers only. Anything resolved leaves this array the same tick. */
  const active = [];
  /** Bounded ring of what has ended, newest first. Never grows past HISTORY. */
  const history = [];

  let nextId = 1;
  let scanTick = 0;

  /** villagerId -> sim time before which they will not pray again. */
  const villagerCooldown = new Map();
  /** `${townIndex}:${category}` -> sim time before which that will not recur. */
  const townCooldown = new Map();

  /**
   * Per-town bookkeeping this module owns.
   *
   * Kept HERE rather than stamped onto the town records, because the top of
   * this file promises that it only observes: a `town.lastWonderAt` would be
   * prayers.js quietly owning a field on somebody else's object, and the next
   * person to read town.js would have no way of knowing where it came from.
   *
   * Both are bounded by the number of towns, which is fixed at boot.
   */
  const lastWonderAt = new Map();   // town.index -> when they last saw a miracle
  /**
   * town.index -> the most recent building an enemy pulled down there.
   *
   * ONE PER TOWN, overwritten rather than appended. A list of every ruin would
   * be this project's oldest failure mode - a list that only grows - and the
   * prayer only ever asks about the last thing that fell anyway.
   */
  const razedIn = new Map();

  /**
   * Every event that has already resolved a prayer this session.
   *
   * The brief calls this duplicate-resolution protection and it is not
   * theoretical: `villagers-fed` fires from two different places, and a single
   * food miracle over a crowd would otherwise answer, credit and pay for the
   * same prayer several times over.
   */
  /**
   * When the current drought began, so a prayer can wait for it to bite.
   *
   * Taken from `weather-changed` rather than polled - the sky announces it, the
   * same way everything else in this project announces what it does.
   */
  let droughtBegan = 0;

  const consumedEvents = new Set();
  let eventSeq = 0;

  const stats = {
    generated: 0, answered: 0, failed: 0, expired: 0, invalidated: 0,
    // Declared up front, every category, for the same reason achievements.js
    // declares its counters: a key created on demand turns a missing category
    // into `undefined + 1` and a statistic that is silently NaN forever. Adding
    // `weather` in Phase 19 without adding it here would have done exactly that.
    // EVERY CATEGORY, DECLARED. Adding `weather` in Phase 19 without adding it
    // here would have turned every count into `undefined + 1` - a statistic
    // silently NaN forever - and the five added after Phase 20 are the same
    // trap five times over.
    byCategory: {
      food: 0, rescue: 0, safety: 0, supply: 0, weather: 0,
      rebuild: 0, ground: 0, wonder: 0, beast: 0, thirst: 0
    },
    rejected: {
      villagerBusy: 0, townFull: 0, categoryFull: 0, globalFull: 0,
      cooldown: 0, chance: 0
    },
    duplicateBlocked: 0,
    neglectStreak: 0
  };
  assertCategoriesComplete(stats.byCategory);

  // --- helpers --------------------------------------------------------------

  const now = () => state.time;
  const townOf = (v) => v?.town ?? null;
  const villagerById = (id) =>
    (state.villagers?.list ?? []).find((v) => v.id === id) ?? null;

  function activeForTown(townIndex) {
    let n = 0;
    for (const p of active) if (p.townIndex === townIndex) n++;
    return n;
  }

  function hasActiveFor(villagerId) {
    for (const p of active) if (p.villagerId === villagerId) return true;
    return false;
  }

  /** How many prayers of one kind this town has open. */
  function activeForCategory(townIndex, category) {
    let n = 0;
    for (const p of active) if (p.townIndex === townIndex && p.category === category) n++;
    return n;
  }

  function townHasCategory(townIndex, category) {
    for (const p of active) {
      if (p.townIndex === townIndex && p.category === category) return true;
    }
    return false;
  }

  /**
   * Take a prayer out of `active` and file it.
   *
   * The single exit. Every status change goes through here so there is exactly
   * one place that can leave a resolved prayer in the live list, and it does
   * not.
   */
  function close(p, status, reason, by = 'none') {
    const i = active.indexOf(p);
    if (i < 0) return;              // already closed; never double-count
    active.splice(i, 1);

    p.status = status;
    p.reason = reason;
    p.by = by;
    p.closedAt = now();
    const age = p.closedAt - p.born;

    history.unshift(p);
    if (history.length > PRAYER.HISTORY) history.length = PRAYER.HISTORY;

    stats[status === 'answered' ? 'answered'
      : status === 'failed' ? 'failed'
        : status === 'expired' ? 'expired' : 'invalidated']++;

    // The streak resets only when SOMEBODY ACTUALLY CAME.
    //
    // A crisis that solved itself closes as 'answered' with `by: 'nobody'` -
    // a raid that petered out, hunger that passed - and letting that reset the
    // streak was quietly wrong: it un-suspends penance, which then eats the
    // cruelty earned by ignoring everyone. Measured over fifteen idle minutes
    // that held a god who answered nothing at -0.06 instead of the -0.5 the
    // per-prayer penalties should have produced.
    if (status === 'expired' || status === 'failed') stats.neglectStreak++;
    else if (status === 'answered' && by !== 'nobody' && by !== 'none') {
      stats.neglectStreak = 0;
    }

    state.events?.emit('prayer-resolved', {
      id: p.id, category: p.category, status, town: p.town,
      urgency: p.urgency, by, age,
      neglectStreak: stats.neglectStreak
    });

    if (selected === p) selected = null;
  }

  // --- generation -----------------------------------------------------------

  /**
   * Try to raise one prayer. Returns true if it was raised.
   *
   * Every rejection is counted rather than silently dropped, because "why are
   * there no prayers" is the question this feature will actually be debugged
   * with.
   */
  function raise(v, town, category, urgency, extra = {}) {
    if (active.length >= PRAYER.MAX_ACTIVE) { stats.rejected.globalFull++; return false; }
    if (v && hasActiveFor(v.id)) { stats.rejected.villagerBusy++; return false; }
    if (activeForTown(town.index) >= PRAYER.MAX_PER_TOWN) {
      stats.rejected.townFull++; return false;
    }
    // ...and no one kind of trouble may drown out the rest. See
    // PRAYER.MAX_PER_CATEGORY - this one line is why nine of the ten categories
    // were invisible.
    if (activeForCategory(town.index, category) >= PRAYER.MAX_PER_CATEGORY) {
      stats.rejected.categoryFull++; return false;
    }
    const t = now();
    if (v && (villagerCooldown.get(v.id) ?? 0) > t) { stats.rejected.cooldown++; return false; }
    const key = `${town.index}:${category}`;
    if ((townCooldown.get(key) ?? 0) > t) { stats.rejected.cooldown++; return false; }

    // Urgent conditions are more likely to find a voice than mild ones.
    if (rand() > PRAYER.CHANCE * (0.5 + urgency)) { stats.rejected.chance++; return false; }

    const p = {
      id: nextId++,
      villagerId: v ? v.id : null,
      who: v ? v.name : town.name,
      town,
      townIndex: town.index,
      townName: town.name,
      category,
      urgency,
      born: t,
      expires: t + PRAYER.LIFETIME[category],
      status: 'active',
      reason: '',
      by: 'none',
      seen: false,
      communal: !v,
      ...extra
    };
    active.push(p);
    stats.generated++;
    stats.byCategory[category]++;
    if (v) villagerCooldown.set(v.id, t + PRAYER.COOLDOWN_VILLAGER);
    townCooldown.set(key, t + PRAYER.COOLDOWN_TOWN_CATEGORY);

    state.events?.emit('prayer-raised', {
      id: p.id, category, villagerId: p.villagerId, town,
      urgency, pos: prayerPos(p)
    });
    return true;
  }

  /** What is stopping this town growing, or null. town.js already knows. */
  const blockerOf = (town) => state.town?.growthBlockerOf?.(town) ?? null;

  /**
   * Another god's fighting beast inside this town's land, or null.
   *
   * `peaceful` rather than `atWar`, for the identical reason combat.js's
   * `nearestBeastIntruder` uses it: `atWar` is derived from the war front, and
   * asking one creature about another's war recurses until the stack gives out.
   * A beast on a peaceful leash has come to perform, and a town does not pray
   * about a visitor.
   */
  function hostileBeastIn(town) {
    for (const c of state.creatures ?? []) {
      if (c.faction === town.owner || !c.inField || c.peaceful) continue;
      const d = Math.hypot(c.position.x - town.centre.x, c.position.z - town.centre.z);
      if (d <= town.influenceRadius) return c;
    }
    return null;
  }

  /** Where a prayer is, for markers, the creature and distance checks. */
  function prayerPos(p) {
    if (p.villagerId != null) {
      const v = villagerById(p.villagerId);
      if (v?.alive) return v.pos;
    }
    return p.town.centre;
  }

  /**
   * Look for things worth praying about.
   *
   * Runs on the fixed tick, staggered by SCAN_EVERY, and only ever inspects the
   * player's own people - a rival's hunger is not addressed to you.
   */
  function scan() {
    const towns = state.towns ?? [];
    const list = state.villagers?.list ?? [];
    const droughtFor = state.sky?.weather === 'drought' ? now() - droughtBegan : 0;

    for (const town of towns) {
      if (!town.isPlayer) continue;

      // --- town-wide: hunger ------------------------------------------------
      // One communal voice rather than thirty identical ones. When a whole town
      // is starving, thirty separate prayers is not thirty times the drama, it
      // is an unreadable HUD.
      let pop = 0;
      for (const v of list) if (v.alive && v.town === town) pop++;
      const food = town.resources?.food ?? 0;
      if (pop > 0 && food / pop < PRAYER.TOWN_FOOD_PER_HEAD
          && !townHasCategory(town.index, 'food')) {
        const urgency = Math.min(1, 1 - (food / pop) / PRAYER.TOWN_FOOD_PER_HEAD);
        raise(null, town, 'food', urgency, { communal: true });
      }

      // --- town-wide: a declared raid or an active siege ---------------------
      const threatened = (town.besiegedBy ?? 0) > 0
        || towns.some((t) => !t.isPlayer && t.warTarget === town);
      if (threatened && !townHasCategory(town.index, 'safety')) {
        // Urgent from the moment it is declared, not from the moment they
        // arrive. An army marching on your town is the most alarming thing in
        // this game and a prayer about it should not read as routine.
        const urgency = Math.min(1, 0.62 + (town.besiegedBy ?? 0) * 0.1);
        raise(null, town, 'safety', urgency, { communal: true });
      }

      // --- town-wide: a drought that has gone on ---------------------------
      // Only when they actually farm. A town living off paddocks and foraging
      // has no fields to lose, and praying for rain it does not need is the
      // exact noise this system was built to avoid.
      const farms = town.buildings.filter((b) => b.def.farm).length;
      if (state.sky?.weather === 'drought' && farms > 0
          && droughtFor >= PRAYER.DROUGHT_SECONDS
          && !townHasCategory(town.index, 'weather')) {
        // Worse the longer it runs and the thinner the stores are.
        const bite = Math.min(1, droughtFor / (PRAYER.DROUGHT_SECONDS * 4));
        const hungerNow = pop > 0
          ? Math.max(0, 1 - (food / pop) / PRAYER.TOWN_FOOD_PER_HEAD) : 0;
        raise(null, town, 'weather',
          Math.min(1, 0.3 + bite * 0.4 + hungerNow * 0.3), { communal: true });
      }

      // --- town-wide: a gap where a building stood --------------------------
      // The quiet after the fighting. Raids pull buildings down constantly and
      // nobody had ever asked for one back.
      const razed = razedIn.get(town.index);
      if (razed && now() - razed.at <= PRAYER.RAZED_SECONDS
          && !townHasCategory(town.index, 'rebuild')) {
        raise(null, town, 'rebuild', 0.4, {
          communal: true, razedType: razed.type, razedLabel: razed.label
        });
      }

      // --- town-wide: no ground worth building on ---------------------------
      // THE ONLY PRAYER THAT ASKS FOR THE SCULPTING TOOL. Placing shapes the
      // ground automatically up to SHAPE_MAX_SLOPE, so anything steeper is a
      // real refusal, and a town that has spread out to the rough edges of its
      // land is genuinely stuck - it just used to stop growing without anybody
      // mentioning it.
      //
      // Only once they are big enough for it to matter: a small town has all
      // the room it needs and does not care what the far hillside is like.
      if (pop >= PRAYER.GROUND_MIN_POP && !townHasCategory(town.index, 'ground')) {
        const frac = state.town?.buildableFraction?.(town, PRAYER.BUILDABLE_SAMPLES) ?? 1;
        if (frac < PRAYER.BUILDABLE_FRACTION) {
          raise(null, town, 'ground',
            Math.min(1, 0.3 + (1 - frac / PRAYER.BUILDABLE_FRACTION) * 0.45),
            { communal: true, buildable: frac });
        }
      }

      // --- town-wide: nobody has seen a miracle in a long time ---------------
      // A god game in which the people never ask you to BE a god is missing
      // something. Gated on mood as well as on time, so a contented town does
      // not nag - and `lastWonderAt` starts at zero, which is when the world
      // did, so the clock is honest from the first second.
      if (now() - (lastWonderAt.get(town.index) ?? 0) >= PRAYER.WONDER_SECONDS
          && (town.happiness ?? 1) < PRAYER.WONDER_MOOD
          && !townHasCategory(town.index, 'wonder')) {
        raise(null, town, 'wonder', 0.3 + (1 - (town.happiness ?? 1)) * 0.4,
          { communal: true });
      }

      // --- town-wide: another god's beast in the fields ----------------------
      // Impossible before Phase 20, when there was one creature in the world
      // and it was yours. `peaceful` rather than `atWar` for the same reason
      // combat.js uses it: asking another creature whether it is at war recurses.
      const beast = hostileBeastIn(town);
      if (beast && !townHasCategory(town.index, 'beast')) {
        raise(null, town, 'beast', PRAYER.BEAST_URGENCY,
          { communal: true, beastFaction: beast.faction, beastOwner: beast.ownerName });
      }

      // --- town-wide: fields cut back to the root ---------------------------
      // NOT during a drought - that is `weather`'s prayer, and two voices
      // asking for the same rain is exactly the noise this system exists to
      // avoid. This is the ordinary kind: too many mouths and not enough green.
      const farmList = town.buildings.filter((b) => b.def.farm);
      if (farmList.length >= PRAYER.CROP_MIN_FARMS && state.sky?.weather !== 'drought'
          && !townHasCategory(town.index, 'thirst')) {
        let crop = 0;
        for (const b of farmList) crop += b.crop ?? 1;
        crop /= farmList.length;
        if (crop < PRAYER.CROP_LOW) {
          raise(null, town, 'thirst',
            Math.min(1, 0.3 + (1 - crop / PRAYER.CROP_LOW) * 0.4),
            { communal: true });
        }
      }

      // --- town-wide: a shortage that is actually blocking them --------------
      // `growthBlocker` already knows why a town cannot grow. A prayer for wood
      // when they have plenty and simply have nowhere to build is noise.
      const blocker = blockerOf(town);
      if ((blocker === 'wood' || blocker === 'ore')
          && (town.resources?.[blocker] ?? 0) < PRAYER.SUPPLY_FLOOR
          && !townHasCategory(town.index, 'supply')) {
        const have = town.resources?.[blocker] ?? 0;
        raise(null, town, 'supply', 0.35 + 0.3 * (1 - have / PRAYER.SUPPLY_FLOOR),
          { communal: true, resource: blocker });
      }
    }

    // --- individuals --------------------------------------------------------
    for (const v of list) {
      if (!v.alive || !v.town?.isPlayer || v.held || v.flying) continue;

      // In danger: hurt, or being cut down right now.
      const inPeril = v.health < PRAYER.HEALTH || !!v.foe;
      if (inPeril) {
        const urgency = Math.min(1, 0.55 + (1 - v.health) * 0.5 + (v.foe ? 0.2 : 0));
        if (raise(v, v.town, 'rescue', urgency, { threat: v.foe ? 'raider' : 'wounds' })) continue;
      }

      // Individually starving, even if the town's stores look adequate.
      if (v.hunger > PRAYER.HUNGER) {
        raise(v, v.town, 'food', Math.min(1, (v.hunger - PRAYER.HUNGER) / (1 - PRAYER.HUNGER)));
      }
    }
  }

  // --- expiry and invalidation ---------------------------------------------

  function sweep() {
    const t = now();
    // Backwards: `close` splices, and iterating forwards over a shrinking array
    // skips elements. This is the exact shape of bug the brief warns about.
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];

      if (p.villagerId != null) {
        const v = villagerById(p.villagerId);
        if (!v || !v.alive) { close(p, 'failed', 'the one who asked is dead'); continue; }
        if (!v.town?.isPlayer) { close(p, 'invalid', 'no longer yours'); continue; }
      }
      // A town that changed hands, or was wiped out, cannot still be asking.
      if (!p.town.isPlayer) { close(p, 'invalid', 'the town is no longer yours'); continue; }

      // Conditions that simply stopped being true, without you.
      if (p.category === 'safety') {
        const stillThreatened = (p.town.besiegedBy ?? 0) > 0
          || (state.towns ?? []).some((o) => !o.isPlayer && o.warTarget === p.town);
        if (!stillThreatened) {
          close(p, 'answered', 'the danger passed', 'nobody');
          continue;
        }
      }

      // --- conditions that can stop being true, with or without you --------

      // The beast walked off, or somebody put it down. Which of those it was
      // decides who gets the credit, and it matters: `nobody` pays no belief
      // and does not reset the neglect streak - Phase 19's rule about the rain.
      if (p.category === 'beast') {
        const still = hostileBeastIn(p.town);
        if (!still || still.faction !== p.beastFaction) {
          const driven = (state.creatures ?? [])
            .find((c) => c.faction === p.beastFaction && !c.inField);
          close(p, 'answered',
            driven ? 'the beast was driven off' : 'the beast moved on',
            driven ? 'player' : 'nobody');
          continue;
        }
      }

      // The fields came back on their own, which they do - slowly - whenever
      // there are fewer mouths than green. Nobody's doing but the soil's.
      if (p.category === 'thirst') {
        const farms = p.town.buildings.filter((b) => b.def.farm);
        if (farms.length) {
          let crop = 0;
          for (const b of farms) crop += b.crop ?? 1;
          if (crop / farms.length >= PRAYER.CROP_CLEAR) {
            close(p, 'answered', 'the fields came back', 'nobody');
            continue;
          }
        }
      }

      if (t >= p.expires) close(p, 'expired', 'nobody came');
    }
  }

  // --- answering ------------------------------------------------------------

  /**
   * Consume an event exactly once.
   *
   * `villagers-fed` alone is emitted from two systems, and one food miracle
   * over a crowd would otherwise answer, credit and pay for several prayers at
   * once. An event answers at most one prayer.
   */
  function claim(tag) {
    if (consumedEvents.has(tag)) { stats.duplicateBlocked++; return false; }
    consumedEvents.add(tag);
    // Bounded: this set is per-session and would otherwise be the very leak
    // this module is meant to avoid.
    if (consumedEvents.size > 512) {
      const first = consumedEvents.values().next().value;
      consumedEvents.delete(first);
    }
    return true;
  }

  const near = (a, b, r) => a && b && Math.hypot(a.x - b.x, a.z - b.z) <= r;

  /** The best open prayer this event could be answering, or null. */
  function match(category, pos, town, villagerId = null) {
    let best = null;
    for (const p of active) {
      if (p.category !== category) continue;
      if (villagerId != null && p.villagerId !== villagerId) continue;
      if (town && p.town !== town) continue;
      if (pos && !near(prayerPos(p), pos, PRAYER.ANSWER_RADIUS)) continue;
      // Prefer the most urgent, then the oldest: the loudest voice is answered.
      if (!best || p.urgency > best.urgency
          || (p.urgency === best.urgency && p.born < best.born)) best = p;
    }
    return best;
  }

  function answer(p, by, reason) {
    if (!p) return false;
    close(p, 'answered', reason, by);
    return true;
  }

  // --- subscriptions --------------------------------------------------------
  const ev = state.events;
  ev.on('weather-changed', (e) => {
    if (e?.to === 'drought') droughtBegan = now();
    // The rain came. Every prayer for it is answered by the sky itself - the
    // one thing in this game that answers without the player, and meant to be:
    // a drought you simply outlast is still a drought you survived.
    if (e?.from === 'drought' && e?.to !== 'drought') {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].category === 'weather') {
          // `nobody` - THE SKY IS NOT THE PLAYER.
          //
          // Phase 16 learned this exact lesson and wrote it down: a crisis that
          // solves itself closes as answered with `by: 'nobody'`, because
          // miracles.js pays belief and mercy for anything else and the neglect
          // streak resets on it. Crediting the player for weather they had no
          // hand in would be paying them for waiting.
          close(active[i], 'answered', 'the drought broke', 'nobody');
        }
      }
    }
  });

  ev.on('villagers-fed', (e) => {
    // Which town's people were actually fed. Feeding one village must not
    // answer a prayer from another on the far side of the island.
    const town = state.town?.townAt?.(e.pos?.x, e.pos?.z) ?? null;
    const here = town && town.isPlayer ? town : null;
    // Hunger first, then drought. The drought prayer asks for "rain, or food
    // enough to outlast it" - so feeding a town through one answers it, and
    // unlike the rain arriving on its own, THAT is the player.
    const p = match('food', e.pos, here) ?? match('weather', e.pos, here);
    if (!p) return;
    if (!claim(`fed:${++eventSeq}`)) return;
    answer(p, e.cause === 'miracle' ? 'player' : (e.by ?? 'player'),
      e.cause === 'miracle' ? 'you fed them' : 'food was brought to them');
  });

  /**
   * Raising a roof answers a prayer for one - but only if YOU raised it.
   *
   * `by: 'people'` is your own villagers building for themselves out of your
   * stores, which is Phase 20's self-build. Closing that as `player` would pay
   * belief, reset the neglect streak and count as mercy for work you had no
   * hand in - the identical mistake Phase 19 caught when the rain was closing
   * drought prayers as though the player had sent it.
   */
  ev.on('building-placed', (e) => {
    const town = e?.building?.town;
    if (!town?.isPlayer) return;
    // A house answers a prayer for shelter. Anything at all answers a prayer
    // for BUILDABLE GROUND, because putting a building up on it is proof the
    // ground will take one.
    // Putting back the kind of thing that was pulled down.
    const r = match('rebuild', null, town);
    if (r && e.def?.key === r.razedType && claim(`built:${++eventSeq}`)) {
      razedIn.delete(town.index);
      answer(r, e.by === 'people' ? 'nobody' : 'player',
        e.by === 'people' ? 'they raised it themselves' : 'you raised it again');
      return;
    }
    const g = match('ground', null, town);
    if (g && claim(`built:${++eventSeq}`)) {
      answer(g, e.by === 'people' ? 'nobody' : 'player',
        'something stands on it now');
    }
  });

  /**
   * MOVING THE EARTH. The only prayer answered by the sculpting tool.
   *
   * Re-measured rather than taken on trust: `terrain-changed` fires for any
   * deformation near the town, and a fireball crater is a deformation too. This
   * closes only if the land is genuinely better than it was, which also means
   * digging a pit next to them cannot be passed off as an answer.
   */
  ev.on('terrain-changed', (e) => {
    if (!e || !active.some((p) => p.category === 'ground')) return;
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      if (p.category !== 'ground') continue;
      const d = Math.hypot(e.x - p.town.centre.x, e.z - p.town.centre.z);
      if (d > p.town.influenceRadius + PRAYER.ANSWER_RADIUS) continue;
      const frac = state.town?.buildableFraction?.(p.town, PRAYER.BUILDABLE_SAMPLES) ?? 1;
      if (frac >= PRAYER.BUILDABLE_CLEAR) {
        close(p, 'answered', 'you made the ground level', 'player');
      }
    }
  });

  /**
   * A WONDER, seen.
   *
   * `lastWonderAt` is stamped for every town in sight whether or not anyone was
   * praying, which is what makes the clock honest: a god who works wonders
   * constantly never gets asked, and that is the correct outcome rather than a
   * missed prayer.
   *
   * Water over the fields answers the parched-fields prayer as well, and that
   * one is specific - any other miracle is a wonder but it is not rain.
   */
  ev.on('miracle-cast', (e) => {
    if (!e?.pos) return;
    for (const town of state.towns ?? []) {
      if (!town.isPlayer) continue;
      const d = Math.hypot(e.pos.x - town.centre.x, e.pos.z - town.centre.z);
      if (d <= town.influenceRadius + PRAYER.ANSWER_RADIUS) lastWonderAt.set(town.index, now());
    }
    const w = match('wonder', e.pos, null);
    if (w && claim(`mir:${++eventSeq}`)) {
      answer(w, 'player', 'they saw your hand');
    }
    if (e.def?.key === 'water') {
      const t = match('thirst', e.pos, null);
      if (t && claim(`mir:${++eventSeq}`)) {
        answer(t, 'player', 'you watered their fields');
      }
    }
  });

  ev.on('resource-offered', (e) => {
    if (!e.town?.isPlayer) return;
    const p = match('supply', e.pos, e.town);
    if (!p || p.resource !== e.type) return;
    if (!claim(`res:${++eventSeq}`)) return;
    answer(p, e.by ?? 'player', 'you put it within their reach');
  });

  ev.on('villager-rescued', (e) => {
    const p = match('rescue', null, null, e.villager?.id);
    if (!p) return;
    if (!claim(`resc:${++eventSeq}`)) return;
    answer(p, e.by ?? 'player', 'carried out of harm');
  });

  ev.on('raid-ended', (e) => {
    if (!e.town?.isPlayer) return;
    // Only if the town is genuinely out of danger. One dead raider while the
    // rest are still in the streets is not an answer.
    const stillThreatened = (e.town.besiegedBy ?? 0) > 0
      || (state.towns ?? []).some((o) => !o.isPlayer && o.warTarget === e.town);
    if (stillThreatened) return;
    const p = match('safety', null, e.town);
    if (!p) return;
    if (!claim(`raid:${++eventSeq}`)) return;
    answer(p, 'player', 'the raid was broken');
  });

  ev.on('building-destroyed', (e) => {
    // Only what an ENEMY pulled down, and only in a town of yours. Your own
    // demolitions are your business, and `byPlayer` is exactly that distinction.
    const town = e?.building?.town;
    if (!town?.isPlayer || e.byPlayer) return;
    // The event carries the building, not a def - `building-destroyed` has
    // never had one. Read through the building's own def, which is the same
    // object BUILDINGS holds.
    const def = e.building?.def;
    if (!def?.key) return;
    razedIn.set(town.index, { type: def.key, label: def.label ?? 'building', at: now() });
  });

  ev.on('villagers-killed', (e) => {
    // Handled in `sweep` for the requester themselves; this catches the case
    // where a rescue prayer's subject dies immediately and visibly.
    if (!e?.pos) return;
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      if (p.category !== 'rescue') continue;
      const v = villagerById(p.villagerId);
      if (!v || !v.alive) close(p, 'failed', 'they did not survive');
    }
  });

  ev.on('town-captured', (e) => {
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      if (p.town === e.town && !e.town.isPlayer) {
        close(p, 'invalid', 'the town changed hands');
      }
    }
  });

  // --- selection ------------------------------------------------------------
  let selected = null;

  // --- tick -----------------------------------------------------------------
  function simStep() {
    sweep();
    // Staggered: a condition cannot meaningfully change four times a second,
    // and scanning every villager at 20Hz for something this slow is waste.
    if (++scanTick >= PRAYER.SCAN_EVERY) { scanTick = 0; scan(); }
  }

  const api = {
    enabled: true,
    /** Live prayers. Read-only to everyone else. */
    get active() { return active; },
    get history() { return history; },
    get count() { return active.length; },
    get selected() { return selected; },

    /** Position of a prayer, for markers and for the creature. */
    positionOf: prayerPos,
    /** The player-facing sentence for a prayer. */
    textOf(p) {
      const c = CATEGORIES[p.category];
      return c ? c.text(p) : '';
    },
    wantOf(p) {
      const c = CATEGORIES[p.category];
      if (!c) return '';
      return typeof c.want === 'function' ? c.want(p) : c.want;
    },
    labelOf(p) { return CATEGORIES[p.category]?.label ?? p.category; },
    /** 0..1 of the prayer's life remaining. */
    remainingOf(p) {
      return Math.max(0, Math.min(1, (p.expires - now()) / (p.expires - p.born)));
    },
    isUrgent(p) { return p.urgency >= PRAYER.URGENT_AT; },

    select(p) {
      selected = p ?? null;
      if (selected) selected.seen = true;
      return selected;
    },
    clearSelection() { selected = null; },

    /** Development diagnostics. See the F panel. */
    get stats() {
      const oldest = active.reduce((a, p) => Math.max(a, now() - p.born), 0);
      return {
        ...stats,
        active: active.length,
        historyLength: history.length,
        oldestActiveAge: Math.round(oldest),
        perTownCap: PRAYER.MAX_PER_TOWN,
        recent: history.slice(0, 5).map((p) => `${p.category}:${p.status}`)
      };
    },

    simStep
  };
  state.prayers = api;
  return api;
}
