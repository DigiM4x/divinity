// ---------------------------------------------------------------------------
// reckoningui.js - the live scoreboard, and the screen at the end of the world.
//
// Rendering only, like prayermarks.js. It reads `state.reckoning` and decides
// nothing: if this module stopped running the scores would be identical, they
// would simply be invisible.
//
// Two surfaces:
//
//   TAB          a live panel - who is winning, by how much, and why
//   the ending   a full-screen Reckoning when the match is decided
//
// The final screen renders exclusively from `reckoning.final`, the immutable
// snapshot frozen at the bell. That is the whole reason the snapshot exists:
// "Continue Playing" lets the world carry on, and the results must go on
// describing the match rather than the sandbox that followed it.
//
// ONE delegated listener per root element, attached once at init. Opening and
// closing these screens never adds another - which is the bug the brief warns
// about and which this project has hit before.
//
// Publishes state.reckoningUi.
// ---------------------------------------------------------------------------
import * as CFG from './scoreconfig.js';

const CSS = `
#rk-live, #rk-final { position: fixed; inset: 0; pointer-events: none;
  font-family: inherit; z-index: 40; }
#rk-live { display: none; }
#rk-live.on { display: block; }

#rk-live .wrap { pointer-events: auto; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%); width: min(1020px, 94vw);
  max-height: 86vh; overflow: auto;
  background: rgba(14,18,26,0.94); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 10px; padding: 18px 20px 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6); color: #e8e6e1; }
#rk-live h3, #rk-final h3 { margin: 0; font-size: 15px; letter-spacing: 0.14em;
  text-transform: uppercase; font-weight: 600; }
#rk-live .sub { font-size: 11px; opacity: 0.55; margin: 4px 0 14px; }

.rk-row { display: grid; grid-template-columns: 34px 1fr auto;
  gap: 10px; align-items: center; padding: 9px 10px; border-radius: 7px;
  border: 1px solid transparent; cursor: pointer; margin-bottom: 5px;
  background: rgba(255,255,255,0.035); }
.rk-row:hover { background: rgba(120,170,220,0.14); }
.rk-row.sel { background: rgba(255,220,140,0.12); border-color: #ffe9b8; }
.rk-row.out { opacity: 0.45; }
.rk-rank { font-size: 17px; text-align: center; opacity: 0.75; font-variant-numeric: tabular-nums; }
.rk-name { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.rk-swatch { width: 11px; height: 11px; border-radius: 2px; flex: none;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }
.rk-tag { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
  opacity: 0.5; border: 1px solid currentColor; border-radius: 3px;
  padding: 0 4px; }
.rk-score { text-align: right; font-variant-numeric: tabular-nums; }
.rk-score b { font-size: 16px; }
.rk-gap { font-size: 10px; opacity: 0.5; display: block; }
.rk-trend { font-size: 10px; margin-left: 6px; }
.rk-up { color: #9be08a; } .rk-down { color: #ff9d8a; } .rk-flat { opacity: 0.4; }

.rk-cats { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px;
  margin: 12px 0 4px; }
.rk-cat { background: rgba(255,255,255,0.04); border-radius: 6px; padding: 8px 6px;
  text-align: center; }
.rk-cat .ic { font-size: 15px; opacity: 0.7; }
.rk-cat .lb { font-size: 9px; opacity: 0.5; letter-spacing: 0.04em;
  margin: 3px 0 2px; line-height: 1.15; height: 22px; }
.rk-cat .vl { font-size: 14px; font-variant-numeric: tabular-nums; }
.rk-cat.best { background: rgba(155,224,138,0.14); }
.rk-cat.worst { background: rgba(255,157,138,0.12); }
.rk-bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.12);
  margin-top: 5px; overflow: hidden; }
.rk-bar i { display: block; height: 100%; background: #ffe9b8; }

.rk-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px; }
.rk-head { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  opacity: 0.45; margin-bottom: 6px; }
.rk-item { display: flex; justify-content: space-between; gap: 10px;
  font-size: 11px; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.rk-item span:last-child { font-variant-numeric: tabular-nums; opacity: 0.85; }
.rk-pos { color: #9be08a; } .rk-neg { color: #ff9d8a; }
.rk-note { font-size: 11px; opacity: 0.6; margin-top: 10px; line-height: 1.5; }

/* --- the ending ---------------------------------------------------------- */
#rk-final { display: none; background: rgba(6,8,12,0.82);
  backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px); }
#rk-final.on { display: block; pointer-events: auto; overflow: auto; }
#rk-final .sheet { width: min(1120px, 94vw); margin: 3vh auto 6vh;
  color: #e8e6e1; }
#rk-final .crown { text-align: center; margin-bottom: 22px; }
#rk-final .crown h1 { font-size: 34px; letter-spacing: 0.3em; margin: 0 0 6px;
  text-transform: uppercase; font-weight: 300; }
#rk-final .crown .why { font-size: 13px; opacity: 0.6; }
#rk-final .crown .mode { font-size: 10px; opacity: 0.35; letter-spacing: 0.2em;
  text-transform: uppercase; margin-top: 8px; }

.rk-podium { display: grid; gap: 8px; margin-bottom: 18px; }
.rk-place { display: grid; grid-template-columns: 54px 1fr auto; gap: 14px;
  align-items: center; padding: 14px 16px; border-radius: 9px;
  background: rgba(20,24,32,0.9); border: 1px solid rgba(255,255,255,0.1);
  opacity: 0; transform: translateY(14px);
  transition: opacity .45s ease, transform .45s ease; cursor: pointer; }
.rk-place.shown { opacity: 1; transform: none; }
.rk-place.sel { border-color: #ffe9b8; }
.rk-place.p1 { background: linear-gradient(90deg, rgba(255,220,140,0.16), rgba(20,24,32,0.9));
  border-color: rgba(255,220,140,0.5); }
.rk-place.p2 { background: linear-gradient(90deg, rgba(214,222,232,0.12), rgba(20,24,32,0.9)); }
.rk-place.p3 { background: linear-gradient(90deg, rgba(205,140,90,0.12), rgba(20,24,32,0.9)); }
.rk-place.out { opacity: 0.55; }
.rk-place.out.shown { opacity: 0.55; }
.rk-pl { font-size: 26px; text-align: center; opacity: 0.8; font-variant-numeric: tabular-nums; }
.rk-who { font-size: 17px; display: flex; align-items: center; gap: 9px; }
.rk-title { font-size: 11px; opacity: 0.65; margin-top: 3px; font-style: italic; }
.rk-meta { font-size: 10px; opacity: 0.45; margin-top: 2px; letter-spacing: 0.06em; }
.rk-total { text-align: right; }
.rk-total b { font-size: 26px; font-variant-numeric: tabular-nums; }
.rk-total .d { font-size: 11px; opacity: 0.5; display: block; }

#rk-final .card { background: rgba(20,24,32,0.9);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 9px;
  padding: 16px 18px; margin-bottom: 14px; }
#rk-final .tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
#rk-final .tab { pointer-events: auto; font: inherit; font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase; color: #e8e6e1;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px; padding: 7px 13px; cursor: pointer; }
#rk-final .tab.on { background: rgba(255,220,140,0.16); border-color: #ffe9b8; }
#rk-final .tab:hover { background: rgba(120,170,220,0.16); }

table.rk-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
table.rk-tbl th { text-align: right; font-weight: 500; font-size: 10px;
  letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.45;
  padding: 0 8px 8px; }
table.rk-tbl th:first-child { text-align: left; }
table.rk-tbl td { text-align: right; padding: 7px 8px;
  border-top: 1px solid rgba(255,255,255,0.06); font-variant-numeric: tabular-nums; }
table.rk-tbl td:first-child { text-align: left; }
table.rk-tbl tr.tot td { border-top: 1px solid rgba(255,255,255,0.25);
  font-weight: 600; font-size: 13px; }
table.rk-tbl tr.exp { cursor: pointer; }
table.rk-tbl tr.exp:hover td { background: rgba(120,170,220,0.1); }
tr.rk-detail td { font-size: 11px; opacity: 0.7; padding-left: 26px; }
.rk-scroll { overflow-x: auto; }

.rk-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px,1fr));
  gap: 14px; }
.rk-statgrp .rk-head { margin-bottom: 4px; }
.rk-stat { display: flex; justify-content: space-between; font-size: 11px;
  padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.rk-stat span:last-child { font-variant-numeric: tabular-nums; }

.rk-show { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px,1fr));
  gap: 10px; }
.rk-showcard { background: rgba(255,220,140,0.08);
  border: 1px solid rgba(255,220,140,0.3); border-radius: 8px; padding: 12px 13px; }
.rk-showcard .r { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: #ffe9b8; opacity: 0.8; }
.rk-showcard .n { font-size: 14px; margin: 4px 0 3px; }
.rk-showcard .b { font-size: 11px; opacity: 0.6; line-height: 1.4; }

.rk-time { display: grid; grid-template-columns: 62px 1fr; gap: 12px;
  font-size: 12px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.rk-time .t { opacity: 0.45; font-variant-numeric: tabular-nums; }

.rk-summary { font-size: 14px; line-height: 1.7; opacity: 0.9; }

#rk-final .controls { display: flex; gap: 8px; flex-wrap: wrap;
  justify-content: center; margin-top: 20px; }
#rk-final button.act { pointer-events: auto; font: inherit; font-size: 12px;
  color: #e8e6e1; background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.16); border-radius: 7px;
  padding: 11px 18px; cursor: pointer; }
#rk-final button.act:hover { background: rgba(120,170,220,0.2); }
#rk-final button.act.key { background: rgba(255,220,140,0.16); border-color: #ffe9b8; }
#rk-skip { position: fixed; top: 18px; right: 18px; pointer-events: auto;
  font: inherit; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
  color: #e8e6e1; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.2); border-radius: 6px;
  padding: 8px 14px; cursor: pointer; z-index: 41; }
#rk-skip:hover { background: rgba(120,170,220,0.24); }

@media (max-width: 780px) {
  .rk-cats { grid-template-columns: repeat(4, 1fr); }
  .rk-cols { grid-template-columns: 1fr; }
  .rk-place { grid-template-columns: 40px 1fr; }
  .rk-total { grid-column: 1 / -1; text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  .rk-place { transition: none; }
}
`;

export function initReckoningUi(state) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const elLive = document.createElement('div');
  elLive.id = 'rk-live';
  const elFinal = document.createElement('div');
  elFinal.id = 'rk-final';
  document.body.appendChild(elLive);
  document.body.appendChild(elFinal);

  /** Honour the OS setting: the reveal is decoration, not information. */
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  let liveOpen = false;
  let liveSel = null;         // team id being inspected in the live panel
  let liveTimer = 0;

  let finalOpen = false;
  let finalBuilt = false;
  let finalSel = null;
  let finalTab = 'standings';
  /** Rows revealed so far, last place first. */
  let revealed = 0;
  let revealTimer = 0;
  let revealing = false;
  /** 0..1 count-up applied to every displayed total. */
  let countUp = 0;
  const expanded = new Set();

  const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
  const num = (n) => Math.round(n).toLocaleString();
  const signed = (n) => (n >= 0 ? '+' : '−') + num(Math.abs(n));
  const clock = (t) =>
    `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  const esc = (s) => String(s).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const alignWord = (a) => a > 0.35 ? 'Benevolent' : a < -0.35 ? 'Cruel' : 'Neutral';

  /**
   * One definition of a team's outcome, used by every view.
   *
   * The podium and the standings table each had their own, and they disagreed:
   * the same team read "Victory" in one and "Survived" in the other.
   */
  const statusOf = (t, snap) => t.isEliminated ? 'Eliminated'
    : t.id === snap.winner ? (snap.kind === 'victory' ? 'Victory' : 'Prevailed')
      : 'Survived';

  const titleOf = (key) => {
    if (key === 'fallen') return { name: 'The Fallen', why: 'an age that ended early' };
    if (key === 'remembered') return { name: 'The Remembered', why: 'a reign without a crown' };
    return CFG.TITLES.find((t) => t.key === key) ?? { name: '', why: '' };
  };

  // --- the live panel ------------------------------------------------------

  function renderLive() {
    const rk = state.reckoning;
    if (!rk) return;
    const order = rk.standings();
    const leader = order[0];
    if (!liveSel || !order.some((t) => t.id === liveSel)) {
      liveSel = rk.playerTeam?.id ?? leader?.id ?? null;
    }
    const sel = rk.teamById(liveSel) ?? leader;

    const rows = order.map((t, i) => {
      const total = rk.scoreOf(t);
      const gap = leader ? total - rk.scoreOf(leader) : 0;
      const tr = t.scoreTrend;
      const trend = tr > 12 ? '<span class="rk-trend rk-up">&#9650;</span>'
        : tr < -12 ? '<span class="rk-trend rk-down">&#9660;</span>'
          : '<span class="rk-trend rk-flat">&mdash;</span>';
      return `<div class="rk-row${t.id === sel?.id ? ' sel' : ''}` +
        `${t.eliminated ? ' out' : ''}" data-team="${t.id}">` +
        `<div class="rk-rank">${i + 1}</div>` +
        `<div class="rk-name">` +
          `<span class="rk-swatch" style="background:${hex(t.colour)}"></span>` +
          `<span>${esc(t.displayName)}</span>` +
          `<span class="rk-tag">${t.isHuman ? 'You' : 'AI'}</span>` +
          (t.eliminated ? '<span class="rk-tag">Eliminated</span>' : '') +
        `</div>` +
        `<div class="rk-score"><b>${num(total)}</b>${trend}` +
          `<span class="rk-gap">${i === 0 ? 'leader' : num(gap)}</span></div>` +
        `</div>`;
    }).join('');

    let body = '';
    if (sel) {
      const vals = CFG.CATEGORIES.map((c) => ({
        c, v: sel.categoryTotals[c.key] ?? 0
      }));
      const best = vals.slice().sort((a, b) => b.v - a.v)[0];
      const worst = vals.slice().sort((a, b) => a.v - b.v)[0];
      const cats = vals.map(({ c, v }) => {
        const cls = c.key === best.c.key ? ' best' : c.key === worst.c.key ? ' worst' : '';
        const pct = Math.min(100, (v / CFG.CATEGORY_TARGET) * 100);
        return `<div class="rk-cat${cls}" title="${esc(c.blurb)}">` +
          `<div class="ic">${c.icon}</div><div class="lb">${c.label}</div>` +
          `<div class="vl">${num(v)}</div>` +
          `<div class="rk-bar"><i style="width:${pct}%"></i></div></div>`;
      }).join('');

      const events = sel.recentScoreEvents.slice().reverse().slice(0, 8).map((e) =>
        `<div class="rk-item"><span>${esc(e.text)}</span>` +
        `<span class="${e.delta >= 0 ? 'rk-pos' : 'rk-neg'}">${signed(e.delta)}</span></div>`
      ).join('') || '<div class="rk-item"><span style="opacity:.4">Nothing yet.</span><span></span></div>';

      const next = nextMilestoneFor(sel);
      body =
        `<div class="rk-cats">${cats}</div>` +
        `<div class="rk-cols">` +
          `<div><div class="rk-head">Recent scoring</div>${events}</div>` +
          `<div><div class="rk-head">Where ${esc(sel.displayName)} stands</div>` +
            `<div class="rk-item"><span>Strongest</span><span>${best.c.label}</span></div>` +
            `<div class="rk-item"><span>Weakest</span><span>${worst.c.label}</span></div>` +
            `<div class="rk-item"><span>Current Power</span><span>${num(sel.currentPower)}</span></div>` +
            `<div class="rk-item"><span>Historical Legacy</span><span>${num(sel.historicalLegacy)}</span></div>` +
            `<div class="rk-item"><span>Next milestone</span><span>${esc(next)}</span></div>` +
          `</div>` +
        `</div>`;
    }

    const asc = state.reckoning.ascension;
    elLive.innerHTML =
      `<div class="wrap">` +
      `<h3>The Divine Reckoning</h3>` +
      `<div class="sub">Every category targets ${num(CFG.CATEGORY_TARGET)}; ` +
      `going beyond it still counts, with diminishing returns. ` +
      `Click a team to inspect it. <b>Tab</b> closes.</div>` +
      (asc ? `<div class="rk-note" style="color:#ffe9b8">` +
        `${esc(asc.team.displayName)} approaches ascension &mdash; ` +
        `${Math.ceil(asc.seconds)}s</div>` : '') +
      rows + body +
      `</div>`;
  }

  /** The nearest milestone this team has not yet earned, as a sentence. */
  function nextMilestoneFor(team) {
    for (const m of CFG.POP_MILESTONES) {
      if (!team.milestonesAwarded.has(`pop-${m.at}`)) {
        return `Population ${m.at} (+${m.points})`;
      }
    }
    for (const m of CFG.MILESTONES) {
      if (!team.milestonesAwarded.has(m.key)) return `${m.name} (+${m.points})`;
    }
    return 'All earned';
  }

  function openLive() {
    if (liveOpen) return;
    liveOpen = true;
    renderLive();
    elLive.classList.add('on');
  }
  function closeLive() {
    liveOpen = false;
    elLive.classList.remove('on');
    elLive.innerHTML = '';
  }
  function toggleLive() { liveOpen ? closeLive() : openLive(); }

  // ONE listener, attached once. Toggling the panel never adds another.
  elLive.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.rk-row');
    if (row) { liveSel = row.dataset.team; renderLive(); return; }
    if (!e.target.closest('.wrap')) closeLive();
  });

  // --- the ending ----------------------------------------------------------

  function openFinal() {
    const snap = state.reckoning?.final;
    if (!snap || finalOpen) return;
    finalOpen = true;
    closeLive();
    finalSel = snap.teams.find((t) => t.isHuman)?.id ?? snap.teams[0]?.id ?? null;
    finalTab = 'standings';
    expanded.clear();
    // Reveal from last place upward, per the brief. Reduced motion skips
    // straight to the finished state rather than playing it faster.
    revealed = reduceMotion ? snap.teams.length : 0;
    countUp = reduceMotion ? 1 : 0;
    revealing = !reduceMotion;
    revealTimer = 0;
    finalBuilt = false;
    elFinal.classList.add('on');
    renderFinal();
  }

  /** Show everything at once. Idempotent - pressing skip twice is harmless. */
  function skip() {
    const snap = state.reckoning?.final;
    if (!snap) return;
    revealed = snap.teams.length;
    countUp = 1;
    revealing = false;
    renderFinal();
  }

  function closeFinal() {
    finalOpen = false;
    elFinal.classList.remove('on');
    elFinal.innerHTML = '';
    finalBuilt = false;
  }

  function renderFinal() {
    const snap = state.reckoning?.final;
    if (!snap) return;
    const order = snap.teams.slice().sort((a, b) => a.finalRank - b.finalRank);
    const winner = order[0];
    const shownFrom = order.length - revealed;   // reveal last place first

    const podium = order.map((t, i) => {
      const shown = i >= shownFrom;
      const title = titleOf(t.finalTitle);
      const gap = winner ? t.finalScore - winner.finalScore : 0;
      const status = statusOf(t, snap);
      return `<div class="rk-place p${i + 1}${shown ? ' shown' : ''}` +
        `${t.isEliminated ? ' out' : ''}${t.id === finalSel ? ' sel' : ''}" ` +
        `data-team="${t.id}">` +
        `<div class="rk-pl">${t.finalRank}</div>` +
        `<div><div class="rk-who">` +
          `<span class="rk-swatch" style="background:${hex(t.colour)}"></span>` +
          `${esc(t.displayName)}` +
          `<span class="rk-tag">${t.isHuman ? 'Human' : 'AI'}</span></div>` +
          `<div class="rk-title">${esc(title.name)} &mdash; ${esc(title.why)}</div>` +
          `<div class="rk-meta">${alignWord(t.alignment)} &middot; ${status}</div>` +
        `</div>` +
        `<div class="rk-total"><b>${num(t.finalScore * countUp)}</b>` +
          `<span class="d">${i === 0 ? 'winner' : num(gap)}</span></div>` +
        `</div>`;
    }).join('');

    const tab = (k, label) =>
      `<button class="tab${finalTab === k ? ' on' : ''}" data-tab="${k}">${label}</button>`;

    let panel = '';
    if (revealed >= order.length) {
      panel =
        `<div class="tabs">` +
          tab('standings', 'Summary') +
          tab('breakdown', 'Score breakdown') +
          tab('stats', 'Statistics') +
          tab('showcase', 'Achievements') +
          tab('chronicle', 'World chronicle') +
        `</div>` +
        (finalTab === 'standings' ? renderSummary(snap)
          : finalTab === 'breakdown' ? renderBreakdown(snap)
            : finalTab === 'stats' ? renderStats(snap)
              : finalTab === 'showcase' ? renderShowcase(snap)
                : renderChronicle(snap));
    }

    const controls = revealed >= order.length ? `<div class="controls">` +
      `<button class="act key" data-do="continue">Continue Playing</button>` +
      `<button class="act" data-do="new">Play New Island</button>` +
      `<button class="act" data-do="replay">Replay Same Seed</button>` +
      `<button class="act" data-do="chronicle">View World Chronicle</button>` +
      `<button class="act" data-do="achievements">View Achievements</button>` +
      `<button class="act" data-do="menu">Return to Main Menu</button>` +
      `</div>` : '';

    elFinal.innerHTML =
      (revealing ? `<button id="rk-skip">Skip animation</button>` : '') +
      `<div class="sheet">` +
      `<div class="crown"><h1>The Divine Reckoning</h1>` +
      `<div class="why">${esc(snap.reason ?? '')}</div>` +
      `<div class="mode">${esc(CFG.MODES[snap.mode]?.label ?? snap.mode)} ` +
      `&middot; ${clock(snap.at)} &middot; seed ${snap.seed} ` +
      `&middot; ${esc(snap.island)}</div></div>` +
      `<div class="rk-podium">${podium}</div>` +
      panel + controls +
      `</div>`;
    finalBuilt = true;
  }

  function renderSummary(snap) {
    const order = snap.teams.slice().sort((a, b) => a.finalRank - b.finalRank);
    const rows = order.map((t) =>
      `<tr><td><span class="rk-swatch" style="background:${hex(t.colour)};` +
      `display:inline-block;margin-right:7px"></span>${esc(t.displayName)}` +
      `${t.isHuman ? '' : ' <span class="rk-tag">AI</span>'}</td>` +
      `<td>${alignWord(t.alignment)}</td>` +
      `<td>${esc(titleOf(t.finalTitle).name)}</td>` +
      `<td>${statusOf(t, snap)}</td>` +
      `<td>${num(t.finalScore)}</td></tr>`).join('');

    return `<div class="card"><div class="rk-head">How the age is remembered</div>` +
      `<p class="rk-summary">${esc(snap.summary ?? '')}</p></div>` +
      `<div class="card"><div class="rk-head">Final standings</div>` +
      `<div class="rk-scroll"><table class="rk-tbl"><thead><tr>` +
      `<th>Team</th><th>Alignment</th><th>Title</th><th>Status</th><th>Score</th>` +
      `</tr></thead><tbody>${rows}</tbody></table></div>` +
      `<div class="rk-note">Ties are broken by score, then Dominion, then ` +
      `Stability, then living population, then the earlier time reaching that ` +
      `score, and finally the team's own id &mdash; so the order is always the ` +
      `same for the same match.</div></div>`;
  }

  /**
   * The breakdown table, which must add up on screen.
   *
   * The first version put each category's Legacy in its own row and it did not
   * reconcile: Civilization read "347 current, +150 legacy, -17 penalties,
   * final 330", which is not arithmetic anyone can follow. The cause is that
   * Legacy points are POOLED into the Legacy category - `categoryLegacy` only
   * records which category earned them - so adding them to their originating
   * row implies a sum the engine never performs.
   *
   * So Legacy is shown on the Legacy row alone, where it actually lands, and
   * every category's own attribution appears when you expand that row. Now
   * Base + Legacy - Penalties = Final on every line, and the eight lines add to
   * Current Power.
   */
  function renderBreakdown(snap) {
    const t = snap.teams.find((x) => x.id === finalSel) ?? snap.teams[0];
    if (!t) return '';
    const picker = snap.teams.slice()
      .sort((a, b) => a.finalRank - b.finalRank)
      .map((x) => `<button class="tab${x.id === t.id ? ' on' : ''}" ` +
        `data-pick="${x.id}">${esc(x.displayName)}</button>`).join('');

    const rows = CFG.CATEGORIES.map((c) => {
      const b = t.categories[c.key];
      // The negative terms as a share of the normalised total, so the split
      // shown is the split that actually happened.
      let neg = 0;
      let pos = 0;
      for (const [k, v] of Object.entries(b.itemised)) {
        if (k.startsWith('(')) continue;
        if (v < 0) neg += v; else pos += v;
      }
      // A blended category (Population) is not a scaled `raw`, so pro-rating
      // its negative terms against the total is meaningless and produced rows
      // that did not add up. Its detail lives in the expansion instead.
      const scale = !b.blend && pos + neg !== 0 ? b.total / (pos + neg) : 0;
      const penalty = c.key === 'legacy' || b.blend ? 0 : neg * scale;
      const isLegacyRow = c.key === 'legacy';
      const legacyCol = isLegacyRow ? b.total : 0;
      const base = isLegacyRow ? 0 : b.total - penalty;

      const open = expanded.has(c.key);
      const detail = open ? `<tr class="rk-detail"><td colspan="5">` +
        (Object.entries(b.itemised)
          .filter(([k]) => !k.startsWith('('))
          .map(([k, v]) => `${esc(k)}: <b class="${v >= 0 ? 'rk-pos' : 'rk-neg'}">` +
            `${signed(v)}</b>`).join(' &nbsp;&middot;&nbsp; ') || 'nothing yet') +
        `<br><span style="opacity:.5">raw ${num(b.raw)} &rarr; ${num(b.total)} ` +
        `points against a ${num(CFG.CATEGORY_TARGET)} target` +
        (b.blend
          ? ` &middot; 70% of the current figure plus 30% of the milestones ` +
            `earned, which is why this row is not split`
          : '') +
        (b.legacy && !isLegacyRow
          ? ` &middot; earned ${signed(b.legacy)} Legacy here, counted on the Legacy row`
          : '') +
        `</span></td></tr>` : '';

      return `<tr class="exp" data-cat="${c.key}"><td>${c.icon} ${c.label}` +
        `<span style="opacity:.35"> ${open ? '&#9662;' : '&#9656;'}</span></td>` +
        `<td>${base ? num(base) : '&mdash;'}</td>` +
        `<td class="${legacyCol ? 'rk-pos' : ''}">${legacyCol ? signed(legacyCol) : '&mdash;'}</td>` +
        `<td class="${penalty < -0.5 ? 'rk-neg' : ''}">` +
        `${penalty < -0.5 ? num(penalty) : '&mdash;'}</td>` +
        `<td>${num(b.total)}</td></tr>${detail}`;
    }).join('');

    const endRows = t.endingReasons.map(([label, v]) =>
      `<tr><td>${esc(label)}</td><td>&mdash;</td>` +
      `<td class="${v >= 0 ? 'rk-pos' : ''}">${v >= 0 ? signed(v) : '&mdash;'}</td>` +
      `<td class="${v < 0 ? 'rk-neg' : ''}">${v < 0 ? num(v) : '&mdash;'}</td>` +
      `<td>${signed(v)}</td></tr>`).join('');

    return `<div class="card"><div class="tabs">${picker}</div>` +
      `<div class="rk-scroll"><table class="rk-tbl"><thead><tr>` +
      `<th>Category</th><th>Base</th><th>Legacy</th><th>Penalties</th><th>Final</th>` +
      `</tr></thead><tbody>${rows}` +
      `<tr class="tot"><td>Current Power</td><td colspan="3"></td>` +
      `<td>${num(t.currentPower)}</td></tr>` +
      (endRows ? `<tr><td colspan="5" style="padding-top:14px" class="rk-head">` +
        `At the reckoning</td></tr>${endRows}` : '') +
      `<tr class="tot"><td>Final Divinity Score</td><td colspan="3"></td>` +
      `<td>${num(t.finalScore)}</td></tr>` +
      `</tbody></table></div>` +
      `<div class="rk-note">Click any category to itemise it. ` +
      `The eight categories add to Current Power ${num(t.currentPower)}; ` +
      `the ending adds ${signed(t.endingBonuses)} and takes ` +
      `${t.finalPenalties ? num(t.finalPenalties) : '0'}, ` +
      `for <b>${num(t.finalScore)}</b>. Legacy is pooled on its own row rather ` +
      `than split across the categories that earned it &mdash; expand a category ` +
      `to see what it contributed.</div></div>`;
  }

  const STAT_GROUPS = [
    ['Civilization', [
      ['buildingsPlaced', 'Buildings placed'],
      ['buildingsStanding', 'Standing at the end'],
      ['buildingsLost', 'Buildings lost'],
      ['buildingsDestroyed', 'Enemy buildings razed'],
      ['buildingsCaptured', 'Buildings captured'],
      ['buildingKinds', 'Building variety'],
      ['developedTowns', 'Towns fully developed']
    ]],
    ['Population', [
      ['finalPop', 'Final population'],
      ['peakPop', 'Peak population'],
      ['births', 'Villagers born'],
      ['deaths', 'Villagers lost'],
      ['rescued', 'Villagers rescued'],
      ['employed', 'In work at the end']
    ]],
    ['Divine influence', [
      ['belief', 'Final belief'],
      ['peakBelief', 'Highest belief'],
      ['prayersAnswered', 'Prayers answered'],
      ['prayersIgnored', 'Prayers ignored'],
      ['prayersFailed', 'Prayers failed'],
      ['kindMiracles', 'Helpful miracles'],
      ['cruelMiracles', 'Destructive miracles'],
      ['townsWelcomed', 'Towns converted through awe'],
      ['feeds', 'Times the people were fed']
    ]],
    ['Warfare and dominion', [
      ['battlesWon', 'Battles won'],
      ['battlesLost', 'Battles lost'],
      ['raidsLaunched', 'Raids launched'],
      ['raidsDefended', 'Raids turned back'],
      ['townsConquered', 'Towns conquered'],
      ['townsLostCount', 'Towns lost'],
      ['enemiesKilled', 'Enemy soldiers defeated'],
      ['civiliansKilled', 'Civilian casualties'],
      ['townsHeld', 'Towns held at the end']
    ]],
    ['Economy and survival', [
      ['famines', 'Famines suffered'],
      ['longestFamineFree', 'Longest famine-free run'],
      ['lowestFood', 'Lowest food reserve'],
      ['collapses', 'Population collapses'],
      ['recoveries', 'Recoveries']
    ]],
    ['Legacy', [
      ['milestoneCount', 'Legacy milestones'],
      ['legacyPoints', 'Legacy points']
    ]]
  ];

  function renderStats(snap) {
    const t = snap.teams.find((x) => x.id === finalSel) ?? snap.teams[0];
    if (!t) return '';
    const picker = snap.teams.slice()
      .sort((a, b) => a.finalRank - b.finalRank)
      .map((x) => `<button class="tab${x.id === t.id ? ' on' : ''}" ` +
        `data-pick="${x.id}">${esc(x.displayName)}</button>`).join('');

    const fmt = (k, v) => {
      if (k === 'longestFamineFree') return clock(v);
      if (k === 'lowestFood') return Number.isFinite(v) ? num(v) : '—';
      if (k === 'territory') return Math.round(v * 100) + '%';
      return num(v);
    };

    const groups = STAT_GROUPS.map(([name, keys]) =>
      `<div class="rk-statgrp"><div class="rk-head">${name}</div>` +
      keys.map(([k, label]) =>
        `<div class="rk-stat"><span>${label}</span>` +
        `<span>${fmt(k, t.statistics[k] ?? 0)}</span></div>`).join('') +
      `</div>`).join('');

    return `<div class="card"><div class="tabs">${picker}</div>` +
      `<div class="rk-stats">${groups}` +
      `<div class="rk-statgrp"><div class="rk-head">The match</div>` +
        `<div class="rk-stat"><span>Duration</span><span>${clock(snap.at)}</span></div>` +
        `<div class="rk-stat"><span>World seed</span><span>${snap.seed}</span></div>` +
        `<div class="rk-stat"><span>Island</span><span>${esc(snap.island)}</span></div>` +
        `<div class="rk-stat"><span>Territory held</span><span>` +
          `${Math.round(t.territoryShare * 100)}%</span></div>` +
        `<div class="rk-stat"><span>Devotion</span><span>${num(t.devotion)}</span></div>` +
        `<div class="rk-stat"><span>Dread</span><span>${num(t.dread)}</span></div>` +
      `</div></div>` +
      `<div class="rk-note">Only what the simulation actually tracks is shown. ` +
      `Prayers and miracles are the player's alone &mdash; this game gives only ` +
      `one of you a god &mdash; so those rows read zero for an AI by nature, not ` +
      `by penalty.</div></div>`;
  }

  /**
   * The showcase.
   *
   * A human sees the achievements they earned DURING this match, ranked by
   * inferred rarity. An AI sees its Legacy milestones instead, because
   * pretending an AI unlocked a player-account achievement would be a lie the
   * scoreboard told. Both are worth the same competitive points: none. The
   * milestones are what scored, and they are in the breakdown.
   */
  function renderShowcase(snap) {
    const t = snap.teams.find((x) => x.id === finalSel) ?? snap.teams[0];
    if (!t) return '';
    const picker = snap.teams.slice()
      .sort((a, b) => a.finalRank - b.finalRank)
      .map((x) => `<button class="tab${x.id === t.id ? ' on' : ''}" ` +
        `data-pick="${x.id}">${esc(x.displayName)}</button>`).join('');

    let cards = '';
    let note = '';
    if (t.isHuman) {
      const all = state.achievements?.list ?? [];
      const fresh = all.filter((a) => a.fresh);
      const ranked = fresh.slice().sort((a, b) => rarityOf(b).i - rarityOf(a).i);
      cards = ranked.slice(0, 6).map((a) => {
        const r = rarityOf(a);
        return `<div class="rk-showcard"><div class="r">${r.name}</div>` +
          `<div class="n">${esc(a.name)}</div>` +
          `<div class="b">${esc(a.blurb)}</div></div>`;
      }).join('') || '<div class="rk-note">No achievements were earned this match.</div>';
      const rarest = ranked[0];
      note = `${fresh.length} earned this match, of ${all.length} in the game` +
        (rarest ? `. Rarest: ${esc(rarest.name)} (${rarityOf(rarest).name}).` : '.') +
        ` Achievements are kept between games and are worth no match score &mdash; ` +
        `otherwise a returning player would start ahead. What scored is Legacy ` +
        `milestones, which every team earns on the same terms.`;
    } else {
      cards = t.milestones.slice().sort((a, b) => b.points - a.points)
        .slice(0, 6).map((m) =>
          `<div class="rk-showcard"><div class="r">${m.points} Legacy</div>` +
          `<div class="n">${esc(m.label)}</div>` +
          `<div class="b">Earned at ${clock(m.at)}.</div></div>`
        ).join('') || '<div class="rk-note">No milestones were earned.</div>';
      note = `${t.statistics.milestoneCount} Legacy milestones, ` +
        `${num(t.statistics.legacyPoints)} points. AI teams earn the same ` +
        `milestones a human does, from the same conditions.`;
    }

    return `<div class="card"><div class="tabs">${picker}</div>` +
      `<div class="rk-show">${cards}</div>` +
      `<div class="rk-note">${note}</div></div>`;
  }

  /**
   * Rarity, inferred.
   *
   * The Phase 13 table has no rarity field - every entry is a threshold on a
   * counter - so this bands them by how demanding the threshold is. It ranks
   * the showcase and nothing else; no score depends on it.
   */
  function rarityOf(a) {
    const n = a.need ?? 1;
    const i = n >= 500 ? 4 : n >= 100 ? 3 : n >= 25 ? 2 : n >= 5 ? 1 : 0;
    return { i, ...CFG.RARITY_BANDS[i] };
  }

  function renderChronicle(snap) {
    const rows = snap.timeline.map((e) =>
      `<div class="rk-time"><span class="t">${clock(e.at)}</span>` +
      `<span>${esc(e.text)}</span></div>`).join('')
      || '<div class="rk-note">Nothing of note was recorded.</div>';
    return `<div class="card"><div class="rk-head">World chronicle</div>${rows}` +
      `<div class="rk-note">Only turning points are kept, and only the most ` +
      `recent ${CFG.TIMELINE_MAX}.</div></div>`;
  }

  // ONE delegated listener for the whole results screen.
  elFinal.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#rk-skip')) { skip(); return; }
    const place = t.closest('.rk-place');
    if (place) { finalSel = place.dataset.team; renderFinal(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { finalTab = tab.dataset.tab; renderFinal(); return; }
    const pick = t.closest('[data-pick]');
    if (pick) { finalSel = pick.dataset.pick; renderFinal(); return; }
    const row = t.closest('[data-cat]');
    if (row) {
      const k = row.dataset.cat;
      expanded.has(k) ? expanded.delete(k) : expanded.add(k);
      renderFinal();
      return;
    }
    const act = t.closest('[data-do]');
    if (act) doAction(act.dataset.do);
  });

  function doAction(what) {
    const snap = state.reckoning?.final;
    switch (what) {
      case 'continue':
        // The world starts turning again. `state.outcome` deliberately STAYS
        // set: it is what stops a second competitive ending, and endGame()
        // already refuses to fire twice while it is there. The frozen snapshot
        // is untouched and the screen can be reopened from the live panel.
        state.postGame = true;
        closeFinal();
        state.ui?.toast('The world turns on. Press Tab for the reckoning.');
        break;
      case 'new':
        // The existing new-game flow: no seed in the URL means one is rolled.
        location.href = location.pathname;
        break;
      case 'replay':
        // Same island, everything else clean - a full reload, so no state,
        // subscription or entity id can survive into the new match.
        location.href = `${location.pathname}?seed=${snap?.seed ?? state.seed}`
          + (state.islandName ? `&island=${encodeURIComponent(state.islandName)}` : '');
        break;
      case 'chronicle': finalTab = 'chronicle'; renderFinal(); break;
      case 'achievements': state.ui?.toggleActs(); break;
      case 'menu':
        // This game boots straight into a world; there is no main menu to
        // return to, so this is the same clean restart the old ending offered.
        location.href = location.pathname;
        break;
    }
  }

  // --- driving -------------------------------------------------------------

  const REVEAL_STEP = 0.55;    // seconds between places
  const COUNT_TIME = 1.1;      // seconds for the totals to count up

  function update(dt) {
    // The results screen opens itself the moment the snapshot exists, so every
    // path that ends a match arrives here - and it opens ONCE, because
    // `finalOpen` latches and the snapshot is written exactly once.
    if (state.reckoning?.final && !finalOpen && !state.postGame) openFinal();

    if (finalOpen && revealing) {
      const snap = state.reckoning.final;
      revealTimer += dt;
      const want = Math.min(snap.teams.length, Math.floor(revealTimer / REVEAL_STEP) + 1);
      if (want !== revealed) { revealed = want; renderFinal(); }
      if (revealed >= snap.teams.length) {
        countUp = Math.min(1, countUp + dt / COUNT_TIME);
        renderFinal();
        if (countUp >= 1) { revealing = false; renderFinal(); }
      }
    }

    if (liveOpen) {
      liveTimer -= dt;
      if (liveTimer <= 0) { liveTimer = 0.35; renderLive(); }
    }
  }

  const api = {
    enabled: true,
    toggle() {
      // After the bell Tab reopens the results rather than the live panel:
      // the match is over and the live scores are a sandbox now.
      if (state.reckoning?.final) {
        finalOpen ? closeFinal() : openFinal();
        return;
      }
      toggleLive();
    },
    get open() { return liveOpen || finalOpen; },
    openFinal, closeFinal, closeLive, skip,
    update
  };
  state.reckoningUi = api;
  return api;
}
