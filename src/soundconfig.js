// ---------------------------------------------------------------------------
// soundconfig.js - every clip, gain, cooldown and radius.
//
// Pure data, imports nothing, exactly like scoreconfig.js. The rule this file
// keeps: NO unexplained number in sound.js. If a value shapes what you hear, it
// is here with a reason attached.
//
// TWO PACKS, AND THE SPLIT BETWEEN THEM IS THE DESIGN.
//
//   kenney_rpg-audio      chop, knifeSlice, metalPot, creak, doorOpen,
//                         handleCoins, footsteps, books. Recorded, physical,
//                         diegetic - things that happen IN the world.
//
//   kenney_impact-sounds  impactBell, impactMining, impactWood, impactPunch,
//                         impactSoft, footstep_grass. Physical too, and where
//                         the RPG pack is hands and leather, this one is things
//                         hitting other things - which is most of a war and all
//                         of a building falling down.
//
//   kenney_digital-audio  powerUp, threeTone, zap, phaser. Synthesised,
//                         abstract - the god layer and the interface, which are
//                         not things anyone in the world can hear.
//
// So: a villager's axe is a recording of an axe, and an achievement is a tone.
// A fireball is synthesised because nothing in a foley pack is a fireball, and
// nobody expects magic to sound recorded. Mixing the two the other way round -
// a synth blip for a woodcutter - is the "asset file names are not a taxonomy"
// mistake wearing a different hat.
//
// STILL MISSING is at the bottom: what the island wants and neither pack has.
// ---------------------------------------------------------------------------

/**
 * Master mixer. Three buses, so ambience can sit under the world without
 * dragging the interface down with it.
 */
export const BUSES = {
  interface: 0.55,
  world: 0.85,
  ambient: 0.5
};

/** Overall gain, before the buses. Persisted; see sound.js. */
export const MASTER_DEFAULT = 0.7;

/**
 * Hard ceiling on simultaneous sources.
 *
 * The recurring bug of this project - a collection that only grows - wearing an
 * audible hat. Forty villagers finishing a chop on the same tick is forty
 * voices without this, and the OLDEST is stolen rather than the newest refused,
 * so the most recent thing that happened is always the thing you hear.
 */
export const MAX_VOICES = 24;

/** Beyond this a world sound is not played at all - not played quietly. */
export const AUDIBLE_RANGE = 260;

/**
 * Distance at which a world sound is still at full volume. Inside this it does
 * not get louder, which stops a sound directly under the camera dominating.
 */
export const FULL_VOLUME_RANGE = 40;

/**
 * THE INTERFACE. Abstract feedback, and deliberately not diegetic.
 *
 * `clip` names a file (without extension) or an array to pick from - variation
 * matters far more than fidelity for a sound you will hear a thousand times.
 * `cool` is the minimum seconds between two plays of the same entry, which is
 * what stops an event arriving with `count: 20` becoming twenty voices.
 */
export const UI_SOUNDS = {
  /** An achievement card. The most triumphant thing in either pack. */
  achievement: { clip: ['powerUp1', 'powerUp3', 'powerUp7'], gain: 0.9, cool: 0.4 },
  /** A Legacy milestone in the reckoning - quieter than an achievement. */
  milestone: { clip: ['pepSound1', 'pepSound3'], gain: 0.5, cool: 0.5 },

  /** Somebody has begun asking for something. */
  prayerRaised: { clip: ['twoTone1'], gain: 0.35, cool: 1.2 },
  /** ...and somebody came. */
  prayerAnswered: { clip: ['threeTone1', 'threeTone2'], gain: 0.6, cool: 0.6 },
  /** ...and nobody did. The low, falling one. */
  prayerLost: { clip: ['lowDown'], gain: 0.45, cool: 0.8 },

  // Panels are BOOKS, not tones. You are a god leafing through a grimoire, and
  // the recorded page-turn says that in a way a synth blip cannot.
  open: { clip: ['bookOpen'], gain: 0.55, cool: 0.08 },
  close: { clip: ['bookClose'], gain: 0.55, cool: 0.08 },
  page: { clip: ['bookFlip1', 'bookFlip2', 'bookFlip3'], gain: 0.4, cool: 0.06 },
  /** Choosing a building, a miracle, a leash mode. */
  select: { clip: ['metalClick'], gain: 0.4, cool: 0.05 },
  /** "Not enough belief", "too close to a building" - anything refused. */
  refuse: { clip: ['lowRandom'], gain: 0.35, cool: 0.25 },

  /** The end of the match. */
  victory: { clip: ['powerUp11'], gain: 1.0, cool: 4 },
  defeat: { clip: ['lowThreeTone'], gain: 0.9, cool: 4 }
};

/**
 * THE WORLD. Positional, attenuated, culled by distance.
 *
 * Everything here is a recording except the miracles, which are the one part of
 * this world that is explicitly not physical.
 */
export const WORLD_SOUNDS = {
  // --- work ---------------------------------------------------------------
  // The sound the island is mostly made of. Ten woodcutters in a wood IS the
  // ambience, which is why the gain is low and the cooldown short.
  chop: { clip: ['chop', 'impactWood_light_000', 'impactWood_light_002'],
    gain: 0.5, cool: 0.09 },
  mine: { clip: ['impactMining_000', 'impactMining_001', 'impactMining_002',
    'impactMining_003', 'impactMining_004'], gain: 0.45, cool: 0.09 },
  harvest: { clip: ['cloth1', 'cloth2', 'cloth3', 'cloth4'], gain: 0.4, cool: 0.09 },
  /** A load going into the store. */
  deposit: { clip: ['handleCoins', 'handleCoins2'], gain: 0.35, cool: 0.18 },

  // --- building -----------------------------------------------------------
  /** Timber going up: planks landing, and a frame taking weight. */
  build: { clip: ['impactPlank_medium_000', 'impactPlank_medium_002',
    'impactPlank_medium_004', 'creak1', 'creak2'], gain: 0.75, cool: 0.35 },
  /** ...and coming down. Heavy wood, which is what a building is. */
  collapse: { clip: ['impactWood_heavy_000', 'impactWood_heavy_002',
    'impactWood_heavy_004'], gain: 0.95, cool: 0.25 },
  upgrade: { clip: ['impactMetal_medium_001', 'metalLatch'], gain: 0.7, cool: 0.4 },

  // --- war ----------------------------------------------------------------
  /** Steel on steel, mixed with the knife draw for variety. */
  clash: { clip: ['impactMetal_light_000', 'impactMetal_light_003',
    'knifeSlice', 'knifeSlice2'], gain: 0.55, cool: 0.12 },
  /** A soldier trained: steel drawn. */
  muster: { clip: ['drawKnife1', 'drawKnife2', 'drawKnife3'], gain: 0.5, cool: 0.5 },
  /** Somebody falls. A soft heavy impact is a body, and nothing else is. */
  death: { clip: ['impactSoft_heavy_000', 'impactSoft_heavy_002',
    'impactSoft_medium_001'], gain: 0.7, cool: 0.22 },
  /** A raid declared. Still no horn in any of the three packs - see MISSING. */
  raid: { clip: ['impactMetal_heavy_002', 'doorOpen_1'], gain: 0.85, cool: 3 },

  /**
   * A town coming over to you. THE BELL, at last.
   *
   * This was a synthesised power-up until the impact pack arrived, because
   * neither of the first two had a bell in it and a fantasy town changing hands
   * without one is a missed note. `impactBell_heavy` is exactly the sound.
   */
  townTaken: { clip: ['impactBell_heavy_000', 'impactBell_heavy_002',
    'impactBell_heavy_004'], gain: 1.0, cool: 2 },

  // --- the hand -----------------------------------------------------------
  pickUp: { clip: ['beltHandle1', 'beltHandle2'], gain: 0.5, cool: 0.12 },
  putDown: { clip: ['handleSmallLeather', 'handleSmallLeather2',
    'impactGeneric_light_001'], gain: 0.45, cool: 0.12 },
  /** Something thrown landing. Scaled by speed at the call site. */
  thud: { clip: ['impactGeneric_light_000', 'impactGeneric_light_003',
    'impactWood_medium_001'], gain: 0.6, cool: 0.08 },

  // --- miracles: synthesised, because magic is not physical ---------------
  miracleLightning: { clip: ['zap1', 'zap2', 'zapTwoTone'], gain: 0.9, cool: 0.15 },
  miracleFireball: { clip: ['phaserDown1', 'phaserDown3'], gain: 0.85, cool: 0.15 },
  miracleWater: { clip: ['phaserUp2', 'phaserUp5'], gain: 0.6, cool: 0.15 },
  miracleFood: { clip: ['phaserUp6', 'phaserUp7'], gain: 0.6, cool: 0.15 }
};

/**
 * STILL MISSING, after three packs.
 *
 * The ambient three are the significant absence, and no impact or foley pack
 * will fix them: ALL 243 CLIPS ARE ONE-SHOTS. There is not a single looping
 * sound among them, and wind, surf and forest have to loop or they are not
 * ambience at all. That layer needs a nature pack and cannot be faked by
 * repeating a one-shot - the seam is audible immediately.
 *
 * The other three are things no percussive library contains.
 *
 *   ambientWind    camera altitude          LOOP
 *   ambientSea     camera near shore        LOOP
 *   ambientForest  flora under the camera   LOOP
 *   horn           raid-declared            (heavy metal impact stands in)
 *   fire           the fireball's aftermath
 *   creatureCall   the beast still has no voice at all
 *
 * Everything else the island wanted is now wired: the bell arrived with the
 * impact pack, mining and collapse with it, and the cry is a soft heavy impact.
 */
export const MISSING = [
  'ambientWind', 'ambientSea', 'ambientForest', 'horn', 'fire', 'creatureCall'
];

/** localStorage key for the volume and mute settings. */
export const STORE_KEY = 'divinity.sound.v1';
