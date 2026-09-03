// ---------------------------------------------------------------------------
// camera.js - RTS orbit rig.
//
//   left-drag on empty ground : pan (the grabbed ground point stays under the
//                               cursor, which is what makes panning feel right)
//   WASD / arrows             : pan, relative to where the camera is looking
//   right-drag                : orbit
//   wheel                     : zoom (unless the hand is carrying something)
//   middle-drag               : pan
//
// Publishes state.camera: { cam, target, dist, azimuth, polar, focus() }
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CAMERA, WORLD } from './state.js';

export function initCamera(state, domElement) {
  const cam = new THREE.PerspectiveCamera(
    52,
    domElement.clientWidth / domElement.clientHeight,
    0.5,
    4000
  );

  const target = new THREE.Vector3(0, 0, 0);
  // Desired values; the live values chase these with exponential smoothing.
  let wantDist = CAMERA.START_DIST;
  let wantAz = Math.PI * 0.25;
  let wantPolar = CAMERA.START_POLAR;
  let dist = wantDist;
  let az = wantAz;
  let polar = wantPolar;

  const boundR = WORLD.HALF * CAMERA.BOUNDS_FRAC;

  // Pan bookkeeping: the world point we grabbed, and the horizontal plane it
  // lives on. Each frame we re-project the cursor onto that plane and shove the
  // target by the residual, which converges to "point stays under cursor".
  const panPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const panAnchor = new THREE.Vector3();
  let panning = false;

  const raycaster = new THREE.Raycaster();
  const ray = new THREE.Vector3();
  const hit = new THREE.Vector3();

  function projectToPlane(ndc, out) {
    raycaster.setFromCamera(ndc, cam);
    return raycaster.ray.intersectPlane(panPlane, out);
  }

  function applyTransform() {
    const sinP = Math.sin(polar);
    cam.position.set(
      target.x + dist * sinP * Math.sin(az),
      target.y + dist * Math.cos(polar),
      target.z + dist * sinP * Math.cos(az)
    );
    // Never let the eye clip into a hillside.
    const terrain = state.terrain;
    if (terrain) {
      const ground = terrain.heightAt(cam.position.x, cam.position.z) + CAMERA.GROUND_CLEARANCE;
      if (cam.position.y < ground) cam.position.y = ground;
    }
    cam.lookAt(target);
    // Raycasts (hand picking, camera panning) happen before the next render,
    // so the world matrix has to be current now, not at draw time.
    cam.updateMatrixWorld();
  }

  function clampTarget() {
    const r = Math.hypot(target.x, target.z);
    if (r > boundR) {
      target.x = (target.x / r) * boundR;
      target.z = (target.z / r) * boundR;
    }
    if (state.terrain) {
      // Follow the ground so zooming stays framed on the surface, not on y=0.
      const g = Math.max(WORLD.SEA_LEVEL, state.terrain.heightAt(target.x, target.z));
      target.y += (g - target.y) * 0.25;
    }
  }

  function update(dt) {
    const input = state.input;

    // --- orbit ---
    // The right button used to orbit on its own, then went to miracle gestures,
    // and now commands the creature (see creature.js). Orbiting is therefore:
    // both buttons at once, middle-drag, Alt + left-drag, or Q/E. Both-buttons
    // needs no extra hardware and no modifier key, so it is the primary.
    const alt = input.keyDown('AltLeft') || input.keyDown('AltRight');
    const both = input.buttons[0] && input.buttons[2];
    const orbiting = both || input.buttons[1] || (alt && input.buttons[0]);
    if (orbiting && !input.isCaptured('camera')) {
      if (input.delta.x !== 0 || input.delta.y !== 0) input.capture('camera');
      wantAz -= input.delta.x * CAMERA.ROTATE_SPEED;
      wantPolar -= input.delta.y * CAMERA.ROTATE_SPEED;
      wantPolar = THREE.MathUtils.clamp(wantPolar, CAMERA.MIN_POLAR, CAMERA.MAX_POLAR);
    }

    // Keyboard orbit, for anyone without a middle button.
    if (input.keyDown('KeyQ')) wantAz += CAMERA.KEY_ROTATE_SPEED * dt;
    if (input.keyDown('KeyE')) wantAz -= CAMERA.KEY_ROTATE_SPEED * dt;

    // --- keyboard pan (WASD / arrows) ---
    //
    // Relative to where the camera is LOOKING, not to world axes. W has to mean
    // "away from me" whichever way the rig has been orbited, or the controls
    // invert themselves every time you turn a corner.
    //
    // The camera sits at target + dist * (sin az, _, cos az), so the horizontal
    // forward vector is the negative of that, and right is forward x up.
    {
      let fwd = 0;
      let strafe = 0;
      if (input.keyDown('KeyW') || input.keyDown('ArrowUp')) fwd += 1;
      if (input.keyDown('KeyS') || input.keyDown('ArrowDown')) fwd -= 1;
      if (input.keyDown('KeyD') || input.keyDown('ArrowRight')) strafe += 1;
      if (input.keyDown('KeyA') || input.keyDown('ArrowLeft')) strafe -= 1;

      if (fwd || strafe) {
        // Normalised, so holding W and D does not travel 1.41x faster than
        // holding either one alone.
        const len = Math.hypot(fwd, strafe);
        fwd /= len;
        strafe /= len;
        const sinA = Math.sin(az);
        const cosA = Math.cos(az);
        // Speed follows the zoom - see CAMERA.KEY_PAN_SPEED.
        const v = dist * CAMERA.KEY_PAN_SPEED * dt;
        target.x += (-sinA * fwd + cosA * strafe) * v;
        target.z += (-cosA * fwd - sinA * strafe) * v;
        // A keyboard pan under way invalidates a drag anchor: the ground has
        // moved out from under the cursor, and without this the next frame of
        // the drag would yank it straight back.
        panning = false;
      }
    }

    // --- zoom ---
    // The hand claims the wheel while carrying, to raise/lower the object, and
    // the shovel claims it while sculpting, to size the brush.
    if (input.wheel !== 0 && !(state.hand && state.hand.isHolding)
        && !state.sculpt?.active) {
      wantDist *= Math.exp(input.wheel * CAMERA.ZOOM_SPEED);
      wantDist = THREE.MathUtils.clamp(wantDist, CAMERA.MIN_DIST, CAMERA.MAX_DIST);
    }

    // --- pan (left-drag on empty ground) ---
    // Alt and the right button both reserve the left button for orbiting. When
    // a pan is already under way and the second button arrives, wantsPan goes
    // false, which drops `panning` and re-anchors cleanly on the way back out.
    const wantsPan = input.buttons[0] && !alt && !both && !input.isCaptured('camera');

    if (wantsPan && !panning) {
      panPlane.constant = -target.y;
      if (projectToPlane(input.ndc, hit)) {
        panAnchor.copy(hit);
        panning = true;
      }
    } else if (!wantsPan) {
      panning = false;
    }

    if (panning) {
      panPlane.constant = -target.y;
      if (projectToPlane(input.ndc, hit)) {
        ray.subVectors(panAnchor, hit);
        ray.y = 0;
        // Guard against the near-horizon case where the ray is almost parallel
        // to the plane and a pixel of movement maps to a kilometre of world.
        const maxStep = dist * 0.6;
        if (ray.lengthSq() > maxStep * maxStep) ray.setLength(maxStep);
        target.add(ray);
        if (input.delta.x !== 0 || input.delta.y !== 0) input.capture('camera');
      }
    }

    clampTarget();

    // Exponential smoothing, frame-rate independent.
    const k = 1 - Math.exp(-CAMERA.SMOOTH * dt);
    dist += (wantDist - dist) * k;
    polar += (wantPolar - polar) * k;
    // Shortest-path angle blend so wrapping past PI does not spin the world.
    let dAz = wantAz - az;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;
    az += dAz * k;

    applyTransform();
  }

  function resize(w, h) {
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  applyTransform();

  const api = {
    cam,
    target,
    get dist() { return dist; },
    get azimuth() { return az; },
    get polar() { return polar; },
    update,
    resize,
    /** Snap the rig to look at a world position. */
    focus(x, z, d) {
      target.x = x;
      target.z = z;
      if (d) wantDist = THREE.MathUtils.clamp(d, CAMERA.MIN_DIST, CAMERA.MAX_DIST);
      clampTarget();
      applyTransform();
    }
  };

  state.camera = api;
  return api;
}
