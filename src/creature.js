// ---------------------------------------------------------------------------
// creature.js - the companion creature and its mind. This is the point of the
// whole game, so the learning section below is commented at length.
//
// The mind has four parts:
//
//   NEEDS      hunger / energy / cleanliness. Pure drives, not learned. They
//              decide *how badly* it wants to do a thing, never *what* thing.
//
//   DESIRES    eat / sleep / play / attack / help / impress. A weight each.
//              These are learned. They decide what kind of act it favours.
//
//   OPINIONS   objectType -> { edibility, fun, threat }. Also learned, and all
//              starting at zero, which is the important part: a newborn has no
//              idea a boulder is inedible, so it will try to eat one.
//
//   CURIOSITY  exploration noise that decays as lessons accumulate. This is
//              what makes the creature visibly stupid early and deliberate
//              later, and it is the first dial to turn if the arc feels wrong.
//
// Scoring one candidate action is:
//
//   utility = desire[d] * leashBias[d] * needDrive(d) * opinionScore(d, type)
//             * proximity  +  curiosityNoise
//
// Teaching happens two ways: reinforcement (you slap or stroke it just after it
// acts) and imitation (it watches you do something notable nearby). Both use a
// learning rate that decays with repetition, so the first lessons stick hardest.
//
// EVERY GOD HAS ONE (Phase 20). This file used to be a singleton in all but
// name - `initCreature(state)` built one animal, wrote it to `state.creature`
// and hard-coded "the player" into a dozen places, because there was one god
// and one beast and the two words were interchangeable.
//
// The mind is unchanged. What changed is that it belongs to a FACTION rather
// than to the player:
//
//   * `faction` is fixed at birth and never moves. A god does not change sides
//     when a town does, so this is deliberately NOT read off `home.owner`.
//   * everything that used to ask "is this the player's?" asks "is this mine?"
//   * everything that only a human can do - petting, the right-drag summons,
//     the leash line drawn to the hand - is behind `isHuman`.
//
// A rival's creature is commanded by rivalgods.js, which uses exactly the three
// levers the player has: the leash, the summons, and `reinforce`. There is no
// fourth lever and no cheating one, which is the whole reason a rival's beast
// can be beaten the same way it can be raised.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { CREATURE, CREATURE_TRAITS, EARNED_TRAITS, PET_TEMPERAMENT, LEASH_MODES, DESIRE_AXIS, WORLD, KINSHIP, KINSHIP_LEAK, PRAYER, RIVAL_GOD, TOWN} from './state.js';

/** Scratch colour for the rival banner tint. Module-level: read immediately. */
const _banner = new THREE.Color();

// ---------------------------------------------------------------------------
// BODY - a Cube Pets model plus its animation clips.
// ---------------------------------------------------------------------------
/**
 * Build the creature from a Cube Pets model.
 *
 * The pack's animals ship eight node-animation clips each - static, idle, walk,
 * run, eat, dance, gesture-positive, gesture-negative - which map almost
 * one-to-one onto the states this creature already had. That is why the whole
 * hand-animated skeleton below (legs, jaw, tail chain) is gone: an artist's
 * walk cycle beats a sine wave, and the two gesture clips give slap and stroke
 * a real physical reaction.
 *
 * Nothing is skinned, so these are cheap node transforms rather than skinning.
 */
function buildBody(gltf, targetHeight) {
  const root = new THREE.Group();
  const model = gltf.scene;

  // Normalise: the pack's animals vary from 1.26 to 2.13 units tall, so scale
  // each to a common height and sit its feet on the origin. Doing it on a
  // wrapper keeps the model's own transforms free for the animation clips.
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const k = size.y > 0 ? targetHeight / size.y : 1;
  model.scale.setScalar(k);
  model.position.set(
    -(box.min.x + box.max.x) / 2 * k,
    -box.min.y * k,
    -(box.min.z + box.max.z) / 2 * k
  );
  root.add(model);

  // Tinting for dirt, alignment and the slap/stroke flash needs materials this
  // creature owns; the loader caches the source gltf, so they must be cloned or
  // the next animal inherits the last one's bruises.
  const materials = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = mats.map((m) => m.clone());
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
    materials.push(...cloned);
  });

  // Forgiving, single-target pick volume for petting.
  const r = Math.max(size.x, size.z) * k * 0.75;
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(r, targetHeight * 0.55), 8, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hit.position.y = targetHeight * 0.5;
  root.add(hit);

  // The load it hauls, shown only while carrying.
  const load = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.36, 0.42),
    new THREE.MeshStandardMaterial({ roughness: 0.85 })
  );
  load.castShadow = true;
  load.visible = false;
  root.add(load);

  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map();
  for (const clip of gltf.animations) clips.set(clip.name, clip);

  return { root, model, hit, load, materials, mixer, clips, height: targetHeight };
}

// ---------------------------------------------------------------------------
/**
 * @param {object} state
 * @param {{faction?: number}} opts  which god this creature answers to.
 *   Defaults to 0, the player, so the original one-argument call still works.
 */
export function initCreature(state, opts = {}) {
  /**
   * WHOSE CREATURE THIS IS. Fixed at birth and never rewritten.
   *
   * Deliberately not derived from `home.owner`: a god whose capital is taken
   * has lost a town, not their creature, and reading the owner live would flip
   * the beast to the conqueror's side in the middle of the battle for it.
   */
  const faction = opts.faction ?? 0;
  const isHuman = faction === 0;
  // Salted per faction, or every creature in the game rolls the same curiosity
  // noise on the same tick and four of them move like one animal in four places.
  const rand = mulberry32((state.seed ^ 0x4b17 ^ (faction * 0x9e3779b9)) >>> 0);
  /**
   * The tag this creature stamps on a resource node it has claimed.
   *
   * `claimedBy = 'creature'` was fine with one of them. With four it is a
   * shared lock with one name: each would see its own tag on a rival's tree and
   * happily clear it, and two beasts would walk to the same log.
   */
  const claimTag = 'creature' + faction;
  const terrain = state.terrain;

  /**
   * The town this creature calls home, resolved live.
   *
   * Live rather than captured at birth because a god can lose their capital and
   * still be in the game - `capitalOf` falls back to the biggest thing they
   * hold. Returns null for a god with nothing left, and every caller here
   * tolerates that: a creature with no home simply has nowhere to deliver to.
   */
  function homeTown() {
    return state.town?.capitalOf?.(faction) ?? null;
  }

  /** The name of the god this creature answers to, for anything user-facing. */
  const ownerName = () => state.factions?.[faction]?.name ?? 'Someone';

  /** True if this town answers to some other god. The one hostility test here. */
  const enemyTown = (t) => !!t && t.owner !== faction;

  /**
   * IS THIS POINT INSIDE A KEEP, as far as THIS creature is concerned?
   *
   * A castle is solid and a creature is pushed out of it by its own bulk, so
   * anything standing inside one is a thing the animal can walk at forever
   * without reaching. Props are the case that actually happens: `foundTown`
   * flattens the ground and drops a castle on it, but it does not clear the
   * trees and rocks that were already there the way `place` does for every
   * other building - so a boulder can end up sitting in the middle of a keep,
   * and a creature that decides to eat it is stuck at the wall for good.
   *
   * A soak found one at 14.6 from a castle - its exact solid radius - in the
   * `approach` phase for 308 seconds.
   */
  function inKeep(p) {
    const solid = state.town?.pushOutOfCentres?.(p.x, p.z, scale * CREATURE.BODY_RADIUS);
    return !!solid?.hit;
  }

  const group = new THREE.Group();
  state.scene.add(group);

  // --- body + animation ------------------------------------------------------
  let body = null;
  let animal = state.petChoice ?? CREATURE.DEFAULT_ANIMAL;
  let currentClip = null;
  let currentAction = null;
  /** A one-shot reaction (gesture-positive/negative) that outranks the state clip. */
  let reactionUntil = 0;

  /**
   * Cross-fade to a clip by name. Everything is driven from one place so the
   * animation can never disagree with what the creature is actually doing.
   */
  function playClip(name, { once = false, fade = 0.25, speed = 1 } = {}) {
    if (!body || !body.clips.has(name)) return;
    if (currentClip === name && !once) return;
    const next = body.mixer.clipAction(body.clips.get(name));
    next.enabled = true;
    next.setEffectiveTimeScale(speed);
    next.setEffectiveWeight(1);
    if (once) {
      next.reset();
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    if (currentAction && currentAction !== next) {
      next.reset();
      next.crossFadeFrom(currentAction, fade, false);
      next.play();
    } else {
      next.play();
    }
    currentAction = next;
    currentClip = once ? null : name; // one-shots must not block the next state
  }

  /** Swap in a different animal, keeping every scrap of what it has learned. */
  async function setAnimal(key) {
    if (!state.models.hasPet(key)) return false;
    const gltf = await state.models.loadPet(key);
    if (body) {
      body.mixer.stopAllAction();
      group.remove(body.root);
    }
    body = buildBody(gltf, CREATURE.BODY_HEIGHT);
    group.add(body.root);
    animal = key;
    setTemperament(key);
    currentClip = null;
    currentAction = null;
    playClip('idle', { fade: 0 });
    // Only the player's choice is remembered between games. Rivals are dealt
    // their animals from RIVAL_GOD.ANIMALS, and writing those here would have
    // each rival in turn overwrite what the player picked.
    if (isHuman) {
      try { localStorage.setItem('divinity.animal', key); } catch { /* private mode */ }
    }
    say(`I am a ${key.replace(/^animal-/, '')} now`
      + (temperament.length ? ` - ${temperament.map((t) => CREATURE_TRAITS[t].label).join(' and ')}` : ''));
    return true;
  }

  // --- the summons ring -----------------------------------------------------
  // A flat ring on the ground showing where it has been told to be. Drawn with
  // the same additive, depth-tested-but-not-written trick the influence rings
  // use, so it reads on grass and on stone without z-fighting the terrain.
  const ringGeo = new THREE.RingGeometry(0.97, 1.0, 64);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x8fd8ff, transparent: true, opacity: 0.55,
    depthWrite: false, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.visible = false;
  ring.renderOrder = 3;
  state.scene.add(ring);

  /** Lay the ring on the terrain, sampling a few points so it follows slopes. */
  function placeRing(at, radius, colour, opacity) {
    ring.visible = true;
    ring.position.set(at.x, terrain.heightAt(at.x, at.z) + 0.35, at.z);
    ring.scale.setScalar(Math.max(1, radius));
    ringMat.color.setHex(colour);
    ringMat.opacity = opacity;
  }

  /**
   * Order the creature to a place. radius <= 0 uses the minimum.
   *
   * THE SPOT IS PUSHED OUT OF ANY KEEP FIRST, because a castle is solid and an
   * order to stand inside one cannot be obeyed. Right-drag a small circle onto
   * a castle and the beast walks at the wall, is pushed back, and keeps trying:
   * `strayDistance` never falls under SUMMON_SLACK, so the summoned action is
   * recreated every tick and the animal stands there for the rest of the match.
   * A soak caught exactly that - 233 seconds motionless, 12.2 from the player's
   * own keep.
   *
   * Pushed by the bulk of a FULLY GROWN creature rather than its bulk today.
   * The circle it is pushed out of widens as the animal grows, so a spot that
   * was reachable at hatching becomes unreachable at maturity - and an order
   * that quietly stops working twenty minutes after you gave it is worse than
   * one that was never accepted.
   */
  function summon(x, z, radius) {
    const r = clamp(radius || 0, CREATURE.SUMMON_MIN_RADIUS, CREATURE.SUMMON_MAX_RADIUS);
    const clear = state.town?.pushOutOfCentres?.(
      x, z, CREATURE.MAX_SCALE * CREATURE.BODY_RADIUS);
    const sx = clear ? clear.x : x;
    const sz = clear ? clear.z : z;
    summons = { pos: new THREE.Vector3(sx, terrain.heightAt(sx, sz), sz), radius: r };
    say(`told to hold ${r < CREATURE.SUMMON_MIN_RADIUS * 1.5 ? 'this spot' : 'this ground'}`);
  }

  function dismiss() {
    if (!summons) return;
    summons = null;
    say('free to roam again');
    if (isHuman) state.ui?.toast('Your creature is free to roam');
  }

  /** How far outside its circle the creature currently is, or 0 if inside. */
  function strayDistance() {
    if (!summons) return 0;
    const d = Math.hypot(pos.x - summons.pos.x, pos.z - summons.pos.z);
    return Math.max(0, d - summons.radius);
  }

  // =========================================================================
  // MIND
  // =========================================================================

  /**
   * DESIRE WEIGHTS. What kind of act the creature favours. Learned.
   * Starting values are deliberately lopsided: a newborn mostly wants to eat
   * and play, barely considers helping, and has almost no aggression - so the
   * violent creature is something you *taught* it to be, not a default.
   *
   * `impress` WAS 0.15, AND THAT WAS A DEAD DESIRE (raised to 0.40 in Phase 20).
   *
   * Work the arithmetic and it could never be chosen. Against an OPINION_BASELINE
   * of 0.38 and a proximity term around 0.5, an impress act scored roughly 0.03
   * where eating a nearby tree scored 0.79 - a fortieth. It never won, so it was
   * never performed, so it was never reinforced, so it never rose: the desire
   * was unreachable from its own starting value. That did not matter while the
   * act paid nothing, and a 35-minute soak with three gods deliberately courting
   * each other confirmed it, ending with every awe meter on the island at zero
   * and every `impress` weight still at exactly 0.15.
   *
   * At 0.40 it sits below `eat` and `play`, so a hungry creature still eats and
   * the arc is unchanged - but a WELL-FED one, at a stranger's gate, under a
   * leash that favours it, will put on a show. Which is the point: awe is now a
   * route to a town, and a route nobody's creature can take is not a route.
   */
  const desires = { eat: 0.75, sleep: 0.55, play: 0.65, attack: 0.10, help: 0.12, impress: 0.40 };

  /** Repetition counters, one per desire, driving learning-rate decay. */
  const desireReps = { eat: 0, sleep: 0, play: 0, attack: 0, help: 0, impress: 0 };
  const imitationReps = { eat: 0, sleep: 0, play: 0, attack: 0, help: 0, impress: 0 };

  /**
   * OPINIONS. objectType -> { edibility, fun, threat } in -1..+1, plus its own
   * per-axis repetition counters. Everything starts at zero: no innate
   * knowledge of anything. This table is the creature's entire world model.
   */
  const opinions = new Map();
  function opinionFor(type) {
    let o = opinions.get(type);
    if (!o) {
      o = { edibility: 0, fun: 0, threat: 0, reps: { edibility: 0, fun: 0, threat: 0 } };
      opinions.set(type, o);
    }
    return o;
  }

  /** NEEDS. Not learned - they only modulate urgency. */
  const needs = { hunger: 0.35, energy: 0.9, cleanliness: 0.9 };

  let lessons = 0; // total reinforcement + imitation events, drives curiosity
  let age = 0;
  let mealsEaten = 0;
  /** What it is hauling home, or null. { type: 'wood'|'ore', amount } */
  let carrying = null;
  let scale = CREATURE.START_SCALE;

  let leash = 'learning';

  /**
   * TEMPERAMENT. Two traits that come from the species, not from a dice roll,
   * so picking your animal is picking a personality: a lion really does hit
   * harder and learn slower than a parrot. Folded to flat multipliers whenever
   * the animal changes, and read from there - never re-derived per tick.
   */
  let temperament = [];
  /**
   * Traits EARNED rather than born with. Kept apart from the species list so
   * that changing body swaps the animal without wiping its history.
   */
  let earned = [];
  /** What the earned traits are measured against. */
  const deeds = { routs: 0, kills: 0, praise: 0 };
  let temper = foldTemperament([]);

  function foldTemperament(traits) {
    const m = {
      attack: 1, defense: 1, speed: 1, hunger: 1, eat: 1,
      learn: 1, memory: 1, curiosity: 1,
      desire: { eat: 1, sleep: 1, play: 1, attack: 1, help: 1, impress: 1 }
    };
    for (const key of traits) {
      const t = CREATURE_TRAITS[key] ?? EARNED_TRAITS[key];
      if (!t) continue;
      for (const k of ['attack', 'defense', 'speed', 'hunger', 'eat', 'learn', 'memory', 'curiosity']) {
        if (typeof t[k] === 'number') m[k] *= t[k];
      }
      if (t.desire) for (const d of Object.keys(t.desire)) m.desire[d] *= t.desire[d];
    }
    return m;
  }

  /** Adopt the temperament of a species. */
  function setTemperament(key) {
    temperament = PET_TEMPERAMENT[key] ?? [];
    refold();
  }

  /** Species traits and earned traits both feed the same multiplier table. */
  function refold() {
    temper = foldTemperament([...temperament, ...earned]);
  }

  /**
   * Has anything been earned? Called whenever a deed counter moves. Earning is
   * announced, because a trait that appears silently is a trait the player
   * never learns they have.
   */
  function checkEarned() {
    for (const key of Object.keys(EARNED_TRAITS)) {
      if (earned.includes(key)) continue;
      const t = EARNED_TRAITS[key];
      if ((deeds[t.counter] ?? 0) < t.at) continue;
      earned.push(key);
      refold();
      say(`I am ${t.label} now - ${t.note}`);
      // A rival's beast growing into Bloodied is worth knowing about, but it is
      // their news, not yours - so it is named rather than called "your".
      if (isHuman) state.ui?.toast(`Your creature is ${t.label}`);
      else state.ui?.toast(`${ownerName()}'s creature is ${t.label}`);
      state.fx?.burst(pos, 22, 0xffe9b8);
    }
  }

  /**
   * WAR. Health, and the timer that keeps it at home after a rout. Attack and
   * defense themselves are not stored - they are derived from the constants and
   * the war multiplier every time they are used, so the doubling can never fall
   * out of step with whether the banner is actually an attack order.
   */
  let health = CREATURE.WAR_HEALTH;
  let routedUntil = -1;
  /** True while it has pulled back to heal rather than fight on to a rout. */
  let withdrawn = false;
  /** Damage banked since the last lesson pain taught. See takeDamage. */
  let painSince = 0;
  /**
   * Where the player has told it to be: { pos, radius } or null.
   * Outranked by war (an attack order is still an order), and it outranks the
   * creature's own wandering.
   */
  let summons = null;
  let swingTimer = 0;
  /** When it was last hit by anything. Drives CREATURE.WAR_PROVOKED. */
  let lastHitAt = -Infinity;
  let swingUntil = 0; // holds the attack animation just after a swipe
  let devourUntil = 0; // holds the eating animation just after taking someone

  // Current action, and the record kept so reinforcement knows what to blame.
  let action = null; // { desire, target, targetType, pos, phase, timer }
  let lastAction = null; // { desire, targetType } - the thing a slap refers to
  let lastActionAge = 999; // seconds since it finished; stale acts aren't punished

  let decideTimer = 0;

  const log = [];
  function say(text) {
    log.unshift({ t: state.time, text });
    if (log.length > CREATURE.LOG_LENGTH) log.pop();
    // Every creature keeps its own log - that is what the debug panel reads to
    // show a rival's mind - but only one of them may write the single shared
    // status line, or four animals fight over it and none of them is legible.
    if (isHuman) state.debug.lastLog = `creature: ${text}`;
  }

  // --- position / physical state -------------------------------------------
  const pos = new THREE.Vector3();
  const prev = new THREE.Vector3();
  let yaw = 0;
  let prevYaw = 0;
  let walkPhase = 0;
  let speed = 0;

  (function placeAtTown() {
    const c = homeTown()?.centre ?? new THREE.Vector3();
    const a = rand() * Math.PI * 2;
    pos.set(c.x + Math.cos(a) * 18, 0, c.z + Math.sin(a) * 18);
    pos.y = terrain.heightAt(pos.x, pos.z);
    prev.copy(pos);
  })();

  // =========================================================================
  // LEARNING
  // =========================================================================

  /**
   * The decaying learning rate. `base` is how far the very first lesson moves
   * a value; after `reps` repetitions it has shrunk to base / (1 + reps*decay).
   *
   *   reps 0 -> 1.00x    reps 3 -> 0.38x    reps 10 -> 0.15x
   *
   * That curve is why the first thing you teach a creature is the thing it
   * believes for the rest of the game.
   */
  function rateFor(base, reps, decay = CREATURE.LEARN_DECAY) {
    // Temperament bends the whole curve: a Clever animal takes lessons faster,
    // a Stubborn one resists them but holds the few it accepts far longer.
    return (base * temper.learn) / (1 + reps * decay * temper.memory);
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /**
   * LEARNING FROM CONSEQUENCES, as opposed to from you.
   *
   * Same machinery as a slap - same opinion table, same kinship leak, same
   * decaying rate - at a much lower base, so a hand on the creature still beats
   * a hundred of its own mistakes. `dir` is +1 when the outcome was good and -1
   * when it was not.
   */
  function selfTeach(type, axis, dir, base = CREATURE.SELF_TEACH_BASE) {
    if (!type || !axis) return;
    const o = opinionFor(type);
    const before = o[axis];
    // Nothing left to learn on this axis. Opinions clamp to -1..1, and a
    // creature in a long fight was banking a "lesson" every few seconds that
    // moved threat 1.00 -> 1.00: pure noise in the thought log, and each one
    // still counted toward `lessons`, quietly draining its curiosity.
    if (dir > 0 && before >= 0.999) return;
    if (dir < 0 && before <= -0.999) return;
    const rate = rateFor(base, o.reps[axis], CREATURE.SELF_TEACH_DECAY);
    teachOpinion(type, axis, dir * rate);
    lessons++;
    say(`worked out for myself: ${type}.${axis} ` +
      `${before.toFixed(2)}->${o[axis].toFixed(2)}`);
  }

  /**
   * Apply a lesson to one opinion axis, and leak a fraction of it to related
   * object types.
   *
   * Without the leak, teaching "rocks are not food" says nothing whatsoever
   * about boulders, and past a handful of object types the creature reads as
   * incapable of learning at all. The leak is deliberately partial: relatives
   * shift, but they keep their own repetition counters and can still be taught
   * something different directly.
   */
  function teachOpinion(type, axis, delta) {
    const o = opinionFor(type);
    o[axis] = clamp(o[axis] + delta, -1, 1);
    o.reps[axis]++;

    const family = KINSHIP[type];
    if (!family) return;
    for (const [other, fam] of Object.entries(KINSHIP)) {
      if (other === type || fam !== family) continue;
      const oo = opinionFor(other);
      oo[axis] = clamp(oo[axis] + delta * KINSHIP_LEAK, -1, 1);
      // Only a partial repetition: a leaked lesson should not use up a
      // relative's capacity to be taught directly.
      oo.reps[axis] += KINSHIP_LEAK;
    }
  }

  /**
   * REINFORCEMENT. `sign` is +1 for a stroke, -1 for a slap.
   *
   * Two things move at once, which is the whole trick:
   *   1. the DESIRE it was acting on   ("stop wanting to attack things")
   *   2. its OPINION of the OBJECT     ("...and villagers in particular are
   *                                       not for attacking")
   * Slapping a creature that just ate a villager therefore both dampens `eat`
   * a little and drives `villager.edibility` sharply negative - so it may keep
   * eating, but not villagers.
   */
  function reinforce(sign) {
    // Counted even when the praise lands on nothing teachable: the creature
    // still knows it was made a fuss of, which is what Beloved is about.
    if (sign > 0) { deeds.praise++; checkEarned(); }
    if (!lastAction || lastActionAge > 12) {
      say(sign > 0 ? 'stroked, but unsure what for' : 'slapped, but unsure what for');
      return null;
    }

    // The leash of learning is what makes a lesson land harder.
    const gain = leash === 'learning' ? CREATURE.LEARNING_LEASH_GAIN : 1;
    const d = lastAction.desire;

    // Instincts (grooming) are actions but not learnable desires - there is no
    // weight to move, and writing to a missing key produces NaN, which silently
    // poisons every later comparison.
    if (!(d in desires)) {
      lastAction = null;
      say(`${sign > 0 ? 'stroked' : 'slapped'} over an instinct (${d}); nothing to learn`);
      return null;
    }

    const dRate = rateFor(CREATURE.LEARN_DESIRE_BASE, desireReps[d]) * gain;
    const before = desires[d];
    // A Gentle animal is hard to teach cruelty and easy to teach kindness.
    const lean = sign > 0 ? (temper.desire[d] ?? 1) : 1 / (temper.desire[d] ?? 1);
    desires[d] = clamp(desires[d] + sign * dRate * lean, CREATURE.DESIRE_MIN, CREATURE.DESIRE_MAX);
    desireReps[d]++;

    let opinionNote = '';
    const axis = DESIRE_AXIS[d];
    if (axis && lastAction.targetType) {
      const type = lastAction.targetType;
      const o = opinionFor(type);
      const oRate = rateFor(CREATURE.LEARN_OPINION_BASE, o.reps[axis]) * gain;
      const ob = o[axis];
      // A slap on `attack` should make the target look LESS threatening, which
      // is the same direction as every other axis: sign applies uniformly.
      teachOpinion(type, axis, sign * oRate);
      opinionNote = `, ${type}.${axis} ${ob.toFixed(2)}->${o[axis].toFixed(2)}`;
    }

    lessons++;
    say(`${sign > 0 ? 'STROKE' : 'SLAP'}: ${d} ${before.toFixed(2)}->${desires[d].toFixed(2)}${opinionNote}`);

    // One lesson per deed. Without this, a player mashing the slap button
    // punishes a single act five or six times over, which blows straight
    // through the decay curve and makes the system impossible to tune.
    lastAction = null;
    return { desire: d, sign };
  }

  /**
   * IMITATION. The creature watches the player. If something notable happens
   * inside its view, the matching desire is nudged up and, where an object was
   * involved, its opinion of that object shifts too.
   *
   * Imitation is deliberately weaker than a slap (IMITATE_BASE < LEARN_*_BASE)
   * so that deliberate teaching always beats accidental copying - otherwise a
   * few stray throws would overwrite everything you trained.
   */
  const IMITATION = {
    // player action           -> desire raised, opinion nudge
    feed_villager: { desire: 'help', type: 'villager', axis: 'fun', dir: +1 },
    strike_villager: { desire: 'attack', type: 'villager', axis: 'threat', dir: +1 },
    destroy_building: { desire: 'attack', type: 'building', axis: 'threat', dir: +1 },
    feed_creature: { desire: 'eat', type: null, axis: null, dir: 0 },
    throw_prop: { desire: 'play', type: null, axis: 'fun', dir: +1 }
  };

  function witness(kind, targetType, where) {
    const rule = IMITATION[kind];
    if (!rule) return;
    // Only what it can actually see counts.
    if (where && pos.distanceTo(where) > CREATURE.VIEW_DIST) return;

    const d = rule.desire;
    const rate = rateFor(CREATURE.IMITATE_BASE, imitationReps[d], CREATURE.IMITATE_DECAY);
    const before = desires[d];
    desires[d] = clamp(desires[d] + rate * (temper.desire[d] ?? 1),
      CREATURE.DESIRE_MIN, CREATURE.DESIRE_MAX);
    imitationReps[d]++;

    const type = rule.type ?? targetType;
    if (rule.axis && rule.dir !== 0 && type) {
      const o = opinionFor(type);
      const oRate = rateFor(CREATURE.IMITATE_BASE, o.reps[rule.axis], CREATURE.IMITATE_DECAY);
      teachOpinion(type, rule.axis, rule.dir * oRate);
    }

    lessons++;
    say(`watched you ${kind.replace(/_/g, ' ')} -> ${d} ${before.toFixed(2)}->${desires[d].toFixed(2)}`);
  }

  // --- world events it can witness ------------------------------------------
  // Subscribed rather than called into, so props/hand/miracles do not need to
  // know the creature exists.
  if (state.events) {
    state.events.on('prop-thrown', (e) => witness('throw_prop', e.type, e.pos));
    // IT LEARNS FROM ITS OWN GOD, THROUGH ANYTHING BUT ITSELF.
    //
    // The old test was `e.cause !== 'creature' && e.byPlayer !== false`: learn
    // from what the player does, and not from your own jaws. Both halves were
    // right; only the word "player" was, by Phase 20, too narrow. The mirror is
    // `e.by === faction`, which says the same thing about whichever god this
    // beast belongs to.
    //
    // The looser rule I tried first - learn from any deed you did not do
    // yourself - is wrong, and a soak said so in one line. The player's creature
    // came out of five minutes with its `attack` weight pinned at the 2.00
    // ceiling and a log full of "watched you strike villager", none of which the
    // player had done: it was standing near somebody else's war. Being attacked
    // would have taught your creature to attack. Your creature's morals are
    // yours, and they should come from you.
    //
    // `cause !== 'creature'` still has to stay, or it reads its own rampage back
    // as a lesson and teaches itself aggression - the bug that logged every
    // building it flattened as "watched you destroy building".
    const fromMyGod = (e) => e && e.by === faction && e.cause !== 'creature';
    state.events.on('villagers-killed', (e) => {
      if (fromMyGod(e)) witness('strike_villager', 'villager', e.pos);
    });
    state.events.on('building-destroyed', (e) => {
      if (fromMyGod(e)) witness('destroy_building', 'building', e.pos);
    });
    state.events.on('villagers-fed', (e) => witness('feed_villager', 'villager', e.pos));
    state.events.on('miracle-cast', (e) => {
      // Watching a miracle is a demonstration too: nurture or destruction.
      if (e.def.align > 0) witness('feed_villager', 'villager', e.pos);
      else witness('destroy_building', 'building', e.pos);
    });
  }

  // =========================================================================
  // DECIDING WHAT TO DO
  // =========================================================================

  /**
   * How badly a need pushes toward each desire.
   *
   * Survival drives use a steep curve rather than the raw need value. Linear
   * urgency loses: a starving creature scoring `hunger * baselineOpinion`
   * (1.0 * 0.38) is beaten by anything it has learned is fun, so it will play
   * with a rock until it drops. Squaring and scaling means mild hunger stays a
   * background nudge while real hunger overrides everything else.
   */
  function needDrive(desire) {
    switch (desire) {
      case 'eat': return Math.pow(needs.hunger, 1.6) * CREATURE.NEED_URGENCY;
      case 'sleep': return Math.pow(1 - needs.energy, 1.6) * CREATURE.NEED_URGENCY;
      case 'groom': return Math.pow(1 - needs.cleanliness, 1.6) * CREATURE.NEED_URGENCY;
      // Social/played-out desires only surface when it is not desperate.
      case 'play': return 0.35 + 0.65 * needs.energy * (1 - needs.hunger);
      case 'attack': return 0.45 + 0.55 * needs.energy;
      case 'help': return 0.4 + 0.6 * (1 - needs.hunger);
      case 'impress': return 0.4 + 0.6 * needs.energy;
      default: return 1;
    }
  }

  /**
   * How appealing a given object looks for a given desire.
   * OPINION_BASELINE is what makes an unknown object worth a try; a trained
   * opinion of -1 takes the score negative and the action is discarded.
   */
  function opinionScore(desire, type) {
    const axis = DESIRE_AXIS[desire];
    if (!axis) return 1;
    return CREATURE.OPINION_BASELINE + opinionFor(type)[axis];
  }

  /** Exploration noise, shrinking as the creature accumulates lessons. */
  function curiosity() {
    return (CREATURE.CURIOSITY_BASE * temper.curiosity) / (1 + lessons * CREATURE.CURIOSITY_DECAY);
  }

  /** Collect everything nearby worth considering as a target. */
  function gatherCandidates() {
    const out = [];
    const R = CREATURE.SENSE_RADIUS;
    const R2 = R * R;

    for (const p of state.props.list) {
      if (p.dead || p.harvested || p.held) continue;
      const d2 = (p.pos.x - pos.x) ** 2 + (p.pos.z - pos.z) ** 2;
      if (d2 > R2) continue;
      if (inKeep(p.pos)) continue;      // buried in a castle; unreachable
      // Felled timber is worth flagging: the creature much prefers it.
      const loose = p.kind === 'tree' && !state.props.isPlanted(p);
      out.push({ kind: 'prop', type: p.kind, ref: p, pos: p.pos, d2, loose });
    }

    if (state.villagers) {
      for (const v of state.villagers.list) {
        if (!v.alive) continue;
        const d2 = (v.pos.x - pos.x) ** 2 + (v.pos.z - pos.z) ** 2;
        if (d2 > R2) continue;
        out.push({
          kind: 'villager', type: 'villager', ref: v, pos: v.pos, d2,
          enemy: enemyTown(v.town)
        });
      }
    }

    // EVERY building in reach, whoever owns it, flagged the way villagers are.
    //
    // This was `state.town.buildings` - the player's own capital, and nothing
    // else in the world. Two things were wrong with it once `impress` started
    // paying awe. The obvious one: a rival's creature saw no buildings at all,
    // because that list is the player's. The one that mattered: NOBODY'S
    // creature could see a FOREIGN building, so `impress` - the desire whose
    // entire point is putting on a show for somebody who is not yours - could
    // only ever be aimed at the home village, where it earns nothing.
    //
    // A 35-minute soak with three gods deliberately courting each other ended
    // with every awe meter on the island reading zero, and this line is why.
    for (const b of state.town?.allBuildings ?? []) {
      const d2 = (b.pos.x - pos.x) ** 2 + (b.pos.z - pos.z) ** 2;
      if (d2 > R2) continue;
      out.push({
        kind: 'building', type: b.type, ref: b, pos: b.pos, d2,
        enemy: enemyTown(b.town)
      });
    }
    return out;
  }

  const OBJECT_DESIRES = {
    // `help` on a prop means hauling it home for the stockpile.
    prop: ['eat', 'play', 'attack', 'help'],
    villager: ['eat', 'play', 'attack', 'help', 'impress'],
    building: ['attack', 'play', 'impress']
  };

  // =========================================================================
  // WAR
  //
  // The banner is the order. Plant it on hostile ground and the creature is
  // called to it - and this OVERRIDES the utility AI rather than feeding into
  // it, which is a deliberate exception to how everything else here works.
  //
  // The reason is that a direct order must be obeyed. Routed through the normal
  // scoring, a creature whose `attack` desire sat at its 0.08 floor would score
  // the war below eating a shrub and simply ignore you, and the player would
  // rightly call that broken. Teaching still happens - it just happens through
  // what it does at the front, not through whether it chooses to go.
  // =========================================================================

  /** Attack power of one swipe, doubled while fighting under the banner. */
  function attackPower() {
    return CREATURE.WAR_ATTACK * temper.attack * (atWar() ? CREATURE.WAR_MULT : 1);
  }

  /**
   * Damage divisor, doubled while in the fight.
   *
   * Note `|| withdrawn`, which is not cosmetic. Soldiers keep swinging at a
   * creature that has broken off, so tying this to atWar() alone HALVED its
   * defense at the exact moment it turned to leave - it pulled back hurt and
   * was then killed twice as fast on the way out. A retreating animal is still
   * in the battle until it is clear of it.
   */
  function defensePower() {
    const inBattle = atWar() || withdrawn;
    return CREATURE.WAR_DEFENSE * temper.defense * (inBattle ? CREATURE.WAR_MULT : 1);
  }

  /** Is the creature answering an attack order right now? */
  function atWar() {
    if (health <= 0 || state.time < routedUntil) return false;
    // Hurt animals pull back. Being driven off the field should be the price of
    // a fight you chose badly, not the routine end of every battle.
    if (health < CREATURE.WAR_HEALTH * CREATURE.WAR_WITHDRAW) withdrawn = true;
    else if (health >= CREATURE.WAR_HEALTH * CREATURE.WAR_REJOIN) withdrawn = false;
    if (withdrawn) return false;
    // THE LEASH OF COMPASSION IS A STAND-DOWN ORDER.
    //
    // New in Phase 20, and it is the same one rule combat.js uses to decide
    // whether a creature in foreign streets has declared war - see
    // LEASH_MODES.compassion.peaceful. Without it, courting is impossible: a
    // beast sent to perform in a rival's square flips to the war action the
    // moment its god's army sets out somewhere else on the island, and spends
    // the visit swiping at the audience.
    //
    // It gives the leash real teeth for the player too. Until now, changing it
    // could not call the creature off a fight - the banner outranked it - which
    // made "Leash of Compassion" a label on a control that could not do the one
    // thing its name promises.
    if (LEASH_MODES[leash]?.peaceful) return false;
    // Being attacked is its own order. See CREATURE.WAR_PROVOKED - without this
    // a beast whose god happens to be at peace is killed where it stands.
    if (state.time - lastHitAt < CREATURE.WAR_PROVOKED) return true;
    // Its own god's war, not the player's. `warFront` is the banner, which only
    // one god in the game has a hand to plant.
    const front = state.combat?.frontFor?.(faction);
    if (!front) return false;

    // A SUMMONS OUTRANKS THE WAR - and this is what makes that true.
    //
    // simStep has said so in a comment since the summons existed, and the
    // ordering there does hold: the war branch will not clobber a summoned
    // action. What neither of them stopped was the TUG OF WAR. Outside its
    // circle the summons pulled it back; once inside, the war took over and
    // marched it toward a front on the far side of the island; a step later it
    // was outside its circle again. A soak caught one alternating 89 ticks
    // summoned against 111 at war over ten seconds, shuffling on the spot.
    //
    // So a summoned creature fights what comes to IT. Anything further off than
    // its circle plus the usual war leash is not its business while it is under
    // orders - which is also exactly what you want when you post it somewhere.
    if (summons) {
      const d = Math.hypot(front.x - summons.pos.x, front.z - summons.pos.z);
      if (d > summons.radius + CREATURE.WAR_LEASH) return false;
    }
    return true;
  }

  /**
   * Is another god's fighting beast close enough to stop this one healing?
   *
   * `peaceful` rather than `atWar` on the other animal, for the same reason
   * combat.js's `nearestBeastIntruder` does it - `atWar` is derived from the
   * war front and asking it about somebody else recurses.
   */
  function beastNear() {
    const R2 = CREATURE.HEAL_BLOCK_RANGE * CREATURE.HEAL_BLOCK_RANGE;
    for (const c of state.creatures) {
      // `fighting` rather than `inField`, and that difference is a deadlock.
      //
      // `inField` only means alive and not routed - it is true of an animal
      // that has broken off and is standing there bleeding. So two beaten
      // creatures near the same keep each blocked the OTHER from healing,
      // neither could reach WAR_REJOIN, neither had any reason to move, and
      // both stood at the castle for the rest of the match. A soak found one
      // motionless for eleven minutes on 0.2 health.
      //
      // You cannot bind your wounds with a lion standing over you. You can bind
      // them next to a lion that is also lying down.
      if (c === api || c.faction === faction || !c.fighting) continue;
      const dx = c.position.x - pos.x;
      const dz = c.position.z - pos.z;
      if (dx * dx + dz * dz <= R2) return true;
    }
    return false;
  }

  /**
   * WHERE A HURT ANIMAL GOES. Beside its own keep, not into it.
   *
   * This used to be `homeTown().centre` with a stop distance of ARRIVE_DIST -
   * and the middle of a castle is SOLID. So the retreat was a walk into a wall:
   * `walkToward` correctly reported "blocked and getting no closer, so this is
   * as near as I will ever be", the creature stopped dead against the stone,
   * and every retreating animal on the island converged on the same few metres
   * of masonry. It got worse as they grew, because a bigger beast is pushed
   * further out - a full-grown one parks 14.6 from a centre it is aiming at.
   *
   * So the target is a point it can actually occupy: clear of the keep by its
   * own bulk plus a margin. And if something is still standing over it, the
   * bearing is AWAY from that rather than whatever side it happens to be on -
   * which is what makes this a retreat rather than a shuffle.
   */
  const _retreat = { x: 0, z: 0 };
  function retreatSpot() {
    const home = homeTown()?.centre ?? null;

    // The nearest thing still actually fighting, which is what it is backing
    // away from.
    let threat = null;
    let bestD2 = Infinity;
    for (const c of state.creatures) {
      if (c === api || c.faction === faction || !c.fighting) continue;
      const d2 = (c.position.x - pos.x) ** 2 + (c.position.z - pos.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; threat = c; }
    }

    // A GOD WITH NO LAND STILL HAS A CREATURE, and a faction driven off the
    // island has no `homeTown` at all. This used to return null, and the
    // retreat branch answers null by setting speed to 0 - so the animal stood
    // in a field for the rest of the match. With nothing to run from and
    // nowhere to run to, there is no retreat to make: hand it back to the
    // ordinary mind, which will find it something to eat.
    if (!home) {
      if (!threat) return null;
      // There IS something on it - put ground between them, measured from a
      // FIXED point. Anchoring on `pos` would move the target every tick and
      // walk it off the edge of the world one step at a time.
      const dx = pos.x - threat.position.x;
      const dz = pos.z - threat.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const out = CREATURE.HEAL_BLOCK_RANGE + CREATURE.LAIR_MARGIN;
      _retreat.x = threat.position.x + (dx / d) * out;
      _retreat.z = threat.position.z + (dz / d) * out;
      return _retreat;
    }

    // Home, but BESIDE the keep rather than inside it - and on the far side
    // from whatever is still standing over it.
    const fx = threat ? home.x - threat.position.x : pos.x - home.x;
    const fz = threat ? home.z - threat.position.z : pos.z - home.z;
    const d = Math.hypot(fx, fz);
    // Dead centre has no bearing to take; any one will do. Same guard, and the
    // same reason, as `pushOutOfCentres`.
    const ux = d < 1e-4 ? 1 : fx / d;
    const uz = d < 1e-4 ? 0 : fz / d;
    const out = TOWN.CENTRE_SOLID + scale * CREATURE.BODY_RADIUS + CREATURE.LAIR_MARGIN;
    _retreat.x = home.x + ux * out;
    _retreat.z = home.z + uz * out;
    return _retreat;
  }

  /** Everything hostile the creature can see, nearest first is not needed. */
  function warTargets() {
    const out = [];
    const R2 = CREATURE.SENSE_RADIUS * CREATURE.SENSE_RADIUS;
    const near = (p) => (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;

    // Everything it will fight has to be within WAR_LEASH of the banner. The
    // creature's own sense radius decides what it can SEE; the flag decides
    // what it is allowed to go after. Without this second test it walks itself
    // off the map one target at a time.
    const front = state.combat?.frontFor?.(faction) ?? null;
    const L2 = CREATURE.WAR_LEASH * CREATURE.WAR_LEASH;
    const onFront = (p) => !front
      || ((p.x - front.x) ** 2 + (p.z - front.z) ** 2) <= L2;

    const grid = state.combat?.soldierGrid;
    if (grid) {
      grid.near(pos.x, pos.z, CREATURE.SENSE_RADIUS, (o) => {
        if (!o.alive || !enemyTown(o.town) || !onFront(o.pos)) return;
        const d2 = near(o.pos);
        if (d2 <= R2) out.push({ kind: 'soldier', ref: o, pos: o.pos, d2 });
      });
    }
    for (const v of state.villagers?.list ?? []) {
      if (!v.alive || !enemyTown(v.town) || !onFront(v.pos)) continue;
      const d2 = near(v.pos);
      if (d2 <= R2) out.push({ kind: 'villager', ref: v, pos: v.pos, d2 });
    }
    for (const b of state.town?.allBuildings ?? []) {
      if (!enemyTown(b.town) || !onFront(b.pos)) continue;
      const d2 = near(b.pos);
      if (d2 <= R2) out.push({ kind: 'building', ref: b, pos: b.pos, d2 });
    }
    // ...AND OTHER GODS' BEASTS, which this list did not contain at all.
    //
    // Soldiers, villagers and buildings was a complete enumeration of everything
    // hostile in the world right up until Phase 20 put a creature behind every
    // banner. After it, two monsters could stand in the same square razing each
    // other's villages and neither would look up.
    //
    // `inField` rather than merely alive: a routed animal has quit the field and
    // is not to be chased down and finished off - the same rule the soldiers
    // obey when they pick their targets.
    for (const c of state.creatures) {
      if (c === api || c.faction === faction || !c.inField) continue;
      if (!onFront(c.position)) continue;
      const d2 = near(c.position);
      if (d2 <= R2) out.push({ kind: 'creature', ref: c, pos: c.position, d2 });
    }
    return out;
  }

  /**
   * One swipe: a sweep that catches everything hostile within WAR_RANGE, not a
   * single-target hit. It is the size of a house and it is swinging a limb, so
   * a line of men standing shoulder to shoulder should all feel it.
   */
  function swipe(targets) {
    const R2 = CREATURE.WAR_RANGE * CREATURE.WAR_RANGE;
    const atk = attackPower();
    let slain = 0;
    let slainPos = null;
    let hitAnything = false;
    let lastType = null;

    // Only the nearest few are caught. Without a cap one swipe killed eight men
    // standing round it and it walked out of a razed town having lost 0.1 of
    // its twenty hit points - which makes both the army and the risk pointless.
    // A limb sweeps an arc; it does not clear a field.
    const inReach = targets.filter((t) => t.d2 <= R2)
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, CREATURE.WAR_SWEEP);

    for (const t of inReach) {
      hitAnything = true;
      if (t.kind === 'building') {
        t.ref.hp -= atk * (CREATURE.WAR_ATTACK_BUILDING / CREATURE.WAR_ATTACK);
        if (t.ref.hp <= 0) {
          const b = t.ref;
          state.fx?.burst(b.pos, 24, 0x9c8a70);
          state.town.demolish(b);
          state.events?.emit('building-destroyed',
            { building: b, pos: b.pos, cause: 'creature', byPlayer: isHuman, by: faction });
          lastType = 'building';
        }
      } else if (t.kind === 'soldier') {
        t.ref.hp -= atk;
        if (t.ref.hp <= 0) {
          t.ref.alive = false;
          state.fx?.burst(t.ref.pos, 8, 0xb85a3a);
          deeds.kills++;
          lastType = 'soldier';
        }
      } else if (t.kind === 'creature') {
        // ANOTHER GOD'S BEAST. Not swatted like a soldier and emphatically not
        // eaten - `takeDamage` is its own public entry point, so the other
        // animal applies its own defense, banks its own pain into a lesson, and
        // routs itself when it has had enough. Nothing here needs to know how
        // any of that works.
        const was = t.ref.inField;
        t.ref.takeDamage(atk * (CREATURE.WAR_ATTACK_CREATURE / CREATURE.WAR_ATTACK),
          'creature');
        state.fx?.burst(t.ref.position, 8, 0xd94f3a);
        lastType = 'creature';
        // Driving one off the field is the closest thing to a kill there is -
        // they heal and come back - so it counts as a deed and is worth saying.
        if (was && !t.ref.inField) {
          deeds.kills++;
          say(`drove off ${t.ref.ownerName}'s ${t.ref.animal.replace(/^animal-/, '')}`);
          if (isHuman) state.ui?.toast(`Your creature drives off ${t.ref.ownerName}'s beast`);
          else if (t.ref.isHuman) state.ui?.toast(`${ownerName()}'s beast drives yours off`);
        }
      } else {
        // Enemy civilians are not swatted, they are EATEN. A swipe that kills a
        // soldier should not do the same thing to a farmer - the beast stops,
        // takes them, and is fed by it. This is also what keeps it in the fight:
        // every mouthful is health back, so a creature carving through a town
        // sustains itself rather than grinding down to a rout.
        t.ref.health -= atk * CREATURE.DEVOUR_MULT;
        if (t.ref.health <= 0) {
          t.ref.alive = false;
          state.fx?.burst(t.ref.pos, 10, 0xc0392b);
          needs.hunger = Math.max(0, needs.hunger - CREATURE.DEVOUR_FEEDS * temper.eat);
          health = Math.min(CREATURE.WAR_HEALTH, health + CREATURE.DEVOUR_HEALS);
          mealsEaten++;
          devourUntil = state.time + 0.6;
          deeds.kills++;
          slain++;
          slainPos = t.ref.pos.clone();
          lastType = 'villager';
        }
      }
    }

    // Civilians killed under your banner are on you, exactly as they are when
    // your soldiers do it. Enemy soldiers are war and cost nothing.
    if (slain) {
      state.events?.emit('villagers-killed',
        { count: slain, pos: slainPos, cause: 'creature', byPlayer: isHuman, by: faction });
    }

    if (hitAnything) {
      checkEarned();
      state.fx?.burst(pos, 14, 0xb85a3a);
      swingUntil = state.time + 0.35;
      // Fighting is a deed like any other: it is what a slap or a stroke in the
      // next few seconds will refer to, so the player can teach it to relish
      // war or to hate it.
      if (lastType) {
        lastAction = { desire: 'attack', targetType: lastType };
        lastActionAge = 0;
      }
    }
    return hitAnything;
  }

  /** Drive the creature off the field. Mortals cannot kill it, only rout it. */
  function rout() {
    // One-shot. Regeneration lifts health a hair above zero between hits, so
    // without this guard every tick of an ongoing fight counted as a fresh
    // rout: 2101 "your creature is driven off" toasts in a six-wave test.
    if (state.time < routedUntil) return;
    deeds.routs++;
    withdrawn = true; // walk home and heal; see the retreat leg
    health = 0;
    routedUntil = state.time + CREATURE.WAR_ROUT_TIME;
    clearClaim();
    action = null;
    state.fx?.burst(pos, 30, 0xe0553f);
    say('driven off the field');
    if (isHuman) state.ui?.toast('Your creature is driven off');
    state.debug.lastLog = 'the creature was routed';
    checkEarned();
  }

  /**
   * Prayers the creature currently knows about.
   *
   * PERCEPTION ONLY. It hears that someone is asking for something and where,
   * exactly as it hears every other fact on the bus; it never reads the prayer
   * system and the prayer system never reads it. Kept small and pruned on
   * resolution, because an unbounded list of remembered prayers is precisely
   * the leak this project keeps rediscovering.
   */
  const knownPrayers = new Map();          // id -> { pos, category, urgency }

  // PRAYER IS THE PLAYER'S COVENANT and prayers.js raises them only for the
  // player's towns. A rival's creature subscribing here would be listening for
  // a cry that can never be about anyone it knows, so it does not listen. The
  // map stays empty for it and `prayerPull` returns its neutral 1.
  state.events?.on('prayer-raised', (e) => {
    if (!isHuman || !e?.pos) return;
    // Only what it could plausibly notice. A cry from the far side of the
    // island is not something a beast standing in your fields can hear.
    if (pos.distanceTo(e.pos) > PRAYER.CREATURE_NOTICE) return;
    knownPrayers.set(e.id, {
      pos: e.pos.clone ? e.pos.clone() : { x: e.pos.x, y: e.pos.y, z: e.pos.z },
      category: e.category, urgency: e.urgency
    });
    if (knownPrayers.size > 16) {
      knownPrayers.delete(knownPrayers.keys().next().value);
    }
  });

  state.events?.on('prayer-resolved', (e) => {
    if (!isHuman) return;
    const known = knownPrayers.get(e.id);
    knownPrayers.delete(e.id);
    if (!known) return;
    // It learns from how things it was aware of turned out. Helping when the
    // people were asking is reinforced through the ordinary self-teaching
    // path, so it is subject to the same decay and the same leash as anything
    // else it has ever learned.
    if (e.status === 'answered' && e.by === 'creature') {
      selfTeach('villager', 'fun', +1, CREATURE.SELF_TEACH_BASE);
      say(`they asked, and I came`);
    }
  });

  /**
   * How much a candidate is worth BECAUSE somebody is praying near it.
   *
   * A nudge on an existing help action, never a new ability: the creature can
   * already haul timber and stone to a town, and that is exactly what a supply
   * prayer asks for. It is not made to solve every request - a strong desire
   * still beats this comfortably.
   */
  function prayerPull(c) {
    if (!knownPrayers.size) return 1;
    let best = 1;
    for (const k of knownPrayers.values()) {
      const dx = c.pos.x - k.pos.x;
      const dz = c.pos.z - k.pos.z;
      if (dx * dx + dz * dz > PRAYER.ANSWER_RADIUS * PRAYER.ANSWER_RADIUS) continue;
      best = Math.max(best, 1 + 0.55 * (0.4 + k.urgency));
    }
    return best;
  }

  function decide() {
    const bias = LEASH_MODES[leash].bias;
    const cur = curiosity();
    let candidates = gatherCandidates();

    // Under a summons it only considers things inside the circle it was given.
    // Filtering the candidates rather than vetoing the walk afterwards is what
    // makes it *choose* to stay: it never sets off for the tree it cannot have.
    if (summons) {
      const r = summons.radius + CREATURE.SUMMON_SLACK;
      const r2 = r * r;
      candidates = candidates.filter((c) =>
        (c.pos.x - summons.pos.x) ** 2 + (c.pos.z - summons.pos.z) ** 2 <= r2);
    }

    let best = null;
    let bestScore = -Infinity;

    // --- self-directed actions: no object, driven purely by need ---
    // `sleep` is a learnable desire; `groom` is a fixed instinct with no weight
    // to train, so it uses a constant.
    for (const d of ['sleep', 'groom']) {
      const weight = d in desires ? desires[d] : CREATURE.GROOM_INSTINCT;
      const score = weight * (bias[d] ?? 1) * needDrive(d)
        + (rand() - 0.5) * cur;
      if (score > bestScore) {
        bestScore = score;
        best = { desire: d, target: null, targetType: null, kind: 'self' };
      }
    }

    // --- object-directed actions ---
    for (const c of candidates) {
      // Closer things are more attractive, but only mildly: this is a tiebreak,
      // not the decision. A strong desire should still march it across the map.
      const proximity = 1 / (1 + Math.sqrt(c.d2) / CREATURE.SENSE_RADIUS);

      for (const d of OBJECT_DESIRES[c.kind]) {
        let score =
          desires[d] * (bias[d] ?? 1) * needDrive(d) * opinionScore(d, c.type) * proximity;
        // Somebody nearby is asking for help. Only `help` is swayed - a prayer
        // does not make it hungrier or more violent, it makes helping there
        // more attractive than helping somewhere else.
        if (d === 'help') score *= prayerPull(c);
        // A tree on the ground is food; one still growing is barely worth the
        // effort. This is what turns the creature into a cleanup crew for
        // whatever you have been throwing around.
        if (d === 'eat' && c.type === 'tree') {
          score *= c.loose ? CREATURE.LOOSE_FOOD_BONUS : CREATURE.PLANTED_FOOD_PENALTY;
        }
        // People are not all alike to it. An enemy is prey and a rival's town
        // is a larder; its own people are not. Without this the creature was
        // exactly as happy to eat the farmer who feeds it as the soldier
        // marching on the gate, which reads as broken rather than as wild.
        if (c.kind === 'villager' && (d === 'eat' || d === 'attack')) {
          score *= c.enemy ? CREATURE.ENEMY_APPETITE : CREATURE.FRIEND_RESTRAINT;
        }
        // The same restraint for their houses, now that it can see them. A
        // creature is not to pull down its own god's granary because it happens
        // to be the nearest wall.
        if (c.kind === 'building' && d === 'attack') {
          score *= c.enemy ? CREATURE.ENEMY_APPETITE : CREATURE.FRIEND_RESTRAINT;
        }
        // AND THE SHOW IS FOR STRANGERS. Dancing in your own square is a happy
        // animal; dancing in somebody else's is the whole peaceful route to
        // taking their town, so that is where the desire pulls it.
        if (d === 'impress') {
          score *= c.enemy ? CREATURE.STRANGER_AUDIENCE : 1;
        }
        // Hauling: only props can be fetched, and only ones no villager has
        // already walked out to. Weighted by what the stockpile is short of, so
        // the creature fills the gap rather than piling up what you already have.
        if (d === 'help') {
          if (c.kind !== 'prop' || !c.ref.resource || c.ref.claimedBy) continue;
          score *= shortageOf(c.ref.resource);
        }
        score += (rand() - 0.5) * cur;
        if (score > bestScore) {
          bestScore = score;
          best = { desire: d, target: c.ref, targetType: c.type, kind: c.kind, pos: c.pos };
        }
      }
    }

    // NOTHING WITHIN REACH. Wander, rather than groom on the spot forever -
    // see CREATURE.ROAM_DIST. Checked after scoring so it cannot pre-empt a
    // real choice: `candidates` being empty is the whole condition.
    if (!candidates.length && needs.energy > CREATURE.ROAM_MIN_ENERGY) {
      const a = rand() * Math.PI * 2;
      const r = CREATURE.ROAM_DIST * (0.6 + rand() * 0.5);
      // Homeward-ish if it has a home, so a roaming animal drifts back toward
      // its own land instead of random-walking off the island.
      const home = homeTown()?.centre;
      const bias = home ? 0.45 : 0;
      const tx = pos.x + Math.cos(a) * r + (home ? (home.x - pos.x) * bias : 0);
      const tz = pos.z + Math.sin(a) * r + (home ? (home.z - pos.z) * bias : 0);
      clearClaim();
      action = {
        desire: 'play', target: null, targetType: null,
        kind: 'roam', phase: 'roam', dest: { x: tx, z: tz }
      };
      say('nothing here; wandering');
      return;
    }

    if (!best) return;

    // Ignore a re-decision that lands on exactly what it is already doing.
    if (action && action.desire === best.desire && action.target === best.target) return;
    // Anything the outgoing action had reserved has to be handed back, or every
    // change of mind strands another node that nobody may ever harvest.
    clearClaim();

    const hauling = best.desire === 'help' && best.kind === 'prop';
    action = {
      desire: best.desire,
      target: best.target,
      targetType: best.targetType,
      kind: best.kind,
      phase: best.target ? 'approach' : 'act',
      timer: hauling ? CREATURE.HAUL_GATHER_TIME : CREATURE.ACT_TIME
    };
    // Reserve the node so a villager does not walk to the same tree.
    if (hauling) best.target.claimedBy = claimTag;
    say(`${best.desire}${best.targetType ? ' the ' + best.targetType : ''} (score ${bestScore.toFixed(2)}, curiosity ${cur.toFixed(2)})`);
  }

  // =========================================================================
  // PERFORMING ACTIONS
  // =========================================================================

  /** Release any node this action had reserved. */
  function clearClaim() {
    if (action?.target && action.target.claimedBy === claimTag) {
      action.target.claimedBy = null;
    }
  }

  /** Give up on the current action, freeing whatever it had reserved. */
  function abandonAction(why) {
    if (why) say(why);
    clearClaim();
    action = null;
  }

  /**
   * Where hauled goods get dropped: the nearest storage pit, else the keep.
   *
   * Searched across every town its god holds rather than the capital alone,
   * which is also why it cannot use `state.town.findBuilding` any more - that
   * one is bound to the player's town by design.
   */
  function dropOffPoint() {
    const home = homeTown();
    if (!home) return null;
    let best = null;
    let bestD2 = Infinity;
    for (const b of state.town?.allBuildings ?? []) {
      if (b.town.owner !== faction || !b.def.storage) continue;
      const d2 = (b.pos.x - pos.x) ** 2 + (b.pos.z - pos.z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = b; }
    }
    // The keep's threshold, not its middle: the stonework is solid since Phase
    // 17 and a delivery point inside the wall can never be reached.
    if (best) return best.pos;
    const g = state.town.gateOf(home, pos.x, pos.z);
    return { x: g.x, y: home.centre.y, z: g.z };
  }

  /**
   * How badly the town wants this resource, 0..HAUL_SHORTAGE_WEIGHT.
   * A full stockpile makes fetching more of it barely worth the walk.
   */
  function shortageOf(resource) {
    const have = homeTown()?.resources?.[resource] ?? 0;
    const lack = Math.max(0, 1 - have / CREATURE.HAUL_SATED);
    return 0.25 + lack * CREATURE.HAUL_SHORTAGE_WEIGHT;
  }

  function targetPos() {
    if (!action || !action.target) return null;
    const t = action.target;
    if (t.pos) return t.pos;
    return null;
  }

  /** Apply the effect of a completed action, then remember it for teaching. */
  function completeAction() {
    if (!action) return;
    const { desire, target, targetType, kind } = action;

    switch (desire) {
      case 'eat': {
        // What it ate decides what it gets, and what it gets is the lesson.
        const food = CREATURE.NUTRITION[targetType] ?? 0;
        needs.hunger = Math.max(0,
          needs.hunger - CREATURE.EAT_RESTORE * temper.eat * food);
        needs.cleanliness = Math.max(0, needs.cleanliness - 0.08);
        if (food > 0) mealsEaten++;
        else needs.energy = Math.max(0, needs.energy - CREATURE.INEDIBLE_COST);
        // The consequence teaches, with nobody watching. A poor meal is its own
        // argument against: anything under NUTRITION_GOOD teaches downward, so
        // the creature works out for itself that people are not worth eating.
        selfTeach(targetType, 'edibility',
          food >= CREATURE.NUTRITION_GOOD ? 1 : -1);
        if (kind === 'prop' && target && !target.dead) state.props.harvest(target);
        if (kind === 'villager' && target?.alive) {
          target.alive = false;
          state.debug.lastLog = 'the creature ate a villager';
          state.events?.emit('villagers-killed',
            { count: 1, pos: pos.clone(), cause: 'creature', byPlayer: isHuman, by: faction });
        }
        state.fx?.burst(pos, 9, 0xc08a5a);
        break;
      }
      case 'play': {
        needs.energy = Math.max(0, needs.energy - 0.05);
        needs.cleanliness = Math.max(0, needs.cleanliness - 0.05);
        // Playing with a loose object means throwing it about.
        if (kind === 'prop' && target && !target.dead && !target.harvested) {
          target.vel.set((rand() - 0.5) * 26, 14 + rand() * 12, (rand() - 0.5) * 26);
          target.angVel.set((rand() - 0.5) * 6, (rand() - 0.5) * 6, (rand() - 0.5) * 6);
          state.props.wake(target);
        }
        state.fx?.burst(pos, 6, 0xd8d0b8);
        break;
      }
      case 'attack': {
        needs.energy = Math.max(0, needs.energy - 0.09);
        if (kind === 'villager' && target?.alive) {
          target.alive = false;
          state.events?.emit('villagers-killed',
            { count: 1, pos: pos.clone(), cause: 'creature', byPlayer: isHuman, by: faction });
        }
        if (kind === 'building' && target) {
          state.town?.demolish?.(target);
          state.events?.emit('building-destroyed',
            { building: target, pos: pos.clone(), cause: 'creature', byPlayer: isHuman, by: faction });
        }
        if (kind === 'prop' && target && !target.dead) {
          target.vel.set((rand() - 0.5) * 40, 18, (rand() - 0.5) * 40);
          state.props.wake(target);
        }
        state.fx?.burst(pos, 16, 0xb85a3a);
        break;
      }
      case 'help': {
        needs.energy = Math.max(0, needs.energy - 0.04);
        // Hauling a real node: tear it down, shoulder the load, and set off for
        // the stockpile. The delivery is a second leg of the same action rather
        // than a new decision, so it cannot be distracted halfway home.
        if (kind === 'prop' && target && !target.dead && !target.harvested) {
          const res = target.resource;
          const amount = res === 'wood' ? CREATURE.HAUL_WOOD : CREATURE.HAUL_ORE;
          target.claimedBy = null;
          state.props.harvest(target);
          carrying = { type: res, amount };

          const drop = dropOffPoint();
          if (drop) {
            state.fx?.burst(pos, 10, res === 'wood' ? 0x6f8f4a : 0x9a948c);
            say(`carrying ${amount} ${res} home`);
            action = {
              desire: 'help', target: null, targetType, kind: 'self',
              // Copied, not referenced: the gate fallback is a shared holder
              // that the next caller overwrites.
              phase: 'deliver', dest: { x: drop.x, y: drop.y ?? 0, z: drop.z }, timer: 0
            };
            lastAction = { desire: 'help', targetType };
            lastActionAge = 0;
            return; // stay on this action; the walk home is still to come
          }
        }
        state.fx?.burst(pos, 8, 0x9be08a);
        break;
      }
      case 'impress': {
        needs.energy = Math.max(0, needs.energy - 0.06);
        state.fx?.burst(pos, 14, 0xffe9b8);
        // AWE, AND THE FIRST TIME `impress` HAS PAID ANYTHING.
        //
        // The desire has been in the table since Phase 3 and did nothing but
        // burn energy and throw sparkles, which meant no player ever had a
        // reason to teach it and no god had a reason to want it. A creature
        // putting on a show in somebody else's streets is a wonder they can
        // see, and it buys their goodwill exactly like a miracle cast in front
        // of them - the same meter, the same capture at 1.
        //
        // `townsWatching` excludes this god's own towns, so it cannot be farmed
        // at home. It has to be done where it is dangerous.
        for (const t of state.town?.townsWatching?.(pos.x, pos.z, faction) ?? []) {
          state.town.addImpressiveness(t, TOWN.IMPRESS_PER_DANCE, 'creature', faction);
        }
        break;
      }
      case 'groom': {
        needs.cleanliness = Math.min(1, needs.cleanliness + CREATURE.GROOM_RESTORE);
        break;
      }
    }

    // This is what a slap or stroke in the next few seconds will refer to.
    lastAction = { desire, targetType };
    lastActionAge = 0;
    action = null;
  }

  // =========================================================================
  // SIMULATION
  // =========================================================================
  const _dir = new THREE.Vector3();

  /**
   * One tick of walking toward a point, stopping stopAt short of it.
   * Returns true once it is there. Refuses to walk into the sea.
   */
  function walkToward(gx, gz, stopAt, dt) {
    _dir.set(gx - pos.x, 0, gz - pos.z);
    const dist = _dir.length();
    if (dist <= stopAt) { speed = 0; return true; }
    _dir.multiplyScalar(1 / dist);
    const step = Math.min(dist - stopAt, CREATURE.MOVE_SPEED * temper.speed * dt);
    const nx = pos.x + _dir.x * step;
    const nz = pos.z + _dir.z * step;
    const h = terrain.heightAt(nx, nz);
    if (h > -0.6) {
      // A castle stops the beast too. It is the largest thing on the island and
      // walking through a keep was the most visible place the missing collision
      // showed. `scale` widens the circle, so a grown creature keeps its bulk
      // outside the wall instead of burying half of itself in it.
      const solid = state.town.pushOutOfCentres(nx, nz, scale * CREATURE.BODY_RADIUS);
      if (solid.hit) {
        // BLOCKED, AND NOT GETTING ANY CLOSER means it has arrived as near as
        // it ever will. Without this the creature grinds against the wall for
        // the rest of the game: it is told to hold 12 from a war front, its own
        // bulk keeps it 14 out, and the distance test never passes - so it
        // steps, is pushed back, steps again, and stands there vibrating.
        const was = Math.hypot(pos.x - gx, pos.z - gz);
        const now = Math.hypot(solid.x - gx, solid.z - gz);
        if (now >= was - 1e-3) { speed = 0; return true; }
      }
      pos.set(solid.x, solid.hit ? terrain.heightAt(solid.x, solid.z) : h, solid.z);
      speed = step / dt;
      walkPhase += step * 0.55;
    } else {
      speed = 0; // the shoreline turns it back rather than drowning it
    }
    let dyd = Math.atan2(_dir.x, _dir.z) - yaw;
    while (dyd > Math.PI) dyd -= Math.PI * 2;
    while (dyd < -Math.PI) dyd += Math.PI * 2;
    yaw += dyd * Math.min(1, CREATURE.TURN_SPEED * dt);
    return false;
  }

  function simStep(dt) {
    age += dt;
    lastActionAge += dt;

    // --- needs ---
    needs.hunger = Math.min(1, needs.hunger + CREATURE.HUNGER_RATE * temper.hunger * dt);
    needs.cleanliness = Math.max(0, needs.cleanliness - CREATURE.DIRT_RATE * dt);
    if (action?.desire === 'sleep' && action.phase === 'act') {
      needs.energy = Math.min(1, needs.energy + CREATURE.SLEEP_RESTORE * dt);
    } else {
      needs.energy = Math.max(0, needs.energy - CREATURE.ENERGY_RATE * dt);
    }

    // --- growth: half from age, half from food ---
    const t = Math.min(1,
      0.5 * (age / CREATURE.MATURE_AGE) + 0.5 * (mealsEaten / CREATURE.FOOD_TO_MATURE));
    scale = CREATURE.START_SCALE + t * (CREATURE.MAX_SCALE - CREATURE.START_SCALE);

    // --- summons: walk back inside the circle before anything else ---
    //
    // A DIRECT ORDER OUTRANKS THE WAR. This used to be gated behind `!atWar()`,
    // which meant that once a war front existed the creature ignored every
    // movement command you gave it - and since razing a rival's town does not
    // by itself end the front, it would park in the ruins of the castle and
    // stay there, deaf, forever.
    //
    // combat.js's own comment on warFront says you call the creature off "by
    // sending it somewhere else". That was never true while this gate stood.
    // It is now: you say go, it goes. Once it arrives it is inside its circle,
    // `strayDistance` is 0, this branch stops firing, and war takes over again
    // - so ordering it INTO a rival's streets still starts a fight, which is
    // the behaviour the leash was built for.
    if (summons && strayDistance() > CREATURE.SUMMON_SLACK) {
      if (action?.kind !== 'summoned') {
        clearClaim();
        action = {
          desire: 'help', target: null, targetType: null,
          kind: 'summoned', phase: 'summoned'
        };
      }
      decideTimer = CREATURE.DECIDE_INTERVAL;
    } else if (action?.kind === 'summoned') {
      action = null;
    }

    // --- war: an order outranks the utility AI, and a SUMMONS outranks the war ---
    if (atWar() && action?.kind !== 'summoned') {
      if (action && action.kind !== 'war') abandonAction('called to the banner');
      if (!action) {
        action = { desire: 'attack', target: null, targetType: null, kind: 'war', phase: 'war' };
        swingTimer = 0;
        say('to the banner');
      }
    } else {
      // Out of the fight it binds its wounds, which is also what runs down the
      // rout timer - it comes back at full health or not at all. Unless another
      // god's beast is standing over it: see CREATURE.HEAL_BLOCK_RANGE.
      if (!beastNear()) {
        health = Math.min(CREATURE.WAR_HEALTH, health + CREATURE.WAR_REGEN * dt);
      }
      if (action?.kind === 'war') {
        action = null;
        if (withdrawn) {
          say('falling back to lick my wounds');
          state.ui?.toast('Your creature falls back to heal');
        } else {
          say('the banner is home; standing down');
        }
      }
      // Hurt: get clear of the fighting instead of resuming ordinary life in
      // the middle of it, which is how it used to wander back into the swords
      // that had just driven it off.
      //
      // ...but only if there is a retreat to make. `withdrawn` is sticky
      // between WAR_WITHDRAW and WAR_REJOIN, so this branch fires every tick
      // for a long stretch, and for a god with no towns left `retreatSpot` has
      // nowhere to point. Recreating an action that then cannot move is how a
      // creature ends up standing in a field until the match ends: the retreat
      // is remade each tick, so the ordinary mind below never gets a turn.
      if (withdrawn && retreatSpot()) {
        if (action?.kind !== 'retreat') {
          clearClaim();
          action = {
            desire: 'sleep', target: null, targetType: null,
            kind: 'retreat', phase: 'retreat'
          };
        }
        decideTimer = CREATURE.DECIDE_INTERVAL;
      } else if (action?.kind === 'retreat') {
        action = null;
      }
    }

    // --- decide ---
    decideTimer -= dt;
    // Never reconsider a haul once it is under way, in either leg. A creature
    // that abandons a half-felled tree - or drops a full load of ore - because
    // something else looked interesting is worse than useless, and every
    // abandoned approach also stranded the node it had reserved.
    const hauling = action?.desire === 'help' && action?.kind !== 'villager'
      && (action?.phase === 'deliver'
          || (action?.target && !action.target.dead && !action.target.harvested));

    // Finish what you start.
    //
    // Only hauling was ever committed, so every OTHER action could be dropped
    // mid-swing by the next re-decision 1.1s later - the creature would arrive
    // at a tree, work at it for a moment, change its mind and wander off to the
    // next one. Once it has actually reached a thing and begun, it sees it
    // through; changing your mind belongs on the walk over, not with your teeth
    // already in something.
    const committed = action?.phase === 'act'
      && !(action.target && (action.target.dead || action.target.harvested
                             || action.target.alive === false));

    // `roam` is committed too, for the same reason a haul is: re-deciding every
    // 1.1s with an empty candidate list picks a NEW random bearing each time,
    // which is a drunkard's walk that covers no ground at all. It sees the walk
    // through, and arriving clears the action so the mind gets another look.
    if (hauling || committed || action?.kind === 'war' || action?.kind === 'roam') {
      decideTimer = CREATURE.DECIDE_INTERVAL;
    }
    else if (decideTimer <= 0 || !action) {
      decideTimer = CREATURE.DECIDE_INTERVAL;
      decide();
    }

    prev.copy(pos);
    prevYaw = yaw;

    // --- act ---
    if (!action) { speed = 0; return; }

    // --- carrying a load home ---
    if (action.phase === 'deliver') {
      const dest = action.dest;
      _dir.set(dest.x - pos.x, 0, dest.z - pos.z);
      const dist = _dir.length();
      if (dist <= CREATURE.ARRIVE_DIST + scale) {
        const home = homeTown();
        if (carrying && home) {
          // Into ITS OWN god's stockpile. `state.resources` is the player's
          // pool, so a rival's beast hauling a log across the island used to
          // put it on the player's books.
          home.resources[carrying.type] =
            (home.resources[carrying.type] ?? 0) + carrying.amount;
          // The same fact the hand emits when you set a log down in a village.
          // prayers.js decides whether anyone had asked for it; the creature
          // only reports what it did.
          {
            state.events?.emit('resource-offered', {
              type: carrying.type, pos: pos.clone(), town: home, by: 'creature'
            });
          }
          say(`delivered ${carrying.amount} ${carrying.type}`);
          state.fx?.burst(pos, 12, carrying.type === 'wood' ? 0x6f8f4a : 0x9a948c);
        }
        carrying = null;
        speed = 0;
        action = null;
        return;
      }
      _dir.multiplyScalar(1 / dist);
      const step = Math.min(dist, CREATURE.MOVE_SPEED * temper.speed * dt);
      const nx = pos.x + _dir.x * step;
      const nz = pos.z + _dir.z * step;
      if (terrain.heightAt(nx, nz) > -0.6) {
        const solid = state.town.pushOutOfCentres(nx, nz, scale * CREATURE.BODY_RADIUS);
        pos.set(solid.x, terrain.heightAt(solid.x, solid.z), solid.z);
      } else {
        // Cannot get home this way; drop the load rather than freeze.
        carrying = null;
        abandonAction('lost the load in the water');
        return;
      }
      speed = step / dt;
      walkPhase += step * 0.55;
      let dyd = Math.atan2(_dir.x, _dir.z) - yaw;
      while (dyd > Math.PI) dyd -= Math.PI * 2;
      while (dyd < -Math.PI) dyd += Math.PI * 2;
      yaw += dyd * Math.min(1, CREATURE.TURN_SPEED * dt);
      return;
    }

    // --- answering a summons ---
    if (action.phase === 'summoned') {
      if (!summons) { action = null; return; }
      walkToward(summons.pos.x, summons.pos.z, CREATURE.SUMMON_ARRIVE, dt);
      return;
    }

    // --- wandering, because there was nothing to do here ---
    if (action.phase === 'roam') {
      if (walkToward(action.dest.x, action.dest.z, CREATURE.ARRIVE_DIST, dt)) action = null;
      return;
    }

    // --- pulling back to heal ---
    if (action.phase === 'retreat') {
      const spot = retreatSpot();
      // Nowhere to go and nothing to run from: stop retreating rather than
      // stand still. `speed = 0` here was a creature frozen for the rest of the
      // game; clearing the action lets the ordinary mind take over on the very
      // next tick.
      if (!spot) { action = null; return; }
      walkToward(spot.x, spot.z, CREATURE.ARRIVE_DIST, dt);
      return;
    }

    // --- fighting under the banner ---
    if (action.phase === 'war') {
      swingTimer -= dt;
      const targets = warTargets();

      // Nearest, WEIGHTED by what is worth going for - see WAR_PRIORITY.
      // Straight nearest-first meant that in a town with two dozen civilians
      // milling about, the enemy monster was the last thing it got round to.
      let nearest = null;
      let bestScore = Infinity;
      for (const t of targets) {
        const score = Math.sqrt(t.d2) * (CREATURE.WAR_PRIORITY[t.kind] ?? 1);
        if (score < bestScore) { bestScore = score; nearest = t; }
      }

      // The nearest enemy says where to stand; the flag says where to be when
      // there is nothing left to fight. That is what makes it move with the
      // banner rather than just fight near it.
      // Off the leash entirely: get back to the flag before doing anything else.
      const front = state.combat.frontFor(faction);
      if (front) {
        const d2 = (pos.x - front.x) ** 2 + (pos.z - front.z) ** 2;
        if (d2 > CREATURE.WAR_LEASH ** 2) {
          walkToward(front.x, front.z, CREATURE.WAR_HOLD, dt);
          return;
        }
      }

      if (nearest) {
        walkToward(nearest.pos.x, nearest.pos.z, CREATURE.WAR_RANGE * 0.6, dt);
        if (nearest.d2 <= CREATURE.WAR_RANGE ** 2 && swingTimer <= 0) {
          swingTimer = CREATURE.WAR_INTERVAL;
          swipe(targets);
        }
      } else if (front) {
        walkToward(front.x, front.z, CREATURE.WAR_HOLD, dt);
      } else {
        speed = 0;
      }
      return;
    }

    if (action.phase === 'approach') {
      const tp = targetPos();
      // The target can be eaten, thrown into the sea, or demolished mid-walk.
      if (!tp || action.target?.dead || action.target?.harvested || action.target?.alive === false) {
        abandonAction(`lost the ${action.targetType}`);
        return;
      }
      _dir.set(tp.x - pos.x, 0, tp.z - pos.z);
      const dist = _dir.length();
      if (dist <= CREATURE.ARRIVE_DIST + scale) {
        action.phase = 'act';
        action.timer = CREATURE.ACT_TIME;
      } else {
        _dir.multiplyScalar(1 / dist);
        const step = Math.min(dist, CREATURE.MOVE_SPEED * temper.speed * dt);
        const nx = pos.x + _dir.x * step;
        const nz = pos.z + _dir.z * step;
        // It will wade a little but not swim.
        if (terrain.heightAt(nx, nz) > -0.6) {
          const solid = state.town.pushOutOfCentres(nx, nz, scale * CREATURE.BODY_RADIUS);
          // BLOCKED AND GETTING NO CLOSER. `walkToward` has had this guard for
          // phases since a creature was found grinding on a war front; the
          // approach walk is a second, older copy of the same loop and never
          // got one. Unlike a war front there is nothing to wait for here, so
          // it gives the thing up rather than standing at the wall.
          if (solid.hit
              && Math.hypot(solid.x - tp.x, solid.z - tp.z)
                 >= Math.hypot(pos.x - tp.x, pos.z - tp.z) - 1e-3) {
            abandonAction(`cannot reach the ${action.targetType}`);
            return;
          }
          pos.set(solid.x, terrain.heightAt(solid.x, solid.z), solid.z);
        } else {
          abandonAction('will not go into deep water');
          return;
        }
        speed = step / dt;
        walkPhase += step * 0.55;

        let dy = Math.atan2(_dir.x, _dir.z) - yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        yaw += dy * Math.min(1, CREATURE.TURN_SPEED * dt);
        return;
      }
    }

    speed = 0;
    action.timer -= dt;
    // The creature wears a node down as it works too - hauling it home or
    // eating it, the tree should look like it is being taken apart either way.
    // Only WORK wears a node down. Applying this to every prop action meant
    // `play` shrank a tree exactly as if it were being felled - and a play
    // action ends by hurling the thing across the field, so it read as the
    // creature mining three-quarters of a tree and then throwing it away.
    const working = action.desire === 'help' || action.desire === 'eat';
    if (working && action.kind === 'prop' && action.target) {
      const total = action.desire === 'help'
        ? CREATURE.HAUL_GATHER_TIME : CREATURE.ACT_TIME;
      state.props.setWear(action.target, 1 - action.timer / total);
    }
    if (action.timer <= 0) completeAction();
  }

  // =========================================================================
  // PETTING - the player's slap / stroke input
  // =========================================================================
  const raycaster = new THREE.Raycaster();
  let hovering = false;
  /**
   * Owned here rather than read back off input.capturedBy. The input layer
   * clears the capture inside its own pointerup handler, so by the time this
   * runs on the next frame the capture is already gone and a release would
   * never be recognised - strokes silently did nothing.
   */
  let petting = false;
  let pettingTime = 0;
  let slappedThisHold = false;
  let strokedThisHold = false;
  let warnedNoDeed = false;
  /** Smoothed cursor speed, px/s. Raw per-frame speed is far too spiky to gate on. */
  let speedEma = 0;
  /** Seconds spent continuously above the slap threshold. */
  let fastTime = 0;
  /** Slow travel accumulated across the creature, in px; emits a stroke at STROKE_DISTANCE. */
  let strokeDistance = 0;
  let feedback = 0; // >0 stroke flash, <0 slap flash

  function praise() {
    const learned = reinforce(+1);
    if (!learned && warnedNoDeed) return;
    if (!learned) warnedNoDeed = true;
    playClip('gesture-positive', { once: true, fade: 0.08 });
    reactionUntil = state.time + CREATURE.REACTION_TIME;
    feedback = 1;
    state.fx?.burst(pos.clone().setY(pos.y + 2 * scale), 10, 0xa8f0b0);
    state.ui?.toast('Stroked');
  }

  function updatePetting(dt) {
    const input = state.input;
    raycaster.setFromCamera(input.ndc, state.camera.cam);
    const hits = raycaster.intersectObject(body.hit, false);
    hovering = hits.length > 0;

    if (input.pressed[0] && hovering && !state.town?.placing && !state.ui?.buildMenuOpen) {
      input.capture('creature');
      petting = true;
      pettingTime = 0;
      slappedThisHold = false;
      strokedThisHold = false;
      warnedNoDeed = false;
      speedEma = 0;
      fastTime = 0;
      strokeDistance = 0;
    }

    if (petting && input.buttons[0]) {
      // Skip the frame the press landed on. Its delta covers the cursor travel
      // that brought the pointer onto the creature in the first place, so
      // "move the mouse over, then click" would read as a whip and slap a
      // creature you meant to pat.
      const justPressed = input.pressed[0];
      pettingTime += dt;

      const travel = justPressed ? 0 : Math.hypot(input.delta.x, input.delta.y);
      const rawSpeed = travel / Math.max(dt, 1e-4);

      // Smooth before deciding. A raw per-frame speed spikes hard on any single
      // jittery sample, and gating a slap on one spiky frame meant ordinary
      // petting motion kept registering as violence.
      const k = 1 - Math.exp(-dt / CREATURE.SPEED_SMOOTH);
      speedEma += (rawSpeed - speedEma) * k;

      // --- slap: a sustained fast movement, not one quick frame ---
      if (speedEma > CREATURE.SLAP_SPEED) fastTime += dt;
      else fastTime = 0;

      if (!slappedThisHold && fastTime >= CREATURE.SLAP_SUSTAIN) {
        slappedThisHold = true;
        strokeDistance = 0;
        reinforce(-1);
        playClip('gesture-negative', { once: true, fade: 0.08 });
        reactionUntil = state.time + CREATURE.REACTION_TIME;
        feedback = -1;
        state.fx?.burst(pos.clone().setY(pos.y + 2 * scale), 14, 0xff8a6a);
        state.ui?.toast('Slapped');
      }

      // --- stroke: accumulate unhurried travel across the creature ---
      // Emitted repeatedly during the hold rather than once on release, so
      // petting back and forth feels continuous instead of dead until you let go.
      if (!slappedThisHold && speedEma < CREATURE.STROKE_MAX_SPEED) {
        strokeDistance += travel;
        if (strokeDistance >= CREATURE.STROKE_DISTANCE) {
          strokeDistance = 0;
          strokedThisHold = true;
          praise();
        }
      }
    }

    if (petting && (input.released[0] || !input.buttons[0])) {
      // A quiet hold with no real movement still counts as a gentle pat.
      if (!slappedThisHold && !strokedThisHold && pettingTime > CREATURE.STROKE_MIN_TIME) {
        praise();
      }
      petting = false;
      if (input.capturedBy === 'creature') input.capturedBy = null;
    }

    if (feedback !== 0) {
      feedback *= Math.exp(-3 * dt);
      if (Math.abs(feedback) < 0.02) feedback = 0;
    }
  }

  // =========================================================================
  // RENDER
  // =========================================================================
  /**
   * The leash is a TUBE, not a line.
   *
   * `THREE.LineBasicMaterial` ignores linewidth on every Windows driver, so the
   * most characterful object in the game was drawn as a one-pixel thread that
   * vanished against pale ground. A tube is a few hundred triangles and reads
   * as a rope.
   *
   * The curve is reused and its points rewritten each frame; only the tube's
   * position attribute is recomputed, so nothing is allocated per frame.
   */
  /** Control points along the leash. Enough for a smooth sag, no more. */
  const LEASH_POINTS = 14;
  const leashCurve = new THREE.CatmullRomCurve3(
    Array.from({ length: LEASH_POINTS }, () => new THREE.Vector3())
  );
  const LEASH_SEGS = 24;
  const LEASH_RADIAL = 5;
  const LEASH_RADIUS = 0.16;
  const leashGeo = new THREE.TubeGeometry(
    leashCurve, LEASH_SEGS, LEASH_RADIUS, LEASH_RADIAL, false);
  const leashMat = new THREE.MeshStandardMaterial({
    transparent: true, opacity: 0.9, roughness: 0.85, metalness: 0
  });
  const leashLine = new THREE.Mesh(leashGeo, leashMat);
  leashLine.frustumCulled = false;
  state.scene.add(leashLine);

  const _rp = new THREE.Vector3();
  const _leashP = new THREE.Vector3();
  const _leashT = new THREE.Vector3();
  const _leashN = new THREE.Vector3();
  const _leashB = new THREE.Vector3();

  // --- right-drag to command ------------------------------------------------
  const _ray = new THREE.Raycaster();
  const _pt = new THREE.Vector3();
  let dragFrom = null;

  /** Terrain point under the cursor, or null. */
  function groundUnderCursor() {
    _ray.setFromCamera(state.input.ndc, state.camera.cam);
    const hits = _ray.intersectObject(terrain.mesh, false);
    return hits.length ? _pt.copy(hits[0].point) : null;
  }

  function updateCommand() {
    const input = state.input;
    const blocked = state.town?.placing || state.ui?.buildMenuOpen
      || state.ui?.zooOpen || state.miracles?.casting || state.sculpt?.active;

    // Both buttons together is a camera orbit, not an order.
    if (input.buttons[0] && input.buttons[2]) { dragFrom = null; return; }

    if (input.pressed[2] && !blocked && !input.buttons[0]) {
      // Right-clicking the creature itself dismisses the order - the natural
      // inverse of pointing at the ground, and it needs no key to remember.
      if (hovering) { dismiss(); dragFrom = null; return; }
      const g = groundUnderCursor();
      if (g) { dragFrom = g.clone(); input.capture('creature-cmd'); }
      return;
    }

    // Commit on the RELEASE EDGE, not on "the button is no longer down".
    // The held state reads false for a frame here and there, so testing it
    // committed the order on the press instead - every drag collapsed to the
    // minimum radius because no distance had been travelled yet.
    if (dragFrom && input.released[2]) {
      const g = groundUnderCursor();
      const r = g ? Math.hypot(g.x - dragFrom.x, g.z - dragFrom.z) : 0;
      summon(dragFrom.x, dragFrom.z, r);
      dragFrom = null;
      if (input.capturedBy === 'creature-cmd') input.capturedBy = null;
      return;
    }

    if (dragFrom) {
      const g = groundUnderCursor();
      const r = g ? Math.hypot(g.x - dragFrom.x, g.z - dragFrom.z) : 0;
      // Live preview: amber while dragging, so it reads as pending.
      placeRing(dragFrom,
        clamp(r, CREATURE.SUMMON_MIN_RADIUS, CREATURE.SUMMON_MAX_RADIUS),
        0xffe9b8, 0.75);
    }
  }

  function update(dt, alpha) {
    // The animal is fetched asynchronously; nothing to draw or pet until it lands.
    if (!body) return;

    // EVERYTHING A HAND DOES is the player's alone: petting, the right-drag
    // summons, the ring that shows where it was told to be, and the leash line
    // drawn back to the hand. A rival's god commands through rivalgods.js and
    // has no cursor, so a rival's creature must never read the mouse - left in,
    // four animals would all be petted by one hover and all captured the same
    // click.
    if (isHuman) {
      updatePetting(dt);
      updateCommand();

      // The standing order, when not being dragged out. Blue for a plain
      // summons, and it simply is not drawn while at war - the banner is the
      // order then, and two rings competing for one meaning is worse than none.
      if (!dragFrom) {
        if (summons && !atWar()) {
          placeRing(summons.pos, summons.radius, 0x8fd8ff, 0.45);
        } else {
          ring.visible = false;
        }
      }
    }

    // --- interpolate the sim pose ---
    _rp.lerpVectors(prev, pos, alpha);
    let ry = prevYaw;
    let dy = yaw - prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    ry += dy * alpha;

    group.position.copy(_rp);
    group.rotation.y = ry;
    group.scale.setScalar(scale);

    body.mixer.update(dt);

    // --- which clip? ---------------------------------------------------------
    // One decision point, ordered by precedence: a reaction to being touched
    // beats what it is doing, which beats standing around.
    const now = state.time;
    if (now >= reactionUntil) {
      const acting = action?.phase === 'act';
      if (now < devourUntil) playClip('eat');
      else if (action?.phase === 'war' && now < swingUntil) playClip('run');
      else if (acting && action.desire === 'eat') playClip('eat');
      else if (acting && action.desire === 'sleep') playClip('idle', { speed: 0.35 });
      else if (acting && action.desire === 'impress') playClip('dance');
      else if (acting && action.desire === 'attack') playClip('run');
      else if (speed > 0.1) playClip(speed > CREATURE.RUN_SPEED ? 'run' : 'walk');
      else playClip('idle');
    }

    // Dirt darkens the hide, alignment recolours it, and a slap or stroke
    // flashes it. All three multiply the model's own palette rather than
    // replacing it, so the animal still looks like itself.
    //
    // `state.alignment` IS THE PLAYER'S SOUL and there is exactly one of it.
    // A rival's beast is not tinted by the human's morals - it wears its god's
    // banner instead, which is also the only thing on the field that says at a
    // glance whose monster is coming over the hill.
    const dirt = 1 - needs.cleanliness;
    const al = isHuman ? (state.alignment ?? 0) : 0;
    let r, g, b;
    if (feedback > 0) { r = 0.75 + feedback * 0.3; g = 1.0; b = 0.75 + feedback * 0.2; }
    else if (feedback < 0) { r = 1.0; g = 0.6 + feedback * 0.3; b = 0.55 + feedback * 0.3; }
    else {
      const evil = Math.max(0, -al);
      const good = Math.max(0, al);
      r = (1 - dirt * 0.42) * (1 - evil * 0.05) * (1 + good * 0.10);
      g = (1 - dirt * 0.46) * (1 - evil * 0.35) * (1 + good * 0.08);
      b = (1 - dirt * 0.50) * (1 - evil * 0.45) * (1 + good * 0.02);
      if (!isHuman) {
        // Toward the banner, not replaced by it: a lion tinted flat red stops
        // being a lion. Same restraint as the building tint's TINT_MIX.
        _banner.setHex(state.factions?.[faction]?.colour ?? 0xffffff);
        const k = RIVAL_GOD.BANNER_TINT;
        r = r * (1 - k) + _banner.r * k;
        g = g * (1 - k) + _banner.g * k;
        b = b * (1 - k) + _banner.b * k;
      }
    }
    for (const m of body.materials) {
      m.color.setRGB(r, g, b);
      if (m.emissive) m.emissive.setRGB(Math.max(0, -al) * 0.22, 0, 0);
    }

    // Show the load on its back while hauling.
    if (body.load) {
      body.load.visible = !!carrying;
      if (carrying) {
        body.load.position.set(0, body.height * 0.72, -body.height * 0.16);
        body.load.scale.setScalar(body.height * 0.34);
        body.load.material.color.set(carrying.type === 'wood' ? 0x6f8f4a : 0x9a948c);
      }
    }

    // --- leash ---
    // The leash is a line drawn from the HAND, and only one god has one.
    const showLeash = isHuman && leash !== 'free' && state.hand;
    leashLine.visible = showLeash;
    if (showLeash) {
      leashMat.color.set(LEASH_MODES[leash].color);
      const a = state.hand.position;
      const b = _rp.clone().setY(_rp.y + body.height * 0.7 * scale);
      const sag = Math.min(6, a.distanceTo(b) * 0.18);
      for (let i = 0; i < LEASH_POINTS; i++) {
        const u = i / (LEASH_POINTS - 1);
        leashCurve.points[i].set(
          a.x + (b.x - a.x) * u,
          a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * sag,
          a.z + (b.z - a.z) * u
        );
      }
      // Rewrite the tube in place along the new curve.
      //
      // Frames are built inline from a fixed world up rather than with
      // computeFrenetFrames - which lives on Curve, not on the geometry, and
      // allocates three arrays every time it is called. A leash sags in a plane
      // and never loops, so a fixed reference vector is stable enough and costs
      // nothing per frame.
      const pos = leashGeo.attributes.position;
      const arr = pos.array;
      let w = 0;
      for (let si = 0; si <= LEASH_SEGS; si++) {
        const u = si / LEASH_SEGS;
        leashCurve.getPointAt(u, _leashP);
        leashCurve.getTangentAt(u, _leashT);
        // Normal perpendicular to the tangent, biased to world up; if the rope
        // is momentarily vertical, fall back to an arbitrary axis.
        _leashN.set(0, 1, 0).cross(_leashT);
        if (_leashN.lengthSq() < 1e-6) _leashN.set(1, 0, 0);
        _leashN.normalize();
        _leashB.copy(_leashT).cross(_leashN).normalize();
        for (let ri = 0; ri <= LEASH_RADIAL; ri++) {
          const a2 = (ri / LEASH_RADIAL) * Math.PI * 2;
          const sx = Math.cos(a2) * LEASH_RADIUS;
          const sy = Math.sin(a2) * LEASH_RADIUS;
          arr[w++] = _leashP.x + sx * _leashN.x + sy * _leashB.x;
          arr[w++] = _leashP.y + sx * _leashN.y + sy * _leashB.y;
          arr[w++] = _leashP.z + sx * _leashN.z + sy * _leashB.z;
        }
      }
      pos.needsUpdate = true;
      leashGeo.computeVertexNormals();
      leashGeo.computeBoundingSphere();
    }
  }

  // =========================================================================
  const api = {
    enabled: true,
    group,
    /** Which god this beast answers to. Fixed for life. See the top of the file. */
    faction,
    /** True only for the player's, which is the one with a hand behind it. */
    isHuman,
    /**
     * On a leash that forbids making war by being somewhere.
     *
     * Read by combat.js to tell a beast that has come to perform from one that
     * has come to raze. Deliberately a plain setting rather than `atWar`, which
     * is derived from the war front and would recurse - see nearestBeastIntruder.
     */
    get peaceful() { return !!LEASH_MODES[leash]?.peaceful; },
    /**
     * Still in the fight: alive, not routed, not withdrawn, not on a peaceful
     * leash.
     *
     * Deliberately built from THIS creature's own state only - no war front, no
     * other creature - so anyone may ask it about anyone without the recursion
     * `atWar` would cause.
     */
    get fighting() {
      if (health <= 0 || state.time < routedUntil) return false;
      if (LEASH_MODES[leash]?.peaceful) return false;
      return !withdrawn;
    },
    get ownerName() { return ownerName(); },
    /** The town it delivers to and retreats to; null for a god with no land. */
    get home() { return homeTown(); },
    get position() { return pos; },
    get scale() { return scale; },
    get age() { return age; },
    get lessons() { return lessons; },
    get hovering() { return hovering; },
    get animal() { return animal; },
    get animals() { return state.models.pets; },
    setAnimal,
    needs,
    desires,
    opinions,
    log,
    get leash() { return leash; },
    setLeash(mode) {
      if (!LEASH_MODES[mode]) return;
      leash = mode;
      say(`leash: ${LEASH_MODES[mode].label}`);
      if (isHuman) state.ui?.toast(LEASH_MODES[mode].label);
    },
    get action() { return action; },
    get lastAction() { return lastAction; },
    get carrying() { return carrying; },
    /** Seconds since the last judgeable deed; past 12 a slap has nothing to blame. */
    get lastActionAge() { return lastActionAge; },
    get curiosity() { return curiosity(); },
    /** The two traits of this species, as keys and as labels. */
    summon,
    dismiss,
    /** The in-progress right-drag origin, or null. Debug/HUD only. */
    get commandDrag() { return dragFrom; },
    /** The standing order: { pos, radius } or null. */
    get summons() { return summons; },
    get temperament() { return temperament.slice(); },
    get temperamentLabels() {
      return temperament.map((k) => CREATURE_TRAITS[k]?.label ?? k);
    },
    /** Traits it has grown into through play, and the deeds behind them. */
    get earned() { return earned.slice(); },
    get earnedLabels() { return earned.map((k) => EARNED_TRAITS[k]?.label ?? k); },
    get deeds() { return { ...deeds }; },

    // --- war ---
    get health() { return health; },
    get maxHealth() { return CREATURE.WAR_HEALTH; },
    /** True while it is answering an attack order. Both stats are doubled. */
    get atWar() { return atWar(); },
    get attack() { return attackPower(); },
    get defense() { return defensePower(); },
    /** Seconds left sulking at home after a rout, or 0. */
    get routedFor() { return Math.max(0, routedUntil - state.time); },
    /**
     * Take a hit. The attacker passes raw damage and the creature applies its
     * own defense, so nothing outside here needs to know about the war
     * multiplier.
     */
    /** False while routed: it has quit the field and cannot be fought. */
    get inField() { return health > 0 && state.time >= routedUntil; },
    takeDamage(amount, from = 'soldier') {
      // Being routed means being GONE, not merely on zero. Left targetable, it
      // was cut down again the instant regeneration ticked it off the floor.
      if (health <= 0 || state.time < routedUntil) return;
      // Stamped BEFORE the damage is applied, so `defensePower` below already
      // sees this creature as being in a fight. Stamped after, the very first
      // blow of every ambush landed at undoubled defense.
      lastHitAt = state.time;
      health -= amount / defensePower();

      // Pain is a teacher too, banked into lumps so that one fight does not
      // bury every other lesson under a thousand tiny ones.
      painSince += amount;
      if (painSince >= CREATURE.PAIN_PER_LESSON) {
        painSince = 0;
        selfTeach(from, 'threat', 1, CREATURE.PAIN_TEACH_BASE);
      }

      if (health <= 0) rout();
    },
    witness,
    reinforce,
    /** Offer food directly - used when the player throws something edible at it. */
    feed(type) {
      needs.hunger = Math.max(0, needs.hunger - CREATURE.EAT_RESTORE * temper.eat);
      mealsEaten++;
      const o = opinionFor(type);
      const r = rateFor(CREATURE.LEARN_OPINION_BASE, o.reps.edibility);
      o.edibility = clamp(o.edibility + r, -1, 1);
      o.reps.edibility++;
      lessons++;
      say(`you fed me a ${type}; edibility -> ${o.edibility.toFixed(2)}`);
    },
    simStep,
    update
  };
  // `state.creature` still means THE PLAYER'S, because roughly thirty call
  // sites across the UI, the hand, the miracles and the achievements mean
  // exactly that when they say it, and every one of them is still right.
  if (isHuman) state.creature = api;
  state.creatures.push(api);
  return api;
}
