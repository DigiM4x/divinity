// ---------------------------------------------------------------------------
// main.js - bootstraps the renderer and drives the two clocks.
//
//   sim   : fixed 20Hz, deterministic, owns physics and (later) agents
//   render: display refresh, interpolates between the last two sim ticks
//
// Systems are initialised in dependency order and thereafter reached through
// `state`; main.js is the only module that knows all of them exist.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createState, createEvents, SIM_DT, MAX_SIM_STEPS_PER_FRAME, WORLD, CAMERA, TOWN, CREATURE, BUILDINGS, endGame, BIOMES, STONE_PIECES, FLORA, SCENERY, BUDGET, GRAVEYARD, VILLAGER, CIVS, setCivilisations, RIVAL_GOD, BLESSING} from './state.js';
import { initInput } from './input.js';
import { initTerrain } from './terrain.js';
import { initCamera } from './camera.js';
import { initFx } from './fx.js';
import { initProps } from './props.js';
import { initHand } from './hand.js';
import { initUi } from './ui.js';
import { initTown } from './town.js';
import { initFlora } from './flora.js';
import { initScenery } from './scenery.js';
import { initAchievements } from './achievements.js';
import { initSculpt } from './sculpt.js';
import { initPrayers } from './prayers.js';
import { initPrayerMarks } from './prayermarks.js';
import { initVillagers } from './villagers.js';
import { initCreature } from './creature.js';
import { initRivalGods } from './rivalgods.js';
import { initMiracles } from './miracles.js';
import { initCombat } from './combat.js';
import { initSky } from './sky.js';
import { initSound } from './sound.js';
import { initGraveyard } from './graveyard.js';
import { initReckoning } from './reckoning.js';
import { initReckoningUi } from './reckoningui.js';

import { loadModels } from './lib/models.js';

const state = createState();
// Installed before any system inits, since systems subscribe during init.
state.events = createEvents();
// Bound here rather than exported as a free function, so every system reaches
// the ending the same way it reaches everything else: through `state`.
state.endGame = (kind, reason) => endGame(state, kind, reason);
window.DIVINITY = state; // console poking while tuning
// The real fixed-step tick, exposed so a soak can drive the ACTUAL simulation
// rather than a hand-rolled copy of the call order. Assigned below, once
// `simStep` is defined; declared here so the two sit together.
state.simStep = null;

const container = document.getElementById('app');
const bootEl = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

// --- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);
state.renderer = renderer;

// --- scene ------------------------------------------------------------------
const scene = new THREE.Scene();
// Fog far must sit well inside the water plane's edge, or you can see the ocean
// stop. See the water sizing in terrain.js.
scene.fog = new THREE.Fog(0xa9c6de, WORLD.EXTENT * 0.9, WORLD.EXTENT * 2.3);
state.scene = scene;

// Sky dome: a single inverted sphere with a two-stop gradient in the shader.
// Cheaper and more controllable than a cube map, and nothing has to be loaded.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(WORLD.EXTENT * 3.2, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x3d7ec4) },
      // The horizon band must match scene.fog exactly. Distant water fades to
      // the fog colour, so any difference here draws a hard line along the
      // horizon where the ocean stops and the sky starts.
      uMid: { value: new THREE.Color(0xa9c6de) },
      uBottom: { value: new THREE.Color(0xa9c6de) }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(uBottom, uMid, smoothstep(-0.25, 0.10, h));
        c = mix(c, uTop, smoothstep(0.05, 0.65, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `
  })
);
sky.frustumCulled = false;
scene.add(sky);

// --- lighting ---------------------------------------------------------------
// Fairly high sun (~65 degrees). Lower than this and the mountains cast huge
// dead-black valleys across half the island.
const SUN_DIR = new THREE.Vector3(0.38, 0.95, 0.28).normalize();

const sun = new THREE.DirectionalLight(0xfff2dc, 2.35);
sun.position.copy(SUN_DIR).multiplyScalar(WORLD.EXTENT * 0.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Fit the shadow frustum to the island; anything looser wastes texels and the
// terrain self-shadowing turns to mush.
const S = WORLD.HALF * 1.15;
sun.shadow.camera.left = -S;
sun.shadow.camera.right = S;
sun.shadow.camera.top = S;
sun.shadow.camera.bottom = -S;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = WORLD.EXTENT * 2.2;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.6;
scene.add(sun);
scene.add(sun.target);

// Generous sky/ground bounce: with a single hard sun and ACES tone mapping, the
// shaded side of every hill crushes to black without it.
// Held rather than added anonymously: sky.js drives both of these round the
// clock, and it cannot drive what it cannot reach.
const hemi = new THREE.HemisphereLight(0xbcd7f2, 0x7d7052, 1.75);
const ambient = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(hemi);
scene.add(ambient);

/**
 * Ask how many civilisations should share the island. ALWAYS.
 *
 * There was a `?civs=N` shortcut that skipped this, the way `?seed=` skips
 * rolling a fresh island. It is gone deliberately: every new map is a new
 * decision, and a URL that silently answered the question meant a player who
 * bookmarked a game, or came back through the end screen, was never asked
 * again. The island is vetted for a specific number of settlements before it
 * exists, so this is the one question that cannot be deferred or inherited.
 *
 * Resolves to a number. Listeners are removed when it settles, because a picker
 * that answers twice would generate two islands.
 */
function askCivilisations() {
  const box = document.getElementById('boot-civs');
  const row = box.querySelector('.row');
  const hint = box.querySelector('.hint');
  bootStatus.textContent = 'An island, a people, a beast';

  return new Promise((resolve) => {
    for (let n = CIVS.MIN; n <= CIVS.MAX; n++) {
      const b = document.createElement('button');
      b.textContent = n;
      b.addEventListener('mouseenter', () => { hint.textContent = CIVS.LABELS[n] ?? ''; });
      b.addEventListener('click', () => {
        box.classList.remove('on');
        bootStatus.textContent = 'Shaping the island…';
        resolve(n);
      }, { once: true });
      row.appendChild(b);
    }
    // Also answerable from the keyboard, since the numbers are right there.
    const onKey = (e) => {
      const n = Number.parseInt(e.key, 10);
      if (n >= CIVS.MIN && n <= CIVS.MAX) {
        window.removeEventListener('keydown', onKey);
        box.classList.remove('on');
        bootStatus.textContent = 'Shaping the island…';
        resolve(n);
      }
    };
    window.addEventListener('keydown', onKey);
    box.classList.add('on');
  });
}

// --- systems ----------------------------------------------------------------
// Boot is async now, purely because the model kit has to be fetched before
// props and town can build their geometry. Everything after the await is the
// same synchronous init order as before.
async function boot() {
  bootStatus.textContent = 'Gathering materials…';
  state.models = await loadModels();

  // --- the seed ------------------------------------------------------------
  //
  // One number decides the entire world: the coastline, the mountains, where
  // the forests are, where all three towns stand. Taken from ?seed= when it is
  // there so a good island can be replayed or handed to someone else, and
  // rolled fresh otherwise - because playing the same island every time was
  // the largest replayability gap in the project.
  //
  // ?island=Archipelago (or Continent, Spine, Fjordland, Highland) forces an
  // archetype, which is for looking at one on purpose rather than for playing.
  {
    const params = new URLSearchParams(location.search);
    const asked = params.get('seed');
    const parsed = asked === null ? NaN : Number.parseInt(asked, 10);
    state.seed = Number.isFinite(parsed)
      ? parsed >>> 0
      : (Math.random() * 0xffffffff) >>> 0;
    state.islandName = params.get('island');
  }

  // --- how many civilisations ----------------------------------------------
  //
  // ASKED BEFORE THE ISLAND EXISTS, and it has to be: the terrain is generated
  // and then vetted for a specific number of settlements, so by the time there
  // is a world the answer is already baked into it. Islands cannot gain a
  // civilisation afterwards - there may simply be nowhere to put one.
  state.civSetup = setCivilisations(await askCivilisations());
  state.civilisations = state.civSetup.count;

  bootStatus.textContent = 'Raising land…';
  initInput(state, renderer.domElement);
  initTerrain(state);
  state.terrain.setSunDirection(SUN_DIR);

  initCamera(state, renderer.domElement);
  state.camera.resize(window.innerWidth, window.innerHeight);

  bootStatus.textContent = 'Planting forests…';
  initFx(state);
  // The nature kit: every tree, stone and blade of grass on the island. Names
  // are gathered from the biome and flora tables rather than listed twice, so
  // adding a species to a table is the only edit needed to see it in the world.
  const naturePieceNames = [
    ...new Set([
      ...BIOMES.flatMap((b) => b.trees),
      ...STONE_PIECES.rocks, ...STONE_PIECES.boulders,
      ...FLORA.PIECES.map((f) => f.name),
      // Scenery draws from the same kit: cliff faces, statues, crops, fences.
      // Gathered from the tables for the same reason as the rest - adding a
      // piece to a table is the only edit needed to see it in the world.
      ...SCENERY.CLIFFS.BANDS.flatMap((b) => b.pieces),
      ...SCENERY.LANDMARKS.PIECES.map((p) => p.name),
      ...SCENERY.SHORE.PIECES.map((p) => p.name),
      ...Object.values(SCENERY.DRESSING).flatMap((d) => d.pieces)
    ])
  ];
  state.naturePieces = await state.models.loadKitPieces('nature-kit', naturePieceNames);

  initProps(state);
  initHand(state);
  initSculpt(state);
  initUi(state);

  bootStatus.textContent = 'Founding a settlement…';
  // Only the pieces the four building types actually use - eight of the kit's
  // 167 - so the town costs a few dozen KB rather than 3.6MB.
  state.townPieces = await state.models.loadTownPieces([
    'wall', 'wall-door', 'wall-broken', 'roof-point', 'roof-high-point',
    'wall-wood', 'wall-wood-door', 'wall-wood-broken', 'wall-wood-window-small',
    'chimney', 'watermill', 'stall', 'cart', 'planks', 'hedge', 'tree-crooked',
    'banner-red', 'fence',
    // The paddock. A cattle farm that is a square of fence and nothing else
    // reads as an empty pen, so it gets a real barn, a way in, and a trough:
    // a gate in the rail, a gabled roof wide enough to span two bays, and a
    // high-sided cart for the hay.
    // `fountain-square` is a low stone basin, and a basin at cattle height is a
    // water trough - the kit has no trough of its own, and this is the piece it
    // has that already means "standing water somebody drinks from".
    'fence-gate', 'roof-gable-end', 'cart-high', 'poles-horizontal', 'fountain-square',
    // Manor: it earns its own pieces. Built from the house's four blank walls it
    // read as a warehouse, and no amount of proportion fixes a building with no
    // windows in it.
    'wall-window-shutters', 'wall-window-small', 'wall-detail-cross',
    // Mine: an arched adit and a flat roof cut into the hill.
    'wall-doorway-round', 'roof-flat',
    // Barracks hall: windows on both storeys and the watchtower.
    'roof-high-point',
    // Street furniture for the town squares - see SCENERY.SQUARE.
    ...SCENERY.SQUARE.TOWN.map((p) => p.name)
  ]);
  // THE CATTLE THEMSELVES, which the paddock has never had. One animal from the
  // Cube Pets kit, flattened to a static geometry: no mixer, no skinning, one
  // draw call for every cow on the island. See makeCattleGeo.
  state.cowModel = await state.models.loadPetGeometry('animal-cow');

  state.castlePieces = await state.models.loadKitPieces('castle-kit', [
    'tower-square-base', 'tower-square-mid-door', 'tower-square-mid-windows',
    'tower-square-top', 'tower-square-roof', 'flag',
    'wall', 'wall-doorway', 'gate', 'tower-base', 'tower-top',
    // Siege train. The kit has shipped these since Phase 5 and nothing has ever
    // asked for them; combat.js builds its instanced meshes from them at init,
    // so they have to be in this list or it fails on the very first boot.
    'siege-catapult', 'siege-catapult-demolished',
    // Flown from the four corner towers - see makeCastleGeo.
    'flag-pennant',
    // Rubble for the town squares - see SCENERY.SQUARE.
    ...SCENERY.SQUARE.CASTLE.map((p) => p.name)
  ]);
  // The graveyard kit. Only the pieces the burial grounds actually use - the
  // kit has 91, and fetching all of them to stand up a dozen headstones would
  // be the same mistake the town kit's list exists to avoid.
  state.graveyardPieces = await state.models.loadKitPieces('graveyard-kit', [
    ...GRAVEYARD.STONES, ...GRAVEYARD.BROKEN,
    ...GRAVEYARD.LANDMARKS.map((l) => l.piece),
    GRAVEYARD.FENCE_PIECE, GRAVEYARD.FENCE_GATE,
    // Not for the graveyard: every villager carries one of these after dark.
    // See VILLAGER.TORCH.
    VILLAGER.TORCH.PIECE
  ]);
  initTown(state);
  // Scenery AFTER the town, because landmarks are sited by staying clear of the
  // settlements and `state.towns` does not exist until initTown has run. The
  // cost of that order is that the rivals' opening buildings are already
  // standing by the time scenery exists, so initScenery back-dresses whatever
  // it finds; every building placed from here on is dressed as it goes up.
  initScenery(state);
  // After the town for the same reason as scenery: it sites its plots by
  // staying clear of the buildings, and there are none until initTown has run.
  initGraveyard(state);
  // Last, and observing only. Every event it listens for is emitted by systems
  // that already exist, so it can go anywhere after them - and decoding starts
  // here without blocking, so the game is playable before the clips arrive.
  // The turning sky. Handed the whole lighting rig, because it owns all of it
  // from here on - the sun, the bounce, the fog and the three sky stops.
  initSky(state, { sun, hemi, ambient, skyMat: sky.material, fog: scene.fog });
  initSound(state);
  initFlora(state);
  // After everything it observes. It only ever reads, so it could technically
  // go anywhere, but its first poll happens on tick one and a poll that finds
  // half of state undefined records a peak population of zero.
  // After villagers and towns: it reads both on its first scan, and a scan
  // that finds half of state undefined raises nothing and hides the fact.
  initPrayers(state);
  initPrayerMarks(state);
  initAchievements(state);
  // Last of the observers, and for the same reason as the other two: it reads
  // towns, villagers and soldiers on its first recalculation, and a pass that
  // finds half of state undefined records a peak population of zero and a
  // civilisation of nothing.
  //
  // It also snapshots the teams here - one per town as the world was founded -
  // which is why it cannot run before the towns exist.
  initReckoning(state);
  initReckoningUi(state);
  // Two casts, four walk frames each: the population animates in ten draw calls
  // no matter how many villagers there are.
  state.villagerPoses = await Promise.all([
    state.models.loadCharacterPoses('character-male-a', 4),
    state.models.loadCharacterPoses('character-female-a', 4)
  ]);
  initVillagers(state);
  // Seed every settlement: the player's, and the rivals'.
  for (const town of state.towns) {
    const n = town.isPlayer ? TOWN.START_POP : TOWN.RIVAL_START_POP;
    for (let i = 0; i < n; i++) {
      state.villagers.spawn(town.centre.x, town.centre.z, town);
    }
    // Rivals open with a few buildings so they are a going concern from the
    // start rather than an empty field the player watches grow.
    if (town.isPlayer) continue;
    for (const key of TOWN.RIVAL_START_BUILD) {
      const def = BUILDINGS[key];
      let done = false;
      for (let r = TOWN.CENTRE_CLEARANCE + 2; r < 40 && !done; r += 3) {
        for (let k = 0; k < 10 && !done; k++) {
          const a = Math.random() * Math.PI * 2;
          done = state.town.placeIn(town, def,
            town.centre.x + Math.cos(a) * r, town.centre.z + Math.sin(a) * r).ok;
        }
      }
    }
  }

  bootStatus.textContent = 'Waking the creature…';
  // Restore the player's chosen animal before the creature is built, so it
  // hatches as the right species rather than visibly swapping a frame later.
  try {
    const saved = localStorage.getItem('divinity.animal');
    if (saved && state.models.hasPet(saved)) state.petChoice = saved;
  } catch { /* private mode: fall back to the default */ }
  initCreature(state, { faction: 0 });
  await state.creature.setAnimal(state.petChoice ?? CREATURE.DEFAULT_ANIMAL);

  // ...AND ONE FOR EVERY OTHER GOD (Phase 20).
  //
  // Built here rather than inside town.js because a creature needs the towns,
  // the villagers and the props to already exist - it starts sensing the world
  // on its first tick, and a beast that hatches into an empty one records that
  // there is nothing to eat.
  //
  // Loaded in parallel: each body is a separate ~150KB fetch, and four of them
  // in series is four round trips added to a boot the player is watching.
  bootStatus.textContent = 'Waking the other creatures…';
  const rivalBodies = [];
  for (let f = 1; f <= TOWN.RIVALS; f++) {
    const c = initCreature(state, { faction: f });
    // Wrapped round the list so five civilisations do not run off the end of
    // it and leave the fifth god with an animal that never loads.
    const key = RIVAL_GOD.ANIMALS[(f - 1) % RIVAL_GOD.ANIMALS.length];
    rivalBodies.push(c.setAnimal(key));
  }
  const bodies = await Promise.all(rivalBodies);
  // A key that is not in the Cube Pets kit resolves false rather than throwing,
  // which would leave a god commanding an invisible animal - a creature that
  // cannot be seen, fought or beaten. Said out loud instead.
  bodies.forEach((ok, i) => {
    if (!ok) console.error(`[rivalgods] no such animal "${RIVAL_GOD.ANIMALS[i % RIVAL_GOD.ANIMALS.length]}"`);
  });

  initMiracles(state);

  initCombat(state);
  // After combat: a god's first thought asks where its war is, and `frontFor`
  // is combat's to answer.
  initRivalGods(state);

  // Open on the town, which is where the player's attention belongs.
  state.camera.focus(state.town.centre.x, state.town.centre.z, CAMERA.START_DIST);

  bootEl.classList.add('hidden');
  setTimeout(() => bootEl.remove(), 600);
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

// --- resize -----------------------------------------------------------------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  state.camera.resize(w, h);
}
window.addEventListener('resize', onResize);

// --- loop -------------------------------------------------------------------
let last = performance.now();
let accumulator = 0;
let fpsAccum = 0;
let fpsFrames = 0;

// --- performance budget -----------------------------------------------------
//
// Measured, not aspirational: on the production build the whole simulation is
// about 0.2ms per step and a render submit about 0.7ms, against a 16.67ms
// frame. The ceilings in BUDGET sit roughly 5x above that, so this stays quiet
// until something genuinely regresses rather than nagging about normal play.
//
// Dev only, and sampled every BUDGET.CHECK_EVERY seconds - a budget check that
// cost frame time would be a poor joke. In a production build the whole block
// is dead code and the bundler drops it.
const DEV = import.meta.env?.DEV ?? false;
let budgetTimer = BUDGET.CHECK_EVERY;
let simMsAccum = 0;
let simMsSteps = 0;

function checkBudget(renderMs) {
  const info = renderer.info.render;
  const simMs = simMsSteps ? simMsAccum / simMsSteps : 0;
  simMsAccum = 0;
  simMsSteps = 0;

  let used = 0;
  let cap = 0;
  scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    used += o.count;
    cap += o.instanceMatrix.count;
  });
  const waste = cap ? (cap - used) / cap : 0;

  const over = [];
  if (simMs > BUDGET.SIM_MS) over.push(`sim ${simMs.toFixed(2)}ms > ${BUDGET.SIM_MS}`);
  if (renderMs > BUDGET.RENDER_MS) over.push(`render ${renderMs.toFixed(2)}ms > ${BUDGET.RENDER_MS}`);
  if (info.calls > BUDGET.DRAW_CALLS) over.push(`draws ${info.calls} > ${BUDGET.DRAW_CALLS}`);
  if (info.triangles > BUDGET.TRIANGLES) over.push(`tris ${info.triangles} > ${BUDGET.TRIANGLES}`);
  if (waste > BUDGET.INSTANCE_WASTE) {
    over.push(`instance waste ${Math.round(waste * 100)}% > ${Math.round(BUDGET.INSTANCE_WASTE * 100)}%`);
  }

  state.debug.budget = {
    simMs: +simMs.toFixed(3), renderMs: +renderMs.toFixed(3),
    draws: info.calls, tris: info.triangles,
    instances: `${used}/${cap}`, wastePct: Math.round(waste * 100),
    over
  };
  if (over.length) console.warn('[budget] over:', over.join(' | '));
}

function simStep(dt) {
  state.hand.simStep(dt);
  state.props.simStep(dt);
  // Town before villagers: growth and farm regrowth should be settled before
  // the agents look at the world this tick.
  state.town.simStep(dt);
  state.villagers.simStep(dt);
  for (const c of state.creatures) c.simStep(dt);
  // After the creatures, so a god judges the deed the tick has just finished
  // rather than the one before it.
  state.rivalGods.simStep(dt);
  state.miracles.simStep(dt);
  state.combat.simStep(dt);
  // Last, and reading only. Achievements observe the tick that has just been
  // resolved rather than a half-finished one, and nothing downstream depends
  // on them - so wherever they went, they went at the end.
  // Before achievements, after everything that can change the world: prayers
  // read conditions the tick has just settled, and resolve from facts already
  // emitted during it.
  state.prayers.simStep(dt);
  state.achievements.simStep(dt);
  // Dead last. It scores the tick that has just been resolved, and reads the
  // facts every other system emitted during it.
  state.sky.simStep(dt);
  state.graveyard.simStep(dt);
  state.reckoning.simStep(dt);
  state.time += dt;
  state.tick++;
}
state.simStep = simStep;

function frame(now) {
  requestAnimationFrame(frame);

  // Clamped so a tab-switch does not dump ten seconds of physics into one frame.
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;

  state.input.beginFrame();

  // --- hotkeys ---
  if (state.input.keyPressed('KeyF')) state.ui.setDebugVisible(!state.ui.debugVisible);
  if (state.input.keyPressed('KeyG')) state.ui.setMindVisible(!state.ui.mindVisible);
  if (state.input.keyPressed('KeyC')) state.ui.toggleZoo();
  // K for the achievements. They have existed since Phase 13 - fifty of them
  // across seven groups - on `I`, where nobody found them.
  if (state.input.keyPressed('KeyK')) state.ui.toggleActs();
  // Escape already closes the other overlays; prayers get the same courtesy.
  if (state.input.keyPressed('KeyR')) state.ui.togglePrayers();
  // Tab was the only unbound key left, and it is the one this genre uses for a
  // scoreboard anyway.
  if (state.input.keyPressed('Tab')) state.reckoningUi.toggle();
  // M mutes. The one key a player reaches for without reading a legend.
  //
  // BOUND TWICE, identically, comment and all - so one press called
  // `toggleMute()` twice and the sound came straight back on. The key appeared
  // to do nothing. Exactly the fault the KeyR note below this describes, in the
  // same function, forty lines apart; a duplicated handler is the shape of bug
  // this file keeps growing.
  if (state.input.keyPressed('KeyM')) {
    state.ui.toast(state.sound.toggleMute() ? 'Muted' : 'Sound on');
  }
  // Leash modes.
  if (state.input.keyPressed('Digit1')) state.creature.setLeash('learning');
  if (state.input.keyPressed('Digit2')) state.creature.setLeash('compassion');
  if (state.input.keyPressed('Digit3')) state.creature.setLeash('aggression');
  if (state.input.keyPressed('Digit4')) state.creature.setLeash('free');
  // V BLESSES. B is build, so the god's other reach-down takes V.
  //
  // The roll is announced rather than merely applied - a random effect the
  // player cannot see the result of is indistinguishable from no effect, and
  // they have just spent 45 belief on it.
  if (state.input.keyPressed('KeyV')) {
    const res = state.creature?.bless?.();
    if (res?.ok) {
      state.ui.toast(`${res.tier.label} — ${res.mult.toFixed(1)}x for ${BLESSING.SECONDS}s`);
    } else if (res) {
      state.ui.toast(res.reason);
    }
  }
  if (state.input.keyPressed('KeyP')) {
    state.paused = !state.paused;
    state.ui.toast(state.paused ? 'Paused' : 'Resumed');
  }
  if (state.input.keyPressed('KeyB')) {
    if (state.town.placing) state.town.cancelPlacement();
    else state.ui.toggleBuildMenu();
  }
  if (state.input.keyPressed('Escape')) {
    state.prayers.clearSelection();
    state.ui.closeActs();
    state.ui.closeZoo();
    state.ui.closeBuildMenu();
    state.town.cancelPlacement();
    // The live scoreboard closes like any other overlay. The results screen
    // does not - it has its own controls, and dismissing the end of the match
    // by fumbling Escape would be a poor way to find out the game was over.
    state.reckoningUi.closeLive();
  }
  // N FOR NEW, not R.
  //
  // `KeyR` was bound TWICE in this same function - once to open the prayers
  // panel and once, forty lines further down, to regenerate the island. Both
  // fired on the same press, so every time anyone opened prayers the island was
  // quietly rebuilt underneath them. It went unnoticed because the old
  // regenerate only swapped the heightmap and the towns stayed put; turning it
  // into a reload would have made checking your prayers restart the game.
  if (state.input.keyPressed('KeyN')) {
    // A FULL RELOAD, not a heightmap swap.
    //
    // This used to call `terrain.regenerate` in place, which raised a brand new
    // island UNDER the towns that were already standing on the old one - their
    // pads are flattened to a baked height with an instance matrix to match, so
    // they kept their old altitude and the new coastline appeared around and
    // through them. It also meant a "new island" silently kept the civilisation
    // count from the last one, when that is the one question every new map
    // has to ask.
    //
    // Reloading costs the asset fetch, and buys a world that is actually new.
    location.href = location.pathname;
  }

  // --- fixed-step simulation ---
  let steps = 0;
  // The world stops when the game ends. Rendering carries on, so the ending is
  // shown over the island it happened on rather than over a black screen.
  //
  // `postGame` is the Reckoning's "Continue Playing": the world turns again,
  // but `outcome` stays set, so endGame() still refuses to fire a second time
  // and the frozen scores stay frozen.
  if (!state.paused && (!state.outcome || state.postGame)) {
    accumulator += rdt;
    while (accumulator >= SIM_DT && steps < MAX_SIM_STEPS_PER_FRAME) {
      const _t0 = DEV ? performance.now() : 0;
      simStep(SIM_DT);
      if (DEV) { simMsAccum += performance.now() - _t0; simMsSteps++; }
      accumulator -= SIM_DT;
      steps++;
    }
    // If we hit the step cap we are running behind; drop the backlog rather
    // than accumulating a debt we can never pay off.
    if (steps === MAX_SIM_STEPS_PER_FRAME) accumulator = 0;
  }
  state.debug.simSteps = steps;
  state.alpha = accumulator / SIM_DT;

  // --- render-rate update ---
  // Order matters: town first, because while a building is being placed it
  // claims the left button, which keeps both the hand and the camera off it.
  // Then hand before camera, since grabbing likewise suppresses the pan.
  state.town.update(rdt);
  // Miracles before the rest: an armed miracle claims the left button.
  state.miracles.update(rdt);
  // Combat before hand and camera: grabbing the platoon banner claims the left
  // button, and whoever runs first gets it. Left until last, the camera had
  // already started a pan and the banner could never be picked up.
  state.combat.update(rdt, state.alpha);
  // Creature before hand: petting claims the left button, which stops the hand
  // from trying to pick the creature up as if it were a rock.
  // Before the creature, the hand and the camera: while Shift is held this
  // claims the mouse, and all three of them test that claim before acting.
  state.sculpt.update(rdt);
  // The player's first: petting claims the left button, and whoever runs first
  // gets it. The rivals' read no input at all, so their order does not matter.
  for (const c of state.creatures) c.update(rdt, state.alpha);
  state.hand.update(rdt, now / 1000);
  state.camera.update(rdt);
  state.props.syncRender(state.alpha);
  state.villagers.syncRender(state.alpha);
  // Before terrain: it hands the water shader its sun direction, and painting
  // the sea with last frame's sun is a seam you can see at dusk.
  state.sky.update(rdt);
  state.terrain.update(rdt, now / 1000, state.camera.cam.position);
  state.fx.update(rdt);
  state.prayerMarks.update(rdt, now / 1000);

  // Keep the sun locked relative to the camera target so shadows stay crisp
  // across the whole island without a huge shadow frustum.
  sun.target.position.set(state.camera.target.x, 0, state.camera.target.z);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, WORLD.EXTENT * 0.9);
  sky.position.copy(state.camera.cam.position);

  const _r0 = DEV ? performance.now() : 0;
  renderer.render(scene, state.camera.cam);
  if (DEV) {
    const renderMs = performance.now() - _r0;
    budgetTimer -= rdt;
    if (budgetTimer <= 0) { budgetTimer = BUDGET.CHECK_EVERY; checkBudget(renderMs); }
  }

  // --- fps ---
  fpsAccum += rdt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    state.debug.fps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }

  state.ui.update(rdt);
  state.reckoningUi.update(rdt);
  state.input.endFrame();
}

boot().catch((err) => {
  console.error(err);
  bootStatus.textContent = 'Failed to start — see console.';
});
