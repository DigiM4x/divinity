// ---------------------------------------------------------------------------
// villagers.js - the population.
//
// Up to 150 agents in two InstancedMeshes (body + carried load), driven by a
// small state machine on the 20Hz sim clock and interpolated at render rate.
//
//   idle -> seek -> gather -> deliver -> idle
//   any  -> eat   (hunger high)
//   any  -> sleep (energy low)
//
// Resource nodes are the Phase 1 props: trees are felled for wood, stone is
// broken for ore. Food comes from farms the player builds.
//
// Publishes state.villagers.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { createGrid } from './lib/grid.js';
import { applyVertexColor, mergeGeos } from './lib/geo.js';
import { sizeToMax, groundAtOrigin } from './lib/models.js';
import { VILLAGER, WORLD, TOWN, PHYS, TRAITS, TRAIT_BUILD, TRAIT_COUNT, VILLAGER_NAMES, PRAYER} from './state.js';

// --- bodies -----------------------------------------------------------------
// Villagers are Kenney mini-characters. Those models are SKINNED, and three.js
// cannot instance a SkinnedMesh - 150 of them would mean 150 draw calls and 150
// skinning updates a frame, which breaks the budget this project was built to.
//
// So the skeleton is baked into a handful of static poses at load time and the
// crowd is bucketed between them each frame: a flipbook. The whole population
// animates in `characters x (1 + walkFrames)` draw calls regardless of size.

/** Scale every pose of one character by the same factor and stand it on y = 0. */
function preparePoses(poses, targetHeight) {
  poses.idle.computeBoundingBox();
  const b = poses.idle.boundingBox;
  const k = targetHeight / (b.max.y - b.min.y);
  // One shared offset rather than grounding each pose on its own lowest point:
  // the walk cycle's vertical bob lives in those few hundredths of a unit, and
  // levelling every frame individually would iron it flat.
  const footY = b.min.y;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  for (const g of [poses.idle, ...poses.walk]) {
    g.translate(-cx, -footY, -cz);
    g.scale(k, k, k);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return poses;
}

/** The little bundle a villager carries home, shown only when loaded. */
function makeLoadGeo() {
  const g = new THREE.BoxGeometry(0.42, 0.36, 0.42);
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

// ---------------------------------------------------------------------------
export function initVillagers(state) {
  const rand = mulberry32(state.seed ^ 0x2c5f);
  const terrain = state.terrain;

  const material = new THREE.MeshStandardMaterial({
    map: state.models.miniTexture,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    color: 0xc8c8c8
  });

  // One mesh per (character, pose). Villagers are re-bucketed every frame, so
  // each mesh must be able to hold the entire population in the worst case.
  const casts = state.villagerPoses.map((poses) => preparePoses(poses, VILLAGER.BODY_HEIGHT));
  const poseMeshes = [];
  for (let ci = 0; ci < casts.length; ci++) {
    const set = [casts[ci].idle, ...casts[ci].walk];
    poseMeshes.push(set.map((geo, pi) => {
      const m = new THREE.InstancedMesh(geo, material, VILLAGER.MAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const tint = new Float32Array(VILLAGER.MAX * 3).fill(1);
      m.instanceColor = new THREE.InstancedBufferAttribute(tint, 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.name = `villager_c${ci}_p${pi}`;
      state.scene.add(m);
      return m;
    }));
  }
  const WALK_FRAMES = casts[0].walk.length;

  const loadMesh = new THREE.InstancedMesh(makeLoadGeo(), material, VILLAGER.MAX);
  loadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  loadMesh.castShadow = true;
  loadMesh.frustumCulled = false;
  loadMesh.count = 0;
  loadMesh.name = 'villager_loads';
  state.scene.add(loadMesh);

  // --- lanterns ------------------------------------------------------------
  //
  // Phase 19 gave the island a night and left it lit only by the sky. A crowd
  // moving through the dark with nothing in their hands reads as a crowd that
  // cannot see, so after dusk they carry lanterns and the village becomes a
  // scatter of moving lights.
  //
  // TWO INSTANCED MESHES FOR THE WHOLE POPULATION, and not one real light. The
  // lantern is a kit piece made emissive; the flame is a small additive sphere.
  // Eighty shadow-casting point lights would end the frame budget, and under
  // ACES an emissive this bright reads as a flame anyway.
  const T = VILLAGER.TORCH;
  /**
   * How tall a villager actually is, in world units.
   *
   * Every torch dimension is a fraction of this. Resolving it once, here, next
   * to the meshes, is the whole guard against the mistake that made the first
   * version glow: there is no way to write a size for the flame without
   * dividing it by the person holding it.
   */
  const BODY = VILLAGER.BODY_HEIGHT * VILLAGER.SCALE;
  const lanternGeo = state.graveyardPieces?.get(T.PIECE);
  const lanternMesh = lanternGeo
    ? new THREE.InstancedMesh(
      groundAtOrigin(sizeToMax(lanternGeo.clone(), T.SIZE * BODY)),
      new THREE.MeshStandardMaterial({
        map: state.models.kitTexture('graveyard-kit'),
        vertexColors: true, roughness: 0.8, metalness: 0,
        emissive: new THREE.Color(T.EMISSIVE), emissiveIntensity: 0
      }),
      VILLAGER.MAX)
    : null;
  if (lanternMesh) {
    lanternMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    lanternMesh.frustumCulled = false;
    lanternMesh.count = 0;
    lanternMesh.name = 'villager_lanterns';
    state.scene.add(lanternMesh);
  }

  const glowMat = new THREE.MeshBasicMaterial({
    color: T.GLOW_COLOR, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending,
    // DEPTH-TESTED, explicitly. It is on by default and was never turned off,
    // but the first version paired `renderOrder: 6` with a flame wide enough to
    // swallow the body - so most of the sphere genuinely was in front of the
    // villager and additively painted over them. At this size it clears the
    // body entirely, and the depth test handles the rest.
    depthTest: true,
    depthWrite: false, fog: true
  });
  const glowMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 8, 6), glowMat, VILLAGER.MAX);
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.frustumCulled = false;
  glowMesh.count = 0;
  // No renderOrder override. Letting it sort normally with everything else is
  // what keeps a villager standing in front of a flame actually in front of it.
  glowMesh.name = 'villager_lantern_glow';
  state.scene.add(glowMesh);

  /** 0 = doused, 1 = fully lit. Eased, so dusk lights them gradually. */
  let lanternLit = 0;

  const list = [];

  /**
   * Villagers bucketed by position, rebuilt each sim tick. Needed the moment
   * they had to count the friends around them: done against the flat list that
   * is 150 x 150 distance tests per tick, which is the same product the soldier
   * grid was built to kill.
   */
  const villagerGrid = createGrid(VILLAGER.COURAGE_RADIUS);

  const TUNICS = [0x8c5b4a, 0x5f7a52, 0x6b6f8c, 0x8a7a4e, 0x7d5470, 0x4e7a7d];
  const LOAD_COLORS = { wood: 0x6f8f4a, ore: 0x9a948c, food: 0xd8b44a };
  const _c = new THREE.Color();

  // --- traits ---------------------------------------------------------------
  const TRAIT_KEYS = Object.keys(TRAITS);

  /**
   * Roll TRAIT_COUNT traits, never two from the same group - a villager who is
   * both Hardy and Sickly is a bug, not a personality.
   */
  function rollTraits() {
    const picked = [];
    const usedGroups = new Set();
    // Bounded rather than looping until satisfied: with a fixed table this
    // always fills, but a mistuned table must not hang the spawn.
    for (let tries = 0; tries < 40 && picked.length < TRAIT_COUNT; tries++) {
      const key = TRAIT_KEYS[(rand() * TRAIT_KEYS.length) | 0];
      const t = TRAITS[key];
      if (usedGroups.has(t.group)) continue;
      usedGroups.add(t.group);
      picked.push(key);
    }
    return picked;
  }

  /**
   * Collapse a villager's traits into one flat set of multipliers, once, at
   * birth. Everything downstream reads v.mods and never looks at the trait list
   * again, so a trait costs nothing per tick no matter how many there are.
   */
  function foldTraits(traits) {
    const mods = {
      hunger: 1, energy: 1, speed: 1, work: 1, yield: 1, meal: 1,
      starve: 1, armour: 1, belief: 1, idle: 1, flee: 1, wood: 1, ore: 1, food: 1
    };
    for (const key of traits) {
      const t = TRAITS[key];
      if (!t) continue;
      for (const k of Object.keys(mods)) {
        if (typeof t[k] === 'number') mods[k] *= t[k];
      }
    }
    return mods;
  }

  /**
   * Is this spot within reach of one of the town's work camps of a given kind?
   *
   * A lumber camp is a saw and a whetstone rather than a woodcutter, and a mine
   * is a winch and a lamp rather than a miner: neither harvests anything
   * itself, both make whoever is working nearby work faster. Which is why this
   * is asked about the NODE, not about the villager - the help is at the tree
   * or the rock face, and walking back to town with the load is no quicker for
   * it.
   */
  function nearCamp(town, at, flag, radius) {
    if (!at) return false;
    const r2 = radius * radius;
    for (const b of town.buildings) {
      if (!b.def[flag]) continue;
      const dx = b.pos.x - at.x;
      const dz = b.pos.z - at.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /** Job time for this villager, with both the general and the per-job trait. */
  function workTimeFor(v, job, at = null) {
    const base = job === 'food' ? VILLAGER.FARM_TIME
      : job === 'ore' ? VILLAGER.MINE_TIME
        : VILLAGER.CHOP_TIME;
    let t = base * v.mods.work * v.mods[job === 'food' ? 'food' : job];
    // Each camp's whole purpose. A multiplier on SPEED, so the work takes
    // 1/SPEED of the time - 1.5 really is the "50% faster" it says on the tin.
    if (job === 'wood' && nearCamp(v.town, at, 'lumber', TOWN.LUMBER_RADIUS)) {
      t /= TOWN.LUMBER_SPEED;
    }
    if (job === 'ore' && nearCamp(v.town, at, 'mine', TOWN.MINE_RADIUS)) {
      t /= TOWN.MINE_SPEED;
    }
    // The workshop helps with EVERY kind of work, which is what separates it
    // from the camp and the mine - those each speed up one resource. Still
    // judged at the work site like the other two, so siting is a real decision
    // and a workshop in the square helps nobody. Stacks with them on purpose.
    if (nearCamp(v.town, at, 'workshop', TOWN.WORKSHOP_RADIUS)) {
      t /= TOWN.WORKSHOP_SPEED;
    }
    return t;
  }

  /**
   * Ids must not be reused. Props record `claimedBy = v.id`, so if a recycled
   * slot handed out an id that a dead villager had held, a live worker could
   * release - or be blocked by - a claim that was never theirs.
   */
  let nextVillagerId = 1;

  function spawn(x, z, town = state.town.playerTown) {
    if (list.length >= VILLAGER.MAX) return null;
    const i = list.length;

    // Scatter arrivals around the drop point so they do not stack up.
    const a = rand() * Math.PI * 2;
    const r = 2 + rand() * 5;
    // ...and never inside a keep. Both callers spawn AT `town.centre` - the
    // opening population and every birth - which is now the middle of a solid
    // castle. They were only pushed out once they happened to walk somewhere,
    // so a newborn stood in the stonework until it got hungry. Resolved here
    // rather than at the call sites, so any future caller gets it too.
    const solid = state.town.pushOutOfCentres(x + Math.cos(a) * r, z + Math.sin(a) * r);
    const px = solid.x;
    const pz = solid.z;

    const v = {
      id: nextVillagerId++,
      index: i,
      pos: new THREE.Vector3(px, terrain.heightAt(px, pz), pz),
      prev: new THREE.Vector3(px, terrain.heightAt(px, pz), pz),
      yaw: rand() * Math.PI * 2,
      prevYaw: 0,

      state: 'idle',
      /** 'wood' | 'ore' | 'food' */
      job: null,
      targetProp: null,
      targetBuilding: null,
      dest: new THREE.Vector3(),
      hasDest: false,

      workTimer: 0,
      /** The full duration of the current job, for the wear fraction. */
      workTotal: 0,
      retryTimer: rand() * VILLAGER.IDLE_RETRY,
      carry: 0,
      carryType: null,

      /** True only once actually lying down, not while walking to bed. */
      resting: false,
      /** Counts down while no threat is in sight; at 0 they go back to work. */
      calmTimer: 0,
      /** The soldier this villager is swinging at, or null. */
      foe: null,

      // --- being picked up ---
      // The divine hand carries villagers with the same damped spring it uses
      // for rocks, so they need the same handful of fields it reads. A villager
      // is deliberately light: they fly further than a boulder for the same
      // flick, which is most of the point of picking one up.
      /** True while in the hand. Suspends thinking, moving and needs. */
      held: false,
      /** True while in the air after being thrown, until it lands or drowns. */
      flying: false,
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      mass: VILLAGER.GRAB_MASS,
      radius: VILLAGER.GRAB_RADIUS,
      kind: 'villager',
      /** Draw scale from traits. See TRAIT_BUILD. */
      build: 1,
      hunger: rand() * 0.3,
      energy: 0.6 + rand() * 0.4,
      health: 1,
      /** Walk-cycle phase, so the crowd is not in lockstep. */
      phase: rand() * Math.PI * 2,
      /** Which town this villager belongs to. Drives every job decision. */
      town,
      /** Which baked character this villager wears. */
      cast: (rand() * 1000) | 0,
      /**
       * A name, so this is a person and not a row.
       *
       * Seeded like everything else, and suffixed when the pool wraps rather
       * than repeating flatly - a town of forty should not contain four
       * unrelated Maras with no way to tell them apart.
       */
      name: VILLAGER_NAMES[nextVillagerId % VILLAGER_NAMES.length]
        + (nextVillagerId >= VILLAGER_NAMES.length
           ? ' ' + 'IVXLC'[Math.min(4, Math.floor(nextVillagerId / VILLAGER_NAMES.length))]
           : ''),
      /** Two traits, fixed for life, and the multipliers they fold down to. */
      traits: [],
      mods: null,
      tunic: TUNICS[(rand() * TUNICS.length) | 0],
      alive: true,
      /** Set while this villager is in danger and being carried. See markPeril. */
      peril: null
    };
    v.prevYaw = v.yaw;
    list.push(v);

    v.traits = rollTraits();
    v.mods = foldTraits(v.traits);
    // Build: what a crowd shows of who these people are. See TRAIT_BUILD.
    v.build = v.traits.reduce((k, t) => k * (TRAIT_BUILD[t] ?? 1), 1);

    v.cast = v.cast % poseMeshes.length;
    loadMesh.count = list.length;
    loadMesh.setColorAt(i, _c.set(0xffffff));
    loadMesh.instanceColor.needsUpdate = true;
    return v;
  }

  // --- helpers --------------------------------------------------------------

  /**
   * Give up whatever this villager had reserved.
   *
   * The farm worker slot is released HERE, because this is the one place that
   * clears `targetBuilding` and so it has to be the place that owns the
   * bookkeeping. It did not, and the leak was fatal: a villager who got sleepy
   * on the way to a farm went off to bed through this function and never gave
   * the slot back. Every farm in the world eventually read 3/3 workers with
   * nobody actually working it, no villager could ever be assigned to farm
   * again, and every town - the player's and both rivals' - starved to death at
   * around minute eight with its fields at full crop.
   *
   * The two call sites that appeared to handle this checked `v.targetBuilding`
   * AFTER calling this function, by which point it was already null, so they
   * were dead code that made the bug look handled.
   */
  function releaseTarget(v) {
    if (v.targetProp && v.targetProp.claimedBy === v.id) v.targetProp.claimedBy = null;
    if (v.targetBuilding?.def?.farm) {
      v.targetBuilding.workers = Math.max(0, v.targetBuilding.workers - 1);
    }
    v.targetProp = null;
    v.targetBuilding = null;
    v.hasDest = false;
  }

  function setDest(v, x, z) {
    v.dest.set(x, terrain.heightAt(x, z), z);
    v.hasDest = true;
  }

  function atDest(v) {
    if (!v.hasDest) return true;
    const dx = v.dest.x - v.pos.x;
    const dz = v.dest.z - v.pos.z;
    return dx * dx + dz * dz < VILLAGER.ARRIVE_DIST * VILLAGER.ARRIVE_DIST;
  }

  /** Which resource this villager's town is shortest of. */
  function chooseJob(v) {
    const town = v.town;
    const r = town.resources;
    // Targets scale with the mouths that have to be fed. See TOWN.FOOD_PER_HEAD
    // for why a fixed number here starved every town in the world.
    const pop = town.pop || 1;
    const scores = {
      // Food is life: weight it hard when the larder is thin.
      food: (TOWN.FOOD_FLOOR + pop * TOWN.FOOD_PER_HEAD - r.food) * 1.4,
      wood: (TOWN.WOOD_FLOOR + pop * TOWN.WOOD_PER_HEAD - r.wood) * 1.0,
      ore: (TOWN.ORE_FLOOR + pop * TOWN.ORE_PER_HEAD - r.ore) * 0.7
    };
    // Only pick farming if a farm with a ready crop actually exists.
    if (!town || !town.buildings.some((b) => b.def.farm && b.crop > 0.35)) {
      scores.food = -Infinity;
    }
    let best = null;
    let bestScore = -Infinity;
    for (const [k, s] of Object.entries(scores)) {
      if (s > bestScore) { bestScore = s; best = k; }
    }
    // `best` even when nothing is short.
    //
    // The fallback was a hardcoded 'wood', so once every store was full the
    // whole town chopped timber forever - 83 of 95 woodcutters sitting on 8,035
    // wood in a 25-minute run, which is not laziness but is just as useless.
    // The scores are "how far below target", so the highest of them is already
    // the least oversupplied thing: taking it keeps the stores level instead of
    // burying the town in one commodity.
    return best ?? 'wood';
  }

  /**
   * Where a carrier puts its load down.
   *
   * The keep is solid now, so `town.centre` is a point inside a wall and can
   * never be arrived at - ARRIVE_DIST is 1.6 and the stonework starts at 10.5.
   * A town with no storage hut would have had every carrier walk to the wall,
   * fail to arrive, and never deposit anything again: the whole economy, gone
   * silently, for want of a door. `gateOf` is the door.
   */
  function dropOffPoint(v) {
    const town = v.town;
    const store = state.town.findBuildingIn(town, (b) => b.def.storage, v.pos.x, v.pos.z);
    return store ? store.pos : state.town.gateOf(town, v.pos.x, v.pos.z);
  }

  // --- state machine --------------------------------------------------------

  function think(v, dt) {
    const town = v.town;
    const props = state.props;

    switch (v.state) {
      case 'idle': {
        v.retryTimer -= dt;
        if (v.retryTimer > 0) break;
        v.retryTimer = VILLAGER.IDLE_RETRY * v.mods.idle;

        const job = chooseJob(v);
        const reach = town.influenceRadius + VILLAGER.SEARCH_SLACK;

        if (job === 'food') {
          const farm = state.town.findBuildingIn(
            town,
            (b) => b.def.farm && b.crop > 0.35 && b.workers < b.def.workSlots,
            v.pos.x, v.pos.z
          );
          if (farm) {
            farm.workers++;
            v.job = 'food';
            v.targetBuilding = farm;
            setDest(v, farm.pos.x, farm.pos.z);
            v.state = 'seek';
            break;
          }
        }

        const resource = job === 'food' ? 'wood' : job;
        // Look further before giving up.
        //
        // The search was one sweep of `influenceRadius + 12` around the centre,
        // and the moment the nearby wood was stripped the whole town stood
        // around wandering until it regrew - which reads as a lazy population
        // rather than a worked-out one. They will now walk out to FAR_SLACK for
        // it, and take the other resource if their first choice is gone, before
        // anyone gives up and mills about.
        let picked = resource;
        let node = props.findResource(picked, town.centre.x, town.centre.z, reach);
        if (!node) {
          node = props.findResource(picked, town.centre.x, town.centre.z,
            town.influenceRadius + VILLAGER.FAR_SLACK);
        }
        if (!node) {
          // Whatever else there is. An idle pair of hands is worth more on the
          // wrong resource than on none.
          picked = resource === 'wood' ? 'ore' : 'wood';
          node = props.findResource(picked, town.centre.x, town.centre.z,
            town.influenceRadius + VILLAGER.FAR_SLACK);
        }
        if (node) {
          node.claimedBy = v.id;
          // `picked`, not `resource`: the fallback may have switched them onto
          // the other one, and assigning `resource` here would send them to a
          // rock while believing they were cutting wood. Reading `v.job` back
          // instead would be worse - it still holds the job they finished last
          // time, so a stale value would win over a fresh choice.
          v.job = picked;
          v.targetProp = node;
          setDest(v, node.pos.x, node.pos.z);
          v.state = 'seek';
        } else {
          // Nothing to do: drift around the town centre so the crowd looks alive.
          const a = rand() * Math.PI * 2;
          const r = 4 + rand() * (town.influenceRadius * 0.35);
          const x = town.centre.x + Math.cos(a) * r;
          const z = town.centre.z + Math.sin(a) * r;
          if (terrain.heightAt(x, z) > VILLAGER.MIN_WALK_HEIGHT) {
            setDest(v, x, z);
            v.state = 'wander';
          }
        }
        break;
      }

      case 'wander': {
        if (atDest(v)) { v.state = 'idle'; v.hasDest = false; }
        break;
      }

      case 'fight': {
        const foe = v.foe;
        if (!foe || !foe.alive) { v.hasDest = false; v.state = 'idle'; break; }
        const d = Math.hypot(foe.pos.x - v.pos.x, foe.pos.z - v.pos.z);
        if (d > VILLAGER.FIGHT_RANGE) break;   // still closing; move() handles it
        v.hasDest = false;
        // Face them and swing. The kill itself is left to combat.js, which
        // already sweeps for soldiers on zero hit points and handles the
        // effects - there is no reason for two systems to know how a man dies.
        v.yaw = Math.atan2(foe.pos.x - v.pos.x, foe.pos.z - v.pos.z);
        foe.hp -= VILLAGER.FIGHT_DPS * dt;
        break;
      }

      case 'flee': {
        // checkNeeds refreshes the destination while anything is still in
        // sight. Getting here means nothing is - so wait out the calm, using a
        // widened radius so a villager on the boundary does not flicker between
        // bolting and going back to the hoe.
        v.calmTimer -= dt;
        if (atDest(v)) v.hasDest = false;
        if (v.calmTimer <= 0 && !threatNear(v, VILLAGER.FLEE_HYSTERESIS)) {
          v.hasDest = false;
          v.state = 'idle';
        }
        break;
      }

      case 'seek': {
        // The target can vanish underneath us (thrown into the sea, built over).
        if (v.targetProp && (v.targetProp.dead || v.targetProp.harvested)) {
          releaseTarget(v);
          v.state = 'idle';
          break;
        }
        if (v.targetProp) setDest(v, v.targetProp.pos.x, v.targetProp.pos.z);
        if (atDest(v)) {
          v.state = 'gather';
          // The work SITE, whichever kind it is. Farming targets a building and
          // everything else targets a prop, so passing only `targetProp` handed
          // `undefined` to every farmer - which the camps never noticed, since
          // they only care about wood and ore, but which would have made the
          // workshop silently worthless for food.
          v.workTimer = workTimeFor(v, v.job, v.targetProp?.pos ?? v.targetBuilding?.pos);
          v.workTotal = v.workTimer;   // remembered so wear can be a fraction
        }
        break;
      }

      case 'gather': {
        v.workTimer -= dt;
        // Shrink the node as the work goes in. Farms are a building, not a
        // prop, and have their own crop level to show for it.
        if (v.targetProp && v.workTotal > 0) {
          state.props.setWear(v.targetProp, 1 - v.workTimer / v.workTotal);
        }
        if (v.workTimer > 0) break;

        if (v.job === 'food') {
          const farm = v.targetBuilding;
          if (farm && farm.crop > 0.35) {
            farm.crop = Math.max(0, farm.crop - 0.45);
            v.carry = Math.round(VILLAGER.FOOD_PER_HARVEST * v.mods.yield);
            v.carryType = 'food';
          }
          if (farm) farm.workers = Math.max(0, farm.workers - 1);
          v.targetBuilding = null;
        } else if (v.targetProp && !v.targetProp.dead && !v.targetProp.harvested) {
          const node = v.targetProp;
          v.carry = Math.round(
            (node.resource === 'wood' ? VILLAGER.WOOD_PER_TREE : VILLAGER.ORE_PER_ROCK)
            * v.mods.yield);
          v.carryType = node.resource;
          state.props.harvest(node);
        }
        releaseTarget(v);

        // The one fact this game never announced: somebody just did a piece of
        // work. Everything else a villager does was already on the bus - born,
        // fed, killed, rescued - but the thing they spend most of their lives
        // doing was silent, which left the axe and the pick with nothing to
        // hang on. Announced as a fact like all the rest; sound.js listens and
        // nothing else has to care.
        state.events?.emit('villager-worked', {
          job: v.job, pos: v.pos, town: v.town
        });

        if (v.carry > 0) {
          const drop = dropOffPoint(v);
          setDest(v, drop.x, drop.z);
          v.state = 'deliver';
        } else {
          v.state = 'idle';
        }
        break;
      }

      case 'deliver': {
        if (atDest(v)) {
          v.town.resources[v.carryType] = (v.town.resources[v.carryType] ?? 0) + v.carry;
          v.carry = 0;
          v.carryType = null;
          v.hasDest = false;
          v.state = 'idle';
        }
        break;
      }

      case 'eat': {
        if (!atDest(v)) break;
        v.workTimer -= dt;
        if (v.workTimer <= 0) {
          const meal = VILLAGER.FOOD_PER_MEAL * v.mods.meal;
          if (v.town.resources.food >= meal) {
            v.town.resources.food -= meal;
            v.hunger = 0;
          } else {
            // No food in store: stay hungry and take damage.
            v.hunger = 0.9;
          }
          v.hasDest = false;
          v.state = 'idle';
        }
        break;
      }

      case 'sleep': {
        // Walk to the bed first. Clearing hasDest on arrival is what stops the
        // villager; blocking movement on state === 'sleep' instead would mean
        // they can never reach the bed and so never recover.
        if (!atDest(v)) break;
        v.hasDest = false;
        v.resting = true;
        v.energy = Math.min(1, v.energy + VILLAGER.SLEEP_RATE * dt);
        if (v.energy >= 0.98) {
          v.resting = false;
          v.state = 'idle';
        }
        break;
      }
    }
  }

  // --- fear -----------------------------------------------------------------
  //
  // Every living villager asks "is there an enemy soldier near me?" every tick.
  // Done against the flat soldier array that is 150 x 120 distance tests per
  // tick, which is why this is the thing that finally justified the spatial
  // hash: it asks the grid for the one cell neighbourhood that can matter.

  /**
   * Nearest hostile soldier within this villager's own fright distance, or null.
   * Brave villagers let one get much closer than Timid ones do.
   */
  function threatNear(v, scale = 1) {
    const grid = state.combat?.soldierGrid;
    if (!grid) return null;
    const r = VILLAGER.FLEE_RADIUS * v.mods.flee * scale;
    // Owner, not `isPlayer !== isPlayer`, which said two rivals' soldiers were
    // no threat to each other's farmers: both were `false`, so a raiding party
    // could walk into a rival village and nobody in it would so much as look up.
    return grid.nearest(v.pos.x, v.pos.z, r,
      (s) => s.alive && s.town.owner !== v.town.owner);
  }

  /**
   * Does this villager stand and fight, or run?
   *
   * Courage in numbers, scaled by nerve. Counted locally rather than
   * town-wide, so a lone farmer at the treeline runs even while a mob is
   * holding the square a hundred units away - which is both truer and the
   * reason the same raid produces flight in one place and a brawl in another.
   */
  function willFight(v, threat) {
    const R = VILLAGER.COURAGE_RADIUS;
    let friends = 0;
    villagerGrid.near(v.pos.x, v.pos.z, R, (o) => {
      if (o.town === v.town && o.alive) friends++;
    });

    let foes = 0;
    const grid = state.combat?.soldierGrid;
    if (grid) {
      grid.near(v.pos.x, v.pos.z, R, (o) => {
        if (o.alive && o.town.owner !== v.town.owner) foes++;
      });
    }
    if (foes === 0) return false;

    const needed = VILLAGER.COURAGE_RATIO * v.mods.flee * foes;
    return friends >= needed;
  }

  /**
   * Point the villager away from danger: the town centre normally, but running
   * toward the enemy to reach it is worse than useless, so a threat that lies
   * between them sends the villager directly away instead.
   */
  function fleeTo(v, threat) {
    const c = v.town.centre;
    const toCentre = Math.atan2(c.x - v.pos.x, c.z - v.pos.z);
    const toThreat = Math.atan2(threat.pos.x - v.pos.x, threat.pos.z - v.pos.z);
    let diff = toCentre - toThreat;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) > 1.0) {
      // The gate, not the centre: the centre is inside the keep.
      const g = state.town.gateOf(v.town, v.pos.x, v.pos.z);
      setDest(v, g.x, g.z); // the keep is safely away from the threat
      return;
    }

    // Directly away. Water and cliffs are handled by move(), which gives up on
    // an unreachable destination - so also try a couple of fanned-out bearings
    // rather than freezing against a shoreline with a soldier behind us.
    const away = toThreat + Math.PI;
    for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
      const x = v.pos.x + Math.sin(away + off) * VILLAGER.FLEE_AWAY_DIST;
      const z = v.pos.z + Math.cos(away + off) * VILLAGER.FLEE_AWAY_DIST;
      if (terrain.heightAt(x, z) > VILLAGER.MIN_WALK_HEIGHT) {
        setDest(v, x, z);
        return;
      }
    }
    setDest(v, c.x, c.z); // cornered: make for home and hope
  }

  /** Needs override whatever the villager was doing. */
  function checkNeeds(v) {
    // Fear comes before every other need, and interrupts sleep and meals too -
    // which is the whole point, since a villager asleep in a burning house was
    // the most obviously broken thing about a raid.
    const threat = threatNear(v);
    if (threat) {
      const stand = willFight(v, threat);
      const want = stand ? 'fight' : 'flee';
      if (v.state !== want) {
        releaseTarget(v); // gives the farm slot back too
        v.resting = false;
        v.state = want;
      }
      v.calmTimer = VILLAGER.FLEE_CALM;
      if (stand) {
        v.foe = threat;
        setDest(v, threat.pos.x, threat.pos.z);
      } else {
        v.foe = null;
        fleeTo(v, threat);
      }
      return;
    }
    v.foe = null;

    if (v.state === 'eat' || v.state === 'sleep') return;

    if (v.hunger >= VILLAGER.HUNGER_EAT_AT
        && v.town.resources.food >= VILLAGER.FOOD_PER_MEAL * v.mods.meal) {
      releaseTarget(v);
      const drop = dropOffPoint(v);
      setDest(v, drop.x, drop.z);
      v.workTimer = VILLAGER.EAT_DURATION;
      v.state = 'eat';
      return;
    }

    if (v.energy <= VILLAGER.ENERGY_SLEEP_AT) {
      releaseTarget(v);
      const home = state.town.findBuildingIn(v.town, (b) => b.def.housing, v.pos.x, v.pos.z);
      const spot = home ? home.pos
        : state.town.gateOf(v.town, v.pos.x, v.pos.z);
      setDest(v, spot.x, spot.z);
      v.state = 'sleep';
    }
  }

  // --- movement -------------------------------------------------------------
  const _dir = new THREE.Vector3();

  function move(v, dt) {
    if (!v.hasDest) return;
    _dir.set(v.dest.x - v.pos.x, 0, v.dest.z - v.pos.z);
    const d = _dir.length();
    if (d < 0.05) return;
    _dir.multiplyScalar(1 / d);

    // Terror overrides tiredness: a fleeing villager runs flat out regardless of
    // how little energy is left, which is both true to life and stops an
    // exhausted crowd being wiped out because it could only shamble.
    const speed = (v.state === 'flee' || v.state === 'fight')
      ? VILLAGER.WALK_SPEED * v.mods.speed * VILLAGER.FLEE_SPEED
      : VILLAGER.WALK_SPEED * v.mods.speed * (0.65 + 0.35 * v.energy);
    const step = Math.min(d, speed * dt);
    const nx = v.pos.x + _dir.x * step;
    const nz = v.pos.z + _dir.z * step;

    // Villagers will not wade. If the next step is underwater, stop and give up
    // on this destination rather than marching into the sea.
    const h = terrain.heightAt(nx, nz);
    if (h < VILLAGER.MIN_WALK_HEIGHT) {
      v.hasDest = false;
      releaseTarget(v);
      // Dropping to 'idle' here would strand a fleeing villager at the water's
      // edge with a soldier behind them; leave them fleeing and checkNeeds will
      // pick a different bearing on the next tick.
      if (v.state !== 'flee' && v.state !== 'fight') v.state = 'idle';
      return;
    }

    // The keep is solid. Anything walking into it is projected back onto the
    // wall, which keeps the tangential part of the step and so walks them
    // AROUND the castle rather than stopping them dead against it.
    const solid = state.town.pushOutOfCentres(nx, nz);
    const fx = solid.x;
    const fz = solid.z;
    v.pos.set(fx, solid.hit ? terrain.heightAt(fx, fz) : h, fz);
    // Turn toward travel, shortest way round.
    let dy = Math.atan2(_dir.x, _dir.z) - v.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    v.yaw += dy * Math.min(1, 9 * dt);
    v.phase += step * 3.2;
  }

  // --- thrown villagers -----------------------------------------------------

  /**
   * One tick of a villager in the air. It ends one of two ways: the sea, or the
   * ground. Nothing else is modelled - no bouncing, no rolling - because a
   * tumbling villager reads as a ragdoll and these are flipbooks.
   */
  function flightStep(v, dt) {
    v.vel.y += PHYS.GRAVITY * dt;
    v.pos.addScaledVector(v.vel, dt);
    v.yaw += v.angVel.y * dt;

    const ground = terrain.heightAt(v.pos.x, v.pos.z);

    // The sea. Drowning is the whole reason for being able to pick people up.
    if (ground < VILLAGER.MIN_WALK_HEIGHT && v.pos.y <= WORLD.SEA_LEVEL + 0.6) {
      drown(v);
      return;
    }

    if (v.pos.y <= ground) {
      // Thrown over a wall and dropped inside it. Walking pushes them out, but
      // an idle villager never walks, so one dropped in the courtyard would
      // simply live inside the stonework. Resolve it where they land.
      const solid = state.town.pushOutOfCentres(v.pos.x, v.pos.z);
      if (solid.hit) {
        v.pos.x = solid.x;
        v.pos.z = solid.z;
      }
      v.pos.y = solid.hit ? terrain.heightAt(v.pos.x, v.pos.z) : ground;
      v.flying = false;
      // Falling hurts, past a speed you could survive stepping off a rock.
      const impact = Math.abs(v.vel.y);
      if (impact > VILLAGER.FALL_SAFE_SPEED) {
        v.health -= (impact - VILLAGER.FALL_SAFE_SPEED) * VILLAGER.FALL_DAMAGE;
        if (v.health <= 0) { kill(v, 'dropped'); return; }
      }
      v.vel.set(0, 0, 0);
      v.angVel.set(0, 0, 0);
      // They lived. Everyone who saw it believes a little harder.
      if (v.thrownFrom) state.miracles?.thrownBeliever?.(v, v.thrownFrom, v.pos);
      // ...and if they were in trouble when they were picked up and are not in
      // trouble now, somebody rescued them. Announced as a fact; prayers.js
      // decides whether it answered anything.
      if (v.peril) {
        const away = Math.hypot(v.pos.x - v.peril.x, v.pos.z - v.peril.z);
        if (away >= PRAYER.SAFE_DISTANCE) {
          state.events?.emit('villager-rescued', { villager: v, pos: v.pos, by: 'player' });
        }
        v.peril = null;
      }
      // Badly shaken: they pick themselves up and run, rather than calmly
      // resuming the job they were walking to before a god interrupted.
      releaseTarget(v);
      v.state = 'flee';
      v.calmTimer = VILLAGER.FLEE_CALM;
    }
  }

  /**
   * Kill a villager and tell the world, so alignment and the creature hear.
   *
   * `byPlayer` defaults true because the two original callers - dropped and
   * drowned - are only reachable by throwing somebody. Starvation passes false:
   * you let it happen, you did not do it, and the difference is what alignment
   * is reading.
   */
  /**
   * @param byPlayer  whether this is charged to the player's soul
   * @param by        the faction responsible, or -1 for the world. Starvation
   *                  and drowning have nobody behind them, and saying "the
   *                  player" there would make a famine somebody's crime.
   */
  function kill(v, cause, byPlayer = true, by = byPlayer ? 0 : -1) {
    if (!v.alive) return;
    v.alive = false;
    v.held = false;
    v.flying = false;
    releaseTarget(v);
    state.events?.emit('villagers-killed', {
      count: 1, pos: v.pos.clone(), cause, byPlayer, by
    });
    state.debug.lastLog = 'villager #' + v.id + ' ' + cause;
  }

  function drown(v) {
    v.pos.y = WORLD.SEA_LEVEL;
    state.fx?.splash(v.pos.clone().setY(WORLD.SEA_LEVEL), 12);
    kill(v, 'drowned');
  }

  // --- sim ------------------------------------------------------------------
  function simStep(dt) {
    if (!state.town) return;

    villagerGrid.rebuild(list, (v) => v.alive && !v.held && !v.flying);

    for (const v of list) {
      if (!v.alive) continue;
      v.prev.copy(v.pos);
      v.prevYaw = v.yaw;

      // In the hand: the spring owns the position and nothing else runs. No
      // hunger, no jobs, no fleeing - a villager in the grip of its god has
      // other things on its mind.
      if (v.held) continue;

      // Thrown: ballistic until it hits something.
      if (v.flying) { flightStep(v, dt); continue; }

      v.hunger = Math.min(1.2, v.hunger + VILLAGER.HUNGER_RATE * v.mods.hunger * dt);
      if (v.state !== 'sleep') {
        v.energy = Math.max(0, v.energy - VILLAGER.ENERGY_RATE * v.mods.energy * dt);
      }

      // Starvation only bites once hunger is past full and the store is empty.
      if (v.hunger > 1 && v.town.resources.food < VILLAGER.FOOD_PER_MEAL) {
        v.health -= VILLAGER.STARVE_DAMAGE * v.mods.starve * dt;
        if (v.health <= 0) {
          // Through `kill` rather than setting the flag by hand. This path set
          // `alive = false` directly and announced nothing, so THE COMMONEST
          // DEATH IN THE GAME was invisible to every system that listens:
          // no grave was dug for it, Phase 17 never counted it, and the rolling
          // death window that Stability reads never saw a famine at all.
          kill(v, 'starved', false);
          continue;
        }
      } else if (v.health < 1) {
        v.health = Math.min(1, v.health + 0.05 * dt);
      }

      checkNeeds(v);
      think(v, dt);
      move(v, dt);
    }

    // Bury the dead.
    //
    // `list` only ever grew, so VILLAGER.MAX was a LIFETIME cap rather than a
    // concurrent one - and unlike the soldier version of this bug, which merely
    // stopped armies, this one stopped BIRTHS. After 150 villagers had ever
    // lived, every town in the world was permanently barren, with `spawn`
    // returning null and `growthBlocker` reporting "housing" because capacity
    // was fine and the real ceiling was invisible. A 40-minute game reached it
    // every time: 36 alive, 114 corpses holding the other slots.
    //
    // Compacted in place, because `list` is handed out on the api. Nothing
    // indexes villagers by array position - the instanced meshes rebuild their
    // counts every frame - so closing the gaps is safe.
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      if (list[r].alive) list[w++] = list[r];
    }
    list.length = w;
  }

  // --- grabbing -------------------------------------------------------------

  const _pick = new THREE.Vector3();

  /**
   * Nearest villager to the cursor in SCREEN space, or null.
   *
   * The same forgiving pick the props use, and for the same reasons: villagers
   * are small, they move, and an exact raycast against an InstancedMesh whose
   * instances are re-bucketed every frame is both awkward and unforgiving.
   */
  function pickNear(ndc, camera, viewW, viewH, tolerancePx) {
    const fovScale = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const camPos = camera.position;
    let best = null;
    let bestPx = Infinity;

    for (const v of list) {
      if (!v.alive || v.held) continue;
      const dx = v.pos.x - camPos.x;
      const dy = v.pos.y - camPos.y;
      const dz = v.pos.z - camPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 400 * 400) continue;

      // Aim at the chest rather than the feet, which is where the eye goes.
      _pick.set(v.pos.x, v.pos.y + VILLAGER.BODY_HEIGHT * VILLAGER.SCALE * 0.5, v.pos.z);
      _pick.project(camera);
      if (_pick.z > 1) continue;

      const px = (_pick.x - ndc.x) * 0.5 * viewW;
      const py = (_pick.y - ndc.y) * 0.5 * viewH;
      const dist = Math.hypot(px, py);
      if (dist >= bestPx) continue;

      const screenR = (v.radius / Math.sqrt(d2)) * fovScale;
      if (dist < Math.max(tolerancePx, screenR * 1.6)) {
        bestPx = dist;
        best = v;
      }
    }
    return best ? { villager: best, point: best.pos.clone(), screenDist: bestPx } : null;
  }

  // --- render ---------------------------------------------------------------
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _axis = new THREE.Vector3(0, 1, 0);
  const _side = new THREE.Vector3(1, 0, 0);
  const _fwdAxis = new THREE.Vector3(0, 0, 1);
  const _white = new THREE.Color(1, 1, 1);
  const _qt = new THREE.Quaternion();
  const _lp = new THREE.Vector3();

  function syncRender(alpha) {
    // Reset the buckets. Villagers move between pose meshes every frame, so
    // each mesh's instance count is rebuilt from scratch rather than tracked.
    for (const set of poseMeshes) for (const m of set) m.count = 0;
    let loadCount = 0;
    let lanternCount = 0;
    let n = 0;

    // Lit by the sky, and read straight from it.
    //
    // The first version eased toward `isNight` per frame - which meant a fixed
    // per-frame step, because `syncRender` is handed an interpolation alpha and
    // no delta time. Lanterns would have come up more than twice as fast on a
    // 144Hz monitor as on a 60Hz one. `sky.nightness` is a function of the hour
    // instead, so it is the same everywhere and needs no timer here.
    // Off by default - see VILLAGER.TORCH.ENABLED for why.
    //
    // TO BRING THEM BACK: the flame needs to be about a fifth of the size it
    // was (GLOW_SIZE nearer 0.3 against a 2.25-unit villager) and it must be
    // DEPTH-TESTED, so the body occludes it instead of it painting over the
    // body. Additive plus `depthWrite: false` plus `renderOrder: 6` is the
    // combination that made a villager glow rather than a lantern.
    lanternLit = T.ENABLED ? (state.sky?.nightness ?? 0) : 0;

    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v.alive) continue;
      n++;

      _p.lerpVectors(v.prev, v.pos, alpha);

      let yaw = v.prevYaw;
      let dy = v.yaw - v.prevYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      yaw += dy * alpha;
      _q.setFromAxisAngle(_axis, yaw);

      if (v.resting) {
        // Lie down: tip over onto the ground.
        _qt.setFromAxisAngle(_side, Math.PI * 0.45);
        _q.multiply(_qt);
      }

      // Pick the pose. The stride phase already advances with distance walked,
      // so stepping the flipbook off it keeps feet and ground speed in sync and
      // stops the crowd marching in lockstep.
      const moving = v.hasDest && !v.resting && v.state !== 'gather';
      const set = poseMeshes[v.cast];
      const mesh = moving
        ? set[1 + (Math.floor(v.phase * VILLAGER.STRIDE_RATE) % WALK_FRAMES)]
        : set[0];

      _s.setScalar(VILLAGER.SCALE * (v.build ?? 1));
      _m.compose(_p, _q, _s);
      const slot = mesh.count++;
      mesh.setMatrixAt(slot, _m);
      mesh.setColorAt(slot, _c.set(v.tunic).lerp(_white, VILLAGER.TINT_MIX));

      // A LANTERN, after dark. In the off hand, so somebody carrying a load
      // carries both - and not while asleep, which is the one time a villager
      // has no use for one.
      if (T.ENABLED && lanternLit > 0.02 && !v.resting) {
        // Out to the villager's right. Yaw here is measured with
        // `atan2(dx, dz)`, so forward is (sin, cos) and right is (cos, -sin).
        // Out to the villager's right. Yaw is measured with `atan2(dx, dz)`, so
        // forward is (sin, cos) and right is (cos, -sin). Every offset is a
        // share of BODY, so the lantern scales with whoever carries it.
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const side = T.SIDE * BODY;
        const fwd = T.FORWARD * BODY;
        _lp.set(
          _p.x + cs * side + sn * fwd,
          _p.y + BODY * T.HEIGHT,
          _p.z - sn * side + cs * fwd
        );
        _s.setScalar(1);
        _m.compose(_lp, _q, _s);
        const li = lanternCount++;
        if (lanternMesh) lanternMesh.setMatrixAt(li, _m);

        // The flame. Each one breathes on its own offset, or a hundred
        // lanterns pulse in unison and the village looks like a machine.
        const flick = 1 + Math.sin(state.time * T.FLICKER_RATE + v.id * 1.7) * T.FLICKER;
        // At the lantern's top rather than its base, where a flame would be.
        _lp.y += BODY * T.GLOW_LIFT;
        _s.setScalar(T.GLOW_SIZE * BODY * flick * lanternLit);
        _m.compose(_lp, _q, _s);
        glowMesh.setMatrixAt(li, _m);
      }

      if (v.carry > 0) {
        _p.y += VILLAGER.BODY_HEIGHT * VILLAGER.SCALE * 0.78;
        _s.setScalar(VILLAGER.SCALE);
        _m.compose(_p, _q, _s);
        const ls = loadCount++;
        loadMesh.setMatrixAt(ls, _m);
        loadMesh.setColorAt(ls, _c.set(LOAD_COLORS[v.carryType] ?? 0xffffff));
      }
    }

    for (const set of poseMeshes) {
      for (const m of set) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
    loadMesh.count = loadCount;
    loadMesh.instanceMatrix.needsUpdate = true;
    if (loadMesh.instanceColor) loadMesh.instanceColor.needsUpdate = true;

    if (lanternMesh) {
      lanternMesh.count = lanternCount;
      lanternMesh.instanceMatrix.needsUpdate = true;
      lanternMesh.material.emissiveIntensity = T.EMISSIVE_I * lanternLit;
      lanternMesh.visible = lanternCount > 0;
    }
    glowMesh.count = lanternCount;
    glowMesh.instanceMatrix.needsUpdate = true;
    glowMat.opacity = T.GLOW_OPACITY * lanternLit;
    glowMesh.visible = lanternCount > 0;
    state.debug.villagersAlive = n;
  }

  /** Counts for the HUD. */
  function stats() {
    const s = { idle: 0, wander: 0, seek: 0, gather: 0, deliver: 0, eat: 0, sleep: 0 };
    let alive = 0;
    for (const v of list) {
      if (!v.alive) continue;
      alive++;
      s[v.state] = (s[v.state] ?? 0) + 1;
    }
    return { alive, states: s };
  }

  const api = {
    enabled: true,
    list,
    spawn,
    stats,
    get count() {
      let n = 0;
      for (const v of list) if (v.alive) n++;
      return n;
    },
    /**
     * Population weighted by how devout it is. This is what belief is drawn
     * from, so a town of Doubters prays into the void however large it grows.
     * Player's town only - a rival's faith is not yours.
     */
    get faith() {
      let f = 0;
      for (const v of list) if (v.alive && v.town.isPlayer) f += v.mods.belief;
      return f;
    },
    pickNear,
    drown,
    kill,
    /** Begin a thrown arc. The hand sets the velocity; we take it from there. */
    launch(v) {
      v.held = false;
      v.flying = true;
      // Remembered so that surviving the landing can be rewarded, and so a
      // short shuffle cannot be passed off as a divine flight.
      v.thrownFrom = v.thrownFrom ?? new THREE.Vector3();
      v.thrownFrom.copy(v.pos);
      v.state = 'flee';
      v.calmTimer = VILLAGER.FLEE_CALM;
    },
      /**
     * Mark where this villager was in mortal danger, so that setting them down
     * somewhere else can be recognised as a rescue rather than as a throw.
     * Called by hand.js the moment a villager is lifted.
     */
    markPeril(v) {
      if (!v?.alive) return;
      const bad = v.foe || (v.state === 'flee' && v.calmTimer > 0);
      if (bad || v.health < PRAYER.HEALTH) v.peril = { x: v.pos.x, z: v.pos.z };
    },

  /** How many of the player's villagers are standing and fighting. */
    get fighting() {
      let n = 0;
      for (const v of list) if (v.alive && v.town.isPlayer && v.state === 'fight') n++;
      return n;
    },
    /** How many of the player's villagers are currently running for their lives. */
    get fleeing() {
      let n = 0;
      for (const v of list) if (v.alive && v.town.isPlayer && v.state === 'flee') n++;
      return n;
    },
    /** Human-readable trait labels for one villager. */
    /**
     * How long this villager would take at `job` working a node at `at`.
     *
     * Exposed because it is the only way to SEE a work-camp bonus. Inferring it
     * from the economy does not work: measuring ore income before and after
     * sinking a mine measures the job-assignment AI and the cost of the
     * buildings, both of which swamp a 50% speed change entirely.
     */
    workTimeFor,
    traitsOf(v) {
      return v.traits.map((k) => TRAITS[k]?.label ?? k);
    },
    /** How many living villagers of the player's town carry each trait. */
    traitCensus() {
      const out = new Map();
      for (const v of list) {
        if (!v.alive || !v.town.isPlayer) continue;
        for (const k of v.traits) out.set(k, (out.get(k) ?? 0) + 1);
      }
      return out;
    },
    simStep,
    syncRender
  };
  state.villagers = api;
  return api;
}
