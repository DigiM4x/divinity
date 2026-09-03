# Third-party assets

Divinity's world was originally 100% procedural. These kits are the exception,
and they are deliberately confined to `src/lib/models.js` — every system
downstream still just receives a `BufferGeometry` and neither knows nor cares
where it came from.

All three packs are by **Kenney** (<https://kenney.nl>) and licensed **CC0 1.0**
(public domain — free commercially, attribution not required). Each pack's
original `License.txt` is kept beside its models.

| Pack | Folder | Used for |
|---|---|---|
| Mini Forest 1.0 | `Models/` | Trees, rocks, boulders |
| Cube Pets 2.0 | `cube-pets/` | The creature (24 animals, player-selectable) |
| Fantasy Town Kit 2.0 | `town-kit/` | Houses, workshop, storage, farm |
| Mini Characters | `mini-characters/` | The villagers |
| Castle Kit | `castle-kit/` | The town centre castle; siege engines await Phase 5 |

`_downloads/` holds the original zips. Only the **GLB** folders are loaded; the
`OBJ format` and `FBX format` copies are the same models again and can be
deleted if repo size matters.

## How each pack is loaded

- **Mini Forest** loads eagerly at boot — props need geometry before `initProps`.
- **Cube Pets** loads *one animal on demand*. 24 animals at ~150KB each is far
  too much to fetch at boot when only one is ever on screen. Results are cached,
  so switching back is instant.
- **Fantasy Town Kit** loads only the 16 pieces the four building types use, out
  of 167. Pulling 3.6MB to use sixteen parts would be absurd.
- **Mini Characters** loads two of the twelve and bakes each into five static
  poses — see below.
- **Castle Kit** loads 11 of its 76 pieces for the town centre. It also contains
  a catapult, trebuchet, ballista, battering ram and siege tower — each with a
  *demolished* variant — which is most of Phase 5's military art already sitting
  on disk.

## Things worth knowing

**Textures were nearly broken in production.** All three packs reference their
palette as an *external* `Textures/colormap.png` rather than embedding it. That
works in dev, where Vite serves the whole source tree and the relative path
resolves — but in a build the GLB is fingerprinted into `/assets/` and the
relative texture 404s. `makeLoader()` in `models.js` imports each palette so it
gets bundled, then rewrites the request via a `LoadingManager` URL modifier.
Verified: two `colormap-*.png` now appear in `dist/`.

**The Cube Pets animals are animated.** Eight node-animation clips each —
`static, idle, walk, run, eat, dance, gesture-positive, gesture-negative` — and
nothing is skinned, so they are cheap node transforms. These map almost
one-to-one onto the creature's states, which is why the hand-written skeleton
animation was removed. `gesture-positive`/`negative` fire on stroke and slap.

**The town kit is modular on a 1×1 grid.** A wall is a thin panel on the +X face
of a unit cell, so four rotated by 90° steps enclose one cell and a roof caps it
at y=1. See `composeParts()` in `models.js` and the builders in `town.js`. The
good/evil alignment variants are the same assembly with different parts
(`wall-broken` + `roof-high-point`), which honours the original "swap variants,
don't build two asset sets" rule.

**Mini Forest rocks are purple slate**, not grey — that is the pack's art
direction, not a texturing fault (compare `Previews/rocks-low.png`). All four
rock models are about twice as wide as they are tall, which is why props use an
ellipsoid support function for ground contact rather than a sphere of the
horizontal radius; see `supportOffset()` in `props.js`.

**The villagers are baked, not skinned.** Mini Characters are *skinned* meshes
with 32 clips, unlike every other pack here. three.js cannot instance a
`SkinnedMesh`, so 150 villagers would have meant 150 draw calls and 150 skinning
updates a frame — precisely the budget this project was built to protect.

Instead `bakeSkinnedPose()` evaluates the skeleton once per pose on the CPU
(`applyBoneTransform` per vertex) and freezes the result into a plain
`BufferGeometry`. Two characters × (1 idle + 4 walk frames) = 10 geometries, and
`syncRender` re-buckets every villager into whichever pose matches its stride
each frame. The crowd animates as a flipbook.

Measured: **146 villagers at 60fps in 11 draw calls.** The stride phase already
advances with distance walked, so driving the flipbook from it keeps feet in
sync with ground speed and stops the crowd marching in lockstep.

The obvious upgrade, if animation quality matters more than the budget, is a
hybrid: the nearest handful as real `SkinnedMesh` with mixers, the rest baked.

**Both modular kits share one loader.** Town kit and castle kit are both 1x1
grids used the same way, so `loadKitPieces(pack, names)` serves both and
`composeParts()` assembles buildings from either. The castle is a keep of three
storeys under a pointed roof, ringed by a curtain wall with corner turrets and a
gate — about 28 pieces merged into a single geometry, so it is one draw call.

`TOWN.CENTRE_CLEARANCE` must stay wider than half `TOWN.CASTLE_WIDTH`, or houses
grow through the battlements.

**Still procedural:** the terrain, water, sky, the hand, and all particles.
