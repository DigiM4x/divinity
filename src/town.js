// ---------------------------------------------------------------------------
// town.js - settlements. The player's, and the rivals'.
//
// Every town is the same record with the same economy: a centre, a stockpile,
// an influence radius, buildings, happiness and population growth. The only
// difference is who decides where to build - the player points, a rival runs a
// utility tick.
//
// All towns share the InstancedMesh per building type and are told apart by a
// per-instance banner tint, so adding rivals costs no extra draw calls.
//
// OWNERSHIP (Phase 20). Until this phase the only ownership in the game was the
// boolean `isPlayer`, and combat.js said so in as many words: "the game has no
// notion of ownership beyond isPlayer, so a rival cannot meaningfully take a
// town from another rival". That one bit is why the player was the only
// participant in the only game being played.
//
// A town now has an OWNER - an index into `state.factions`, one faction per
// civilisation - and `isPlayer` is a GETTER over it rather than a field. That
// choice is the whole reason this change is small: seventy-odd reads of
// `town.isPlayer` across ten files keep working and can never disagree with the
// owner, because there is one number and the boolean is derived from it.
//
// Publishes state.towns (all of them), state.town (the player's) and
// state.factions.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mulberry32 } from './lib/noise.js';
import { applyVertexColor } from './lib/geo.js';
import { composeParts, sizeToWidth, sizeToHeight, groundAtOrigin, growInstances} from './lib/models.js';
import { TOWN, BUILDINGS, WORLD, VILLAGER, ALIGNMENT, COMBAT, ENDING} from './state.js';

/**
 * Instances reserved per building type, shared across every town.
 *
 * 64 was quietly too small long before the island grew: a single rival reached
 * 113 houses in a Phase 8 test, and the mesh happily reported a count of 97
 * against a buffer of 64. WebGL does not throw for this - it logs
 * "Vertex buffer is not big enough for the draw call" from inside ANGLE and
 * renders garbage - so it had never announced itself as anything at all.
 */
/**
 * Starting instance capacity per building type. NOT a ceiling - `growInstances`
 * doubles it when it fills.
 *
 * It used to be a hard ceiling of 256, and a hard ceiling on a number that only
 * ever grows is a bug with a delay on it: a long game with three towns and a
 * couple of captures reaches 256 houses, and the player is then told "no room
 * for more of these" with no way to act on it.
 *
 * Once growth existed the 256 became the opposite problem - eight building
 * types pre-allocating 256 slots each to hold seventeen buildings, 99% of it
 * empty. Now it opens small and rises to meet whatever gets built.
 */
const CAPACITY = 24;

// --- procedural building geometry -------------------------------------------

// --- building assembly ------------------------------------------------------
// Buildings are composed from the fantasy town kit's 1x1 modules: a wall is a
// thin panel on the +X face of a unit cell, so four of them rotated by 90-degree
// steps enclose one cell, and a roof caps it at y = 1.
//
// The good/evil variants are the same assembly with different parts - a broken
// wall and a tall spiked roof instead of a plain wall and a squat one - which is
// exactly the "swap variants, do not build two asset sets" rule, now that the
// kit provides both silhouettes for free.
const HALF_PI = Math.PI / 2;

/** Four walls around one cell; `front` replaces the wall facing +X. */
function walls(P, plain, front, y = 0, x = 0) {
  return [
    { geo: P.get(front), x, y, rotY: 0 },
    { geo: P.get(plain), x, y, rotY: HALF_PI },
    { geo: P.get(plain), x, y, rotY: Math.PI },
    { geo: P.get(plain), x, y, rotY: -HALF_PI }
  ];
}

function makeHouseGeo(P, evil = false) {
  const wall = evil ? 'wall-broken' : 'wall';
  const roof = evil ? 'roof-high-point' : 'roof-point';
  return composeParts([
    ...walls(P, wall, evil ? 'wall-broken' : 'wall-door'),
    { geo: P.get(roof), y: 1 }
  ]);
}

/**
 * The manor: two bays, two storeys, one chimney.
 *
 * Built from the same wall modules as a house rather than a scaled copy of one,
 * because the point of the building is that it looks different. Bays sit on the
 * kit's own 1-unit grid, so they abut cleanly; the shared wall between them is
 * drawn twice and never seen, which is what the castle does too and costs a few
 * hundred triangles once at load.
 */
function makeManorGeo(P, evil = false) {
  const wall = evil ? 'wall-broken' : 'wall';
  const door = evil ? 'wall-broken' : 'wall-door';
  const win = evil ? 'wall-broken' : 'wall-window-shutters';
  const winSm = evil ? 'wall-broken' : 'wall-window-small';
  const beam = evil ? 'wall-broken' : 'wall-detail-cross';
  const roof = evil ? 'roof-high-point' : 'roof-point';
  const parts = [];

  // A 2x2 footprint. Two bays wide and one deep stretched to 12.3 tall against
  // 4.5 deep once `fit` normalised the width - a tower, not a house.
  for (const x of [0, 1]) {
    for (const z of [0, 1]) {
      // One door, on one corner. Four front doors reads as four huts that
      // happen to be touching, which is the one thing this must not look like.
      const isFront = x === 0 && z === 0;
      parts.push(
        { geo: P.get(isFront ? door : winSm), x, z, y: 0, rotY: 0 },
        { geo: P.get(z === 1 ? winSm : wall), x, z, y: 0, rotY: HALF_PI },
        { geo: P.get(wall), x, z, y: 0, rotY: Math.PI },
        { geo: P.get(x === 0 ? winSm : wall), x, z, y: 0, rotY: -HALF_PI },
        // Upper storey: shuttered windows on the two faces you actually see
        // from a playing camera, timber framing on the others.
        { geo: P.get(win), x, z, y: 1, rotY: 0 },
        { geo: P.get(beam), x, z, y: 1, rotY: HALF_PI },
        { geo: P.get(beam), x, z, y: 1, rotY: Math.PI },
        { geo: P.get(win), x, z, y: 1, rotY: -HALF_PI }
      );
    }
  }

  // ONE roof over the whole footprint, scaled to span both bays, rather than
  // four little ones. Four point-roofs over a 2x2 is a row of pitched sheds -
  // which is exactly what it looked like - and a single roof is the thing that
  // makes four cells read as one house.
  parts.push({ geo: P.get(roof), x: 0.5, z: 0.5, y: 2, scale: 2 });
  parts.push({ geo: P.get('chimney'), x: 1, z: 0, y: 2.1, rotY: Math.PI });
  return composeParts(parts);
}

/**
 * The mine: an arched adit under a flat stone lintel, with a barrow outside.
 *
 * Deliberately the LOWEST building in the catalogue. A mine is a hole in a
 * hillside, and giving it a pitched roof like a house would make it read as
 * another cottage in the row - the whole job of the silhouette is to say "the
 * work happens underground here".
 */
function makeMineGeo(P) {
  return composeParts([
    { geo: P.get('wall-doorway-round'), y: 0, rotY: 0 },
    { geo: P.get('wall'), y: 0, rotY: HALF_PI },
    { geo: P.get('wall'), y: 0, rotY: Math.PI },
    { geo: P.get('wall'), y: 0, rotY: -HALF_PI },
    { geo: P.get('roof-flat'), y: 1 },
    // A barrow at the mouth and a stack of pit props: without them a flat-roofed
    // stone box is a shed, and with them it is obviously a working mine.
    { geo: P.get('cart'), x: 0.86, z: 0.52, rotY: 0.55, scale: 0.62 },
    { geo: P.get('planks'), x: -0.82, z: 0.46, rotY: -0.4, scale: 0.62 }
  ]);
}

function makeWorkshopGeo(P, evil = false) {
  const wall = evil ? 'wall-wood-broken' : 'wall-wood';
  const roof = evil ? 'roof-high-point' : 'roof-point';
  return composeParts([
    // Two storeys: the workshop should read as the tallest thing in the village
    // after the town centre.
    ...walls(P, wall, 'wall-wood-door'),
    ...walls(P, wall, 'wall-wood-window-small', 1),
    { geo: P.get(roof), y: 2 },
    { geo: P.get('chimney'), y: 2, rotY: Math.PI },
    // A watermill wheel on the flank: unmistakably a place where work happens.
    { geo: P.get('watermill'), x: -0.62, y: 0.9, rotY: HALF_PI, scale: 0.55 }
  ]);
}

/**
 * The barracks: two storeys of stone under a banner, with a fenced yard.
 *
 * Deliberately the tallest thing in a village apart from the castle, and the
 * only building flying a flag - you should be able to tell at a glance which
 * settlements are raising troops.
 */
function makeBarracksGeo(P) {
  const parts = [];

  // TWO BAYS AND A WATCHTOWER, and NO YARD IN THE GEOMETRY.
  //
  // The yard is why this building read as tiny. `fit` normalises on the whole
  // geometry's WIDTH, and the drill-yard fences were part of it: fences at
  // x = +/-1.6 made the bounding box 4.2 units across while the building itself
  // was 1, so fitting the lot to 6.4 left a keep about 1.5 units wide against
  // 5.2 for a plain house. The yard had eaten the entire budget.
  //
  // Widening the fit only moved the problem - the yard grew with it and drifted
  // off to one side. The fences belong in `SCENERY.DRESSING`, which exists to
  // put things around a building and already fences the cattle. So `fit` now
  // measures the hall and nothing else, which is the only way that number means
  // what it looks like it means.
  for (const x of [0, 1]) {
    parts.push(...walls(P, 'wall', x === 0 ? 'wall-door' : 'wall-window-shutters', 0, x));
    parts.push(...walls(P, 'wall', 'wall-window-small', 1, x));
  }
  // One hall roof across both bays, then a tower rising from one end - the
  // silhouette that says soldiers rather than big house.
  parts.push({ geo: P.get('roof-point'), x: 0.5, y: 2, scale: 2 });
  parts.push(...walls(P, 'wall', 'wall-window-small', 2, 1));
  // A plain point roof on the tower, not the high one. `fit` normalises on
  // WIDTH, so the tower's extra height is multiplied by whatever the hall's
  // width demands - at the first pass that put the barracks at 21.5 units
  // against the castle's 21, and a garrison hut standing taller than the keep
  // it defends is the one thing the silhouette must never say.
  parts.push({ geo: P.get('roof-point'), x: 1, y: 3 });
  parts.push({ geo: P.get('banner-red'), x: 1, y: 3.5, rotY: 0.3 });
  return composeParts(parts);
}

function makeStorageGeo(P) {
  // Kept tight. Spread these out and the whole thing reads as debris someone
  // dropped rather than as one storage pit.
  return composeParts([
    { geo: P.get('stall'), y: 0 },
    { geo: P.get('cart'), x: 0.44, z: 0.30, rotY: 0.5, scale: 0.75 },
    { geo: P.get('planks'), x: -0.34, z: -0.22, rotY: 0.35, scale: 0.8 },
    { geo: P.get('planks'), x: -0.30, y: 0.16, z: -0.16, rotY: 0.9, scale: 0.7 }
  ]);
}


/**
 * A lumber camp: a low hut of planks, a stack of cut timber and a cart.
 *
 * Deliberately built out of the same planks the crop farm's hedges are NOT, so
 * that at a glance a camp reads as industry and a paddock reads as pasture.
 */
function makeLumberGeo(P) {
  const parts = [
    { geo: P.get('wall-wood'), x: 0, z: -1.0, rotY: 0 },
    { geo: P.get('wall-wood'), x: -1.0, z: 0, rotY: HALF_PI },
    { geo: P.get('roof-point'), x: -0.5, z: -0.5, y: 1 }
  ];
  // A stack of felled timber beside it, which is the whole point of the place.
  for (let i = 0; i < 3; i++) {
    parts.push({ geo: P.get('planks'), x: 1.15, z: -0.4 + i * 0.42, y: i * 0.16, rotY: 0 });
  }
  parts.push({ geo: P.get('cart'), x: 1.0, z: 1.2, rotY: 0.5 });
  parts.push({ geo: P.get('fence'), x: -1.4, z: 1.4, rotY: 0 });
  return composeParts(parts);
}

/**
 * WHERE THE CATTLE STAND, in the paddock's own local units.
 *
 * Shared by the pen and the herd so the two can never disagree: the same list
 * places the animals and is the reason the trough and the gate are where they
 * are. Kept clear of the barn corner and of the gate itself, because a cow
 * standing in a doorway reads as a bug rather than as livestock.
 *
 * Deliberately irregular. Four cows on a grid facing the same way is a diagram;
 * a herd is a huddle by the trough, one at the rail and one off on its own.
 */
const CATTLE_STANDING = [
  { x: 0.75, z: 1.95, rotY: -0.30 },   // at the trough
  { x: 2.10, z: 1.10, rotY: 1.90 },    // ...and one shouldering in beside it
  { x: 0.30, z: 0.10, rotY: 2.30 },    // out in the middle, facing away
  { x: 1.85, z: -1.35, rotY: 1.15 },
  { x: -1.45, z: 0.65, rotY: -1.70 },  // nose at the west rail
  { x: -0.60, z: -1.30, rotY: 0.40 }   // just out of the barn door
];

/**
 * The pen's half-width, in kit modules, and the rail that encloses it.
 *
 * MEASURED, not guessed. A `fence` is 1.0 long on Z, 0.38 tall, and its
 * geometry sits on the +X FACE of its cell (bbox centre x = 0.46) - the same
 * convention every wall module in this kit uses. So a rail running along Z is
 * rotY 0 placed half a panel in from the boundary, and one running along X is
 * rotY +/- 90 degrees. Step by exactly 1.0 and the panels ABUT; the old paddock
 * stepped by 1.15 and left a 15% gap between every pair, which is why it read
 * as scattered posts rather than as a fence.
 */
const PEN_R = 3.0;
const PEN_T = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
const RAIL_INSET = 0.46;

/**
 * THE PADDOCK. A barn, a fenced yard, a trough, a hay cart - and cattle.
 *
 * The old version was four runs of fence around an empty square with a lean-to
 * and a cart in it, and the honest description of that is "a pen". Nothing in
 * it said cattle, because THERE WERE NO CATTLE: the town kit has no animal in
 * it, so the building had been standing in for livestock with a fence since the
 * day it was added.
 *
 * The animals come from the Cube Pets kit instead - `animal-cow`, flattened to
 * a static geometry - which means they cannot live in this merged geometry at
 * all: the town kit and the pets kit are different texture atlases, and a cow
 * merged in here would sample the town colormap and come out as garbage. So the
 * herd is a SECOND instanced mesh riding the same instance matrices; see
 * `makeHerdGeo` and the sync in `update`.
 *
 * What this function builds is everything the cattle need to be standing in.
 */
function makeCattleGeo(P) {
  const parts = [];
  const R = PEN_R;
  const IN = RAIL_INSET;

  // --- the yard ------------------------------------------------------------
  // A CONTINUOUS rail on all four sides, with a real gate hung in the front of
  // it. The old paddock left its near side simply open, which reads as a fence
  // somebody never finished rather than as a way in.
  for (const t of PEN_T) {
    parts.push({ geo: P.get('fence'), x: R - IN, z: t, rotY: 0 });        // east
    parts.push({ geo: P.get('fence'), x: -R + IN, z: t, rotY: Math.PI }); // west
    // The back rail runs the whole way. Breaking it where the barn stands read
    // as a fence with a hole in it and a barn sitting OUTSIDE the pen - the
    // opposite of the intended "barn built into the corner". A rail that
    // disappears behind a wall is fine; a gap beside one is not.
    parts.push({ geo: P.get('fence'), x: t, z: -R + IN, rotY: -HALF_PI });
    // The front, with the gate in the middle of the run.
    const front = Math.abs(t) < 0.6 ? 'fence-gate' : 'fence';
    parts.push({ geo: P.get(front), x: t, z: R - IN, rotY: HALF_PI });
  }

  // --- the barn ------------------------------------------------------------
  // TWO BAYS WIDE, which is the whole difference between a barn and a hut: a
  // 1x1 with a pyramid roof is a house, and the paddock had one of those
  // pretending to be a shelter. A long low silhouette is the shape a byre is.
  //
  // The kit's walls are 1x1 modules whose geometry sits on the +X FACE of the
  // cell (measured: 0.1 x 1 x 1, centred at x = 0.45), so rotY puts a wall on
  // whichever face you ask for. Same convention as `walls()` above.
  // Set just inside the back-left corner, standing against the rail.
  const bx = -2.0;
  const bz = -2.15;
  for (const dx of [0, 1]) {
    const x = bx + dx;
    parts.push(
      // The doorway faces INTO the yard, so the animals have somewhere to go.
      { geo: P.get(dx === 0 ? 'wall-wood-door' : 'wall-wood'), x, z: bz, rotY: HALF_PI },
      { geo: P.get('wall-wood'), x, z: bz, rotY: -HALF_PI },
      // Only the OUTER end of each bay is walled; the join between them is open,
      // which is what makes it one barn rather than two sheds in a row.
      { geo: P.get('wall-wood'), x, z: bz, rotY: dx === 0 ? Math.PI : 0 },
      // ...and each bay is capped, so the ridge closes at both ends. The end
      // caps used to sit a cell BEYOND the barn - two roof slabs hanging in the
      // air over nothing, which is exactly what the first screenshot showed.
      { geo: P.get('roof-gable-end'), x, z: bz, y: 1, rotY: dx === 0 ? Math.PI : 0 }
    );
  }

  // --- the feed ------------------------------------------------------------
  // A trough along the rail, where the herd is standing. `stall` rather than
  // `planks`: planks are a flat 1x1 slab, which lying on the grass reads as a
  // dropped board, and a trough needs sides.
  // The `stall` I tried first is a MARKET stall - canopy and counter - and two
  // of them in a field read as a village fete rather than a farm. A low stone
  // basin is what an animal drinks from.
  //
  // 0.45, not 0.85. A fountain module is a full 1x1 basin, and at eight tenths
  // it filled a quarter of the yard and read as an ornamental pond - the cattle
  // looked like they were standing round a village water feature. Half size is
  // a trough two animals can get their heads into.
  parts.push({ geo: P.get('fountain-square'), x: 1.35, z: 1.95, rotY: 0, scale: 0.45 });
  // The hay cart, high-sided, drawn up against the rail where a cart would be
  // left rather than in the middle of the yard where the animals are.
  parts.push({ geo: P.get('cart-high'), x: -1.85, z: 1.95, rotY: -0.35, scale: 0.8 });
  // A hay rack propped against the barn: the yard's working clutter, and the
  // reason the corner beside the door is not empty.
  parts.push({ geo: P.get('poles-horizontal'), x: -0.35, z: -2.15, rotY: 0, scale: 0.75 });

  return composeParts(parts);
}

/**
 * The herd, in the same local space as the paddock above.
 *
 * A separate geometry rather than more parts, because the cow comes from the
 * Cube Pets atlas and the paddock comes from the town-kit atlas - merging them
 * would give one of them the other's texture. Both are transformed by the SAME
 * fit, so they land on top of each other; see `fitTogether`.
 */
function makeHerdGeo(cow, rand) {
  if (!cow) return null;
  // SIZED BY HEIGHT, AGAINST THE FENCE IT STANDS BEHIND.
  //
  // The first version used `sizeToWidth(0.95)`, and the kit's fence is 1.0 long
  // but only 0.38 TALL - so the cows came out three times the height of the
  // rail and bigger than the barn. Width is the wrong axis for an animal;
  // measure the thing you can compare it to.
  //
  // 0.5 local units against a 0.38 rail: shoulder a little above the top bar,
  // which is what a cow looks like leaning over a fence.
  const base = cow.clone();
  sizeToHeight(base, 0.5);
  base.computeBoundingBox();
  const foot = base.boundingBox.min.y;

  const parts = CATTLE_STANDING.map((c) => ({
    geo: base,
    x: c.x, z: c.z,
    y: -foot,                       // stand them on the ground, not in it
    rotY: c.rotY,
    // Not identical animals. A little variation in size reads as a herd; none
    // reads as one cow stamped five times, which is exactly what it is.
    scale: 0.88 + rand() * 0.24
  }));
  return composeParts(parts);
}

function makeFarmGeo(P) {
  // The kit has no crop field, so the farm stays a composed one: hedges enclose
  // a plot, with the kit's own trees standing in as the crop.
  const parts = [];
  const N = 3;
  for (let i = 0; i < N; i++) {
    const t = (i - (N - 1) / 2) * 1.0;
    parts.push({ geo: P.get('hedge'), x: 1.5, z: t, rotY: 0 });
    parts.push({ geo: P.get('hedge'), x: -1.5, z: t, rotY: Math.PI });
    parts.push({ geo: P.get('hedge'), x: t, z: 1.5, rotY: HALF_PI });
    parts.push({ geo: P.get('hedge'), x: t, z: -1.5, rotY: -HALF_PI });
  }
  for (let r = -1; r <= 1; r++) {
    for (let c = -1; c <= 1; c++) {
      parts.push({ geo: P.get('tree-crooked'), x: r * 0.95, z: c * 0.95, scale: 0.42,
                   rotY: (r + c) * 0.7 });
    }
  }
  return composeParts(parts);
}

/**
 * The town centre: a small castle, composed from the castle kit's 1x1 modules.
 *
 * A keep of three storeys under a pointed roof, ringed by a curtain wall with
 * corner towers and a gate. This was the last procedural building left, and it
 * was the only thing on screen still visually out of step with everything else.
 */
function makeCastleGeo(C) {
  const parts = [];
  const RING = 2;          // curtain wall sits this many cells from centre
  const WALL_H = 1.31;     // height of one wall module

  // --- keep ---
  parts.push({ geo: C.get('tower-square-base'), y: 0 });
  parts.push({ geo: C.get('tower-square-mid-door'), y: 1.01 });
  parts.push({ geo: C.get('tower-square-mid-windows'), y: 2.02 });
  parts.push({ geo: C.get('tower-square-top'), y: 3.03 });
  parts.push({ geo: C.get('tower-square-roof'), y: 3.33 });
  parts.push({ geo: C.get('flag'), y: 5.34, rotY: 0.4 });

  // --- curtain wall: run each side, leaving the corners to the towers ---
  for (let t = -(RING - 1); t <= RING - 1; t++) {
    // Front side carries the gate at its centre.
    if (t === 0) {
      parts.push({ geo: C.get('wall-doorway'), x: t, z: RING, rotY: HALF_PI });
      parts.push({ geo: C.get('gate'), x: t, z: RING, rotY: HALF_PI });
    } else {
      parts.push({ geo: C.get('wall'), x: t, z: RING, rotY: HALF_PI });
    }
    parts.push({ geo: C.get('wall'), x: t, z: -RING, rotY: HALF_PI });
    parts.push({ geo: C.get('wall'), x: RING, z: t, rotY: 0 });
    parts.push({ geo: C.get('wall'), x: -RING, z: t, rotY: 0 });
  }

  // --- corner towers ---
  // Each one flies a pennant. The castle kit's banners are the best-looking
  // things in the pack and they are authored to be MOUNTED - scattered on open
  // ground they lie flat and read as a rug. On a tower top they read as a
  // castle. Rotated a little differently on each corner so four identical
  // silhouettes do not give the instancing away.
  const pennant = C.get('flag-pennant');
  for (const [i, [sx, sz]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) {
    parts.push({ geo: C.get('tower-base'), x: sx * RING, z: sz * RING });
    parts.push({ geo: C.get('tower-top'), x: sx * RING, y: WALL_H, z: sz * RING });
    if (pennant) {
      parts.push({
        geo: pennant, x: sx * RING, y: WALL_H + 1.05, z: sz * RING,
        rotY: 0.35 + i * 0.9
      });
    }
  }

  return composeParts(parts);
}

// --- system -----------------------------------------------------------------
export function initTown(state) {
  const rand = mulberry32(state.seed ^ 0x71a3);
  const terrain = state.terrain;

  // The town kit's own palette; the town centre keeps its procedural,
  // vertex-coloured look so the seat of power stands apart from the houses.
  const material = new THREE.MeshStandardMaterial({
    map: state.models.townTexture,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    color: 0xc4c4c4
  });
  const centreMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    flatShading: true
  });

  // Kit pieces were fetched during boot; see main.js.
  const P = state.townPieces;

  /** Scale a composed building to a world footprint and stand it on the ground. */
  const fit = (geo, width) => groundAtOrigin(sizeToWidth(geo, width));

  /**
   * Fit a building AND a passenger geometry through the identical transform.
   *
   * `fit` measures the geometry it is scaling, which is exactly wrong for the
   * paddock's herd: the cows are a separate geometry in a different texture
   * atlas, and fitting them on their own bounding box would size them to the
   * building's footprint - five cows the size of a barn. They have to ride the
   * transform the PEN was fitted by, so the numbers are taken from the pen once
   * and applied to both.
   *
   * Returns the passenger; the main geometry is fitted in place.
   */
  function fitTogether(main, passenger, width) {
    main.computeBoundingBox();
    let b = main.boundingBox;
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const k = w > 0 ? width / w : 1;
    main.scale(k, k, k);
    main.computeBoundingBox();
    b = main.boundingBox;
    const dx = -(b.min.x + b.max.x) / 2;
    const dy = -b.min.y;
    const dz = -(b.min.z + b.max.z) / 2;
    main.translate(dx, dy, dz);
    main.computeBoundingBox();
    main.computeBoundingSphere();
    if (passenger) {
      passenger.scale(k, k, k);
      passenger.translate(dx, dy, dz);
      passenger.computeBoundingBox();
      passenger.computeBoundingSphere();
    }
    return passenger;
  }

  // Two silhouettes per type where it reads: good and evil. Farms and storage
  // keep one shape and change by tint alone, which is exactly the "recolour,
  // and swap variants only where it counts" split.
  const geos = {
    // EVERYTHING IS ABOUT A THIRD LARGER than it was, the same treatment the
    // barracks got: these were sized early, and from the height this game is
    // actually played at a village of them read as models on a table rather
    // than places people live.
    //
    // Scaled together, so the hierarchy the silhouettes depend on survives -
    // keep over hall over manor over house - and the pads in state.js moved
    // with them, because a building that outgrows its pad stands on a shelf.
    house: fit(makeHouseGeo(P, false), 7.0),
    manor: fit(makeManorGeo(P, false), 10.8),
    farm: fit(makeFarmGeo(P), 12.2),
    cattle: makeCattleGeo(P),
    lumber: fit(makeLumberGeo(P), 8.4),
    mine: fit(makeMineGeo(P), 8.1),
    storage: fit(makeStorageGeo(P), 6.8),
    workshop: fit(makeWorkshopGeo(P, false), 8.1),
    barracks: fit(makeBarracksGeo(P), 11.9)
  };
  // The paddock and its herd, fitted through one transform so the animals stand
  // where the pen puts them. Done after the table because both halves have to
  // exist before either can be measured.
  const herdGeo = fitTogether(geos.cattle, makeHerdGeo(state.cowModel?.geometry, rand), 13.0);

  const evilGeos = {
    house: fit(makeHouseGeo(P, true), 7.0),
    manor: fit(makeManorGeo(P, true), 10.8),
    workshop: fit(makeWorkshopGeo(P, true), 8.1)
  };

  const meshes = {};
  for (const key of Object.keys(geos)) {
    const m = new THREE.InstancedMesh(geos[key], material, CAPACITY);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    m.name = `building_${key}`;
    state.scene.add(m);
    meshes[key] = m;
  }

  // Per-instance banner tint: one shared mesh holds every town's buildings and
  // still shows at a glance who owns what.
  for (const key of Object.keys(meshes)) {
    const tint = new Float32Array(CAPACITY * 3).fill(1);
    meshes[key].instanceColor = new THREE.InstancedBufferAttribute(tint, 3);
    meshes[key].instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  /**
   * THE HERD. A second instanced mesh riding the paddock's own matrices.
   *
   * It cannot be part of `meshes.cattle` - different texture atlas - and it must
   * not keep its own bookkeeping either, or the day a paddock is demolished the
   * cows are left standing in the field. So it holds NO state of its own: every
   * sync copies the cattle mesh's instance matrices wholesale, and the herd is
   * therefore incapable of disagreeing with the pens.
   *
   * Not lit by the banner tint. Whoever owns the farm, a cow is brown.
   */
  const herdMesh = herdGeo
    ? new THREE.InstancedMesh(
      herdGeo,
      new THREE.MeshStandardMaterial({
        map: state.cowModel.texture, roughness: 0.92, metalness: 0.0
      }),
      CAPACITY)
    : null;
  if (herdMesh) {
    herdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    herdMesh.castShadow = true;
    herdMesh.receiveShadow = true;
    herdMesh.frustumCulled = false;
    herdMesh.count = 0;
    herdMesh.name = 'building_cattle_herd';
    state.scene.add(herdMesh);
  }

  /**
   * Copy the paddocks' matrices onto the herd.
   *
   * Flag-driven rather than every frame: `needsUpdate` on an instance matrix
   * re-uploads the WHOLE buffer, and this project has already been bitten once
   * by sending five megabytes a frame to move twenty-five vertices.
   */
  let herd = herdMesh;
  let herdDirty = true;
  function syncHerd() {
    if (!herd || !herdDirty) return;
    herdDirty = false;
    const src = meshes.cattle;
    const n = src.count;
    // The cattle mesh grows on demand; the herd has to grow with it, or the
    // paddocks past the old capacity quietly have no animals in them.
    while (n > herd.instanceMatrix.count) herd = growInstances(herd, state.scene);
    herd.instanceMatrix.array.set(src.instanceMatrix.array.subarray(0, n * 16), 0);
    herd.count = n;
    herd.instanceMatrix.needsUpdate = true;
  }

  // --- castle: one InstancedMesh, so every town's centre is one draw call ---
  const castleGeo = groundAtOrigin(sizeToWidth(makeCastleGeo(state.castlePieces), TOWN.CASTLE_WIDTH));
  const castleMesh = new THREE.InstancedMesh(
    castleGeo,
    new THREE.MeshStandardMaterial({
      map: state.models.kitTexture('castle-kit'),
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
      color: 0xc4c4c4
    }),
    TOWN.RIVALS + 1
  );
  castleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  castleMesh.instanceColor =
    new THREE.InstancedBufferAttribute(new Float32Array((TOWN.RIVALS + 1) * 3).fill(1), 3);
  castleMesh.castShadow = true;
  castleMesh.receiveShadow = true;
  castleMesh.frustumCulled = false;
  castleMesh.count = 0;
  castleMesh.name = 'town_castles';
  state.scene.add(castleMesh);

  /**
   * Slot registry per building type. Every town's buildings live in the same
   * InstancedMesh, so the mesh slot is global even though the buildings belong
   * to different towns - demolish swaps the last slot down and has to fix up
   * whichever building was moved, whoever owns it.
   */
  const slots = {};
  for (const key of Object.keys(meshes)) slots[key] = [];

  const towns = [];
  const allBuildings = [];
  let nextId = 1;
  let nextBuildingId = 1;

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _c = new THREE.Color();
  const _up = new THREE.Vector3(0, 1, 0);
  const WHITE = new THREE.Color(1, 1, 1);

  // --- factions -------------------------------------------------------------
  //
  // ONE PER CIVILISATION, built before any town exists, never added to and
  // never removed. Whether a faction is still in the game is DERIVED from the
  // towns it holds rather than stored, so there is no second copy of the truth
  // to fall out of step with the first.
  const factions = [];
  for (let i = 0; i <= TOWN.RIVALS; i++) {
    factions.push({
      index: i,
      isPlayer: i === 0,
      name: TOWN.NAMES[i] ?? 'Town ' + i,
      colour: TOWN.COLOURS[i] ?? 0xffffff,
      /**
       * THE FACTION'S STOCKPILE, shared by every town it holds.
       *
       * The player's IS `state.resources`, not a copy of it: the HUD, the
       * miracle economy and every build cost read that exact object, and a copy
       * here would give the player a second set of books that slowly diverged
       * from the one on screen.
       *
       * Capture repoints `town.resources` at the captor's pool - which is
       * precisely what the player's capture already did. All that has changed is
       * that "the captor" used to be a constant.
       */
      resources: i === 0
        ? state.resources
        : { food: TOWN.START_FOOD, wood: 240, ore: 60, belief: 0 }
    });
  }
  state.factions = factions;

  function createTown({ owner, centre, index }) {
    return {
      id: nextId++,
      /** Who FOUNDED it. Fixed for life - reckoning.js keys its teams on this. */
      index,
      /** Who holds it NOW. Written only by capture(). */
      owner,
      /**
       * DERIVED, never stored.
       *
       * Seventy-odd places in this codebase ask `town.isPlayer`, and before
       * Phase 20 it was a field that capture() wrote. Two writable copies of one
       * fact is how a codebase acquires a bug that only appears after a capture,
       * so the boolean is now a window onto the number and the two cannot
       * disagree.
       */
      get isPlayer() { return this.owner === 0; },
      /** True once it is no longer held by the faction that founded it. */
      get captured() { return this.owner !== this.index; },
      name: TOWN.NAMES[index] ?? 'Town ' + index,
      colour: TOWN.COLOURS[index] ?? 0xffffff,
      centre,
      buildings: [],
      /** Points at the owning faction's pool; repointed by capture(). */
      resources: factions[owner].resources,
      influenceRadius: TOWN.BASE_INFLUENCE,
      targetInfluence: TOWN.BASE_INFLUENCE,
      happiness: 0.6,
      growthTimer: TOWN.GROWTH_INTERVAL,
      buildTimer: TOWN.RIVAL_BUILD_INTERVAL * (0.3 + rand()),
      /**
       * AWE, PER WATCHING FACTION. faction index -> 0..1, at 1 they defect.
       *
       * This used to be one number, because there was only ever one god capable
       * of impressing anybody. A single meter shared between five suitors would
       * have let a rival's wonders finish the job the player started, and the
       * town would have come over to whoever happened to top it up last.
       *
       * Bounded by the civilisation count, which is fixed at boot.
       */
      impressedBy: factions.map(() => 0),
      /** When each faction last impressed them. Drives TOWN.IMPRESS_GRACE. */
      impressedAt: factions.map(() => -Infinity),
      /** The player's share of the above, for the HUD that has always read it. */
      get impressiveness() { return this.impressedBy[0]; },
      /** Population, refreshed each sim tick. See simStep. */
      pop: 0,
      centreSlot: -1,
      /** Curtain wall integrity. Must be breached before the town can be taken. */
      wallHp: COMBAT.WALL_HP,
      /**
       * ONCE BROKEN, BROKEN FOR GOOD.
       *
       * Set the first time the wall reaches zero and never cleared - not by
       * time, not by the siege lifting, not by the town changing hands. See
       * COMBAT.WALL_REGEN.
       */
      breached: false,
      besiegedBy: 0
    };
  }

  // --- siting ---------------------------------------------------------------
  /** Score a candidate site: flat, inland, and clear of the other towns. */
  function siteScore(x, z) {
    const h = terrain.heightAt(x, z);
    if (h < 9 || h > 26) return -Infinity;
    for (const t of towns) {
      if (Math.hypot(x - t.centre.x, z - t.centre.z) < TOWN.TOWN_SPACING) return -Infinity;
    }
    let land = 0;
    let slopeSum = 0;
    const SAMPLES = 12;
    for (let k = 0; k < SAMPLES; k++) {
      const a = (k / SAMPLES) * Math.PI * 2;
      const sx = x + Math.cos(a) * 30;
      const sz = z + Math.sin(a) * 30;
      if (terrain.heightAt(sx, sz) > 2.5) land++;
      slopeSum += terrain.slopeAt(sx, sz);
    }
    const landFrac = land / SAMPLES;
    if (landFrac < 0.8) return -Infinity;
    return -terrain.maxSlopeIn(x, z, 12) * 12 - (slopeSum / SAMPLES) * 8 + landFrac * 20;
  }

  /**
   * Choose sites for ALL the towns at once, spaced apart, before founding any.
   *
   * This used to be greedy: each town took the best-scoring spot left, one
   * after another. That is a trap, and random islands walked straight into it.
   * Towns were sampled inside a radius of 198 and must sit TOWN_SPACING (230)
   * apart - so IF THE FIRST TOWN LANDS NEAR THE CENTRE, no second town can ever
   * exist, because every point in the disc is within 198 of it and 198 < 230.
   * The score has no idea it is doing this; it just picks the nicest valley,
   * and the nicest valley is usually the middle.
   *
   * The one hand-tuned island shipped for fourteen phases happened to score
   * best 185 units out, so it never showed. Rolling a new world every game
   * turned "never" into "most Spines and some Archipelagos", which is how it
   * was found: viability passed and the game still opened with one town.
   *
   * Two changes. The search band is widened - 0.62 of HALF was barely enough
   * geometry for three towns even in the best case - and the first pick is
   * BACKTRACKED: try the best candidate, and if the rest cannot be spaced
   * around it, try the next best instead of shipping a game with one rival.
   */
  function pickSites(n) {
    const cands = [];
    for (let i = 0; i < 9000; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * WORLD.HALF * 0.80;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const score = siteScore(x, z);
      if (score > -Infinity) cands.push({ x, z, score });
    }
    if (!cands.length) return [];
    cands.sort((a, b) => b.score - a.score);

    const spaced = (list, c) =>
      list.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= TOWN.TOWN_SPACING);

    // Try each candidate as the anchor, best first, and greedily fill around
    // it. The first anchor that supports a full set wins.
    const tries = Math.min(cands.length, 400);
    let bestSet = [];
    for (let a = 0; a < tries; a++) {
      const set = [cands[a]];
      for (const c of cands) {
        if (set.length >= n) break;
        if (spaced(set, c)) set.push(c);
      }
      if (set.length > bestSet.length) bestSet = set;
      if (bestSet.length >= n) break;
    }
    if (bestSet.length < n) {
      console.warn(`[town] only ${bestSet.length} of ${n} town sites fit this island`);
    }
    return bestSet;
  }

  function foundTown(index, site) {
    const best = site;
    if (!best) return null;

    const centre = new THREE.Vector3(best.x, 0, best.z);
    // Level a generous pad: the buildable ring runs from CENTRE_CLEARANCE out.
    terrain.flatten(centre.x, centre.z, 30, terrain.averageHeight(centre.x, centre.z, 12));
    centre.y = terrain.heightAt(centre.x, centre.z);

    // A town is founded by, and so initially owned by, its own faction.
    const town = createTown({ owner: index, centre, index });
    towns.push(town);

    const slot = castleMesh.count++;
    town.centreSlot = slot;
    _q.setFromAxisAngle(_up, rand() * Math.PI * 2);
    _m.compose(centre, _q, _s);
    castleMesh.setMatrixAt(slot, _m);
    castleMesh.setColorAt(slot, _c.set(town.colour).lerp(WHITE, TOWN.TINT_MIX));
    castleMesh.instanceMatrix.needsUpdate = true;
    castleMesh.instanceColor.needsUpdate = true;
    return town;
  }

  // --- helpers --------------------------------------------------------------
  function housingCapacity(town) {
    let cap = 4; // the castle itself sleeps a few
    for (const b of town.buildings) if (b.def.housing) cap += b.def.housing;
    return cap;
  }

  function population(town) {
    if (!state.villagers) return 0;
    let n = 0;
    for (const v of state.villagers.list) if (v.alive && v.town === town) n++;
    return n;
  }

  function canAfford(town, def) {
    for (const [res, amt] of Object.entries(def.cost)) {
      if ((town.resources[res] ?? 0) < amt) return false;
    }
    return true;
  }

  /** Why a spot is unbuildable for this town, or '' if it is fine. */
  /**
   * Cut the building's ground in.
   *
   * Two passes, and the second is what makes it look built rather than stamped:
   *
   *   1. the PAD, levelled flat to the average height under it;
   *   2. a SKIRT beyond the pad, eased from that level back into the hillside.
   *
   * Without the skirt a building on a slope sits on a disc of table-flat ground
   * with a lip all the way round - the terrace is the right idea, the sudden
   * step is not. The skirt pass uses a partial strength so it blends rather
   * than extending the plateau.
   *
   * Neighbours are protected. Every existing building sits on a pad flattened
   * to a baked height with an instance matrix to match, so shaping ground out
   * from under one buries it - the same reason the sculpt brush grew a protect
   * list in Phase 14, reused here rather than reinvented.
   */
  const _keep = [];
  function shapeGroundFor(def, x, z) {
    const pad = def.pad;
    const skirt = pad * TOWN.SHAPE_SKIRT;

    _keep.length = 0;
    const reach = skirt + 40;
    for (const b of allBuildings) {
      const dx = b.pos.x - x;
      const dz = b.pos.z - z;
      if (dx * dx + dz * dz > reach * reach) continue;
      _keep.push({ x: b.pos.x, z: b.pos.z, r: (b.def.pad || 4) * 0.6 });
    }
    for (const t of towns) {
      const dx = t.centre.x - x;
      const dz = t.centre.z - z;
      if (dx * dx + dz * dz > reach * reach) continue;
      _keep.push({ x: t.centre.x, z: t.centre.z, r: TOWN.CENTRE_SOLID });
    }

    const target = terrain.averageHeight(x, z, pad * 0.6);
    // Skirt first, then the pad over the top of it: the pad must win outright
    // where they overlap, or the building's own footing ends up half-blended.
    terrain.flatten(x, z, skirt, target, 0.55, _keep);
    terrain.flatten(x, z, pad, target, 1, _keep);
  }

  function validate(town, def, x, z) {
    const h = terrain.heightAt(x, z);
    if (h < VILLAGER.MIN_WALK_HEIGHT + 0.6) return 'in water';
    if (Math.hypot(x - town.centre.x, z - town.centre.z) > town.influenceRadius) {
      return 'outside influence';
    }
    // Only a cliff refuses now. Anything short of that gets shaped by `place`,
    // which has always flattened a pad anyway - the old gate here was the game
    // declining to do the very thing that would have made the spot buildable.
    if (terrain.maxSlopeIn(x, z, def.pad * 0.6) > TOWN.SHAPE_MAX_SLOPE) {
      return 'the ground falls away too sharply';
    }
    // Spacing is checked against EVERY town's buildings, not just this one, or
    // two settlements growing toward each other interleave their houses.
    for (const b of allBuildings) {
      const minD = TOWN.MIN_SPACING + (b.def.pad + def.pad) * 0.35;
      if (Math.hypot(x - b.pos.x, z - b.pos.z) < minD) return 'too close to a building';
    }
    for (const t of towns) {
      if (Math.hypot(x - t.centre.x, z - t.centre.z) < TOWN.CENTRE_CLEARANCE) {
        return 'too close to a town centre';
      }
    }
    if (!canAfford(town, def)) return 'not enough resources';
    return '';
  }

  /**
   * @param opts.by  who raised it: 'player' (your hand), 'people' (self-build)
   *                 or 'rival'. Announced, because a prayer for shelter that
   *                 your own villagers answered must not be credited to you.
   */
  function place(town, def, x, z, opts = {}) {
    const reason = validate(town, def, x, z);
    if (reason) return { ok: false, reason };

    shapeGroundFor(def, x, z);
    const y = terrain.heightAt(x, z);

    for (const [res, amt] of Object.entries(def.cost)) town.resources[res] -= amt;

    // Grow rather than refuse. Any fixed capacity is eventually reached, and
    // this one was reached by ordinary play - see CAPACITY. Done here, after
    // validation, so the reallocation only happens on a placement that is
    // actually going ahead.
    let mesh = meshes[def.key];
    if (mesh.count >= mesh.instanceMatrix.count) {
      mesh = meshes[def.key] = growInstances(mesh, state.scene);
      state.debug.lastLog = `${def.key} mesh grown to ${mesh.instanceMatrix.count}`;
    }

    const index = mesh.count;
    const b = {
      id: nextBuildingId++,
      town,
      def,
      type: def.key,
      pos: new THREE.Vector3(x, y, z),
      yaw: rand() * Math.PI * 2,
      index,
      crop: def.farm ? 1 : 0,
      workers: 0,
      /** Soldiers chip this down; at zero the building is razed. */
      hp: COMBAT.BUILDING_HP,
      /** Barracks only: index into COMBAT.BARRACKS_TIERS. */
      level: 0
    };
    town.buildings.push(b);
    allBuildings.push(b);
    slots[def.key].push(b);

    _q.setFromAxisAngle(_up, b.yaw);
    _m.compose(b.pos, _q, _s);
    mesh.setMatrixAt(index, _m);
    mesh.setColorAt(index, _c.set(town.colour).lerp(WHITE, TOWN.TINT_MIX));
    mesh.count = index + 1;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    // The herd rides these same matrices; tell it they moved.
    if (def.cattle) herdDirty = true;

    for (const p of state.props.list) {
      if (p.dead || p.harvested) continue;
      if (Math.hypot(p.pos.x - x, p.pos.z - z) < def.pad * 0.9) state.props.harvest(p);
    }
    // Decoration goes too, and with a wider skirt than the props: grass poking
    // through a doorstep reads worse than a boulder does.
    state.flora?.clearAround(x, z, def.pad * 0.9 + 3.0);
    // Scenery too - a cliff outcrop or a crop row standing in the new doorway.
    // Cleared BEFORE the building is dressed, or the dressing clears itself.
    state.scenery?.clearAround(x, z, def.pad * 0.9 + 2.0);
    // ...and then the building gets its own: crops behind a farm, fences round
    // the cattle, a hedge by a house. This is what makes a settlement read as
    // lived in rather than as sheds dropped on a lawn.
    state.scenery?.dressBuilding(b);

    state.fx?.burst(b.pos, 12, 0xd8c9a8);
    recomputeInfluence(town);
    // Announced rather than acted on here: alignment is miracles.js's business
    // and the count of what you have raised is achievements.js's. Both listen;
    // neither is imported.
    state.events?.emit('building-placed', {
      building: b, def, pos: b.pos, byPlayer: !!town.isPlayer,
      by: opts.by ?? (town.isPlayer ? 'player' : 'rival')
    });
    // Rivals within sight of a new player building take note of it.
    if (town.isPlayer) {
      const grandeur = def.workshop ? 2 : def.housing ? 1 : 0.6;
      for (const t of townsWatching(x, z)) {
        addImpressiveness(t, TOWN.IMPRESS_PER_BUILDING * grandeur, 'building');
      }
    }
    return { ok: true, building: b };
  }

  /**
   * Remove a building. InstancedMesh has no "delete instance", so the last
   * instance of that type is swapped into the freed slot - and the building
   * that got moved needs its stored index fixed, whichever town owns it.
   */
  function demolish(b) {
    const reg = slots[b.type];
    const i = reg.indexOf(b);
    if (i < 0) return false;

    const mesh = meshes[b.type];
    const last = mesh.count - 1;
    const moved = reg[last];
    if (moved && moved !== b) {
      mesh.getMatrixAt(last, _m);
      mesh.setMatrixAt(b.index, _m);
      mesh.getColorAt(last, _c);
      mesh.setColorAt(b.index, _c);
      moved.index = b.index;
      reg[i] = moved;
    }
    reg.length = last;
    mesh.count = last;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    // Demolishing a paddock has to take its cattle with it. This is the exact
    // case the herd holds no state of its own for: the slot swap above moves
    // some OTHER paddock into this index, and a herd keeping its own list would
    // now be one animal-cluster out of step for the rest of the game.
    if (b.def.cattle) herdDirty = true;

    const ti = b.town.buildings.indexOf(b);
    if (ti >= 0) b.town.buildings.splice(ti, 1);
    const ai = allBuildings.indexOf(b);
    if (ai >= 0) allBuildings.splice(ai, 1);

    state.fx?.burst(b.pos, 22, 0x9c8a70);
    state.debug.lastLog = b.def.label + ' destroyed';
    recomputeInfluence(b.town);
    return true;
  }

  function recomputeInfluence(town) {
    town.targetInfluence = Math.min(
      TOWN.MAX_INFLUENCE,
      TOWN.BASE_INFLUENCE + population(town) * TOWN.INFLUENCE_PER_POP
    );
  }

  // --- upgrading ------------------------------------------------------------

  /** The tier a barracks is currently at. */
  function tierOf(b) {
    return COMBAT.BARRACKS_TIERS[b.level ?? 0];
  }

  /** The tier it would become, or null if it is already at the top. */
  function nextTier(b) {
    return COMBAT.BARRACKS_TIERS[(b.level ?? 0) + 1] ?? null;
  }

  /**
   * Upgrade a barracks. Rivals use this too, so the cost is charged to whoever
   * owns it rather than to the player - no free promotions for the AI.
   */
  function upgrade(b) {
    if (!b || !b.def.barracks) return { ok: false, reason: 'not a barracks' };
    const next = nextTier(b);
    if (!next) return { ok: false, reason: 'already at the highest rank' };
    const town = b.town;
    for (const [res, amt] of Object.entries(next.cost)) {
      if ((town.resources[res] ?? 0) < amt) return { ok: false, reason: `needs ${amt} ${res}` };
    }
    for (const [res, amt] of Object.entries(next.cost)) town.resources[res] -= amt;
    b.level++;
    state.fx?.burst(b.pos, 18, 0xffe9b8);
    if (town.isPlayer) state.ui?.toast(`Barracks now trains ${next.label}`);
    state.events?.emit('building-upgraded', { building: b, level: b.level, pos: b.pos });
    return { ok: true, level: b.level };
  }

  /** Every barracks a town owns, for the HUD and for the rival AI. */
  function barracksOf(town) {
    return town.buildings.filter((b) => b.def.barracks);
  }

  /** How content a town is, 0..1. The player's drives belief generation. */
  function recomputeHappiness(town) {
    const pop = population(town);
    if (pop === 0) { town.happiness = 0; return; }

    const fed = THREE.MathUtils.clamp((town.resources.food / pop) / 6, 0, 1);
    const spare = housingCapacity(town) - pop;
    const housed = THREE.MathUtils.clamp(0.5 + spare / 8, 0, 1);

    let hungry = 0;
    for (const v of state.villagers.list) {
      if (v.alive && v.town === town && v.hunger > 0.8) hungry++;
    }
    const calm = 1 - THREE.MathUtils.clamp(hungry / pop, 0, 1);

    // Alignment finally does something. It has recoloured the world since Phase
    // 4 and driven nothing, which made the whole moral axis decorative. A
    // merciful god's people are gladder to be his; a cruel one's are not, and
    // an unhappy town prays less, which costs him the belief he needs to go on
    // being cruel. That loop is the point.
    const mood = 1 + (state.alignment ?? 0) * TOWN.ALIGNMENT_MOOD;

    const raw = (fed * 0.45 + housed * 0.25 + calm * 0.30) * mood;
    town.happiness += (Math.max(TOWN.MIN_HAPPINESS, raw) - town.happiness) * 0.15;
  }

  /**
   * What is currently preventing a birth in this town, or null.
   *
   * THE CAP IS THE ISLAND'S, NOT THE TOWN'S, and reading it wrong was a real
   * cost. `villagers.spawn` refuses once the WHOLE island holds VILLAGER.MAX,
   * but this asked whether THIS TOWN had reached it - so a town of thirty on a
   * full island answered "nothing is stopping you", paid GROWTH_FOOD_COST,
   * called `spawn`, got null back, and announced a birth that never happened.
   * Every fourteen seconds. Forever.
   *
   * Measured over thirty minutes: 534 births announced, 225 deaths, and 150
   * people alive - about 159 of those births were phantoms, and roughly 1,900
   * food went with them. It also inflated the reckoning's birth statistic,
   * because `villager-born` fired for each one.
   */
  function growthBlocker(town) {
    const pop = population(town);
    if ((state.villagers?.list?.length ?? 0) >= VILLAGER.MAX) return 'cap';
    if (housingCapacity(town) - pop <= 0) return 'housing';
    if (town.resources.food - TOWN.GROWTH_FOOD_RESERVE < TOWN.GROWTH_FOOD_COST) return 'food';
    return null;
  }

  /** Nearest building of this town matching a predicate, or null. */
  function findBuilding(town, pred, x, z) {
    let best = null;
    let bestD2 = Infinity;
    for (const b of town.buildings) {
      if (!pred(b)) continue;
      const d2 = (b.pos.x - x) ** 2 + (b.pos.z - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = b; }
    }
    return best;
  }

  /**
   * THE KEEP IS SOLID. Push a point out of any town centre that contains it.
   *
   * Divinity has had no collision of any kind since Phase 1 - villagers,
   * soldiers, siege engines and the beast have all walked straight through
   * every castle on the island. This is the one piece of it, and it is
   * deliberately the smallest thing that works: a circle per town centre, and
   * a point inside one is projected back out onto the surface.
   *
   * Projecting outward rather than refusing the step is what gives SLIDING for
   * free - an agent walking into the wall at an angle keeps its tangential
   * motion and rounds the corner, instead of pressing into the stone and
   * juddering there until its goal changes.
   *
   * Returns a shared, reused holder: read it immediately. This runs for every
   * villager, soldier and engine on every tick, and allocating there is how a
   * 20Hz simulation turns into a garbage-collection problem.
   */
  const _solid = { x: 0, z: 0, hit: false };
  function pushOutOfCentres(x, z, pad = 0) {
    _solid.x = x;
    _solid.z = z;
    _solid.hit = false;
    for (let i = 0; i < towns.length; i++) {
      const c = towns[i].centre;
      const r = TOWN.CENTRE_SOLID + pad;
      const dx = _solid.x - c.x;
      const dz = _solid.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        // Dead centre, where there is no direction to push along. Guarding this
        // with `sqrt(d2) || 1e-4` looks like it handles it and does not: the
        // offsets are still zero, so 0/1e-4 is 0 and the point stays exactly
        // where it was. A traverse straight through the middle of the keep left
        // one sample inside it. Pick an arbitrary bearing instead.
        _solid.x = c.x + r;
        _solid.z = c.z;
      } else {
        _solid.x = c.x + (dx / d) * r;
        _solid.z = c.z + (dz / d) * r;
      }
      _solid.hit = true;
    }
    return _solid;
  }

  /**
   * A point on the keep's threshold, on the side the caller is standing.
   *
   * Anything that wants to go "to the town centre" wants this instead, now that
   * the centre itself is inside a wall.
   */
  const _gate = { x: 0, z: 0 };
  function gateOf(town, fromX, fromZ) {
    const dx = fromX - town.centre.x;
    const dz = fromZ - town.centre.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    _gate.x = town.centre.x + (dx / d) * TOWN.GATE_OFFSET;
    _gate.z = town.centre.z + (dz / d) * TOWN.GATE_OFFSET;
    return _gate;
  }

  /**
   * How much of a town's own land would actually take a building, 0..1.
   *
   * Sampled on rings rather than computed: a ratio from two dozen points is
   * plenty to tell a town on a plain from one wedged against a cliff, and this
   * runs on the prayer scan rather than on the frame.
   */
  function buildableFraction(town, samples = 24) {
    const pad = BUILDINGS.house.pad * 0.6;
    let ok = 0;
    let tried = 0;
    const rings = [0.45, 0.7, 0.92];
    for (let k = 0; k < samples; k++) {
      const ring = rings[k % rings.length];
      const a = (k / samples) * Math.PI * 2 * 3;   // spiral, so rings differ
      const r = Math.max(TOWN.CENTRE_CLEARANCE + 4, town.influenceRadius * ring);
      const x = town.centre.x + Math.cos(a) * r;
      const z = town.centre.z + Math.sin(a) * r;
      tried++;
      // SLOPE AND WATER ONLY - deliberately not `validate`, which also refuses
      // ground that is merely occupied. A big successful town would otherwise
      // measure as unbuildable for being full of buildings, and pray for a
      // hillside to be levelled when the real answer is "you built on it all".
      if (terrain.heightAt(x, z) > VILLAGER.MIN_WALK_HEIGHT
          && terrain.maxSlopeIn(x, z, pad) <= TOWN.SHAPE_MAX_SLOPE) ok++;
    }
    return tried ? ok / tried : 1;
  }

  /** Which town's territory a point falls in, nearest first, or null. */
  function townAt(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const t of towns) {
      const d = Math.hypot(x - t.centre.x, z - t.centre.z);
      if (d <= t.influenceRadius && d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  // --- rival behaviour ------------------------------------------------------
  /**
   * A rival's whole brain: every so often work out what it is shortest of and
   * put up the building that fixes it. Deliberately the same economy the player
   * plays - no cheating stockpile, no free buildings, the same validation.
   */
  /** Living soldiers of a town. Combat owns the army; we only ask. */
  function countGarrison(town) {
    return state.combat?.countFor(town) ?? 0;
  }
  function garrisonCapOf(town) {
    return state.combat?.capFor(town) ?? 0;
  }

  /**
   * What this town would put up next, given what it is ALLOWED to put up.
   *
   * One decision shared by the rivals and by your own people, rather than two
   * that drift apart. The only difference between them is `allowed`: a rival
   * may build anything, your town may build the things in TOWN.SELF_BUILD
   * while the grand and the warlike stay yours to choose.
   */
  function wantedBuilding(town, allowed, idleFallback = true) {
    const pop = population(town);
    const blocker = growthBlocker(town);
    const may = (k) => allowed === null || allowed.includes(k);
    const count = (flag) => town.buildings.filter((b) => b.def[flag]).length;
    const hungry = town.resources.food < 40 + pop * 2;

    if (may('house') && blocker === 'housing') return 'house';
    if (may('farm') && hungry
        && count('farm') < Math.ceil(housingCapacity(town) / TOWN.FARMS_PER_CAPACITY) + 1) {
      return 'farm';
    }
    // Crop farms first because they are cheaper, then a paddock: a town that
    // has hit its farm ceiling and is still hungry needs food that does not
    // depend on having spare hands.
    if (may('cattle') && hungry && count('cattle') < 2) return 'cattle';
    // Short of timber puts up a camp rather than only ever sending more hands
    // into the woods.
    if (may('lumber') && town.resources.wood < 60 && count('lumber') < 2) return 'lumber';
    // Short of ore sinks a mine, the same way. Without this the player is the
    // only one who ever gets the bonus, and an army costs ore.
    if (may('mine') && town.resources.ore < 40 && count('mine') < 2) return 'mine';
    if (may('storage') && !count('storage')) return 'storage';
    if (may('workshop') && pop > 8 && !count('workshop')) return 'workshop';
    // A town that can afford defenders raises them. Without this the military
    // route is a walkover and the choice between awe and force means nothing.
    if (may('barracks') && pop > 6 && !count('barracks')) return 'barracks';
    // A second barracks once it is big enough to man one. Each supports only
    // its own tier's garrison, so without this an army is capped below the
    // strength it needs to march anywhere.
    if (may('barracks') && pop > 16 && count('barracks') < 2) return 'barracks';
    // A big town puts up manors rather than another row of huts: it is the
    // cheaper way to house a crowd once you have the ore.
    if (may('manor') && pop > 14 && canAfford(town, BUILDINGS.manor)) return 'manor';

    // A rival with nothing left to need keeps sprawling - that is how it grows
    // into a power worth fearing. YOUR town stops, because you asked for houses
    // when they need them, not a hut every fourteen seconds forever: an
    // unattended run built 55 houses against 2 farms and still had 1,534 timber
    // piled up with nothing to do with it.
    if (!idleFallback) return null;
    return may('house') ? 'house' : null;
  }

  /** Try hard to find somewhere legal in the town's own land, then give up. */
  function placeSomewhere(town, def, opts) {
    for (let r = TOWN.CENTRE_CLEARANCE + 2; r < town.influenceRadius; r += 3) {
      for (let k = 0; k < 8; k++) {
        const a = rand() * Math.PI * 2;
        const x = town.centre.x + Math.cos(a) * r;
        const z = town.centre.z + Math.sin(a) * r;
        if (place(town, def, x, z, opts).ok) return true;
      }
    }
    return false;
  }

  function rivalTick(town, dt) {
    town.buildTimer -= dt;
    if (town.buildTimer > 0) return;
    town.buildTimer = TOWN.RIVAL_BUILD_INTERVAL;

    // A rival with a full garrison and money to spare promotes it rather than
    // laying yet another foundation. Without this the player is the only side
    // that ever fields anything better than militia.
    if (countGarrison(town) >= garrisonCapOf(town)) {
      const barracks = barracksOf(town).filter((b) => nextTier(b));
      if (barracks.length && upgrade(barracks[0]).ok) return;
    }

    const want = wantedBuilding(town, null);
    const def = want && BUILDINGS[want];
    if (!def || !canAfford(town, def)) return;
    placeSomewhere(town, def);
  }

  /**
   * YOUR people, building for themselves.
   *
   * Same decision a rival makes, narrowed to subsistence, and spending out of
   * YOUR stockpile - which is the whole reason for the reserve. They will not
   * dig into the timber you are saving for a barracks unless they are homeless
   * or starving, and then they will, because a hoard is no comfort to a town
   * that is dying.
   */
  function selfBuildTick(town, dt) {
    const cfg = TOWN.SELF_BUILD;
    if (!cfg.ENABLED) return;
    town.buildTimer -= dt;
    if (town.buildTimer > 0) return;
    town.buildTimer = cfg.INTERVAL;

    // Under threat, your people may raise what they are otherwise forbidden.
    // See TOWN.SELF_BUILD.ALLOWED_UNDER_THREAT - and note this reads the town's
    // OWN memory of being marched on rather than asking combat.js, so town.js
    // still imports nothing new.
    const threatened = state.time - (town.lastThreatAt ?? -Infinity) < cfg.THREAT_MEMORY;
    const allowed = threatened
      ? [...cfg.ALLOWED, ...cfg.ALLOWED_UNDER_THREAT]
      : cfg.ALLOWED;

    const want = wantedBuilding(town, allowed, false);
    const def = want && BUILDINGS[want];
    if (!def) return;

    // Desperate overrides thrift: no roof, no food, or men at the gate.
    const urgent = growthBlocker(town) === 'housing'
      || town.resources.food < population(town) * 1.5
      || (threatened && want === 'barracks');
    const floor = urgent ? cfg.URGENT_RESERVE : cfg.RESERVE;
    for (const [res, amt] of Object.entries(def.cost)) {
      if ((town.resources[res] ?? 0) - amt < (floor[res] ?? 0)) return;
    }

    if (placeSomewhere(town, def, { by: 'people' })) {
      // Said out loud. Your people spending your timber without a word would
      // read as a bug the first time you noticed the stockpile move.
      state.ui?.toast(`Your people raise a ${def.label.toLowerCase()}`);
    }
  }

  /**
   * Awe. A town watches what a god does inside and around its land; enough of
   * it and it comes over willingly, which is the whole non-violent victory
   * route. Cruelty in its sight pushes the meter the other way.
   *
   * `by` is the faction doing the impressing, and it defaults to the player
   * because every existing caller is the player. A town cannot be impressed by
   * the god it already answers to.
   */
  function addImpressiveness(town, amount, why, by = 0) {
    if (town.owner === by) return;
    const before = town.impressedBy[by] ?? 0;
    const now = THREE.MathUtils.clamp(before + amount, 0, 1);
    if (now === before) return;
    town.impressedBy[by] = now;
    // When this god last did anything about this town, which is what the decay
    // above waits on. Only a POSITIVE act counts as courting - being appalled by
    // your cruelty is not attention you get credit for.
    if (amount > 0) town.impressedAt[by] = state.time;

    // ANNOUNCED, at last. Awe has moved since Phase 9 and the only trace it ever
    // left was `debug.lastLog`, for the player alone - so the game's peaceful
    // route to a town worked perfectly and told nobody it was happening.
    // Emitted as a plain fact, like everything else here; the HUD decides what
    // is worth saying out loud.
    //
    // Deliberately BEFORE the capture below, so a listener sees the meter reach
    // 1 and then hears the capture, in that order.
    state.events?.emit('awe-changed', { town, by, from: before, to: now, why });

    if (amount > 0 && now >= 1 && before < 1) {
      capture(town, 'awe', by);
    } else if (why && Math.abs(amount) > 0.02 && by === 0) {
      state.debug.lastLog =
        town.name + (amount > 0 ? ' is impressed' : ' is appalled') +
        ' (' + Math.round(now * 100) + '%)';
    }
  }

  /**
   * Which towns can see a point: their own land plus a margin around it.
   *
   * `by` filters out the watcher's own towns - a god cannot impress itself, and
   * before Phase 20 that was expressed as "skip anything the player owns"
   * because the player was the only god who could.
   */
  function townsWatching(x, z, by = 0) {
    const out = [];
    for (const t of towns) {
      if (t.owner === by) continue;
      const d = Math.hypot(x - t.centre.x, z - t.centre.z);
      if (d <= t.influenceRadius + TOWN.IMPRESS_SIGHT_MARGIN) out.push(t);
    }
    return out;
  }

  /**
   * A town changes hands: villagers, buildings, stockpile and land.
   *
   * `by` is the faction taking it, and it defaults to the player because that
   * is who every pre-Phase-20 caller was. Everything below was already written
   * to move a town from one owner to another; it simply had "the player"
   * hard-coded as the destination in four places.
   *
   * NOT one-way any more. A town can be taken back, and can change hands
   * several times in a match, so nothing here may assume it is the first time.
   */
  function capture(town, how, by = 0) {
    if (town.owner === by) return false;
    const from = town.owner;
    town.owner = by;
    town.tookBy = how;
    /** When it last changed hands. Drives COMBAT.CAPTURE_GRACE. */
    town.tookAt = state.time;
    town.colour = factions[by].colour;

    // Whoever takes it stops being impressed by it and starts from scratch with
    // everyone else - otherwise a town that had already been talked half-round
    // by a third god falls to them for free the moment it changes hands.
    for (let i = 0; i < town.impressedBy.length; i++) {
      town.impressedBy[i] = 0;
      town.impressedAt[i] = -Infinity;   // or the grace outlives the meter
    }

    // Re-tint everything it owns to the new banner.
    for (const b of town.buildings) {
      meshes[b.type].setColorAt(b.index, _c.set(town.colour).lerp(WHITE, TOWN.TINT_MIX));
      meshes[b.type].instanceColor.needsUpdate = true;
    }
    if (town.centreSlot >= 0) {
      castleMesh.setColorAt(town.centreSlot, _c.set(town.colour).lerp(WHITE, TOWN.TINT_MIX));
      castleMesh.instanceColor.needsUpdate = true;
    }
    // Its stockpile goes to the captor; its villagers keep working, for them now.
    //
    // The guard matters: a faction's towns SHARE one pool, so taking a second
    // town off the same faction used to add that pool to itself and double the
    // captor's stores out of nothing.
    const pool = factions[by].resources;
    if (town.resources !== pool) {
      for (const k of ['food', 'wood', 'ore']) {
        pool[k] = (pool[k] ?? 0) + (town.resources[k] ?? 0);
        // Emptied, not left behind: the losing faction's other towns share this
        // object, and leaving the numbers in it would hand them a full granary
        // they had just lost.
        town.resources[k] = 0;
      }
    }
    town.resources = pool;

    // The wall is NOT mended by the change of hands. Taking a town does not
    // hand you an intact fortress, it hands you the ruin you made of one - and
    // restoring it here would have undone the whole point of a permanent
    // breach, since every town worth taking has been breached by definition.
    town.besiegedBy = 0;
    state.fx?.burst(town.centre, 40, how === 'conquest' ? 0xe0553f : 0xffe9b8);
    // `byPlayer` is spelled out rather than left to listeners to work out from
    // `by`, because six of them already guard on exactly that word.
    state.events?.emit('town-captured', {
      town, how, by, from, byPlayer: by === 0
    });
    const owner = factions[by].name;
    if (by === 0) {
      state.debug.lastLog = town.name + ' is yours (' + how + ')';
      state.ui?.toast(town.name + ' has joined you');
    } else {
      state.debug.lastLog = `${town.name} is ${owner}'s (${how})`;
      // Losing one of your own is the loudest thing that can happen to you and
      // it used to be impossible, so it gets the toast rather than the log.
      if (from === 0) state.ui?.toast(`${town.name} has fallen to ${owner}`);
      else state.ui?.toast(`${owner} has taken ${town.name}`);
    }
    return true;
  }

  // --- alignment appearance -------------------------------------------------
  let evilLook = false;

  function applyAlignmentLook() {
    const wantEvil = state.alignment < -ALIGNMENT.GEOMETRY_SWAP_AT;
    if (wantEvil !== evilLook) {
      evilLook = wantEvil;
      for (const key of Object.keys(evilGeos)) {
        meshes[key].geometry = evilLook ? evilGeos[key] : geos[key];
      }
    }
    const a = state.alignment;
    const evil = Math.max(0, -a);
    const good = Math.max(0, a);
    material.color.setRGB(
      1 - evil * 0.10 + good * 0.02,
      1 - evil * 0.22 + good * 0.05,
      1 - evil * 0.26 - good * 0.02
    );
  }

  // --- found everybody ------------------------------------------------------
  // Every site chosen together - see pickSites. The player takes the best one.
  const sites = pickSites(TOWN.RIVALS + 1);
  const playerTown = foundTown(0, sites[0]);
  // The player's stockpile IS state.resources, so seeding the town seeds the
  // HUD and the miracle economy too. Losing this line starves the player's
  // villagers to death inside five minutes while the rivals thrive.
  state.resources.food = TOWN.START_FOOD;
  state.resources.wood = TOWN.START_WOOD;
  state.resources.ore = TOWN.START_ORE;
  for (let i = 1; i <= TOWN.RIVALS; i++) foundTown(i, sites[i]);

  // --- build mode (player only) ---------------------------------------------
  let pending = null;
  const ghost = new THREE.Mesh(
    geos.house,
    new THREE.MeshStandardMaterial({
      color: 0x6fe08a,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      roughness: 0.6
    })
  );
  ghost.visible = false;
  ghost.frustumCulled = false;
  state.scene.add(ghost);

  const ghostRay = new THREE.Raycaster();
  let ghostValid = false;
  let ghostReason = '';
  /** True when placing here would visibly re-cut the hillside. */
  let ghostShapes = false;
  const ghostPos = new THREE.Vector3();

  function beginPlacement(key) {
    const def = BUILDINGS[key];
    if (!def) return;
    pending = def;
    ghost.geometry = evilLook && evilGeos[key] ? evilGeos[key] : geos[key];
    ghost.visible = true;
  }

  function cancelPlacement() {
    pending = null;
    ghost.visible = false;
    // updatePlacement claims the input every frame while placing, and that
    // claim is normally released on pointerup. Cancelling with Escape involves
    // no pointer event, so nothing would ever release it.
    if (state.input.capturedBy === 'town') state.input.capturedBy = null;
  }

  function updatePlacement() {
    if (!pending) return;
    const input = state.input;
    input.capture('town');

    ghostRay.setFromCamera(input.ndc, state.camera.cam);
    const hits = ghostRay.intersectObject(terrain.mesh, false);
    if (!hits.length) { ghost.visible = false; return; }

    ghost.visible = true;
    ghostPos.copy(hits[0].point);
    ghostReason = validate(playerTown, pending, ghostPos.x, ghostPos.z);
    ghostValid = ghostReason === '';
    // Placing here will move the earth. Not a refusal - the ground gets shaped
    // either way - but the player should see it coming rather than watch a
    // hillside change under a building they thought they were dropping on flat
    // land.
    ghostShapes = ghostValid
      && terrain.maxSlopeIn(ghostPos.x, ghostPos.z, pending.pad * 0.6) > pending.maxSlope;

    ghost.position.set(ghostPos.x, terrain.heightAt(ghostPos.x, ghostPos.z), ghostPos.z);
    ghost.material.color.set(ghostValid ? 0x6fe08a : 0xe0553f);

    if (input.pressed[0]) {
      const res = place(playerTown, pending, ghostPos.x, ghostPos.z);
      if (res.ok) {
        if (!input.keyDown('ShiftLeft') && !input.keyDown('ShiftRight')) cancelPlacement();
      } else {
        state.ui?.toast(res.reason);
      }
    }
    if (input.pressed[2] || input.keyPressed('Escape')) cancelPlacement();
  }

  // --- endings ----------------------------------------------------------------

  let endingTimer = 0;

  /** Every faction still holding at least one town, by index. */
  function livingFactions() {
    const out = new Set();
    for (const t of towns) out.add(t.owner);
    return out;
  }

  /** Every town a faction holds. Derived, so it cannot go stale. */
  function townsOf(index) {
    return towns.filter((t) => t.owner === index);
  }

  /** Heads under one faction's banner, across every town it holds. */
  function factionPopulation(index) {
    let n = 0;
    for (const t of towns) if (t.owner === index) n += population(t);
    return n;
  }

  /**
   * Has the game ended?
   *
   * ONE RULE FOR EVERYBODY, which is the point of Phase 20. The island belongs
   * to whoever holds every town on it, however they came to it - a town won
   * over with awe counts exactly as much as one taken at the point of a sword,
   * and which route was taken is written into the ending rather than gating it.
   *
   * Before this phase the rule read "victory is every RIVAL flying your
   * colours", with no matching clause for a rival who managed the same thing,
   * because a rival could not take a town at all. There was exactly one way for
   * the match to end that was not the player's own failure.
   *
   * The two defeats below are the quiet ones. Being conquered outright is
   * combat.js's business, where the siege is resolved.
   */
  function checkEnding(dt) {
    if (state.outcome) return;
    endingTimer -= dt;
    if (endingTimer > 0) return;
    endingTimer = ENDING.CHECK_INTERVAL;

    const living = livingFactions();
    if (living.size === 1) {
      const winner = [...living][0];
      const taken = towns.filter((t) => t.owner !== t.index);
      const conquered = taken.filter((t) => t.tookBy === 'conquest').length;
      const welcomed = taken.length - conquered;
      const how =
        conquered === 0 ? 'every town came willingly'
          : welcomed === 0 ? 'every town was taken by force'
            : `${welcomed} joined, ${conquered} were conquered`;
      if (winner === 0) {
        state.endGame('victory',
          how.replace('came willingly', 'came to you willingly').replace('joined,', 'joined you,'));
      } else {
        state.endGame('defeat', `${factions[winner].name} holds the island - ${how}`);
      }
      return;
    }

    // Holding nothing at all. Reachable only now that a rival can take the last
    // town off you, and it has to be tested separately from extinction: a god
    // with no land but a hundred people wandering it has still lost.
    if (townsOf(0).length === 0) {
      state.endGame('defeat', 'no town flies your banner');
      return;
    }

    // ...and the oldest ending in the game: everyone starved. Counted across
    // every town the player holds rather than the capital alone, or a player
    // whose first town emptied while a captured one thrived would be told their
    // people were gone while watching them work.
    if (factionPopulation(0) <= ENDING.EXTINCTION_POP) {
      state.endGame('defeat', 'your people are gone');
    }
  }

  /**
   * THE TOWN REMEMBERS BEING MARCHED ON.
   *
   * Two facts already on the bus, written to one field. `selfBuildTick` reads
   * it to decide whether your people may raise a barracks without being told -
   * see TOWN.SELF_BUILD.ALLOWED_UNDER_THREAT.
   */
  state.events?.on('raid-declared', (e) => {
    if (e?.to) e.to.lastThreatAt = state.time;
  });
  state.events?.on('raid-ended', (e) => {
    // Not a reset: the memory runs from the LAST time somebody came, and a raid
    // that has just been called off is the most recent time somebody came.
    if (e?.town) e.town.lastThreatAt = state.time;
  });

  // --- simulation -----------------------------------------------------------
  function simStep(dt) {
    checkEnding(dt);
    for (const town of towns) {
      recomputeInfluence(town);
      recomputeHappiness(town);
      town.influenceRadius += (town.targetInfluence - town.influenceRadius) *
        Math.min(1, TOWN.INFLUENCE_SMOOTH * dt);

      for (const b of town.buildings) {
        if (b.def.farm && b.crop < 1) {
          // THE ENTIRE MECHANICAL FOOTPRINT OF THE WEATHER. Rain speeds this
          // up, a drought crawls it, and nothing else in the game changes -
          // which is deliberate: weather that changes everything is weather
          // nobody can plan around. Read through `state` like every other
          // cross-system value, so town.js imports nothing new.
          //
          // Rivals are on the same multiplier. A drought that only touched the
          // player's crops would be the fairness bug Phase 17 spent a whole
          // phase rooting out, arriving by the front door.
          const sky = state.sky?.cropMultiplier ?? 1;
          b.crop = Math.min(1, b.crop + dt * TOWN.CROP_REGROW * sky);
        }
        // Cattle need no farmer, so this is the one food source that keeps
        // running while the fields stand empty.
        if (b.def.cattle) {
          town.resources.food = (town.resources.food ?? 0) + TOWN.CATTLE_FOOD_RATE * dt;
        }
      }

      // Cached once per tick and read by every villager choosing a job. Doing it
      // per villager instead is O(villagers) inside an O(villagers) loop.
      const pop = population(town);
      town.pop = pop;
      town.growthTimer -= dt;
      if (town.growthTimer <= 0) {
        town.growthTimer = TOWN.GROWTH_INTERVAL;
        if (!growthBlocker(town)) {
          // PAY FOR WHAT ARRIVED, and announce only that. The old order paid
          // first and announced regardless of whether `spawn` gave anything
          // back, which is how a full island quietly burned food on children
          // that were never born. `growthBlocker` now knows about the island's
          // ceiling, so this should never refuse - and if it ever does again,
          // it costs nothing and says nothing.
          const born = state.villagers?.spawn(town.centre.x, town.centre.z, town);
          if (born) {
            town.resources.food -= TOWN.GROWTH_FOOD_COST;
            // Emitted for EVERY town, not just yours. Gating it on `isPlayer`
            // made the `first-birth` Legacy milestone unearnable by an AI, which
            // quietly contradicted Phase 17's claim that every team is judged on
            // the same terms. Listeners that only care about your people filter
            // by town themselves - see achievements.js.
            state.events?.emit('villager-born', { pos: town.centre });
          }
        }
      }

      // Masons work on a cracked wall. Nobody rebuilds a breached one.
      if (!town.breached && town.besiegedBy === 0 && town.wallHp < COMBAT.WALL_HP) {
        town.wallHp = Math.min(COMBAT.WALL_HP, town.wallHp + COMBAT.WALL_REGEN * dt);
      }
      // NOBODY LAYS A FOUNDATION WITH AN ARMY IN THE SQUARE.
      //
      // Not flavour - it is what makes RAZE_BEFORE_KEEP possible at all. A town
      // that keeps building while it is being levelled can outlast any siege,
      // and the attacker is then chasing a number that goes back up behind it.
      if ((town.besiegedBy ?? 0) > 0) {
        // no work gets done
      } else if (town.isPlayer) {
        selfBuildTick(town, dt);
      } else {
        rivalTick(town, dt);
      }
      // Awe fades for EVERY suitor, including the player's own towns being
      // courted by a rival god. Gated on `!isPlayer` before Phase 20, which was
      // right when the player was the only one who could impress anybody and
      // would now quietly make the player's own towns immune to being wooed.
      //
      // ...but NOT while that god is still working on them. See
      // TOWN.IMPRESS_GRACE: the decay is 24 points a minute against 3 points a
      // dance, so running it during a performance meant the meter fought the
      // hand that was filling it and the peaceful route could not be finished.
      for (let i = 0; i < town.impressedBy.length; i++) {
        if (i === town.owner || town.impressedBy[i] <= 0) continue;
        const last = town.impressedAt?.[i] ?? -Infinity;
        if (state.time - last < TOWN.IMPRESS_GRACE) continue;
        town.impressedBy[i] = Math.max(0, town.impressedBy[i] - TOWN.IMPRESS_DECAY * dt);
      }
    }
  }

  function update(dt) {
    updatePlacement();
    syncHerd();
    terrain.setInfluenceRings(
      towns.map((t) => ({ centre: t.centre, radius: t.influenceRadius, colour: t.colour })),
      1
    );
    applyAlignmentLook();
  }

  // The public API keeps every player-facing call PLAYER-BOUND, exactly as it
  // was before rivals existed, so the forty-odd existing call sites keep
  // working unchanged. The multi-town versions are the *In variants.
  const api = {
    enabled: true,
    towns,
    playerTown,
    allBuildings,
    pushOutOfCentres,
    gateOf,
    meshes,
    capture,
    townAt,
    addImpressiveness,
    townsWatching,

    // --- factions (Phase 20) ---
    factions,
    townsOf,
    factionPopulation,
    livingFactions,
    /** The town a faction should be thought of as ruling from. */
    capitalOf(index) {
      const mine = townsOf(index);
      if (!mine.length) return null;
      // Its own founding town if it still holds it, else the biggest thing it
      // took - a faction driven out of its capital still has somewhere to be.
      return mine.find((t) => t.index === index)
        ?? mine.reduce((a, b) => (population(b) > population(a) ? b : a));
    },

    // --- player-bound (unchanged signatures) ---
    get centre() { return playerTown.centre; },
    get buildings() { return playerTown.buildings; },
    get happiness() { return playerTown.happiness; },
    upgrade,
    barracksOf,
    tierOf,
    nextTier,
    get influenceRadius() { return playerTown.influenceRadius; },
    get population() { return population(playerTown); },
    get evilLook() { return evilLook; },
    housingCapacity: () => housingCapacity(playerTown),
    growthBlocker: () => growthBlocker(playerTown),
    canAfford: (def) => canAfford(playerTown, def),
    validate: (def, x, z) => validate(playerTown, def, x, z),
    place: (def, x, z) => place(playerTown, def, x, z),
    findBuilding: (pred, x, z) => findBuilding(playerTown, pred, x, z),
    inInfluence(x, z) {
      return Math.hypot(x - playerTown.centre.x, z - playerTown.centre.z)
        <= playerTown.influenceRadius;
    },

    // --- multi-town ---
    populationOf: population,
    housingCapacityOf: housingCapacity,
    buildableFraction,
    growthBlockerOf: growthBlocker,
    canAffordIn: canAfford,
    validateIn: validate,
    placeIn: place,
    findBuildingIn: findBuilding,
    inInfluenceOf(town, x, z) {
      return Math.hypot(x - town.centre.x, z - town.centre.z) <= town.influenceRadius;
    },

    demolish,
    beginPlacement,
    cancelPlacement,
    get placing() { return pending; },
    get ghostValid() { return ghostValid; },
    get ghostReason() { return ghostReason; },
    get ghostShapes() { return ghostShapes; },
    simStep,
    update
  };
  state.towns = towns;
  state.town = api;
  return api;
}
