// ---------------------------------------------------------------------------
// combat.js - soldiers, the platoon marker, siege and conquest.
//
// The military route to taking a rival town, and the counterpart to winning
// them over with awe (see the impressiveness meter in town.js).
//
// Soldiers are trained at a barracks out of the same food and ore the town eats
// and builds with, so an army is a real economic choice rather than free. They
// render as one InstancedMesh tinted by banner, exactly like villagers.
//
// The player commands them by dragging a physical banner - the platoon marker -
// across the world with the hand. Where the banner lands, the platoon marches.
// Rival soldiers have no marker: they garrison their own centre and defend it.
//
// Taking a town by force needs three things in order: kill its defenders, break
// its curtain wall, then hold the ground inside it. That sequencing is what
// stops one stray soldier walking in and claiming a city.
//
// Publishes state.combat.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createGrid } from './lib/grid.js';
import { sizeToHeight, groundAtOrigin } from './lib/models.js';
import { COMBAT, TOWN, VILLAGER, LEASH_MODES } from './state.js';

export function initCombat(state) {
  const terrain = state.terrain;

  // --- soldier rendering ----------------------------------------------------
  // The forest kit's archer is unrigged, so it instances like any other prop.
  const soldierGeo = groundAtOrigin(
    sizeToHeight(state.models.get('character-archer'), COMBAT.SOLDIER_HEIGHT)
  );

  const material = state.models.makeMaterial({ flatShading: false, color: 0xc8c8c8 });

  const mesh = new THREE.InstancedMesh(soldierGeo, material, COMBAT.MAX_SOLDIERS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(COMBAT.MAX_SOLDIERS * 3).fill(1), 3
  );
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.name = 'soldiers';
  state.scene.add(mesh);

  // One instanced catapult for the living, one demolished for the dead. Wrecks
  // stay on the field: a broken siege train should be visible for the rest of
  // the game, because it cost the same as a dozen men.
  // Castle-kit pieces live in state.castlePieces, not in the global model
  // registry - loadKitPieces returns them rather than registering them.
  const engineGeo = sizeToHeight(state.castlePieces.get('siege-catapult'), 4.2);
  const engineMesh = new THREE.InstancedMesh(engineGeo, material, 24);
  engineMesh.count = 0;
  engineMesh.castShadow = true;
  engineMesh.frustumCulled = false;
  engineMesh.name = 'siege_engines';
  state.scene.add(engineMesh);

  const wreckGeo = sizeToHeight(state.castlePieces.get('siege-catapult-demolished'), 3.4);
  const wreckMesh = new THREE.InstancedMesh(wreckGeo, material, 24);
  wreckMesh.count = 0;
  wreckMesh.castShadow = true;
  wreckMesh.frustumCulled = false;
  wreckMesh.name = 'siege_wrecks';
  state.scene.add(wreckMesh);

  const soldiers = [];

  // --- platoon marker -------------------------------------------------------
  // A banner the player physically picks up and plants. Grabbing it is handled
  // here rather than through props.js so it can never be thrown into the sea.
  const markerGeo = groundAtOrigin(
    sizeToHeight(state.castlePieces.get('flag').clone(), 7)
  );
  const marker = new THREE.Mesh(
    markerGeo,
    new THREE.MeshStandardMaterial({
      map: state.models.kitTexture('castle-kit'),
      vertexColors: true,
      roughness: 0.85,
      emissive: 0x332200,
      emissiveIntensity: 0.35
    })
  );
  marker.castShadow = true;
  marker.frustumCulled = false;
  state.scene.add(marker);

  /**
   * Invisible pick volume around the banner.
   *
   * The flag is a thin pole and a thin sheet of cloth, so a ray aimed at the
   * centre of its bounding box passes straight through the empty air between
   * them. Raycasting a solid proxy instead makes it reliably grabbable - the
   * same trick the creature uses for petting.
   */
  const markerHit = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 7.2, 3.4),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  markerHit.position.y = 3.6;
  marker.add(markerHit);

  /** Where the platoon is ordered to stand. */
  const rally = new THREE.Vector3();
  let markerPlaced = false;
  let dragging = false;

  const raycaster = new THREE.Raycaster();
  const _hit = new THREE.Vector3();

  function placeMarker(x, z) {
    rally.set(x, terrain.heightAt(x, z), z);
    marker.position.copy(rally);
    markerPlaced = true;
  }

  // --- training -------------------------------------------------------------
  const _c = new THREE.Color();
  const WHITE = new THREE.Color(1, 1, 1);

  function garrisonCap(town) {
    let cap = 0;
    for (const b of town.buildings) {
      if (!b.def.barracks) continue;
      // Each barracks supports what its own tier supports, so upgrading is also
      // a way to field more men without more buildings.
      cap += (COMBAT.BARRACKS_TIERS[b.level ?? 0] ?? COMBAT.BARRACKS_TIERS[0]).garrison;
    }
    return cap;
  }

  function countFor(town) {
    let n = 0;
    for (const s of soldiers) if (s.alive && s.town === town) n++;
    return n;
  }

  /**
   * Soldiers actually standing at this town, not the whole roster.
   *
   * `countFor` counts every soldier a town owns anywhere on the island, which
   * is the right number for "how big is their army" and the WRONG one for "is
   * this wall still held". A garrison marching on someone else's capital was
   * still counted as defending the empty one behind them, so a town whose
   * buildings had all been razed could never fall while a single raider of
   * theirs was alive somewhere over the horizon - and the besieger, creature
   * included, stood in the breach indefinitely waiting for a capture that
   * could not arrive.
   */
  function defendersAt(town) {
    let n = 0;
    const R2 = COMBAT.SIEGE_RANGE * COMBAT.SIEGE_RANGE;
    for (const s of soldiers) {
      if (!s.alive || s.town !== town) continue;
      if ((s.pos.x - town.centre.x) ** 2 + (s.pos.z - town.centre.z) ** 2 <= R2) n++;
    }
    return n;
  }

  function spawnSoldier(town, at, level = 0) {
    if (soldiers.length >= COMBAT.MAX_SOLDIERS) return null;
    const tier = COMBAT.BARRACKS_TIERS[level] ?? COMBAT.BARRACKS_TIERS[0];
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random() * 4;
    const x = at.x + Math.cos(a) * r;
    const z = at.z + Math.sin(a) * r;
    const s = {
      town,
      pos: new THREE.Vector3(x, terrain.heightAt(x, z), z),
      prev: new THREE.Vector3(x, terrain.heightAt(x, z), z),
      yaw: a,
      prevYaw: a,
      // Taken from the barracks that trained them and kept for life: upgrading
      // does not retroactively improve the men you already have.
      //
      // The LEVEL, not the tier object - `tier` is the object and sits right
      // there in scope, so a field called `tier` holding a number is a trap. It
      // caught me writing a test against `s.tier.label`.
      tierLevel: level,
      hp: COMBAT.SOLDIER_HP * tier.hp,
      maxHp: COMBAT.SOLDIER_HP * tier.hp,
      power: tier.power,
      alive: true,
      target: null,
      /** True while this soldier is marching out with a raiding party. */
      raiding: false,
      seen: null,
      aim: null,
      phase: Math.random() * Math.PI * 2
    };
    soldiers.push(s);
    state.events?.emit('unit-trained', { town, kind: 'soldier', pos: s.pos });
    return s;
  }

  function trainingTick(town, dt) {
    const barracks = town.buildings.filter((b) => b.def.barracks);
    if (!barracks.length) { town.trainBlocked = 'no barracks'; return; }

    // The food reserve is an AI brake, and applies to RIVALS ONLY.
    //
    // It exists because a rival at war replaces its losses automatically and
    // will happily starve itself doing so. The player does no such thing: they
    // built the barracks deliberately and decide for themselves what their food
    // is for. Applying the reserve to them too meant a player town sitting on a
    // perfectly normal 30 food had a barracks that silently produced nothing,
    // with no indication why - which is exactly how it was reported.
    const reserve = town.isPlayer ? 0 : TOWN.FOOD_FLOOR;

    // Worked out every tick rather than only when the timer fires, so the HUD
    // can say what the hold-up is the moment it is true.
    town.trainBlocked =
      countFor(town) >= garrisonCap(town) ? 'full'
        : (town.resources.food ?? 0) < reserve + COMBAT.TRAIN_FOOD ? 'food'
          : (town.resources.ore ?? 0) < COMBAT.TRAIN_ORE ? 'ore'
            : null;

    // A town that has lost men replaces them quickly; one building an army from
    // nothing takes its time. Either rate divides by how many barracks are
    // standing, so the second one you paid for does something besides raise the
    // ceiling. See COMBAT.REPLACE_INTERVAL.
    const owed = town.toReplace ?? 0;
    const houses = Math.min(barracks.length, COMBAT.MAX_TRAIN_BARRACKS);
    const interval =
      (owed > 0 ? COMBAT.REPLACE_INTERVAL : COMBAT.TRAIN_INTERVAL) / houses;

    town.trainTimer = (town.trainTimer ?? interval) - dt;
    if (town.trainTimer > 0) return;
    // Blocked cycles retry soon rather than burning a whole interval. Waiting
    // twelve seconds because you were four food short when the clock struck is
    // a punishment for nothing.
    if (town.trainBlocked) { town.trainTimer = COMBAT.TRAIN_RETRY; return; }
    town.trainTimer = interval;

    town.resources.food -= COMBAT.TRAIN_FOOD;
    town.resources.ore -= COMBAT.TRAIN_ORE;
    if (owed > 0) town.toReplace = owed - 1;
    // Train at the best barracks the town has, so an upgrade takes effect on
    // the very next man rather than whenever the dice favour it.
    let best = barracks[0];
    for (const b of barracks) if ((b.level ?? 0) > (best.level ?? 0)) best = b;
    spawnSoldier(town, best.pos, best.level ?? 0);
  }

  // --- movement and fighting ------------------------------------------------
  const _dir = new THREE.Vector3();

  /**
   * Nearest living enemy soldier within range, or null.
   *
   * This used to run its own hostility test - `o.town.isPlayer === s.town.isPlayer`
   * - and it disagreed with `hostile()` twenty lines below it. Two rivals were
   * both `isPlayer === false`, so under THIS test their soldiers were allies:
   * they would march on each other, arrive, and stand in the same field without
   * ever drawing a sword. Every other part of the fight used `hostile()` and
   * knew better. One rule now, in one place.
   */
  function nearestEnemy(s, range) {
    let best = null;
    let bestD2 = range * range;
    for (const o of soldiers) {
      if (!o.alive || !hostile(o.town, s.town)) continue;
      const d2 = (o.pos.x - s.pos.x) ** 2 + (o.pos.z - s.pos.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = o; }
    }
    return best;
  }

  /** True if these two belong to opposing sides. Captured towns fight for you. */
  /**
   * Every living soldier, bucketed by position, rebuilt once per sim tick.
   * Villagers query it to know whether to run; targeting queries it instead of
   * walking the whole army for every soldier.
   */
  const soldierGrid = createGrid(COMBAT.SIGHT_RANGE);

  // --- siege engines --------------------------------------------------------
  /** Live engines. Wrecks are kept too, as scenery, until the game ends. */
  const engines = [];
  const wrecks = [];

  /**
   * Two towns are enemies unless they answer to the same god.
   *
   * THE ONE HOSTILITY RULE IN THE GAME. It has been rewritten twice, and each
   * version was correct for the ownership model of its day:
   *
   *   `a.isPlayer !== b.isPlayer`  made every rival an ally of every other one
   *   `!(a.isPlayer && b.isPlayer)` fixed that, but could not tell two rivals'
   *                                 towns apart from one rival's two towns
   *
   * Now that a town has an owner, the rule is just the owner (Phase 20) - and
   * it says the right thing for a case the second version could not express at
   * all: a town a rival has captured fights for THAT rival, against everyone
   * else including the faction that founded it.
   */
  function hostile(a, b) {
    return a.owner !== b.owner;
  }

  /** Nearest living enemy villager within range, or null. */
  function nearestEnemyVillager(s, range) {
    if (!state.villagers) return null;
    let best = null;
    let bestD2 = range * range;
    for (const v of state.villagers.list) {
      if (!v.alive || !hostile(v.town, s.town)) continue;
      const d2 = (v.pos.x - s.pos.x) ** 2 + (v.pos.z - s.pos.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = v; }
    }
    return best;
  }

  /** Nearest standing enemy building within range, or null. */
  function nearestEnemyBuilding(s, range) {
    if (!state.town) return null;
    let best = null;
    let bestD2 = range * range;
    for (const b of state.town.allBuildings) {
      if (!hostile(b.town, s.town)) continue;
      const d2 = (b.pos.x - s.pos.x) ** 2 + (b.pos.z - s.pos.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = b; }
    }
    return best;
  }

  /**
   * What this soldier should attack: the nearest hostile thing, with distance
   * scaled by how much of a threat each kind is. Weighting rather than strict
   * tiers means the garrison still gets fought first, but a soldier standing
   * beside an enemy house pulls it down instead of running past it.
   */
  function chooseTarget(s) {
    const W = COMBAT.THREAT_WEIGHT;
    const R2 = COMBAT.SIGHT_RANGE * COMBAT.SIGHT_RANGE;
    let best = null;
    let bestScore = Infinity;

    const consider = (ref, pos, kind) => {
      const d2 = (pos.x - s.pos.x) ** 2 + (pos.z - s.pos.z) ** 2;
      if (d2 > R2) return;
      const score = Math.sqrt(d2) * W[kind];
      if (score < bestScore) { bestScore = score; best = { ref, pos, kind }; }
    };

    soldierGrid.near(s.pos.x, s.pos.z, COMBAT.SIGHT_RANGE, (o) => {
      if (o.alive && hostile(o.town, s.town)) consider(o, o.pos, 'soldier');
    });
    // Every creature on the island that this soldier's god does not own. There
    // is more than one of them since Phase 20, and the old line here read
    // `!s.town.isPlayer` - "only a rival's men come at it" - which was true
    // exactly while the player owned the only beast in the world.
    for (const c of state.creatures) {
      if (c.inField && c.faction !== s.town.owner) consider(c, c.position, 'creature');
    }
    // Engines are slow, precious and defenceless, so everyone goes for them.
    for (const e of engines) if (e.alive && hostile(e.town, s.town)) consider(e, e.pos, 'engine');
    if (state.villagers) {
      for (const v of state.villagers.list) {
        if (v.alive && hostile(v.town, s.town)) consider(v, v.pos, 'villager');
      }
    }
    if (state.town) {
      for (const b of state.town.allBuildings) {
        if (hostile(b.town, s.town)) consider(b, b.pos, 'building');
      }
    }
    return best;
  }

  /**
   * Is the banner an attack order, and if so, where is the front?
   *
   * A flag planted in your own fields is a posting. A flag planted on a rival's
   * land - or on top of an enemy army in the field - is an order to attack, and
   * that is what calls the creature to war.
   *
   * The enemy-army clause also means the reverse, which was not designed but is
   * kept deliberately: when a raiding party reaches YOUR town, it arrives within
   * sight of the banner standing there, the banner becomes an attack order, and
   * the creature turns out to defend its home. That is the behaviour you would
   * want anyway, and it falls out of the same one rule rather than needing a
   * second one.
   *
   * Deliberately geometric rather than a mode the player has to toggle: you
   * declare war by where you put the thing, which is the same rule the platoon
   * already obeys.
   */
  /**
   * IS THERE ANYTHING LEFT HERE TO FIGHT?
   *
   * A town that has been emptied - no people, no buildings, no garrison - is a
   * castle standing on its own in a field, and it is not a war. Without this a
   * creature standing in the ruins is at war BECAUSE it is standing there, and
   * stands there BECAUSE it is at war: a loop with nothing in it that pins the
   * animal against the keep for the rest of the match.
   *
   * Measured in a 30-minute soak - the player's fox held station 14.6 units
   * from a razed Kelvedon for five minutes at a stretch, seeing zero soldiers,
   * zero villagers and zero buildings the whole time.
   *
   * The castle instance itself is deliberately NOT counted. It cannot be
   * attacked or captured once the town is empty, so treating it as something
   * worth besieging is the whole bug.
   */
  function worthFighting(town) {
    if (!town) return false;
    if (town.buildings.length > 0) return true;
    if ((state.town?.populationOf?.(town) ?? 0) > 0) return true;
    return countFor(town) > 0;
  }

  function warFront() {
    if (!state.towns) return null;
    // Without a planted banner there is no attack order, but home defence below
    // still applies - so fall through rather than returning early.
    if (!markerPlaced) {
      const t0 = state.town?.playerTown;
      return t0 ? nearestThreat(t0) : null;
    }
    // `t.isPlayer || t.captured` before Phase 20, which meant the same thing
    // when the only two states a town could be in were yours and not-yours.
    // Owner-based now, so a town a RIVAL has captured off another rival is
    // still hostile ground you can plant a flag on.
    for (const t of state.towns) {
      if (t.owner === 0 || !worthFighting(t)) continue;
      const d = Math.hypot(rally.x - t.centre.x, rally.z - t.centre.z);
      if (d <= t.influenceRadius + COMBAT.SIEGE_RANGE) return rally;
    }
    const R2 = COMBAT.SIGHT_RANGE * COMBAT.SIGHT_RANGE;
    for (const o of soldiers) {
      if (!o.alive || o.town.owner === 0) continue;
      if ((o.pos.x - rally.x) ** 2 + (o.pos.z - rally.z) ** 2 <= R2) return rally;
    }

    // No attack order - but a creature STANDING in someone else's streets does
    // not need one. Lure it over their border, by leash or by right-click, and
    // it makes its own war on what it finds there: their people, their houses.
    //
    // The town it is standing in becomes the front, so WAR_LEASH holds it to
    // that town rather than letting it chain onward through the countryside.
    // Take it out of their land and the front disappears with it, which is what
    // lets you call it off simply by sending it somewhere else.
    // ...unless it is on a peaceful leash, in which case it is visiting. See
    // LEASH_MODES.compassion.peaceful - that is the whole comment.
    const beast = state.creature;
    if (beast && beast.inField && !LEASH_MODES[beast.leash]?.peaceful) {
      const bp = beast.position;
      for (const t of state.towns) {
        if (t.owner === 0 || !worthFighting(t)) continue;
        const d = Math.hypot(bp.x - t.centre.x, bp.z - t.centre.z);
        if (d <= t.influenceRadius) return t.centre;
      }
    }

    // No attack order - but an enemy inside your borders is its own summons.
    // The creature goes to the intruder rather than to the flag, so it defends
    // the whole of your land instead of only the patch the banner happens to
    // be standing on. The front moves with the intruder and vanishes when they
    // are dead or gone, which is what brings the creature home afterwards.
    // Every town the player holds, not only the one they started in - a captured
    // town being raided is your problem too, and before Phase 20 there was no
    // way to lose one so nothing had to say so.
    for (const t of state.towns) {
      if (t.owner !== 0) continue;
      const foe = nearestThreat(t);
      if (foe) return foe;
    }
    return null;
  }

  /**
   * The same question, asked for a RIVAL god (Phase 20).
   *
   * Deliberately NOT the player's answer with the names changed. A rival has no
   * banner to plant - the banner is a thing the player's hand does - so its
   * front is the two facts it already had and never used: who its army is
   * marching on, and who is standing in its streets.
   *
   * Home comes first, for the same reason the player's does: a creature that
   * keeps ransacking a village while its own town burns reads as broken.
   */
  function rivalFront(faction) {
    if (!state.towns) return null;
    for (const t of state.towns) {
      if (t.owner !== faction) continue;
      const foe = nearestThreat(t);
      if (foe) return foe;
    }
    for (const t of state.towns) {
      if (t.owner !== faction || !t.warTarget) continue;
      if (!hostile(t.warTarget, t) || !worthFighting(t.warTarget)) continue;
      return t.warTarget.centre;
    }
    return null;
  }

  /** Where a given god's war is, whoever they are. */
  function frontFor(faction) {
    return faction === 0 ? warFront() : rivalFront(faction);
  }

  /**
   * Somebody hostile standing in this god's OWN land, or null.
   *
   * The half of `frontFor` that is not optional. A god choosing whether to send
   * its creature to a war or to somebody's gate needs to tell "my army is out
   * raiding" - which it can ignore - from "there are men in my streets", which
   * it cannot.
   */
  function homeThreatFor(faction) {
    if (!state.towns) return null;
    for (const t of state.towns) {
      if (t.owner !== faction) continue;
      const foe = nearestThreat(t);
      if (foe) return foe;
    }
    return null;
  }

  function engineCap(town) {
    let n = 0;
    for (const b of town.buildings) if (b.def.barracks) n += COMBAT.ENGINES_PER_BARRACKS;
    return n;
  }

  function enginesOf(town) {
    let n = 0;
    for (const e of engines) if (e.alive && e.town === town) n++;
    return n;
  }

  /** Build one. Charged to whoever owns it, so rivals pay too. */
  function buildEngine(town) {
    if (enginesOf(town) >= engineCap(town)) return { ok: false, reason: 'needs another barracks' };
    for (const [res, amt] of Object.entries(COMBAT.ENGINE_COST)) {
      if ((town.resources[res] ?? 0) < amt) return { ok: false, reason: `needs ${amt} ${res}` };
    }
    for (const [res, amt] of Object.entries(COMBAT.ENGINE_COST)) town.resources[res] -= amt;

    // Out of the barracks that built it, not out of thin air beside the keep.
    //
    // It used to appear in a ring around `town.centre`, so the engine rolled out
    // of the castle while the building that pays for it, caps it and gives it
    // its whole reason to exist stood somewhere else in the village. The cap is
    // already counted per barracks - `engineCap` walks `town.buildings` looking
    // for exactly these - so the yard it comes out of should be one of them.
    //
    // Non-empty by construction: `engineCap` is 0 for a town with no barracks
    // and the check at the top of this function has already refused. Razed
    // buildings are spliced out of `town.buildings`, so a destroyed barracks
    // cannot be picked either.
    const yards = town.buildings.filter((b) => b.def.barracks);
    // Round-robin as they are built, so a second barracks is a second yard
    // rather than two engines shouldering out of the same door.
    const yard = yards[enginesOf(town) % yards.length];
    // Clear of the pad and on the far side from the keep - the drill-yard side.
    // It reads as leaving the hall instead of sitting on the roof of it.
    const a = Math.atan2(yard.pos.x - town.centre.x, yard.pos.z - town.centre.z);
    const out = (yard.def.pad || 5) * 0.6 + 3.5;
    const x = yard.pos.x + Math.sin(a) * out;
    const z = yard.pos.z + Math.cos(a) * out;
    engines.push({
      town,
      pos: new THREE.Vector3(x, terrain.heightAt(x, z), z),
      prev: new THREE.Vector3(x, terrain.heightAt(x, z), z),
      yaw: a, prevYaw: a,
      hp: COMBAT.ENGINE_HP,
      alive: true,
      firing: false
    });
    state.events?.emit('unit-trained', { town, kind: 'engine', pos: yard.pos });
    if (town.isPlayer) state.ui?.toast('A siege engine is ready');
    return { ok: true };
  }

  /**
   * One tick of every engine: lumber toward the front, and batter any hostile
   * wall in range.
   *
   * The exception that justifies the whole unit is here - unlike soldiers, an
   * engine does not wait for the garrison to fall. It works while the fighting
   * goes on around it.
   */
  /**
   * The town this engine has been ORDERED to break, or null.
   *
   * Engines used to pick the nearest enemy wall and march on it the moment they
   * were built - alone, at half speed, across the whole island, with no order
   * given and the army still standing at home. Ninety wood and seventy ore
   * would walk off by itself and be destroyed on arrival, which is exactly what
   * "the siege engine is not working correctly" looks like from the outside.
   *
   * Soldiers have always obeyed the banner through `goalFor`. Engines simply
   * never asked. They do now, and by the same rule `warFront` uses, so the
   * banner means one thing to everything you own.
   */
  function siegeOrderFor(e) {
    const town = e.town;
    if (town.isPlayer) {
      if (!markerPlaced) return null;
      for (const t of state.towns) {
        if (!hostile(t, town) || t.wallHp <= 0) continue;
        const d = Math.hypot(rally.x - t.centre.x, rally.z - t.centre.z);
        if (d <= t.influenceRadius + COMBAT.SIEGE_RANGE) return t;
      }
      return null;
    }
    // A rival's engine marches with that rival's raid, and only while it lasts.
    // `!wt.captured` was here, and it used to be shorthand for "not the
    // player's". A town that has changed hands is a target like any other, and
    // `hostile` is the only test that has to pass.
    const wt = town.warTarget;
    if (wt && hostile(wt, town) && wt.wallHp > 0) return wt;
    return null;
  }

  /** Any hostile wall already within reach of where the engine is standing. */
  function wallInReach(e) {
    for (const t of state.towns) {
      if (!hostile(t, e.town) || t.wallHp <= 0) continue;
      if (e.pos.distanceTo(t.centre) <= COMBAT.ENGINE_RANGE) return t;
    }
    return null;
  }

  function batter(e, target, dt) {
    e.firing = true;
    const dy = Math.atan2(target.centre.x - e.pos.x, target.centre.z - e.pos.z) - e.yaw;
    e.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, 6 * dt);
    target.wallHp = Math.max(0, target.wallHp - COMBAT.ENGINE_SIEGE_DPS * dt);
    if (target.wallHp === 0) {
      state.fx?.burst(target.centre, 30, 0xb08d63);
      state.debug.lastLog = target.name + "'s wall is broken by siege";
      if (e.town.isPlayer) state.ui?.toast(target.name + "'s wall is broken");
    }
  }

  function engineTick(dt) {
    for (const e of engines) {
      if (!e.alive) continue;
      e.prev.copy(e.pos);
      e.prevYaw = e.yaw;
      e.firing = false;

      const ordered = siegeOrderFor(e);
      if (ordered) {
        if (e.pos.distanceTo(ordered.centre) > COMBAT.ENGINE_RANGE) {
          moveToward(e, ordered.centre, dt * COMBAT.ENGINE_SPEED_FRAC,
                     COMBAT.ENGINE_RANGE * 0.8);
          continue;
        }
        batter(e, ordered, dt);
        continue;
      }

      // No order: hold with the army. It still batters anything hostile that is
      // already in reach of where it is standing, so an engine at the rally
      // beside an enemy town is not idle and one defending home still fights -
      // it just will not go looking for a war on its own.
      moveToward(e, goalFor(e), dt * COMBAT.ENGINE_SPEED_FRAC, COMBAT.RALLY_SPREAD);
      const near = wallInReach(e);
      if (near) batter(e, near, dt);
    }

    // Wrecks.
    for (let i = engines.length - 1; i >= 0; i--) {
      const e = engines[i];
      if (e.alive && e.hp <= 0) {
        e.alive = false;
        state.fx?.burst(e.pos, 22, 0x9c8a70);
        state.events?.emit('unit-lost', { town: e.town, kind: 'engine', pos: e.pos });
        wrecks.push({ pos: e.pos.clone(), yaw: e.yaw });
        if (e.town.isPlayer) state.ui?.toast('A siege engine is destroyed');
      }
      if (!e.alive) engines.splice(i, 1);
    }
  }

  // --- home defence ---------------------------------------------------------
  //
  // Everything above is about armies you send somewhere. This is the other
  // half: an enemy that walks into YOUR land is answered by whatever you have
  // standing in it, with no order given and no banner moved.

  /**
   * Nearest living enemy soldier inside a town's borders, or null.
   * Uses the soldier grid rather than the flat array - this runs per defending
   * soldier per tick, which is exactly the product the grid exists for.
   */
  function nearestIntruder(town) {
    const r = town.influenceRadius + COMBAT.DEFEND_MARGIN;
    return soldierGrid.nearest(town.centre.x, town.centre.z, r,
      (o) => o.alive && hostile(o.town, town));
  }

  /**
   * A HOSTILE BEAST INSIDE A TOWN'S BORDERS, or null.
   *
   * `nearestIntruder` reads the soldier grid, so an intrusion meant men. That
   * was the whole of it while there was one creature in the world and it was
   * the player's. Now every god has one, and without this a rival's monster
   * could walk into your streets, start pulling your houses down, and never
   * become a war - so your own creature had no front to be called to and stood
   * at home watching it happen.
   *
   * THE TEST IS THE LEASH, NOT `atWar`, and that is not a style choice: it is
   * the only way this question can be asked without recursing forever.
   *
   * `c.atWar` asks `frontFor(c.faction)`, which comes back here to ask whether
   * anything is in THAT god's land, which asks the first creature whether it is
   * at war... A.atWar -> B.atWar -> A.atWar, straight down the stack, the first
   * frame two beasts stood near each other's towns.
   *
   * The leash answers the same question and cannot recurse, because it is a
   * setting rather than a derivation - and it is the identical rule `warFront`
   * already uses for the player's own beast a few lines below. A creature on a
   * peaceful leash is courting, not invading; anything else standing in your
   * land is an invasion whatever it thinks it is doing.
   */
  function nearestBeastIntruder(town) {
    let best = null;
    let bestD2 = Infinity;
    const r = town.influenceRadius + COMBAT.DEFEND_MARGIN;
    for (const c of state.creatures) {
      if (c.faction === town.owner || !c.inField || c.peaceful) continue;
      const d2 = (c.position.x - town.centre.x) ** 2 + (c.position.z - town.centre.z) ** 2;
      if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; best = c; }
    }
    return best;
  }

  /** Anything hostile in this town's land - men first, then beasts. */
  function nearestThreat(town) {
    const foe = nearestIntruder(town);
    if (foe) return foe.pos;
    const beast = nearestBeastIntruder(town);
    return beast ? beast.position : null;
  }

  /** Is this soldier standing in its own town's land? */
  function isHome(s) {
    const t = s.town;
    const r = t.influenceRadius + COMBAT.DEFEND_MARGIN;
    return (s.pos.x - t.centre.x) ** 2 + (s.pos.z - t.centre.z) ** 2 <= r * r;
  }

  // --- the war council ------------------------------------------------------
  //
  // Rivals previously garrisoned their own square and nothing else, so the only
  // violence in the world was violence the player started. They now raid their
  // neighbours - including each other, which costs almost nothing once the
  // mechanism exists and is most of what makes the world feel like it is
  // running whether or not you are watching.
  //
  // Every constant in the RAID_ block is a brake. An unrestrained rival walks
  // two soldiers into a garrison of twelve, forever.

  /** Living soldiers of a town that are marching out, and those held at home. */
  function partyOf(town) {
    let out = 0;
    for (const s of soldiers) if (s.alive && s.town === town && s.raiding) out++;
    return out;
  }

  /**
   * Score a town as a target: near, weakly held and worth sacking wins. Returns
   * Infinity for anything that should not be attacked at all.
   */
  function raidScore(from, to) {
    // `hostile` covers both, now that it reads the owner: a town of your own
    // faction is not a target whether you founded it or took it.
    if (!hostile(to, from)) return Infinity;
    const d = Math.hypot(to.centre.x - from.centre.x, to.centre.z - from.centre.z);
    const defenders = countFor(to);
    const spoils = Math.max(1, to.buildings.length);
    return (d + defenders * COMBAT.RAID_DEFENCE_WEIGHT * 10) / spoils;
  }

  /** Send the party home and forget the target. */
  function callOffRaid(town, why) {
    if (!town.warTarget) return;
    for (const s of soldiers) if (s.town === town) s.raiding = false;
    if (state.debug) state.debug.lastLog = `${town.name} breaks off the raid (${why})`;
    // Announced as a fact. prayers.js is listening for the moment a town stops
    // being in danger; nothing else here needs to know that it cares.
    state.events?.emit('raid-ended', { town: town.warTarget, why });
    town.warTarget = null;
    town.raidStarted = 0;
    town.raidStrength = 0;
  }

  /**
   * One town's military decision, run on RAID_INTERVAL.
   *
   * `|| town.captured` was in the guard below, which meant a town the player
   * took stopped having a war council - correct, since the player commands by
   * banner. It also meant that a town a RIVAL took went permanently silent:
   * conquered, re-flagged, and then never raiding again from a garrison that
   * still trained soldiers. Only the player's towns are commanded by hand.
   */
  function councilTick(town, dt) {
    if (town.isPlayer) return; // the player commands by banner

    // --- an ongoing raid: does it continue? ---
    if (town.warTarget) {
      const elapsed = state.time - town.raidStarted;
      if (!hostile(town.warTarget, town)) {
        callOffRaid(town, 'nothing left to take');
      } else if (elapsed > COMBAT.RAID_DURATION) {
        callOffRaid(town, 'called home');
      } else if (partyOf(town) <= town.raidStrength * COMBAT.RAID_BREAK) {
        callOffRaid(town, 'the party is broken');
      } else if (elapsed > COMBAT.RAID_COMMIT && town.besiegedBy > 0) {
        // Home comes first, but only once the commitment window has passed -
        // otherwise a single enemy scout turns every army round on the spot.
        callOffRaid(town, 'home is threatened');
      }
      return;
    }

    town.warTimer = (town.warTimer ?? COMBAT.RAID_INTERVAL * Math.random()) - dt;
    if (town.warTimer > 0) return;
    town.warTimer = COMBAT.RAID_INTERVAL;

    if (state.time < COMBAT.RAID_GRACE) return;
    if (town.besiegedBy > 0) return;           // defend home before raiding
    const army = countFor(town);
    if (army < COMBAT.RAID_MIN_ARMY) return;

    let best = null;
    let bestScore = Infinity;
    for (const other of state.towns) {
      const sc = raidScore(town, other);
      if (sc < bestScore) { bestScore = sc; best = other; }
    }
    if (!best) return;

    // Commit a fraction of the garrison; the rest is the home guard.
    const marching = Math.max(1, Math.floor(army * COMBAT.RAID_FRACTION));
    let n = 0;
    for (const s of soldiers) {
      if (n >= marching) break;
      if (s.alive && s.town === town) { s.raiding = true; n++; }
    }
    town.warTarget = best;
    town.raidStarted = state.time;
    town.raidStrength = n;
    state.debug.lastLog = `${town.name} marches on ${best.name} with ${n}`;
    if (best.isPlayer) state.ui?.toast(`${town.name} is marching on you`);
    state.events?.emit('raid-declared', { from: town, to: best, strength: n });
  }

  /** Where this soldier wants to be, if it is not fighting. */
  function goalFor(s) {
    // Defend what you are standing in. Deliberately gated on the soldier being
    // home rather than on the town being invaded: troops you have sent out on
    // an attack stay on it, and only the garrison actually present turns to
    // meet an incursion. Otherwise every raid you launch would be recalled by
    // the first enemy scout that wandered over your border.
    if (isHome(s)) {
      const foe = nearestIntruder(s.town);
      if (foe) return foe.pos;
    }

    if (s.town.isPlayer) return markerPlaced ? rally : s.town.centre;
    // A rival in the raiding party marches on the target; everyone else holds.
    if (s.raiding && s.town.warTarget) return s.town.warTarget.centre;
    return s.town.centre;
  }

  function moveToward(s, goal, dt, stopAt) {
    _dir.set(goal.x - s.pos.x, 0, goal.z - s.pos.z);
    const d = _dir.length();
    if (d < stopAt) return;
    _dir.multiplyScalar(1 / d);
    const step = Math.min(d, COMBAT.MARCH_SPEED * dt);
    const nx = s.pos.x + _dir.x * step;
    const nz = s.pos.z + _dir.z * step;
    const h = terrain.heightAt(nx, nz);
    if (h < VILLAGER.MIN_WALK_HEIGHT) return; // soldiers do not swim either
    // Soldiers and siege engines do not walk through castles either. Sieges are
    // unaffected: SIEGE_RANGE is 30 and the stonework stops at 10.5, so an army
    // still closes to well inside the ring it needs to hold.
    const solid = state.town.pushOutOfCentres(nx, nz);
    s.pos.set(solid.x, solid.hit ? terrain.heightAt(solid.x, solid.z) : h, solid.z);
    s.phase += step * 0.5;
    let dy = Math.atan2(_dir.x, _dir.z) - s.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    s.yaw += dy * Math.min(1, 9 * dt);
  }

  // --- siege ----------------------------------------------------------------
  /**
   * Resolve one town's siege state. Attackers inside SIEGE_RANGE with no
   * defenders left to stop them break the wall down; once it is down and enough
   * of them are holding the ground, the town falls.
   */
  /**
   * Scratch tallies of besiegers by faction, reused every tick.
   *
   * `_siegeBy` counts everything - men and beasts - and decides who is strong
   * enough to take the place. `_siegeMen` counts only living soldiers, because
   * a surrender has to be accepted by somebody who can hold a gate.
   */
  const _siegeBy = [];
  const _siegeMen = [];

  function siegeTick(town, dt) {
    // `if (town.captured) return` stood here until Phase 20, and it was right
    // while "captured" meant "the player's, and therefore finished with". A
    // town that has changed hands is now an ordinary town that can be besieged,
    // taken, and taken back - after CAPTURE_GRACE, while its new garrison gets
    // the gate shut. The siege itself still runs during that window, so the
    // wall comes down on time and the grace delays only the surrender.

    // Any hostile force. Tallied BY FACTION rather than as "mine and everyone
    // else's", because who is standing in the breach decides who it falls to.
    let attackers = 0;
    _siegeBy.length = 0;
    _siegeMen.length = 0;
    for (let i = 0; i < state.factions.length; i++) { _siegeBy.push(0); _siegeMen.push(0); }
    for (const s of soldiers) {
      if (!s.alive || !hostile(s.town, town)) continue;
      if (s.pos.distanceTo(town.centre) > COMBAT.SIEGE_RANGE) continue;
      attackers++;
      _siegeBy[s.town.owner]++;
      _siegeMen[s.town.owner]++;
    }

    // Creatures count too, and there is more than one of them now. A god's
    // beast standing in the breach is worth a handful of men, both for bringing
    // the wall down and for holding what is left afterwards.
    // A BEAST PUTTING ON A SHOW IS NOT LAYING SIEGE.
    //
    // The test was `c.inField` alone - alive and not routed - which is to say
    // "present". That was indistinguishable from "attacking" while the only
    // reason a creature was ever in somebody's streets was to flatten them.
    // Awe gives it a second reason, and a creature that arrives to dance must
    // not knock the wall down by standing still.
    //
    // `atWar` costs the player nothing: their creature inside rival borders is
    // put at war by `warFront` above, on any leash but the peaceful one.
    for (const c of state.creatures) {
      if (!c.inField || !c.atWar || c.faction === town.owner) continue;
      if (c.position.distanceTo(town.centre) > COMBAT.SIEGE_RANGE) continue;
      attackers += COMBAT.CREATURE_SIEGE_WORTH;
      _siegeBy[c.faction] += COMBAT.CREATURE_SIEGE_WORTH;
    }
    const wasBesieged = (town.besiegedBy ?? 0) > 0;
    town.besiegedBy = attackers;
    if (attackers === 0) {
      // The siege lifted. A raid being called off is one way a town stops being
      // in danger; the besiegers simply dying or leaving is the other.
      if (wasBesieged) state.events?.emit('raid-ended', { town, why: 'siege lifted' });
      return;
    }

    const defenders = defendersAt(town);
    if (defenders > 0) return; // the garrison holding THIS wall has to fall first

    if (town.wallHp > 0) {
      town.wallHp = Math.max(0, town.wallHp - attackers * COMBAT.SIEGE_DPS * dt);
      if (town.wallHp === 0) {
        state.fx?.burst(town.centre, 30, 0xb08d63);
        state.debug.lastLog = town.name + "'s wall is breached";
        state.ui?.toast(town.name + "'s wall is breached");
      }
      return;
    }

    if (attackers < COMBAT.CAPTURE_ATTACKERS) return;

    // WHOEVER HOLDS THE BREACH TAKES THE TOWN.
    //
    // Here is what stood here instead, for ten phases:
    //
    //   "ONLY THE PLAYER TAKES TOWNS. The game has no notion of ownership
    //    beyond `isPlayer`, so a rival cannot meaningfully take a town from
    //    another rival. What it can do is sack one."
    //
    // Every word of that was true, and it is the single line that made this a
    // game only one participant could win. Rivals fought, bled, breached walls
    // and razed buildings, and at the end of it the map still said exactly what
    // it had said at the start. Towns have owners now, so the rule is the
    // obvious one and it applies to everybody, the player included.
    //
    // The strongest force present, not merely a present one: two gods can both
    // have men in the breach, and a tie leaves the town standing rather than
    // being decided by which faction happens to be earlier in the array.
    let takerCount = 0;
    let taker = -1;
    let tied = false;
    for (let i = 0; i < _siegeBy.length; i++) {
      if (_siegeBy[i] > takerCount) { takerCount = _siegeBy[i]; taker = i; tied = false; }
      else if (_siegeBy[i] === takerCount && takerCount > 0) tied = true;
    }
    if (taker < 0 || tied || takerCount < COMBAT.CAPTURE_ATTACKERS) return;
    if (state.time - (town.tookAt ?? -Infinity) < COMBAT.CAPTURE_GRACE) return;
    // A monster cannot accept a surrender. See COMBAT.CAPTURE_NEEDS_A_SOLDIER.
    if (COMBAT.CAPTURE_NEEDS_A_SOLDIER && !_siegeMen[taker]) return;

    state.town.capture(town, 'conquest', taker);
  }

  // --- simulation -----------------------------------------------------------
  function simStep(dt) {
    if (!state.towns) return;

    // Rebuilt before anything reads it. Everything downstream this tick -
    // targeting here, threat checks in villagers.js - queries this instead of
    // walking the whole army.
    soldierGrid.rebuild(soldiers, (s) => s.alive);

    for (const town of state.towns) {
      trainingTick(town, dt);
      councilTick(town, dt);
    }

    // Fight first, then move: a soldier already in contact should stand and
    // swing rather than drifting on toward the rally point.
    for (const s of soldiers) {
      if (!s.alive) continue;
      s.prev.copy(s.pos);
      s.prevYaw = s.yaw;
      // Look further than you can swing, so a visible enemy gets charged.
      s.aim = chooseTarget(s);
      s.target = s.aim && s.aim.kind === 'soldier'
        && s.pos.distanceTo(s.aim.pos) <= COMBAT.ENGAGE_RANGE ? s.aim.ref : null;
    }

    // Deaths and demolitions are batched: one event per tick per cause, rather
    // than one per victim, so alignment moves once for one massacre.
    const slain = { byFaction: state.factions.map(() => 0), pos: null };
    const razed = [];

    for (const s of soldiers) {
      if (!s.alive) continue;
      const face = (p) => {
        const dy = Math.atan2(p.x - s.pos.x, p.z - s.pos.z) - s.yaw;
        s.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, 9 * dt);
      };

      const aim = s.aim;
      const stillValid = aim && (
        aim.kind === 'engine' ? aim.ref.alive :
        aim.kind === 'building' ? aim.ref.hp > 0
          : aim.kind === 'creature' ? aim.ref.inField
            : aim.ref.alive);

      if (!stillValid) {
        moveToward(s, goalFor(s), dt, COMBAT.RALLY_SPREAD * 0.5);
      } else if (s.pos.distanceTo(aim.pos) > COMBAT.ENGAGE_RANGE) {
        // Charge: close to well inside swinging distance rather than halting on
        // the boundary, or the two lines never actually meet.
        moveToward(s, aim.pos, dt, COMBAT.ENGAGE_RANGE * 0.5);
      } else {
        face(aim.pos);
        if (aim.kind === 'engine') {
          aim.ref.hp -= COMBAT.DPS * s.power * dt;
        } else if (aim.kind === 'soldier') {
          aim.ref.hp -= COMBAT.DPS * s.power * dt;
        } else if (aim.kind === 'creature') {
          // The creature applies its own defense to whatever it is dealt.
          aim.ref.takeDamage(COMBAT.DPS_VS_CREATURE * s.power * dt, 'soldier');
        } else if (aim.kind === 'villager') {
          // A Brave villager sells their life dearly; a Timid one does not.
          aim.ref.health -= COMBAT.CIVILIAN_DPS * s.power * (aim.ref.mods?.armour ?? 1) * dt;
          if (aim.ref.health <= 0) {
            aim.ref.alive = false;
            state.fx?.burst(aim.ref.pos, 6, 0xb85a3a);
            slain.byFaction[s.town.owner]++;
            slain.pos = aim.ref.pos.clone();
          }
        } else {
          aim.ref.hp -= COMBAT.BUILDING_DPS * s.power * dt;
          // WHO swung matters, so it is recorded rather than guessed at below.
          if (aim.ref.hp <= 0 && !razed.some((r) => r.b === aim.ref)) {
            razed.push({ b: aim.ref, by: s.town.owner });
          }
        }
      }
    }

    for (const s of soldiers) {
      if (s.alive && s.hp <= 0) {
        s.alive = false;
        state.fx?.burst(s.pos, 8, 0xb85a3a);
        state.events?.emit('unit-lost', { town: s.town, kind: 'soldier', pos: s.pos });
        // The town owes itself a man. Capped at what it could actually field,
        // so a garrison wiped out along with its barracks does not carry a debt
        // it can never pay and then dump an instant army the moment one is
        // rebuilt.
        const owed = (s.town.toReplace ?? 0) + 1;
        s.town.toReplace = Math.min(owed, garrisonCap(s.town));
      }
    }

    // byPlayer matters: a rival butchering YOUR people must not blacken your
    // name. Only what you ordered is charged to your soul.
    //
    // Split PER FACTION rather than into yours-and-theirs. The old pair lumped
    // every rival's dead into one "not the player" event, which was all any
    // listener could use at the time; a creature now asks whether a killing was
    // its own, and "some rival did it" cannot answer that.
    for (let f = 0; f < slain.byFaction.length; f++) {
      const n = slain.byFaction[f];
      if (!n) continue;
      state.events?.emit('villagers-killed',
        { count: n, pos: slain.pos, cause: 'soldiers', byPlayer: f === 0, by: f });
    }
    for (const { b, by } of razed) {
      // This read `!b.town.isPlayer` - "razed by whoever it did not belong to"
      // - which is an INFERENCE, and it was already wrong before Phase 20: two
      // rivals fighting each other razed rival buildings, the test asked only
      // who OWNED the rubble, and the player was charged with the alignment hit
      // for a demolition on the far side of the island they had no part in.
      // Phase 17 spent a whole phase hunting exactly this shape of bug.
      const byPlayer = by === 0;
      state.fx?.burst(b.pos, 24, 0x9c8a70);
      state.town.demolish(b);
      state.events?.emit('building-destroyed',
        { building: b, pos: b.pos, cause: 'soldiers', byPlayer, by });
    }

    engineTick(dt);

    for (const town of state.towns) siegeTick(town, dt);

    // Compact the dead out of the army.
    //
    // `soldiers` only ever grew, which quietly turned MAX_SOLDIERS from a
    // concurrent cap into a LIFETIME one: past 120 men ever trained, every
    // further spawn returned null and no town could raise another soldier for
    // the rest of the game. It never announced itself - training simply stopped
    // working - and it silently swallowed 25 spawns in one of my own tests.
    //
    // Compacting in place rather than reassigning, because `soldiers` is handed
    // out on the api and other systems hold the same array.
    let w = 0;
    for (let r = 0; r < soldiers.length; r++) {
      if (soldiers[r].alive) soldiers[w++] = soldiers[r];
    }
    soldiers.length = w;
  }

  // --- input: dragging the banner -------------------------------------------
  function update(dt, alpha) {
    const input = state.input;
    const blocked = state.town?.placing || state.ui?.buildMenuOpen || state.ui?.zooOpen;

    if (input.pressed[0] && !blocked && !input.isCaptured('combat')) {
      raycaster.setFromCamera(input.ndc, state.camera.cam);
      if (raycaster.intersectObject(markerHit, false).length) {
        dragging = true;
        input.capture('combat');
      }
    }

    if (dragging) {
      raycaster.setFromCamera(input.ndc, state.camera.cam);
      const hits = raycaster.intersectObject(terrain.mesh, false);
      if (hits.length) {
        _hit.copy(hits[0].point);
        marker.position.set(_hit.x, terrain.heightAt(_hit.x, _hit.z), _hit.z);
      }
      if (input.released[0] || !input.buttons[0]) {
        dragging = false;
        placeMarker(marker.position.x, marker.position.z);
        state.debug.lastLog = 'platoon ordered to advance';
        if (input.capturedBy === 'combat') input.capturedBy = null;
      }
    }

    // The banner bobs and turns so it reads as a live object worth grabbing.
    marker.rotation.y += dt * 0.6;
    syncRender(alpha);
  }

  // --- render ---------------------------------------------------------------
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _axis = new THREE.Vector3(0, 1, 0);
  const _tierScale = new THREE.Vector3(1, 1, 1);
  const _one = new THREE.Vector3(1, 1, 1);

  function syncRender(alpha) {
    let n = 0;
    for (const s of soldiers) {
      if (!s.alive) continue;
      _p.lerpVectors(s.prev, s.pos, alpha);
      // A marching bob, the same trick the villagers use.
      const moving = !s.target;
      if (moving) _p.y += Math.abs(Math.sin(s.phase)) * 0.14;

      let yaw = s.prevYaw;
      let dy = s.yaw - s.prevYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      yaw += dy * alpha;
      _q.setFromAxisAngle(_axis, yaw);

      // Rank reads at a glance: each tier stands a little taller.
      _tierScale.setScalar(1 + (s.tierLevel ?? 0) * COMBAT.TIER_SCALE);
      _m.compose(_p, _q, _tierScale);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _c.set(s.town.colour).lerp(WHITE, TOWN.TINT_MIX));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;

    // --- engines and wrecks ---
    let en = 0;
    for (const e of engines) {
      if (!e.alive) continue;
      _p.lerpVectors(e.prev, e.pos, alpha);
      let ey = e.prevYaw;
      let edy = e.yaw - e.prevYaw;
      while (edy > Math.PI) edy -= Math.PI * 2;
      while (edy < -Math.PI) edy += Math.PI * 2;
      ey += edy * alpha;
      _q.setFromAxisAngle(_axis, ey);
      // A firing engine rocks with the recoil.
      if (e.firing) _p.y += Math.sin(state.time * 7) * 0.14;
      _m.compose(_p, _q, _one);
      engineMesh.setMatrixAt(en, _m);
      engineMesh.setColorAt(en, _c.set(e.town.colour).lerp(WHITE, TOWN.TINT_MIX));
      en++;
    }
    engineMesh.count = en;
    engineMesh.instanceMatrix.needsUpdate = true;
    if (engineMesh.instanceColor) engineMesh.instanceColor.needsUpdate = true;

    if (wrecks.length !== wreckMesh.count) {
      for (let i = 0; i < wrecks.length && i < 24; i++) {
        _q.setFromAxisAngle(_axis, wrecks[i].yaw);
        _m.compose(wrecks[i].pos, _q, _one);
        wreckMesh.setMatrixAt(i, _m);
      }
      wreckMesh.count = Math.min(wrecks.length, 24);
      wreckMesh.instanceMatrix.needsUpdate = true;
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Plant the banner at the player's town to begin with.
  if (state.town) placeMarker(state.town.centre.x + 14, state.town.centre.z + 14);

  const api = {
    enabled: true,
    soldiers,
    marker,
    rally,
    spawnSoldier,
    countFor,
    garrisonCap,
    /** Alias town.js uses, so it need not know the internal name. */
    capFor: garrisonCap,
    buildEngine,
    engineCap,
    enginesOf,
    get engines() { return engines; },
    get dragging() { return dragging; },
    /** Garrison capacity of the player's town: barracks x GARRISON_PER_BARRACKS. */
    get playerArmyCap() {
      return state.town ? garrisonCap(state.town.playerTown) : 0;
    },
    /**
     * Why the player's barracks is not producing, or null if it is.
     * 'no barracks' | 'full' | 'food' | 'ore'
     */
    get playerTrainBlocked() {
      return state.town ? (state.town.playerTown.trainBlocked ?? null) : 'no barracks';
    },
    /** Total living soldiers on the player's side. */
    get playerArmy() {
      let n = 0;
      for (const s of soldiers) if (s.alive && s.town.isPlayer) n++;
      return n;
    },
    orderTo(x, z) { placeMarker(x, z); },
    /**
     * Living soldiers bucketed by position, rebuilt each sim tick. Read-only to
     * everyone else: villagers and the creature query it, nobody else fills it.
     */
    soldierGrid,
    /** Enemy soldiers currently inside the player's borders. */
    get intruders() {
      const t = state.town?.playerTown;
      if (!t) return 0;
      const r = t.influenceRadius + COMBAT.DEFEND_MARGIN;
      let n = 0;
      soldierGrid.near(t.centre.x, t.centre.z, r, (o) => {
        if (o.alive && hostile(o.town, t)) n++;
      });
      return n;
    },
    /** Towns currently marching on someone, for the HUD. */
    get raids() {
      return state.towns
        .filter((t) => t.warTarget)
        .map((t) => ({ from: t, to: t.warTarget, strength: partyOf(t) }));
    },
    /**
     * Where a given god's war is (Phase 20).
     *
     * The player's is the banner; a rival's is who is in its streets, then who
     * its army is marching on. Read by every creature, so that "am I at war"
     * asks one question whoever is asking it.
     */
     frontFor,
    /** Anything left in this town worth marching on. See worthFighting. */
    worthFighting,
    /** Hostiles inside one god's borders, or null. See homeThreatFor. */
    homeThreatFor,
    /** The rally point when the banner is an attack order, else null. */
    /** Men this town still owes itself after losses. Drives the barracks panel. */
    replacing: (town) => town?.toReplace ?? 0,
    get warFront() { return warFront(); },
    simStep,
    update
  };
  state.combat = api;
  return api;
}
