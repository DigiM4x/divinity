// ---------------------------------------------------------------------------
// prayermarks.js - the little lights over the people who are asking.
//
// A prayer that only exists in a panel is a spreadsheet row. This draws one
// procedural mark per active prayer, floating over the villager or the town
// that raised it, so the first thing you notice is a person and not a list.
//
// Rendering only. It reads `state.prayers` the same way ui.js reads the rest of
// the world, owns no simulation state, and decides nothing - if it stopped
// running, the prayer system would behave identically.
//
// Built from primitives and the project's own materials, like everything else
// in this game: a tapered spire with a ring beneath it, one InstancedMesh for
// the calm ones and one for the urgent, so the two never share a colour buffer
// and the urgent set can pulse on its own.
//
// Publishes state.prayerMarks.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { PRAYER } from './state.js';

export function initPrayerMarks(state) {
  /** Never draw more than this many, however many are somehow active. */
  const CAP = PRAYER.MAX_ACTIVE + 4;
  /** Beyond this the mark is not drawn at all - clutter control. */
  const VIEW = 340;

  // A narrow spire over a flat ring: reads as a mark on the ground from above,
  // which is the angle this game is played at, and still has a silhouette from
  // low down.
  const spire = new THREE.ConeGeometry(1.05, 5.6, 6);
  spire.translate(0, 2.8, 0);
  const ring = new THREE.RingGeometry(1.5, 2.05, 20);
  ring.rotateX(-Math.PI / 2);
  const geo = mergeSimple([spire, ring]);

  const make = (color) => {
    const m = new THREE.MeshBasicMaterial({
      // Depth test OFF, like the sculpt brush ring. A prayer marker is an
      // affordance, not scenery: the first version was depth-tested and the
      // town-wide ones were simply buried inside the keep they hovered over,
      // which is precisely where you would want to see them.
      color, transparent: true, opacity: 0.9,
      depthWrite: false, depthTest: false
    });
    const mesh = new THREE.InstancedMesh(geo, m, CAP);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    state.scene.add(mesh);
    return mesh;
  };

  // Calm is the pale gold the HUD uses for anything of yours; urgent is the
  // same warning orange as a raid on the rival panel, so it needs no legend.
  const calm = make(0xffe9b8);
  const urgent = make(0xff9d8a);

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  function update(dt, time) {
    const list = state.prayers?.active ?? [];
    const cam = state.camera?.cam;
    let nCalm = 0;
    let nUrg = 0;

    for (const p of list) {
      const at = state.prayers.positionOf(p);
      if (!at) continue;
      if (cam && cam.position.distanceTo(at) > VIEW) continue;

      const isUrgent = state.prayers.isUrgent(p);
      const mesh = isUrgent ? urgent : calm;
      const i = isUrgent ? nUrg : nCalm;
      if (i >= CAP) continue;

      // Urgent marks bob faster and further. Selected ones sit higher so the
      // one you are reading about is obvious in the world.
      const bob = Math.sin(time * (isUrgent ? 4.4 : 2.1) + p.id) * (isUrgent ? 0.5 : 0.26);
      const lift = state.prayers.selected === p ? 3.6 : 0;
      // A town's prayer floats over its keep, which is tall; a person's floats
      // just over their head.
      const base = p.communal ? 17 : 5.4;
      _p.set(at.x, at.y + base + bob + lift, at.z);
      _q.setFromAxisAngle(_up, time * (isUrgent ? 1.9 : 0.8) + p.id);
      // Shrinks as its time runs out: you can see a prayer dying.
      const life = 0.55 + 0.45 * state.prayers.remainingOf(p);
      _s.setScalar((isUrgent ? 1.25 : 1.0) * life);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);

      if (isUrgent) nUrg++; else nCalm++;
    }

    calm.count = nCalm;
    urgent.count = nUrg;
    calm.instanceMatrix.needsUpdate = true;
    urgent.instanceMatrix.needsUpdate = true;
  }

  const api = { enabled: true, update, get drawn() { return calm.count + urgent.count; } };
  state.prayerMarks = api;
  return api;
}

/**
 * Merge a couple of primitive geometries without pulling in BufferGeometryUtils.
 *
 * Only ever fed two small non-indexed-compatible primitives from this file, so
 * it handles exactly the case it needs to and nothing more.
 */
function mergeSimple(geos) {
  let verts = 0;
  for (const g of geos) verts += g.index ? g.index.count : g.attributes.position.count;
  const pos = new Float32Array(verts * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    if (g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        pos[o++] = p[idx[i] * 3];
        pos[o++] = p[idx[i] * 3 + 1];
        pos[o++] = p[idx[i] * 3 + 2];
      }
    } else {
      for (let i = 0; i < p.length; i++) pos[o++] = p[i];
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
