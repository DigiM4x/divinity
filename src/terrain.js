// ---------------------------------------------------------------------------
// terrain.js - procedural island, vertex-coloured ground, animated water.
//
// Publishes state.terrain:
//   mesh, water        three objects
//   heightAt(x,z)      bilinear sampled ground height
//   normalAt(x,z, out) analytic heightfield normal
//   slopeAt(x,z)       0 (flat) .. 1 (vertical)
//   deform(x,z,r,amt)  push the ground down/up in a soft circle
//   inBounds(x,z)      inside the playable island disc
//   regenerate(seed)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createNoise2D, fbm, ridged, clamp, smoothstep, lerp, mulberry32} from './lib/noise.js';
import { makeGrainTexture } from './lib/textures.js';
import { WORLD, TERRACE, WATER, ISLANDS} from './state.js';

const SIZE = WORLD.SIZE;
const HALF = WORLD.HALF;
const CELL = WORLD.CELL;

// Palette. Authored in sRGB because that is how eyes read it, converted to
// linear below since vertex colours are consumed linearly by the renderer.
// The ground is painted in the nature kit's own palette, in sRGB, because the
// terrain used to be olive-and-slate under teal-and-orange trees and the two
// simply did not belong to the same island. These are the kit's `grass`,
// `dirt` and `stone` colours, desaturated a little: the ground is the largest
// surface on screen, and at full saturation it shouts over everything standing
// on it.
const C_SAND_WET = [0.72, 0.56, 0.42];
const C_SAND = [0.91, 0.79, 0.63];
const C_GRASS = [0.24, 0.66, 0.55];
const C_GRASS_DRY = [0.45, 0.72, 0.60];
const C_ROCK = [0.66, 0.80, 0.83];
const C_ROCK_DARK = [0.42, 0.53, 0.58];
const C_SEABED = [0.44, 0.42, 0.34];

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function mix3(a, b, t, out) {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
}

// ---------------------------------------------------------------------------
// Heightmap
// ---------------------------------------------------------------------------
/**
 * Resolve a seed into a concrete island shape.
 *
 * Archetypes are ranges, not values, so this picks the archetype AND a point
 * inside every one of its ranges. Two Highlands are both recognisably highlands
 * and are not the same island.
 */
function pickShape(seed, forceName = null) {
  const rnd = mulberry32(seed ^ 0xa11a5);
  const pool = [];
  ISLANDS.ARCHETYPES.forEach((a, i) => {
    for (let k = 0; k < a.weight; k++) pool.push(i);
  });
  const a = forceName
    ? (ISLANDS.ARCHETYPES.find((x) => x.name.toLowerCase() === forceName.toLowerCase())
       ?? ISLANDS.ARCHETYPES[0])
    : ISLANDS.ARCHETYPES[pool[(rnd() * pool.length) | 0]];

  const pick = ([lo, hi]) => lo + rnd() * (hi - lo);
  const nLobes = Math.round(pick(a.lobes));
  // One axis for the whole island, so a spine runs one way and an archipelago
  // is scattered around a consistent orientation rather than looking stirred.
  const axis = rnd() * Math.PI * 2;

  const lobes = [];
  for (let i = 0; i < nLobes; i++) {
    let lx = 0;
    let lz = 0;
    if (nLobes > 1) {
      if (a.line) {
        const t = (i / (nLobes - 1) - 0.5) * 2;          // -1 .. +1 along the axis
        lx = Math.cos(axis) * t * a.spread * HALF;
        lz = Math.sin(axis) * t * a.spread * HALF;
      } else {
        const ang = axis + (i / nLobes) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const rr = a.spread * HALF * (0.5 + rnd() * 0.5);
        lx = Math.cos(ang) * rr;
        lz = Math.sin(ang) * rr;
      }
    }
    const rad = pick(a.radius) * HALF * (0.88 + rnd() * 0.24);
    lobes.push({ x: lx, z: lz, rx: rad * pick(a.elongate), rz: rad });
  }

  return {
    name: a.name,
    lobes,
    axis,
    inner: pick(a.inner),
    warp: pick(a.warp),
    baseFreq: pick(a.baseFreq),
    peaks: pick(a.peaks),
    ridgeFreq: pick(a.ridgeFreq),
    relief: pick(a.relief)
  };
}

/**
 * Landmass mask: the union of the shape's lobes.
 *
 * One circle gave one island and only one island. Taking the MAX over several
 * lobes is what makes every archetype possible from the same line of code - a
 * continent is one big lobe, an archipelago is four small scattered ones, a
 * spine is three elongated ones in a row.
 */
function maskAt(shape, px, pz) {
  let best = 0;
  const ca = Math.cos(-shape.axis);
  const sa = Math.sin(-shape.axis);
  for (const lobe of shape.lobes) {
    const dx = px - lobe.x;
    const dz = pz - lobe.z;
    // Rotate into the lobe's own frame so elongation runs along the island's
    // axis rather than along world X.
    const ex = (dx * ca - dz * sa) / lobe.rx;
    const ez = (dx * sa + dz * ca) / lobe.rz;
    const d = Math.sqrt(ex * ex + ez * ez);
    const m = 1 - smoothstep(shape.inner, 1.0, d);
    if (m > best) best = m;
  }
  return best;
}

function generateHeights(seed, shape) {
  const noise = createNoise2D(seed);
  const h = new Float32Array(SIZE * SIZE);

  for (let j = 0; j < SIZE; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < SIZE; i++) {
      const x = -HALF + i * CELL;

      // Domain warp the mask so the coastline is ragged, not a circle. How far
      // it warps is the difference between a smooth continent and a fjord.
      const wx = noise(x * 0.0035 + 11.3, z * 0.0035 - 7.7);
      const wz = noise(x * 0.0035 - 3.1, z * 0.0035 + 5.9);
      const px = x + wx * shape.warp;
      const pz = z + wz * shape.warp;

      const mask = maskAt(shape, px, pz);

      // Rolling continental base.
      const base = fbm(noise, x * shape.baseFreq, z * shape.baseFreq, 5, 0.5, 2.05) * 0.5 + 0.5;

      let e = mask * (0.34 + 0.78 * base);
      e = Math.pow(Math.max(e, 0), shape.relief);
      let y = e * (WORLD.MAX_HEIGHT * 0.62) - 5.5;

      // Ridged mountains, pushed inland by mask^2 so peaks never touch the sea.
      const inland = Math.pow(Math.max(0, mask - 0.28) / 0.72, 2.0);
      // Two octaves at half the frequency: broad massifs rather than a field of
      // fine ridges. Four octaves produced detail finer than a terrace step, so
      // stepping the result staircased noise and the terraces never read.
      const r = ridged(noise, x * shape.ridgeFreq + 50, z * shape.ridgeFreq - 50, 2, 0.5, 2.1);
      y += Math.pow(r, 1.6) * inland * (WORLD.MAX_HEIGHT * shape.peaks);

      // Beach shelf: squash everything in the 0..6 band so shorelines are wide
      // and gently sloped instead of a cliff straight out of the water.
      if (y > 0 && y < 6) y *= 0.45 + 0.55 * (y / 6);

      // --- terracing ---
      //
      // Quantise the height into steps, then shape the fraction between two
      // steps with an S-curve so the riser is steep but FINITE. A hard floor()
      // gives a vertical wall, and a vertical wall is an infinite slope that
      // `maxSlopeIn` will refuse to build on and lighting will render as a black
      // seam. Faded in above the beach so shorelines stay soft.
      if (TERRACE.STRENGTH > 0 && y > TERRACE.START_H) {
        const t = y / TERRACE.STEP;
        const step = Math.floor(t);
        const f = t - step;
        const k = TERRACE.SHARPNESS;
        const fk = Math.pow(f, k);
        const shaped = fk / (fk + Math.pow(1 - f, k));
        const terraced = (step + shaped) * TERRACE.STEP;
        const fade = clamp((y - TERRACE.START_H) / TERRACE.FADE, 0, 1);
        y += (terraced - y) * fade * TERRACE.STRENGTH;
      }

      // Fine detail LAST, and gently.
      //
      // Terracing has to be cut into the broad shape. Applied after this line it
      // quantises the noise instead of the landform: every small bump becomes
      // its own step edge and the mountains come out crumpled rather than
      // stepped. The amplitude is also down from 1.1, because detail as tall as
      // half a step reads as damage to the terrace rather than texture on it.
      y += fbm(noise, x * 0.05, z * 0.05, 3, 0.5, 2.0) * 0.45 * clamp(y / 6, 0, 1);

      // The rim of the world falls away into deep water.
      //
      // Without this the seabed is a flat plate at about -12 all the way to the
      // grid boundary, and the boundary is a straight edge you can see through
      // the shallows - a square horizon. It was always there and never visible,
      // because you could not zoom out far enough to look at it. Raising the
      // island raised MAX_DIST with it, and the edge of the world came into
      // frame. Sinking the rim puts that seam under water too dark to read.
      // `d` used to be the single radial distance; with several lobes there is
      // no such number, so the rim is driven off distance from the world centre
      // directly. The plate's edge is square either way - this only has to sink
      // the seam below readable depth.
      const dw = Math.sqrt(px * px + pz * pz) / (HALF * 0.94);
      const rim = Math.max(0, dw - 0.86) / 0.14;
      y -= rim * rim * 46;

      // Offshore seabed drops away.
      y -= (1 - mask) * 7;

      h[j * SIZE + i] = Math.max(y, -16);
    }
  }
  return h;
}

// ---------------------------------------------------------------------------
/**
 * Would town siting find somewhere to put SITES_NEEDED towns on this island?
 *
 * A faithful cheap mirror of town.js's `siteScore`: ground between 9 and 26
 * units high with at least four fifths of a 30-unit ring around it out of the
 * water, and far enough from the sites already accepted.
 *
 * This exists because a random island is allowed to be unplayable and a shipped
 * one is not. `foundTown` samples 6000 points and returns null if none score;
 * when that happens the player quietly gets two rivals instead of three, with
 * nothing on screen to say why. Terracing caused exactly that in Phase 12, and
 * that was ONE hand-tuned island - rolling a new one every game turns a rare
 * accident into a regular one.
 */
function islandIsViable(h) {
  const at = (x, z) => {
    const fx = (x + HALF) / CELL;
    const fz = (z + HALF) / CELL;
    const i = Math.round(fx);
    const j = Math.round(fz);
    if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return -99;
    return h[j * SIZE + i];
  };

  const found = [];
  const R = HALF * 0.80;                    // the band pickSites searches
  const STEP = 10;
  const need = ISLANDS.SITES_NEEDED + ISLANDS.SITES_MARGIN;
  for (let z = -R; z <= R && found.length < need; z += STEP) {
    for (let x = -R; x <= R && found.length < need; x += STEP) {
      if (x * x + z * z > R * R) continue;
      const y = at(x, z);
      if (y < 9 || y > 26) continue;

      let land = 0;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        if (at(x + Math.cos(a) * 30, z + Math.sin(a) * 30) > 2.5) land++;
      }
      if (land / 12 < 0.8) continue;

      let clear = true;
      for (const f of found) {
        if (Math.hypot(x - f.x, z - f.z) < ISLANDS.SITE_SPACING) { clear = false; break; }
      }
      if (clear) found.push({ x, z });
    }
  }
  return found.length >= need;
}

/**
 * Roll islands until one is playable, then keep it.
 *
 * Every rejected island costs one heightfield generation - a few milliseconds -
 * and the alternative is shipping a world the game cannot place its towns on.
 * If nothing passes, fall back to the original hand-checked seed and archetype
 * rather than handing back whatever the last failure produced: a known good
 * island is always better than a novel broken one.
 */
function rollIsland(startSeed, forceName) {
  // The archetype is chosen ONCE and held across the retries.
  //
  // Re-picking it every attempt looked equivalent and was not: shapes that fail
  // the viability check more often simply get replaced by shapes that pass, so
  // the easy archetype crowds out the hard ones. Measured over 40 rolls that
  // put Highland at 45% against an intended 27%, and Spine and Fjordland at 7%
  // against 18% - the two most distinctive shapes were the two you would almost
  // never see, in a phase whose entire purpose is that no two games look alike.
  //
  // The last third of the attempts drop the constraint, so a genuinely awkward
  // archetype still yields an island rather than falling all the way through.
  const chosen = forceName ?? pickShape(startSeed).name;
  const hold = Math.floor(ISLANDS.MAX_ATTEMPTS * 0.67);

  for (let attempt = 0; attempt < ISLANDS.MAX_ATTEMPTS; attempt++) {
    const seed = (startSeed + attempt * 0x9e3779b9) >>> 0;
    const shape = pickShape(seed, attempt < hold ? chosen : null);
    const h = generateHeights(seed, shape);
    if (islandIsViable(h)) {
      return { seed, shape, heights: h, attempts: attempt + 1, fallback: false };
    }
  }
  const shape = pickShape(WORLD.SEED, 'Highland');
  return {
    seed: WORLD.SEED, shape, heights: generateHeights(WORLD.SEED, shape),
    attempts: ISLANDS.MAX_ATTEMPTS, fallback: true
  };
}

export function initTerrain(state) {
  const scene = state.scene;

  const rolled = rollIsland(state.seed ?? WORLD.SEED, state.islandName ?? null);
  let heights = rolled.heights;
  let seed = rolled.seed;
  let shape = rolled.shape;
  // THE ACCEPTED SEED BECOMES THE GAME'S SEED.
  //
  // `rollIsland` offsets the seed on each retry, so the island that passed is
  // rarely the number we started with. Everything downstream - props, flora,
  // scenery, town siting, villager traits, the creature - derives its stream
  // from `state.seed`, and if that stayed as the number we ASKED for while the
  // terrain came from the number we ACCEPTED, then `?seed=` would reproduce the
  // coastline and nothing else. The label would be lying.
  state.seed = seed;
  // Published so the HUD can name the island and the player can replay a good
  // one. The seed IS the island - hand someone the number and they get yours.
  state.island = {
    seed, name: shape.name, lobes: shape.lobes.length,
    attempts: rolled.attempts, fallback: rolled.fallback
  };
  if (rolled.fallback) {
    console.warn('[terrain] no viable island in '
      + ISLANDS.MAX_ATTEMPTS + ' attempts; using the known-good one');
  }

  const vertCount = SIZE * SIZE;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  // Index buffer: two triangles per cell, wound CCW when viewed from +Y.
  const quadCount = (SIZE - 1) * (SIZE - 1);
  const indices = vertCount > 65535 ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
  {
    let k = 0;
    for (let j = 0; j < SIZE - 1; j++) {
      for (let i = 0; i < SIZE - 1; i++) {
        const a = j * SIZE + i;
        const b = a + 1;
        const c = a + SIZE;
        const d = c + 1;
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      }
    }
  }

  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const v = j * SIZE + i;
      positions[v * 3] = -HALF + i * CELL;
      positions[v * 3 + 2] = -HALF + j * CELL;
      uvs[v * 2] = i / (SIZE - 1);
      uvs[v * 2 + 1] = 1 - j / (SIZE - 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  const grain = makeGrainTexture(256, 7);
  grain.repeat.set(70, 70);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: grain,
    roughness: 0.94,
    metalness: 0.0
  });

  // --- influence ring -------------------------------------------------------
  // Drawn by patching the standard material rather than by laying a decal mesh
  // over the ground: the ring then follows every fold of the terrain exactly,
  // with no z-fighting and no extra draw call.
  // Up to four territories at once: the player's plus the rivals'. Each is a
  // soft ring in that town's own colour, so who owns what is legible at a
  // glance without a minimap.
  const MAX_RINGS = 4;
  const influence = {
    uInfCenter: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector3(0, -9999, 0)) },
    uInfRadius: { value: new Array(MAX_RINGS).fill(0) },
    uInfColor: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Color(0xa8ddff)) },
    uInfCount: { value: 0 },
    uInfStrength: { value: 0 },
    /** Player alignment, -1 cruel .. +1 merciful. Drives ground saturation. */
    uAlign: { value: 0 }
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, influence);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInfWPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvInfWPos = (modelMatrix * vec4(position, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vInfWPos;
         uniform vec3 uInfCenter[4];
         uniform float uInfRadius[4];
         uniform vec3 uInfColor[4];
         uniform int uInfCount;
         uniform float uInfStrength;
         uniform float uAlign;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           // Alignment recolours the whole island: a cruel god's land goes
           // grey and cold, a merciful one's goes lush. Cheaper and far more
           // legible than re-tinting every vertex colour on the CPU.
           float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
           vec3 cruel = mix(vec3(lum), gl_FragColor.rgb, 0.42) * vec3(0.82, 0.80, 0.88);
           vec3 kind  = mix(vec3(lum), gl_FragColor.rgb, 1.30) * vec3(1.02, 1.07, 0.98);
           vec3 shifted = uAlign < 0.0 ? cruel : kind;
           gl_FragColor.rgb = mix(gl_FragColor.rgb, shifted, min(abs(uAlign), 1.0));
         }
         {
           // A faint wash over each territory, plus a broad rim at its edge.
           // The rim needs real width: this is added after tone mapping, and a
           // band only a couple of units across vanishes at gameplay zoom.
           for (int i = 0; i < 4; i++) {
             if (i >= uInfCount) break;
             float r = uInfRadius[i];
             if (r <= 0.0) continue;
             float d = distance(vInfWPos.xz, uInfCenter[i].xz);
             float wash = 1.0 - smoothstep(r * 0.5, r, d);
             float rim = smoothstep(r - 7.0, r - 1.0, d)
                       * (1.0 - smoothstep(r + 0.5, r + 4.5, d));
             gl_FragColor.rgb += uInfColor[i] * (rim * 0.30 + wash * 0.022) * uInfStrength;
           }
         }`
      );
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  mesh.frustumCulled = false;
  scene.add(mesh);

  // --- height sampling ------------------------------------------------------
  function rawH(i, j) {
    const ci = i < 0 ? 0 : i > SIZE - 1 ? SIZE - 1 : i;
    const cj = j < 0 ? 0 : j > SIZE - 1 ? SIZE - 1 : j;
    return heights[cj * SIZE + ci];
  }

  function heightAt(x, z) {
    const fi = (x + HALF) / CELL;
    const fj = (z + HALF) / CELL;
    const i0 = Math.floor(fi);
    const j0 = Math.floor(fj);
    const tx = fi - i0;
    const tz = fj - j0;
    const h00 = rawH(i0, j0);
    const h10 = rawH(i0 + 1, j0);
    const h01 = rawH(i0, j0 + 1);
    const h11 = rawH(i0 + 1, j0 + 1);
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  const _n = new THREE.Vector3();
  function normalAt(x, z, out = _n) {
    const e = CELL;
    const hL = heightAt(x - e, z);
    const hR = heightAt(x + e, z);
    const hU = heightAt(x, z - e);
    const hD = heightAt(x, z + e);
    // Exact heightfield normal: (-dh/dx, 1, -dh/dz), scaled by 2e.
    return out.set(hL - hR, 2 * e, hU - hD).normalize();
  }

  function slopeAt(x, z) {
    return 1 - normalAt(x, z, _n).y;
  }

  function inBounds(x, z) {
    return Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2;
  }

  // --- per-vertex normal + colour, computed straight from the heightfield ----
  // Analytic normals are both cheaper and cleaner than computeVertexNormals(),
  // and let us refresh a small patch after a deformation.
  const colorNoise = createNoise2D(seed ^ 0x5f3a);
  const tmpA = [0, 0, 0];
  const tmpB = [0, 0, 0];

  function writeVertex(i, j) {
    const v = j * SIZE + i;
    const y = heights[v];
    positions[v * 3 + 1] = y;

    // normal
    const hL = rawH(i - 1, j);
    const hR = rawH(i + 1, j);
    const hU = rawH(i, j - 1);
    const hD = rawH(i, j + 1);
    let nx = hL - hR;
    let ny = 2 * CELL;
    let nz = hU - hD;
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv; ny *= inv; nz *= inv;
    normals[v * 3] = nx;
    normals[v * 3 + 1] = ny;
    normals[v * 3 + 2] = nz;

    const slope = 1 - ny;
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;

    // Jitter the band edges so sand/grass/rock transitions are organic.
    const jitter = colorNoise(x * 0.021, z * 0.021) * 2.0;
    const patch = colorNoise(x * 0.055 + 40, z * 0.055 - 40);

    // sand -> grass by height
    let col = mix3(C_SAND, C_GRASS, smoothstep(1.4, 5.0, y + jitter), tmpA);
    // sand goes darker below the waterline (wet sand / seabed)
    if (y < 1.2) {
      col = mix3(col, C_SAND_WET, smoothstep(1.2, -0.6, y), tmpA);
      col = mix3(col, C_SEABED, smoothstep(-1.5, -7.0, y), tmpA);
    }
    // grass dries out with altitude
    col = mix3(col, C_GRASS_DRY, smoothstep(16, 30, y + jitter * 3) * 0.7, tmpA);
    // rock takes over on steep faces and on high ground
    const rockT = Math.max(
      smoothstep(0.34, 0.62, slope),
      smoothstep(30, 46, y + jitter * 4)
    );
    const rockCol = mix3(C_ROCK, C_ROCK_DARK, smoothstep(0.55, 0.85, slope), tmpB);
    col = mix3(col, rockCol, rockT, tmpA);

    // Broad tonal variation + a cheap crevice darkening so slopes read as depth.
    const tint = 0.92 + patch * 0.14;
    // Light crevice darkening only. The lighting already shades slopes; baking
    // a strong second term on top double-darkens every hillside.
    const ao = 0.89 + 0.11 * (1 - clamp(slope * 1.4, 0, 1));
    const k = tint * ao;

    colors[v * 3] = srgbToLinear(clamp(col[0] * k, 0, 1));
    colors[v * 3 + 1] = srgbToLinear(clamp(col[1] * k, 0, 1));
    colors[v * 3 + 2] = srgbToLinear(clamp(col[2] * k, 0, 1));
  }

  function rebuildAll() {
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) writeVertex(i, j);
    }
    // CLEAR the ranges first. `refreshPatch` leaves per-row update ranges
    // behind, and an attribute that has any ranges set uploads ONLY those - so
    // a full rebuild after a sculpt stroke would have re-sent five rows and
    // left the rest of the island showing its old shape.
    for (const attr of [geo.attributes.position, geo.attributes.normal,
                        geo.attributes.color]) {
      attr.clearUpdateRanges();
      attr.needsUpdate = true;
    }
    geo.computeBoundingSphere();
  }

  // --- water ---------------------------------------------------------------
  // A float heightmap texture is handed to the water shader so it can work out
  // depth under each fragment and paint a foam line along the shore.
  const heightTex = new THREE.DataTexture(heights, SIZE, SIZE, THREE.RedFormat, THREE.FloatType);
  heightTex.needsUpdate = true;
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;

  const waterUniforms = {
    uTime: { value: 0 },
    uHeightMap: { value: heightTex },
    uHalf: { value: HALF },
    uExtent: { value: WORLD.EXTENT },
    uShallow: { value: new THREE.Color(0x3fa6a8) },
    uDeep: { value: new THREE.Color(0x0b2e4a) },
    uSky: { value: new THREE.Color(0x9dc4e8) },
    uSunDir: { value: new THREE.Vector3(0.38, 0.95, 0.28).normalize() }
  };

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // Three crossing swells. Cheap, and reads as open water from above.
        float w = 0.0;
        w += sin(wp.x * 0.085 + uTime * 1.10) * 0.34;
        w += sin(wp.z * 0.115 - uTime * 0.92) * 0.26;
        w += sin((wp.x + wp.z) * 0.052 + uTime * 0.58) * 0.40;
        wp.y += w;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform sampler2D uHeightMap;
      uniform float uHalf;
      uniform float uExtent;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uSunDir;
      varying vec3 vWorld;

      void main() {
        // Analytic derivative of the same three swells used in the vertex stage,
        // so the lighting normal matches the displaced surface exactly.
        float dx = 0.0;
        float dz = 0.0;
        dx += 0.085 * cos(vWorld.x * 0.085 + uTime * 1.10) * 0.34;
        dz += 0.115 * cos(vWorld.z * 0.115 - uTime * 0.92) * 0.26;
        float c3 = 0.052 * cos((vWorld.x + vWorld.z) * 0.052 + uTime * 0.58) * 0.40;
        dx += c3; dz += c3;

        // Small high-frequency chop on top, normal only.
        dx += 0.30 * cos(vWorld.x * 0.62 + uTime * 2.7) * 0.045;
        dz += 0.30 * cos(vWorld.z * 0.71 - uTime * 2.3) * 0.045;

        vec3 N = normalize(vec3(-dx, 1.0, -dz));
        vec3 V = normalize(cameraPosition - vWorld);

        // Ground depth beneath this fragment.
        vec2 uv = (vWorld.xz + uHalf) / uExtent;
        float ground = -40.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
          ground = texture2D(uHeightMap, vec2(uv.x, uv.y)).r;
        }
        float depth = max(0.0, -ground);

        vec3 col = mix(uShallow, uDeep, clamp(depth / 9.0, 0.0, 1.0));

        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.72);

        vec3 H = normalize(uSunDir + V);
        col += vec3(1.0, 0.97, 0.9) * pow(max(dot(N, H), 0.0), 90.0) * 0.85;

        // Foam: a band hugging the shoreline, wobbled so it is not a clean arc.
        float wob = sin(vWorld.x * 0.35 + uTime * 1.6) * 0.25
                  + sin(vWorld.z * 0.41 - uTime * 1.9) * 0.25;
        float foam = smoothstep(1.5 + wob, 0.05, depth) * step(0.0, depth + 0.6);
        col = mix(col, vec3(0.94, 0.97, 1.0), foam * 0.7);

        float alpha = mix(0.42, 0.90, clamp(depth / 5.0, 0.0, 1.0));
        alpha = max(alpha, foam * 0.85);
        alpha = mix(alpha, 1.0, fres * 0.5);

        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `
  });

  // The plane is recentred on the camera every frame, so its edge is always
  // past the fog far plane (WORLD.EXTENT * 2.3) and never visible as a seam.
  // Span and cell size both live in WATER, and the segment count is DERIVED
  // from them - the thing the swells actually need is a cell size, and a typed
  // segment count silently stops meaning what it meant the moment the span
  // changes. If you lengthen the fog, widen WATER.SPAN to match.
  const waterSpan = WORLD.EXTENT * WATER.SPAN;
  const waterGeo = new THREE.PlaneGeometry(
    waterSpan, waterSpan, WATER.SEGMENTS, WATER.SEGMENTS
  );
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WORLD.SEA_LEVEL;
  water.renderOrder = 2;
  water.frustumCulled = false;
  scene.add(water);

  // --- deformation ---------------------------------------------------------
  let heightTexDirty = false;
  let heightTexTimer = 0;

  /** Index bounds of the grid patch covering a world-space circle. */
  function patchBounds(x, z, radius) {
    return {
      i0: Math.max(0, Math.floor((x - radius + HALF) / CELL) - 1),
      i1: Math.min(SIZE - 1, Math.ceil((x + radius + HALF) / CELL) + 1),
      j0: Math.max(0, Math.floor((z - radius + HALF) / CELL) - 1),
      j1: Math.min(SIZE - 1, Math.ceil((z + radius + HALF) / CELL) + 1)
    };
  }

  /**
   * Rewrite position/normal/colour for a patch, plus one ring for the normals.
   * Announces the change so anything resting on that ground can re-settle.
   */
  function refreshPatch(b, change) {
    const ei0 = Math.max(0, b.i0 - 1);
    const ei1 = Math.min(SIZE - 1, b.i1 + 1);
    const ej0 = Math.max(0, b.j0 - 1);
    const ej1 = Math.min(SIZE - 1, b.j1 + 1);
    for (let j = ej0; j <= ej1; j++) {
      for (let i = ei0; i <= ei1; i++) writeVertex(i, j);
    }
    // UPLOAD ONLY THE ROWS THAT CHANGED.
    //
    // `needsUpdate` re-sends the WHOLE attribute. On a 384x384 field that is
    // 147,456 vertices across position, normal and colour - 5.3MB pushed to the
    // GPU every frame of a sculpt drag, to move a patch about five cells wide.
    // Measured at ~0.5ms on a fast bus, which is exactly what 5.3MB costs; on
    // integrated graphics with shared memory it is several times worse, and it
    // fires on every building placement too now that placing shapes ground.
    //
    // One range per row, because the grid is row-major: a rectangular patch is
    // contiguous ACROSS a row and stride SIZE apart between them. A 15-radius
    // brush touches about five rows of five, so this sends roughly 1KB instead
    // of 5.3MB.
    for (const attr of [geo.attributes.position, geo.attributes.normal,
                        geo.attributes.color]) {
      attr.clearUpdateRanges();
      for (let j = ej0; j <= ej1; j++) {
        // Ranges are in ARRAY ELEMENTS, not vertices - itemSize is 3 for all
        // three of these attributes.
        attr.addUpdateRange((j * SIZE + ei0) * 3, (ei1 - ei0 + 1) * 3);
      }
      attr.needsUpdate = true;
    }
    heightTexDirty = true;
    if (change) state.events?.emit('terrain-changed', change);
  }

  /**
   * Push the ground by `amount` (negative digs a crater) inside a soft circle.
   * Only the affected patch of the buffers is rewritten.
   */
  /**
   * Circles of ground that a deform or a flatten must leave exactly as it is.
   *
   * Terrain has no idea what a building is and does not need one - it is handed
   * a list of {x, z, r} and skips those cells. That is what lets the sculpt
   * brush work right up to a wall instead of refusing the whole stroke because
   * one corner of it overlapped a hut.
   *
   * Passed as a reused array by the caller; never retained here.
   */
  function isProtected(protect, wx, wz) {
    if (!protect) return false;
    for (let k = 0; k < protect.length; k++) {
      const c = protect[k];
      const dx = wx - c.x;
      const dz = wz - c.z;
      if (dx * dx + dz * dz <= c.r * c.r) return true;
    }
    return false;
  }

  function deform(x, z, radius, amount, protect = null) {
    const b = patchBounds(x, z, radius);
    if (b.i1 < b.i0 || b.j1 < b.j0) return;

    const r2 = radius * radius;
    for (let j = b.j0; j <= b.j1; j++) {
      const wz = -HALF + j * CELL;
      for (let i = b.i0; i <= b.i1; i++) {
        const wx = -HALF + i * CELL;
        const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
        if (d2 > r2) continue;
        if (isProtected(protect, wx, wz)) continue;
        const f = 1 - Math.sqrt(d2) / radius;
        heights[j * SIZE + i] += amount * f * f * (3 - 2 * f); // smoothstep falloff
      }
    }
    refreshPatch(b, { x, z, radius });
  }

  /**
   * Level the ground toward `targetH` inside a circle - the building pad.
   * Flat in the middle, easing back out to the natural terrain at the rim so
   * pads blend in instead of sitting on obvious plateaus.
   */
  /**
   * `strength` is how far toward level one call moves the ground, 0..1.
   *
   * Buildings pass the default and get their pad in a single call, which is
   * what a foundation is. The sculpt brush passes a small per-frame slice so
   * that levelling is something you spend time and belief on rather than a
   * click, and so you can stop half way and keep a slope.
   */
  function flatten(x, z, radius, targetH, strength = 1, protect = null) {
    const b = patchBounds(x, z, radius);
    if (b.i1 < b.i0 || b.j1 < b.j0) return;

    for (let j = b.j0; j <= b.j1; j++) {
      const wz = -HALF + j * CELL;
      for (let i = b.i0; i <= b.i1; i++) {
        const wx = -HALF + i * CELL;
        const d = Math.hypot(wx - x, wz - z);
        if (d > radius) continue;
        if (isProtected(protect, wx, wz)) continue;
        // Fully flat out to 65% of the radius, then eased back to the natural
        // ground. A shorter plateau leaves almost no genuinely level building
        // area inside a pad of any given size.
        const t = (1 - smoothstep(radius * 0.65, radius, d)) * strength;
        const k = j * SIZE + i;
        heights[k] = lerp(heights[k], targetH, t);
      }
    }
    refreshPatch(b, { x, z, radius });
  }

  /** Mean ground height over a circle - used to pick a building pad's level. */
  function averageHeight(x, z, radius) {
    let sum = 0;
    let n = 0;
    const step = Math.max(CELL, radius / 4);
    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        if (dx * dx + dz * dz > radius * radius) continue;
        sum += heightAt(x + dx, z + dz);
        n++;
      }
    }
    return n ? sum / n : heightAt(x, z);
  }

  /** Steepest slope found anywhere in a circle, as (1 - normal.y). */
  function maxSlopeIn(x, z, radius) {
    let worst = 0;
    const step = Math.max(CELL, radius / 3);
    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const s = slopeAt(x + dx, z + dz);
        if (s > worst) worst = s;
      }
    }
    return worst;
  }

  function regenerate(newSeed) {
    // Through the same gate: a regenerated island has to be playable too.
    const again = rollIsland(newSeed >>> 0, null);
    seed = again.seed;
    shape = again.shape;
    state.island = {
      seed, name: shape.name, lobes: shape.lobes.length,
      attempts: again.attempts, fallback: again.fallback
    };
    const fresh = again.heights;
    heights.set(fresh);
    rebuildAll();
    heightTex.needsUpdate = true;
    return seed;
  }

  rebuildAll();

  const api = {
    mesh,
    water,
    heights,
    get seed() { return seed; },
    heightAt,
    normalAt,
    slopeAt,
    inBounds,
    deform,
    flatten,
    averageHeight,
    maxSlopeIn,
    regenerate,
    /**
     * Drive the territory rings. `rings` is [{ centre, radius, colour }, ...],
     * at most four; anything beyond is ignored.
     */
    setInfluenceRings(rings, strength = 1) {
      const n = Math.min(rings.length, MAX_RINGS);
      for (let i = 0; i < MAX_RINGS; i++) {
        if (i < n) {
          influence.uInfCenter.value[i].copy(rings[i].centre);
          influence.uInfRadius.value[i] = rings[i].radius;
          influence.uInfColor.value[i].set(rings[i].colour);
        } else {
          influence.uInfRadius.value[i] = 0;
        }
      }
      influence.uInfCount.value = n;
      influence.uInfStrength.value = strength;
    },
    /** Player alignment, -1..+1. Shifts the island's saturation and cast. */
    setAlignment(a) { influence.uAlign.value = a; },
    /** Sun direction is shared with the water shader; main.js sets it. */
    setSunDirection(v) { waterUniforms.uSunDir.value.copy(v).normalize(); },
    /** Render-rate update: animate water, flush throttled texture uploads. */
    update(dt, time, camPos) {
      waterUniforms.uTime.value = time;
      // Keep the ocean centred under the viewer. Waves and foam are computed
      // from world position inside the shader, so sliding the mesh does not
      // slide the water - it just moves where the geometry happens to be.
      if (camPos) {
        water.position.x = Math.round(camPos.x);
        water.position.z = Math.round(camPos.z);
      }
      if (heightTexDirty) {
        heightTexTimer -= dt;
        if (heightTexTimer <= 0) {
          heightTex.needsUpdate = true;
          heightTexDirty = false;
          heightTexTimer = 0.25;
        }
      }
    }
  };

  state.terrain = api;
  return api;
}
