// dev.js - the /dev panel: cheats, for testing the game without playing it.
//
// WHY IT IS ITS OWN FILE. Everything in here reaches past a system's front door
// and sets things the game would normally have to earn. That is exactly what a
// cheat is, and it is also exactly the kind of code that rots a module if it is
// left lying among the real rules - six months on nobody can tell which lines
// are the game and which are the scaffolding. Kept apart, the whole feature is
// one import and one file, and deleting it can never break anything else.
//
// It reads `state` and calls other systems' PUBLIC api only, same as any other
// system. The two exceptions are `creature.devGrow` and `devHeal`, which are
// named for what they are and which set the sim's inputs rather than its
// derived values - see the note over them in creature.js.
//
// BACKQUOTE opens it, which is the key every game with a console has used for
// thirty years. The panel calls itself /dev because that is what it was asked
// for, and the title is the only place a name like that can live in a game with
// no command line to type it into.

import { endGame, MIRACLE, COMBAT, BLESSING } from './state.js';

/**
 * ONE CHEAT.
 *
 * `run` returns the line to report. Returning a string rather than toasting
 * from inside means every cheat is a plain function of the world, and the panel
 * owns how it is announced - so a cheat that turns out to have done nothing
 * says so instead of silently appearing to work.
 */
function groups(state) {
  const me = () => state.creature;
  const mine = () => state.town.towns.filter((t) => t.owner === 0);
  const rivals = () => state.town.towns.filter((t) => t.owner !== 0);

  return [
    {
      name: 'Belief and food',
      cheats: [
        { label: '+500 belief', run: () => {
          state.resources.belief = Math.min(MIRACLE.MAX_BELIEF, state.resources.belief + 500);
          return `belief ${Math.round(state.resources.belief)}`;
        } },
        { label: 'Belief to the brim', run: () => {
          state.resources.belief = MIRACLE.MAX_BELIEF;
          return `belief ${MIRACLE.MAX_BELIEF}`;
        } },
        { label: '+500 food', run: () => {
          state.resources.food += 500;
          return `food ${Math.round(state.resources.food)}`;
        } },
        { label: '+20 wood, +20 ore', run: () => {
          state.resources.wood += 20; state.resources.ore += 20;
          return `wood ${Math.round(state.resources.wood)}, ore ${Math.round(state.resources.ore)}`;
        } }
      ]
    },
    {
      name: 'Your beast',
      cheats: [
        { label: 'Grow to full size', run: () => {
          if (!me()) return 'no creature';
          me().devGrow(1);
          return 'fully grown';
        } },
        { label: 'Heal and feed', run: () => {
          if (!me()) return 'no creature';
          me().devHeal();
          return 'whole again';
        } },
        { label: 'Free blessing', run: () => {
          const c = me();
          if (!c) return 'no creature';
          // Paid for out of the panel's pocket: top the belief up first, then
          // cast the real thing, so the roll, the cooldown, the HUD row and the
          // sound are all the ones the player would actually get.
          const held = state.resources.belief;
          state.resources.belief = Math.max(held, BLESSING.COST);
          c.devReadyBless();
          const r = c.bless();
          state.resources.belief = held;
          return r.ok ? `${r.tier.label} - ${r.mult.toFixed(1)}x` : r.reason;
        } },
        { label: 'Kill rival beasts', run: () => {
          let n = 0;
          for (const c of state.creatures) {
            if (c.isHuman || c.health <= 0) continue;
            c.takeDamage(9999, 'creature');
            n++;
          }
          return n ? `${n} driven off` : 'none standing';
        } }
      ]
    },
    {
      name: 'War',
      cheats: [
        { label: 'Breach every rival wall', run: () => {
          let n = 0;
          for (const t of rivals()) {
            if (t.breached) continue;
            t.wallHp = 0; t.breached = true;
            state.fx?.burst(t.centre, 30, 0xb08d63);
            n++;
          }
          return n ? `${n} walls down` : 'all already breached';
        } },
        { label: 'Mend my walls', run: () => {
          for (const t of mine()) { t.wallHp = COMBAT.WALL_HP; t.breached = false; }
          return `${mine().length} walls whole`;
        } },
        { label: 'Level the nearest rival town', run: () => {
          const c = me()?.position ?? state.town.playerTown.centre;
          let best = null, bd = Infinity;
          for (const t of rivals()) {
            const d = Math.hypot(t.centre.x - c.x, t.centre.z - c.z);
            if (d < bd) { bd = d; best = t; }
          }
          if (!best) return 'no rivals left';
          const doomed = state.town.allBuildings.filter((b) => b.town === best);
          for (const b of doomed) {
            state.town.demolish(b);
            state.events?.emit('building-destroyed',
              { building: b, pos: b.pos, cause: 'cheat', byPlayer: true, by: 0 });
          }
          return `${best.name}: ${doomed.length} levelled`;
        } },
        { label: 'Muster 10 soldiers', run: () => {
          const town = state.town.playerTown;
          let n = 0;
          for (let i = 0; i < 10; i++) if (state.combat.spawnSoldier(town, town.centre, 0)) n++;
          return n < 10 ? `${n} mustered (at the cap)` : '10 mustered';
        } }
      ]
    },
    {
      name: 'Your people',
      cheats: [
        { label: '+10 villagers', run: () => {
          const t = state.town.playerTown;
          let n = 0;
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 8 + Math.random() * 14;
            if (state.villagers.spawn(t.centre.x + Math.cos(a) * d,
              t.centre.z + Math.sin(a) * d, t)) n++;
          }
          return n ? `${n} born` : 'at the cap';
        } },
        // Through the real `shiftAlignment`, which clamps to +/-1 and runs the
        // redemption curve - writing `state.alignment` directly would be undone
        // within a second by the smoothing, which eases toward a private target
        // this panel has no business setting behind miracles.js's back.
        { label: 'Alignment: saintly', run: () => {
          state.miracles.shiftAlignment(2, '/dev');
          return `alignment ${state.miracles.alignmentTarget.toFixed(2)}`;
        } },
        { label: 'Alignment: monstrous', run: () => {
          state.miracles.shiftAlignment(-2, '/dev');
          return `alignment ${state.miracles.alignmentTarget.toFixed(2)}`;
        } }
      ]
    },
    {
      name: 'Time and endings',
      cheats: [
        // The one cheat that is genuinely slow, so it says how long it took.
        { label: 'Skip 1 minute', run: () => runAhead(state, 60) },
        { label: 'Skip 5 minutes', run: () => runAhead(state, 300) },
        { label: 'Force a victory', run: () =>
          endGame(state, 'victory', 'the /dev panel said so') ? 'victory' : 'already over' },
        { label: 'Force a defeat', run: () =>
          endGame(state, 'defeat', 'the /dev panel said so') ? 'defeat' : 'already over' }
      ]
    }
  ];
}

/**
 * Run the world forward without drawing it.
 *
 * Straight through `state.simStep`, the same function the frame loop calls, so
 * a skipped minute is a real minute of world and not an approximation of one.
 * It blocks the tab while it runs - a minute is about 1200 steps and lands well
 * inside a frame budget nobody is watching, and five minutes is a visible pause
 * that the panel warns about by reporting the wall-clock cost afterwards.
 */
function runAhead(state, seconds) {
  const t0 = performance.now();
  const dt = 1 / 20;                      // SIM_DT. The fixed step, not a guess.
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    if (state.outcome) return `the match ended ${i} steps in`;
    state.simStep(dt);
  }
  return `${seconds}s of world in ${Math.round(performance.now() - t0)}ms`;
}

export function initDev(state) {
  const host = document.getElementById('hud') ?? document.body;

  const style = document.createElement('style');
  style.textContent = `
#dev {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.97);
  width: min(760px, 92vw); max-height: 86vh; overflow: auto;
  background: rgba(12,14,20,0.95); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 10px; padding: 16px 18px 18px; pointer-events: auto;
  font: 12px/1.4 system-ui, sans-serif; color: #efe9dd;
  box-shadow: 0 24px 70px rgba(0,0,0,0.6);
  opacity: 0; visibility: hidden; transition: opacity 0.14s ease, transform 0.14s ease;
}
#dev.on { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); }
/* ONCE DRAGGED, THE PANEL OWNS ITS OWN POSITION. The centring transform has to
   go entirely - left/top and a -50% translate would fight each other and the
   panel would jump half its own size on the first grab. The open/close fade
   still works because that was never the transform's job. */
#dev.moved, #dev.moved.on { transform: none; }
#dev .bar {
  display: flex; align-items: baseline; gap: 10px; cursor: grab;
  margin: -4px -6px 10px; padding: 4px 6px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  /* The bar is a handle, so a drag must never select the words in it. */
  user-select: none; -webkit-user-select: none; touch-action: none;
}
#dev .bar:active { cursor: grabbing; }
#dev h3 {
  margin: 0; font-size: 15px; letter-spacing: 0.16em; color: #ff9d7a;
  font-weight: 600;
}
#dev .sub { margin: 0 0 0 auto; font-size: 11px; opacity: 0.45; }
#dev .grp { margin-bottom: 13px; }
#dev .grp h4 {
  margin: 0 0 6px; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase;
  opacity: 0.42; font-weight: 600;
}
#dev .row { display: flex; flex-wrap: wrap; gap: 6px; }
#dev button {
  font: inherit; font-size: 11px; color: #efe9dd; cursor: pointer;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.13);
  border-radius: 6px; padding: 6px 11px; transition: background 0.12s, border-color 0.12s;
}
#dev button:hover { background: rgba(255,157,122,0.18); border-color: #ff9d7a; }
#dev button:active { transform: translateY(1px); }
/* The last thing a cheat did. It is the only feedback the panel gives, so it
   never collapses - an empty line that stays put reads better than a row of
   buttons that jumps every time one is pressed. */
#dev .said {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);
  font-size: 11px; min-height: 15px; color: #ffe9b8;
}
#dev .said b { color: #ff9d7a; font-weight: 600; }
`;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.id = 'dev';
  host.appendChild(el);

  const all = groups(state);
  el.innerHTML =
    `<div class="bar" id="dev-bar"><h3>/dev</h3>` +
    `<p class="sub">drag me &middot; \` opens and closes</p></div>` +
    all.map((g, gi) =>
      `<div class="grp"><h4>${g.name}</h4><div class="row">` +
      g.cheats.map((c, ci) => `<button data-g="${gi}" data-c="${ci}">${c.label}</button>`).join('') +
      `</div></div>`).join('') +
    `<div class="said" id="dev-said"></div>`;

  const said = el.querySelector('#dev-said');
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    const cheat = all[+b.dataset.g].cheats[+b.dataset.c];
    let line;
    try {
      line = cheat.run() ?? 'done';
    } catch (err) {
      // A cheat that throws must not take the HUD down with it. This panel
      // reaches into more of the game than anything else does, and it is the
      // one place where a half-built world is a normal thing to meet.
      line = `failed: ${err.message}`;
      console.warn('[dev]', cheat.label, err);
    }
    said.innerHTML = `<b>${cheat.label}</b> &mdash; ${line}`;
    state.ui?.toast?.(line);
  });

  // --- dragging -------------------------------------------------------------
  //
  // Pointer events with capture rather than listeners on the window: capture
  // means the panel keeps receiving moves even when the cursor outruns it, and
  // it means the release always arrives, so a drag can never get stuck on. The
  // game's own camera never sees any of it because the bar stops propagation -
  // dragging the panel across the island must not also pan the island.
  const bar = el.querySelector('#dev-bar');
  let drag = null;

  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const box = el.getBoundingClientRect();
    // First grab: freeze wherever the centring transform had put it, THEN
    // switch to left/top. Reading the box before adding the class is what makes
    // the panel stay exactly where it looked like it was.
    el.classList.add('moved');
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    drag = { dx: e.clientX - box.left, dy: e.clientY - box.top,
             w: box.width, h: box.height };
    bar.setPointerCapture(e.pointerId);
  });

  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.stopPropagation();
    // Kept on screen by its own edges. A panel dragged off the top has no bar
    // left to grab, which is the one way to lose it for good.
    const maxX = window.innerWidth - drag.w;
    const maxY = window.innerHeight - drag.h;
    el.style.left = `${Math.max(0, Math.min(maxX, e.clientX - drag.dx))}px`;
    el.style.top = `${Math.max(0, Math.min(maxY, e.clientY - drag.dy))}px`;
  });

  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    try { bar.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  // A window that shrinks under a panel parked at its right edge would put it
  // out of reach; nudge it back inside.
  window.addEventListener('resize', () => {
    if (!el.classList.contains('moved')) return;
    const box = el.getBoundingClientRect();
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - box.width, box.left))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - box.height, box.top))}px`;
  });

  let open = false;
  const api = {
    get open() { return open; },
    toggle() { open = !open; el.classList.toggle('on', open); },
    close() { open = false; el.classList.remove('on'); }
  };
  state.dev = api;
  return api;
}
