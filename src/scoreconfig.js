// ---------------------------------------------------------------------------
// scoreconfig.js - every number the Reckoning uses, in one place.
//
// Pure data. It imports nothing and decides nothing, exactly like the config
// half of state.js - it lives in its own file only because it is large enough
// to bury the rest of state.js if it moved in there.
//
// The rule the brief set and this file keeps: NO unexplained number appears in
// reckoning.js. If a value shapes a score, it is here with a reason attached.
// ---------------------------------------------------------------------------

/**
 * Every category is normalised so a strong civilisation scores about this,
 * giving a legible ~8,000-point base across the eight.
 */
export const CATEGORY_TARGET = 1000;

/**
 * Scores are NOT hard-capped at the target.
 *
 * A ceiling would make the back half of a long game meaningless - once you had
 * maxed Civilisation there would be no reason to build anything ever again.
 * Instead, everything past the target is compressed logarithmically: twice the
 * target scores about 1,240, four times about 1,480. Exceptional play still
 * shows, and still counts, but it cannot run away with the match.
 *
 * The UI says so out loud rather than leaving the player to infer it.
 */
export const OVER_SLOPE = 0.35;

/**
 * `raw` at which a category hits CATEGORY_TARGET.
 *
 * These are the tuning dials. They were set from a measured 25-minute soak of
 * an ordinary game rather than guessed - see PHASE_17.md for the distribution
 * they produced.
 */
export const TARGETS = {
  civilization: 1000,
  population: 240,
  prosperity: 700,
  divine: 750,
  dominion: 700,
  // Military was 420, and a 30-minute soak showed why that was wrong: an
  // ordinary rival army pinned the category at 1,281 and made it the largest
  // single score in the game from minute ten onward. A standing army is not
  // worth more than an entire civilisation.
  military: 700,
  legacy: 1400,
  /**
   * Stability is computed directly as 0..100, so this is a little above its
   * own ceiling on purpose: a flawless civilisation scores about 900 rather
   * than pinning at exactly 1,000 and making the top of the scale meaningless.
   */
  stability: 112
};

// --- civilization -----------------------------------------------------------

/**
 * What each kind of building is worth standing.
 *
 * Roughly the brief's table, mapped onto the buildings this game actually has.
 * There is no temple and no dedicated storage/workshop chain beyond these, so
 * `temple` sits here unused as the extension point the brief asked for: adding
 * a building type to the game means adding a row here and nothing else.
 */
export const BUILDING_VALUE = {
  house: 10,
  farm: 20,
  cattle: 20,
  lumber: 25,
  storage: 25,
  workshop: 30,
  barracks: 40,
  temple: 50,        // not in the game yet; here so it scores if it ever is
  manor: 75,
  mine: 75
};

/** Anything not in the table. Deliberately low: unknown is not valuable. */
export const BUILDING_VALUE_DEFAULT = 10;

/**
 * Diminishing returns on repeats of the SAME building type.
 *
 * n houses are worth `value * n^0.78`, so the tenth house is worth about a
 * third of the first. Without this the cheapest building in the game is also
 * the most efficient way to score, and Civilisation becomes "who spammed huts".
 */
export const BUILDING_REPEAT_POWER = 0.78;

/** Per distinct building type owned. A varied town is a real town. */
export const VARIETY_PER_KIND = 26;

/** A town counts as developed at this many standing buildings. */
export const DEVELOPED_BUILDINGS = 8;

/** Current-power bonus for each developed town. */
export const DEVELOPED_TOWN_VALUE = 150;

/**
 * Civilisation lost to recent demolition, inside STABILITY_WINDOW.
 *
 * Current Power already falls when a building stops existing. This is the
 * additional sting of having lost it lately, and it ages out.
 */
export const RECENT_LOSS_PENALTY = 18;

// --- population -------------------------------------------------------------

export const POP_PER_VILLAGER = 2;
/** ON TOP of the villager, for one with a job. Not instead of it. */
export const POP_PER_EMPLOYED = 3;
/** ON TOP of the villager, for a soldier. Soldiers are villagers too. */
export const POP_PER_SOLDIER = 5;

/** Population score is this much current, the rest earned milestones. */
export const POP_CURRENT_SHARE = 0.70;

/**
 * Population milestones, as Legacy.
 *
 * The brief's ladder. This game's towns run 10-40 people, so in practice the
 * first two are the live ones and the rest are there for a runaway game - which
 * is the right shape for a milestone table.
 */
export const POP_MILESTONES = [
  { at: 25, points: 50 },
  { at: 50, points: 100 },
  { at: 100, points: 200 },
  { at: 200, points: 350 },
  { at: 300, points: 500 }
];

/** Milestone points that fill the milestone 30% of Population. */
export const POP_MILESTONE_FULL = 350;

/**
 * A collapse is losing this fraction of your people inside the window.
 *
 * Deliberately not a death COUNT: losing four people out of six is a
 * catastrophe and losing four out of forty is a bad afternoon.
 */
export const COLLAPSE_FRACTION = 0.3;
export const COLLAPSE_PENALTY = 140;

// --- prosperity -------------------------------------------------------------

/**
 * Stockpiles score on a square root, per the brief.
 *
 * 400 wood is not four times as useful as 100; it is a bit better than twice.
 * The curve is what stops "fill one silo and ignore the rest" from winning.
 */
export const RESOURCE_VALUE = { food: 3.4, wood: 2.0, ore: 2.2 };

/**
 * Diversity multiplier, applied to the summed resource contribution.
 *
 * The geometric mean of the three normalised stocks over their arithmetic mean:
 * 1.0 when balanced, near 0 when one resource is missing entirely. This is the
 * clause that enforces "must not win by filling storage with one resource while
 * its population starves".
 */
export const DIVERSITY_WEIGHT = 0.45;

/** Full marks for every villager holding a job. */
export const JOBS_FILLED_VALUE = 160;
/** Food trending upward over the window, scaled by how strongly. */
export const FOOD_TREND_VALUE = 90;
/** Per productive (food- or resource-producing) building, up to a point. */
export const PRODUCER_VALUE = 14;
/** Seconds of famine-free running that earns full marks here. */
export const FAMINE_FREE_FULL = 420;
export const FAMINE_FREE_VALUE = 120;

/** Below this many units of food per person, the town is in famine. */
export const FAMINE_FOOD_PER_HEAD = 1.0;

// --- divine influence -------------------------------------------------------

/**
 * Devotion and Dread are scored separately, then combined as
 *   max(a, b) + DUAL_SHARE * min(a, b)
 * so specialising is viable and holding both is worth a little more.
 */
export const DUAL_SHARE = 0.25;

export const DEVOTION = {
  /** Per point of belief currently held. */
  perBelief: 0.55,
  /** Per prayer answered by somebody actually coming. */
  perPrayerAnswered: 34,
  /** Per helpful miracle (water, food). */
  perKindMiracle: 16,
  /** Per villager carried out of danger. */
  perRescue: 12,
  /** Per town that joined without a fight. */
  perTownWelcomed: 110,
  /** Full marks at alignment +1. */
  mercyFull: 150,
  /** Per second of the population sitting above HAPPY_LOYAL, / 60. */
  loyaltyPerMinute: 9
};

export const DREAD = {
  /** Per enemy building razed. */
  perRazing: 14,
  /** Per enemy killed. */
  perEnemyKilled: 9,
  /** Per destructive miracle (fireball, lightning). */
  perCruelMiracle: 16,
  /** Per town taken by force. */
  perTownConquered: 110,
  /** Full marks at alignment -1. */
  crueltyFull: 150,
  /** Per raid this team launched that landed. */
  perRaidLaunched: 22,
  /** Standing army, as the threat it is. */
  perSoldierStanding: 4
};

/** Happiness above which a population counts as loyal, for devotion. */
export const HAPPY_LOYAL = 0.62;

/**
 * How much devotion-or-dread it takes before a rival's derived alignment can
 * reach the extremes.
 *
 * Rivals have no alignment field in this game - only the player does - so
 * theirs is read from the devotion/dread balance. Without this damping term a
 * rival that owns a single soldier and has done nothing else divides 4 by 4 and
 * comes out at -1: maximally cruel for employing a guard, and paid 150 dread
 * points for it before the first minute. Alignment has to be earned.
 */
export const ALIGNMENT_EVIDENCE = 300;

// --- dominion ---------------------------------------------------------------

export const TOWN_VALUE_SMALL = 100;
export const TOWN_VALUE_DEVELOPED = 200;
/** Per person living under this team's banner. */
export const GOVERNED_VALUE = 2.2;
/** Full marks for holding the whole island's influence area. */
export const TERRITORY_VALUE = 220;

/** Legacy, awarded once per town, keyed by that town's index. */
export const LEGACY_CONVERT_TOWN = 150;
export const LEGACY_CONQUER_TOWN = 125;
/** Held a captured town this long, awarded once per town. */
export const HOLD_SECONDS = 600;
export const LEGACY_HOLD_TOWN = 75;
/** Controlling this share of the island's towns. */
export const ISLAND_MAJORITY = 0.6;
export const LEGACY_ISLAND = 300;

/**
 * A town cannot generate another conquest award for this long after changing
 * hands, and each town's conquest key is unique anyway. Belt and braces: the
 * unique key alone already makes flipping worthless.
 */
export const CONQUEST_COOLDOWN = 120;

// --- military ---------------------------------------------------------------

export const MILITARY = {
  perSoldier: 22,
  perEngine: 40,
  /** Curtain wall, scaled by how intact it is. */
  perTownWall: 30,
  /** A raid on this team that ended without the town falling. */
  perDefenceWon: 70,
  /** A raid this team launched that ended with the town taken. */
  perOffenceWon: 55,
  /** Multiplier when the defence was against a force bigger than the garrison. */
  outnumberedBonus: 1.8,
  /** Per enemy siege engine wrecked. */
  perEngineKilled: 30,
  /**
   * Casualty efficiency, applied to battle score: kills over losses, clamped.
   * Winning cheaply is worth more than winning at any cost.
   */
  efficiency: [0.6, 1.4]
};

/**
 * Killing unarmed villagers is not a military achievement.
 *
 * Explicitly zero rather than absent, because "why don't civilian kills score"
 * is a question this file should answer.
 */
export const MILITARY_CIVILIAN_VALUE = 0;

// --- legacy -----------------------------------------------------------------

/**
 * Team-neutral milestones. Every one of these is a condition the simulation
 * already tracks for every team, which is the whole point: an AI earns them on
 * exactly the same terms a human does.
 *
 * `key` must be unique and bounded - these are the only strings that can ever
 * enter a team's awarded set, apart from per-town keys whose count is bounded
 * by the number of towns on the island.
 */
export const MILESTONES = [
  { key: 'first-building', points: 20, name: 'Foundation Stone',
    blurb: 'Raised a first building.' },
  { key: 'first-birth', points: 20, name: 'New Life',
    blurb: 'A child was born.' },
  { key: 'hamlet', points: 40, name: 'Hamlet', blurb: 'Ten buildings standing.' },
  { key: 'village', points: 80, name: 'Village', blurb: 'Twenty-five buildings standing.' },
  { key: 'township', points: 140, name: 'Township', blurb: 'Fifty buildings standing.' },
  { key: 'variety-6', points: 60, name: 'Every Trade',
    blurb: 'Six different kinds of building.' },
  { key: 'developed-town', points: 70, name: 'A Real Town',
    blurb: 'Developed a town to eight buildings.' },
  { key: 'two-towns', points: 90, name: 'Twin Banners', blurb: 'Held two towns at once.' },
  { key: 'three-towns', points: 150, name: 'Three Crowns', blurb: 'Held three towns at once.' },
  { key: 'first-defence', points: 80, name: 'They Did Not Pass',
    blurb: 'Turned back a raid.' },
  { key: 'first-conquest', points: 90, name: 'By the Sword',
    blurb: 'Took a town by force.' },
  { key: 'first-conversion', points: 110, name: 'They Came Willingly',
    blurb: 'A town joined without a fight.' },
  { key: 'army-10', points: 60, name: 'A Standing Army', blurb: 'Ten soldiers at once.' },
  { key: 'siege-train', points: 70, name: 'Siege Train',
    blurb: 'Fielded a siege engine.' },
  { key: 'famine-free-10', points: 90, name: 'Bread for All',
    blurb: 'Ten minutes without famine.' },
  { key: 'survived-collapse', points: 120, name: 'Against All Odds',
    blurb: 'Recovered from losing a third of the people.' },
  { key: 'prayers-10', points: 100, name: 'Answered Every Call',
    blurb: 'Answered ten prayers.' },
  { key: 'belief-500', points: 80, name: 'The Faithful',
    blurb: 'Held five hundred belief.' },
  { key: 'creature-grown', points: 90, name: 'The Mountain Moved',
    blurb: 'Raised the creature to full size.' },
  { key: 'no-one-lost', points: 130, name: 'No One Left Behind',
    blurb: 'Ten minutes without losing a soul.' }
];

/** Seconds without a death that earns `no-one-lost`. */
export const NO_LOSS_SECONDS = 600;
/** Seconds without famine that earns `famine-free-10`. */
export const FAMINE_FREE_MILESTONE = 600;

/**
 * Achievement rarity, derived rather than read.
 *
 * The Phase 13 table has no rarity field - every entry is a threshold on a
 * counter - so rarity is inferred from how far into a game the threshold sits.
 * These bands are used ONLY to rank the showcase cards and to report a "rarest
 * earned"; they are worth no competitive points, because account-wide unlocks
 * must not follow a player into a new match. See MILESTONES above for what
 * actually scores.
 */
export const RARITY_BANDS = [
  { name: 'Common', points: 5 },
  { name: 'Uncommon', points: 10 },
  { name: 'Rare', points: 20 },
  { name: 'Epic', points: 35 },
  { name: 'Legendary', points: 50 }
];

// --- stability --------------------------------------------------------------

/**
 * Stability is scored 0..100 directly and then normalised, because it reads as
 * a health bar rather than an accumulation.
 */
export const STABILITY = {
  base: 55,
  /** Full marks for a long famine-free run. */
  famineFree: 18,
  /** Food stock rising over the window. */
  foodRising: 10,
  /** Everyone housed. */
  housed: 12,
  /** Reserves of every resource above a floor. */
  reserves: 10,
  /** Walls intact across every town held. */
  walls: 8,

  activeFamine: -30,
  homeless: -14,
  recentDeaths: -22,     // scaled by fraction lost in the window
  townLost: -25,         // per town lost inside the window
  noFoodProduction: -16,
  besieged: -12
};

/**
 * Stability moves toward its computed value at this fraction per second.
 *
 * The brief asks for a trend rather than a flicker: a single bad tick should
 * not swing the bar. At 0.5 it takes a couple of seconds to register a change
 * and about ten to fully settle.
 */
export const STABILITY_SMOOTHING = 0.5;

/**
 * Rolling window for every "recent" judgement, in simulated seconds.
 *
 * Ancient mistakes must not permanently sink a team - a famine in minute three
 * should be forgotten by minute twenty, or Stability stops describing whether
 * the civilisation works NOW and starts describing whether it ever stumbled.
 */
export const STABILITY_WINDOW = 300;

// --- lifecycle and presentation ---------------------------------------------

/** Seconds between full Current Power recalculations. */
export const RECALC_INTERVAL = 0.5;

/** Recent score events kept per team. Hard cap; oldest fall off. */
export const SCORE_EVENT_HISTORY = 24;

/** Major events kept in the world timeline. Hard cap; oldest fall off. */
export const TIMELINE_MAX = 60;

/**
 * Score changes smaller than this never raise a notification on their own.
 * They still count; they are just not worth a line of text.
 */
export const NOTIFY_FLOOR = 40;

/** Seconds between the score trend samples that drive the arrows. */
export const TREND_INTERVAL = 10;

/** Reckoning modes. `endless` is the default and matches how the game plays. */
export const MODES = {
  /** No forced scoring ending. Existing victory/defeat still ends the match. */
  endless: { label: 'Endless Legacy' },
  /** Highest score at the bell. */
  timed: { label: 'Timed Reckoning', seconds: 60 * 60 },
  /** Existing conquest ending, scored for quality of victory. */
  domination: { label: 'Domination' },
  /** First past the post, with a countdown opponents can interrupt. */
  ascension: { label: 'First to Ascend', threshold: 6000, countdown: 120 }
};

/**
 * The mode this game runs in.
 *
 * `endless` preserves exactly the behaviour the game has had since Phase 10 -
 * the existing victory and defeat conditions end the match and the Reckoning
 * scores it. The other three are implemented and driven from here; there is no
 * menu to pick them yet, which is the documented UI extension point.
 */
/**
 * How big a creature has to be for the "grown" milestone.
 *
 * The creature runs CREATURE.START_SCALE 0.85 to MAX_SCALE 2.3 - see
 * creature.js's growth line, which is half age and half meals. This is 96% of
 * the way there, so it wants a creature that has been both kept alive and fed,
 * without demanding the exact last hundredth of a curve that approaches its
 * ceiling asymptotically.
 */
export const CREATURE_GROWN_SCALE = 2.2;

export const MODE = 'endless';

/**
 * Applied once, at the reckoning, on top of Current Power + Legacy.
 *
 * Kept small relative to an ~8,000-point base: winning should confirm a good
 * game rather than overturn one. A team that was outplayed for fifty minutes
 * and squeaked a victory should not vault past a team that built an empire.
 */
export const ENDING = {
  won: 500,
  /** Still standing when the bell rang, win or lose. */
  survived: 150,
  /** Took the island outright. */
  domination: 250,
  /** Crossed the ascension threshold and held it. */
  ascended: 300,

  eliminated: -300,
  /** In famine at the final whistle. */
  endedInFamine: -100,
  /** No people left at all. */
  endedExtinct: -200
};

/** Final titles, in the order they are contested. */
export const TITLES = [
  { key: 'eternal', name: 'The Eternal', why: 'the highest score of the age' },
  { key: 'beloved', name: 'The Beloved God', why: 'the deepest devotion' },
  { key: 'dread', name: 'The Dread Sovereign', why: 'the longest shadow' },
  { key: 'builder', name: 'The Great Builder', why: 'the greatest works' },
  { key: 'conqueror', name: 'The Conqueror', why: 'the widest dominion' },
  { key: 'provider', name: 'The Provider', why: 'the fullest granaries' },
  { key: 'protector', name: 'The Protector', why: 'the people kept safe' },
  { key: 'warmonger', name: 'The Warmonger', why: 'the most war made' },
  { key: 'peacemaker', name: 'The Peacemaker', why: 'expansion without bloodshed' },
  { key: 'survivor', name: 'The Survivor', why: 'endurance through ruin' }
];

/** The eight categories, in display order, with what each one means. */
export const CATEGORIES = [
  { key: 'civilization', label: 'Civilization', icon: '⌂',
    blurb: 'What you have built, and how varied it is.' },
  { key: 'population', label: 'Population', icon: '☖',
    blurb: 'People alive, employed, and under arms.' },
  { key: 'prosperity', label: 'Prosperity', icon: '❖',
    blurb: 'Whether the civilisation can feed and supply itself.' },
  { key: 'divine', label: 'Divine Influence', icon: '✦',
    blurb: 'Devotion and dread. Either will do; both is better.' },
  { key: 'dominion', label: 'Dominion', icon: '◈',
    blurb: 'Towns, people governed, and land held.' },
  { key: 'military', label: 'Military', icon: '⚔',
    blurb: 'Standing forces and battles decided.' },
  { key: 'legacy', label: 'Legacy', icon: '★',
    blurb: 'One-time milestones. Earned once, never lost.' },
  { key: 'stability', label: 'Stability', icon: '⚖',
    blurb: 'Whether it can all keep running.' }
];
