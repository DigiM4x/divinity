// ---------------------------------------------------------------------------
// scenery.js - the set-dressing: cliff faces, crops, statues, beach clutter.
//
// Flora is the small stuff underfoot. Scenery is everything larger that the
// game still does not reason about: it has no physics, cannot be picked up or
// harvested, and is never simulated. Like flora, that is exactly why it can be
// numerous - one instance matrix each, uploaded once.
//
// Two placement moments, and the difference matters:
//
//   * The LANDSCAPE (cliffs, landmarks, shore) is placed at startup, because
//     the island exists at startup and never changes shape.
//   * The TOWN DRESSING is placed per building as it goes up, because most of
//     a town does not exist yet when the island is generated. town.js calls
//     `dressBuilding` the same way it already calls `flora.clearAround` - via
//     state, with no import between the two systems.
//
// Publishes state.scenery.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { sizeToMax, groundAtOrigin, growInstances } from './lib/models.js';
import { SCENERY, WORLD } from './state.js';

export function initScenery(state) {
  const rand = mulberry32(state.seed ^ 0x5c3e1);
  const terrain = state.terrain;

  // Two materials, because the kits are authored differently and mixing them up
  // is what produced rainbow-dithered trees the first time round. The nature
  // kit is untextured and carries its colour in vertex data; the town and
  // castle kits share a palette atlas and MUST draw with it or their UVs point
  // into a texture that is not there.
  const natureMaterial = state.models.makeMaterial({
    map: null, vertexColors: true, color: 0xb9b9b9, roughness: 0.94, metalness: 0
  });
  const townMaterial = new THREE.MeshStandardMaterial({
    map: state.models.townTexture,
    vertexColors: true, roughness: 0.9, metalness: 0, color: 0xc4c4c4
  });
  const castleMaterial = new THREE.MeshStandardMaterial({
    map: state.models.kitTexture('castle-kit'),
    vertexColors: true, roughness: 0.9, metalness: 0, color: 0xc4c4c4
  });

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  /**
   * One instanced mesh per piece, created on demand.
   *
   * On demand rather than from a fixed list because the same piece is wanted by
   * several tables - `log` is both beach driftwood and lumber-camp dressing -
   * and a piece asked for twice should still be one draw call.
   */
  const meshes = new Map();
  /**
   * Every piece is normalised on its LARGEST axis, without exception.
   *
   * Scaling is uniform, so whichever dimension you pin, the other two follow
   * the model's own ratio. This project has now been caught out twice by that:
   * sizing a flat plate by its height gives a paving slab wider than a house,
   * and sizing a tall column by its width gives a tower. Scenery draws from a
   * kit containing plates, columns, cubes and long thin logs all at once, so
   * the only safe rule is one that guarantees the result fits inside a box of
   * the requested size whatever shape went in.
   */
  const SOURCES = {
    nature: () => [state.naturePieces, natureMaterial],
    town: () => [state.townPieces, townMaterial],
    castle: () => [state.castlePieces, castleMaterial]
  };

  function meshFor(name, capacity, source = 'nature') {
    const key = `${source}:${name}`;
    let e = meshes.get(key);
    if (e !== undefined) return e;
    const [registry, mat] = SOURCES[source]();
    const src = registry?.get(name);
    if (!src) {
      console.warn(`[scenery] no ${source} piece "${name}"`);
      meshes.set(key, null);
      return null;
    }
    // Ground-at-origin, not centred: everything here is set ON the terrain, and
    // a centred origin buries half of every statue.
    const geo = groundAtOrigin(sizeToMax(src.clone(), 1));
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `scenery_${name}`;
    state.scene.add(mesh);
    e = { mesh, capacity };
    meshes.set(key, e);
    return e;
  }

  /** Place one instance. Returns false when the piece is missing or full. */
  function place(name, x, y, z, size, yaw, capacity, source = 'nature') {
    const e = meshFor(name, capacity, source);
    if (!e) return false;
    // Grow rather than refuse. `capacity` is now an opening guess, not a limit,
    // so the tables can be honest about how many of a piece they expect instead
    // of inflating every number against the worst case.
    if (e.mesh.count >= e.mesh.instanceMatrix.count) {
      e.mesh = growInstances(e.mesh, state.scene);
    }
    _p.set(x, y, z);
    _q.setFromAxisAngle(_up, yaw);
    _s.setScalar(size);            // normalised to fit a 1-unit box
    _m.compose(_p, _q, _s);
    e.mesh.setMatrixAt(e.mesh.count++, _m);
    return true;
  }

  /**
   * Which way is downhill, as a yaw.
   *
   * This is the whole trick behind the cliffs. A cliff block has a face, and an
   * outcrop whose face points INTO the hill is invisible from every angle you
   * would ever look at it from. Sampled over a wide baseline rather than a
   * tight one so it follows the terrace riser and not the fine noise on top.
   */
  function downhillYaw(x, z) {
    const e = 2.5;
    const gx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
    const gz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
    return Math.atan2(-gx, -gz) + SCENERY.CLIFFS.FACE_YAW;
  }

  function nearTown(x, z, r) {
    for (const t of state.towns || []) {
      const dx = t.centre.x - x, dz = t.centre.z - z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  let placed = 0;

  // --- cliffs ---------------------------------------------------------------
  //
  // The payoff of terracing. The island is now cut into steps, and until now
  // the riser between two steps was just a steeper patch of grass.
  {
    const C = SCENERY.CLIFFS;
    const R = WORLD.HALF * 0.94;
    // Capacity is shared across a band's pieces with headroom, since which
    // piece a given spot takes is a dice roll.
    const perPiece = Math.ceil(C.COUNT / C.BANDS.length / 3) + 8;
    for (let t = 0; t < C.COUNT * 14 && placed < C.COUNT; t++) {
      const x = (rand() * 2 - 1) * R;
      const z = (rand() * 2 - 1) * R;
      const h = terrain.heightAt(x, z);
      if (h < C.MIN_H) continue;
      if (terrain.maxSlopeIn(x, z, 2.2) < C.MIN_SLOPE) continue;

      const band = C.BANDS.find((b) => h <= b.to) || C.BANDS[C.BANDS.length - 1];
      const name = band.pieces[(rand() * band.pieces.length) | 0];
      const size = C.SIZE[0] + rand() * (C.SIZE[1] - C.SIZE[0]);
      // Sunk in, because a box set on a curved heightfield shows daylight under
      // one corner otherwise.
      if (place(name, x, h - size * C.SINK, z, size, downhillYaw(x, z), perPiece)) {
        placed++;
      }
    }
  }
  const cliffCount = placed;

  // --- landmarks ------------------------------------------------------------
  {
    const L = SCENERY.LANDMARKS;
    const R = WORLD.HALF * 0.8;
    let n = 0;
    for (let t = 0; t < L.COUNT * 400 && n < L.COUNT; t++) {
      const x = (rand() * 2 - 1) * R;
      const z = (rand() * 2 - 1) * R;
      const h = terrain.heightAt(x, z);
      if (h < L.MIN_H) continue;
      if (terrain.maxSlopeIn(x, z, 3.0) > L.MAX_SLOPE) continue;
      if (nearTown(x, z, L.TOWN_CLEARANCE)) continue;
      const p = L.PIECES[(rand() * L.PIECES.length) | 0];
      const height = p.height[0] + rand() * (p.height[1] - p.height[0]);
      if (place(p.name, x, h - 0.3, z, height, rand() * Math.PI * 2, L.COUNT)) { n++; placed++; }
    }
  }

  // --- shore ----------------------------------------------------------------
  {
    const S = SCENERY.SHORE;
    const bag = [];
    S.PIECES.forEach((p, i) => { for (let w = 0; w < p.weight; w++) bag.push(i); });
    const R = WORLD.HALF * 0.96;
    let n = 0;
    for (let t = 0; t < S.COUNT * 300 && n < S.COUNT; t++) {
      const x = (rand() * 2 - 1) * R;
      const z = (rand() * 2 - 1) * R;
      const h = terrain.heightAt(x, z);
      if (h < S.H[0] || h > S.H[1]) continue;
      if (terrain.maxSlopeIn(x, z, 1.8) > S.MAX_SLOPE) continue;
      const p = S.PIECES[bag[(rand() * bag.length) | 0]];
      const height = p.height[0] + rand() * (p.height[1] - p.height[0]);
      if (place(p.name, x, h - 0.15, z, height, rand() * Math.PI * 2, S.COUNT)) { n++; placed++; }
    }
  }

  // --- the town square ------------------------------------------------------
  //
  // Street furniture from the fantasy town and castle kits, laid in a ring
  // around every settlement's centre - the player's and the rivals' alike,
  // because a rival capital you are about to besiege should look like a place
  // worth taking.
  //
  // A ring rather than a scatter: the middle of a town is where buildings go,
  // and dressing dropped there is dressing that gets cleared again five minutes
  // later. The ring is the edge of the square, where the lanterns and market
  // stalls belong anyway.
  {
    const Q = SCENERY.SQUARE;
    for (const town of state.towns || []) {
      for (const [source, table] of [['town', Q.TOWN], ['castle', Q.CASTLE]]) {
        for (const item of table) {
          for (let i = 0; i < item.count; i++) {
            // Several tries, because a ring drawn round a hilltop capital can
            // land most of its length on ground too steep to stand anything on.
            for (let attempt = 0; attempt < 12; attempt++) {
              const a = rand() * Math.PI * 2;
              const r = Q.RING[0] + rand() * (Q.RING[1] - Q.RING[0]);
              const x = town.centre.x + Math.cos(a) * r + (rand() * 2 - 1) * Q.JITTER;
              const z = town.centre.z + Math.sin(a) * r + (rand() * 2 - 1) * Q.JITTER;
              const h = terrain.heightAt(x, z);
              if (h < 1.5) continue;
              if (terrain.maxSlopeIn(x, z, 2.0) > Q.MAX_SLOPE) continue;
              const size = item.size[0] + rand() * (item.size[1] - item.size[0]);
              // Facing the centre: a market stall with its back to the square
              // is the giveaway that nobody placed it on purpose.
              const yaw = a + Math.PI;
              const cap = item.count * (state.towns.length + 2);
              if (place(item.name, x, h - 0.1, z, size, yaw, cap, source)) { placed++; break; }
            }
          }
        }
      }
    }
  }

  for (const e of meshes.values()) if (e) e.mesh.instanceMatrix.needsUpdate = true;

  const api = {
    count: placed,
    cliffs: cliffCount,
    get meshes() { return [...meshes.values()].filter(Boolean).map((e) => e.mesh); },

    /**
     * Dress a building that has just gone up.
     *
     * Called by town.js for every building, player's and rivals' alike. The
     * table is keyed by building id with a fallback, so a new building type
     * gets generic dressing rather than nothing - and gets its own the moment
     * someone adds a row.
     */
    dressBuilding(b) {
      // `key`, not `id`. BUILDINGS entries carry `key`; there is no `id` field,
      // so looking one up silently returned undefined and every building in the
      // game - farm, cattle pen, lumber camp - got the generic dressing.
      const key = b?.def?.key;
      const d = SCENERY.DRESSING[key] || SCENERY.DRESSING.default;
      // Generous shared capacity: dressing accumulates for the whole game, over
      // every town, and an overflowing InstancedMesh is a silent GL error.
      const capacity = 24;
      const pad = b.def.pad || 4;
      for (let i = 0; i < d.count; i++) {
        // Ringed around the building rather than scattered over it, so the
        // doorway stays clear and the crop rows read as belonging to the farm.
        const a = rand() * Math.PI * 2;
        const r = pad * 0.55 + d.ring[0] + rand() * (d.ring[1] - d.ring[0]);
        const x = b.pos.x + Math.cos(a) * r;
        const z = b.pos.z + Math.sin(a) * r;
        const h = terrain.heightAt(x, z);
        if (h < 1.2) continue;                                  // not into the sea
        if (terrain.maxSlopeIn(x, z, 1.4) > 0.42) continue;     // not up a cliff
        const name = d.pieces[(rand() * d.pieces.length) | 0];
        const height = d.height[0] + rand() * (d.height[1] - d.height[0]);
        // Facing the building it belongs to: a fence panel side-on to its own
        // farm is the one thing that gives away random placement.
        const yaw = a + Math.PI;
        if (place(name, x, h - 0.1, z, height, yaw, capacity)) api.count++;
      }
      for (const e of meshes.values()) if (e) e.mesh.instanceMatrix.needsUpdate = true;
    },

    /**
     * Clear scenery where something is being built. Compacted rather than
     * hidden - a hidden instance still costs a matrix upload and a draw.
     */
    clearAround(x, z, radius) {
      const r2 = radius * radius;
      for (const e of meshes.values()) {
        if (!e) continue;
        const mesh = e.mesh;
        let w = 0;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, _m);
          if ((_m.elements[12] - x) ** 2 + (_m.elements[14] - z) ** 2 < r2) continue;
          if (w !== i) mesh.setMatrixAt(w, _m);
          w++;
        }
        if (w !== mesh.count) { mesh.count = w; mesh.instanceMatrix.needsUpdate = true; }
      }
    }
  };
  state.scenery = api;

  // Back-dress what is already standing. The rivals open with a few buildings
  // so they are a going concern from the first tick, and those went up before
  // this system existed. Everything placed from here on is dressed as it is
  // built, by town.js.
  for (const b of state.town?.allBuildings || []) {
    api.clearAround(b.pos.x, b.pos.z, (b.def.pad || 4) * 0.9 + 2.0);
    api.dressBuilding(b);
  }

  return api;
}
