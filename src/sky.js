// ---------------------------------------------------------------------------
// sky.js - the turning sky, and the weather under it.
//
// The sun had been nailed to one spot since Phase 1: `SUN_DIR` at roughly
// sixty-five degrees, chosen because anything lower cast huge dead-black
// valleys across half the island. It never moved. Every game looked identical
// at minute one and minute forty.
//
// THIS IS THE FIRST SYSTEM IN THIS PROJECT THAT IS NOT PURELY AN OBSERVER. It
// owns state that other systems read, and that needs an explicit rule, because
// "everything reads the weather" is how a codebase turns into mud:
//
//   IT PUBLISHES NUMBERS. IT NEVER REACHES INTO ANOTHER SYSTEM.
//
// It sets `state.sky.hour`, `.weather`, `.cropMultiplier`, `.isNight`. Systems
// that care read them the way every system already reads `terrain.heightAt`.
// Nothing is pushed, and sky.js imports no gameplay system.
//
// Simulation and presentation stay split as always: `simStep` advances the
// clock and the weather on the 20Hz tick, `update` paints the result.
//
// Publishes state.sky.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import * as CFG from './skyconfig.js';
import { WORLD } from './state.js';

export function initSky(state, rig) {
  // Seeded like every other decision in the project, so a given seed gives a
  // given sky. Weather you cannot reproduce is weather you cannot debug.
  const rand = mulberry32(((state.seed ?? 0) ^ 0x5c17a1) >>> 0);

  const { sun, hemi, ambient, skyMat, fog } = rig;

  let hour = CFG.START_HOUR;

  // --- weather state machine ----------------------------------------------
  // ONE weather at a time with a transition, not a list of active effects -
  // which is the same "bounded by construction" call every system here makes.
  let weather = CFG.OPENING_WEATHER;
  let nextWeather = CFG.OPENING_WEATHER;
  let blend = 1;                    // 0 = fully `weather`, 1 = fully `nextWeather`
  let holdFor = CFG.OPENING_GRACE;

  const keys = Object.keys(CFG.WEATHER);
  const totalWeight = keys.reduce((n, k) => n + CFG.WEATHER[k].weight, 0);

  function rollWeather() {
    let r = rand() * totalWeight;
    for (const k of keys) {
      r -= CFG.WEATHER[k].weight;
      if (r <= 0) return k;
    }
    return 'clear';
  }

  // --- keyframe sampling ---------------------------------------------------
  const _a = new THREE.Color();
  const _b = new THREE.Color();

  /** The two keyframes bracketing an hour, and how far between them we are. */
  function bracket(h) {
    const K = CFG.KEYS;
    for (let i = 0; i < K.length - 1; i++) {
      if (h >= K[i].hour && h < K[i + 1].hour) {
        return [K[i], K[i + 1], (h - K[i].hour) / (K[i + 1].hour - K[i].hour)];
      }
    }
    // Past the last key: wrap round to the first, which is midnight. The table
    // opens and closes on the same night values so this seam is invisible.
    const last = K[K.length - 1];
    const span = 24 - last.hour + K[0].hour;
    return [last, K[0], span > 0 ? (h - last.hour) / span : 0];
  }

  /** Mix two keyframe colours into `out`. */
  function mixColor(out, a, b, t) {
    _a.setHex(a);
    _b.setHex(b);
    return out.copy(_a).lerp(_b, t);
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  // --- the rain ------------------------------------------------------------
  //
  // A fixed pool of drops in a box that follows the camera, recycled as they
  // fall out of the bottom. BOUNDED BY CONSTRUCTION: RAIN_DROPS is the instance
  // count always, whatever the weather is doing, so the worst case is the only
  // case and there is nothing here that can grow.
  const dropGeo = new THREE.BoxGeometry(0.09, 1.5, 0.09);
  const dropMat = new THREE.MeshBasicMaterial({
    color: CFG.RAIN_COLOR, transparent: true, opacity: 0, depthWrite: false, fog: true
  });
  const rain = new THREE.InstancedMesh(dropGeo, dropMat, CFG.RAIN_DROPS);
  rain.frustumCulled = false;
  rain.name = 'rain';
  rain.visible = false;
  state.scene.add(rain);

  const dropX = new Float32Array(CFG.RAIN_DROPS);
  const dropY = new Float32Array(CFG.RAIN_DROPS);
  const dropZ = new Float32Array(CFG.RAIN_DROPS);
  const dropV = new Float32Array(CFG.RAIN_DROPS);
  for (let i = 0; i < CFG.RAIN_DROPS; i++) {
    dropX[i] = (rand() - 0.5) * CFG.RAIN_BOX[0];
    dropY[i] = rand() * CFG.RAIN_BOX[1];
    dropZ[i] = (rand() - 0.5) * CFG.RAIN_BOX[2];
    dropV[i] = lerp(CFG.RAIN_SPEED[0], CFG.RAIN_SPEED[1], rand());
  }
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  let rainStrength = 0;

  // --- applied values ------------------------------------------------------
  const sunColor = new THREE.Color();
  const hemiSkyColor = new THREE.Color();
  const hemiGroundColor = new THREE.Color();
  const fogColor = new THREE.Color();
  const topColor = new THREE.Color();
  const midColor = new THREE.Color();
  const botColor = new THREE.Color();
  const _sunDir = new THREE.Vector3();

  let sunI = 2.35;
  let hemiI = 1.75;
  let elevation = 0.95;

  /** Weather values, blended between the outgoing and incoming state. */
  function weatherValue(field) {
    const a = CFG.WEATHER[weather][field];
    const b = CFG.WEATHER[nextWeather][field];
    return lerp(a, b, blend);
  }

  // --- simulation ----------------------------------------------------------

  function simStep(dt) {
    hour = (hour + (dt / CFG.DAY_SECONDS) * 24) % 24;

    if (blend < 1) {
      blend = Math.min(1, blend + dt / CFG.WEATHER_BLEND);
      if (blend >= 1) weather = nextWeather;
    } else {
      holdFor -= dt;
      if (holdFor <= 0) {
        const want = rollWeather();
        holdFor = lerp(CFG.WEATHER_SECONDS[0], CFG.WEATHER_SECONDS[1], rand());
        if (want !== weather) {
          nextWeather = want;
          blend = 0;
          // Announced as a fact, like everything else in this project. sound.js
          // and the HUD can listen; nothing has to.
          state.events?.emit('weather-changed', {
            from: weather, to: want, at: state.time
          });
        }
      }
    }
  }

  // --- presentation --------------------------------------------------------

  function update(dt) {
    const [ka, kb, t] = bracket(hour);

    // The hour decides the palette...
    mixColor(sunColor, ka.sun, kb.sun, t);
    mixColor(hemiSkyColor, ka.hemiSky, kb.hemiSky, t);
    mixColor(hemiGroundColor, ka.hemiGround, kb.hemiGround, t);
    mixColor(fogColor, ka.fog, kb.fog, t);
    mixColor(topColor, ka.top, kb.top, t);
    mixColor(midColor, ka.mid, kb.mid, t);
    mixColor(botColor, ka.bottom, kb.bottom, t);
    sunI = lerp(ka.sunI, kb.sunI, t);
    hemiI = lerp(ka.hemi, kb.hemi, t);
    elevation = lerp(ka.elevation, kb.elevation, t);
    const ambI = lerp(ka.ambient, kb.ambient, t);

    // ...and the weather modifies it, on top.
    const sunScale = weatherValue('sunScale');
    const desat = weatherValue('desat');
    const fogScale = weatherValue('fogScale');

    // Desaturation is what makes overcast read as overcast rather than as dim.
    if (desat > 0) {
      const grey = (c) => {
        const l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
        c.lerp(_a.setRGB(l, l, l), desat);
      };
      grey(sunColor); grey(hemiSkyColor); grey(fogColor);
      grey(topColor); grey(midColor); grey(botColor);
    }

    sun.color.copy(sunColor);
    sun.intensity = sunI * sunScale;
    hemi.color.copy(hemiSkyColor);
    hemi.groundColor.copy(hemiGroundColor);
    hemi.intensity = hemiI;
    ambient.intensity = ambI;

    // The sun sweeps as well as rises, so shadows rotate rather than only
    // lengthening - which is most of what makes a moving sun read as one.
    const dayT = Math.min(1, Math.max(0, (hour - 5) / 14.5));
    const az = lerp(CFG.AZIMUTH_AT_DAWN, CFG.AZIMUTH_AT_DUSK, dayT);
    const horiz = Math.sqrt(Math.max(0.0001, 1 - elevation * elevation));
    _sunDir.set(Math.sin(az) * horiz, elevation, Math.cos(az) * horiz).normalize();
    sun.position.copy(_sunDir).multiplyScalar(WORLD.EXTENT * 0.9);

    // THE SHADOW FRUSTUM GROWS AS THE SUN DROPS. Fitted tight to the island in
    // main.js, which is right for a fixed high sun and wrong the moment it
    // moves: a low sun throws shadows several times longer than the thing
    // casting them, and a tight frustum clips them mid-hillside.
    const span = WORLD.HALF * lerp(CFG.SHADOW_SPAN[1], CFG.SHADOW_SPAN[0], elevation);
    const cam = sun.shadow.camera;
    if (Math.abs(cam.right - span) > 0.5) {
      cam.left = -span; cam.right = span;
      cam.top = span; cam.bottom = -span;
      cam.updateProjectionMatrix();
    }

    // The water's specular follows the sun, through terrain's own entry point.
    state.terrain?.setSunDirection?.(_sunDir);

    // Fog and the sky's horizon band MUST match, or a hard line appears where
    // the ocean stops and the sky starts. One colour, read by both.
    if (fog) {
      fog.color.copy(fogColor);
      fog.near = WORLD.EXTENT * 0.9 / fogScale;
      fog.far = WORLD.EXTENT * 2.3 / fogScale;
    }
    if (skyMat?.uniforms) {
      skyMat.uniforms.uTop.value.copy(topColor);
      skyMat.uniforms.uMid.value.copy(midColor);
      skyMat.uniforms.uBottom.value.copy(botColor);
    }

    updateRain(dt);
  }

  function updateRain(dt) {
    // Strength follows the weather blend rather than snapping on.
    const want = (weather === 'rain' ? 1 - blend : 0)
      + (nextWeather === 'rain' ? blend : 0);
    rainStrength += (want - rainStrength) * Math.min(1, dt / CFG.RAIN_FADE * 6);
    if (rainStrength < 0.01) {
      if (rain.visible) { rain.visible = false; dropMat.opacity = 0; }
      return;
    }
    rain.visible = true;
    dropMat.opacity = 0.5 * rainStrength;

    const cam = state.camera?.cam?.position;
    if (!cam) return;
    const [bw, bh, bd] = CFG.RAIN_BOX;

    for (let i = 0; i < CFG.RAIN_DROPS; i++) {
      dropY[i] -= dropV[i] * dt;
      // Recycled, not respawned: the pool never allocates after init.
      if (dropY[i] < 0) {
        dropY[i] += bh;
        dropX[i] = (rand() - 0.5) * bw;
        dropZ[i] = (rand() - 0.5) * bd;
      }
      _p.set(cam.x + dropX[i], cam.y - bh * 0.5 + dropY[i], cam.z + dropZ[i]);
      _m.compose(_p, _q, _s);
      rain.setMatrixAt(i, _m);
    }
    rain.instanceMatrix.needsUpdate = true;
  }

  // --- api -----------------------------------------------------------------

  const api = {
    enabled: true,
    get hour() { return hour; },
    /** 0..1 across the day, for anything that wants a smooth value. */
    get daylight() { return Math.max(0, Math.min(1, elevation)); },
    get isNight() { return hour >= CFG.NIGHT_FROM || hour < CFG.NIGHT_TO; },

    /**
     * 0 in daylight, 1 in full dark, ramped smoothly across dusk and dawn.
     *
     * A FUNCTION OF THE HOUR, not something eased per frame - so it is the same
     * on a 60Hz monitor and a 144Hz one, and anything that wants to fade with
     * the dark (villagers' lanterns today, lit windows later) can read it
     * without keeping a timer of its own.
     */
    get nightness() {
      const ramp = CFG.NIGHT_RAMP;
      // Falling into night across the evening...
      if (hour >= CFG.NIGHT_FROM - ramp && hour <= CFG.NIGHT_FROM) {
        return (hour - (CFG.NIGHT_FROM - ramp)) / ramp;
      }
      // ...and climbing back out of it after dawn.
      if (hour >= CFG.NIGHT_TO && hour <= CFG.NIGHT_TO + ramp) {
        return 1 - (hour - CFG.NIGHT_TO) / ramp;
      }
      return api.isNight ? 1 : 0;
    },
    get phase() { return bracket(hour)[0].name; },

    get weather() { return blend < 0.5 ? weather : nextWeather; },
    get weatherLabel() { return CFG.WEATHER[api.weather].label; },
    /**
     * What crops do under this sky. THE ENTIRE MECHANICAL FOOTPRINT of the
     * weather system - town.js multiplies its regrowth by this and nothing else
     * in the game changes. Blended, so a drought arrives gradually.
     */
    get cropMultiplier() { return weatherValue('crop'); },

    /** Clock, for the HUD. */
    get clock() {
      const h = Math.floor(hour);
      const m = Math.floor((hour - h) * 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    },
    get rainDrops() { return rain.visible ? CFG.RAIN_DROPS : 0; },
    get debug() {
      return {
        clock: api.clock, phase: api.phase, weather: api.weather,
        blend: +blend.toFixed(2), holdFor: Math.round(holdFor),
        crop: +api.cropMultiplier.toFixed(2),
        sunI: +sun.intensity.toFixed(2), elevation: +elevation.toFixed(2),
        rain: rain.visible ? CFG.RAIN_DROPS : 0
      };
    },
    simStep,
    update
  };

  state.sky = api;
  return api;
}
