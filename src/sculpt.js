// ---------------------------------------------------------------------------
// sculpt.js - raising and lowering the ground.
//
// The verb this genre is built on, and the one the game did not have. The
// machinery was never missing: `terrain.deform` has been written, tested and
// public since Phase 1 - buildings flatten pads with it, fireballs dig craters
// with it - and the player simply had no way to reach it. This module is the
// interface, the cost, and the rules about what may not be moved.
//
// Held-key rather than a mode. Shift turns the cursor into a shovel for exactly
// as long as you hold it, which is the bargain Ctrl already makes for miracles:
// nothing to arm, nothing to get stuck in, and the moment you let go you are
// back to playing normally.
//
//   Shift + left-drag   raise
//   Shift + right-drag  lower
//   Shift + wheel       brush size
//
// Publishes state.sculpt.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { SCULPT, WORLD } from './state.js';

export function initSculpt(state) {
  const terrain = state.terrain;

  // --- the brush ring -------------------------------------------------------
  // A flat ring on the ground, the same idea as the miracle aiming circle: the
  // radius is a number you are choosing, so it has to be a thing you can see.
  const ringGeo = new THREE.RingGeometry(0.93, 1.0, 72);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x9be08a, transparent: true, opacity: 0.0,
    depthWrite: false, depthTest: false, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.renderOrder = 8;
  ring.frustumCulled = false;
  ring.visible = false;
  state.scene.add(ring);

  const raycaster = new THREE.Raycaster();
  const _hit = new THREE.Vector3();

  /**
   * While a stroke is in progress the cursor is projected onto a FIXED
   * horizontal plane, not onto the terrain.
   *
   * Raycasting the terrain every frame seems obvious and is wrong: raising the
   * ground moves the surface toward the camera, so the ray starts hitting it
   * sooner, so the brush creeps toward the viewer while you hold the button. It
   * carves a ridge running back at you instead of the dome you asked for, and
   * the longer you hold the further it wanders.
   *
   * Locking a plane at the height the stroke began fixes it, and it is the same
   * trick camera.js already uses to pan - grab a plane, re-project onto it, and
   * the world stops sliding under the thing you are pointing at.
   */
  const digPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let stroking = false;

  let radius = SCULPT.RADIUS_START;
  let mode = null;
  let active = false;
  let clearTimer = 0;
  /** Why the last attempt was refused, for the HUD. '' when it would work. */
  let refusal = '';
  let spentThisDrag = 0;

  /** The world point under the cursor, or null if the cursor is off the land. */
  function cursorTarget() {
    raycaster.setFromCamera(state.input.ndc, state.camera.cam);
    // Mid-stroke: the locked plane. Otherwise the ground itself.
    if (stroking) {
      return raycaster.ray.intersectPlane(digPlane, _hit) ? _hit : null;
    }
    const hits = raycaster.intersectObject(terrain.mesh, false);
    return hits.length ? hits[0].point : null;
  }

  /**
   * Belief for one tick of digging.
   *
   * Scaled by AREA, not radius: a brush twice as wide moves four times the
   * earth, and charging it twice as much would make the big brush strictly
   * better than the small one at everything.
   */
  function costFor(dt) {
    const scale = (radius / SCULPT.RADIUS_START) ** 2;
    return SCULPT.BELIEF_PER_SEC * scale * dt;
  }

  /**
   * The circles of ground this stroke must not touch: one per building near the
   * brush, plus one per town centre.
   *
   * A building sits on a pad flattened to a baked height with an instance
   * matrix to match, so moving the earth under it buries it or leaves it in the
   * air. The first version protected them by refusing the whole stroke whenever
   * the brush came near one - which meant you could not level beside your own
   * houses, and beside your own houses is precisely where you want to level.
   *
   * Handed to `terrain.deform` and `terrain.flatten`, which skip those cells.
   * The brush now works right up to a wall. Reused rather than reallocated:
   * this is built every frame of a drag.
   */
  const protect = [];
  function buildProtect(x, z) {
    protect.length = 0;
    const reach = radius + 40;                 // anything that could be in range
    for (const b of state.town?.allBuildings || []) {
      const dx = b.pos.x - x;
      const dz = b.pos.z - z;
      if (dx * dx + dz * dz > reach * reach) continue;
      protect.push({
        x: b.pos.x, z: b.pos.z,
        r: (b.def.pad || 4) * 0.6 + SCULPT.BUILD_CLEARANCE
      });
    }
    // Town centres too. A castle is not in `allBuildings` - it has its own mesh
    // and its own slot - so checking only that list left every keep in the game
    // sitting on ground the player could pull out from under it.
    for (const t of state.towns || []) {
      const dx = t.centre.x - x;
      const dz = t.centre.z - z;
      if (dx * dx + dz * dz > reach * reach) continue;
      protect.push({ x: t.centre.x, z: t.centre.z, r: SCULPT.CENTRE_CLEARANCE });
    }
    return protect;
  }

  /** True only when the brush is aimed squarely AT something protected. */
  function onProtected(x, z) {
    for (const c of buildProtect(x, z)) {
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  /** Why this spot cannot be sculpted right now, or '' if it can. */
  function refuse(at, dir, working = false) {
    if (!at) return 'no ground there';
    if (!state.town?.inInfluence(at.x, at.z)) return 'outside your reach';
    // Only when you are pointing straight at a building. Anywhere else the
    // stroke runs and terrain simply skips the protected ground.
    if (onProtected(at.x, at.z)) return 'the ground under it will not move';
    if (!working) return '';
    if (dir > 0 && terrain.heightAt(at.x, at.z) >= SCULPT.MAX_H) return 'high enough';
    if (dir < 0 && terrain.heightAt(at.x, at.z) <= SCULPT.MIN_H) return 'deep enough';
    if ((state.resources.belief ?? 0) < costFor(1 / 60)) return 'not enough belief';
    return '';
  }

  function update(dt) {
    const input = state.input;

    // Anything with its own claim on the mouse wins. Sculpting is a held-key
    // tool, and a held key is the easiest thing in the world to still be
    // holding when you meant to do something else.
    const blocked = !!(state.town?.placing || state.ui?.buildMenuOpen
      || state.ui?.zooOpen || state.ui?.actsOpen
      || state.miracles?.casting || state.hand?.isHolding);
    const held = input.keyDown('ShiftLeft') || input.keyDown('ShiftRight');

    if (!held || blocked) {
      if (active) {
        active = false;
        stroking = false;
        mode = null;
        spentThisDrag = 0;
        if (input.capturedBy === 'sculpt') input.capturedBy = null;
      }
      ring.visible = false;
      refusal = '';
      return;
    }

    // Claimed for as long as the key is down, so the left button digs instead
    // of panning the camera or reaching for a tree, and the right button digs
    // instead of ordering the creature somewhere.
    active = true;
    input.capture('sculpt');

    // The wheel sizes the brush rather than zooming. camera.js checks
    // `sculpt.active` for the same reason it checks `hand.isHolding`.
    if (input.wheel !== 0) {
      const k = input.wheel > 0 ? SCULPT.RADIUS_STEP : 1 / SCULPT.RADIUS_STEP;
      radius = THREE.MathUtils.clamp(radius * k, SCULPT.RADIUS[0], SCULPT.RADIUS[1]);
      input.wheel = 0;
    }

    // Both buttons together is LEVEL - the same "third gesture" the camera
    // already uses for orbit, and it reads without a legend: left raises, right
    // lowers, both flatten. Checked first, because with both down `buttons[0]`
    // is true and a naive test would just raise.
    // TWO ways to level, because one of them cannot be performed on a lot of
    // hardware. Both buttons together is the original gesture; Alt with either
    // button is the one that works on a trackpad. Sculpt has already claimed
    // the mouse by this point, so Alt+left does not orbit the camera.
    const alt = input.keyDown('AltLeft') || input.keyDown('AltRight');
    const levelling = (input.buttons[0] && input.buttons[2])
      || (SCULPT.LEVEL_ON_ALT && alt && (input.buttons[0] || input.buttons[2]));
    const dir = levelling ? 0 : input.buttons[0] ? 1 : input.buttons[2] ? -1 : 0;
    const working = levelling || dir !== 0;
    mode = levelling ? 'level' : dir > 0 ? 'raise' : dir < 0 ? 'lower' : null;

    // Lock the plane on the press edge, release it when the buttons come up.
    // For levelling this plane is doing double duty: it stops the brush drifting
    // AND its height is the level being flattened to.
    if (working && !stroking) {
      raycaster.setFromCamera(input.ndc, state.camera.cam);
      const first = raycaster.intersectObject(terrain.mesh, false);
      if (first.length) {
        digPlane.constant = -first[0].point.y;
        stroking = true;
      }
    } else if (!working && stroking) {
      stroking = false;
    }

    const at = cursorTarget();
    // Levelling has no direction, so the height limits do not apply to it - it
    // can only ever move ground toward somewhere the ground already was.
    refusal = refuse(at, levelling ? 0 : dir, working);

    // --- the ring -----------------------------------------------------------
    if (at) {
      ring.visible = true;
      // Lifted clear of the surface it is drawn on; depthTest is off anyway,
      // but a ring buried in a hillside still reads as a ring on a hillside.
      ring.position.set(at.x, at.y + 0.35, at.z);
      ring.scale.setScalar(radius);
      ringMat.color.setHex(
        refusal ? 0xff9d8a
          : levelling ? 0xfff3d9          // levelling: pale, like a spirit level
            : dir > 0 ? 0x9be08a
              : dir < 0 ? 0x8fd8ff : 0xffe9b8);
      ringMat.opacity = refusal ? 0.35 : 0.7;
    } else {
      ring.visible = false;
    }

    if (!working) { spentThisDrag = 0; return; }
    if (refusal) return;

    // --- move the earth -----------------------------------------------------
    const cost = costFor(dt);
    state.resources.belief -= cost;
    spentThisDrag += cost;
    const keep = buildProtect(at.x, at.z);
    if (levelling) {
      // Toward the height the stroke began at - which is `digPlane`, already
      // locked for exactly this position and now serving as the level too.
      terrain.flatten(at.x, at.z, radius, -digPlane.constant,
        Math.min(1, SCULPT.FLATTEN_RATE * dt), keep);
    } else {
      terrain.deform(at.x, at.z, radius, SCULPT.RATE * dir * dt, keep);
    }

    // Whatever was growing here went with the ground. Throttled, because
    // clearing walks every instance of every decorative mesh and doing that
    // per frame to hide grass is a poor trade. `terrain.deform` already emits
    // `terrain-changed`, which is what re-settles the props.
    clearTimer -= dt;
    if (clearTimer <= 0) {
      clearTimer = SCULPT.CLEAR_INTERVAL;
      state.flora?.clearAround(at.x, at.z, radius * 0.92);
      state.scenery?.clearAround(at.x, at.z, radius * 0.92);
    }
  }

  const api = {
    enabled: true,
    /** True while Shift is held and the tool has the mouse. */
    get active() { return active; },
    get radius() { return radius; },
    /** 'raise' | 'lower' | 'level' | null - what the brush is doing now. */
    get mode() { return mode; },
    /** Why the cursor is refusing, or '' - the HUD prints this. */
    get refusal() { return refusal; },
    get costPerSecond() { return SCULPT.BELIEF_PER_SEC * (radius / SCULPT.RADIUS_START) ** 2; },
    get spentThisDrag() { return spentThisDrag; },
    update
  };
  state.sculpt = api;
  return api;
}
