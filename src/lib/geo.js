// ---------------------------------------------------------------------------
// Tiny procedural-geometry helpers. Everything the game renders is built from
// three.js primitives welded together here - no model files anywhere.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

/** Ensure a geometry carries a per-vertex colour attribute. */
export function applyVertexColor(geo, hex, jitter = 0, rand = Math.random) {
  const c = new THREE.Color(hex); // r160 converts sRGB hex -> linear working space
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = jitter ? 1 + (rand() - 0.5) * jitter : 1;
    arr[i * 3] = c.r * k;
    arr[i * 3 + 1] = c.g * k;
    arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Concatenate geometries into one non-indexed buffer.
 * All inputs must already have position, normal and color.
 */
export function mergeGeos(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);

  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** Shift a geometry so its bounding box is centred vertically on the origin. */
export function centerVertically(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
