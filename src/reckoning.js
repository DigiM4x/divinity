// ---------------------------------------------------------------------------
// reckoning.js - the scoring engine. What the world made of each of you.
//
// THIS MODULE ONLY OBSERVES AND ANNOUNCES, the same bargain prayers.js makes.
// It never moves a villager, spends a resource, ends a game or touches another
// system's numbers. It reads the world through `state` the way every system in
// this project reads the world, listens to the bus for facts, and emits facts
// of its own:
//
//   score-milestone   a team earned a one-time Legacy award
//   reckoning-final   the match is scored and the result is frozen
//
// It imports no gameplay system. Every number it uses lives in scoreconfig.js.
//
// TEAMS. This game has no team model - towns ARE the factions. So a team is a
// town lineage, fixed at match start:
//
//   * the player's team owns every town where `isPlayer` is true, which grows
//     as towns are captured or come over willingly;
//   * each rival town is its own team, and becomes ELIMINATED when it is taken.
//
// Team identity is snapshotted at init and never re-read, because `capture()`
// overwrites `town.colour` with the player's banner - read it live and a
// conquered rival would retroactively have always been your colour in the
// results table.
//
// TWO KINDS OF SCORE, and the distinction is the whole design:
//
//   * CURRENT POWER is recomputed from live state on a timer. It is idempotent
//     by construction - there is nowhere for it to accumulate - so it rises and
//     falls with what a team actually holds, and rebuilding what you destroyed
//     cannot farm it.
//   * HISTORICAL LEGACY is event-driven and awarded against a UNIQUE KEY held
//     in a bounded set. An event delivered twice awards nothing the second time.
//
// Publishes state.reckoning.
// ---------------------------------------------------------------------------
import * as CFG from './scoreconfig.js';

export function initReckoning(state) {
  const teams = [];
  /** town.index -> the team that FOUNDED that town. Never rewritten. */
  const teamByTownIndex = new Map();
  let playerTeam = null;

  /** Bounded ring of the match's notable moments, newest last. */
  const timeline = [];
  /** The frozen result. Written exactly once, then never again. */
  let final = null;

  let recalcTimer = 0;
  let trendTimer = 0;
  /** Rejected duplicate awards, for the debug panel. */
  let duplicatesBlocked = 0;

  // Ascension bookkeeping, only used when MODE is 'ascension'.
  let ascendingTeam = null;
  let ascendCountdown = 0;

  // --- teams ---------------------------------------------------------------

  function makeTeam(town, isHuman) {
    return {
      id: 'T' + town.index,
      // TOWN.NAMES[0] is already "Your people" - a possessive on top of that
      // reads as "Your people's Kingdom", which is nobody's kingdom.
      displayName: isHuman ? 'Your Kingdom' : town.name,
      isHuman,
      /** The town this team began as. Its towns are found from this. */
      foundedIndex: town.index,
      /** Snapshotted: capture() rewrites town.colour to the player's banner. */
      colour: town.colour,
      eliminated: false,
      eliminatedAt: 0,

      currentPower: 0,
      historicalLegacy: 0,
      endingBonuses: 0,
      finalPenalties: 0,
      finalScore: 0,

      /** category key -> normalised points. */
      categoryTotals: {},
      /** category key -> { itemised: {label: points}, raw, total }. */
      categoryBreakdowns: {},
      /** category key -> Legacy points banked in that category. */
      categoryLegacy: {},

      /** Unique milestone keys. Bounded: see `award`. */
      milestonesAwarded: new Set(),
      /** Ordered record of what was earned, for the showcase. */
      milestoneLog: [],

      /** Bounded ring of recent score events, newest last. */
      recentScoreEvents: [],
      scoreTrend: 0,
      lastTrendScore: 0,

      finalRank: 0,
      finalTitle: null,
      finalTitles: [],

      stability: CFG.STABILITY.base,

      stats: freshStats(),
      windows: freshWindows()
    };
  }

  /**
   * Every match statistic, declared up front.
   *
   * Same reasoning as achievements.js: a counter created on demand turns a typo
   * into a number that is silently always zero, and the results screen would
   * show it without complaint.
   */
  function freshStats() {
    return {
      // civilization
      buildingsPlaced: 0, buildingsDestroyed: 0, buildingsCaptured: 0,
      buildingsLost: 0, buildingsUpgraded: 0,
      buildingsStanding: 0, buildingKinds: 0, developedTowns: 0,
      // population
      finalPop: 0, peakPop: 0, births: 0, deaths: 0, rescued: 0,
      employed: 0, soldiersTrained: 0, soldiersLost: 0,
      // divine
      belief: 0, peakBelief: 0, prayersAnswered: 0, prayersIgnored: 0,
      prayersFailed: 0, kindMiracles: 0, cruelMiracles: 0, feeds: 0,
      townsWelcomed: 0, alignment: 0,
      // warfare and dominion
      battlesWon: 0, battlesLost: 0, raidsLaunched: 0, raidsDefended: 0,
      townsConquered: 0, townsLostCount: 0, enemiesKilled: 0,
      civiliansKilled: 0, enginesBuilt: 0, enginesLost: 0,
      townsHeld: 0, territory: 0,
      // economy and survival
      famines: 0, longestFamineFree: 0, lowestFood: Infinity,
      collapses: 0, recoveries: 0,
      // legacy
      milestoneCount: 0, legacyPoints: 0
    };
  }

  function freshWindows() {
    return {
      /** {t, n} deaths inside STABILITY_WINDOW. */
      deaths: [],
      /** {t} buildings lost inside the window. */
      lost: [],
      /** {t} towns lost inside the window. */
      townsLost: [],
      /** {t, v} food stock samples, for the trend. */
      food: [],
      /** Sim time the current famine-free run began. */
      famineFreeSince: 0,
      inFamine: false,
      /** Sim time of the last death, for `no-one-lost`. */
      lastDeathAt: 0,
      /** Population at the top of the window, for collapse detection. */
      popHigh: 0,
      popHighAt: 0,
      /** True once a collapse has happened and not yet been recovered from. */
      collapsed: false
    };
  }

  for (const town of state.towns ?? []) {
    const t = makeTeam(town, !!town.isPlayer);
    teams.push(t);
    teamByTownIndex.set(town.index, t);
    if (town.isPlayer) playerTeam = t;
  }

  /**
   * Which team holds this town RIGHT NOW (not which founded it).
   *
   * This used to be "the player's if `isPlayer`, else whoever founded it",
   * which was the only answer available while the player was the only one who
   * could take anything. Towns have owners since Phase 20, and a team is a town
   * lineage keyed on the founding index - so the owner IS the answer, and a
   * town a rival takes off another rival is scored to the rival that holds it.
   */
  function holderOf(town) {
    if (!town) return null;
    return teamByTownIndex.get(town.owner) ?? null;
  }

  /** The team a faction index belongs to. Same key space, spelled out. */
  function teamOfFaction(i) {
    return teamByTownIndex.get(i) ?? null;
  }

  /** The towns a team currently holds. */
  function townsOf(team) {
    const out = [];
    for (const t of state.towns ?? []) {
      if (holderOf(t) === team) out.push(t);
    }
    return out;
  }

  // --- awards --------------------------------------------------------------

  /**
   * Give a team a one-time Legacy award, or do nothing.
   *
   * The only path into `historicalLegacy`. Every award carries a unique key and
   * the key set is checked first, so an event delivered twice - and several in
   * this game are, `villagers-fed` most notoriously - scores once.
   *
   * The key space is bounded by construction: the fixed MILESTONES table, plus
   * per-town keys whose count cannot exceed the number of towns on the island.
   */
  function award(team, key, points, category, label) {
    if (!team || final) return false;
    if (team.milestonesAwarded.has(key)) { duplicatesBlocked++; return false; }
    // (counted above only because callers that re-test every tick check `has`
    // themselves first - see `checkMilestones`. What reaches here is a genuinely
    // duplicated EVENT, which is the number worth watching.)
    team.milestonesAwarded.add(key);
    team.historicalLegacy += points;
    team.categoryLegacy[category] = (team.categoryLegacy[category] ?? 0) + points;
    team.stats.milestoneCount++;
    team.stats.legacyPoints += points;
    team.milestoneLog.push({ key, points, label, at: state.time });
    note(team, `${label}: +${points} ${labelOf(category)}`, points, category);
    state.events?.emit('score-milestone', {
      team: team.id, key, points, category, label, at: state.time
    });
    return true;
  }

  const labelOf = (key) =>
    CFG.CATEGORIES.find((c) => c.key === key)?.label ?? key;

  /**
   * Record a score event for the panel.
   *
   * Small changes are not worth a line - the brief asks for combined summaries
   * rather than a flood - so anything under NOTIFY_FLOOR is folded into a
   * running total and only surfaces when it has added up to something.
   */
  function note(team, text, delta, category) {
    const list = team.recentScoreEvents;
    if (Math.abs(delta) < CFG.NOTIFY_FLOOR) {
      const last = list[list.length - 1];
      if (last && last.combined && state.time - last.at < 30) {
        last.delta += delta;
        last.count++;
        last.text = `${last.count} small gains: ${Math.round(last.delta) >= 0 ? '+' : ''}${Math.round(last.delta)}`;
        last.at = state.time;
        return;
      }
      list.push({ text, delta, category, at: state.time, combined: true, count: 1 });
    } else {
      list.push({ text, delta, category, at: state.time, combined: false, count: 1 });
    }
    if (list.length > CFG.SCORE_EVENT_HISTORY) list.shift();
  }

  /** Add to the world timeline. Bounded ring; only genuinely notable moments. */
  function chronicle(text, team) {
    timeline.push({ at: state.time, text, team: team?.id ?? null });
    if (timeline.length > CFG.TIMELINE_MAX) timeline.shift();
  }

  // --- maths ---------------------------------------------------------------

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /**
   * Turn a raw category figure into points against CATEGORY_TARGET.
   *
   * Linear up to the target, then logarithmically compressed - so exceptional
   * play still scores more, but a runaway leader cannot make the other seven
   * categories irrelevant. There is deliberately NO hard ceiling.
   */
  function normalise(raw, target) {
    if (raw <= 0) return 0;
    const r = raw / target;
    if (r <= 1) return CFG.CATEGORY_TARGET * r;
    return CFG.CATEGORY_TARGET * (1 + Math.log1p(r - 1) * CFG.OVER_SLOPE);
  }

  /** Prune a {t, ...} window to STABILITY_WINDOW and return it. */
  function prune(arr, now) {
    const cut = now - CFG.STABILITY_WINDOW;
    while (arr.length && arr[0].t < cut) arr.shift();
    return arr;
  }

  // --- live gathering ------------------------------------------------------

  /**
   * Everything a team currently holds, gathered once per recalculation.
   *
   * One pass over villagers and soldiers for ALL teams rather than one pass per
   * team, because that is the difference between O(teams x villagers) and
   * O(villagers) and this runs on the sim clock.
   */
  function gather() {
    const by = new Map();
    for (const team of teams) {
      by.set(team, {
        pop: 0, employed: 0, soldiers: 0, engines: 0,
        towns: [], buildings: 0, kinds: new Set(), kindCounts: new Map(),
        developed: 0, food: 0, wood: 0, ore: 0, belief: 0,
        happinessSum: 0, wallFrac: 0, besieged: 0, housing: 0, territory: 0
      });
    }

    for (const town of state.towns ?? []) {
      const team = holderOf(town);
      const g = by.get(team);
      if (!g) continue;
      g.towns.push(town);
      g.buildings += town.buildings.length;
      for (const b of town.buildings) {
        g.kinds.add(b.type);
        g.kindCounts.set(b.type, (g.kindCounts.get(b.type) ?? 0) + 1);
      }
      if (town.buildings.length >= CFG.DEVELOPED_BUILDINGS) g.developed++;
      g.happinessSum += town.happiness ?? 0;
      g.wallFrac += clamp((town.wallHp ?? 0) / CFG.WALL_FULL, 0, 1);
      if ((town.besiegedBy ?? 0) > 0) g.besieged++;
      g.territory += (town.influenceRadius ?? 0) ** 2;
      g.housing += state.town?.housingCapacityOf?.(town) ?? 0;
    }

    // The player's towns all share ONE stockpile - `capture` rebinds a taken
    // town's `resources` to `state.resources` - so counting per town would
    // multiply the player's food by the number of towns they hold.
    for (const [team, g] of by) {
      const seen = new Set();
      for (const town of g.towns) {
        if (seen.has(town.resources)) continue;
        seen.add(town.resources);
        g.food += town.resources.food ?? 0;
        g.wood += town.resources.wood ?? 0;
        g.ore += town.resources.ore ?? 0;
        g.belief += town.resources.belief ?? 0;
      }
      if (team === playerTeam) g.belief = state.resources?.belief ?? 0;
    }

    for (const v of state.villagers?.list ?? []) {
      const g = by.get(holderOf(v.town));
      if (!g) continue;
      g.pop++;
      if (v.job) g.employed++;
    }
    for (const s of state.combat?.soldiers ?? []) {
      const g = by.get(holderOf(s.town));
      if (g) g.soldiers++;
    }
    for (const e of state.combat?.engines ?? []) {
      const g = by.get(holderOf(e.town));
      if (g && e.alive) g.engines++;
    }
    return by;
  }

  // --- the eight categories ------------------------------------------------

  function civilization(team, g) {
    const items = {};
    let raw = 0;

    // Per TYPE with diminishing returns, so twenty huts are not twenty huts.
    let buildingPts = 0;
    for (const [kind, n] of g.kindCounts) {
      const v = CFG.BUILDING_VALUE[kind] ?? CFG.BUILDING_VALUE_DEFAULT;
      buildingPts += v * Math.pow(n, CFG.BUILDING_REPEAT_POWER);
    }
    items['Standing buildings'] = buildingPts;
    raw += buildingPts;

    const variety = g.kinds.size * CFG.VARIETY_PER_KIND;
    items['Building variety'] = variety;
    raw += variety;

    const dev = g.developed * CFG.DEVELOPED_TOWN_VALUE;
    if (dev) { items['Developed towns'] = dev; raw += dev; }

    const lost = prune(team.windows.lost, state.time).length;
    if (lost) {
      const pen = -lost * CFG.RECENT_LOSS_PENALTY;
      items['Recently destroyed'] = pen;
      raw += pen;
    }
    // NOT clamped to zero here. Clamping while the itemisation summed negative
    // is precisely the mismatch the validator exists to catch, and it caught
    // it: a razed town showed "itemised -26.4 != raw 0.0". The displayed items
    // must always add up to the displayed raw; `normalise` scores a negative
    // raw as zero, which is where the floor belongs.
    return { items, raw };
  }

  function population(team, g) {
    const items = {};
    // Employed and soldier values are ON TOP of the villager, never instead of
    // it - the brief's "must not double-count the same role incorrectly". A
    // soldier is a person who is also a soldier.
    const living = g.pop * CFG.POP_PER_VILLAGER;
    const employed = g.employed * CFG.POP_PER_EMPLOYED;
    const soldiers = g.soldiers * CFG.POP_PER_SOLDIER;
    items['Living villagers'] = living;
    items['In work'] = employed;
    items['Under arms'] = soldiers;
    let raw = living + employed + soldiers;

    const collapse = team.windows.collapsed ? -CFG.COLLAPSE_PENALTY : 0;
    if (collapse) { items['Recent collapse'] = collapse; raw += collapse; }

    // 70 / 30 current against earned milestones, per the brief.
    const current = normalise(raw, CFG.TARGETS.population)
      * CFG.POP_CURRENT_SHARE;
    const milePts = milestonePointsFor(team, 'population');
    const mile = CFG.CATEGORY_TARGET * (1 - CFG.POP_CURRENT_SHARE)
      * clamp(milePts / CFG.POP_MILESTONE_FULL, 0, 1);
    items['Population milestones'] = milePts;
    // `blend` tells the results table not to split this row into base and
    // penalties: the total is 70% of the normalised current value plus 30% of
    // the milestones, so it is not a scaled version of `raw` and pro-rating the
    // negative terms against it produced rows like "base -31 ... final 43".
    return { items, raw, override: current + mile, blend: true };
  }

  function prosperity(team, g) {
    const items = {};
    let raw = 0;

    // Square roots, so a hoard of one thing cannot carry a starving town.
    const f = CFG.RESOURCE_VALUE.food * Math.sqrt(Math.max(0, g.food));
    const w = CFG.RESOURCE_VALUE.wood * Math.sqrt(Math.max(0, g.wood));
    const o = CFG.RESOURCE_VALUE.ore * Math.sqrt(Math.max(0, g.ore));

    // Diversity: geometric over arithmetic mean of the three. 1.0 balanced,
    // ~0 when one is missing. This is the clause that makes hoarding lose.
    const a = (f + w + o) / 3;
    const geo = Math.cbrt(Math.max(0, f) * Math.max(0, w) * Math.max(0, o));
    const diversity = a > 0 ? clamp(geo / a, 0, 1) : 0;
    const stock = (f + w + o) * (1 - CFG.DIVERSITY_WEIGHT + CFG.DIVERSITY_WEIGHT * diversity);
    items['Stores (diminishing)'] = stock;
    raw += stock;

    const jobs = g.pop > 0
      ? CFG.JOBS_FILLED_VALUE * (g.employed / g.pop) : 0;
    items['Work filled'] = jobs;
    raw += jobs;

    const producers = countProducers(g);
    const prod = producers * CFG.PRODUCER_VALUE;
    items['Producing buildings'] = prod;
    raw += prod;

    // Food trend over the window: is the larder filling or emptying?
    const trend = foodTrend(team);
    const tv = CFG.FOOD_TREND_VALUE * clamp(trend, -1, 1);
    items['Food trend'] = tv;
    raw += tv;

    const run = state.time - team.windows.famineFreeSince;
    const ff = team.windows.inFamine ? 0
      : CFG.FAMINE_FREE_VALUE * clamp(run / CFG.FAMINE_FREE_FULL, 0, 1);
    items['Without famine'] = ff;
    raw += ff;

    if (team.windows.inFamine) {
      items['In famine'] = -140;
      raw -= 140;
    }
    return { items, raw };
  }

  function countProducers(g) {
    let n = 0;
    for (const [kind, c] of g.kindCounts) {
      if (kind === 'farm' || kind === 'cattle' || kind === 'lumber'
        || kind === 'mine' || kind === 'workshop') n += c;
    }
    return n;
  }

  /** -1 (emptying fast) .. +1 (filling), from the food window. */
  function foodTrend(team) {
    const arr = team.windows.food;
    if (arr.length < 2) return 0;
    const first = arr[0].v;
    const last = arr[arr.length - 1].v;
    const span = Math.max(1, arr[arr.length - 1].t - arr[0].t);
    // Per minute, scaled against a modest 40/min as "clearly healthy".
    return clamp(((last - first) / span) * 60 / 40, -1, 1);
  }

  /**
   * Devotion and dread, then max + a quarter of the min.
   *
   * Both playstyles have to be able to win this category outright, which is
   * what `max` gives them, and the quarter-share is the small reward for
   * commanding both rather than a reason to chase both.
   */
  function divine(team, g) {
    const s = team.stats;

    // Both figures are built WITHOUT the alignment term first, alignment is
    // derived from them, and only then does it contribute. That ordering is
    // what makes this function idempotent.
    //
    // The first version read alignment from the previous pass, since a rival's
    // alignment is itself derived from devotion and dread - a one-tick lag that
    // converged but was not stable, and the debug validator duly caught it:
    // recomputing the same state twice moved a team's power by 0.6 points. A
    // score that changes when you look at it twice is not a score.
    let dev = 0;
    dev += CFG.DEVOTION.perBelief * g.belief;
    dev += CFG.DEVOTION.perPrayerAnswered * s.prayersAnswered;
    dev += CFG.DEVOTION.perKindMiracle * s.kindMiracles;
    dev += CFG.DEVOTION.perRescue * s.rescued;
    dev += CFG.DEVOTION.perTownWelcomed * s.townsWelcomed;
    dev += CFG.DEVOTION.loyaltyPerMinute * (team.loyalSeconds ?? 0) / 60;

    let dread = 0;
    dread += CFG.DREAD.perRazing * s.buildingsDestroyed;
    dread += CFG.DREAD.perEnemyKilled * s.enemiesKilled;
    dread += CFG.DREAD.perCruelMiracle * s.cruelMiracles;
    dread += CFG.DREAD.perTownConquered * s.townsConquered;
    dread += CFG.DREAD.perRaidLaunched * s.raidsLaunched;
    dread += CFG.DREAD.perSoldierStanding * g.soldiers;

    const align = deriveAlignment(team, dev, dread);
    team.alignment = align;
    if (align > 0) dev += CFG.DEVOTION.mercyFull * align;
    else dread += CFG.DREAD.crueltyFull * -align;

    const hi = Math.max(dev, dread);
    const lo = Math.min(dev, dread);
    const raw = hi + CFG.DUAL_SHARE * lo;
    team.devotion = dev;
    team.dread = dread;

    // Itemised as what actually happened to the two figures: the larger counts
    // in full, the smaller at a quarter. Reading "Dread counted at a quarter"
    // explains the whole category without a formula.
    const leadIsDev = dev >= dread;
    return {
      items: {
        [leadIsDev ? 'Devotion (in full)' : 'Dread (in full)']: hi,
        [leadIsDev ? 'Dread (quarter share)' : 'Devotion (quarter share)']:
          CFG.DUAL_SHARE * lo
      },
      raw
    };
  }

  /**
   * The player's alignment is authoritative - miracles.js owns it and the HUD
   * shows it. Rivals have no alignment in this game, so theirs is derived from
   * the same devotion/dread balance the category already computes, which keeps
   * every team judged on its behaviour rather than on a field only one of them
   * happens to have.
   */
  function deriveAlignment(team, dev, dread) {
    if (team === playerTeam) return clamp(state.alignment ?? 0, -1, 1);
    // The +EVIDENCE is not decoration. Without it a rival that owns one soldier
    // and has done nothing else scores dread 4, devotion 0, and comes out at
    // alignment -1: maximally cruel, on the strength of employing a guard. That
    // then paid it 150 dread points before the game had started. Alignment has
    // to be earned, so it stays near zero until there is enough behaviour to
    // read, and only approaches the extremes once there is a lot.
    return clamp((dev - dread) / (dev + dread + CFG.ALIGNMENT_EVIDENCE), -1, 1);
  }

  /** The alignment settled by the last `divine` pass. */
  const alignmentOf = (team) => team.alignment ?? 0;

  function dominion(team, g) {
    const items = {};
    let raw = 0;
    let townPts = 0;
    for (const t of g.towns) {
      townPts += t.buildings.length >= CFG.DEVELOPED_BUILDINGS
        ? CFG.TOWN_VALUE_DEVELOPED : CFG.TOWN_VALUE_SMALL;
    }
    items['Towns held'] = townPts;
    raw += townPts;

    const gov = g.pop * CFG.GOVERNED_VALUE;
    items['People governed'] = gov;
    raw += gov;

    // Share of all influence area on the island.
    let all = 0;
    for (const t of state.towns ?? []) all += (t.influenceRadius ?? 0) ** 2;
    const share = all > 0 ? g.territory / all : 0;
    const terr = CFG.TERRITORY_VALUE * share;
    items['Territory held'] = terr;
    raw += terr;
    team.territoryShare = share;

    const lost = prune(team.windows.townsLost, state.time).length;
    if (lost) {
      const pen = -lost * 120;
      items['Towns recently lost'] = pen;
      raw += pen;
    }
    return { items, raw };
  }

  function military(team, g) {
    const items = {};
    let raw = 0;
    const s = team.stats;

    const army = g.soldiers * CFG.MILITARY.perSoldier;
    items['Standing army'] = army;
    raw += army;

    const eng = g.engines * CFG.MILITARY.perEngine;
    if (eng) { items['Siege engines'] = eng; raw += eng; }

    const walls = g.wallFrac * CFG.MILITARY.perTownWall;
    items['Walls'] = walls;
    raw += walls;

    // Battles are bounded events, not kill counts: a raid that resolves scores
    // once, whoever wins. Endlessly respawning soldiers cannot generate score
    // because score comes from the RAID resolving, and a raid resolves once.
    const eff = efficiencyOf(team);
    const def = s.raidsDefended * CFG.MILITARY.perDefenceWon * eff;
    if (def) { items['Raids turned back'] = def; raw += def; }
    const off = s.battlesWon * CFG.MILITARY.perOffenceWon * eff;
    if (off) { items['Attacks carried'] = off; raw += off; }

    // Explicitly worth nothing. Slaughtering civilians is cruelty - it scores
    // under Dread - and calling it a military victory would be a lie the
    // scoreboard told about what happened.
    if (s.civiliansKilled) {
      items['Civilian casualties'] = CFG.MILITARY_CIVILIAN_VALUE;
    }
    return { items, raw };
  }

  /** Kills over losses, clamped: winning cheaply beats winning at any cost. */
  function efficiencyOf(team) {
    const s = team.stats;
    const [lo, hi] = CFG.MILITARY.efficiency;
    const lost = s.soldiersLost;
    if (lost <= 0) return s.enemiesKilled > 0 ? hi : 1;
    return clamp(s.enemiesKilled / lost, lo, hi);
  }

  function legacy(team) {
    const items = {};
    let raw = 0;
    // Everything banked outside Population's own milestone share, which is
    // already counted inside that category and must not be counted twice.
    for (const [cat, pts] of Object.entries(team.categoryLegacy)) {
      if (cat === 'population') continue;
      items[labelOf(cat)] = pts;
      raw += pts;
    }
    return { items, raw };
  }

  function milestonePointsFor(team, category) {
    return team.categoryLegacy[category] ?? 0;
  }

  /**
   * Stability, scored 0..100 and smoothed toward.
   *
   * Every "recent" term reads a rolling window, so a famine in minute three is
   * forgotten by minute twenty - otherwise Stability stops describing whether
   * the civilisation works now and starts describing whether it ever stumbled.
   */
  function stability(team, g, dt) {
    const items = {};
    const W = team.windows;
    const S = CFG.STABILITY;
    let v = S.base;
    items['Base'] = S.base;

    const run = state.time - W.famineFreeSince;
    if (!W.inFamine) {
      const b = S.famineFree * clamp(run / CFG.FAMINE_FREE_FULL, 0, 1);
      items['Without famine'] = b; v += b;
    } else {
      items['Famine'] = S.activeFamine; v += S.activeFamine;
    }

    const trend = foodTrend(team);
    if (trend > 0) { const b = S.foodRising * trend; items['Food rising'] = b; v += b; }

    const housed = g.housing >= g.pop;
    if (housed) { items['Everyone housed'] = S.housed; v += S.housed; }
    else { items['Homeless'] = S.homeless; v += S.homeless; }

    const floor = Math.max(20, g.pop * 2);
    if (g.food > floor && g.wood > floor && g.ore > floor * 0.4) {
      items['Reserves'] = S.reserves; v += S.reserves;
    }

    if (g.towns.length) {
      const b = S.walls * (g.wallFrac / g.towns.length);
      items['Walls'] = b; v += b;
    }

    // Deaths inside the window, as a fraction of the people they were taken
    // from - four out of six is a catastrophe, four out of forty is a bad week.
    let dead = 0;
    for (const d of prune(W.deaths, state.time)) dead += d.n;
    if (dead > 0) {
      const frac = clamp(dead / Math.max(1, g.pop + dead), 0, 1);
      const p = S.recentDeaths * frac;
      items['Recent deaths'] = p; v += p;
    }

    const tl = prune(W.townsLost, state.time).length;
    if (tl) { const p = S.townLost * tl; items['Towns lost'] = p; v += p; }

    if (countProducers(g) === 0 && g.pop > 0) {
      items['No production'] = S.noFoodProduction; v += S.noFoodProduction;
    }
    if (g.besieged > 0) {
      const p = S.besieged * g.besieged;
      items['Under siege'] = p; v += p;
    }

    const target = clamp(v, 0, 100);
    // Smoothed so the bar shows a trend rather than flickering every tick.
    const k = 1 - Math.exp(-CFG.STABILITY_SMOOTHING * dt);
    team.stability += (target - team.stability) * k;
    items['(smoothed toward)'] = target;
    return { items, raw: team.stability };
  }

  // --- the recalculation ---------------------------------------------------

  /**
   * Recompute every team's Current Power from live state.
   *
   * IDEMPOTENT BY CONSTRUCTION: it assigns rather than accumulates, and reads
   * only what a team currently holds. Running it twice gives the same answer,
   * which is what the debug validator checks.
   */
  function recalc(dt) {
    const by = gather();
    for (const team of teams) {
      const g = by.get(team);
      const s = team.stats;

      // Statistics that are simply "what is true now".
      s.finalPop = g.pop;
      if (g.pop > s.peakPop) s.peakPop = g.pop;
      s.employed = g.employed;
      s.buildingsStanding = g.buildings;
      s.buildingKinds = g.kinds.size;
      s.developedTowns = g.developed;
      s.townsHeld = g.towns.length;
      s.belief = g.belief;
      if (g.belief > s.peakBelief) s.peakBelief = g.belief;
      if (g.food < s.lowestFood) s.lowestFood = g.food;

      trackWindows(team, g, dt);

      const cats = {
        civilization: civilization(team, g),
        population: population(team, g),
        prosperity: prosperity(team, g),
        divine: divine(team, g),
        dominion: dominion(team, g),
        military: military(team, g),
        legacy: legacy(team),
        stability: stability(team, g, dt)
      };
      s.alignment = alignmentOf(team);
      s.territory = team.territoryShare ?? 0;

      let power = 0;
      for (const c of CFG.CATEGORIES) {
        const r = cats[c.key];
        const pts = r.override !== undefined
          ? r.override
          : normalise(r.raw, CFG.TARGETS[c.key]);
        team.categoryTotals[c.key] = pts;
        team.categoryBreakdowns[c.key] = {
          itemised: r.items, raw: r.raw, total: pts,
          blend: !!r.blend,
          legacy: team.categoryLegacy[c.key] ?? 0
        };
        power += pts;
      }
      team.currentPower = power;

      checkMilestones(team, g);
      checkElimination(team, g);
    }
    updateAscension();
  }

  /** Roll the time windows forward and spot famine and collapse edges. */
  function trackWindows(team, g, dt) {
    const W = team.windows;
    const now = state.time;

    // Food samples, one per recalculation, pruned to the window.
    W.food.push({ t: now, v: g.food });
    prune(W.food, now);

    // Famine is food per head, not a raw number: ten loaves is plenty for two
    // people and nothing for forty.
    const perHead = g.pop > 0 ? g.food / g.pop : Infinity;
    const hungry = g.pop > 0 && perHead < CFG.FAMINE_FOOD_PER_HEAD;
    if (hungry && !W.inFamine) {
      W.inFamine = true;
      team.stats.famines++;
      const run = now - W.famineFreeSince;
      if (run > team.stats.longestFamineFree) team.stats.longestFamineFree = run;
      chronicle(`Famine in ${team.displayName}`, team);
      note(team, 'Famine has set in', -80, 'stability');
    } else if (!hungry && W.inFamine) {
      W.inFamine = false;
      W.famineFreeSince = now;
      chronicle(`${team.displayName} recovers from famine`, team);
      team.stats.recoveries++;
    }
    if (!W.inFamine) {
      const run = now - W.famineFreeSince;
      if (run > team.stats.longestFamineFree) team.stats.longestFamineFree = run;
    }

    // Collapse: lost COLLAPSE_FRACTION of the high-water population inside the
    // window. The high water itself decays with the window, so recovering and
    // then dipping again is judged against the recent peak, not an ancient one.
    if (g.pop > W.popHigh || now - W.popHighAt > CFG.STABILITY_WINDOW) {
      W.popHigh = g.pop;
      W.popHighAt = now;
    }
    const fell = W.popHigh > 0 && (W.popHigh - g.pop) / W.popHigh >= CFG.COLLAPSE_FRACTION;
    if (fell && !W.collapsed) {
      W.collapsed = true;
      team.stats.collapses++;
      chronicle(`${team.displayName} suffers a collapse`, team);
      note(team, 'The people are dying', -CFG.COLLAPSE_PENALTY, 'population');
    } else if (!fell && W.collapsed) {
      W.collapsed = false;
      team.stats.recoveries++;
      award(team, 'survived-collapse', milestone('survived-collapse').points,
        'stability', milestone('survived-collapse').name);
    }

    // Loyalty: seconds spent with a contented population, for Devotion.
    const happy = g.towns.length
      ? g.happinessSum / g.towns.length : 0;
    if (happy >= CFG.HAPPY_LOYAL && g.pop > 0) {
      team.loyalSeconds = (team.loyalSeconds ?? 0) + dt;
    }
  }

  /**
   * Which title a category earns, when a team led in nothing outright.
   *
   * Population and Legacy have no title of their own in the table, so they are
   * absent here rather than mapped to something that does not describe them.
   */
  const CATEGORY_TITLE = {
    civilization: 'builder', dominion: 'conqueror', prosperity: 'provider',
    divine: 'beloved', military: 'warmonger', stability: 'survivor'
  };

  const milestone = (key) => CFG.MILESTONES.find((m) => m.key === key);

  /** Team-neutral milestones, checked from live state so every team can earn. */
  function checkMilestones(team, g) {
    // `has` is tested here rather than left to `award`, because this function
    // re-checks every condition twice a second forever. Letting the routine
    // re-tests fall through to the guard buried the real signal: a 25-minute
    // soak reported 6,958 "duplicates blocked" when not one duplicate event had
    // been delivered. The counter now means what it says.
    const give = (key, cat) => {
      if (team.milestonesAwarded.has(key)) return;
      const m = milestone(key);
      if (m) award(team, key, m.points, cat, m.name);
    };
    const s = team.stats;

    if (g.buildings >= 1) give('first-building', 'civilization');
    if (g.buildings >= 10) give('hamlet', 'civilization');
    if (g.buildings >= 25) give('village', 'civilization');
    if (g.buildings >= 50) give('township', 'civilization');
    if (g.kinds.size >= 6) give('variety-6', 'civilization');
    if (g.developed >= 1) give('developed-town', 'civilization');
    if (g.towns.length >= 2) give('two-towns', 'dominion');
    if (g.towns.length >= 3) give('three-towns', 'dominion');
    if (g.soldiers >= 10) give('army-10', 'military');
    if (g.engines >= 1) give('siege-train', 'military');
    if (s.births >= 1) give('first-birth', 'population');
    if (s.prayersAnswered >= 10) give('prayers-10', 'divine');
    if (g.belief >= 500) give('belief-500', 'divine');

    // Population ladder. Keyed by the threshold, so each rung is awarded once
    // and dropping back below it does not un-earn or re-earn anything.
    for (const m of CFG.POP_MILESTONES) {
      if (g.pop >= m.at && !team.milestonesAwarded.has(`pop-${m.at}`)) {
        if (award(team, `pop-${m.at}`, m.points, 'population',
          `Population reached ${m.at}`)) {
          chronicle(`${team.displayName} reached ${m.at} people`, team);
        }
      }
    }

    const W = team.windows;
    if (!W.inFamine && state.time - W.famineFreeSince >= CFG.FAMINE_FREE_MILESTONE) {
      give('famine-free-10', 'prosperity');
    }
    if (g.pop > 0 && state.time - W.lastDeathAt >= CFG.NO_LOSS_SECONDS) {
      give('no-one-lost', 'stability');
    }
    // EVERY GOD'S CREATURE, not only the player's (Phase 20). This was the
    // last place in the scoring where a category could only be earned by the
    // human, which contradicted the whole premise of Phase 17 - that every team
    // is judged on identical terms - by exactly one line.
    //
    // ...and it could not be earned by ANYBODY either, which is why it never
    // fired for the player in nineteen phases of testing. The test read
    // `state.creature.size >= 0.98`. There is no `size` on that object - it is
    // `scale`, and it runs START_SCALE 0.85 to MAX_SCALE 2.3, so the expression
    // was `undefined ?? 0 >= 0.98`: permanently false, permanently silent.
    // Exactly the shape of bug Phase 17 wrote down twice - a statistic declared
    // and never written looks like a working feature.
    const beast = state.creatures?.find((c) => teamOfFaction(c.faction) === team);
    if (beast && beast.scale >= CFG.CREATURE_GROWN_SCALE) {
      give('creature-grown', 'divine');
    }

    // Holding a captured town for HOLD_SECONDS. Keyed per town, so the total
    // number of these keys can never exceed the number of towns on the island.
    for (const t of g.towns) {
      if (!t.captured || !t.capturedAtScore) continue;
      if (state.time - t.capturedAtScore >= CFG.HOLD_SECONDS
        && !team.milestonesAwarded.has(`hold-${t.index}`)) {
        award(team, `hold-${t.index}`, CFG.LEGACY_HOLD_TOWN, 'dominion',
          `Held ${t.name}`);
      }
    }

    // Most of the island.
    const total = (state.towns ?? []).length;
    if (total > 0 && g.towns.length / total >= CFG.ISLAND_MAJORITY
      && !team.milestonesAwarded.has('island-majority')) {
      if (award(team, 'island-majority', CFG.LEGACY_ISLAND, 'dominion',
        'Master of the island')) {
        chronicle(`${team.displayName} commands most of the island`, team);
      }
    }
  }

  function checkElimination(team, g) {
    if (team.eliminated) return;
    // A team is out when it holds no town, or has no people left in the ones
    // it holds. Both are terminal in this game: a town cannot be re-founded.
    if (g.towns.length === 0 || (g.pop === 0 && g.buildings === 0)) {
      team.eliminated = true;
      team.eliminatedAt = state.time;
      chronicle(`${team.displayName} is no more`, team);
    }
  }

  // --- ascension -----------------------------------------------------------

  /**
   * First to Ascend, per the brief: announce, count down, and let opponents
   * pull the leader back below the line to cancel it.
   *
   * Implemented and driven even though MODE ships as 'endless', so switching
   * the mode is a config change rather than a feature.
   */
  function updateAscension() {
    if (CFG.MODE !== 'ascension' || final) return;
    const cfg = CFG.MODES.ascension;
    const live = teams.filter((t) => !t.eliminated);
    const best = live.slice().sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    if (!best || scoreOf(best) < cfg.threshold) {
      if (ascendingTeam) {
        state.ui?.toast(`${ascendingTeam.displayName} falls short of ascension`);
        chronicle(`${ascendingTeam.displayName}'s ascension is broken`, ascendingTeam);
      }
      ascendingTeam = null;
      ascendCountdown = 0;
      return;
    }
    if (ascendingTeam !== best) {
      ascendingTeam = best;
      ascendCountdown = cfg.countdown;
      chronicle(`${best.displayName} approaches ascension`, best);
      state.ui?.toast(`${best.displayName} approaches ascension`);
    }
  }

  const scoreOf = (t) => t.currentPower + t.historicalLegacy;

  // --- events --------------------------------------------------------------
  //
  // Everything here is a FACT about something that happened. Current Power is
  // never touched from an event handler - it is recomputed from live state - so
  // a duplicated event can move a statistic at worst, and Legacy is protected
  // by the unique-key set in `award`.

  const ev = state.events;
  const subs = [];
  const sub = (type, fn) => subs.push(ev.on(type, fn));

  sub('building-placed', (e) => {
    const team = holderOf(e?.building?.town);
    if (team) team.stats.buildingsPlaced++;
  });

  sub('building-destroyed', (e) => {
    const owner = holderOf(e?.building?.town);
    if (owner) {
      owner.stats.buildingsLost++;
      owner.windows.lost.push({ t: state.time });
    }
    // Credit the razing to whoever did it. `byPlayer` used to be the only
    // attribution the event carried; it carries the faction now, so a rival
    // gets the same credit for the same deed. Left as it was, `buildingsDestroyed`
    // would have been a statistic only the human could ever score, which is the
    // fairness bug this whole phase of scoring exists to avoid.
    const razer = teamOfFaction(e?.by ?? -1);
    if (razer && razer !== owner) razer.stats.buildingsDestroyed++;
  });

  sub('building-upgraded', (e) => {
    const team = holderOf(e?.building?.town);
    if (team) team.stats.buildingsUpgraded++;
  });

  // `townAt` takes TWO NUMBERS, not a position. Handing it the object made
  // every one of these handlers resolve to no team at all - so births, deaths
  // and feeds were silently zero for the whole of Phase 17, and the death
  // window that Stability reads never filled. prayers.js had it right;
  // this file did not. Found when graveyard.js copied the same mistake.
  sub('villager-born', (e) => {
    const team = holderOf(state.town?.townAt?.(e?.pos?.x, e?.pos?.z));
    if (team) team.stats.births++;
  });

  sub('villagers-killed', (e) => {
    const n = e?.count ?? 1;
    const team = holderOf(state.town?.townAt?.(e?.pos?.x, e?.pos?.z));
    if (team) {
      team.stats.deaths += n;
      team.windows.deaths.push({ t: state.time, n });
      team.windows.lastDeathAt = state.time;
    }
    // Same generalisation as the razing above, and it matters more here:
    // `enemiesKilled` and the losses beside it are what `efficiencyOf` divides
    // to weight the Military score. Scored for the player alone, every rival
    // would have gone into that division with a numerator of zero.
    const killer = teamOfFaction(e?.by ?? -1);
    if (killer) {
      // A kill in someone else's town is an enemy; in your own it is not a
      // military achievement of any kind.
      if (team && team !== killer) killer.stats.enemiesKilled += n;
      else killer.stats.civiliansKilled += n;
    }
  });

  sub('villager-rescued', (e) => {
    if (e?.by && playerTeam) playerTeam.stats.rescued++;
  });

  sub('villagers-fed', (e) => {
    const team = holderOf(state.town?.townAt?.(e?.pos?.x, e?.pos?.z));
    if (team) team.stats.feeds++;
  });

  sub('miracle-cast', (e) => {
    if (!playerTeam) return;
    const key = e?.def?.key;
    if (key === 'water' || key === 'food') playerTeam.stats.kindMiracles++;
    else playerTeam.stats.cruelMiracles++;
  });

  sub('prayer-resolved', (e) => {
    if (!playerTeam) return;
    if (e?.status === 'answered' && e.by !== 'nobody' && e.by !== 'none') {
      playerTeam.stats.prayersAnswered++;
    } else if (e?.status === 'expired') playerTeam.stats.prayersIgnored++;
    else if (e?.status === 'failed') playerTeam.stats.prayersFailed++;
  });

  sub('town-captured', (e) => {
    const town = e?.town;
    if (!town) return;
    // WHOEVER TOOK IT, not the player.
    //
    // Every line below credited `playerTeam` unconditionally, which was sound
    // while the player was the only one who could take anything. It is not any
    // more, and left alone it would have handed the human the Legacy for a
    // conquest on the far side of the island - and, worse, marked one rival's
    // conquest of another as the human's own first conquest. Phase 17 spent a
    // phase hunting this exact shape of thing.
    const winner = teamOfFaction(e.by ?? 0);
    const loser = teamOfFaction(e.from ?? town.index);
    if (!winner) return;
    // Stamped for the hold-it-for-ten-minutes milestone. Named distinctly so it
    // cannot be confused with anything town.js owns.
    town.capturedAtScore = state.time;

    if (e.how === 'conquest') {
      winner.stats.townsConquered++;
      // Keyed on the TAKER as well as the town, because a town can change hands
      // more than once now: `conquer-3` alone would let the second captor be
      // silently refused the award their siege actually earned.
      award(winner, `conquer-${town.index}-by-${winner.id}`, CFG.LEGACY_CONQUER_TOWN,
        'dominion', `Conquered ${town.name}`);
      if (!winner.milestonesAwarded.has('first-conquest')) {
        const m = milestone('first-conquest');
        award(winner, m.key, m.points, 'military', m.name);
      }
      chronicle(`${town.name} was conquered`, winner);
    } else {
      winner.stats.townsWelcomed++;
      award(winner, `convert-${town.index}-by-${winner.id}`, CFG.LEGACY_CONVERT_TOWN,
        'dominion', `${town.name} joined willingly`);
      if (!winner.milestonesAwarded.has('first-conversion')) {
        const m = milestone('first-conversion');
        award(winner, m.key, m.points, 'divine', m.name);
      }
      chronicle(`${town.name} converted through awe`, winner);
    }
    // Every building in it changes hands - a statistic on both sides.
    winner.stats.buildingsCaptured += town.buildings.length;
    if (loser && loser !== winner) {
      loser.stats.townsLostCount++;
      loser.stats.buildingsLost += town.buildings.length;
      loser.windows.townsLost.push({ t: state.time });
      note(loser, `${town.name} lost`, -CFG.TOWN_VALUE_DEVELOPED, 'dominion');
    }
  });

  /** Raids in flight, so a resolution can be matched to its declaration. */
  const openRaids = new Map();

  sub('raid-declared', (e) => {
    const from = holderOf(e?.from);
    const to = holderOf(e?.to);
    if (from) from.stats.raidsLaunched++;
    if (!e?.to) return;
    // Keyed by the town under attack: one raid per town at a time, which is
    // what combat.js enforces, so this map is bounded by the town count.
    openRaids.set(e.to.index, {
      from, to, strength: e.strength ?? 0, at: state.time
    });
  });

  sub('raid-ended', (e) => {
    const town = e?.town;
    if (!town) return;
    const raid = openRaids.get(town.index);
    // Delete FIRST: a raid resolves exactly once, and combat.js can emit
    // raid-ended from two places (called off, and siege lifted) for the same
    // raid. Without this the same battle would score every time.
    openRaids.delete(town.index);
    if (!raid) return;

    const defender = holderOf(town);
    const stillTheirs = defender === raid.to;
    if (stillTheirs && defender) {
      defender.stats.raidsDefended++;
      defender.stats.battlesWon++;
      if (raid.from) raid.from.stats.battlesLost++;
      const m = milestone('first-defence');
      award(defender, m.key, m.points, 'military', m.name);
      note(defender, 'Enemy raid defeated', CFG.MILITARY.perDefenceWon, 'military');
      chronicle(`${defender.displayName} turned back a raid on ${town.name}`, defender);
    } else if (raid.from) {
      raid.from.stats.battlesWon++;
      if (raid.to) raid.to.stats.battlesLost++;
    }
  });

  // The four statistics that were declared and never written. `soldiersLost`
  // is not cosmetic: `efficiencyOf` divides kills by it to weight the Military
  // score, so with it stuck at zero every team scored as though it had never
  // lost a man.
  sub('unit-trained', (e) => {
    const team = holderOf(e?.town);
    if (!team) return;
    if (e.kind === 'engine') team.stats.enginesBuilt++;
    else team.stats.soldiersTrained++;
  });

  sub('unit-lost', (e) => {
    const team = holderOf(e?.town);
    if (!team) return;
    if (e.kind === 'engine') team.stats.enginesLost++;
    else team.stats.soldiersLost++;
  });

  sub('achievement-earned', () => {
    // Deliberately NOT scored. Account-wide unlocks would follow a player into
    // a new match and no AI can ever earn one - see MILESTONES in scoreconfig
    // for the team-neutral equivalents that do score. The achievement showcase
    // on the results screen reads achievements.js directly.
  });

  sub('game-over', (e) => reckon(e?.kind, e?.reason));

  // --- the reckoning -------------------------------------------------------

  /**
   * Freeze the result. Exactly once, ever.
   *
   * After this the simulation may carry on - "Continue Playing" is a supported
   * ending - and nothing it does can reach the snapshot, because the snapshot
   * is plain frozen data copied out of live state rather than a view onto it.
   */
  function reckon(kind, reason) {
    if (final) return final;
    recalc(CFG.RECALC_INTERVAL);      // one last pass on live state

    // WHO GETS THE VICTORY BONUS is the game's verdict; WHO WINS is the score.
    //
    // These were the same call and it produced a contradiction on screen: a
    // player victory made `winner` the player, while the podium labelled rank 1
    // the winner - and a test ending produced "1. Ashfell ... winner" directly
    // above a player who had supposedly just won. There can only be one winner
    // on a results screen.
    //
    // So the Phase 10 verdict is worth ENDING.won toward your rank, which is
    // substantial and can decide a close match, but it does not overrule a
    // civilisation that was three thousand points better. Rank 1 wins.
    const bonusTeam = decideWinner(kind);

    for (const team of teams) {
      let bonus = 0;
      let penalty = 0;
      const why = [];
      if (team === bonusTeam) {
        bonus += CFG.ENDING.won;
        why.push(['Victory condition', CFG.ENDING.won]);
      }
      if (!team.eliminated) {
        bonus += CFG.ENDING.survived;
        why.push(['Survived', CFG.ENDING.survived]);
      }
      if (team === bonusTeam && (team.territoryShare ?? 0) >= CFG.ISLAND_MAJORITY) {
        bonus += CFG.ENDING.domination;
        why.push(['Domination', CFG.ENDING.domination]);
      }
      if (CFG.MODE === 'ascension' && team === ascendingTeam) {
        bonus += CFG.ENDING.ascended;
        why.push(['Ascended', CFG.ENDING.ascended]);
      }
      if (team.eliminated) {
        penalty += CFG.ENDING.eliminated;
        why.push(['Eliminated', CFG.ENDING.eliminated]);
      }
      if (team.windows.inFamine) {
        penalty += CFG.ENDING.endedInFamine;
        why.push(['Ended in famine', CFG.ENDING.endedInFamine]);
      }
      if (team.stats.finalPop === 0) {
        penalty += CFG.ENDING.endedExtinct;
        why.push(['No people left', CFG.ENDING.endedExtinct]);
      }
      team.endingBonuses = bonus;
      team.finalPenalties = penalty;
      team.endingReasons = why;
      team.finalScore = team.currentPower + team.historicalLegacy + bonus + penalty;
    }

    rank();
    // Decided only now, from the ranking, so the number beside a team and the
    // word "winner" can never disagree.
    const winner = sortTeams(teams)[0] ?? null;
    for (const team of teams) assignTitles(team);
    // Exactly one primary title per team: settle collisions by rank, so the
    // better team keeps the title it earned and the other takes its next best.
    resolveTitleCollisions();

    chronicle(kind === 'victory' ? 'The reckoning' : 'The reckoning', null);

    final = Object.freeze({
      at: state.time,
      kind, reason,
      mode: CFG.MODE,
      seed: state.seed,
      island: state.island?.name ?? 'unknown',
      winner: winner?.id ?? null,
      teams: teams.map(snapshotTeam),
      timeline: timeline.map((e) => Object.freeze({ ...e })),
      summary: null            // filled below; needs the snapshot to read from
    });
    // The summary reads the frozen snapshot so it can never disagree with it.
    // `final` is read through a getter on the api, so assigning to
    // `state.reckoning.final` would throw - and did. The module-local is the
    // one true copy, which is the point: nothing outside can replace it.
    final = Object.freeze({ ...final, summary: writeSummary(final) });
    state.events?.emit('reckoning-final', { at: state.time, kind, winner: final.winner });
    state.debug.lastLog = 'reckoning frozen';
    return final;
  }

  /** A deep, plain, immutable copy. No live references escape into it. */
  function snapshotTeam(team) {
    const cats = {};
    for (const c of CFG.CATEGORIES) {
      const b = team.categoryBreakdowns[c.key] ?? { itemised: {}, raw: 0, total: 0 };
      cats[c.key] = Object.freeze({
        total: b.total,
        raw: b.raw,
        blend: !!b.blend,
        legacy: team.categoryLegacy[c.key] ?? 0,
        itemised: Object.freeze({ ...b.itemised })
      });
    }
    return Object.freeze({
      id: team.id,
      displayName: team.displayName,
      isHuman: team.isHuman,
      isEliminated: team.eliminated,
      eliminatedAt: team.eliminatedAt,
      colour: team.colour,
      alignment: team.stats.alignment,
      currentPower: team.currentPower,
      historicalLegacy: team.historicalLegacy,
      endingBonuses: team.endingBonuses,
      finalPenalties: team.finalPenalties,
      endingReasons: Object.freeze(team.endingReasons.map((r) => Object.freeze([...r]))),
      finalScore: team.finalScore,
      finalRank: team.finalRank,
      finalTitle: team.finalTitle,
      finalTitles: Object.freeze([...team.finalTitles]),
      categories: Object.freeze(cats),
      statistics: Object.freeze({ ...team.stats }),
      milestones: Object.freeze(team.milestoneLog.map((m) => Object.freeze({ ...m }))),
      devotion: team.devotion ?? 0,
      dread: team.dread ?? 0,
      stability: team.stability,
      territoryShare: team.territoryShare ?? 0
    });
  }

  /**
   * Who won.
   *
   * The existing Phase 10 conditions come first, as the brief requires: a
   * player victory or defeat is the game's own verdict and scoring does not
   * overrule it. Score decides the winner only where the game has not.
   */
  function decideWinner(kind) {
    if (kind === 'victory' && playerTeam) return playerTeam;

    // A DEFEAT NOW HAS A NAMED WINNER (Phase 20). If one faction is holding
    // every town on the island, the game's verdict belongs to them and not to
    // whichever surviving team happens to have scored best - the same rule the
    // player's own victory gets, pointed the other way. Read off the map rather
    // than off the ending text, because the text is prose.
    const holders = new Set((state.towns ?? []).map((t) => t.owner));
    if (holders.size === 1) {
      const sole = teamOfFaction([...holders][0]);
      if (sole) return sole;
    }

    const live = teams.filter((t) => !t.eliminated);
    const pool = live.length ? live : teams;
    if (kind === 'defeat' && playerTeam) {
      const others = pool.filter((t) => t !== playerTeam);
      if (others.length) return sortTeams(others)[0];
    }
    return sortTeams(pool)[0] ?? null;
  }

  /**
   * The tie-break ladder, in the brief's order and fully deterministic:
   * score, then Dominion, then Stability, then living population, then the
   * time the team first reached its score, then the stable team id.
   */
  function sortTeams(list) {
    return list.slice().sort((a, b) => {
      const d = b.finalScore - a.finalScore;
      if (Math.abs(d) > 1e-9) return d;
      const dom = (b.categoryTotals.dominion ?? 0) - (a.categoryTotals.dominion ?? 0);
      if (Math.abs(dom) > 1e-9) return dom;
      const st = (b.categoryTotals.stability ?? 0) - (a.categoryTotals.stability ?? 0);
      if (Math.abs(st) > 1e-9) return st;
      const pop = b.stats.finalPop - a.stats.finalPop;
      if (pop) return pop;
      const reach = (a.reachedAt ?? Infinity) - (b.reachedAt ?? Infinity);
      if (reach) return reach;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  function rank() {
    const order = sortTeams(teams);
    order.forEach((t, i) => { t.finalRank = i + 1; });
  }

  /** Every title this team qualifies for, best first. */
  function assignTitles(team) {
    const best = (key) => {
      const order = teams.slice().sort((a, b) =>
        (b.categoryTotals[key] ?? 0) - (a.categoryTotals[key] ?? 0));
      return order[0] === team;
    };
    const top = (fn) => {
      const order = teams.slice().sort((a, b) => fn(b) - fn(a));
      return order[0] === team && fn(team) > 0;
    };
    const got = [];
    if (team.finalRank === 1) got.push('eternal');
    if (top((t) => t.devotion ?? 0)) got.push('beloved');
    if (top((t) => t.dread ?? 0)) got.push('dread');
    if (best('civilization')) got.push('builder');
    if (best('dominion')) got.push('conqueror');
    if (best('prosperity')) got.push('provider');
    if (top((t) => t.stats.raidsDefended + t.stats.rescued)) got.push('protector');
    if (top((t) => t.stats.raidsLaunched + t.stats.townsConquered)) got.push('warmonger');
    if (top((t) => t.stats.townsWelcomed)) got.push('peacemaker');
    if (top((t) => t.stats.recoveries)) got.push('survivor');
    // Ordered by the config's own precedence.
    team.finalTitles = CFG.TITLES.filter((t) => got.includes(t.key)).map((t) => t.key);
    team.finalTitle = team.finalTitles[0] ?? null;
  }

  /**
   * No two teams share a primary title.
   *
   * Resolved by rank, deterministically: the better-placed team keeps the
   * contested title and the other falls through to its next qualification, or
   * to a plain descriptive fallback if it has none left.
   */
  function resolveTitleCollisions() {
    const taken = new Map();
    for (const team of sortTeams(teams)) {
      let picked = null;
      for (const key of team.finalTitles) {
        if (!taken.has(key)) { picked = key; break; }
      }
      if (!picked) {
        // Rather than a generic label. A team that led in nothing still played
        // in a particular way, and its own strongest category says what it was
        // - which is the difference between a title and a participation badge.
        // Only if even that is taken does it fall back to a plain word.
        const mine = CFG.CATEGORIES
          .map((c) => ({ c, v: team.categoryTotals[c.key] ?? 0 }))
          .sort((a, b) => b.v - a.v);
        for (const { c } of mine) {
          const key = CATEGORY_TITLE[c.key];
          if (key && !taken.has(key)) { picked = key; break; }
        }
      }
      if (!picked) picked = team.eliminated ? 'fallen' : 'remembered';
      taken.set(picked, team);
      team.finalTitle = picked;
    }
  }

  /**
   * The match summary: structured templates over real values, no invention.
   *
   * Reads the FROZEN snapshot rather than live state so it can never describe a
   * world that has moved on since the bell.
   */
  function writeSummary(snap) {
    const order = snap.teams.slice().sort((a, b) => a.finalRank - b.finalRank);
    const win = order[0];
    const second = order[1];
    if (!win) return 'The island kept no record of this age.';

    const strongest = (t) => {
      const cats = CFG.CATEGORIES
        .map((c) => ({ c, v: t.categories[c.key].total }))
        .sort((a, b) => b.v - a.v);
      return cats[0].c.label;
    };
    const weakest = (t) => {
      const cats = CFG.CATEGORIES
        .map((c) => ({ c, v: t.categories[c.key].total }))
        .sort((a, b) => a.v - b.v);
      return cats[0].c.label;
    };

    const parts = [];
    const s = win.statistics;
    const how = [];
    if (s.townsWelcomed > 0) how.push(`${s.townsWelcomed} town${s.townsWelcomed > 1 ? 's' : ''} that came willingly`);
    if (s.townsConquered > 0) how.push(`${s.townsConquered} taken by force`);
    if (s.prayersAnswered > 0) how.push(`${s.prayersAnswered} prayers answered`);
    if (s.raidsDefended > 0) how.push(`${s.raidsDefended} raid${s.raidsDefended > 1 ? 's' : ''} turned back`);
    if (s.buildingsStanding > 0) how.push(`${s.buildingsStanding} buildings standing`);

    parts.push(
      `${win.displayName} ends the age ${win.isEliminated ? 'remembered' : 'ascendant'}` +
      `, strongest in ${strongest(win)}` +
      (how.length ? `, on ${how.slice(0, 3).join(', ')}` : '') + '.'
    );

    if (second) {
      const gap = Math.round(win.finalScore - second.finalScore);
      const bestCat = CFG.CATEGORIES
        .map((c) => ({
          c, d: win.categories[c.key].total - second.categories[c.key].total
        }))
        .sort((a, b) => b.d - a.d)[0];
      parts.push(
        `${second.displayName} was the nearest rival, strongest in ` +
        `${strongest(second)}, but finished ${gap.toLocaleString()} behind` +
        (bestCat && bestCat.d > 0
          ? `; the gap was widest in ${bestCat.c.label}.` : '.')
      );
      const w = second.statistics;
      const trouble = [];
      if (w.famines > 0) trouble.push(`${w.famines} famine${w.famines > 1 ? 's' : ''}`);
      if (w.collapses > 0) trouble.push('a population collapse');
      if (w.townsLostCount > 0) trouble.push(`${w.townsLostCount} town${w.townsLostCount > 1 ? 's' : ''} lost`);
      if (trouble.length) {
        parts.push(`It was held back by ${trouble.join(' and ')}, and was weakest in ${weakest(second)}.`);
      }
    }

    // The turning point: the timeline entry closest to where the lead settled.
    const turns = snap.timeline.filter((e) =>
      /conquer|convert|collapse|famine|no more|commands most/i.test(e.text));
    if (turns.length) {
      const t = turns[turns.length - 1];
      // Not lowercased. The first version folded the first character to fit
      // "when ..." into the sentence, which turned "Ashfell is no more" into
      // "ashfell is no more" - every one of these lines starts with a town or
      // a team name. Punctuation does the joining instead.
      parts.push(`The age turned at ${clock(t.at)} — ${t.text}.`);
    }
    return parts.join(' ');
  }

  const clock = (t) =>
    `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;

  // --- simulation ----------------------------------------------------------

  function simStep(dt) {
    // After the bell the world may keep turning - Continue Playing - but the
    // match is decided and nothing more is scored.
    if (final) return;

    recalcTimer -= dt;
    if (recalcTimer <= 0) {
      const step = CFG.RECALC_INTERVAL - recalcTimer;
      recalcTimer = CFG.RECALC_INTERVAL;
      recalc(step);
    }

    trendTimer -= dt;
    if (trendTimer <= 0) {
      trendTimer = CFG.TREND_INTERVAL;
      for (const team of teams) {
        const now = scoreOf(team);
        team.scoreTrend = now - team.lastTrendScore;
        team.lastTrendScore = now;
        if (!team.reachedAt && now > 0) team.reachedAt = state.time;
      }
    }

    if (CFG.MODE === 'timed' && state.time >= CFG.MODES.timed.seconds) {
      state.endGame('victory', 'the appointed hour came');
    }
    if (CFG.MODE === 'ascension' && ascendingTeam) {
      ascendCountdown -= dt;
      if (ascendCountdown <= 0) {
        state.endGame(ascendingTeam === playerTeam ? 'victory' : 'defeat',
          `${ascendingTeam.displayName} ascended`);
      }
    }
  }

  // --- diagnostics ---------------------------------------------------------

  /**
   * Recompute everything from source state and report anything that disagrees.
   *
   * The point of this is that Current Power is supposed to be idempotent. If
   * running the calculation twice moves a number, something is accumulating
   * that should not be, which is the exact bug this project keeps finding.
   */
  function validate() {
    // Settle first, then measure.
    //
    // A milestone whose condition became true on this very tick is awarded
    // during the pass, which legitimately raises the Legacy category and so
    // raises Current Power - and the check reported that as drift. One settling
    // pass takes any pending award, so what the comparison below sees is only
    // recomputation, which is the thing that is supposed to be idempotent.
    recalc(0);
    const before = teams.map((t) => ({
      id: t.id, power: t.currentPower, legacy: t.historicalLegacy,
      cats: { ...t.categoryTotals }
    }));
    const beforeDup = duplicatesBlocked;
    recalc(0);          // dt 0: stability does not move, nothing else is timed
    const problems = [];
    teams.forEach((t, i) => {
      const b = before[i];
      if (Math.abs(t.currentPower - b.power) > 0.5) {
        problems.push(`${t.id} power ${b.power.toFixed(1)} -> ${t.currentPower.toFixed(1)}`);
      }
      if (t.historicalLegacy !== b.legacy) {
        problems.push(`${t.id} LEGACY MOVED ${b.legacy} -> ${t.historicalLegacy}`);
      }
      // Every category total must equal its own itemisation, normalised.
      for (const c of CFG.CATEGORIES) {
        const br = t.categoryBreakdowns[c.key];
        if (!br) continue;
        let sum = 0;
        for (const [k, v] of Object.entries(br.itemised)) {
          if (k.startsWith('(')) continue;      // annotations, not terms
          sum += v;
        }
        if (c.key === 'divine') continue;       // combined, not a plain sum
        if (c.key === 'stability') continue;    // smoothed toward the sum
        if (c.key === 'population') continue;   // 70/30 blend, not a plain sum
        if (Math.abs(sum - br.raw) > 1.0) {
          problems.push(`${t.id}/${c.key} itemised ${sum.toFixed(1)} != raw ${br.raw.toFixed(1)}`);
        }
      }
    });
    return {
      ok: problems.length === 0,
      problems,
      duplicatesBlockedDuring: duplicatesBlocked - beforeDup
    };
  }

  function debugInfo() {
    return {
      mode: CFG.MODE,
      frozen: !!final,
      duplicatesBlocked,
      milestoneKeys: teams.reduce((n, t) => n + t.milestonesAwarded.size, 0),
      timelineLength: timeline.length,
      scoreEvents: teams.reduce((n, t) => n + t.recentScoreEvents.length, 0),
      openRaids: openRaids.size,
      ascension: CFG.MODE === 'ascension'
        ? { team: ascendingTeam?.id ?? null, countdown: Math.max(0, ascendCountdown) }
        : null,
      teams: teams.map((t) => ({
        id: t.id, name: t.displayName, elim: t.eliminated,
        power: Math.round(t.currentPower), legacy: t.historicalLegacy,
        total: Math.round(scoreOf(t)), trend: Math.round(t.scoreTrend),
        cats: Object.fromEntries(CFG.CATEGORIES.map((c) =>
          [c.key, Math.round(t.categoryTotals[c.key] ?? 0)]))
      }))
    };
  }

  /** Everything the live panel and the results screen read. */
  const api = {
    enabled: true,
    teams,
    get playerTeam() { return playerTeam; },
    /** Live standings, best first. Uses the same deterministic ladder. */
    standings() {
      // finalScore is only meaningful after the bell; live ranking uses the
      // running total, so the panel and the results screen agree at the moment
      // the bell rings and never before it.
      const live = teams.slice();
      for (const t of live) if (!final) t.finalScore = scoreOf(t);
      return sortTeams(live);
    },
    scoreOf,
    teamById: (id) => teams.find((t) => t.id === id) ?? null,
    get timeline() { return timeline; },
    get final() { return final; },
    get ascension() {
      return CFG.MODE === 'ascension' && ascendingTeam
        ? { team: ascendingTeam, seconds: Math.max(0, ascendCountdown) } : null;
    },
    /** Force the reckoning. Used by the debug panel and the timed modes. */
    reckon,
    validate,
    debugInfo,
    /** Drop every subscription. For a clean teardown; nothing calls it yet. */
    dispose() { for (const off of subs) off(); subs.length = 0; },
    simStep
  };

  state.reckoning = api;
  return api;
}
