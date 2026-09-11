// ---------------------------------------------------------------------------
// sound.js - the island's voice.
//
// Twenty thousand lines and seventeen phases without a single audio call. This
// is the first one.
//
// THIS MODULE ONLY OBSERVES, the same bargain prayers.js, reckoning.js and
// graveyard.js make. It changes no resource, moves nothing, and decides nothing
// about the simulation. It listens to the bus and reads the camera position,
// and that is the whole of its coupling. If it stopped running the game would
// play identically - it would simply be silent again.
//
// It imports no gameplay system.
//
// WEB AUDIO, not <audio> elements. A pooled AudioBufferSourceNode per voice,
// because a god game can produce forty simultaneous events and thirty audio
// elements will stutter.
//
// Publishes state.sound.
// ---------------------------------------------------------------------------
import * as CFG from './soundconfig.js';

// Vite resolves these at build time and fingerprints them into dist/, the same
// way the model kits are handled. `eager` with `?url` gives URLs only - nothing
// is fetched until something asks for it.
const CLIP_URLS = import.meta.glob('./lib/assets/audio/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default'
});

/** "./lib/assets/audio/powerUp1.ogg" -> "powerUp1" */
const nameOf = (path) => path.split('/').pop().replace(/\.ogg$/i, '');

export function initSound(state) {
  const urls = new Map(Object.entries(CLIP_URLS).map(([p, u]) => [nameOf(p), u]));

  /** name -> decoded AudioBuffer. Filled lazily, off the critical path. */
  const buffers = new Map();
  /** Names currently being fetched, so a burst does not fetch one clip twice. */
  const pending = new Set();

  let ctx = null;
  let masterGain = null;
  const busGain = {};

  // --- settings, remembered ------------------------------------------------
  let master = CFG.MASTER_DEFAULT;
  let muted = false;
  try {
    const saved = JSON.parse(localStorage.getItem(CFG.STORE_KEY) || '{}');
    if (typeof saved.master === 'number') master = saved.master;
    if (typeof saved.muted === 'boolean') muted = saved.muted;
  } catch {
    // A corrupt or unavailable store must never stop the game booting - the
    // same call achievements.js makes. Losing a volume setting is nothing.
  }
  function persist() {
    try {
      localStorage.setItem(CFG.STORE_KEY, JSON.stringify({ master, muted }));
    } catch { /* private browsing, quota, no storage - play on */ }
  }

  // --- the voice pool ------------------------------------------------------
  /** Live sources, oldest first. Bounded by CFG.MAX_VOICES. */
  const voices = [];
  /** entry key -> sim time it may next be played. */
  const cooldowns = new Map();

  const stats = { played: 0, stolen: 0, culled: 0, cooled: 0, decoded: 0, failed: 0 };

  /**
   * The autoplay gate.
   *
   * Browsers refuse to start an AudioContext without a user gesture, so the
   * context is created suspended and resumed on the first click. Until then
   * every call below is a no-op and THE GAME MUST BEHAVE COMPLETELY NORMALLY -
   * silence is the correct behaviour, not an error.
   */
  let unlocked = false;
  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    for (const [bus, gain] of Object.entries(CFG.BUSES)) {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(masterGain);
      busGain[bus] = g;
    }
    applyGain();
    return ctx;
  }

  function applyGain() {
    if (masterGain) masterGain.gain.value = muted ? 0 : master;
  }

  function unlock() {
    if (unlocked) return;
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
  }
  // Any of these counts as the gesture. Passive, and they remove themselves.
  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, unlock, { once: false, passive: true });
  }

  // --- clips ---------------------------------------------------------------
  async function load(name) {
    if (buffers.has(name) || pending.has(name)) return;
    const url = urls.get(name);
    if (!url) { stats.failed++; return; }
    pending.add(name);
    try {
      const res = await fetch(url);
      const raw = await res.arrayBuffer();
      const c = ensureContext();
      if (!c) return;
      buffers.set(name, await c.decodeAudioData(raw));
      stats.decoded++;
    } catch {
      stats.failed++;
    } finally {
      pending.delete(name);
    }
  }

  /** Fetch and decode everything the tables name. Never blocks the game. */
  function warm() {
    const wanted = new Set();
    for (const table of [CFG.UI_SOUNDS, CFG.WORLD_SOUNDS]) {
      for (const entry of Object.values(table)) {
        for (const n of [].concat(entry.clip)) wanted.add(n);
      }
    }
    for (const n of wanted) load(n);
    return wanted.size;
  }

  // --- playing -------------------------------------------------------------

  /** Steal the oldest voice so the newest thing that happened is always heard. */
  function freeVoice() {
    while (voices.length >= CFG.MAX_VOICES) {
      const v = voices.shift();
      try { v.stop(); } catch { /* already ended */ }
      stats.stolen++;
    }
  }

  function pick(entry) {
    const list = [].concat(entry.clip);
    // Not seeded: this is presentation, and identical audio on a replay is not
    // a property worth constraining. Every simulation RNG stays seeded.
    return list[(Math.random() * list.length) | 0];
  }

  /**
   * Play one entry from a table.
   *
   * `at` is an optional world position - given one, the sound is culled beyond
   * AUDIBLE_RANGE and attenuated inside it. CULLED BEFORE IT TAKES A VOICE,
   * rather than played at zero gain, or a battle across the map would still
   * consume the whole pool.
   */
  function play(table, key, at = null, gainScale = 1) {
    const entry = table[key];
    if (!entry || muted || !unlocked) return false;

    const now = state.time;
    const until = cooldowns.get(key) ?? -Infinity;
    if (now < until) { stats.cooled++; return false; }

    let dist = 1;
    if (at) {
      const cam = state.camera?.cam?.position;
      if (cam) {
        const d = Math.hypot(cam.x - at.x, cam.z - at.z);
        if (d > CFG.AUDIBLE_RANGE) { stats.culled++; return false; }
        dist = d <= CFG.FULL_VOLUME_RANGE ? 1
          : 1 - (d - CFG.FULL_VOLUME_RANGE) / (CFG.AUDIBLE_RANGE - CFG.FULL_VOLUME_RANGE);
      }
    }

    const name = pick(entry);
    const buf = buffers.get(name);
    // Not yet decoded: start it and drop this one. Silence now beats a sound
    // arriving a second after the thing that caused it.
    if (!buf) { load(name); return false; }

    const c = ensureContext();
    if (!c) return false;
    freeVoice();

    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = (entry.gain ?? 1) * gainScale * dist;
    src.connect(g);
    g.connect(busGain[table === CFG.UI_SOUNDS ? 'interface' : 'world']);
    src.onended = () => {
      const i = voices.indexOf(src);
      if (i >= 0) voices.splice(i, 1);
    };
    src.start();
    voices.push(src);
    cooldowns.set(key, now + (entry.cool ?? 0));
    stats.played++;
    return true;
  }

  const ui = (key) => play(CFG.UI_SOUNDS, key);
  const world = (key, at, scale) => play(CFG.WORLD_SOUNDS, key, at, scale);

  // --- what it listens for -------------------------------------------------
  //
  // Every one of these was already on the bus. Seventeen phases of announcing
  // facts rather than calling each other built this list for free.

  const ev = state.events;
  const subs = [];
  const on = (type, fn) => subs.push(ev.on(type, fn));

  // The island is mostly made of this one. Ten woodcutters in a wood IS the
  // ambience, which is why its gain is low and its cooldown short.
  on('villager-worked', (e) => {
    const key = e?.job === 'ore' ? 'mine' : e?.job === 'food' ? 'harvest' : 'chop';
    world(key, e?.pos);
  });

  on('building-placed', (e) => world('build', e?.pos));
  on('building-destroyed', (e) => world('collapse', e?.pos));
  on('building-upgraded', (e) => world('upgrade', e?.pos));

  on('unit-trained', (e) => world(e?.kind === 'soldier' ? 'muster' : 'build', e?.pos));
  on('unit-lost', (e) => world('death', e?.pos));

  // Scaled by how many died at once rather than played once per body - an
  // event arriving with `count: 20` from one lightning bolt is ONE sound,
  // louder, not twenty voices.
  on('villagers-killed', (e) => {
    const n = e?.count ?? 1;
    world('death', e?.pos, Math.min(1.6, 1 + (n - 1) * 0.12));
  });

  on('villagers-fed', (e) => world('deposit', e?.pos));
  on('prop-thrown', (e) => world('putDown', e?.pos));
  on('resource-offered', (e) => world('deposit', e?.pos));

  on('achievement-earned', () => ui('achievement'));
  // Only the player's own god gets a fanfare. A rival blessing its beast across
  // the island is news, but it is the HUD's news, not a sound in your ear.
  on('creature-blessed', (e) => {
    if (e?.isHuman) ui(e.tier === 'FURY' ? 'blessBig' : 'bless');
  });
  on('score-milestone', () => ui('milestone'));

  on('prayer-raised', (e) => play(CFG.UI_SOUNDS, 'prayerRaised', e?.pos));
  on('prayer-resolved', (e) => {
    if (e?.status === 'answered' && e.by !== 'nobody' && e.by !== 'none') {
      ui('prayerAnswered');
    } else if (e?.status === 'expired' || e?.status === 'failed') {
      ui('prayerLost');
    }
  });

  on('miracle-cast', (e) => {
    const key = {
      lightning: 'miracleLightning', fireball: 'miracleFireball',
      water: 'miracleWater', food: 'miracleFood'
    }[e?.def?.key];
    if (key) world(key, e?.pos);
  });

  on('town-captured', (e) => world('townTaken', e?.town?.centre));
  on('raid-declared', (e) => world('raid', e?.to?.centre));

  on('game-over', (e) => ui(e?.kind === 'victory' ? 'victory' : 'defeat'));

  // --- api -----------------------------------------------------------------

  const api = {
    enabled: true,
    /** Interface feedback, called directly by ui.js for panels and refusals. */
    ui,
    /** A positional world sound. */
    world,
    get unlocked() { return unlocked; },
    get muted() { return muted; },
    get master() { return master; },
    setMaster(v) {
      master = Math.max(0, Math.min(1, v));
      applyGain();
      persist();
    },
    toggleMute() {
      muted = !muted;
      applyGain();
      persist();
      return muted;
    },
    /** For the debug panel: the two questions this feature gets debugged with. */
    get stats() {
      return {
        ...stats,
        voices: voices.length,
        cap: CFG.MAX_VOICES,
        clips: buffers.size,
        unlocked,
        muted,
        /** Declared but with no clip in this pack that could honestly play it. */
        unwired: CFG.MISSING.length
      };
    },
    warm,
    dispose() {
      for (const off of subs) off();
      subs.length = 0;
      for (const v of voices) { try { v.stop(); } catch { /* ended */ } }
      voices.length = 0;
    }
  };

  state.sound = api;
  // Decoding starts now and never blocks: the game is playable before it ends,
  // and a clip that has not arrived yet simply does not play the first time.
  warm();
  return api;
}
