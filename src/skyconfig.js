// ---------------------------------------------------------------------------
// skyconfig.js - the sky's colours, timings and consequences.
//
// Pure data, imports nothing, exactly like scoreconfig.js and soundconfig.js.
// No unexplained number in sky.js.
// ---------------------------------------------------------------------------

/**
 * One full day, in simulated seconds.
 *
 * Seven minutes. Down from nine, which watched slower than it read on paper:
 * long stretches sat at the same light, and a twenty-five minute match only
 * ever saw a couple of nights. This gives it three and a half.
 *
 * The floor is somewhere near four minutes, where the sun starts visibly
 * stepping rather than moving; the ceiling is wherever most matches stop seeing
 * the dark at all, which is the same as not having built it.
 */
export const DAY_SECONDS = 420;

/** The hour a new game opens on. Mid-morning: bright, and clearly climbing. */
export const START_HOUR = 8.5;

/**
 * KEYFRAMES around the clock. Everything between two of these is interpolated.
 *
 * `sun`       colour and intensity of the single directional light
 * `hemiSky` / `hemiGround` / `hemi`   the bounce that stops shaded hillsides
 *            crushing to black under ACES - see main.js
 * `ambient`  flat fill
 * `fog`      MUST equal `mid` below, or a hard seam appears along the horizon
 *            where the ocean stops and the sky starts
 * `top` / `mid` / `bottom`   the sky shader's three existing stops
 * `elevation` how high the sun rides, 0 = horizon, 1 = overhead
 *
 * NIGHT IS BLUE, NOT BLACK, and that is the whole design risk of this phase. A
 * god game you cannot see is not atmospheric, it is broken. The night keys keep
 * a real key light and a lifted hemisphere so the land reads clearly and only
 * the mood changes. If a playtest has anyone squinting, these numbers are wrong
 * - not the player's monitor.
 */
export const KEYS = [
  {
    hour: 0, name: 'night',
    sun: 0x8fa6d8, sunI: 0.55, elevation: 0.42,
    hemiSky: 0x35507e, hemiGround: 0x2a2c38, hemi: 1.15, ambient: 0.30,
    top: 0x111c38, mid: 0x2c3c5e, bottom: 0x2c3c5e, fog: 0x2c3c5e
  },
  {
    hour: 5.2, name: 'dawn',
    sun: 0xffb27a, sunI: 1.35, elevation: 0.20,
    hemiSky: 0x8fa2c8, hemiGround: 0x6b5a48, hemi: 1.45, ambient: 0.30,
    top: 0x3a5a92, mid: 0xe0a882, bottom: 0xe0a882, fog: 0xe0a882
  },
  {
    hour: 8, name: 'morning',
    sun: 0xfff0d8, sunI: 2.15, elevation: 0.68,
    hemiSky: 0xb2cdec, hemiGround: 0x7d7052, hemi: 1.70, ambient: 0.30,
    top: 0x3d7ec4, mid: 0xa9c6de, bottom: 0xa9c6de, fog: 0xa9c6de
  },
  {
    // Noon is the game exactly as it has looked since Phase 1. Everything else
    // is a departure from this, and it is the one that must not change.
    hour: 12, name: 'noon',
    sun: 0xfff2dc, sunI: 2.35, elevation: 0.95,
    hemiSky: 0xbcd7f2, hemiGround: 0x7d7052, hemi: 1.75, ambient: 0.30,
    top: 0x3d7ec4, mid: 0xa9c6de, bottom: 0xa9c6de, fog: 0xa9c6de
  },
  {
    hour: 16.5, name: 'afternoon',
    sun: 0xffe4bc, sunI: 2.10, elevation: 0.62,
    hemiSky: 0xb8cfe8, hemiGround: 0x846f4e, hemi: 1.65, ambient: 0.30,
    top: 0x4a80bd, mid: 0xbdc9d4, bottom: 0xbdc9d4, fog: 0xbdc9d4
  },
  {
    hour: 19.4, name: 'dusk',
    sun: 0xff8f5e, sunI: 1.30, elevation: 0.19,
    hemiSky: 0x8a86b0, hemiGround: 0x5c4a40, hemi: 1.40, ambient: 0.30,
    top: 0x2f4a86, mid: 0xd98a6a, bottom: 0xd98a6a, fog: 0xd98a6a
  },
  {
    hour: 21.6, name: 'night',
    sun: 0x8fa6d8, sunI: 0.55, elevation: 0.42,
    hemiSky: 0x35507e, hemiGround: 0x2a2c38, hemi: 1.15, ambient: 0.30,
    top: 0x111c38, mid: 0x2c3c5e, bottom: 0x2c3c5e, fog: 0x2c3c5e
  }
];

/** Hours counted as night, for anything that wants to ask. */
export const NIGHT_FROM = 20.6;
export const NIGHT_TO = 5.6;

/**
 * Hours either side of night over which `nightness` ramps.
 *
 * Lanterns come up over roughly the last of dusk rather than all at once - a
 * village that lights every lamp on the same frame reads as a switch being
 * thrown, not as evening falling.
 */
export const NIGHT_RAMP = 1.1;

/**
 * The sun's compass bearing over the day, in radians.
 *
 * It sweeps rather than standing still, so shadows rotate as well as lengthen -
 * which is most of what makes a moving sun read as a moving sun.
 */
export const AZIMUTH_AT_DAWN = -1.1;
export const AZIMUTH_AT_DUSK = 1.9;

/**
 * The shadow frustum has to grow as the sun drops.
 *
 * `sun.shadow.camera` is fitted tightly to the island in main.js, which is
 * correct for a fixed high sun and wrong the moment it moves: a low sun throws
 * shadows several times longer than the thing casting them, and a tight frustum
 * clips them mid-hillside. Scaled by elevation, so noon keeps the crisp
 * shadows it has always had and dusk gets the room it needs.
 */
export const SHADOW_SPAN = [1.15, 2.4];   // at elevation 1 .. 0

// --- weather ----------------------------------------------------------------

/**
 * FOUR STATES, and only two of them have teeth.
 *
 * Weather that changes everything is weather nobody can plan around. Rain and
 * drought each reach exactly one existing number - `TOWN.CROP_REGROW`, through
 * a multiplier the town reads - and that is the whole mechanical footprint.
 *
 * `crop` multiplies crop regrowth. `weight` is how often it is rolled.
 * `light` dims the sun and lifts the fog, on top of whatever the hour says.
 */
export const WEATHER = {
  clear: {
    label: 'Clear', weight: 46, crop: 1.0,
    sunScale: 1.0, fogScale: 1.0, desat: 0.0
  },
  overcast: {
    label: 'Overcast', weight: 26, crop: 1.0,
    sunScale: 0.72, fogScale: 1.35, desat: 0.35
  },
  rain: {
    // Relief. The first time a drought breaks, this should feel like something.
    label: 'Rain', weight: 18, crop: 1.6,
    sunScale: 0.52, fogScale: 1.9, desat: 0.5
  },
  drought: {
    /**
     * A SLOW FAMINE YOU CAN SEE COMING, which is a far better problem than a
     * famine that simply happens. Crops crawl, the granaries fall, and the food
     * miracle gets a moment where it genuinely matters.
     */
    label: 'Drought', weight: 10, crop: 0.35,
    sunScale: 1.12, fogScale: 0.75, desat: 0.28
  }
};

/** Seconds one weather lasts, before another is rolled. */
export const WEATHER_SECONDS = [110, 260];

/** Seconds to cross-fade from one weather to the next. Never a hard cut. */
export const WEATHER_BLEND = 14;

/**
 * A new game always opens clear.
 *
 * Rolling a drought at second zero would start a match already failing, before
 * the player has done anything at all.
 */
export const OPENING_WEATHER = 'clear';
export const OPENING_GRACE = 90;

// --- rain ------------------------------------------------------------------

/**
 * Rain is a fixed pool of drops in a box that follows the camera, recycled as
 * they fall out of the bottom. Bounded by construction: this number IS the
 * instance count, always, whatever the weather is doing.
 */
export const RAIN_DROPS = 900;
export const RAIN_BOX = [150, 90, 150];   // width, height, depth around the camera
export const RAIN_SPEED = [70, 105];
export const RAIN_COLOR = 0x9fb6d4;

/** Seconds for rain to fade fully in or out with the weather blend. */
export const RAIN_FADE = 6;
