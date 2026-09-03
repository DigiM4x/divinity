// ---------------------------------------------------------------------------
// graveyard.js - where the dead go.
//
// This game has killed people since Phase 6 and never showed it. They starve,
// they are raided, the beast eats them, a throw ends badly - and the world
// forgets each one on the tick it happens. Phase 17 counts them per team and
// alignment tracks how cruel you have been, but neither leaves anything on the
// island you can walk past.
//
// A burial ground grows outside every town, one stone per soul. It is the only
// thing in the game you cannot spend, harvest, undo or build over, and that is
// the point: it is a record rather than a resource.
//
// THIS MODULE ONLY OBSERVES, the same bargain prayers.js and reckoning.js make.
// It kills nothing, changes no resource, and decides nothing about the
// simulation. It listens for one fact - somebody died, and where - and turns
// that into ground. If it stopped running the game would play identically.
//
// It imports no gameplay system. Its reads of the world go through `state` the
// way every system here reads the world: `town.townAt` to find whose dead these
// are, and `terrain.heightAt` to stand a stone up.
//
// BOUNDED, because this project's recurring bug is a list that only grows, and
// "one grave per death" is that bug written as a feature. Stones per plot are
// hard-capped; past the cap the toll keeps counting and the ground stops
// changing.
//
// Publishes state.graveyard.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { sizeToMax, groundAtOrigin, growInstances } from './lib/models.js';
import { GRAVEYARD } from './state.js';

export function initGraveyard(state) {
  const rand = mulberry32(((state.seed ?? 0) ^ 0x6b0e17) >>> 0);
  const terrain = state.terrain;
  const pieces = state.graveyardPieces;

  // The kit shares one palette atlas, exactly like the town and castle kits, so
  // it must draw with that texture or its UVs point into nothing.
  const material = new THREE.MeshStandardMaterial({
    map: state.models.kitTexture('graveyard-kit'),
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    color: 0xb4b4b4
  });

  /** piece name -> { mesh }. One InstancedMesh per kind of stone. */
  const meshes = new Map();

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _tiltAxis = new THREE.Vector3(1, 0, 0);
  const _tilt = new THREE.Quaternion();

  function meshFor(name, capacity) {
    let e = meshes.get(name);
    if (e) return e;
    const src = pieces?.get(name);
    if (!src) return null;
    // Normalised into a 1-unit box and stood on the ground, so a size in the
    // config means the same thing for a headstone and for a mausoleum.
    const geo = groundAtOrigin(sizeToMax(src.clone(), 1));
    const mesh = new THREE.InstancedMesh(geo, material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'graveyard_' + name;
    state.scene.add(mesh);
    e = { mesh };
    meshes.set(name, e);
    return e;
  }

  function put(name, x, z, size, yaw, tilt = 0, capacity = 32) {
    const e = meshFor(name, capacity);
    if (!e) return false;
    if (e.mesh.count >= e.mesh.instanceMatrix.count) {
      e.mesh = growInstances(e.mesh, state.scene);
    }
    _p.set(x, terrain.heightAt(x, z), z);
    _q.setFromAxisAngle(_up, yaw);
    if (tilt) {
      // A stone that has stood a while leans. Applied after the yaw so it tips
      // in a consistent direction rather than about the stone's own spin.
      _tilt.setFromAxisAngle(_tiltAxis, tilt);
      _q.multiply(_tilt);
    }
    _s.setScalar(size);
    _m.compose(_p, _q, _s);
    e.mesh.setMatrixAt(e.mesh.count++, _m);
    e.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  // --- one plot per town ----------------------------------------------------

  /**
   * A town's burial ground.
   *
   * `buried` is the true toll and rises forever; `stones` is what is actually
   * in the ground and stops at MAX_STONES. Keeping the two apart is what lets
   * the record stay honest without the scene growing without limit.
   */
  const plots = new Map();          // town.index -> plot

  function plotFor(town) {
    let p = plots.get(town.index);
    if (p) return p;
    p = {
      town,
      /** Sited lazily - a town with no dead has no graveyard. */
      at: null,
      siteTimer: 0,
      buried: 0,
      stones: 0,
      /** Where each stone stands, for spacing. Bounded by MAX_STONES. */
      spots: [],
      /** Landmark tags already raised, so each appears exactly once. */
      raised: new Set(),
      fenced: false
    };
    plots.set(town.index, p);
    return p;
  }

  /**
   * Find somewhere to bury people: flat enough, clear of the buildings, and
   * outside every keep. Returns null if nowhere will do, and the caller simply
   * tries again later - a town hemmed in on all sides has no plot yet, and the
   * dead are still counted.
   */
  function findSite(town) {
    const near = GRAVEYARD.SITE_RANGE[0];
    const far = GRAVEYARD.SITE_RANGE[1];
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2;
      const r = near + rand() * (far - near);
      const x = town.centre.x + Math.cos(a) * r;
      const z = town.centre.z + Math.sin(a) * r;

      if (terrain.heightAt(x, z) < 2.5) continue;             // not in the sea
      if (terrain.maxSlopeIn(x, z, GRAVEYARD.PLOT_RADIUS * 0.6)
          > GRAVEYARD.MAX_SLOPE) continue;

      let blocked = false;
      for (const b of state.town?.allBuildings ?? []) {
        if (Math.hypot(b.pos.x - x, b.pos.z - z) < GRAVEYARD.BUILD_CLEARANCE) {
          blocked = true; break;
        }
      }
      if (blocked) continue;
      for (const t of state.towns ?? []) {
        if (Math.hypot(t.centre.x - x, t.centre.z - z) < near) {
          blocked = true; break;
        }
      }
      if (blocked) continue;

      // Prefer flat, then prefer close.
      const score = -terrain.maxSlopeIn(x, z, 6) * 40 - r * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    return best;
  }

  /** The iron railing, raised once when the plot is first used. */
  function fence(p) {
    if (p.fenced || !p.at) return;
    p.fenced = true;
    const n = GRAVEYARD.FENCE_SEGMENTS;
    // One segment is a gate rather than a railing: a fully sealed ring reads as
    // a pen, not a churchyard.
    const gateAt = (rand() * n) | 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = p.at.x + Math.cos(a) * GRAVEYARD.PLOT_RADIUS;
      const z = p.at.z + Math.sin(a) * GRAVEYARD.PLOT_RADIUS;
      // Tangent to the ring, so the railing follows the perimeter.
      put(i === gateAt ? GRAVEYARD.FENCE_GATE : GRAVEYARD.FENCE_PIECE,
        x, z, GRAVEYARD.FENCE_SIZE, a + Math.PI / 2, 0, n * 2);
    }
  }

  /** Somewhere inside the plot where no other stone is already standing. */
  function freeSpot(p) {
    const inner = GRAVEYARD.PLOT_RADIUS - 2.2;
    for (let i = 0; i < GRAVEYARD.PLACE_TRIES; i++) {
      const a = rand() * Math.PI * 2;
      // sqrt keeps the scatter even instead of crowding the middle.
      const r = Math.sqrt(rand()) * inner;
      const x = p.at.x + Math.cos(a) * r;
      const z = p.at.z + Math.sin(a) * r;
      let clash = false;
      for (const sp of p.spots) {
        if (Math.hypot(sp.x - x, sp.z - z) < GRAVEYARD.MIN_SPACING) {
          clash = true; break;
        }
      }
      if (!clash) return { x, z };
    }
    return null;
  }

  /**
   * Bury one.
   *
   * `violent` picks a broken stone rather than a whole one - a raid and a quiet
   * death should not leave the same ground behind them.
   */
  function bury(p, violent) {
    p.buried++;
    if (!p.at) return;                    // no plot yet; the toll still counts
    fence(p);

    // The landmark ladder is checked against the TRUE toll rather than the
    // stone count, so a plot that has hit its cap still raises its monuments.
    for (const L of GRAVEYARD.LANDMARKS) {
      if (p.buried < L.at || p.raised.has(L.tag)) continue;
      p.raised.add(L.tag);
      const a = rand() * Math.PI * 2;
      const r = L.ring * GRAVEYARD.PLOT_RADIUS;
      put(L.piece, p.at.x + Math.cos(a) * r, p.at.z + Math.sin(a) * r,
        L.size, rand() * Math.PI * 2, 0, 8);
    }

    if (p.stones >= GRAVEYARD.MAX_STONES) return;      // the ground is full
    const spot = freeSpot(p);
    if (!spot) return;
    p.spots.push(spot);
    p.stones++;

    const table = violent ? GRAVEYARD.BROKEN : GRAVEYARD.STONES;
    const piece = table[(rand() * table.length) | 0];
    const lo = GRAVEYARD.STONE_SIZE[0];
    const hi = GRAVEYARD.STONE_SIZE[1];
    put(piece, spot.x, spot.z, lo + rand() * (hi - lo),
      rand() * Math.PI * 2, (rand() - 0.5) * 0.12, GRAVEYARD.MAX_STONES);
  }

  // --- the one fact this module listens for --------------------------------
  //
  // `villagers-killed` already carried everything needed: how many, where, and
  // what did it. No other system had to change for burial grounds to exist.

  const subs = [];
  subs.push(state.events.on('villagers-killed', (e) => {
    const town = state.town?.townAt?.(e?.pos?.x, e?.pos?.z);
    if (!town) return;
    const p = plotFor(town);
    // A raid, the beast or a fall leaves disturbed ground. Hunger does not.
    //
    // Tested against the causes the game ACTUALLY emits. The first version
    // excluded 'starved' and 'age' - and 'age' does not exist, while 'starved'
    // was never emitted at all, so every death read as violent and the whole
    // peaceful stone table was unreachable.
    const violent = !GRAVEYARD.PEACEFUL.includes(e?.cause);
    const n = Math.min(e?.count ?? 1, GRAVEYARD.MAX_STONES);
    for (let i = 0; i < n; i++) bury(p, violent);
  }));

  function simStep(dt) {
    // Site the plots that need one. Throttled, because a town ringed by its own
    // buildings can fail this every single time and there is no hurry - the
    // dead are counted either way, and the stones appear once there is
    // somewhere to put them.
    for (const p of plots.values()) {
      if (p.at || p.buried === 0) continue;
      p.siteTimer -= dt;
      if (p.siteTimer > 0) continue;
      p.siteTimer = GRAVEYARD.SITE_EVERY;
      const site = findSite(p.town);
      if (!site) continue;
      p.at = site;
      fence(p);
      // Everything that died before there was anywhere to put it goes in now.
      // `buried` is restored afterwards so the backlog is not counted twice.
      const owed = p.buried;
      const backlog = Math.min(owed, GRAVEYARD.MAX_STONES);
      p.buried = 0;
      for (let i = 0; i < backlog; i++) bury(p, false);
      p.buried = owed;
    }
  }

  const api = {
    enabled: true,
    /** The true toll for a town, whatever is actually in the ground. */
    buriedIn(town) { return plots.get(town?.index)?.buried ?? 0; },
    /** Every plot, for the debug panel. */
    get plots() {
      return [...plots.values()].map((p) => ({
        town: p.town.name,
        at: p.at ? { x: Math.round(p.at.x), z: Math.round(p.at.z) } : null,
        buried: p.buried,
        stones: p.stones,
        sited: !!p.at,
        landmarks: [...p.raised]
      }));
    },
    get totalBuried() {
      let n = 0;
      for (const p of plots.values()) n += p.buried;
      return n;
    },
    /** Instances standing across every plot, for the budget readout. */
    get drawn() {
      let n = 0;
      for (const e of meshes.values()) n += e.mesh.count;
      return n;
    },
    dispose() { for (const off of subs) off(); subs.length = 0; },
    simStep
  };

  state.graveyard = api;
  return api;
}
