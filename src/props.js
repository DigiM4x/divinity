// ---------------------------------------------------------------------------
// props.js - grabbable world objects (rocks, boulders, trees) plus their
// ballistic physics.
//
// Rendering: one InstancedMesh per geometry variant, all sharing a single
// material (the Kenney kit's palette). ~7 draw calls for ~580 objects.
//
// Simulation: fixed 20Hz, with adaptive sub-stepping for fast movers so a
// thrown boulder cannot tunnel through a hillside. Render interpolates between
// the previous and current tick, so 20Hz physics still looks smooth at 60fps.
//
// Publishes state.props: { list, simStep, syncRender, raycast, wake, ... }
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { centerVertically } from './lib/geo.js';
import { sizeToHeight, sizeToWidth, growInstances} from './lib/models.js';
import { PHYS, SCATTER, WORLD, HAND, VILLAGER, REGROW, BIOMES, STONE_PIECES } from './state.js';

const { PICK_RADIUS_SCALE, HIGHLIGHT } = HAND;

// --- geometry factories -----------------------------------------------------

// --- scatter placement ------------------------------------------------------

function scatter(terrain, rand, count, opts) {
  const out = [];
  const maxTries = count * 60;
  let tries = 0;
  const R = WORLD.HALF * 0.9;

  // Uniform grid for the min-distance test. Without it, rejection sampling
  // piles three or four props into the same spot and they read as one
  // shattered lump rather than as individual objects.
  const minDist = opts.minDist ?? 0;
  const cell = Math.max(minDist, 1);
  const grid = new Map();
  const key = (cx, cz) => cx * 100000 + cz;

  function tooClose(x, z) {
    if (minDist <= 0) return false;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(key(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const p of bucket) {
          const ddx = p.x - x;
          const ddz = p.z - z;
          if (ddx * ddx + ddz * ddz < minDist * minDist) return true;
        }
      }
    }
    return false;
  }

  while (out.length < count && tries++ < maxTries) {
    // Rejection-sample a disc. sqrt() on the radius keeps the density uniform
    // instead of bunching everything at the island's centre.
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * R;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = terrain.heightAt(x, z);
    if (y < opts.minH || y > opts.maxH) continue;
    if (terrain.slopeAt(x, z) > opts.maxSlope) continue;
    if (tooClose(x, z)) continue;

    const spot = { x, y, z };
    out.push(spot);
    const k = key(Math.floor(x / cell), Math.floor(z / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(spot);
  }
  return out;
}

// ---------------------------------------------------------------------------
export function initProps(state) {
  const terrain = state.terrain;
  const rand = mulberry32(state.seed ^ 0x9e37);

  // Every prop is a kit model now, so there is one material for all of them.
  // vertexColors stays on: the hover highlight multiplies a per-instance colour
  // into the vertex colour, and three only applies that in the fragment stage
  // when USE_COLOR is defined.
  // Darkened deliberately. The kit's palette is muted to begin with, and this
  // scene's sun + hemisphere fill washes it out to pale mint next to the
  // saturated vertex-coloured grass and rock. Multiplying the map down restores
  // the depth the pack's own previews have.
  const kitMaterial = state.models.makeMaterial({
    flatShading: false,
    color: 0xb9b9b9,
    roughness: 0.95
  });

  /**
   * The nature kit draws WITHOUT a texture.
   *
   * Its models carry no image of their own but they do carry UVs, and pointing
   * those at the town kit's colormap - which is a palette atlas of coloured
   * squares - makes every leaf sample a different swatch. The result is a
   * rainbow dither crawling over every tree on the island, which is exactly
   * what it looked like. Colour comes from the vertex colours baked out of each
   * material at load, so the map has to be off.
   */
  const natureMaterial = state.models.makeMaterial({
    map: null,
    flatShading: false,
    // Dimmed to match kitMaterial. At pure white the kit's own colours are
    // pushed into the shoulder of the ACES tone curve by a 2.35-intensity sun
    // and every tree comes out pale mint instead of the deep teal the vertex
    // data actually holds.
    color: 0xb9b9b9,
    roughness: 0.92
  });
  const M = state.models;

  /**
   * Instance capacity for one variant out of `n` sharing a scatter budget.
   *
   * Derived rather than hardcoded, because hardcoding it is a trap that springs
   * the moment the island is resized: raising SCATTER without raising these
   * silently overflows the buffer, and WebGL reports it as
   * "Vertex buffer is not big enough for the draw call" from deep inside ANGLE,
   * which points nowhere near the actual cause.
   *
   * The headroom matters - variants are chosen at random per prop, so one can
   * take well over its even share of the budget.
   */
  // The expected share, with no padding: growth covers a scatter that comes out
  // denser than expected, so the 1.4x that used to stand in for a capacity
  // guard is no longer buying anything but empty GPU buffers.
  const cap = (total, n) => Math.max(4, Math.ceil(total / n));

  /** A variant = one geometry + one InstancedMesh + the props using it. */
  const variants = [];

  function addVariant(name, geo, capacity, meta, mat = kitMaterial) {
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance tint, all white by default. Assigned before the first render
    // so three compiles the shader with USE_INSTANCING_COLOR; it multiplies the
    // vertex colour, which is what the hover highlight rides on.
    const tint = new Float32Array(capacity * 3).fill(1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(tint, 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = name;
    state.scene.add(mesh);
    const v = { name, mesh, geo, props: [], dirty: true, meta };
    mesh.userData.variant = v;
    variants.push(v);
    return v;
  }

  // --- the nature kit ------------------------------------------------------
  //
  // Every tree and stone on the island comes from one pack now, so the whole
  // place matches. Pieces are looked up by name from `state.naturePieces`, which
  // main.js loads at boot; anything missing is skipped rather than throwing, so
  // a typo in a biome table costs one silhouette and not the game.
  const N = state.naturePieces;

  const natureGeo = (name, height) => {
    const g = N?.get(name);
    if (!g) { console.warn(`[props] no nature piece "${name}"`); return null; }
    return centerVertically(sizeToHeight(g.clone(), height));
  };

  /**
   * Stone is sized by its WIDTH, not its height.
   *
   * The kit's rocks are wide and flat, so pinning their height pins the least
   * interesting dimension and lets the other two go where they like: a rock
   * asked to stand 2.5 tall came out 10 units across on average and 28 at worst,
   * which is wider than the castle. Width is what you actually read on a boulder,
   * so width is what gets fixed.
   */
  const stoneGeo = (name, width) => {
    const g = N?.get(name);
    if (!g) { console.warn(`[props] no nature piece "${name}"`); return null; }
    return centerVertically(sizeToWidth(g.clone(), width));
  };

  /**
   * One variant per piece, sized to the middle of its biome's range. Capacity is
   * shared across the biome's pieces with headroom, since which piece a given
   * spot takes is a dice roll.
   */
  const treeVariantsByBiome = BIOMES.map((b, bi) => {
    const mid = (b.height[0] + b.height[1]) / 2;
    return b.trees.map((name, i) => {
      const geo = natureGeo(name, mid);
      if (!geo) return null;
      return addVariant(`tree_${bi}_${i}`, geo,
        cap(SCATTER.TREES, Math.max(3, b.trees.length)),
        { kind: 'tree', density: 0.55 }, natureMaterial);
    }).filter(Boolean);
  });

  const rockVariants = STONE_PIECES.rocks.map((name, i) => {
    const geo = stoneGeo(name, 1.8 + i * 0.35);
    return geo && addVariant(`rock${i}`, geo, cap(SCATTER.ROCKS, STONE_PIECES.rocks.length),
      { kind: 'rock', density: 2.4 }, natureMaterial);
  }).filter(Boolean);

  const boulderVariants = STONE_PIECES.boulders.map((name, i) => {
    const geo = stoneGeo(name, 4.0 + i * 0.5);
    return geo && addVariant(`boulder${i}`, geo, cap(SCATTER.BOULDERS, STONE_PIECES.boulders.length),
      { kind: 'boulder', density: 2.9 }, natureMaterial);
  }).filter(Boolean);

  const list = [];
  let nextId = 1;

  function makeProp(variant, x, z, scale) {
    variant.geo.computeBoundingBox();
    const bb = variant.geo.boundingBox;
    const halfH = ((bb.max.y - bb.min.y) / 2) * scale;
    const halfW = (Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2) * scale;
    // Tall-and-narrow props get capsule contact; wide ones get ellipsoid
    // contact. Rocks are wider than they are tall, so they never trip this.
    const isLong = halfH > halfW * 1.25;

    const p = {
      id: nextId++,
      kind: variant.meta.kind,
      variant,
      index: variant.props.length,
      pos: new THREE.Vector3(x, 0, z),
      /** Where it grew. Used to tell a planted tree from a felled one. */
      home: new THREE.Vector3(x, 0, z),
      prev: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      prevQuat: new THREE.Quaternion(),
      angVel: new THREE.Vector3(),
      scale,
      /** Horizontal half-extent; also the sphere/capsule radius. */
      radius: halfW,
      /** Vertical half-extent, needed for ground contact on flat props. */
      halfH,
      halfLen: isLong ? halfH - halfW : 0,
      isLong,
      mass: variant.meta.density * scale * scale * scale * (isLong ? 1.4 : 2.2),
      /**
       * Trees thrown into the sea are lost: they sink and are gone. Stone also
       * sinks but simply settles on the seabed and stays grabbable.
       */
      drowns: variant.meta.kind === 'tree',
      drownT: 0,
      /** Resource nodes: trees yield wood, stone yields ore. */
      resource: variant.meta.kind === 'tree' ? 'wood' : 'ore',
      /** Set while a villager is walking to or working this node. */
      claimedBy: null,
      /** Harvested props shrink away and stop being pickable or physical. */
      harvested: false,
      dead: false,
      shrink: 1,
      /**
       * How far through being harvested this node looks, 0..1. Cosmetic only -
       * it scales the rendered instance and nothing else, so a half-chopped
       * tree still has its full collision radius and still yields a full load.
       */
      wear: 0,
      /** Set by setWear each tick it is being worked; drives regrowth. */
      wearTouched: false,
      /** Trees only: game time at which this stump sprouts again, or 0. */
      regrowAt: 0,
      /** True while growing from a sapling back to full size. */
      growing: false,
      awake: false,
      sleepT: 0,
      /** Seconds of unbroken ground contact; resets when airborne. */
      groundT: 0,
      held: false,
      inWater: false,
    };

    // Random yaw, plus a small random lean so the scatter never looks gridded.
    p.quat.setFromEuler(
      new THREE.Euler(
        (rand() - 0.5) * 0.12,
        rand() * Math.PI * 2,
        (rand() - 0.5) * 0.12,
        'YXZ'
      )
    );
    p.pos.y = terrain.heightAt(x, z) + supportOffset(p);
    p.home.copy(p.pos);
    p.prev.copy(p.pos);
    p.prevQuat.copy(p.quat);

    // Grow before writing. `p.index` is just this prop's position in
    // `variant.props`, and the render sync walks that array by index, so the
    // mesh and the array must stay the same length. Before growth existed this
    // was guarded only by allocating 1.4x the expected share up front - which
    // is exactly the silent GL_INVALID_OPERATION overflow from Phase 11 waiting
    // for a scatter that came out denser than the guess.
    if (variant.props.length >= variant.mesh.instanceMatrix.count) {
      variant.mesh = growInstances(variant.mesh, state.scene);
    }
    variant.props.push(p);
    variant.mesh.count = variant.props.length;
    variant.dirty = true;
    list.push(p);
    return p;
  }

  // --- contact geometry -----------------------------------------------------
  const _up = new THREE.Vector3(0, 1, 0);
  const _axis = new THREE.Vector3();
  const _down = new THREE.Vector3();
  const _iq = new THREE.Quaternion();

  /**
   * Distance from the prop's centre to its lowest point, given its current
   * orientation. Spheres are constant; long props (trees) use the capsule
   * support function so a felled trunk lies flat on the ground instead of
   * hovering at half its height.
   */
  function supportOffset(p) {
    if (p.isLong) {
      _axis.copy(_up).applyQuaternion(p.quat);
      const uy = Math.abs(_axis.y);
      // Capsule support along -Y: half-length projected onto the axis, plus the
      // radius, which contributes at every orientation. Upright this returns the
      // full half-height; lying flat it returns just the radius.
      return p.halfLen * uy + p.radius;
    }

    // Ellipsoid support along -Y, with semi-axes (radius, halfH, radius).
    //
    // Treating a flat prop as a sphere of its HORIZONTAL radius hovers it above
    // the ground by the difference between its width and its height. The kit's
    // rocks are twice as wide as they are tall, so that gap is glaring. This is
    // exact when upright, exact on its side, and correct while tumbling.
    _down.set(0, -1, 0).applyQuaternion(_iq.copy(p.quat).invert());
    const ax = p.radius * _down.x;
    const ay = p.halfH * _down.y;
    const az = p.radius * _down.z;
    return Math.sqrt(ax * ax + ay * ay + az * az);
  }

  // --- scatter the world ----------------------------------------------------
  const treeSpots = scatter(terrain, rand, SCATTER.TREES, {
    minH: SCATTER.TREE_MIN_H,
    maxH: SCATTER.TREE_MAX_H,
    maxSlope: SCATTER.TREE_MAX_SLOPE,
    minDist: SCATTER.TREE_MIN_DIST
  });
  for (const sp of treeSpots) {
    // Which band this spot sits in decides what grows there: palms on the sand,
    // broadleaf in the lowland, pine on the heights. That is the whole reason
    // the island now reads as having regions rather than one uniform forest.
    const h = terrain.heightAt(sp.x, sp.z);
    let bi = BIOMES.findIndex((b) => h <= b.to);
    if (bi < 0) bi = BIOMES.length - 1;
    const pool = treeVariantsByBiome[bi];
    if (!pool || !pool.length) continue;
    const v = pool[(rand() * pool.length) | 0];
    // Scale spread is per-band, so a palm is not drawn at pine proportions.
    const band = BIOMES[bi];
    const mid = (band.height[0] + band.height[1]) / 2;
    const want = band.height[0] + rand() * (band.height[1] - band.height[0]);
    makeProp(v, sp.x, sp.z, want / mid);
  }

  const rockSpots = scatter(terrain, rand, SCATTER.ROCKS, {
    minH: SCATTER.ROCK_MIN_H,
    maxH: SCATTER.ROCK_MAX_H,
    maxSlope: SCATTER.ROCK_MAX_SLOPE,
    minDist: SCATTER.ROCK_MIN_DIST
  });
  for (const sp of rockSpots) {
    const v = rockVariants[(rand() * rockVariants.length) | 0];
    makeProp(v, sp.x, sp.z, 0.6 + rand() * 0.9);
  }

  const boulderSpots = scatter(terrain, rand, SCATTER.BOULDERS, {
    minH: 4,
    maxH: 48,
    maxSlope: 0.5,
    minDist: 22
  });
  for (const sp of boulderSpots) {
    const v = boulderVariants[(rand() * boulderVariants.length) | 0];
    if (v) makeProp(v, sp.x, sp.z, 0.75 + rand() * 0.6);
  }

  // --- physics --------------------------------------------------------------
  const _n = new THREE.Vector3();
  const _tangent = new THREE.Vector3();
  const _tmp = new THREE.Vector3();
  const _dq = new THREE.Quaternion();

  function wake(p) {
    p.awake = true;
    p.sleepT = 0;
    p.variant.dirty = true;
  }

  function impact(p, speed, normal) {
    const fx = state.fx;
    const power = Math.min(30, (speed - PHYS.IMPACT_THRESHOLD) * 0.5 * Math.min(4, p.mass));
    if (power <= 0) return;

    if (p.pos.y < WORLD.SEA_LEVEL + 0.5) {
      fx?.splash(p.pos, power);
      return;
    }

    fx?.burst(p.pos, power);

    // --- what did that landing hit? ---
    // Reported on the event bus rather than pushed into the creature directly:
    // the creature learns from it, and alignment judges it.
    const events = state.events;
    let killed = 0;
    if (state.villagers) {
      for (const v of state.villagers.list) {
        if (!v.alive) continue;
        if ((v.pos.x - p.pos.x) ** 2 + (v.pos.z - p.pos.z) ** 2 < 25) {
          v.alive = false;
          killed++;
        }
      }
    }
    if (killed) {
      // A prop only kills when something threw it, and the only thrower is you.
      events?.emit('villagers-killed',
        { count: killed, pos: p.pos, cause: 'crushed', byPlayer: true, by: 0 });
    }

    if (state.town && power > 12) {
      for (const b of [...state.town.buildings]) {
        const pad = b.def.pad * 0.75;
        if ((b.pos.x - p.pos.x) ** 2 + (b.pos.z - p.pos.z) ** 2 < pad * pad) {
          state.town.demolish(b);
          events?.emit('building-destroyed',
            { building: b, pos: p.pos, cause: 'crushed', byPlayer: true, by: 0 });
          break;
        }
      }
    }

    // Set down gently among villagers reads as feeding them, not attacking.
    if (!killed && power < 8 && state.villagers) {
      for (const v of state.villagers.list) {
        if (!v.alive) continue;
        if ((v.pos.x - p.pos.x) ** 2 + (v.pos.z - p.pos.z) ** 2 < 64) {
          events?.emit('villagers-fed', { pos: p.pos, cause: 'gift' });
          break;
        }
      }
    }

    // Gouge the ground. Heavier + faster = deeper, clamped so repeated hits in
    // one spot cannot drill a hole to the centre of the earth.
    const depth = Math.min(
      PHYS.MAX_CRATER_DEPTH,
      (speed - PHYS.IMPACT_THRESHOLD) * PHYS.CRATER_DEPTH * Math.min(3, p.mass)
    );
    if (depth > 0.05) {
      const radius = PHYS.CRATER_RADIUS * (1.4 + p.radius) * (0.8 + depth * 0.4);
      terrain.deform(p.pos.x, p.pos.z, radius, -depth);
      // Anything sitting on the ground we just moved has to re-settle.
      for (const q of list) {
        if (q === p || q.held) continue;
        const dx = q.pos.x - p.pos.x;
        const dz = q.pos.z - p.pos.z;
        if (dx * dx + dz * dz < radius * radius * 2.2) wake(q);
      }
    }

    // Shockwave: shove nearby props outward, falling off with distance.
    const R2 = PHYS.SHOCKWAVE_RADIUS * PHYS.SHOCKWAVE_RADIUS;
    for (const q of list) {
      if (q === p || q.held) continue;
      const dx = q.pos.x - p.pos.x;
      const dy = q.pos.y - p.pos.y;
      const dz = q.pos.z - p.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2 || d2 < 1e-4) continue;
      const d = Math.sqrt(d2);
      const f = (1 - d / PHYS.SHOCKWAVE_RADIUS) * PHYS.SHOCKWAVE_FORCE * power / Math.max(0.4, q.mass);
      q.vel.x += (dx / d) * f;
      q.vel.y += Math.abs(f) * 0.6 + 0.5;
      q.vel.z += (dz / d) * f;
      q.angVel.x += (Math.random() - 0.5) * f * 0.5;
      q.angVel.z += (Math.random() - 0.5) * f * 0.5;
      wake(q);
    }
  }

  function integrate(p, dt) {
    p.vel.y += PHYS.GRAVITY * dt;

    // Water: everything sinks. Nothing floats any more - a tree that went in
    // used to bob on the surface, which meant the sea slowly filled with
    // undisposable debris. Now wood is lost to it.
    const submerged = p.pos.y < WORLD.SEA_LEVEL;
    if (submerged) {
      const d = Math.exp(-PHYS.WATER_DRAG * dt);
      p.vel.multiplyScalar(d);
      p.angVel.multiplyScalar(d);
      if (!p.inWater) {
        p.inWater = true;
        const s = p.vel.length();
        if (s > 4) state.fx?.splash(p.pos, Math.min(22, s * 0.6 * Math.min(3, p.mass)));
      }

    } else {
      p.inWater = false;
    }

    // Drowning, judged on the GROUND BENEATH rather than on the prop's centre.
    //
    // The centre test was too clever: a tree is eighteen units tall, so dropped
    // into seven units of coastal water it simply stands on the bottom with its
    // middle in the air, never counts as submerged, and never drowns. You threw
    // it in the sea and it stood there. Whether a thing is in the water is a
    // question about the water, not about how tall the thing is.
    if (p.drowns) {
      const seabed = terrain.heightAt(p.pos.x, p.pos.z);
      if (seabed < WORLD.SEA_LEVEL - PHYS.DROWN_DEPTH) {
        p.drownT += dt;
        // Keep pulling it down so it visibly sinks out of sight rather than
        // hanging at the surface waiting for a timer.
        p.vel.y -= PHYS.SINK_PULL * dt;
        if (p.drownT >= PHYS.DROWN_TIME) {
          drown(p);
          return;
        }
      } else {
        p.drownT = 0; // back over dry land before it went under
      }
    }

    p.pos.addScaledVector(p.vel, dt);

    // Angular integration: treat angVel as an axis-angle rate.
    const a = p.angVel.length();
    if (a > 1e-4) {
      _dq.setFromAxisAngle(_tmp.copy(p.angVel).multiplyScalar(1 / a), a * dt);
      p.quat.premultiply(_dq).normalize();
    }

    // --- ground contact ---
    const ground = terrain.heightAt(p.pos.x, p.pos.z);
    const rest = ground + supportOffset(p);

    if (p.pos.y <= rest) {
      const impactSpeed = -p.vel.y;
      p.pos.y = rest;

      terrain.normalAt(p.pos.x, p.pos.z, _n);
      const vn = p.vel.dot(_n);

      if (vn < 0) {
        // Split into normal and tangential parts, bounce one and rub the other.
        _tangent.copy(p.vel).addScaledVector(_n, -vn);
        p.vel.copy(_tangent).multiplyScalar(PHYS.FRICTION).addScaledVector(_n, -vn * PHYS.RESTITUTION);

        const speed = Math.max(impactSpeed, _tangent.length());
        if (speed > PHYS.IMPACT_THRESHOLD) {
          impact(p, speed, _n);
          // A hard landing topples tall things - a tree that lands upright and
          // stays upright reads as a bug even though it is physically fine.
          if (p.isLong) {
            p.angVel.x += (Math.random() - 0.5) * speed * 0.35;
            p.angVel.z += (Math.random() - 0.5) * speed * 0.35;
          }
        }

        // Rolling: convert surface-tangential motion into spin.
        const roll = _tangent.length();
        if (roll > 0.2) {
          _tmp.crossVectors(_n, _tangent).multiplyScalar(roll * 0.06 / Math.max(0.3, p.radius));
          p.angVel.add(_tmp);
        }
      }

      // Angle of repose. Below REPOSE, static friction holds the prop still and
      // it can fall asleep; above it, the prop slides. Without the static case
      // an object on any incline creeps downhill forever and never sleeps,
      // which quietly pins a few hundred props awake for the whole session.
      p.groundT += dt;
      const slope = 1 - _n.y;
      if (slope > PHYS.REPOSE) {
        const accel = (slope - PHYS.REPOSE) * PHYS.SLIDE_ACCEL;
        p.vel.x += _n.x * accel * dt;
        p.vel.z += _n.z * accel * dt;
        const d = Math.exp(-PHYS.SLIDE_DRAG * dt);
        p.vel.x *= d;
        p.vel.z *= d;
      } else {
        const d = Math.exp(-PHYS.GROUND_FRICTION * dt);
        p.vel.x *= d;
        p.vel.z *= d;
      }
      p.angVel.multiplyScalar(Math.pow(PHYS.ANGULAR_DAMPING, dt * 20));

      // Sleep test: slow, on the ground, for long enough. The threshold relaxes
      // the longer a prop has been in continuous contact, so something rolling
      // slowly down a long cliff face still settles instead of grinding away
      // forever on the sim budget.
      // A drowning prop must never sleep: sleeping props are skipped entirely
      // by simStep, so its drown timer would stop advancing the moment it
      // touched the seabed and it would sit underwater forever.
      const drowning = p.drowns && p.pos.y < WORLD.SEA_LEVEL;
      const patience = p.groundT > PHYS.SETTLE_GRACE ? PHYS.SLEEP_SPEED_LATE : PHYS.SLEEP_SPEED;
      if (!drowning && p.vel.lengthSq() < patience * patience && p.angVel.lengthSq() < 0.05) {
        p.sleepT += dt;
        if (p.sleepT > PHYS.SLEEP_TIME) {
          p.awake = false;
          p.vel.set(0, 0, 0);
          p.angVel.set(0, 0, 0);
          p.pos.y = ground + supportOffset(p);
        }
      } else {
        p.sleepT = 0;
      }
    } else {
      p.sleepT = 0;
      p.groundT = 0; // airborne: contact patience resets
      p.angVel.multiplyScalar(Math.pow(0.995, dt * 20));
    }

    // Never let anything escape the map.
    const lim = WORLD.HALF - 4;
    if (p.pos.x < -lim || p.pos.x > lim || p.pos.z < -lim || p.pos.z > lim) {
      p.pos.x = THREE.MathUtils.clamp(p.pos.x, -lim, lim);
      p.pos.z = THREE.MathUtils.clamp(p.pos.z, -lim, lim);
      p.vel.x *= -0.3;
      p.vel.z *= -0.3;
    }
  }

  /**
   * Is this spot inside a building's skirt?
   *
   * Each structure clears its own pad plus REGROW.CLEARANCE, so a farm keeps a
   * wide margin and a storage pit only its doorstep. Read off `state.town`
   * rather than imported, the same way every other system reaches another.
   */
  function builtOver(at) {
    const buildings = state.town?.allBuildings;
    if (!buildings) return false;
    for (const b of buildings) {
      const r = b.def.pad * 0.9 + REGROW.CLEARANCE;
      const dx = b.pos.x - at.x;
      const dz = b.pos.z - at.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  function simStep(dt) {
    let awake = 0;
    for (const p of list) {
      // Sprouting is checked BEFORE the dead-skip below, because a dead prop is
      // exactly what it revives. Putting it after meant the whole block was
      // unreachable and no forest ever came back.
      if (p.dead) {
        if (!p.regrowAt || state.time < p.regrowAt) continue;
        // Nothing sprouts in someone's street. The stump remembers where it
        // grew, and if a building has gone up there since, that ground is spoken
        // for - permanently, because the building is not going anywhere.
        if (builtOver(p.home)) { p.regrowAt = 0; continue; }
        p.regrowAt = 0;
        p.dead = false;
        p.harvested = false;
        p.shrink = 1;
        p.wear = 1;             // a sapling: full wear is minimum size
        p.growing = true;
        p.claimedBy = null;
        p.held = false;
        p.awake = false;
        p.vel.set(0, 0, 0);
        p.angVel.set(0, 0, 0);
        p.quat.identity();
        p.prevQuat.identity();
        p.pos.set(p.home.x, 0, p.home.z);
        p.pos.y = terrain.heightAt(p.home.x, p.home.z) + supportOffset(p);
        p.prev.copy(p.pos);
        p.variant.dirty = true;
        awake++;
        continue;
      }

      // Growing up. Uses the wear channel in reverse, at its own much slower
      // rate - a tree takes REGROW.TIME to come back, not the couple of seconds
      // an abandoned chopping job takes to heal.
      if (p.growing) {
        p.wear = Math.max(0, p.wear - dt / REGROW.TIME);
        p.variant.dirty = true;
        awake++;
        if (p.wear <= 0) p.growing = false;
        // Only skip the rest for a sapling nobody is touching. Skipping
        // unconditionally meant a regrown tree you picked up never integrated:
        // released over water it hung in the air instead of sinking, because
        // physics never ran on it at all. Since Phase 8 most trees near a town
        // ARE regrown ones, so this was most of them.
        if (!p.held && !p.awake) continue;
      }

      // Wear grows only while someone is actually working the node. Left alone,
      // it grows back - otherwise a forest slowly fills with half-size trees
      // from jobs that were abandoned when the villager got hungry.
      if (p.wear > 0 && !p.wearTouched && !p.harvested) {
        p.wear = Math.max(0, p.wear - VILLAGER.WEAR_RECOVER * dt);
        p.variant.dirty = true;
        awake++;
      }
      p.wearTouched = false;

      // Harvested props shrink into the ground over ~0.7s, then stop existing
      // as far as the rest of the game is concerned.
      if (p.harvested && p.shrink > 0) {
        p.shrink -= dt / 0.7;
        p.variant.dirty = true;
        awake++;
        if (p.shrink <= 0) {
          p.shrink = 0;
          p.dead = true;
          p.awake = false;
        }
        continue;
      }

      if (p.held) {
        // The hand owns held objects; it has already moved them this tick.
        p.variant.dirty = true;
        awake++;
        continue;
      }
      if (!p.awake) continue;
      awake++;
      p.prev.copy(p.pos);
      p.prevQuat.copy(p.quat);

      // Adaptive sub-stepping: a boulder at 90 u/s moves 4.5 units per 20Hz
      // tick, which is bigger than the terrain cell, so it would punch straight
      // through a ridge. Cap the per-substep travel at ~0.7 units.
      const speed = p.vel.length();
      const sub = Math.min(8, Math.max(1, Math.ceil((speed * dt) / 0.7)));
      const sdt = dt / sub;
      for (let s = 0; s < sub; s++) integrate(p, sdt);

      p.variant.dirty = true;
    }
    state.debug.awakeProps = awake;
  }

  // --- rendering ------------------------------------------------------------
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();

  function syncRender(alpha) {
    for (const v of variants) {
      if (!v.dirty) continue;
      let stillMoving = false;
      for (let i = 0; i < v.props.length; i++) {
        const p = v.props[i];
        if (p.dead) {
          _m.makeScale(0, 0, 0);
          v.mesh.setMatrixAt(i, _m);
          continue;
        }
        if (p.awake || p.held) {
          // Interpolate between the last two sim ticks so 20Hz physics renders
          // smoothly at whatever the display refresh happens to be.
          _p.lerpVectors(p.prev, p.pos, alpha);
          _q.slerpQuaternions(p.prevQuat, p.quat, alpha);
          stillMoving = true;
        } else {
          _p.copy(p.pos);
          _q.copy(p.quat);
        }
        // Wear and the harvest shrink multiply: a node worked down to
        // WEAR_MIN_SCALE then collapses from there rather than snapping back
        // to full size for its final second.
        const worn = 1 - p.wear * (1 - VILLAGER.WEAR_MIN_SCALE);
        _s.setScalar(p.scale * p.shrink * worn);

        // Keep the BASE planted while it shrinks.
        //
        // Prop geometry is centred vertically, so `pos` is the middle of the
        // thing and scaling about it lifts the bottom clear of the ground. A
        // half-chopped tree hung five units in the air - the taller the prop the
        // worse it looked, which is why it was the trees that gave it away.
        //
        // supportOffset is exactly the distance from the origin down to the
        // contact point in the prop's CURRENT orientation, so this is right for
        // an upright tree, a felled one lying on its side, and a tumbling rock
        // alike. Only the wear factor is corrected: the harvest shrink is meant
        // to sink into the ground, and does.
        // Only while it is actually resting on something.
        //
        // supportOffset depends on ORIENTATION, and a prop in the hand is being
        // tumbled every tick - so applying this to a held tree swung the
        // correction across most of its length several times a second, which is
        // the shaking. In the air or in your grip there is no base to keep
        // planted, so the honest thing is to scale about the centre and leave
        // it alone.
        if (worn < 1 && !p.held && !p.awake) {
          _p.y -= supportOffset(p) * (1 - worn);
        }
        _m.compose(_p, _q, _s);
        v.mesh.setMatrixAt(i, _m);
      }
      v.mesh.instanceMatrix.needsUpdate = true;
      // One extra clean frame after everything sleeps, then stop uploading.
      v.dirty = stillMoving;
    }
  }

  function initialSync() {
    for (const v of variants) v.dirty = true;
    syncRender(1);
  }
  initialSync();

  // --- picking --------------------------------------------------------------
  const meshes = variants.map((v) => v.mesh);

  /** Returns { prop, point } for the nearest instance under the ray, or null. */
  function raycast(raycaster) {
    const hits = raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      const v = h.object.userData.variant;
      if (!v) continue;
      const p = v.props[h.instanceId];
      if (p && !p.dead && !p.harvested) return { prop: p, point: h.point, distance: h.distance };
    }
    return null;
  }

  /**
   * Forgiving screen-space pick, used when the exact raycast misses.
   *
   * Projects every live prop and returns whichever lands closest to the cursor,
   * provided it is within the tolerance. Each prop's own projected radius is
   * also allowed, so a big boulder keeps a big grab zone while a pebble gets at
   * least the flat tolerance.
   */
  const _proj = new THREE.Vector3();
  function pickNear(ndc, camera, viewW, viewH, tolerancePx) {
    const fovScale = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const camPos = camera.position;
    let best = null;
    let bestPx = Infinity;

    for (const p of list) {
      if (p.dead || p.harvested || p.held) continue;

      const dx = p.pos.x - camPos.x;
      const dy = p.pos.y - camPos.y;
      const dz = p.pos.z - camPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 400 * 400) continue; // far enough to be a pixel; not worth testing

      // Aim at the visual centre of mass, which for a tree is up the trunk.
      _proj.set(p.pos.x, p.pos.y + (p.isLong ? p.halfLen * 0.35 : 0), p.pos.z);
      _proj.project(camera);
      if (_proj.z > 1) continue; // behind the camera

      const px = (_proj.x - ndc.x) * 0.5 * viewW;
      const py = (_proj.y - ndc.y) * 0.5 * viewH;
      const dist = Math.hypot(px, py);
      if (dist >= bestPx) continue;

      const worldR = p.radius + (p.isLong ? p.halfLen : 0);
      const screenR = (worldR / Math.sqrt(d2)) * fovScale;
      const allow = Math.max(tolerancePx, screenR * PICK_RADIUS_SCALE);
      if (dist < allow) {
        bestPx = dist;
        best = p;
      }
    }
    return best ? { prop: best, point: best.pos.clone(), screenDist: bestPx } : null;
  }

  // --- hover highlight ------------------------------------------------------
  let highlighted = null;

  function writeTint(p, r, g, b) {
    const ic = p.variant.mesh.instanceColor;
    if (!ic) return;
    ic.setXYZ(p.index, r, g, b);
    ic.needsUpdate = true;
  }

  /** Brighten the prop the hand would grab right now. Pass null to clear. */
  function setHighlight(p) {
    if (highlighted === p) return;
    if (highlighted) writeTint(highlighted, 1, 1, 1);
    highlighted = p && !p.dead && !p.harvested ? p : null;
    if (highlighted) writeTint(highlighted, HIGHLIGHT[0], HIGHLIGHT[1], HIGHLIGHT[2]);
  }

  /**
   * Nearest unclaimed, still-standing resource node of a given type within
   * `maxDist` of a point. Used by villagers looking for work.
   */
  function findResource(resource, x, z, maxDist) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    for (const p of list) {
      if (p.dead || p.harvested || p.held || p.claimedBy) continue;
      if (p.resource !== resource) continue;
      // Ignore saplings: sending a woodsman to chop a shoot would turn a
      // regrowing forest into a treadmill that never actually recovers.
      if (p.growing && 1 - p.wear < REGROW.HARVESTABLE_AT) continue;
      const dx = p.pos.x - x;
      const dz = p.pos.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    return best;
  }

  /**
   * Is this tree still standing where it grew?
   *
   * Derived rather than flagged, so nothing has to remember to clear it: a tree
   * stops being planted the moment it is carried off or knocked off vertical,
   * and no other system needs a hook. That makes "felled timber" a property of
   * the world state itself rather than bookkeeping that can drift.
   */
  function isPlanted(p) {
    if (!p || p.dead || p.harvested || p.held) return false;
    if (p.kind !== 'tree') return false;
    const dx = p.pos.x - p.home.x;
    const dz = p.pos.z - p.home.z;
    if (dx * dx + dz * dz > PHYS.UPROOT_DIST * PHYS.UPROOT_DIST) return false;
    _axis.copy(_up).applyQuaternion(p.quat);
    return _axis.y > PHYS.UPRIGHT_DOT;
  }

  /**
   * Lost to the sea. Reuses the harvest machinery - shrink away, then stop
   * being pickable, physical or findable - so a villager already walking to
   * this tree abandons it the same way it would a felled one.
   */
  function drown(p) {
    if (!p || p.dead || p.harvested) return false;
    p.harvested = true;
    p.held = false;
    p.claimedBy = null;
    p.awake = true;
    p.variant.dirty = true;
    state.fx?.splash(p.pos.clone().setY(WORLD.SEA_LEVEL), 14);
    return true;
  }

  /**
   * Report how far through harvesting a node looks, 0..1.
   * Called every tick by whoever is working it; that is also what stops it
   * growing back while the work is going on.
   */
  function setWear(p, t) {
    if (!p || p.dead || p.harvested) return;
    const w = t < 0 ? 0 : t > 1 ? 1 : t;
    p.wearTouched = true;
    if (Math.abs(w - p.wear) < 0.002) return;   // no upload for invisible change
    p.wear = w;
    p.variant.dirty = true;
  }

  /** Strip a node: it shrinks away and stops being pickable or physical. */
  function harvest(p) {
    if (!p || p.dead || p.harvested) return false;
    // Only wood comes back. See REGROW in state.js for why stone does not.
    if (p.kind === 'tree') p.regrowAt = state.time + REGROW.DELAY;
    p.harvested = true;
    p.held = false;
    p.claimedBy = null;
    p.awake = true;
    p.variant.dirty = true;
    state.fx?.burst(p.pos, p.resource === 'wood' ? 7 : 5,
      p.resource === 'wood' ? 0x6f8f4a : 0x9a948c);
    return true;
  }

  /**
   * When the ground moves, anything standing on it has to re-settle.
   *
   * Building pads are levelled after the world is scattered, so props near the
   * town were left hanging in mid-air (or half-buried) with no way to notice.
   * Only props that are genuinely mis-seated are woken, which keeps this from
   * cascading: an untouched prop is not disturbed, so it cannot re-trigger.
   */
  state.events?.on('terrain-changed', ({ x, z, radius }) => {
    const r = radius * 1.3;
    const r2 = r * r;
    for (const p of list) {
      if (p.dead || p.held || p.awake) continue;
      const dx = p.pos.x - x;
      const dz = p.pos.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const rest = terrain.heightAt(p.pos.x, p.pos.z) + supportOffset(p);
      if (Math.abs(p.pos.y - rest) > 0.05) wake(p);
    }
  });

  const api = {
    list,
    variants,
    meshes,
    material: kitMaterial,
    raycast,
    pickNear,
    setWear,
    /** How many stumps are waiting to sprout, and how many are growing now. */
    get regrowth() {
      let waiting = 0;
      let growing = 0;
      for (const p of list) {
        if (p.dead && p.regrowAt) waiting++;
        else if (p.growing) growing++;
      }
      return { waiting, growing };
    },
    setHighlight,
    get highlighted() { return highlighted; },
    findResource,
    harvest,
    drown,
    isPlanted,
    wake,
    simStep,
    syncRender,
    supportOffset,
    get count() { return list.length; }
  };
  state.props = api;
  return api;
}
