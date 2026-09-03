# Phase 1 — World and Hand

Working title: **Divinity**. Vite + vanilla ES modules + Three.js r160. No asset
files of any kind: every mesh is built from primitives at boot and every texture
is drawn into a `<canvas>`.

Run it with `npm install` then `npm run dev` (http://localhost:5173).

---

## What was built

**Architecture.** `src/state.js` holds the single shared state object plus every
tunable constant. Systems never import one another — each publishes its API onto
`state` at init (`state.terrain.heightAt`, `state.props.raycast`, …) and reaches
everything else through there. `main.js` is the only module aware of all of them.
Empty stubs exist for `town`, `villagers`, `creature`, `miracles` and `combat` so
the shape of the finished game is visible now.

**Two clocks.** Simulation runs at a fixed 20 Hz; rendering runs at display
refresh and interpolates between the last two sim ticks (`state.alpha`). Props
store `prev`/`prevQuat` alongside `pos`/`quat` purely so the renderer can lerp
them. A frame simulates at most 5 catch-up ticks and then drops the backlog, so
a tab-switch can't trigger a death spiral.

**Terrain.** 256×256 heightmap. Domain-warped radial mask (ragged coastline, not
a circle) × fBm continental base, plus ridged noise pushed inland by `mask²` so
peaks never reach the sea. Heights in the 0–6 band are squashed to give wide,
walkable beaches. Vertex colours blend sand → grass → dry grass → rock by height
and slope, with noise-jittered band edges, and are converted to linear before
upload. Normals are computed analytically from the heightfield rather than with
`computeVertexNormals()` — cheaper, cleaner, and it makes patch updates possible.
A canvas grain texture is multiplied over the whole thing.

**Water.** Single shader plane. Three crossing swells displace the vertices; the
fragment stage rebuilds the normal from the analytic derivative of those same
swells, so lighting matches the geometry exactly. The heightmap is handed to the
shader as a float texture, which gives per-fragment depth for the deep/shallow
gradient and a wobbling foam line along the shore. The plane is recentred on the
camera each frame so its edge is always past the fog.

**Camera.** RTS orbit. Left-drag on empty ground pans by re-projecting the cursor
onto the drag plane each frame and shoving the target by the residual, so the
point you grabbed stays under the cursor. Right-drag orbits, wheel zooms. Target
is clamped to the island disc and follows the ground; the eye is never allowed
inside a hillside.

**The hand.** Procedural: squashed-sphere palm, tapering wrist, five fingers of
three nested capsule joints each so a single `curl` value closes them naturally.
Orientation is built as an explicit orthonormal basis (fingers away from the
viewer, palm leaning partway toward the terrain normal, banking into movement) —
Euler angles were tried first and are wrong, see below.

**Grab and throw.** This got the most attention, as asked:

- Lateral movement is always 1:1 with the mouse. While carrying, the cursor is
  projected onto a *horizontal plane* at the carry height, not onto the terrain.
  Projecting onto terrain makes the object leap whenever you sweep across a hill.
  Height is a separate axis on the wheel.
- A held object is pulled by a damped spring, sub-stepped 5× per tick. The lag is
  what creates weight: spring constants are divided by `mass^MASS_LAG`, so a
  boulder trails your cursor and a pebble snaps to it.
- Release velocity is `mix(objectVelocity, cursorVelocity, THROW_BLEND) * GAIN`,
  plus upward lift proportional to horizontal speed. Object velocity alone feels
  mushy (it never catches a fast flick); cursor velocity alone ignores mass.
  Cursor velocity is averaged over a ~90 ms window so one stuttered frame can't
  launch something into orbit.

**Props.** 576 grabbable objects — three rock silhouettes, boulders, three tree
shapes — as seven InstancedMeshes sharing one vertex-coloured material. Scatter
is rejection-sampled with a minimum-spacing grid. Physics: gravity, terrain
collision split into normal/tangential response, rolling spin, angle-of-repose
friction, buoyancy (wood floats, stone sinks), and sleep. Fast movers adaptively
sub-step so nothing tunnels through a ridge. Hard impacts gouge a crater into the
heightmap (a real patch update of position/normal/colour buffers), throw dust
from the pooled particle system, and shockwave nearby props awake.

**Verified in-browser**, not just by eye: a scripted grab → drag → flick →
release through the real pointer-event path produced a 138-unit arc that landed
and settled in 4.5 s; rock, boulder and tree all come to rest exactly at their
computed contact offset above the ground. 60 fps, 28 draw calls, 320k triangles.

---

## Tunable constants

All in `src/state.js`. The ones that actually change how the game feels:

| Constant | Value | Effect |
|---|---|---|
| `HAND.GRAB_STIFFNESS` / `GRAB_DAMPING` | 150 / 19 | Spring pulling a held object to the cursor. Raise for snappier, lower for floatier. |
| `HAND.MASS_LAG` | 0.55 | How much heavier objects lag. 0 = mass irrelevant, 1 = very sluggish. |
| `HAND.THROW_BLEND` | 0.45 | 0 = throws driven purely by object momentum, 1 = purely by cursor flick. |
| `HAND.THROW_GAIN` | 1.22 | Overall throw distance. Currently a hard flick clears ~140 units. |
| `HAND.THROW_ARC_BIAS` | 0.2 | Upward lift as a fraction of horizontal speed. 0 = flat skimming throws. |
| `HAND.VELOCITY_WINDOW` | 0.09 s | Flick-averaging window. Shorter = twitchier and noisier. |
| `HAND.CARRY_LIFT_SPEED` | 0.017 | Wheel sensitivity while carrying. |
| `HAND.PICK_TOLERANCE_PX` | 22 | Grab forgiveness in screen pixels. The one number to turn if grabbing feels sticky or loose. |
| `HAND.PICK_RADIUS_SCALE` | 1.25 | Extra grab zone proportional to a prop's on-screen size. |
| `HAND.HIGHLIGHT` | 2.4/1.85/0.95 | Albedo multiplier on the prop under the cursor. |
| `HAND.NORMAL_FOLLOW` / `REST_PITCH` | 0.3 / 0.5 | How much the palm matches the ground, and its constant nose-down angle. |
| `PHYS.GRAVITY` | −34 | Deliberately heavier than 9.8 — real gravity feels floaty at this scale. |
| `PHYS.RESTITUTION` / `FRICTION` | 0.3 / 0.7 | Bounce and skid on landing. |
| `PHYS.REPOSE` | 0.20 | Angle of repose as `1 − normal.y` (≈36°). Below it friction holds objects still; above it they slide. |
| `PHYS.IMPACT_THRESHOLD` | 14 | Speed at which landings start cratering and throwing dust. |
| `PHYS.CRATER_DEPTH` / `MAX_CRATER_DEPTH` | 0.02 / 2.4 | Terrain damage per impact. |
| `PHYS.SHOCKWAVE_RADIUS` / `FORCE` | 9 / 0.55 | How far an impact shoves other props. |
| `PHYS.DROWN_TIME` / `SINK_PULL` | 2.0s / 9 | A tree with its centre underwater sinks and is lost. Stone just settles on the seabed. |
| `PHYS.UPROOT_DIST` / `UPRIGHT_DOT` | 2.0 / 0.85 | When a tree stops counting as "planted" — carried this far, or tipped past this uprightness. |
| `WORLD.SIZE` / `EXTENT` / `MAX_HEIGHT` | 256 / 420 / 62 | Island resolution, footprint and relief. |
| `CAMERA.SMOOTH` | 14 | Camera chase rate. Lower is floatier. |
| `SCATTER.*` | — | Prop counts, and the height/slope/spacing rules for placement. |

Debug overlay is **F**; **R** regenerates the island; **P** pauses the sim.
`window.DIVINITY` exposes the whole state object for console tuning.

---

## Bugs found and fixed during the build

Worth recording, because two of them were invisible until specifically tested:

1. **Rocks looked like crumpled paper.** `IcosahedronGeometry` is *non-indexed* —
   every shared corner exists once per touching face. Jittering each vertex with
   an independent random offset pulled those duplicates apart and shredded the
   surface into loose shards. The offset now has to be a pure function of the
   original position.
2. **Props never fell asleep.** Anything on a slope steeper than 0.08 got a
   downhill push with no opposing friction, so it crept forever — a few hundred
   props would have stayed awake for the whole session, burning sim budget
   silently. Replaced with a proper angle of repose plus a relaxing sleep
   threshold for long contacts. Floating props had the same problem from the
   other direction (the sleep test only ran on ground contact) and now settle too.
3. **Upright trees sank into the ground** by their canopy radius: my capsule
   support function dropped the constant radius term.
4. **The hand's fingers pointed at the sky** on sloped terrain. Composing yaw
   with a terrain-normal tilt as Euler angles applies the tilt in the
   already-yawed frame. Rebuilt as an explicit basis.

### Later revision — grabbing was near-impossible

Reported during Phase 3 play: throwing felt fine, grabbing did not. Measured
rather than guessed, and the numbers were damning. A typical rock is only
**6.9 pixels in radius** at default zoom, its silhouette is an irregular,
vertically-squashed polyhedron, and the raycast has to strike an actual
triangle. A click **4px off centre missed every single attempt** (0/5). Worse,
a missed grab falls straight through to the camera and starts a pan — so a
near-miss actively yanked the view around, which is why it felt hostile rather
than merely fiddly.

Fixed with a two-stage pick: exact geometry first, so anything genuinely under
the cursor still wins, then a forgiving screen-space snap to the nearest prop
within `PICK_TOLERANCE_PX`. Each prop's own projected radius also counts, so a
boulder keeps a large grab zone while a pebble gets at least the flat tolerance.
A warm highlight marks whatever a click would take — and critically, the
highlight and the grab call the *same* function, so what you see is guaranteed
to be what you get.

Measured before and after, 8 rocks per offset, world state restored between
every trial:

| Cursor offset | Before | After |
|---|---|---|
| 0px | 6/6 | 7/8 |
| 4px | **0/5** | 8/8 |
| 8px | 0/6 | 8/8 |
| 12px | 0/6 | 8/8 |
| 16px | 0/6 | 8/8 |
| 20px | — | 8/8 |
| 24px | 0/6 | 0/8 (past tolerance, correctly) |

The highlight predicted the grabbed object in 71 of 72 trials. Still 60fps —
the per-frame pick costs nothing measurable.

---

## What I'd do differently

- **The hand model is the weakest thing here.** It reads clearly in motion and
  when zoomed in, but from a high RTS camera it still silhouettes as a pale
  paddle. It wants a proper knuckle bulge, tapered fingertips, and probably a
  subtle rim light or outline so it separates from the terrain at any zoom. If
  Phase 4 is going to recolour it by alignment anyway, that is the moment to
  rebuild it rather than patch it now.
- **Trees are not LOD'd.** 340 instanced 70-triangle conifers are cheap enough
  that it hasn't mattered (320k tris total, all of it mostly terrain), but the
  brief asked for billboards and the budget will look different once 150
  villagers and a creature are in the scene. The cleanest hook is a second
  InstancedMesh of camera-facing quads swapped by distance.
- **Terrain deformation only edits the heightmap.** Craters look right, but props
  already resting in the crater are merely woken rather than properly re-settled,
  and the water's depth texture updates on a 250 ms throttle. Fine now; it will
  need attention when miracles start moving large volumes of earth.
- **Physics is sphere/capsule against a heightfield, with no prop-vs-prop
  collision.** Thrown objects pass through each other and only interact via the
  impact shockwave. That was the right trade for Phase 1, but villagers being
  crushed by a boulder in Phase 3 will need at least a broad-phase grid.
- **The sim/render split is honest but under-used.** Only the hand spring and prop
  physics are on the fixed clock. As villagers and the creature land, I'd add a
  simple system registry (`state.systems[]` with `simStep`/`update`) instead of
  main.js naming each one, which is already starting to get repetitive.
- **20 Hz is a touch coarse for the carry spring.** It's sub-stepped 5×, which
  hides it, but if throwing ever feels imprecise, that sub-step count is the
  first dial to turn.
