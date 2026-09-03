// ---------------------------------------------------------------------------
// models.js - loads the Kenney GLB kit and prepares it for instanced rendering.
//
// This is the one place the "everything is procedural" rule is broken, and it
// is deliberately narrow: the loader hands back plain BufferGeometry plus one
// shared texture, and every system downstream keeps using InstancedMesh exactly
// as it did with the procedural shapes. Nothing else in the game knows or cares
// where a geometry came from.
//
// Three things the pack makes easy:
//   - No rigging on any model, so instancing still works and 150 agents stay
//     one draw call.
//   - Every model samples the same `colormap.png` palette, so the whole kit
//     shares ONE material.
//   - GLB rather than OBJ: single file, materials embedded, one loader.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Vite resolves these at build time and fingerprints them into dist/.
// Adding a .glb to the folder makes it available here with no code change.
const GLB_URLS = import.meta.glob('./assets/Models/GLB format/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});

// The Cube Pets pack: one of these is the creature. `eager` here only resolves
// URLs, not file contents, so nothing is fetched until something asks for it.
// 24 animals at ~150KB each is far too much to pull down at boot, and only ever
// one is on screen.
// The castle kit: the town centre keep, and (Phase 5) siege engines.
const CASTLE_URLS = import.meta.glob('./assets/castle-kit/Models/GLB format/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});

// Mini characters: the villagers.
const MINI_URLS = import.meta.glob('./assets/mini-characters/Models/GLB format/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});

// The fantasy town kit: 167 modular pieces, of which the game uses a handful.
// Loaded on demand by name for the same reason as the pets - pulling 3.6MB at
// boot to use eight parts would be absurd.
// The nature kit. Note the folder: this one ships GLTF format, not "GLB
// format" like every other pack here, and its models carry no textures at all -
// each mesh is a named material with a flat base colour. Both of those need
// handling differently, which is why it gets its own loader below.
const NATURE_URLS = import.meta.glob('./assets/nature-kit/Models/GLTF format/*.glb', {
  eager: true, query: '?url', import: 'default'
});

const TOWN_URLS = import.meta.glob('./assets/town-kit/Models/GLB format/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});

// The graveyard kit: 91 pieces, of which the memorials, the iron fencing and
// the lamps are used to build the burial grounds. Same deal as the town kit -
// `eager` resolves URLs only, so nothing is fetched until a piece is asked for
// by name, and having ninety-one of them available costs nothing at boot.
const GRAVEYARD_URLS = import.meta.glob('./assets/graveyard-kit/Models/GLB format/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});

const PET_URLS = import.meta.glob('./assets/cube-pets/Models/GLB format/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});
const PET_PREVIEWS = import.meta.glob('./assets/cube-pets/Previews/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
});

/**
 * Both packs reference their palette as an EXTERNAL file ("Textures/colormap.png")
 * rather than embedding it in the GLB. That happens to work in dev, where Vite
 * serves the whole source tree and the relative path resolves - but in a
 * production build the GLB is fingerprinted into /assets/ and the relative
 * texture 404s, so every model would render untextured.
 *
 * Importing the palettes here gets them fingerprinted and copied like any other
 * asset; the URL modifier below then points the loader at the real file.
 */
const COLORMAPS = import.meta.glob('./assets/**/GLB format/Textures/colormap.png', {
  eager: true,
  query: '?url',
  import: 'default'
});

/**
 * Map a pack folder to its built colormap URL. Packs are told apart by their
 * folder name; '' means the original forest kit at assets/Models/.
 */
function colormapFor(pack) {
  for (const [path, url] of Object.entries(COLORMAPS)) {
    if (packFromPath(path) === pack) return url;
  }
  return null;
}

/**
 * "./assets/castle-kit/Models/GLB format/..." -> "castle-kit".
 *
 * Derived rather than listed. This was a hardcoded chain of four pack names,
 * and a kit missing from it got no URL modifier at all - which is invisible in
 * dev, because there the GLB is served from its real folder and the relative
 * "Textures/colormap.png" inside it resolves on its own. Only the production
 * build breaks, where every model is fingerprinted into /assets/ and the
 * relative path points at nothing. The graveyard kit landed exactly there:
 * eighteen "Couldn't load texture" errors in the build and none in dev.
 *
 * The original forest kit sits at ./assets/Models/ with no pack folder of its
 * own, which is the '' case.
 */
function packFromPath(path) {
  const m = /\.\/assets\/([^/]+)\//.exec(path);
  const folder = m ? m[1] : '';
  return folder === 'Models' || folder === 'Previews' ? '' : folder;
}

/**
 * A GLTFLoader that rewrites the packs' relative texture path to the real
 * bundled URL, so models are textured in dev and in a build alike.
 */
function makeLoader(pack) {
  const manager = new THREE.LoadingManager();
  const url = colormapFor(pack);
  if (url) {
    manager.setURLModifier((requested) =>
      /colormap\.png(\?.*)?$/i.test(requested) ? url : requested);
  }
  return new GLTFLoader(manager);
}

/** "./assets/Models/GLB format/tree-high.glb" -> "tree-high" */
function nameFromPath(path) {
  return path.split('/').pop().replace(/\.(glb|png)$/i, '');
}

/** "animal-red-fox" -> "Red fox" */
function prettyName(key) {
  const s = key.replace(/^animal-/, '').replace(/[-_]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Concatenate geometries, keeping position/normal/uv and always producing a
 * colour attribute.
 *
 * The colour attribute is not decorative: the hover highlight rides on
 * per-instance colour, and three only applies it in the fragment stage when
 * USE_COLOR is defined - which needs the material to have vertexColors and the
 * geometry to actually carry the attribute. White vertices are a no-op until
 * something tints the instance.
 */
export function mergeForInstancing(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3).fill(1);

  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Flatten a loaded GLTF scene into a single geometry in world space. */
/**
 * Flatten a model whose colour lives in its MATERIALS rather than in a texture.
 *
 * The nature kit has no colormap: a tree is a `leafsGreen` material and a
 * `woodBark` material. Merging its meshes the ordinary way throws that away and
 * leaves a tree painted entirely in whichever colour happened to come first.
 *
 * So each mesh's base colour is baked into vertex colours BEFORE the merge, and
 * the shared material draws with `vertexColors`. That is the same trick the
 * rest of the project already uses for its own composed geometry, which is why
 * it costs nothing extra downstream.
 */
const _authored = new THREE.Color();

function flattenByMaterial(scene) {
  scene.updateMatrixWorld(true);
  const geos = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;

    // The kit's colours are authored as sRGB but stored where glTF says LINEAR.
    //
    // Kenney picks a colour in a colour picker and writes those numbers straight
    // into `baseColorFactor`. The spec says that field is linear, so three -
    // correctly - reads 0.161, 0.788, 0.671 as linear and renders #70e6d6: a
    // pale, bright mint. What was actually meant is #29c9ab, the deeper teal on
    // the pack's own preview image.
    //
    // So the raw numbers are recovered (getHex in LINEAR space hands back
    // exactly what is in the file) and then re-read as the sRGB they were always
    // meant to be. Without this every tree on the island glows.
    const col = m && m.color
      ? _authored.setHex(m.color.getHex(THREE.LinearSRGBColorSpace), THREE.SRGBColorSpace)
      : null;

    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const r = col ? col.r : 1, gg = col ? col.g : 1, b = col ? col.b : 1;
    for (let i = 0; i < n; i++) {
      arr[i * 3] = r; arr[i * 3 + 1] = gg; arr[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    // The merge needs every geometry to carry the same attributes.
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    geos.push(g);
  });
  if (!geos.length) return null;
  return { geometry: mergeForInstancing(geos), texture: null };
}

function flatten(scene) {
  scene.updateMatrixWorld(true);
  const geos = [];
  let texture = null;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!texture && m && m.map) texture = m.map;
  });
  if (!geos.length) return null;
  return { geometry: mergeForInstancing(geos), texture };
}

// --- geometry helpers used by the consumers ---------------------------------

/** Uniformly scale a geometry so its tallest axis measures `height`. */
export function sizeToHeight(geo, height) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const h = b.max.y - b.min.y;
  if (h > 0) geo.scale(height / h, height / h, height / h);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Uniformly scale a geometry so its widest horizontal axis measures `width`. */
export function sizeToWidth(geo, width) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  if (w > 0) geo.scale(width / w, width / w, width / w);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Replace an InstancedMesh with a bigger one, preserving every live instance.
 *
 * THREE cannot resize an InstancedMesh, so the usual answer is to guess a
 * capacity up front. Guessing high wastes GPU buffers - this project was
 * carrying 21,000 dead instance slots across 106 meshes - and guessing low is
 * worse: a silent overflow, or a hard refusal the player cannot act on. Growing
 * on demand means the capacity can start at what is actually needed and rise
 * only if it has to, at one reallocation per doubling.
 *
 * Instance ORDER is preserved, so any index stored elsewhere stays valid. The
 * caller must replace its own reference with the returned mesh.
 */
export function growInstances(mesh, scene, to = mesh.instanceMatrix.count * 2) {
  const bigger = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.max(1, to));
  bigger.name = mesh.name;
  bigger.castShadow = mesh.castShadow;
  bigger.receiveShadow = mesh.receiveShadow;
  bigger.frustumCulled = mesh.frustumCulled;
  bigger.renderOrder = mesh.renderOrder;
  bigger.count = mesh.count;

  // The colour buffer is created and WHITE-FILLED up front rather than left to
  // `setColorAt` to allocate lazily.
  //
  // Letting three allocate it means the array is sized to the new capacity and
  // zero-filled, and zero in a colour buffer is BLACK - so every instance
  // written after the growth rendered as a black silhouette. It looked like a
  // shadow bug and was really an uninitialised buffer: the tell was that the
  // black indices were always a contiguous run starting exactly where the mesh
  // had last grown.
  if (mesh.instanceColor) {
    const tint = new Float32Array(bigger.instanceMatrix.count * 3).fill(1);
    bigger.instanceColor = new THREE.InstancedBufferAttribute(tint, 3);
  }

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    bigger.setMatrixAt(i, m);
    if (mesh.instanceColor) { mesh.getColorAt(i, c); bigger.setColorAt(i, c); }
  }
  bigger.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bigger.instanceMatrix.needsUpdate = true;
  if (bigger.instanceColor) {
    bigger.instanceColor.setUsage(THREE.DynamicDrawUsage);
    bigger.instanceColor.needsUpdate = true;
  }
  scene.remove(mesh);
  scene.add(bigger);
  // Geometry and material are shared with the replacement; only the per-instance
  // buffers belonged to the old mesh, and they go with it.
  mesh.dispose();
  return bigger;
}

/**
 * Uniformly scale a geometry so its LARGEST dimension - any of the three -
 * measures `size`.
 *
 * The safe choice for a family of pieces with wildly different proportions.
 * `sizeToHeight` on a flat plate gives something enormously wide;
 * `sizeToWidth` on a tall column gives something enormously tall. Both have
 * caught this project out. Normalising on the largest axis guarantees the
 * result fits inside a `size`-cubed box whatever shape went in, which is what
 * you actually want from a kit you are scattering by the hundred.
 */
export function sizeToMax(geo, size) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const m = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  if (m > 0) geo.scale(size / m, size / m, size / m);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Assemble kit pieces into one geometry.
 *
 * Each part is { geo, x?, y?, z?, rotY?, scale? }. The town kit is built on a
 * 1x1 module: a wall is a thin panel on the +X face of a unit cell, so four
 * walls rotated by 90-degree steps enclose one cell. Composing here keeps a
 * whole building as a single geometry, and therefore a single InstancedMesh.
 */
export function composeParts(parts) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const geos = parts.map(({ geo, x = 0, y = 0, z = 0, rotY = 0, scale = 1 }) => {
    const g = geo.clone();
    q.setFromAxisAngle(up, rotY);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
    g.applyMatrix4(m);
    return g;
  });
  return mergeForInstancing(geos);
}

/**
 * Bake a frame of a skinned animation into a plain, static geometry.
 *
 * Why this exists: three.js cannot instance a SkinnedMesh, and the villagers
 * are capped at 150 agents that must stay inside one or two draw calls. Giving
 * each one a SkinnedMesh and an AnimationMixer would mean 150 draw calls and
 * 150 skinning updates a frame, which is exactly the budget the project was
 * built to protect.
 *
 * Instead the skeleton is evaluated once per pose on the CPU and the resulting
 * vertex positions are frozen into a normal BufferGeometry. Several frames of
 * the walk cycle baked this way become a flipbook: villagers are bucketed into
 * whichever pose matches their stride, so the crowd animates at a handful of
 * draw calls no matter how large it grows.
 */
export function bakeSkinnedPose(gltf, clipName, time) {
  const root = gltf.scene;
  const clip = gltf.animations.find((c) => c.name === clipName);

  if (clip) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.setTime(time); // drives the bones to this instant of the clip
  }
  root.updateMatrixWorld(true);

  const geos = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const pos = src.attributes.position;
    const baked = src.clone();
    const out = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // applyBoneTransform returns the skinned vertex in the mesh's own local
      // space, so the mesh transform still has to be applied to reach world.
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    baked.setAttribute('position', new THREE.BufferAttribute(out, 3));
    baked.deleteAttribute('skinIndex');
    baked.deleteAttribute('skinWeight');
    // Bone deformation invalidates the authored normals; low-poly recompute is
    // both correct enough and cheap at bake time.
    baked.computeVertexNormals();
    geos.push(baked);
  });

  return geos.length ? mergeForInstancing(geos) : null;
}

/** Centre horizontally and sit the base on y = 0. Buildings want this. */
export function groundAtOrigin(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
/**
 * Load every GLB in the kit. Resolves to a registry:
 *   get(name)   -> a FRESH cloned geometry, safe to scale and translate
 *   texture     -> the shared colormap
 *   has(name)   -> boolean
 */
export async function loadModels() {
  const loader = makeLoader('');
  const petLoader = makeLoader('cube-pets');
  const entries = Object.entries(GLB_URLS);

  const results = await Promise.all(
    entries.map(async ([path, url]) => {
      const name = nameFromPath(path);
      try {
        const gltf = await loader.loadAsync(url);
        return [name, flatten(gltf.scene)];
      } catch (err) {
        console.warn(`[models] failed to load ${name}:`, err);
        return [name, null];
      }
    })
  );

  const store = new Map();
  let texture = null;
  for (const [name, data] of results) {
    if (!data) continue;
    store.set(name, data.geometry);
    if (!texture && data.texture) texture = data.texture;
  }

  if (texture) {
    // The palette is an atlas of flat colour patches; filtering across patch
    // borders bleeds neighbouring colours into every face edge.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.needsUpdate = true;
  }

  // --- Cube Pets ------------------------------------------------------------
  // Kept separate from the kit above: these are loaded on demand, keep their
  // scene graph (the animation clips drive node transforms, so flattening them
  // into one geometry would destroy them), and carry their own palette.
  const petUrls = new Map(
    Object.entries(PET_URLS).map(([path, url]) => [nameFromPath(path), url])
  );
  const petPreviews = new Map(
    Object.entries(PET_PREVIEWS).map(([path, url]) => [nameFromPath(path), url])
  );
  const petCache = new Map();

  const pets = [...petUrls.keys()].sort().map((key) => ({
    key,
    label: prettyName(key),
    preview: petPreviews.get(key) ?? null
  }));

  /**
   * Fetch one animal. Resolves to { scene, animations }.
   *
   * Results are cached, so flipping back to a previously chosen animal is
   * instant. The cached scene is cloned on each use: the clips address nodes by
   * name, and a plain clone preserves names, so the clone animates correctly.
   */
  async function loadPet(key) {
    if (!petUrls.has(key)) throw new Error(`[models] no such pet "${key}"`);
    if (!petCache.has(key)) {
      const gltf = await petLoader.loadAsync(petUrls.get(key));
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || !m.map) continue;
          m.map.magFilter = THREE.NearestFilter;
          m.map.colorSpace = THREE.SRGBColorSpace;
          m.map.needsUpdate = true;
        }
      });
      petCache.set(key, gltf);
    }
    const gltf = petCache.get(key);
    return { scene: gltf.scene.clone(true), animations: gltf.animations };
  }

  // --- modular kits ---------------------------------------------------------
  // Town kit and castle kit are both 1x1-module packs used the same way: fetch
  // a named handful of pieces, flatten each to one geometry, and compose
  // buildings from them. One loader serves both.
  const KITS = {
    'town-kit': { urls: TOWN_URLS, loader: makeLoader('town-kit'), texture: null },
    'castle-kit': { urls: CASTLE_URLS, loader: makeLoader('castle-kit'), texture: null },
    'graveyard-kit': {
      urls: GRAVEYARD_URLS, loader: makeLoader('graveyard-kit'), texture: null
    },
    // Untextured, so it needs no colormap rewriting and no shared texture.
    'nature-kit': {
      urls: NATURE_URLS, loader: new GLTFLoader(), texture: null, byMaterial: true
    }
  };
  for (const k of Object.values(KITS)) {
    k.map = new Map(Object.entries(k.urls).map(([path, url]) => [nameFromPath(path), url]));
  }

  async function loadKitPieces(pack, names) {
    const kit = KITS[pack];
    if (!kit) throw new Error(`[models] unknown kit "${pack}"`);
    const out = new Map();
    await Promise.all(names.map(async (name) => {
      const url = kit.map.get(name);
      if (!url) { console.warn(`[models] no ${pack} piece "${name}"`); return; }
      const gltf = await kit.loader.loadAsync(url);
      const data = kit.byMaterial ? flattenByMaterial(gltf.scene) : flatten(gltf.scene);
      if (!data) return;
      out.set(name, data.geometry);
      if (!kit.texture && data.texture) kit.texture = data.texture;
    }));
    if (kit.texture) {
      kit.texture.magFilter = THREE.NearestFilter;
      kit.texture.colorSpace = THREE.SRGBColorSpace;
      kit.texture.flipY = false;
      kit.texture.needsUpdate = true;
    }
    return out;
  }

  const loadTownPieces = (names) => loadKitPieces('town-kit', names);

  // --- mini characters ------------------------------------------------------
  const miniUrls = new Map(
    Object.entries(MINI_URLS).map(([path, url]) => [nameFromPath(path), url])
  );
  const miniLoader = makeLoader('mini-characters');
  let miniTexture = null;

  /**
   * Load one character and bake it into a set of static poses.
   * Returns { idle, walk: [...] } of plain geometries, ready to instance.
   */
  async function loadCharacterPoses(name, walkFrames) {
    const url = miniUrls.get(name);
    if (!url) throw new Error(`[models] no character "${name}"`);
    const gltf = await miniLoader.loadAsync(url);

    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.map && !miniTexture) miniTexture = m.map;
    });
    if (miniTexture) {
      miniTexture.magFilter = THREE.NearestFilter;
      miniTexture.colorSpace = THREE.SRGBColorSpace;
      miniTexture.flipY = false;
      miniTexture.needsUpdate = true;
    }

    const walkClip = gltf.animations.find((c) => c.name === 'walk');
    const dur = walkClip ? walkClip.duration : 1;
    const walk = [];
    for (let i = 0; i < walkFrames; i++) {
      walk.push(bakeSkinnedPose(gltf, 'walk', (i / walkFrames) * dur));
    }
    const idle = bakeSkinnedPose(gltf, 'idle', 0);
    return { idle, walk };
  }

  return {
    texture,
    pets,
    loadTownPieces,
    loadKitPieces,
    kitTexture: (pack) => KITS[pack]?.texture ?? null,
    loadCharacterPoses,
    miniCharacters: [...miniUrls.keys()].filter((n) => n.startsWith('character-')).sort(),
    get miniTexture() { return miniTexture; },
    get townTexture() { return KITS['town-kit'].texture; },
    hasPet: (key) => petUrls.has(key),
    loadPet,
    names: [...store.keys()].sort(),
    has: (name) => store.has(name),
    /** Always returns a clone: callers scale and translate their own copy. */
    get(name) {
      const g = store.get(name);
      if (!g) throw new Error(`[models] no such model "${name}"`);
      return g.clone();
    },
    /** Shared material for the whole kit - one texture, so one material. */
    makeMaterial(opts = {}) {
      return new THREE.MeshStandardMaterial({
        map: texture,
        vertexColors: true, // required for the per-instance highlight tint
        roughness: 0.85,
        metalness: 0.0,
        ...opts
      });
    }
  };
}
