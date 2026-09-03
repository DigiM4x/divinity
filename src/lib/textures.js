// ---------------------------------------------------------------------------
// All textures in Divinity are drawn at runtime into a <canvas>.
// Nothing is ever fetched from disk or network.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * Fine grain / speckle used to break up the flat vertex-coloured terrain.
 * Multiplied over the terrain albedo, so it lives around mid-grey.
 */
export function makeGrainTexture(size = 256, seed = 7) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(seed);
  const d = img.data;

  for (let i = 0; i < size * size; i++) {
    // two frequencies of white noise stacked -> reads as soil/grit rather than TV static
    const coarse = rand();
    const fine = rand();
    const v = 168 + (coarse - 0.5) * 46 + (fine - 0.5) * 22;
    const o = i * 4;
    d[o] = d[o + 1] = d[o + 2] = v;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Blur pass so the grain has some clumping instead of per-pixel hash.
  ctx.globalAlpha = 0.5;
  ctx.filter = 'blur(1px)';
  ctx.drawImage(c, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial falloff sprite, used for dust, splash and spark particles. */
export function makeSoftCircleTexture(size = 64) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.16)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Mottled bark-ish stripe map for tree trunks. */
export function makeBarkTexture(size = 128, seed = 21) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  ctx.fillStyle = '#5b452f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const w = 1 + rand() * 3;
    const shade = 0.55 + rand() * 0.5;
    ctx.fillStyle = `rgba(${(90 * shade) | 0},${(68 * shade) | 0},${(44 * shade) | 0},0.7)`;
    ctx.fillRect(x, 0, w, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
