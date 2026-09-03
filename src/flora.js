// ---------------------------------------------------------------------------
// flora.js - the ground cover: grass, flowers, mushrooms, stumps, fallen logs.
//
// This is decoration and nothing else. Flora has no physics, cannot be picked
// up, harvested, burned or walked into, and is never simulated. It is written
// once at startup and never touched again.
//
// That is the whole reason it can be thousands of objects where props are
// hundreds: props are the things the game reasons about, and every one of them
// costs a slot in a physics list and a claim registry. Flora costs one instance
// matrix, uploaded once.
//
// Publishes state.flora.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { sizeToHeight, growInstances } from './lib/models.js';
import { FLORA, WORLD } from './state.js';

export function initFlora(state) {
  const rand = mulberry32(state.seed ^ 0x9e37);
  const terrain = state.terrain;
  const pieces = state.naturePieces;
  const group = [];

  // Dimmed to match the props, or the ground cover glows against the trees.
  const material = state.models.makeMaterial({
    map: null, vertexColors: true, color: 0xb9b9b9, roughness: 0.92, metalness: 0
  });

  // Weighted pick, resolved once into a lookup table rather than walked per
  // placement - there are a few thousand placements and thirteen pieces.
  const bag = [];
  FLORA.PIECES.forEach((p, i) => {
    for (let w = 0; w < p.weight; w++) bag.push(i);
  });

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  /**
   * Everything a building would stand on is off limits, so streets and yards
   * stay clear. Checked against every town, because a rival's square should be
   * as tidy as yours.
   */
  function builtOver(x, z) {
    const all = state.town?.allBuildings;
    if (!all) return false;
    for (const b of all) {
      const r = b.def.pad * 0.9 + FLORA.CLEARANCE;
      const dx = b.pos.x - x;
      const dz = b.pos.z - z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  // --- build one instanced mesh per piece -----------------------------------
  const meshes = FLORA.PIECES.map((piece) => {
    const src = pieces?.get(piece.name);
    if (!src) { console.warn(`[flora] no nature piece "${piece.name}"`); return null; }
    const mid = (piece.height[0] + piece.height[1]) / 2;
    const geo = sizeToHeight(src.clone(), mid);
    // Start at this piece's EXPECTED share and grow if the dice disagree.
    //
    // It used to allocate 2.2x the share up front, because the weighted draw is
    // random and any piece can come up more often than its due. That headroom
    // was real but it was also permanent: measured across the whole scene, 83%
    // of every instance slot in the game was empty. Growing costs one
    // reallocation on the rare piece that overshoots, and nothing on the rest.
    const capacity = Math.ceil(FLORA.COUNT * (piece.weight / bag.length)) + 8;
    const mesh = new THREE.InstancedMesh(geo, material, capacity);
    mesh.count = 0;
    mesh.castShadow = false;      // thousands of tiny shadow casters buys nothing
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `flora_${piece.name}`;
    state.scene.add(mesh);
    return { piece, mesh, mid, capacity };
  });

  // --- scatter --------------------------------------------------------------
  let placed = 0;
  const tries = FLORA.COUNT * 12;
  const R = WORLD.HALF * 0.92;
  for (let t = 0; t < tries && placed < FLORA.COUNT; t++) {
    const x = (rand() * 2 - 1) * R;
    const z = (rand() * 2 - 1) * R;
    const h = terrain.heightAt(x, z);
    if (h < FLORA.MIN_H || h > FLORA.MAX_H) continue;
    if (terrain.maxSlopeIn(x, z, 1.6) > FLORA.MAX_SLOPE) continue;
    if (builtOver(x, z)) continue;

    const entry = meshes[bag[(rand() * bag.length) | 0]];
    if (!entry) continue;
    if (entry.mesh.count >= entry.mesh.instanceMatrix.count) {
      entry.mesh = growInstances(entry.mesh, state.scene);
    }

    const { piece, mesh, mid } = entry;
    const want = piece.height[0] + rand() * (piece.height[1] - piece.height[0]);
    _p.set(x, terrain.heightAt(x, z), z);
    _q.setFromAxisAngle(_up, rand() * Math.PI * 2);
    _s.setScalar(want / mid);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(mesh.count++, _m);
    placed++;
  }

  for (const e of meshes) {
    if (!e) continue;
    e.mesh.instanceMatrix.needsUpdate = true;
    group.push(e.mesh);
  }

  const api = {
    /** Total decorative objects on the island. */
    count: placed,
    meshes: group,
    /**
     * Clear anything standing where a building has just gone up.
     *
     * Flora is never simulated, so this is the one thing that can change it.
     * Instances are compacted rather than hidden: a hidden instance still costs
     * a matrix upload and a draw, and this runs once per building placed.
     */
    clearAround(x, z, radius) {
      const r2 = radius * radius;
      for (const e of meshes) {
        if (!e) continue;
        const mesh = e.mesh;
        let w = 0;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, _m);
          const px = _m.elements[12];
          const pz = _m.elements[14];
          if ((px - x) ** 2 + (pz - z) ** 2 < r2) continue;
          if (w !== i) mesh.setMatrixAt(w, _m);
          w++;
        }
        if (w !== mesh.count) {
          mesh.count = w;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  };
  state.flora = api;
  return api;
}
