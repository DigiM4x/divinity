// ---------------------------------------------------------------------------
// ui.js - DOM overlay. No canvas drawing, no framework, just a styled div that
// reads state each frame. Phase 2 will hang the radial build menu off this.
//
// Publishes state.ui: { update, toast, setDebugVisible, toggleBuildMenu }
// ---------------------------------------------------------------------------
import { BUILDINGS, MIRACLES, TRAITS, CREATURE_TRAITS, PET_TEMPERAMENT, COMBAT, LEASH_MODES, CREATURE, PET_KIND, NATURES, BLESSING} from './state.js';

const CSS = `
#hud .panel {
  position: absolute;
  background: rgba(10, 13, 19, 0.55);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 10px 13px;
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
  font-size: 12px;
  line-height: 1.55;
  letter-spacing: 0.02em;
  color: #efe9dd;
  box-shadow: 0 8px 26px rgba(0,0,0,0.35);
}
#hud .title { top: 16px; left: 16px; padding: 12px 16px; }
#hud .title h2 {
  margin: 0 0 2px; font-size: 15px; font-weight: 300;
  letter-spacing: 0.32em; text-indent: 0.32em; color: #fff3d9;
}
#hud .title .sub { opacity: 0.5; font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; }
#hud .controls { bottom: 16px; left: 16px; max-width: 300px; }
#hud .controls b { color: #ffe9b8; font-weight: 600; }
#hud .controls div { white-space: nowrap; }
#hud .stats { top: 16px; right: 16px; min-width: 178px; font-variant-numeric: tabular-nums; }
#hud .stats .row { display: flex; justify-content: space-between; gap: 14px; }
#hud .stats .k { opacity: 0.55; }
#hud .stats .warn { color: #ffb86b; }
#hud .stats .good { color: #9be08a; }
#hud .carry {
  bottom: 16px; right: 16px; text-align: right; min-width: 150px;
  transition: opacity 0.18s ease; opacity: 0;
}
#hud .carry.on { opacity: 1; }
#hud .carry .big { font-size: 15px; color: #ffe9b8; }
#hud .toast {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase;
  opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
  text-shadow: 0 2px 12px rgba(0,0,0,0.8);
}
#hud .toast.on { opacity: 1; }
#hud .hidden { display: none; }

/* --- resource bar --- */
#hud .res {
  top: 16px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 20px; padding: 9px 18px; font-variant-numeric: tabular-nums;
}
#hud .res .item { display: flex; align-items: center; gap: 7px; }
#hud .res .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
#hud .res .amt { font-size: 14px; color: #fff3d9; min-width: 30px; }
#hud .res .lbl { opacity: 0.45; font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; }
#hud .res .sep { width: 1px; background: rgba(255,255,255,0.14); margin: -2px 2px; }

/* --- build menu --- */
#hud .buildbar { bottom: 16px; left: 50%; transform: translateX(-50%); padding: 8px 10px; }
#hud .buildbar .hint { text-align: center; opacity: 0.55; font-size: 11px; }
#hud .radial { position: absolute; inset: 0; pointer-events: auto; display: none; }
#hud .radial.on { display: block; }
#hud .radial svg { position: absolute; overflow: visible; }
#hud .radial .wedge {
  fill: rgba(14, 18, 26, 0.82); stroke: rgba(255,255,255,0.16); stroke-width: 1.2;
  cursor: pointer; transition: fill 0.12s ease;
}
#hud .radial .wedge:hover { fill: rgba(60, 90, 120, 0.92); }
#hud .radial .wedge.poor { fill: rgba(40, 16, 16, 0.82); }
#hud .radial .wedge.poor:hover { fill: rgba(80, 30, 26, 0.9); }
#hud .radial text { fill: #efe9dd; font-size: 12px; text-anchor: middle; pointer-events: none;
  font-family: ui-sans-serif, system-ui, sans-serif; }
#hud .radial text.cost { font-size: 10px; fill: #ffd79a; opacity: 0.85; }
#hud .radial text.poorcost { fill: #ff9d8a; }
#hud .radial .hubtext { font-size: 11px; fill: rgba(255,255,255,0.5); }

/* --- creature mind panel --- */
#hud .mind {
  top: 96px; left: 16px; width: 268px; max-height: calc(100vh - 300px);
  overflow: hidden; font-size: 11px;
}
#hud .mind h3 {
  margin: 0 0 7px; font-size: 10px; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; opacity: 0.5;
}
#hud .mind .sect { margin-top: 9px; }
#hud .mind .bar { display: grid; grid-template-columns: 58px 1fr 34px; gap: 6px; align-items: center; margin: 2px 0; }
#hud .mind .bar .n { opacity: 0.6; }
#hud .mind .bar .t { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.10); overflow: hidden; }
#hud .mind .bar .f { height: 100%; border-radius: 3px; transition: width 0.2s ease; }
#hud .mind .bar .v { text-align: right; opacity: 0.75; font-variant-numeric: tabular-nums; }
#hud .mind .op { display: grid; grid-template-columns: 62px 1fr 1fr 1fr; gap: 4px; margin: 2px 0; font-size: 10px; }
#hud .mind .op .c { text-align: center; border-radius: 3px; padding: 1px 0; font-variant-numeric: tabular-nums; }
#hud .mind .head4 { opacity: 0.4; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; }
#hud .mind .doing { color: #ffe9b8; margin: 6px 0 2px; }
#hud .mind .logline { opacity: 0.62; font-size: 10px; line-height: 1.45; white-space: normal; }
#hud .mind .logline:first-child { opacity: 1; color: #fff3d9; }
#hud .mind .leash { margin-top: 8px; font-size: 10px; opacity: 0.6; }
#hud .mind .temperline { font-size: 10px; color: #8fd8ff; opacity: 0.8; margin: -4px 0 6px; }
#hud .mind .temperline .grown { color: #ffe9b8; }
#hud .mind .op2 { display: flex; justify-content: space-between; font-size: 10px; opacity: 0.7; line-height: 1.5; }

/* --- alignment meter --- */
#hud .align {
  top: 62px; left: 50%; transform: translateX(-50%);
  padding: 7px 14px; width: 300px; text-align: center;
}
#hud .align .track {
  position: relative; height: 6px; border-radius: 3px; margin: 5px 0 3px;
  background: linear-gradient(90deg, #7a2f24 0%, #4a4a52 50%, #6fbf63 100%);
}
#hud .align .knob {
  position: absolute; top: -3px; width: 12px; height: 12px; border-radius: 50%;
  background: #fff3d9; box-shadow: 0 0 8px rgba(0,0,0,0.6);
  transform: translateX(-50%); transition: left 0.25s ease;
}
#hud .align .lbl { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.55; }

#hud .grimoire .row .dot {
  width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto;
  box-shadow: 0 0 6px currentColor;
}
/* The HUD as a whole is pointer-events:none so it never blocks the world.
   Anything you are meant to CLICK has to opt back in - the build radial and the
   creature-select screen already did, and the grimoire needed it the moment
   miracles stopped being drawn and started being picked. Without this the rows
   look and hover like buttons and the click lands on the canvas behind them. */
#hud .grimoire { pointer-events: auto; }
#hud .grimoire .row { cursor: pointer; }
#hud .grimoire .row:hover { background: rgba(120,170,220,0.18); }
#hud .grimoire h4.live { color: #ffe9b8; }
#hud .grimoire .row.armed {
  background: rgba(255,220,140,0.20); border-radius: 5px;
  box-shadow: inset 0 0 0 1px rgba(255,233,184,0.55);
}

/* --- cast result --- */
#hud .cast {
  position: absolute; top: 46%; left: 50%; transform: translate(-50%,-50%);
  font-size: 17px; letter-spacing: 0.2em; text-transform: uppercase;
  opacity: 0; transition: opacity 0.25s ease; text-shadow: 0 2px 14px rgba(0,0,0,0.85);
}
#hud .cast.on { opacity: 1; }
#hud .cast.bad { color: #ff9d8a; font-size: 13px; }

/* --- miracle reference --- */
#hud .grimoire { bottom: 16px; right: 16px; font-size: 11px; min-width: 190px; }
/* Sits directly above the grimoire, and opts back into pointer events for the
   same reason it does - the rows are buttons. */
/* Centre-top, under the resource bar: a raid is the one thing that should
   interrupt whatever you were looking at. */
#hud .raids {
  top: 104px; left: 50%; transform: translateX(-50%);
  text-align: center; font-size: 11px; display: none;
  border-color: rgba(255,140,110,0.5); background: rgba(60, 16, 12, 0.6);
}
#hud .raids.on { display: block; }
#hud .raids .hd {
  color: #ff9d8a; letter-spacing: 0.16em; text-transform: uppercase;
  font-size: 10px; margin-bottom: 3px;
}
#hud .raids .line { color: #fff3d9; line-height: 1.5; }
#hud .raids .at-you { color: #ffb86b; font-weight: 600; }

#hud .barracks {
  bottom: 132px; right: 16px; font-size: 11px; min-width: 190px;
  pointer-events: auto; display: none;
}
#hud .barracks.on { display: block; }
#hud .barracks h4 {
  margin: 0 0 6px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  opacity: 0.55; font-weight: 500;
}
#hud .barracks .row {
  display: flex; justify-content: space-between; gap: 10px; align-items: center;
  padding: 3px 4px; border-radius: 5px; cursor: pointer; line-height: 1.5;
}
#hud .barracks .row:hover { background: rgba(120,170,220,0.20); }
#hud .barracks .row.maxed { cursor: default; opacity: 0.55; }
#hud .barracks .row.maxed:hover { background: none; }
#hud .barracks .row.poor { opacity: 0.42; }
#hud .barracks .rank { color: #ffe9b8; }
#hud .barracks .row.engine { border-top: 1px solid rgba(255,255,255,0.10); margin-top: 4px; padding-top: 5px; }
#hud .barracks .row.engine .rank { color: #ff9d8a; }
#hud .barracks .cost { opacity: 0.6; font-variant-numeric: tabular-nums; }
#hud .grimoire h4 {
  margin: 0 0 5px; font-size: 9.5px; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; opacity: 0.5;
}
#hud .grimoire .row { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
#hud .grimoire .row.poor { opacity: 0.38; }
#hud .grimoire .g { width: 26px; height: 18px; flex: none; }
#hud .grimoire .g path { fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
#hud .grimoire .c { opacity: 0.6; font-variant-numeric: tabular-nums; }

/* --- rival towns --- */
#hud .rivals { top: 96px; right: 16px; min-width: 210px; font-size: 11px; }
#hud .rivals h4 {
  margin: 0 0 6px; font-size: 9.5px; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; opacity: 0.5;
}
#hud .rivals .t { margin-bottom: 8px; }
#hud .rivals .t:last-child { margin-bottom: 0; }
#hud .rivals .hd { display: flex; align-items: center; gap: 6px; }
#hud .rivals .swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
#hud .rivals .nm { flex: 1; color: #fff3d9; }
#hud .rivals .pp { opacity: 0.55; font-variant-numeric: tabular-nums; }
#hud .rivals .track { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.10); margin-top: 3px; overflow: hidden; }
#hud .rivals .fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
/* While your creature is actually performing where they can see it, the bar it
   is filling says so. The one moment the player can connect the act to the
   meter, so it is worth a cue. */
#hud .rivals .fill.glow {
  box-shadow: 0 0 8px #ffe9b8, 0 0 14px rgba(255,233,184,0.6);
  animation: awepulse 1.2s ease-in-out infinite;
}
@keyframes awepulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
#hud .rivals .lbl2 { font-size: 9px; opacity: 0.45; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2px; }
#hud .rivals .won { color: #9be08a; }

/* --- animal picker --- */
/* --- the ending --- */
#hud .ending {
  position: absolute; inset: 0; display: none; pointer-events: auto;
  /* Above every panel. The ending is the only thing you should be reading, and
     the HUD panels are siblings declared after it, so they would paint on top. */
  z-index: 50;
  background: rgba(6, 8, 12, 0.78); backdrop-filter: blur(6px);
  place-content: center; text-align: center;
}
#hud .ending.on { display: grid; }
/* The verdict, and it should be readable from across the room. The flavour
   name underneath is the garnish; this is the plate. */
#hud .ending h1 {
  margin: 0 0 2px; font-size: 76px; font-weight: 300;
  letter-spacing: 0.20em; text-indent: 0.20em; text-transform: uppercase;
  line-height: 1.05;
}
#hud .ending .epithet {
  font-size: 15px; font-weight: 300; letter-spacing: 0.36em;
  text-indent: 0.36em; text-transform: uppercase; opacity: 0.55;
  margin-bottom: 10px;
}
#hud .ending.victory h1 { color: #ffe9b8; text-shadow: 0 0 60px rgba(255,220,140,0.45); }
#hud .ending.defeat h1 { color: #ff9d8a; text-shadow: 0 0 60px rgba(255,110,90,0.40); }
#hud .ending.victory .epithet { color: #ffe9b8; }
#hud .ending.defeat .epithet { color: #ff9d8a; }
#hud .ending .why { font-size: 14px; opacity: 0.8; margin-bottom: 22px; }
#hud .ending .stats {
  display: flex; gap: 26px; justify-content: center; margin-bottom: 26px;
  font-variant-numeric: tabular-nums;
}
#hud .ending .stats div { min-width: 74px; }
#hud .ending .stats .n { font-size: 19px; color: #fff3d9; }
#hud .ending .stats .k {
  font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.5;
}
#hud .ending button {
  font: inherit; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase;
  color: #efe9dd; background: rgba(255,255,255,0.09); cursor: pointer;
  border: 1px solid rgba(255,255,255,0.28); border-radius: 8px; padding: 10px 22px;
}
#hud .ending button:hover { background: rgba(120,170,220,0.26); }

#hud .zoo {
  position: absolute; inset: 0; pointer-events: auto; display: none;
  background: rgba(6, 8, 12, 0.72); backdrop-filter: blur(4px);
}
#hud .zoo.on { display: grid; place-content: center; }
#hud .zoo .panel2 {
  background: rgba(12, 15, 21, 0.9); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 14px; padding: 18px 20px; max-width: 760px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
#hud .zoo h3 {
  margin: 0 0 3px; font-size: 12px; font-weight: 600; letter-spacing: 0.2em;
  text-transform: uppercase; color: #fff3d9;
}
#hud .zoo .sub2 { margin: 0 0 14px; font-size: 11px; opacity: 0.5; }
/* The ring, stated once at the top rather than implied by twenty-four badges. */
#hud .zoo .sub2 .ring { display: inline-block; margin-top: 5px; opacity: 0.95; }
#hud .zoo .sub2 .ring b { font-weight: 600; }
#hud .zoo .grid {
  display: grid; grid-template-columns: repeat(8, 78px); gap: 8px;
  max-height: 58vh; overflow-y: auto;
}
#hud .zoo .cell {
  border: 1px solid rgba(255,255,255,0.10); border-radius: 9px; padding: 5px 3px 6px;
  background: rgba(255,255,255,0.03); cursor: pointer; text-align: center;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
}
#hud .zoo .cell:hover { background: rgba(120,170,220,0.20); border-color: rgba(255,255,255,0.3); transform: translateY(-2px); }
#hud .zoo .cell.active { background: rgba(255,220,140,0.18); border-color: #ffe9b8; }
#hud .zoo .cell img { width: 56px; height: 56px; display: block; margin: 0 auto 3px; image-rendering: auto; }
#hud .zoo .cell span { font-size: 10px; opacity: 0.75; display: block; line-height: 1.2; }
#hud .zoo .cell.active span { opacity: 1; color: #ffe9b8; }
#hud .zoo .cell .temper { font-size: 9px; opacity: 0.5; color: #8fd8ff; margin-top: 2px; }
#hud .zoo .cell.active .temper { opacity: 0.85; }
/* The nature reads as a badge rather than another line of grey text, because
   it is the one thing on the card that decides a fight against another god's
   animal and it has to survive a glance across twenty-four of them. */
#hud .zoo .cell .nat {
  font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--nat); margin-top: 3px; opacity: 0.9;
}
#hud .zoo .cell .nat b { font-weight: 600; }
#hud .zoo .cell .nat em {
  font-style: normal; color: #efe9dd; opacity: 0.45; letter-spacing: 0.04em;
  text-transform: none; font-size: 9px;
}

/* --- achievements --- */
#hud .acts {
  position: absolute; inset: 0; pointer-events: auto; display: none;
  background: rgba(6, 8, 12, 0.74); backdrop-filter: blur(4px);
}
#hud .acts.on { display: grid; place-content: center; }
#hud .acts .panel2 {
  background: rgba(12, 15, 21, 0.93); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 14px; padding: 18px 20px; width: min(920px, 92vw);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
#hud .acts .head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 2px; }
#hud .acts h3 {
  margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.2em;
  text-transform: uppercase; color: #fff3d9;
}
#hud .acts .tally { font-size: 12px; color: #ffe9b8; letter-spacing: 0.08em; }
#hud .acts .sub2 { margin: 0 0 12px; font-size: 11px; opacity: 0.5; }
#hud .acts .scroll { max-height: 64vh; overflow-y: auto; padding-right: 6px; }
#hud .acts .grouphead {
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  opacity: 0.45; margin: 12px 0 6px; border-bottom: 1px solid rgba(255,255,255,0.08);
  padding-bottom: 4px;
}
#hud .acts .grouphead:first-child { margin-top: 0; }
#hud .acts .rows { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
#hud .acts .row {
  border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
  padding: 7px 9px 8px; background: rgba(255,255,255,0.025); position: relative;
  overflow: hidden;
}
#hud .acts .row.got { border-color: rgba(255,220,140,0.45); background: rgba(255,220,140,0.09); }
#hud .acts .row.fresh { border-color: #ffe9b8; box-shadow: 0 0 0 1px rgba(255,233,184,0.35); }
#hud .acts .row .nm { font-size: 12px; color: #d8dee8; }
#hud .acts .row.got .nm { color: #ffe9b8; }
#hud .acts .row .bl { font-size: 10px; opacity: 0.5; line-height: 1.35; margin-top: 1px; }
#hud .acts .row .bar {
  position: absolute; left: 0; bottom: 0; height: 2px;
  background: rgba(140,190,255,0.55);
}
#hud .acts .row.got .bar { background: #ffe9b8; }
#hud .acts .row .pct {
  position: absolute; top: 7px; right: 9px; font-size: 10px;
  opacity: 0.45; font-variant-numeric: tabular-nums;
}
#hud .acts .row.got .pct { opacity: 0.8; color: #ffe9b8; }

/* --- achievement announcement --- */
/* A bloom of light across the whole frame as the card lands. The card by
   itself was a tasteful notice in the corner of a busy screen; this is the part
   that makes you look up. One persistent element, animation retriggered per
   award - see showNextAward. */
#hud .awardflash {
  position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background:
    radial-gradient(120% 60% at 50% 20%, rgba(255,214,130,0.34) 0%,
                    rgba(255,190,90,0.12) 38%, transparent 70%);
}
#hud .awardflash.go { animation: awardbloom 0.85s cubic-bezier(0.1,0.8,0.2,1) 1; }
@keyframes awardbloom {
  0%   { opacity: 0; }
  12%  { opacity: 1; }
  100% { opacity: 0; }
}

/* Rays behind the star, turning slowly. */
#hud .award .rays {
  position: absolute; left: 6px; top: 50%; width: 86px; height: 86px;
  margin-top: -43px; pointer-events: none; opacity: 0.5;
  background: conic-gradient(from 0deg,
    rgba(255,214,130,0.5) 0deg 7deg, transparent 7deg 45deg,
    rgba(255,214,130,0.5) 45deg 52deg, transparent 52deg 90deg,
    rgba(255,214,130,0.5) 90deg 97deg, transparent 97deg 135deg,
    rgba(255,214,130,0.5) 135deg 142deg, transparent 142deg 180deg,
    rgba(255,214,130,0.5) 180deg 187deg, transparent 187deg 225deg,
    rgba(255,214,130,0.5) 225deg 232deg, transparent 232deg 270deg,
    rgba(255,214,130,0.5) 270deg 277deg, transparent 277deg 315deg,
    rgba(255,214,130,0.5) 315deg 322deg, transparent 322deg 360deg);
  -webkit-mask-image: radial-gradient(closest-side, transparent 22%, #000 45%, transparent 78%);
  mask-image: radial-gradient(closest-side, transparent 22%, #000 45%, transparent 78%);
  animation: awardspin 9s linear infinite;
}
@keyframes awardspin { to { transform: rotate(360deg); } }

/* Sparks thrown off as it arrives. Eight spans, each given its own bearing by
   an inline custom property, so the whole burst is one CSS animation. */
#hud .award .spark {
  position: absolute; left: 34px; top: 50%; width: 4px; height: 4px;
  border-radius: 50%; background: #ffe6ae; pointer-events: none;
  box-shadow: 0 0 8px #ffd884;
  animation: awardspark 0.75s cubic-bezier(0.15,0.7,0.3,1) 1 forwards;
}
@keyframes awardspark {
  0%   { transform: translate(0, 0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; }
}

#hud .award {
  position: absolute; top: 132px; left: 50%;
  transform: translateX(-50%) translateY(-14px) scale(0.94);
  pointer-events: none; opacity: 0;
  display: flex; align-items: center; gap: 14px;
  padding: 13px 22px 13px 18px;
  border-radius: 13px;
  border: 1px solid rgba(255,233,184,0.55);
  background:
    linear-gradient(180deg, rgba(58,46,24,0.94) 0%, rgba(24,20,14,0.94) 100%);
  box-shadow: 0 14px 44px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,233,184,0.12) inset,
              0 0 26px rgba(255,205,110,0.16);
  transition: opacity 0.28s ease, transform 0.46s cubic-bezier(0.16, 1.7, 0.3, 1);
  min-width: 300px; max-width: 520px;
}
#hud .award.on { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
/* Overshoot harder than a notification usually would. It is a trophy. */
#hud .award.on .star { animation: awardstar 0.7s cubic-bezier(0.15,1.9,0.3,1) 1,
                                  awardpulse 1.9s ease-in-out 0.7s infinite; }
@keyframes awardstar {
  0%   { transform: scale(0.2) rotate(-140deg); opacity: 0; }
  60%  { transform: scale(1.35) rotate(8deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
#hud .award .star {
  font-size: 26px; line-height: 1; color: #ffd884;
  text-shadow: 0 0 16px rgba(255,205,110,0.75);
  animation: awardpulse 1.9s ease-in-out infinite;
}
@keyframes awardpulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.14); opacity: 0.82; }
}
#hud .award .txt { display: flex; flex-direction: column; gap: 2px; }
#hud .award .kicker {
  font-size: 9px; letter-spacing: 0.26em; text-transform: uppercase;
  color: #d8b978; opacity: 0.95;
}
#hud .award .nm2 {
  font-size: 17px; font-weight: 600; color: #fff3d9; letter-spacing: 0.01em;
}
#hud .award .bl2 { font-size: 11px; opacity: 0.62; line-height: 1.35; }
#hud .award .tally2 {
  margin-left: auto; padding-left: 16px; text-align: right;
  font-size: 11px; color: #ffe9b8; opacity: 0.7;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
/* A sweep of light across the card as it lands. */
#hud .award .shine {
  position: absolute; inset: 0; border-radius: 13px; overflow: hidden;
}
#hud .award.on .shine::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 40%;
  background: linear-gradient(100deg, transparent, rgba(255,240,205,0.16), transparent);
  animation: awardsweep 0.9s ease-out 0.16s 1;
}
@keyframes awardsweep {
  from { left: -45%; } to { left: 115%; }
}

/* --- sculpting readout --- */
#hud .sculpt {
  bottom: 84px; left: 50%; transform: translateX(-50%);
  text-align: center; opacity: 0; transition: opacity 0.14s ease;
  font-variant-numeric: tabular-nums;
}
#hud .sculpt.on { opacity: 1; }
#hud .sculpt .k { color: #ffe9b8; }
#hud .sculpt .bad { color: #ff9d8a; }
#hud .sculpt .dim { opacity: 0.5; }

/* --- prayers --- */
/* Left column, under the title. The right side is already the rival panel on
   top and the barracks and grimoire at the bottom; a fourth stack there simply
   sat on top of the rivals, which is exactly what it did the first time. */
#hud .prayers {
  top: 96px; left: 16px; width: 268px;
  font-size: 11px; pointer-events: auto; display: none;
  max-height: calc(100vh - 420px); overflow-y: auto;
}
#hud .prayers.on { display: block; }
#hud .prayers h4 {
  margin: 0 0 6px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  opacity: 0.55; font-weight: 500;
}
#hud .prayers h4 .n { color: #ffe9b8; opacity: 1; }
#hud .prayers .row {
  padding: 4px 5px; border-radius: 5px; cursor: pointer; line-height: 1.4;
  border-left: 2px solid rgba(255,233,184,0.5); margin-bottom: 4px;
  background: rgba(255,255,255,0.03);
}
#hud .prayers .row:hover { background: rgba(120,170,220,0.20); }
#hud .prayers .row.urgent { border-left-color: #ff9d8a; }
#hud .prayers .row.sel { background: rgba(255,220,140,0.18); }
#hud .prayers .row .say { color: #fff3d9; }
#hud .prayers .row .meta { font-size: 10px; opacity: 0.5; }
#hud .prayers .row .bar { height: 2px; margin-top: 3px; border-radius: 1px; background: rgba(255,255,255,0.12); }
#hud .prayers .row .bar i { display: block; height: 100%; border-radius: 1px; background: #ffe9b8; }
#hud .prayers .row.urgent .bar i { background: #ff9d8a; }
#hud .prayers .none { opacity: 0.4; font-size: 10px; }

#hud .prayerdetail {
  top: 96px; left: 300px; width: 236px; font-size: 11px;
  pointer-events: auto; display: none;
}
#hud .prayerdetail.on { display: block; }
#hud .prayerdetail h4 {
  margin: 0 0 4px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  opacity: 0.55; font-weight: 500;
}
#hud .prayerdetail .say { color: #fff3d9; font-size: 12px; line-height: 1.45; margin-bottom: 6px; }
#hud .prayerdetail .k { opacity: 0.5; }
#hud .prayerdetail .v { color: #ffe9b8; }
#hud .prayerdetail .line { display: flex; justify-content: space-between; gap: 10px; }
#hud .prayerdetail .close {
  margin-top: 7px; font-size: 10px; opacity: 0.55; cursor: pointer;
  text-align: right;
}
#hud .prayerdetail .close:hover { opacity: 1; color: #ffe9b8; }

/* --- the creature -----------------------------------------------------------
   Bottom-centre-left: the strip between the controls panel and the build hint,
   which is the one piece of the frame nothing else wanted. Near where the eye
   already is while you are commanding the animal.

   BUILT ONCE AND THEN ONLY MEASURED. Every bar width is set as an inline style
   on a cached element rather than by rewriting innerHTML, because rewriting it
   would destroy and recreate the nodes every frame - which costs layout and,
   more to the point, throws away the CSS transitions that do all the animation
   here for free. */
#hud .beast {
  bottom: 16px; left: 332px; width: 244px; padding: 9px 12px 10px;
  font-variant-numeric: tabular-nums;
  transition: opacity 0.2s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
#hud .beast.gone { opacity: 0; pointer-events: none; }
/* At war the whole panel takes the warning colour. One cue, not five. */
#hud .beast.war {
  border-color: rgba(255,157,138,0.55);
  box-shadow: 0 8px 26px rgba(0,0,0,0.35), 0 0 18px rgba(255,110,90,0.20);
}
#hud .beast .hd { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; }
#hud .beast .nm {
  font-size: 12.5px; color: #fff3d9; letter-spacing: 0.16em; text-transform: uppercase;
}
#hud .beast .tr {
  font-size: 9.5px; opacity: 0.45; letter-spacing: 0.08em; margin-left: auto;
  text-align: right; line-height: 1.25;
}

/* A bar is a track, a ghost that lags behind it, and the fill itself. The
   ghost is what makes a hit read as a hit: the fill snaps down, the ghost
   drains after it a beat later. */
#hud .beast .bar {
  position: relative; height: 9px; border-radius: 3px; margin-bottom: 3px;
  background: rgba(255,255,255,0.09);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.45);
  overflow: hidden;
}
#hud .beast .bar i, #hud .beast .bar u {
  position: absolute; inset: 0 auto 0 0; display: block; border-radius: 3px;
}
#hud .beast .bar u {                     /* the ghost */
  background: rgba(255,120,100,0.45);
  transition: width 0.55s cubic-bezier(.4,0,.2,1) 0.22s;
}
#hud .beast .bar i {                     /* the fill */
  transition: width 0.18s cubic-bezier(.4,0,.2,1), background-color 0.4s ease;
  box-shadow: 0 0 8px currentColor;
}
/* Notches, so a bar reads as a gauge rather than a smear of colour. */
#hud .beast .bar::after {
  content: ''; position: absolute; inset: 0; border-radius: 3px; pointer-events: none;
  background: repeating-linear-gradient(90deg,
    rgba(0,0,0,0) 0 11px, rgba(0,0,0,0.34) 11px 12px);
}
#hud .beast .lg {
  display: flex; justify-content: space-between; gap: 8px;
  font-size: 9px; letter-spacing: 0.13em; text-transform: uppercase;
  opacity: 0.5; margin: 0 1px 6px;
}
#hud .beast .lg .v { opacity: 0.95; color: #efe9dd; letter-spacing: 0.06em; }

#hud .beast .ft {
  display: flex; align-items: center; gap: 7px; margin-top: 8px;
  padding-top: 7px; border-top: 1px solid rgba(255,255,255,0.10);
  font-size: 10px;
}
/* THE BLESSING ROW. Hidden by height rather than by display:none so that it
   opens and closes smoothly - the panel is pinned to a corner and a row that
   pops into existence shoves everything above it. */
#hud .beast .bless {
  position: relative; display: flex; align-items: baseline; gap: 6px;
  height: 0; opacity: 0; overflow: hidden; margin: 0;
  transition: height 0.22s ease, opacity 0.22s ease, margin 0.22s ease;
}
#hud .beast .bless.on { height: 13px; opacity: 1; margin: 3px 0 5px; }
#hud .beast .bless .tier {
  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  text-shadow: 0 0 10px currentColor;
}
#hud .beast .bless .mult { font-size: 9px; opacity: 0.5; letter-spacing: 0.06em; }
/* The countdown runs under the words rather than beside them: the row is a
   deadline, and a bar draining left to right says that without a number. */
#hud .beast .bless u {
  position: absolute; left: 0; bottom: 0; height: 1.5px; border-radius: 1px;
  transition: width 0.25s linear; box-shadow: 0 0 8px currentColor;
}

#hud .beast .leash { display: flex; align-items: center; gap: 5px; opacity: 0.75; }
#hud .beast .pip { width: 7px; height: 7px; border-radius: 50%; flex: none; box-shadow: 0 0 7px currentColor; }
#hud .beast .st { margin-left: auto; letter-spacing: 0.11em; text-transform: uppercase; font-size: 9px; }
#hud .beast .st.hot { color: #ff9d8a; animation: beastpulse 1.1s ease-in-out infinite; }
#hud .beast .st.cold { color: #8fb0d8; }
#hud .beast .st.calm { opacity: 0.45; }
@keyframes beastpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.42; } }
/* Under a third of its health the bar itself breathes. The colour already says
   "bad"; this says "now". */
#hud .beast .bar i.crit { animation: beastcrit 0.85s ease-in-out infinite; }
@keyframes beastcrit {
  0%,100% { box-shadow: 0 0 8px currentColor; }
  50%     { box-shadow: 0 0 16px currentColor, 0 0 26px currentColor; }
}

/* --- placement banner --- */
#hud .placing {
  bottom: 84px; left: 50%; transform: translateX(-50%);
  text-align: center; opacity: 0; transition: opacity 0.15s ease;
}
#hud .placing.on { opacity: 1; }
#hud .placing .bad { color: #ff9d8a; }
#hud .placing .ok { color: #9be08a; }
`;

export function initUi(state) {
  const hud = document.getElementById('hud');

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  hud.innerHTML = `
    <div class="panel title">
      <h2>DIVINITY</h2>
      <div class="sub" id="hud-island">An island, a people, a beast</div>
      <div class="sub" id="hud-sky"></div>
    </div>
    <div class="panel res" id="hud-res"></div>
    <div class="panel align" id="hud-align"></div>
    <div class="cast" id="hud-cast"></div>
    <div class="ending" id="hud-ending"></div>
    <div class="panel raids" id="hud-raids"></div>
    <div class="panel prayers" id="hud-prayers"></div>
    <div class="panel prayerdetail" id="hud-prayerdetail"></div>
    <div class="panel barracks" id="hud-barracks"></div>
    <div class="panel grimoire" id="hud-grimoire"></div>
    <div class="panel controls" id="hud-controls">
      <div><b>WASD</b> or <b>arrows</b> &mdash; move around the map</div>
      <div><b>Shift + drag</b> &mdash; raise / lower &nbsp; <b>Shift + Alt + drag</b> &mdash; level</div>
      <div><b>Shift + wheel</b> &mdash; brush size</div>
      <div><b>Left-drag ground</b> &mdash; pan</div>
      <div><b>Left-hold object</b> &mdash; pick up / throw</div>
      <div><b>Wheel</b> &mdash; zoom (raise/lower while held)</div>
      <div><b>Ctrl + click</b> &mdash; cast a miracle &nbsp; <b>Ctrl + wheel</b> &mdash; pick one</div>
      <div><b>Right-click</b> ground &mdash; send your creature there</div>
      <div><b>Right-drag</b> &mdash; set the ground it should hold</div>
      <div><b>Right-click</b> the creature &mdash; let it roam free</div>
      <div><b>Both buttons</b> (or middle / Alt+drag / <b>Q,E</b>) &mdash; orbit</div>
      <div><b>Drag on creature</b> &mdash; slow = stroke, fast = slap</div>
      <div><b>1-4</b> leash: learn / compassion / aggression / free</div>
      <div><b>2</b> + send it into a rival town &mdash; it performs, they come over</div>
      <div><b>Drag the banner</b> &mdash; send your platoon</div>
      <div><b>K</b> achievements &nbsp; <b>R</b> prayers &nbsp; <b>Tab</b> reckoning &nbsp; <b>M</b> mute &nbsp; <b>N</b> new island</div>
      <div><b>B</b> build &nbsp; <b>C</b> creature &nbsp; <b>G</b> mind &nbsp; <b>F</b> debug &nbsp; <b>P</b> pause</div>
      <div><b>V</b> bless your creature &mdash; ${BLESSING.COST} belief, a random ${BLESSING.MIN}-${BLESSING.MAX}x attack</div>
      <div><b>\`</b> &mdash; the <b>/dev</b> panel, with cheats</div>
    </div>
    <div class="panel buildbar" id="hud-buildbar">
      <div class="hint">Press <b>B</b> to build</div>
    </div>
    <div class="panel beast" id="hud-beast"></div>
    <div class="panel placing" id="hud-placing"></div>
    <div class="panel sculpt" id="hud-sculpt"></div>
    <div class="panel mind hidden" id="hud-mind"></div>
    <div class="panel rivals" id="hud-rivals"></div>
    <div class="panel stats hidden" id="hud-stats"></div>
    <div class="panel carry" id="hud-carry"></div>
    <div class="radial" id="hud-radial"></div>
    <div class="zoo" id="hud-zoo"></div>
    <div class="acts" id="hud-acts"></div>
    <div class="awardflash" id="hud-awardflash"></div>
    <div class="award" id="hud-award"></div>
    <div class="toast" id="hud-toast"></div>
  `;

  const elStats = document.getElementById('hud-stats');
  const elCarry = document.getElementById('hud-carry');
  const elToast = document.getElementById('hud-toast');
  const elActs = document.getElementById('hud-acts');
  const elAward = document.getElementById('hud-award');
  const elAwardFlash = document.getElementById('hud-awardflash');
  const elSculpt = document.getElementById('hud-sculpt');
  const elPrayers = document.getElementById('hud-prayers');
  const elPrayerDetail = document.getElementById('hud-prayerdetail');
  // The island's name and seed, written once. `?seed=<number>` replays it, and
  // the whole point of rolling a new world every game is being able to keep the
  // one you liked.
  const elIsland = document.getElementById('hud-island');
  const elSky = document.getElementById('hud-sky');
  if (elIsland && state.island) {
    elIsland.textContent = `${state.island.name} · seed ${state.island.seed}`;
    elIsland.title = 'Replay this island with ?seed=' + state.island.seed;
  }
  const elRes = document.getElementById('hud-res');
  const elRadial = document.getElementById('hud-radial');
  const elPlacing = document.getElementById('hud-placing');
  const elMind = document.getElementById('hud-mind');
  const elRivals = document.getElementById('hud-rivals');
  const elAlign = document.getElementById('hud-align');
  const elCast = document.getElementById('hud-cast');
  const elGrimoire = document.getElementById('hud-grimoire');
  const elBarracks = document.getElementById('hud-barracks');
  const elRaids = document.getElementById('hud-raids');
  const elEnding = document.getElementById('hud-ending');
  const elZoo = document.getElementById('hud-zoo');

  let debugVisible = false;
  /** Set to run one score reconciliation pass on the next debug render. */
  let reckValidate = false;
  let lastValidation = null;
  let mindVisible = false;
  let toastTimer = 0;
  let statsTimer = 0;
  let resTimer = 0;
  let mindTimer = 0;
  let radialOpen = false;
  let zooOpen = false;

  // --- radial build menu ----------------------------------------------------
  const RES_COLORS = { food: '#d8b44a', wood: '#6f8f4a', ore: '#9a948c', belief: '#8fd8ff' };

  /**
   * Draw the radial menu as SVG wedges around a screen point. Rebuilt on open
   * (not per frame) so affordability is sampled once, when it matters.
   */
  function buildRadial(cx, cy) {
    const keys = Object.keys(BUILDINGS);
    const n = keys.length;
    const rIn = 52;
    const rOut = 128;
    const size = (rOut + 60) * 2;

    let svg = `<svg width="${size}" height="${size}" style="left:${cx - size / 2}px;top:${cy - size / 2}px">`;
    const O = size / 2;

    keys.forEach((key, i) => {
      const def = BUILDINGS[key];
      // Leave a small gap between wedges so they read as separate targets.
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.03;
      const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.03;
      const p = (r, a) => `${(O + Math.cos(a) * r).toFixed(1)},${(O + Math.sin(a) * r).toFixed(1)}`;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M ${p(rIn, a0)} L ${p(rOut, a0)} A ${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)} Z`;

      const affordable = state.town ? state.town.canAfford(def) : true;
      const am = (a0 + a1) / 2;
      const lx = O + Math.cos(am) * (rIn + rOut) / 2;
      const ly = O + Math.sin(am) * (rIn + rOut) / 2;
      const cost = Object.entries(def.cost).map(([r, v]) => `${v} ${r}`).join('  ');

      svg += `<path class="wedge${affordable ? '' : ' poor'}" data-key="${key}" d="${d}"></path>`;
      svg += `<text x="${lx.toFixed(1)}" y="${(ly - 2).toFixed(1)}">${def.label}</text>`;
      svg += `<text class="cost${affordable ? '' : ' poorcost'}" x="${lx.toFixed(1)}" y="${(ly + 15).toFixed(1)}">${cost}</text>`;
    });

    svg += `<text class="hubtext" x="${O}" y="${O + 4}">esc</text></svg>`;
    elRadial.innerHTML = svg;

    elRadial.querySelectorAll('.wedge').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const key = el.getAttribute('data-key');
        const def = BUILDINGS[key];
        if (state.town && !state.town.canAfford(def)) {
          toast(`Not enough resources for a ${def.label}`);
          return;
        }
        closeBuildMenu();
        state.town?.beginPlacement(key);
      });
    });
  }

  function openBuildMenu() {
    if (radialOpen) return;
    radialOpen = true;
    const rect = state.renderer.domElement.getBoundingClientRect();
    buildRadial(rect.width / 2, rect.height / 2);
    elRadial.classList.add('on');
  }

  function closeBuildMenu() {
    radialOpen = false;
    elRadial.classList.remove('on');
    elRadial.innerHTML = '';
  }

  function toggleBuildMenu() {
    if (radialOpen) closeBuildMenu();
    else openBuildMenu();
  }

  // Clicking the backdrop (outside any wedge) dismisses the menu.
  elRadial.addEventListener('pointerdown', () => closeBuildMenu());

  // --- animal picker --------------------------------------------------------
  /**
   * Grid of every animal in the Cube Pets kit, using the pack's own preview
   * renders as thumbnails - so what you click is exactly what you get, with no
   * hand-maintained icon list to fall out of sync.
   */
  function renderZoo() {
    const c = state.creature;
    if (!c) return;
    const cells = c.animals.map((a) => {
      const active = a.key === c.animal ? ' active' : '';
      const img = a.preview ? `<img src="${a.preview}" alt="">` : '';
      // The temperament is the whole reason this screen is a choice and not a
      // wardrobe, so it goes on the card rather than being discovered later.
      const temper = (PET_TEMPERAMENT[a.key] ?? [])
        .map((k) => CREATURE_TRAITS[k]?.label ?? k).join(' &middot; ');
      // Nature and weight: the two things that decide what happens when this
      // body meets another god's in the open. See PET_KIND.
      const k = PET_KIND[a.key];
      const nat = k ? NATURES[k.nature] : null;
      const badge = k && nat
        ? `<span class="nat" style="--nat:${nat.color}"><b>${nat.label}</b> ` +
          `<em>&times;${k.weight.toFixed(2)}</em></span>`
        : '';
      return `<div class="cell${active}" data-key="${a.key}">${img}<span>${a.label}</span>` +
        `${badge}<span class="temper">${temper}</span></div>`;
    }).join('');
    elZoo.innerHTML =
      `<div class="panel2"><h3>Choose your creature</h3>` +
      `<p class="sub2">It keeps everything it has learned &mdash; but the body ` +
      `brings its own temperament, and that changes how it fights and learns.<br>` +
      `<span class="ring">` +
      `<b style="color:${NATURES.hunter.color}">Hunter</b> runs down ` +
      `<b style="color:${NATURES.runner.color}">Runner</b> &rarr; ` +
      `<b style="color:${NATURES.runner.color}">Runner</b> circles ` +
      `<b style="color:${NATURES.bulwark.color}">Bulwark</b> &rarr; ` +
      `<b style="color:${NATURES.bulwark.color}">Bulwark</b> shrugs off ` +
      `<b style="color:${NATURES.hunter.color}">Hunter</b>. ` +
      `The number is raw strength.</span></p>` +
      `<div class="grid">${cells}</div></div>`;

    elZoo.querySelectorAll('.cell').forEach((el) => {
      el.addEventListener('pointerdown', async (e) => {
        e.stopPropagation();
        const key = el.getAttribute('data-key');
        closeZoo();
        const ok = await state.creature.setAnimal(key);
        if (ok) toast(state.creature.animals.find((a) => a.key === key)?.label ?? key);
      });
    });
  }

  function openZoo() {
    if (zooOpen) return;
    zooOpen = true;
    renderZoo();
    elZoo.classList.add('on');
  }
  function closeZoo() {
    zooOpen = false;
    elZoo.classList.remove('on');
    elZoo.innerHTML = '';
  }
  function toggleZoo() { zooOpen ? closeZoo() : openZoo(); }
  elZoo.addEventListener('pointerdown', () => closeZoo());

  // --- achievements -------------------------------------------------------
  //
  // Rendered on open and never on a timer. The list only changes when something
  // is earned, and rebuilding fifty rows of DOM every frame to show a progress
  // bar that moves once a minute would be the most expensive thing in the HUD.
  let actsOpen = false;

  function renderActs() {
    const all = state.achievements?.list ?? [];
    const groups = [];
    for (const a of all) {
      let g = groups.find((x) => x.name === a.group);
      if (!g) groups.push(g = { name: a.group, items: [] });
      g.items.push(a);
    }

    const body = groups.map((g) => {
      const rows = g.items.map((a) => {
        const cls = a.earned ? (a.fresh ? 'row got fresh' : 'row got') : 'row';
        // Earned rows read as a date, not "50/50" - once you have it, what you
        // want to know is when.
        const right = a.earned
          ? new Date(a.earnedAt).toLocaleDateString()
          : `${Math.floor(a.have)}/${a.need}`;
        const w = (a.progress * 100).toFixed(1);
        return `<div class="${cls}">` +
          `<div class="nm">${a.earned ? '&#9733; ' : ''}${a.name}</div>` +
          `<div class="bl">${a.blurb}</div>` +
          `<div class="pct">${right}</div>` +
          `<div class="bar" style="width:${w}%"></div></div>`;
      }).join('');
      return `<div class="grouphead">${g.name}</div><div class="rows">${rows}</div>`;
    }).join('');

    const got = state.achievements?.earnedCount ?? 0;
    const total = state.achievements?.total ?? 0;
    elActs.innerHTML =
      `<div class="panel2">` +
      `<div class="head"><h3>Achievements</h3><span class="tally">${got} / ${total}</span></div>` +
      `<p class="sub2">What you have done here, and what is still undone. ` +
      `Kept between games.</p>` +
      `<div class="scroll">${body}</div></div>`;
  }

  function openActs() {
    if (actsOpen) return;
    actsOpen = true;
    renderActs();
    elActs.classList.add('on');
  }
  function closeActs() {
    actsOpen = false;
    elActs.classList.remove('on');
    elActs.innerHTML = '';
  }
  function toggleActs() {
    actsOpen ? closeActs() : openActs();
    state.sound?.ui(actsOpen ? 'open' : 'close');
  }
  // Click anywhere off the panel to dismiss, same as the creature chooser.
  elActs.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.panel2')) closeActs();
  });

  // --- achievement announcements ------------------------------------------
  //
  // Queued, not stacked. Several achievements often land on the same tick -
  // laying a fiftieth building can trip Hamlet, Village and Township at once -
  // and three cards fighting over the same patch of screen reads as a glitch.
  // They wait their turn instead, which also makes each one legible.
  const awardQueue = [];
  let awardTimer = 0;
  let awardShowing = false;

  const AWARD_HOLD = 3.6;   // seconds the card stays up
  const AWARD_GAP = 0.42;   // dead time between cards, so the swap is visible

  function announceAchievement(a) {
    awardQueue.push(a);
    // If the menu happens to be open, it is now out of date - it renders once
    // on open precisely so it is not rebuilt every frame, which means the one
    // moment it CAN go stale is this one.
    if (actsOpen) renderActs();
  }

  function showNextAward() {
    const a = awardQueue.shift();
    if (!a) return;
    const got = state.achievements?.earnedCount ?? 0;
    const total = state.achievements?.total ?? 0;

    // Eight sparks on their own bearings, thrown from behind the star. Built
    // into the card's markup rather than animated in JS: the whole burst is one
    // CSS animation per span and it cleans itself up when the card is rebuilt.
    let sparks = '';
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.4;
      const dist = 34 + (i % 3) * 13;
      sparks += `<span class="spark" style="--dx:${(Math.cos(ang) * dist).toFixed(0)}px;` +
                `--dy:${(Math.sin(ang) * dist).toFixed(0)}px;` +
                `animation-delay:${(i * 0.018).toFixed(3)}s"></span>`;
    }

    elAward.innerHTML =
      `<div class="shine"></div>` +
      `<div class="rays"></div>` +
      sparks +
      `<div class="star">&#9733;</div>` +
      `<div class="txt">` +
        `<div class="kicker">Achievement unlocked</div>` +
        `<div class="nm2">${a.name}</div>` +
        `<div class="bl2">${a.blurb}</div>` +
      `</div>` +
      `<div class="tally2">${got} / ${total}<br><span style="opacity:0.6">press K</span></div>`;
    elAward.classList.add('on');

    // Retrigger the full-frame bloom. It is one persistent element, so the
    // animation has to be taken off and put back with a reflow in between -
    // without the forced reflow the browser coalesces both changes and nothing
    // replays.
    elAwardFlash.classList.remove('go');
    void elAwardFlash.offsetWidth;
    elAwardFlash.classList.add('go');

    awardShowing = true;
    awardTimer = AWARD_HOLD;
  }

  function updateAwards(dt) {
    if (awardShowing) {
      awardTimer -= dt;
      if (awardTimer <= 0) {
        elAward.classList.remove('on');
        awardShowing = false;
        awardTimer = AWARD_GAP;
      }
      return;
    }
    if (awardTimer > 0) { awardTimer -= dt; return; }
    if (awardQueue.length) showNextAward();
  }

  // --- prayers -------------------------------------------------------------
  //
  // Rebuilt only when the set of prayers actually changes, not every frame.
  // The list moves when someone starts or stops asking, which is a handful of
  // times a minute - re-rendering fifty times a second to animate one time bar
  // is the same mistake the achievements menu deliberately avoids.
  let prayersOpen = true;
  let prayerSig = '';

  // A quiet word when something ends. Deliberately NOT the achievement card:
  // a prayer resolving is ordinary life, not a trophy, and one fires every
  // minute or two.
  state.events?.on('prayer-resolved', (e) => {
    if (e.status === 'answered' && e.by !== 'nobody') {
      toast(e.urgency >= 0.6 ? 'A desperate prayer is answered' : 'A prayer is answered', 2.0);
    } else if (e.status === 'failed') {
      toast('A prayer goes unanswered', 2.0);
    } else if (e.status === 'expired') {
      toast('They stopped asking', 1.6);
    }
    prayerSig = '';
  });
  state.events?.on('prayer-raised', () => { prayerSig = ''; });

  // --- awe, said out loud ---------------------------------------------------
  //
  // The peaceful route to a town has worked since Phase 9 and has never once
  // announced itself. A player could fill a rival's meter to ninety percent by
  // casting where they could see, and the only sign of it was a bar labelled
  // with a bare number in a corner panel.
  //
  // So it speaks at the quarters, and it speaks in BOTH DIRECTIONS - a rival
  // god courting one of your towns is a way to lose one, and it was completely
  // silent. Once per town per faction per mark: `crossed` is keyed on all
  // three, and its size is bounded by towns x factions x marks.
  const AWE_MARKS = [0.25, 0.5, 0.75, 0.9];
  const aweSaid = new Set();
  // A RIVAL GOD REACHED DOWN. Worth a toast even though it is happening to
  // somebody else's animal: it is the only signal the player gets that the
  // other four gods have the same button, and a beast that suddenly hits three
  // times harder with no explanation reads as a bug.
  state.events?.on('creature-blessed', (e) => {
    if (e?.isHuman) return;      // the player's own is announced by main.js
    const c = state.creatures?.find((x) => x.faction === e.faction);
    toast(`${c?.ownerName ?? 'A rival god'} blesses its beast — ${e.tier}`);
  });

  state.events?.on('awe-changed', (e) => {
    if (!e?.town) return;
    const mine = e.by === 0;
    // Only what concerns the player: your progress on somebody, or somebody's
    // progress on you. Two rivals courting each other is not your business.
    if (!mine && e.town.owner !== 0) return;
    for (const m of AWE_MARKS) {
      if (e.from >= m || e.to < m) continue;
      const key = `${e.town.index}:${e.by}:${m}`;
      if (aweSaid.has(key)) continue;
      aweSaid.add(key);
      const pct = Math.round(m * 100);
      if (mine) {
        toast(m >= 0.9
          ? `${e.town.name} is nearly yours — ${pct}% in awe of you`
          : `${e.town.name} is ${pct}% won over`, 2.2);
      } else {
        const who = state.factions?.[e.by]?.name ?? 'A rival';
        toast(m >= 0.9
          ? `${e.town.name} is about to leave you for ${who}`
          : `${who} is winning ${e.town.name} over — ${pct}%`, 2.4);
      }
    }
  });

  function togglePrayers() {
    prayersOpen = !prayersOpen;
    if (!prayersOpen) state.prayers?.clearSelection();
    prayerSig = '';
  }

  function renderPrayers() {
    const P = state.prayers;
    if (!P) return;
    // The creature's mind panel shares this corner. One at a time.
    const blocked = mindVisible;
    const list = P.active;
    const sel = P.selected;

    // Signature covers everything the markup depends on, including the coarse
    // time bucket, so the bar still moves without a rebuild per frame.
    const sig = prayersOpen + '|' + blocked + '|' + (sel?.id ?? 0) + '|' + list
      .map((p) => `${p.id}:${Math.round(P.remainingOf(p) * 12)}`).join(',');
    if (sig === prayerSig) return;
    prayerSig = sig;

    elPrayers.classList.toggle('on', prayersOpen && !blocked);
    if (!prayersOpen || blocked) { elPrayerDetail.classList.remove('on'); return; }

    let h = `<h4>Prayers <span class="n">${list.length}</span></h4>`;
    if (!list.length) {
      h += '<div class="none">Nobody is asking for anything.</div>';
    } else {
      // Loudest first: urgency, then whoever has been waiting longest.
      const shown = [...list].sort((a, b) =>
        (b.urgency - a.urgency) || (a.born - b.born));
      for (const p of shown) {
        const urgent = P.isUrgent(p);
        const cls = 'row' + (urgent ? ' urgent' : '') + (sel === p ? ' sel' : '');
        const left = Math.round(P.remainingOf(p) * 100);
        h += `<div class="${cls}" data-p="${p.id}">` +
          `<div class="say">${P.textOf(p)}</div>` +
          `<div class="meta">${P.labelOf(p)} &middot; ${p.townName}` +
          `${urgent ? ' &middot; urgent' : ''}</div>` +
          `<div class="bar"><i style="width:${left}%"></i></div></div>`;
      }
    }
    elPrayers.innerHTML = h;

    elPrayers.querySelectorAll('.row[data-p]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const id = +el.getAttribute('data-p');
        const p = state.prayers.active.find((x) => x.id === id);
        if (!p) return;
        state.prayers.select(p);
        // Go and look at them. focus() is the camera's own entry point, so
        // this cannot destabilise the controls.
        const at = state.prayers.positionOf(p);
        if (at) state.camera?.focus?.(at.x, at.z, Math.min(state.camera.dist, 110));
        prayerSig = '';
      });
    });

    // --- the detail card ---
    if (!sel) { elPrayerDetail.classList.remove('on'); return; }
    elPrayerDetail.classList.add('on');
    const secs = Math.max(0, Math.round(sel.expires - state.time));
    elPrayerDetail.innerHTML =
      `<h4>${P.labelOf(sel)}</h4>` +
      `<div class="say">&ldquo;${P.textOf(sel)}&rdquo;</div>` +
      `<div class="line"><span class="k">Asked by</span>` +
        `<span class="v">${sel.who}</span></div>` +
      `<div class="line"><span class="k">Town</span>` +
        `<span class="v">${sel.townName}</span></div>` +
      `<div class="line"><span class="k">Urgency</span>` +
        `<span class="v">${P.isUrgent(sel) ? 'Urgent' : 'Ordinary'}</span></div>` +
      `<div class="line"><span class="k">Time left</span>` +
        `<span class="v">${secs}s</span></div>` +
      `<div class="line"><span class="k">Wants</span></div>` +
      `<div class="say" style="font-size:11px">${P.wantOf(sel)}</div>` +
      `<div class="close" id="prayer-close">Close &mdash; leave it unanswered</div>`;
    const close = elPrayerDetail.querySelector('#prayer-close');
    if (close) {
      close.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        // Dismisses the card, not the prayer. They are still asking.
        state.prayers.clearSelection();
        prayerSig = '';
      });
    }
  }

  function toast(text, seconds = 1.6) {
    // Every refusal in the game arrives through here - "not enough wood", "the
    // ground under it will not move", "needs another barracks". One listener
    // rather than a call at each of the thirty-odd sites that produce one.
    state.sound?.ui('refuse');
    elToast.textContent = text;
    elToast.classList.add('on');
    toastTimer = seconds;
  }

  function setDebugVisible(v) {
    debugVisible = v;
    elStats.classList.toggle('hidden', !debugVisible);
    // One reconciliation pass each time the panel is opened, rather than every
    // frame it is up: it recomputes every score from source, which is a full
    // extra pass and not something to do sixty times a second.
    if (v) reckValidate = true;
  }

  function setMindVisible(v) {
    mindVisible = v;
    elMind.classList.toggle('hidden', !mindVisible);
  }

  // --- creature mind panel --------------------------------------------------
  const DESIRE_COLORS = {
    eat: '#d8b44a', sleep: '#8f9ad8', play: '#7fd4ff',
    attack: '#e0553f', help: '#9be08a', impress: '#e2a6f0'
  };

  function meter(name, value, max, color) {
    const pct = Math.max(0, Math.min(1, value / max)) * 100;
    return `<div class="bar"><span class="n">${name}</span>` +
      `<span class="t"><span class="f" style="width:${pct.toFixed(0)}%;background:${color}"></span></span>` +
      `<span class="v">${value.toFixed(2)}</span></div>`;
  }

  /** Opinion cells are tinted red through green so the table reads at a glance. */
  function opinionCell(v) {
    const a = Math.min(1, Math.abs(v));
    const bg = v >= 0
      ? `rgba(120,220,130,${(a * 0.55).toFixed(2)})`
      : `rgba(235,90,70,${(a * 0.55).toFixed(2)})`;
    return `<span class="c" style="background:${bg}">${v >= 0 ? '+' : ''}${v.toFixed(2)}</span>`;
  }

  function renderMind() {
    const c = state.creature;
    if (!c) { elMind.innerHTML = '<h3>Creature</h3><div style="opacity:.5">not yet born</div>'; return; }

    let h = `<h3>Creature mind</h3>`;
    const temper = c.temperamentLabels;
    const grown = c.earnedLabels ?? [];
    if (temper.length || grown.length) {
      h += `<div class="temperline">${temper.join(' &middot; ')}` +
        (grown.length ? `<span class="grown"> + ${grown.join(' &middot; ')}</span>` : '') +
        `</div>`;
    }
    h += `<div class="sect"><div class="head4">needs</div>`;
    h += meter('hunger', c.needs.hunger, 1, '#e0553f');
    h += meter('energy', c.needs.energy, 1, '#7fd4ff');
    h += meter('clean', c.needs.cleanliness, 1, '#9be08a');
    h += `</div>`;

    // War: only worth the space when it means something.
    if (c.atWar || c.health < c.maxHealth) {
      const x = c.atWar ? ' <b style="color:#e0553f">&times;2</b>' : '';
      h += `<div class="sect"><div class="head4">` +
        (c.atWar ? 'at war &mdash; under the banner'
          : c.routedFor > 0 ? `routed &mdash; back in ${Math.ceil(c.routedFor)}s` : 'recovering') +
        `</div>`;
      h += meter('health', c.health / c.maxHealth, 1, '#e0553f');
      h += `<div class="leash" style="margin-top:4px">attack ${c.attack.toFixed(2)}${x} ` +
        `&middot; defense ${c.defense.toFixed(2)}${x}</div>`;
      h += `</div>`;
    }

    h += `<div class="sect"><div class="head4">desires (learned)</div>`;
    for (const [k, v] of Object.entries(c.desires)) {
      h += meter(k, v, 2, DESIRE_COLORS[k] ?? '#ccc');
    }
    h += `</div>`;

    // Only objects it actually has an opinion about, strongest first.
    const ops = [...c.opinions.entries()]
      .filter(([, o]) => Math.abs(o.edibility) + Math.abs(o.fun) + Math.abs(o.threat) > 0.01)
      .sort((a, b) => {
        const s = (o) => Math.abs(o.edibility) + Math.abs(o.fun) + Math.abs(o.threat);
        return s(b[1]) - s(a[1]);
      })
      .slice(0, 7);

    h += `<div class="sect"><div class="head4">opinions</div>`;
    if (!ops.length) {
      h += `<div style="opacity:.45;font-size:10px">knows nothing yet</div>`;
    } else {
      h += `<div class="op"><span></span><span class="head4">edible</span><span class="head4">fun</span><span class="head4">threat</span></div>`;
      for (const [type, o] of ops) {
        h += `<div class="op"><span style="opacity:.65">${type}</span>` +
          opinionCell(o.edibility) + opinionCell(o.fun) + opinionCell(o.threat) + `</div>`;
      }
    }
    h += `</div>`;

    const a = c.action;
    h += `<div class="doing">${a ? `${a.desire}${a.targetType ? ' → ' + a.targetType : ''} (${a.phase})` : 'thinking…'}</div>`;
    h += `<div class="head4">thoughts</div>`;
    for (const line of c.log) {
      h += `<div class="logline">${line.text}</div>`;
    }
    // --- the town's traits, in aggregate. One villager out of 150 is not worth
    // clicking on; knowing your people are mostly Doubters is.
    const census = state.villagers?.traitCensus?.();
    if (census && census.size) {
      const rows = [...census.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      h += `<div class="sect"><div class="head4">your people</div>`;
      for (const [key, n] of rows) {
        h += `<div class="op2"><span>${TRAITS[key]?.label ?? key}</span><span>${n}</span></div>`;
      }
      h += `</div>`;
    }

    h += `<div class="leash">${state.creature.leash} leash &middot; ` +
      `size ${c.scale.toFixed(2)} &middot; lessons ${c.lessons} &middot; curiosity ${c.curiosity.toFixed(2)}</div>`;

    elMind.innerHTML = h;
  }

  function row(k, v, cls = '') {
    return `<div class="row"><span class="k">${k}</span><span class="${cls}">${v}</span></div>`;
  }

  function resItem(key, value, label) {
    return `<div class="item"><span class="dot" style="background:${RES_COLORS[key]}"></span>` +
      `<span class="amt">${value}</span><span class="lbl">${label}</span></div>`;
  }

  let endingShown = false;
  function renderEnding() {
    const o = state.outcome;
    if (!o) { if (endingShown) { elEnding.classList.remove('on'); endingShown = false; } return; }
    if (endingShown) return;          // built once; nothing on it changes after

    // Phase 17 took this over. The Reckoning shows every participant ranked,
    // itemised and explained; this card showed five numbers about the player
    // and offered a reload. It stays in the file as the fallback for a world
    // with no scoring - if reckoning.js is ever absent, the game still tells
    // you it ended.
    if (state.reckoning) return;
    endingShown = true;

    const win = o.kind === 'victory';
    const mins = Math.floor(o.at / 60);
    const secs = Math.floor(o.at % 60).toString().padStart(2, '0');
    const align = state.alignment ?? 0;
    const stat = (n, k) => `<div><div class="n">${n}</div><div class="k">${k}</div></div>`;

    elEnding.className = `ending on ${win ? 'victory' : 'defeat'}`;
    elEnding.innerHTML =
      `<div>` +
      `<h1>${win ? 'You Win' : 'You Lose'}</h1>` +
      `<div class="epithet">${win ? 'Divinity' : 'Forsaken'}</div>` +
      `<div class="why">${o.reason}</div>` +
      `<div class="stats">` +
        stat(`${mins}:${secs}`, 'reigned') +
        stat(state.town.factionPopulation(0), 'people') +
        // Towns you HOLD that you did not found. `t.captured` alone would now
        // also count a town a rival took off another rival on the far side of
        // the island, which is somebody else's conquest entirely.
        stat(state.towns.filter((t) => t.owner === 0 && t.index !== 0).length, 'towns taken') +
        stat(align > 0.35 ? 'Merciful' : align < -0.35 ? 'Cruel' : 'Undecided', 'remembered as') +
        stat(state.creature?.lessons ?? 0, 'lessons taught') +
      `</div>` +
      `<button id="ending-again">Begin again</button>` +
      `</div>`;

    elEnding.querySelector('#ending-again').addEventListener('click', () => {
      // A full reload rather than a reset: every system builds its world at
      // construction, and unpicking that would be a phase of its own.
      window.location.reload();
    });
  }

  function renderRaids() {
    const raids = state.combat?.raids ?? [];
    elRaids.classList.toggle('on', raids.length > 0);
    if (!raids.length) return;
    let h = '<div class="hd">armies on the march</div>';
    for (const r of raids) {
      const atYou = !!r.to.isPlayer;
      h += `<div class="line${atYou ? ' at-you' : ''}">` +
        `${r.from.name} &rarr; ${atYou ? 'YOU' : r.to.name} ` +
        `<span style="opacity:.6">&middot; ${r.strength}</span></div>`;
    }
    elRaids.innerHTML = h;
  }

  function renderBarracks() {
    const town = state.town;
    const list = town?.barracksOf ? town.barracksOf(town.playerTown) : [];
    elBarracks.classList.toggle('on', list.length > 0);
    if (!list.length) return;

    // Losses being made good, so a rebuild does not look like nothing happening.
    const owed = state.combat?.replacing?.(town.playerTown) ?? 0;
    let h = owed > 0
      ? `<h4>Barracks <span style="color:#ffb27a">&middot; replacing ${owed}</span></h4>`
      : '<h4>Barracks</h4>';
    list.forEach((b, i) => {
      const tier = town.tierOf(b);
      const next = town.nextTier(b);
      if (!next) {
        h += `<div class="row maxed"><span class="rank">${tier.label}</span>` +
          `<span class="cost">highest</span></div>`;
        return;
      }
      const afford = Object.entries(next.cost)
        .every(([r, a]) => (state.resources[r] ?? 0) >= a);
      const cost = Object.entries(next.cost).map(([r, a]) => `${a}${r[0]}`).join(' ');
      h += `<div class="row${afford ? '' : ' poor'}" data-b="${i}" ` +
        `title="Upgrade to ${next.label}">` +
        `<span class="rank">${tier.label}</span>` +
        `<span class="cost">&rarr; ${next.label} &middot; ${cost}</span></div>`;
    });
    // Siege train, built from the same panel: it comes out of a barracks and
    // costs what a dozen men cost, so it belongs next to the ranks.
    const built = state.combat?.enginesOf(town.playerTown) ?? 0;
    const cap = state.combat?.engineCap(town.playerTown) ?? 0;
    const eCost = Object.entries(COMBAT.ENGINE_COST).map(([r, a]) => `${a}${r[0]}`).join(' ');
    const canPay = Object.entries(COMBAT.ENGINE_COST)
      .every(([r, a]) => (state.resources[r] ?? 0) >= a);
    const full = built >= cap;
    h += `<div class="row engine${full || !canPay ? ' poor' : ''}"${full ? '' : ' data-engine="1"'}>` +
      `<span class="rank">Siege engine</span>` +
      `<span class="cost">${full ? `${built}/${cap}` : `&plus; ${eCost}`}</span></div>`;

    elBarracks.innerHTML = h;

    const eRow = elBarracks.querySelector('.row[data-engine]');
    if (eRow) {
      eRow.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const res = state.combat.buildEngine(state.town.playerTown);
        if (!res.ok) toast(res.reason);
        renderBarracks();
      });
    }

    elBarracks.querySelectorAll('.row[data-b]').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const b = list[+el.getAttribute('data-b')];
        const res = state.town.upgrade(b);
        if (!res.ok) toast(res.reason);
        renderBarracks();
      });
    });
  }

  let grimoireBuilt = false;
  function renderGrimoire() {
    const sel = state.miracles?.selected ?? null;
    const casting = state.miracles?.casting ?? false;
    let h = `<h4${casting ? ' class="live"' : ''}>` +
      (casting ? 'Casting &mdash; click to place' : 'Miracles &mdash; hold Ctrl, wheel to cycle') +
      `</h4>`;
    for (const [key, def] of Object.entries(MIRACLES)) {
      const afford = state.resources.belief >= def.cost;
      const col = '#' + def.color.toString(16).padStart(6, '0');
      h += `<div class="row${afford ? '' : ' poor'}${sel === key ? ' armed' : ''}" data-m="${key}">` +
        `<span class="dot" style="background:${col}"></span>` +
        `<span style="flex:1">${def.label}</span>` +
        `<span class="c">${def.cost}</span></div>`;
    }
    elGrimoire.innerHTML = h;

    elGrimoire.querySelectorAll('.row').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        // Stop the press reaching the canvas, or arming a miracle would also
        // start a camera pan under the panel.
        e.stopPropagation();
        e.preventDefault();
        const key = el.getAttribute('data-m');
        state.miracles.select(key);
        toast(`${MIRACLES[key].label} selected - hold Ctrl to cast`);
        renderGrimoire();
      });
    });
  }

  // --- the creature panel ---------------------------------------------------
  //
  // Health, stamina and how well fed it is, plus what it is doing about any of
  // that. The three things the player can actually act on: feed it, rest it,
  // pull it out of a fight.
  //
  // The DOM is built ONCE. Rewriting innerHTML each frame would recreate every
  // node, which throws away the CSS transitions that do all the animation here
  // - the lagging ghost bar in particular exists entirely because the element
  // survives from one frame to the next.
  const elBeast = document.getElementById('hud-beast');
  let beastDom = null;
  let beastTimer = 0;

  function buildBeastDom() {
    elBeast.innerHTML =
      `<div class="hd"><span class="nm" id="b-nm">&mdash;</span>` +
      `<span class="tr" id="b-tr"></span></div>` +
      `<div class="bar"><u id="b-hp-g"></u><i id="b-hp"></i></div>` +
      `<div class="lg"><span>Health</span><span class="v" id="b-hp-n"></span></div>` +
      `<div class="bar"><i id="b-st"></i></div>` +
      `<div class="lg"><span>Stamina</span><span class="v" id="b-st-n"></span></div>` +
      `<div class="bar"><i id="b-fd"></i></div>` +
      `<div class="lg"><span>Fed</span><span class="v" id="b-fd-n"></span></div>` +
      `<div class="bless" id="b-bless"><span class="tier" id="b-bless-t"></span>` +
      `<span class="mult" id="b-bless-m"></span>` +
      `<u id="b-bless-b"></u></div>` +
      `<div class="ft"><span class="leash"><span class="pip" id="b-pip"></span>` +
      `<span id="b-leash"></span></span><span class="st" id="b-state"></span></div>`;
    const id = (k) => document.getElementById(k);
    beastDom = {
      nm: id('b-nm'), tr: id('b-tr'),
      hp: id('b-hp'), hpGhost: id('b-hp-g'), hpNum: id('b-hp-n'),
      st: id('b-st'), stNum: id('b-st-n'),
      fd: id('b-fd'), fdNum: id('b-fd-n'),
      bless: id('b-bless'), blessTier: id('b-bless-t'),
      blessMult: id('b-bless-m'), blessBar: id('b-bless-b'),
      pip: id('b-pip'), leash: id('b-leash'), state: id('b-state')
    };
  }

  /** What the animal is doing, in two words, most alarming first. */
  function beastState(c) {
    if (!c.inField) return ['Driven off', 'cold'];
    if (c.atWar) return ['In the fight', 'hot'];
    if (c.health < c.maxHealth * 0.5) return ['Hurt', 'hot'];
    if (c.carrying) return [`Hauling ${c.carrying.type}`, 'calm'];
    const d = c.action?.desire;
    if (d === 'sleep') return ['Sleeping', 'calm'];
    if (d === 'eat') return ['Feeding', 'calm'];
    if (d === 'impress') return ['Performing', 'calm'];
    if (d === 'attack') return ['Hunting', 'hot'];
    if (d === 'help') return ['Working', 'calm'];
    if (d === 'play') return ['Playing', 'calm'];
    if (d === 'groom') return ['Grooming', 'calm'];
    return ['At ease', 'calm'];
  }

  function renderBeast(dt) {
    const c = state.creature;
    // Nothing to show before it hatches, or once the match is over and the
    // results screen owns the frame.
    const show = !!c && !!c.animal && !state.outcome;
    elBeast.classList.toggle('gone', !show);
    if (!show) return;
    if (!beastDom) buildBeastDom();

    // Ten times a second. Health and stamina move slowly and the CSS carries
    // the motion between updates, so there is nothing to gain from doing this
    // on the frame.
    beastTimer -= dt;
    if (beastTimer > 0) return;
    beastTimer = 0.1;

    const b = beastDom;
    const hpFrac = Math.max(0, Math.min(1, c.health / c.maxHealth));
    const stam = Math.max(0, Math.min(1, c.needs.energy));
    const fed = Math.max(0, Math.min(1, 1 - c.needs.hunger));

    // Health takes the colour of how bad it is: green, amber, red.
    const hpCol = hpFrac > 0.6 ? '#9be08a' : hpFrac > 0.3 ? '#ffc98a' : '#ff8a72';
    b.hp.style.width = `${hpFrac * 100}%`;
    b.hp.style.background = hpCol;
    b.hp.style.color = hpCol;                 // drives the bar's own glow
    b.hp.classList.toggle('crit', hpFrac <= 0.3);
    b.hpGhost.style.width = `${hpFrac * 100}%`;
    b.hpNum.textContent = `${c.health.toFixed(0)} / ${c.maxHealth}`;

    b.st.style.width = `${stam * 100}%`;
    b.st.style.background = '#8fd8ff';
    b.st.style.color = '#8fd8ff';
    b.stNum.textContent = `${Math.round(stam * 100)}%`;

    const fedCol = fed > 0.35 ? '#ffe9b8' : '#ff9d8a';
    b.fd.style.width = `${fed * 100}%`;
    b.fd.style.background = fedCol;
    b.fd.style.color = fedCol;
    b.fdNum.textContent = fed < 0.18 ? 'starving' : `${Math.round(fed * 100)}%`;

    // Name, species and the two traits it was born with - the reason it fights
    // and learns the way it does, so it belongs on the same panel as the bars.
    const species = (c.animal || '').replace(/^animal-/, '');
    const grown = Math.round(((c.scale - CREATURE.START_SCALE)
      / (CREATURE.MAX_SCALE - CREATURE.START_SCALE)) * 100);
    b.nm.textContent = species || 'creature';
    // Nature sits with the temperament because they are the same kind of fact:
    // what this body is, as opposed to what it currently has.
    const nat = NATURES[c.nature];
    b.tr.innerHTML = `${c.temperamentLabels.join(' &middot; ')}<br>` +
      `<span style="color:${nat?.color ?? '#efe9dd'}">${c.natureLabel}</span> ` +
      `&times;${c.weight.toFixed(2)} &middot; grown ${grown}%`;

    // The blessing, while one is running. The row collapses entirely when there
    // is none - a permanently empty bar labelled "blessing" would read as a
    // resource the player has failed to fill rather than a thing that happens.
    const tier = c.blessTier;
    b.bless.classList.toggle('on', !!tier);
    if (tier) {
      b.blessTier.textContent = tier.label;
      b.blessTier.style.color = tier.color;
      b.blessMult.textContent = `${c.blessMult.toFixed(1)}x attack`;
      b.blessBar.style.width = `${(c.blessLeft / BLESSING.SECONDS) * 100}%`;
      b.blessBar.style.background = tier.color;
      b.blessBar.style.color = tier.color;
    }

    const mode = LEASH_MODES[c.leash];
    b.pip.style.background = '#' + (mode?.color ?? 0xffffff).toString(16).padStart(6, '0');
    b.pip.style.color = b.pip.style.background;
    b.leash.textContent = mode?.label ?? c.leash;

    const [word, tone] = beastState(c);
    b.state.textContent = word;
    b.state.className = `st ${tone}`;
    elBeast.classList.toggle('war', c.atWar || !c.inField);
  }

  function update(dt) {
    renderBeast(dt);

    // --- sculpting readout ---
    const sc = state.sculpt;
    elSculpt.classList.toggle('on', !!sc?.active);
    if (sc?.active) {
      const spent = sc.spentThisDrag;
      elSculpt.innerHTML = sc.refusal
        ? `<span class="bad">${sc.refusal}</span>`
        : `${sc.mode ? `<span class="k">${sc.mode}</span> &middot; ` : ''}` +
          `<span class="k">${Math.round(sc.radius)}</span> brush ` +
          `<span class="dim">&middot;</span> ` +
          `<span class="k">${sc.costPerSecond.toFixed(1)}</span> belief/sec` +
          (spent > 0.5 ? ` <span class="dim">&middot; ${Math.round(spent)} spent</span>` : '');
    }

    renderPrayers();
    updateAwards(dt);
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) elToast.classList.remove('on');
    }

    // --- what was just cast, briefly ---
    const mir = state.miracles;
    if (mir) {
      const r = mir.lastResult;
      elCast.classList.toggle('on', !!r);
      elCast.classList.toggle('bad', !!r?.bad);
      if (r) elCast.textContent = r.text;
    }

    // --- resource bar (throttled: it only changes a few times a second) ---
    resTimer -= dt;
    if (resTimer <= 0 && state.town) {
      resTimer = 0.2;
      const r = state.resources;
      const pop = state.town.population;
      const cap = state.town.housingCapacity();
      elRes.innerHTML =
        resItem('food', Math.floor(r.food), 'food') +
        resItem('wood', Math.floor(r.wood), 'wood') +
        resItem('ore', Math.floor(r.ore), 'ore') +
        resItem('belief', Math.floor(r.belief ?? 0), 'belief') +
        `<div class="sep"></div>` +
        // Say what is actually stopping growth. "8/28 pop" on its own reads as
        // a housing limit even when the real problem is an empty larder.
        (() => {
          const blocker = state.town.growthBlocker();
          const label = blocker === 'food' ? 'need food'
            : blocker === 'housing' ? 'need beds'
              : blocker === 'cap' ? 'at cap' : 'pop';
          const colour = blocker === 'food' || blocker === 'housing' ? '#ffb86b' : '#fff3d9';
          return `<div class="item"><span class="amt" style="color:${colour}">${pop}/${cap}</span>` +
            `<span class="lbl" style="${blocker ? 'color:#ffb86b;opacity:.85' : ''}">${label}</span></div>`;
        })() +
        `<div class="item"><span class="amt">${Math.round(state.town.happiness * 100)}%</span><span class="lbl">mood</span></div>` +
        // Army, with the reason it is not growing - same treatment as population
        // above, and for the same reason: a building that quietly does nothing
        // is indistinguishable from a broken one.
        (() => {
          const n = state.combat?.playerArmy ?? 0;
          const cap = state.combat?.playerArmyCap ?? 0;
          const why = state.combat?.playerTrainBlocked ?? null;
          if (!cap) return `<div class="item"><span class="amt">${n}</span><span class="lbl">army</span></div>`;
          const label = why === 'food' ? 'need food'
            : why === 'ore' ? 'need ore'
              : why === 'full' ? 'at cap' : 'army';
          const warn = why === 'food' || why === 'ore';
          return `<div class="item"><span class="amt" style="${warn ? 'color:#ffb86b' : ''}">${n}/${cap}</span>` +
            `<span class="lbl" style="${warn ? 'color:#ffb86b;opacity:.85' : ''}">${label}</span></div>`;
        })() +
        `<div class="item"><span class="amt">${Math.round(state.town.influenceRadius)}</span><span class="lbl">reach</span></div>`;

      // Alignment meter: -1 cruel .. +1 merciful.
      const a = state.alignment ?? 0;
      const word = a > 0.35 ? 'Merciful' : a < -0.35 ? 'Cruel' : 'Undecided';
      elAlign.innerHTML =
        `<div class="lbl">${word}</div>` +
        `<div class="track"><span class="knob" style="left:${((a + 1) / 2 * 100).toFixed(1)}%"></span></div>`;

      renderGrimoire();
      renderBarracks();
      renderRaids();
      renderEnding();
      grimoireBuilt = true;

      // --- every town on the island, and what it would take to hold it ---
      //
      // `!t.isPlayer || t.captured` listed the rivals and the ones you had
      // taken, which was the complete set of things you could be interested in
      // while towns only ever moved toward you. They move both ways now, so the
      // panel shows the whole island and says who holds each of them.
      // Every town, YOURS INCLUDED. It was excluded when it could not be lost;
      // it can be now, and a besieged capital belongs on the panel that shows
      // sieges rather than nowhere at all.
      const rivals = state.towns ?? [];
      if (rivals.length) {
        // Which towns can see your creature right now. `townsWatching` is the
        // same call the awe system itself uses, so what the panel says is
        // watching you is exactly what would be impressed by a performance.
        const beast = state.creature;
        const seenBy = beast && beast.animal
          ? new Set(state.town.townsWatching(beast.position.x, beast.position.z, 0)
            .map((w) => w.index))
          : new Set();

        let h = '<h4>The island</h4>';
        for (const t of rivals) {
          const col = '#' + t.colour.toString(16).padStart(6, '0');
          const pct = Math.round(t.impressiveness * 100);
          const holder = state.factions?.[t.owner];
          h += '<div class="t"><div class="hd">' +
            `<span class="swatch" style="background:${col}"></span>` +
            `<span class="nm">${t.name}</span>` +
            `<span class="pp">${state.town.populationOf(t)}</span></div>`;
          if (t.owner === 0) {
            h += `<div class="lbl2 won">${t.index === 0 ? 'your seat' : 'joined you'}</div>`;
            // YOU CAN BE COURTED TOO. Rival missionary gods work the same meter
            // on your towns, and until now that was completely invisible - a
            // way to lose a town with no warning of any kind.
            let rival = 0;
            let rivalBy = -1;
            for (let f = 1; f < (t.impressedBy?.length ?? 0); f++) {
              if (t.impressedBy[f] > rival) { rival = t.impressedBy[f]; rivalBy = f; }
            }
            if (rival > 0.08) {
              const who = state.factions?.[rivalBy]?.name ?? 'a rival';
              const rp = Math.round(rival * 100);
              h += `<div class="track"><span class="fill" style="width:${rp}%;background:#c9a6ff"></span></div>` +
                   `<div class="lbl2" style="color:#c9a6ff">${who} is winning them over &middot; ${rp}%</div>`;
            }
            if (t.breached) {
              h += `<div class="lbl2" style="color:#ff9d8a">wall breached &mdash; it will not be rebuilt</div>`;
            }
            if (t.besiegedBy > 0) {
              h += `<div class="lbl2" style="color:#ffb86b">besieged by ${t.besiegedBy}</div>`;
            }
          } else {
            if (t.owner !== t.index) {
              h += `<div class="lbl2">held by ${holder?.name ?? 'a rival'}</div>`;
            }
            const wall = Math.round((t.wallHp / 120) * 100);
            const def = state.combat?.countFor(t) ?? 0;
            // THE SIEGE, AS A CHECKLIST. Under COMBAT.RAZE_BEFORE_KEEP a town
            // falls in a fixed order, so the panel says which step you are on
            // rather than leaving the player to infer it from a wall bar that
            // will not move yet.
            const left = t.buildings.length;
            if (left > 0 && !t.breached) {
              h += `<div class="lbl2" style="opacity:0.7">` +
                   `<span style="color:#ffb86b">${left}</span> building${left === 1 ? '' : 's'} ` +
                   `standing &middot; then the keep</div>`;
            }
            // THE AWE BAR NOW SAYS WHAT IT IS FOR. It read "awe 0%" for
            // twelve phases, which is a number with no verb attached: nothing
            // anywhere told the player that filling it takes the town without a
            // fight, or what fills it.
            const watching = seenBy.has(t.index);
            const performing = watching && beast?.action?.desire === 'impress';
            let aweNote;
            if (performing) {
              aweNote = `<span style="color:#ffe9b8">your beast is winning them over</span>`;
            } else if (watching) {
              aweNote = `<span style="color:#ffe9b8">they can see your beast</span>`;
            } else if (pct >= 80) {
              aweNote = `awe ${pct}% &middot; almost yours`;
            } else if (pct > 0) {
              aweNote = `awe ${pct}% &middot; 100% and they join you`;
            } else {
              aweNote = `awe 0% &middot; wonders in their sight win them over`;
            }
            h += `<div class="track"><span class="fill${performing ? ' glow' : ''}" ` +
                 `style="width:${pct}%;background:#ffe9b8"></span></div>` +
                 `<div class="lbl2">${aweNote}</div>` +
                 `<div class="track"><span class="fill" style="width:${wall}%;background:#ff9d8a"></span></div>` +
                 // A breach is permanent, so it is worth a word rather than a
                 // "0%" the player has to know the rules to read. See
                 // COMBAT.WALL_REGEN.
                 `<div class="lbl2">` +
                 (t.breached ? `<span style="color:#ff9d8a">breached</span>` : `wall ${wall}%`) +
                 ` &middot; ${def} defending` +
                 (t.besiegedBy > 0 ? ` &middot; <span style="color:#ffb86b">besieged</span>` : '') +
                 `</div>`;
          }
          h += '</div>';
        }
        elRivals.innerHTML = h;
      } else {
        elRivals.innerHTML = '';
      }
    }

    // --- the sky ---
    // Weather is only named when it is doing something. "Clear" every second of
    // every game is a word the player stops reading by minute two.
    const sky = state.sky;
    if (sky && elSky) {
      const w = sky.weather;
      const note = w === 'drought' ? ' &middot; <b style="color:#e0b070">Drought</b>'
        : w === 'rain' ? ' &middot; <span style="color:#8fd8ff">Rain</span>'
          : w === 'overcast' ? ' &middot; <span style="opacity:.7">Overcast</span>' : '';
      elSky.innerHTML = `${sky.clock}${note}`;
    }

    // --- placement banner ---
    const placing = state.town?.placing;
    elPlacing.classList.toggle('on', !!placing);
    if (placing) {
      const ok = state.town.ghostValid;
      // "the ground will be levelled" is not a warning - the earth gets shaped
      // either way and the placement is fine. It is there so a hillside
      // changing shape under a building is something the player chose rather
      // than something that happened to them.
      const shaping = ok && state.town.ghostShapes;
      elPlacing.innerHTML =
        `<b>${placing.label}</b> &mdash; ` +
        (ok
          ? `<span class="ok">click to place</span>` +
            (shaping ? `<span style="opacity:.6"> &middot; the ground will be levelled</span>` : '')
          : `<span class="bad">${state.town.ghostReason}</span>`) +
        `<div style="opacity:.5;margin-top:2px">shift-click to keep building &middot; right-click or esc to cancel</div>`;
    }

    // Carry readout: only meaningful while something is in the hand.
    const held = state.hand?.held;
    elCarry.classList.toggle('on', !!held);
    if (held) {
      elCarry.innerHTML =
        `<div class="big">${held.kind}</div>` +
        `<div>mass ${held.mass.toFixed(1)} &middot; height ${state.hand.carryHeight.toFixed(1)}</div>` +
        `<div style="opacity:.55">speed ${held.vel.length().toFixed(1)} u/s</div>`;
    }

    // --- creature mind (throttled; it rebuilds a lot of DOM) ---
    if (mindVisible) {
      mindTimer -= dt;
      if (mindTimer <= 0) {
        mindTimer = 0.2;
        renderMind();
      }
    }

    if (!debugVisible) return;
    // Throttled: rewriting innerHTML every frame is a measurable cost.
    statsTimer -= dt;
    if (statsTimer > 0) return;
    statsTimer = 0.15;

    const d = state.debug;
    const info = state.renderer?.info;
    const fpsCls = d.fps >= 55 ? 'good' : d.fps >= 30 ? '' : 'warn';
    const vs = state.villagers?.stats();

    let html =
      row('fps', d.fps.toFixed(0), fpsCls) +
      row('sim tick', state.tick) +
      row('steps/frame', d.simSteps) +
      row('props', state.props ? state.props.count : 0) +
      row('awake', d.awakeProps, d.awakeProps > 40 ? 'warn' : '') +
      row('particles', state.fx ? state.fx.count : 0) +
      row('draw calls', info ? info.render.calls : '-') +
      row('triangles', info ? (info.render.triangles / 1000).toFixed(0) + 'k' : '-');

    if (vs) {
      html += `<div style="margin-top:6px;opacity:.5;font-size:10px;text-transform:uppercase;letter-spacing:.14em">villagers</div>`;
      html += row('alive', vs.alive);
      for (const [k, n] of Object.entries(vs.states)) {
        if (n > 0) html += row(k, n);
      }
      html += row('buildings', state.town ? state.town.buildings.length : 0);
    }

    // --- prayers (Phase 16) ---
    // Everything needed to answer the two questions this feature actually gets
    // debugged with: "why is nobody praying" and "is that list growing".
    const q = state.prayers?.stats;
    if (q) {
      const rej = Object.entries(q.rejected)
        .filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' ') || 'none';
      const cats = Object.entries(q.byCategory)
        .filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' ') || 'none';
      html += row('prayers active', `${q.active} (cap ${q.perTownCap}/town)`);
      html += row('raised', q.generated);
      html += row('answered / failed', `${q.answered} / ${q.failed}`);
      html += row('expired / void', `${q.expired} / ${q.invalidated}`);
      html += row('by category', cats);
      html += row('oldest active', q.oldestActiveAge + 's');
      html += row('rejections', rej);
      html += row('dupes blocked', q.duplicateBlocked);
      html += row('neglect streak', q.neglectStreak);
      html += row('history kept', q.historyLength);
      html += row('recent', q.recent.join(' ') || 'none');
    }

    // --- sky ---
    if (state.sky) {
      const d = state.sky.debug;
      html += row('sky', `${d.clock} ${d.phase} sun ${d.sunI} elev ${d.elevation}`);
      html += row('weather', `${d.weather} (${d.blend < 1 ? 'blending ' + d.blend : 'held ' + d.holdFor + 's'})`);
      html += row('crop multiplier', d.crop);
      html += row('rain drops', d.rain);
    }

    // --- sound ---
    const snd = state.sound?.stats;
    if (snd) {
      html += row('voices', `${snd.voices}/${snd.cap}`
        + (snd.unlocked ? '' : ' (locked)') + (snd.muted ? ' MUTED' : ''));
      html += row('clips decoded', `${snd.clips} (${snd.failed} failed)`);
      html += row('played / stolen', `${snd.played} / ${snd.stolen}`);
      html += row('culled / cooled', `${snd.culled} / ${snd.cooled}`);
      html += row('unwired', snd.unwired);
    }

    // --- graveyards ---
    const gy = state.graveyard;
    if (gy) {
      html += row('buried / drawn', `${gy.totalBuried} / ${gy.drawn}`);
      for (const p of gy.plots) {
        html += row(p.town, `${p.buried} dead, ${p.stones} stones`
          + (p.sited ? '' : ' (no plot yet)')
          + (p.landmarks.length ? ' - ' + p.landmarks.join(' ') : ''));
      }
    }

    // --- the reckoning (Phase 17) ---
    // The questions this feature gets debugged with: "is a category running
    // away", "is anything unbounded", and "does the total still add up".
    const rk = state.reckoning?.debugInfo?.();
    if (rk) {
      html += row('reckoning mode', rk.mode + (rk.frozen ? ' [FROZEN]' : ''));
      html += row('milestone keys', rk.milestoneKeys);
      html += row('timeline / events', `${rk.timelineLength} / ${rk.scoreEvents}`);
      html += row('dupes blocked', rk.duplicatesBlocked);
      html += row('open raids', rk.openRaids);
      if (rk.ascension) {
        html += row('ascension', `${rk.ascension.team ?? 'none'} ` +
          `${Math.ceil(rk.ascension.countdown)}s`);
      }
      for (const t of rk.teams) {
        html += row(`${t.id}${t.elim ? ' (out)' : ''}`,
          `${t.total} = ${t.power}p + ${t.legacy}L  ${t.trend >= 0 ? '+' : ''}${t.trend}`);
        html += row('', Object.entries(t.cats)
          .map(([k, v]) => `${k.slice(0, 3)} ${v}`).join(' '));
      }
      // Recomputes every score from source and reports anything that moved.
      // Run on demand rather than every frame: it is a full extra pass.
      if (reckValidate) {
        reckValidate = false;
        lastValidation = state.reckoning.validate();
      }
      if (lastValidation) {
        html += row('validate', lastValidation.ok ? 'OK'
          : lastValidation.problems.slice(0, 3).join(' | '));
      }
    }

    html += `<div style="margin-top:6px;opacity:.55;white-space:normal">${d.lastLog}</div>`;
    elStats.innerHTML = html;
  }

  const api = {
    update,
    toast,
    setDebugVisible,
    setMindVisible,
    toggleActs,
    togglePrayers,
    get prayersOpen() { return prayersOpen; },
    announceAchievement,
    closeActs,
    get actsOpen() { return actsOpen; },
    toggleBuildMenu,
    closeBuildMenu,
    toggleZoo,
    closeZoo,
    /** Repaint the miracle list. Called when the wheel changes the selection. */
    refreshGrimoire: renderGrimoire,
    get zooOpen() { return zooOpen; },
    get buildMenuOpen() { return radialOpen; },
    get debugVisible() { return debugVisible; },
    get mindVisible() { return mindVisible; }
  };
  state.ui = api;
  return api;
}
