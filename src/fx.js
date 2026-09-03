// ---------------------------------------------------------------------------
// fx.js - a single pooled particle system for dust, splashes and sparkles.
// Purely cosmetic, so it runs at render rate rather than on the sim clock.
//
// Publishes state.fx: { burst, splash, update }
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { makeSoftCircleTexture } from './lib/textures.js';

const MAX_PARTICLES = 1600;

export function initFx(state) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);
  const alphas = new Float32Array(MAX_PARTICLES);

  // Parallel CPU-side arrays; kept out of the GPU buffers to avoid churn.
  const vel = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const drag = new Float32Array(MAX_PARTICLES);
  const grav = new Float32Array(MAX_PARTICLES);
  const size0 = new Float32Array(MAX_PARTICLES);
  const alive = new Uint8Array(MAX_PARTICLES);

  let cursor = 0;
  let liveCount = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setDrawRange(0, MAX_PARTICLES);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: makeSoftCircleTexture(64) } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (340.0 / max(-mv.z, 0.001));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform sampler2D uMap;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  state.scene.add(points);

  const _c = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, opts) {
    // Ring buffer: oldest particle is recycled when we run out. Under normal
    // play the pool never fills, and stealing is preferable to dropping.
    const i = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    if (!alive[i]) liveCount++;
    alive[i] = 1;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;

    _c.set(opts.color);
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;

    size0[i] = opts.size;
    sizes[i] = opts.size;
    alphas[i] = opts.alpha ?? 1;
    life[i] = opts.life;
    maxLife[i] = opts.life;
    drag[i] = opts.drag ?? 1.6;
    grav[i] = opts.gravity ?? -6;
  }

  /** Ground dust / debris kicked up by an impact. */
  function burst(pos, power, color = 0xbfae8c) {
    const n = Math.min(46, 6 + Math.floor(power * 1.4));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.35 + Math.random()) * power * 0.42;
      spawn(
        pos.x + (Math.random() - 0.5) * 1.2,
        pos.y + 0.3 + Math.random() * 0.8,
        pos.z + (Math.random() - 0.5) * 1.2,
        Math.cos(a) * s,
        1.5 + Math.random() * s * 0.9,
        Math.sin(a) * s,
        {
          color,
          size: 1.6 + Math.random() * 2.6,
          alpha: 0.5 + Math.random() * 0.35,
          life: 0.7 + Math.random() * 0.9,
          drag: 2.2,
          gravity: -5
        }
      );
    }
  }

  /** Water entry: a tighter, faster, whiter plume. */
  function splash(pos, power) {
    const n = Math.min(52, 10 + Math.floor(power * 1.8));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.4 + Math.random()) * power * 0.5;
      spawn(
        pos.x + (Math.random() - 0.5) * 1.0,
        0.2 + Math.random() * 0.5,
        pos.z + (Math.random() - 0.5) * 1.0,
        Math.cos(a) * s * 0.5,
        3.0 + Math.random() * s * 1.4,
        Math.sin(a) * s * 0.5,
        {
          color: 0xdff2ff,
          size: 1.2 + Math.random() * 2.0,
          alpha: 0.75,
          life: 0.55 + Math.random() * 0.5,
          drag: 1.1,
          gravity: -16
        }
      );
    }
  }

  function update(dt) {
    if (liveCount === 0) return;
    const terrain = state.terrain;
    let live = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!alive[i]) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alive[i] = 0;
        alphas[i] = 0;
        sizes[i] = 0;
        continue;
      }
      live++;

      const d = Math.exp(-drag[i] * dt);
      vel[i * 3] *= d;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d + grav[i] * dt;
      vel[i * 3 + 2] *= d;

      positions[i * 3] += vel[i * 3] * dt;
      positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
      positions[i * 3 + 2] += vel[i * 3 + 2] * dt;

      // Skid along the ground instead of sinking through it.
      if (terrain) {
        const g = terrain.heightAt(positions[i * 3], positions[i * 3 + 2]);
        if (positions[i * 3 + 1] < g + 0.15) {
          positions[i * 3 + 1] = g + 0.15;
          vel[i * 3 + 1] *= -0.15;
        }
      }

      const t = life[i] / maxLife[i];
      alphas[i] = t * t * 0.9;
      sizes[i] = size0[i] * (1.6 - t * 0.6); // puff outward as it fades
    }

    liveCount = live;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }

  const api = { burst, splash, update, get count() { return liveCount; } };
  state.fx = api;
  return api;
}
