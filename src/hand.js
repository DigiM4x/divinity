// ---------------------------------------------------------------------------
// hand.js - the divine hand: cursor projection, grabbing, carrying, throwing.
//
// This is the feel of the whole game, so a note on how it works:
//
//  1. The hand's *target* is the cursor projected onto the terrain (empty) or
//     onto a horizontal plane at the carry height (holding). Lateral movement
//     is therefore always 1:1 with the mouse; height is a separate axis you
//     control with the wheel. Trying to drive height from the terrain under the
//     cursor while carrying feels awful - the object jumps whenever you sweep
//     across a hill.
//
//  2. A held object does not teleport to the target. It is pulled by a damped
//     spring, sub-stepped for stability. That lag is what gives weight: a heavy
//     boulder trails your cursor, a light rock snaps to it.
//
//  3. The throw velocity is a blend of the object's own spring velocity and the
//     averaged cursor velocity over the last ~90ms. Spring velocity alone feels
//     mushy (the object never catches up to a fast flick); cursor velocity alone
//     ignores mass. Blending gives you both the whip of a flick and the heft of
//     a big rock. A little upward bias is added so throws arc instead of
//     skimming, which is what players expect from watching the hand.
//
// Publishes state.hand.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { HAND, WORLD, PRAYER} from './state.js';

// --- procedural hand model --------------------------------------------------

function makeHandModel() {
  const root = new THREE.Group();

  // Warm skin rather than white: under ACES a near-white albedo in full sun
  // clips to a flat silhouette and the fingers stop reading as fingers.
  const skin = new THREE.MeshStandardMaterial({
    // NOTE: `color` and `emissive` here are the values for frame zero only -
    // `update` rewrites both every frame from alignment. Tune the skin THERE,
    // not here. Roughness and intensity are the parts that stick.
    color: 0xc08356,
    roughness: 0.64,
    metalness: 0.0,
    emissive: 0x2a1b0d,
    emissiveIntensity: 0.16
  });

  // Palm: a squashed sphere reads more like flesh than a box does. Wider than
  // it is long, so the silhouette from above is a hand and not a ball.
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin);
  palm.scale.set(1.42, 0.50, 1.10);
  palm.castShadow = true;
  root.add(palm);

  // Wrist, tapering away behind the palm so an arm seems to continue offscreen.
  //
  // Thinner and shorter than it was. Seen from the usual overhead angle the old
  // one was the LARGEST object on screen - the palm sat on top of it and the
  // whole thing read as a mushroom rather than a hand. A wrist should be a hint
  // that an arm continues somewhere, not the subject of the picture.
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 1.55, 10), skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, -0.02, -1.34);
  wrist.castShadow = true;
  root.add(wrist);

  /**
   * A finger is three nested groups so a single `curl` value can rotate all
   * three joints by decreasing amounts - the natural way fingers close.
   */
  function makeFinger(len, rad, spread) {
    const base = new THREE.Group();
    const segLens = [len * 0.44, len * 0.33, len * 0.23];
    let parent = base;
    const joints = [];
    for (let s = 0; s < 3; s++) {
      const joint = new THREE.Group();
      const r = rad * (1 - s * 0.16);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, segLens[s], 3, 7), skin);
      seg.rotation.x = Math.PI / 2;
      seg.position.z = segLens[s] / 2 + r * 0.4;
      seg.castShadow = true;
      joint.add(seg);
      parent.add(joint);
      if (s > 0) joint.position.z = segLens[s - 1] + rad * 0.7;
      joints.push(joint);
      parent = joint;
    }
    base.rotation.y = spread;
    base.userData.joints = joints;
    return base;
  }

  // THICKER, SHORTER, BARELY SPLAYED.
  //
  // The previous set was slim and splayed hard, on the theory that packing them
  // tightly turns the hand into a mitten. It overcorrected into the opposite
  // failure: four thin rods fanned out at twenty-three degrees is a spider, not
  // a hand. A relaxed human hand splays about eight degrees, and its fingers
  // very nearly fill the width of the palm - here four of them came to half the
  // palm's width, which is what made them read as tendrils.
  //
  // The mitten is avoided by leaving a hair of daylight between them and
  // letting the shading do the separating, rather than by fanning them out.
  const fingers = [];
  const layout = [
    { x: -0.94, z: 0.70, len: 1.48, rad: 0.250, spread: 0.17 },
    { x: -0.32, z: 0.90, len: 1.70, rad: 0.265, spread: 0.06 },
    { x: 0.31, z: 0.88, len: 1.60, rad: 0.258, spread: -0.05 },
    { x: 0.90, z: 0.66, len: 1.30, rad: 0.232, spread: -0.16 }
  ];
  for (const f of layout) {
    const finger = makeFinger(f.len, f.rad, f.spread);
    finger.position.set(f.x, 0.02, f.z);
    root.add(finger);
    fingers.push(finger);
  }

  // Thumb: swung well out to the side so it breaks the silhouette and gives the
  // hand a definite handedness.
  const thumb = makeFinger(1.24, 0.300, 0);
  thumb.position.set(-1.26, 0.0, -0.16);
  thumb.rotation.set(0, 1.30, -0.42);
  root.add(thumb);
  fingers.push(thumb);

  root.scale.setScalar(2.6);
  return { root, fingers, material: skin };
}

// ---------------------------------------------------------------------------
export function initHand(state) {
  const model = makeHandModel();
  const group = new THREE.Group();
  group.add(model.root);
  state.scene.add(group);

  // Where the hand wants to be, in world space.
  const target = new THREE.Vector3();
  // Where it actually is (smoothed toward target at render rate).
  const pos = new THREE.Vector3();
  const surfaceNormal = new THREE.Vector3(0, 1, 0);

  const raycaster = new THREE.Raycaster();
  const carryPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _hit = new THREE.Vector3();
  const _tmp = new THREE.Vector3();
  const _tmp2 = new THREE.Vector3();
  const _dq = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _qa = new THREE.Quaternion();

  let held = null;
  /** True when `held` is a villager rather than a prop. See tryGrab. */
  let heldIsPerson = false;
  /** Where the held thing was lifted from. See state.miracles.clearedGround. */
  const grabbedAt = new THREE.Vector3();
  let carryHeight = HAND.CARRY_HOVER; // world-space Y of the carry plane
  let curl = 0; // 0 open, 1 closed
  let wantCurl = 0;
  let onTerrain = false;

  // Ring buffer of recent hand positions, used to measure flick velocity.
  const HIST = 12;
  const histPos = [];
  const histTime = new Float32Array(HIST);
  for (let i = 0; i < HIST; i++) histPos.push(new THREE.Vector3());
  let histCount = 0;
  let histHead = 0;
  const handVel = new THREE.Vector3();

  function pushHistory(p, t) {
    histHead = (histHead + 1) % HIST;
    histPos[histHead].copy(p);
    histTime[histHead] = t;
    if (histCount < HIST) histCount++;
  }

  /**
   * Average velocity over the last VELOCITY_WINDOW seconds of cursor motion.
   * Averaging (rather than taking the last frame's delta) stops a single
   * stuttered frame from launching an object into orbit.
   */
  function computeHandVelocity(now, out) {
    out.set(0, 0, 0);
    if (histCount < 2) return out;
    let oldest = histHead;
    for (let k = 1; k < histCount; k++) {
      const i = (histHead - k + HIST) % HIST;
      if (now - histTime[i] > HAND.VELOCITY_WINDOW) break;
      oldest = i;
    }
    const dt = histTime[histHead] - histTime[oldest];
    if (dt < 1e-4) return out;
    return out.subVectors(histPos[histHead], histPos[oldest]).divideScalar(dt);
  }

  // --- picking --------------------------------------------------------------
  function updateTarget() {
    const cam = state.camera.cam;
    raycaster.setFromCamera(state.input.ndc, cam);

    if (held) {
      // Horizontal plane at the carry height: lateral motion stays 1:1.
      carryPlane.constant = -carryHeight;
      if (raycaster.ray.intersectPlane(carryPlane, _hit)) {
        target.copy(_hit);
      }
      // Keep the carry point on the map.
      const lim = WORLD.HALF - 6;
      target.x = THREE.MathUtils.clamp(target.x, -lim, lim);
      target.z = THREE.MathUtils.clamp(target.z, -lim, lim);
      target.y = carryHeight;
      // ...and never let it be pushed below the ground under it.
      const g = state.terrain.heightAt(target.x, target.z) + held.radius + 0.4;
      if (target.y < g) target.y = g;
      onTerrain = true;
      surfaceNormal.set(0, 1, 0);
      return;
    }

    const hits = raycaster.intersectObject(state.terrain.mesh, false);
    if (hits.length) {
      target.copy(hits[0].point);
      state.terrain.normalAt(target.x, target.z, surfaceNormal);
      target.y = Math.max(target.y, WORLD.SEA_LEVEL) + HAND.IDLE_HOVER;
      onTerrain = true;
    } else {
      // Cursor is off the island (sky or open sea): fall back to the water plane.
      carryPlane.constant = -WORLD.SEA_LEVEL;
      if (raycaster.ray.intersectPlane(carryPlane, _hit)) {
        target.copy(_hit);
        target.y = WORLD.SEA_LEVEL + HAND.IDLE_HOVER;
        onTerrain = true;
      } else {
        onTerrain = false;
      }
    }
  }

  // --- grab / release -------------------------------------------------------
  /**
   * What the hand would pick up right now.
   *
   * Exact geometry first, so anything genuinely under the cursor wins; then a
   * forgiving screen-space snap. Both the highlight and the actual grab go
   * through this, which matters: what you see highlighted is guaranteed to be
   * what you get.
   */
  function pickUnderCursor() {
    const cam = state.camera.cam;
    raycaster.setFromCamera(state.input.ndc, cam);
    const exact = state.props.raycast(raycaster);
    if (exact) return exact;

    const el = state.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const prop = state.props.pickNear(state.input.ndc, cam, w, h, HAND.PICK_TOLERANCE_PX);
    const person = state.villagers?.pickNear(
      state.input.ndc, cam, w, h, HAND.PICK_TOLERANCE_PX
    );

    // Both in reach: take whichever is nearer the cursor in pixels. Neither
    // kind gets priority, because a rule like "props first" makes people
    // impossible to grab in a busy street and "people first" makes it hard to
    // pick up the tree they are standing next to.
    if (prop && person) return person.screenDist < prop.screenDist ? person : prop;
    return prop ?? person;
  }

  function tryGrab() {
    const hit = pickUnderCursor();
    if (!hit) return false;

    // A villager is carried by exactly the same spring as a rock - it only
    // needs pos/vel/mass/radius, which villagers now have. What differs is the
    // bookkeeping at each end, so the kind is remembered rather than sniffed.
    heldIsPerson = !!hit.villager;
    held = hit.villager ?? hit.prop;
    held.held = true;
    if (heldIsPerson) {
      held.flying = false;
      held.vel.set(0, 0, 0);
      held.angVel.set(0, 0, 0);
      // Note whether they were in danger at the moment they were lifted, so
      // that putting them down somewhere else can be told apart from simply
      // throwing someone about. villagers.js clears it on landing.
      state.villagers.markPeril?.(held);
    } else {
      held.awake = true;
      held.sleepT = 0;
      held.variant.dirty = true;
    }

    // Start carrying from just above where it was, so it lifts rather than
    // teleporting to a fixed altitude.
    carryHeight = Math.max(
      held.pos.y + 2.5,
      state.terrain.heightAt(held.pos.x, held.pos.z) + HAND.CARRY_HOVER
    );
    carryHeight = THREE.MathUtils.clamp(
      carryHeight,
      WORLD.SEA_LEVEL + HAND.MIN_CARRY_HOVER,
      HAND.MAX_CARRY_HOVER + WORLD.MAX_HEIGHT
    );

    // Where it was, so releasing it can tell whether the ground got cleared.
    grabbedAt.copy(held.pos);

    wantCurl = 1;
    state.input.capture('hand');
    state.debug.lastLog = heldIsPerson
      ? `grabbed a villager of ${held.town?.name ?? '?'}`
      : `grabbed ${held.kind} #${held.id} (mass ${held.mass.toFixed(1)})`;
    return true;
  }

  function release(now) {
    if (!held) return;
    const p = held;

    computeHandVelocity(now, handVel);

    // Blend the object's own (lagging) velocity with the cursor's flick.
    const v = _tmp.copy(p.vel).multiplyScalar(1 - HAND.THROW_BLEND)
      .addScaledVector(handVel, HAND.THROW_BLEND)
      .multiplyScalar(HAND.THROW_GAIN);

    // Upward bias proportional to horizontal speed, so throws arc.
    const horiz = Math.hypot(v.x, v.z);
    v.y += horiz * HAND.THROW_ARC_BIAS;

    if (v.length() > HAND.MAX_THROW_SPEED) v.setLength(HAND.MAX_THROW_SPEED);
    p.vel.copy(v);

    // Tumble, scaled by throw speed. Axis perpendicular to travel looks right.
    const spin = v.length() * HAND.THROW_SPIN;
    _tmp2.set(-v.z, 0, v.x);
    if (_tmp2.lengthSq() < 1e-5) _tmp2.set(1, 0, 0);
    _tmp2.normalize().multiplyScalar(spin);
    p.angVel.copy(_tmp2);
    p.angVel.y += (Math.random() - 0.5) * spin * 0.5;

    // A tree or a rock set down inside a town's reach is timber or stone the
    // people can actually get at. Emitted as a fact whatever the intent -
    // prayers.js decides whether anybody had asked for it.
    if (!heldIsPerson && p.resource && !p.harvested && !p.dead) {
      for (const t of state.towns ?? []) {
        if (!state.town?.inInfluenceOf?.(t, p.pos.x, p.pos.z)) continue;
        state.events?.emit('resource-offered', {
          type: p.resource, pos: p.pos.clone(), town: t, by: 'player'
        });
        break;
      }
    }

    if (heldIsPerson) {
      // Hand them over to villagers.js, which flies them and decides whether
      // they land, break their legs, or go in the sea.
      state.villagers.launch(p);
      held = null;
      heldIsPerson = false;
      wantCurl = 0;
      state.debug.lastLog = `threw a villager at ${v.length().toFixed(0)} u/s`;
      return;
    }

    p.held = false;
    p.awake = true;
    p.sleepT = 0;
    state.props.wake(p);

    // Tidying a town in front of the people who live in it is a small wonder.
    state.miracles?.clearedGround?.(grabbedAt, p.pos, p);

    // The creature learns by watching. A throw with real force behind it is a
    // demonstration of play; where it lands decides whether it was also a
    // demonstration of violence (see the impact handling in props.js).
    if (v.length() > 12) {
      state.events?.emit('prop-thrown', { prop: p, type: p.kind, pos: p.pos, speed: v.length() });
    }

    state.debug.lastLog = `threw ${p.kind} #${p.id} at ${v.length().toFixed(1)} u/s`;
    held = null;
    wantCurl = 0;
    if (state.input.capturedBy === 'hand') state.input.capturedBy = null;
  }

  // --- fixed-step: the carry spring ----------------------------------------
  function simStep(dt) {
    if (!held) return;
    const p = held;
    p.prev.copy(p.pos);
    // Props carry a full orientation quaternion; villagers are baked-pose
    // flipbooks that only ever have a yaw. Touching p.quat on a villager threw
    // every single frame - and because the hand simulates FIRST, that aborted
    // the whole sim tick, so nothing in the world moved while one was held.
    if (!heldIsPerson) p.prevQuat.copy(p.quat);

    // Heavier objects get a softer spring and so lag further behind the hand.
    const massLag = Math.pow(Math.max(0.3, p.mass), HAND.MASS_LAG);
    const k = HAND.GRAB_STIFFNESS / massLag;
    const c = HAND.GRAB_DAMPING / Math.sqrt(massLag);

    // Sub-step: a stiff spring at a 50ms tick would ring or explode.
    const SUB = 5;
    const sdt = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      _tmp.subVectors(target, p.pos).multiplyScalar(k);
      _tmp.addScaledVector(p.vel, -c);
      p.vel.addScaledVector(_tmp, sdt);
      if (p.vel.lengthSq() > HAND.MAX_HELD_SPEED * HAND.MAX_HELD_SPEED) {
        p.vel.setLength(HAND.MAX_HELD_SPEED);
      }
      p.pos.addScaledVector(p.vel, sdt);
    }

    // Held objects settle upright-ish and spin down, so you can aim them.
    p.angVel.multiplyScalar(Math.pow(0.55, dt));
    if (heldIsPerson) {
      // A dangling villager just turns on the spot, which is all a flipbook can
      // do and quite enough to read as being held by the scruff.
      p.prevYaw = p.yaw;
      p.yaw += p.angVel.y * dt;
      return;
    }
    const a = p.angVel.length();
    if (a > 1e-4) {
      _dq.setFromAxisAngle(_tmp2.copy(p.angVel).multiplyScalar(1 / a), a * dt);
      p.quat.premultiply(_dq).normalize();
    }
  }

  // --- render-step ----------------------------------------------------------
  function update(dt, now) {
    const input = state.input;

    // Grab on press, release on release. Both resolved at render rate so the
    // response is immediate rather than up to 50ms late.
    // Build mode owns the cursor while a ghost is being positioned. Alt is the
    // camera-orbit modifier, so it has to suppress grabbing too - otherwise the
    // hand snatches whatever is under the cursor and captures the button, and
    // Alt+drag silently fails to orbit.
    // Alt and the right button are both camera-orbit modifiers, so neither may
    // grab: otherwise the hand snatches whatever is under the cursor and
    // captures the button, and the orbit silently fails to start.
    const alt = input.keyDown('AltLeft') || input.keyDown('AltRight');
    const blocked = alt || input.buttons[2]
      || !!state.town?.placing || !!state.ui?.buildMenuOpen;
    if (input.pressed[0] && !input.isCaptured('hand') && !held && !blocked) {
      tryGrab();
    }
    // Release on the button-up edge, but also whenever the button simply is not
    // down any more. A pointerup delivered outside the canvas (alt-tab, a
    // dragged-off release) would otherwise leave an object stuck to the hand.
    if (held && (input.released[0] || !input.buttons[0])) {
      release(now);
    }

    // Wheel raises/lowers a carried object instead of zooming.
    if (held && input.wheel !== 0) {
      carryHeight -= input.wheel * HAND.CARRY_LIFT_SPEED * Math.max(4, state.camera.dist * 0.2);
      const floor = state.terrain.heightAt(target.x, target.z) + HAND.MIN_CARRY_HOVER + held.radius;
      carryHeight = THREE.MathUtils.clamp(carryHeight, floor, WORLD.MAX_HEIGHT + HAND.MAX_CARRY_HOVER);
    }

    // Highlight whatever a click would grab, so near-misses stop being a
    // mystery. Suppressed while carrying, building, or petting the creature.
    const busy = held || state.town?.placing || state.ui?.buildMenuOpen
      || state.creature?.hovering;
    state.props.setHighlight(busy ? null : pickUnderCursor()?.prop ?? null);

    updateTarget();
    if (held) input.capture('hand');

    // The visual hand chases its target; while carrying it sits on the object
    // so the object looks held rather than dragged along on a string.
    const smoothing = held ? 26 : 17;
    const s = 1 - Math.exp(-smoothing * dt);
    if (held) {
      _tmp.copy(held.pos).addScaledVector(_tmp2.set(0, 1, 0), held.radius * 0.6 + 1.2);
      pos.lerp(_tmp, s);
    } else {
      pos.lerp(target, s);
      // Gentle idle bob so the hand never looks frozen.
      pos.y += Math.sin(now * 1.7) * 0.16 + Math.sin(now * 2.9) * 0.07;
    }
    pushHistory(pos, now);

    group.position.copy(pos);

    // --- orientation ---------------------------------------------------------
    // Built as an explicit orthonormal basis rather than Euler angles. Composing
    // yaw with a terrain-normal tilt as Eulers applies the tilt in the already-
    // yawed frame, which on a steep slope swings the fingers up into the sky.
    computeHandVelocity(now, handVel);
    const speed = handVel.length();

    // Fingers point away from the viewer along the ground.
    const camAz = state.camera.azimuth;
    _fwd.set(-Math.sin(camAz), 0, -Math.cos(camAz));

    // Palm normal leans toward the terrain, but only slightly - a hand that
    // fully matches a cliff face reads as broken, not as following the ground.
    _up.set(0, 1, 0);
    if (!held) _up.lerp(surfaceNormal, HAND.NORMAL_FOLLOW).normalize();

    // Gram-Schmidt: make forward perpendicular to up, then right = up x forward.
    _fwd.addScaledVector(_up, -_fwd.dot(_up)).normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _basis.makeBasis(_right, _up, _fwd);
    group.quaternion.setFromRotationMatrix(_basis);

    // Bank into the direction of travel: roll about the finger axis, pitch about
    // the palm-width axis. Both are real world-space axes now, so the lean is
    // correct at any camera azimuth.
    const roll = THREE.MathUtils.clamp(-handVel.dot(_right) * HAND.BANK, -0.45, 0.45);
    // A constant nose-down pitch on top of the velocity lean. With the fingers
    // pointing dead away from the camera they foreshorten to nothing; angling
    // them at the ground puts their length back on screen and reads as a hand
    // reaching down, which is the pose the whole game is about.
    const pitch = HAND.REST_PITCH
      + THREE.MathUtils.clamp(handVel.dot(_fwd) * HAND.BANK, -0.35, 0.35);
    _qa.setFromAxisAngle(_fwd, roll);
    group.quaternion.multiply(_qa);
    _qa.setFromAxisAngle(_right, pitch);
    group.quaternion.multiply(_qa);

    // Fingers: closed when holding, and they part slightly at high speed as if
    // trailing in the air.
    wantCurl = held ? 1 : THREE.MathUtils.clamp(speed * 0.004, 0, 0.22);
    const cs = HAND.FINGER_SPEED * dt;
    curl += THREE.MathUtils.clamp(wantCurl - curl, -cs, cs);

    for (let i = 0; i < model.fingers.length; i++) {
      const isThumb = i === model.fingers.length - 1;
      const joints = model.fingers[i].userData.joints;
      const base = curl * (isThumb ? 0.85 : 1);
      joints[0].rotation.x = base * 1.15;
      joints[1].rotation.x = base * 1.35;
      joints[2].rotation.x = base * 1.05;
    }

    // Grow the hand when far away so it stays readable when zoomed out.
    const camDist = state.camera.dist;
    model.root.scale.setScalar(2.6 * (0.85 + camDist / 420));

    // The hand carries the player's alignment: warm flesh when merciful, ashen
    // and red-lit when cruel. Recolouring the one material, not a second model.
    const al = state.alignment ?? 0;
    const evil = Math.max(0, -al);
    const good = Math.max(0, al);
    // A MID-TONE, not a light one.
    //
    // The neutral hand used to sit at 0.86/0.70/0.54, which is a bright tan -
    // and a bright tan under a 2.35-intensity sun with ACES tone mapping is
    // white. The whole hand clipped to one flat silhouette, which is why the
    // fingers read as tendrils no matter what shape they were: you cannot see
    // form you have no shading left to describe it with.
    //
    // Dropping the albedo about a third costs a highlight nobody was enjoying
    // and buys back the knuckles, the gap between the fingers, and the curve of
    // the palm. The good/evil swing is unchanged, just applied from lower down.
    model.material.color.setRGB(
      0.62 + good * 0.08 - evil * 0.22,
      0.44 + good * 0.11 - evil * 0.28,
      0.30 + good * 0.14 - evil * 0.20
    );
    // Darken the glow as it turns cruel rather than brightening it. Adding
    // emissive on top of a red albedo under ACES just clips the hand to a
    // flat pale blob - the opposite of the intended ashen look.
    // And far less of it. The comment above was right about cruelty and just as
    // true at neutral: 0.23 of red emissive on top of an already-bright albedo
    // was half of what was washing the hand out.
    model.material.emissive.setRGB(
      0.10 * (1 - evil * 0.5) + evil * 0.14,
      0.06 * (1 - evil * 0.6),
      0.03 * (1 - evil * 0.6)
    );
  }

  const api = {
    group,
    get position() { return pos; },
    get target() { return target; },
    get isHolding() { return held !== null; },
    get held() { return held; },
    get carryHeight() { return carryHeight; },
    get onTerrain() { return onTerrain; },
    get velocity() { return handVel; },
    setColor(hex) { model.material.color.set(hex); },
    simStep,
    update,
    release
  };
  state.hand = api;
  return api;
}
