# Phase 11 — The Island Gets a Landscape

**Status: complete** for the first pass. The Kenney nature kit is integrated and
the whole island is built from it; most of the kit is still on the shelf, and
that is deliberate — see the end.

Until now the world was dressed in whatever happened to be lying around: two
tree models from a small survival pack, stretched to three sizes, scattered
uniformly from beach to summit. Every part of the island looked like every other
part of the island.

---

## Integrating the kit

The nature kit is different from every other pack here in two ways that both
needed handling.

**It ships `GLTF format`, not `GLB format`.** Every other kit's glob points at
the latter. One more glob, and the generic name-to-URL map already worked.

**Its models carry no textures at all.** The town and castle kits share a
`colormap.png` palette; a nature-kit tree is a `leafsGreen` material and a
`woodBark` material, with the colour in the material itself. Merging its meshes
the ordinary way throws that away and paints the whole tree in whichever colour
came first, so there is now a `flattenByMaterial` that **bakes each mesh's
material colour into vertex colours before the merge**. That is the same trick
the project already uses for its own composed geometry, so nothing downstream
had to change.

---

## Biomes

Trees are sorted into altitude bands, and where a spot lands decides what grows
on it:

| Band | Up to | What grows |
|---|---|---|
| shore | 5.5 | palms — `tree_palm`, `palmBend`, `palmDetailedTall`, `palmTall` |
| lowland | 17 | broadleaf — oak, default, fat, detailed, and their `_dark` variants |
| upland | 30 | cone and tall, plus the `_fall` colourways |
| timberline | — | pines — `pineDefaultA`, `pineRoundA`, `pineTallA`, thin |

Scale spread is per-band too, so a palm is never drawn at pine proportions.

**Measured**: 764 trees across **17 distinct species** — 87 on the shore from 5
species, 333 in the lowland from 12, 344 upland from 8. The island now has
regions you can navigate by.

Stone comes from the same kit, so the whole place matches.

---

## Flora

A new system, `flora.js`, and the thing that actually changes what the island
looks like: **2,600 decorative objects** — grass, flowers, mushrooms, bushes,
stumps, fallen logs and pebbles.

It is decoration and nothing else. Flora has no physics, cannot be picked up,
harvested or walked into, and is never simulated. It is written once at startup
and never touched again.

That is precisely why it can be thousands where props are hundreds: a prop is
something the game *reasons about*, and each one costs a slot in a physics list,
a claim registry and a spatial hash. Flora costs one instance matrix, uploaded
once. Thirteen instanced meshes for the lot.

Weighting matters more than the piece list: grass dominates because a meadow is
mostly grass, and flowers and mushrooms are rare precisely so you notice them.

Buildings clear it, with a wider skirt than they clear props by — grass poking
through a doorstep reads worse than a boulder does — and the clear compacts the
instance buffer rather than hiding entries, since a hidden instance still costs
a draw.

---

## Cost

| | |
|---|---|
| Frame | **16.5 ms, 61 fps** |
| Draw calls | 81 |
| Triangles | 950k |
| Props | 1,285 |
| Flora | 2,600 |

The whole landscape overhaul costs three extra draw calls over the old one,
because everything added is instanced.

---

## Bugs found and fixed

Three in a row, each hiding the next, and all three were about **colour**.

1. **Nothing loaded.** I put the kit load after `initProps`, which needs it.
   Every piece warned and the first scatter threw. Load order in `boot` is a
   sequence with real dependencies, not a list.
2. **Rainbow dither on every tree.** The nature geometry carries UVs pointing at
   a texture it does not have, and I drew it with the town kit's material — whose
   map is a *palette atlas of coloured squares*. Every leaf sampled a different
   swatch. Nature pieces now draw with no map at all, on vertex colours alone.
3. **Everything pale and chalky**, which took two goes and one wrong
   explanation. I first blamed a double sRGB→linear conversion in the bake. That
   was wrong — `getHex()` returns sRGB and `new THREE.Color(hex)` reads sRGB, so
   the round trip is the identity. The real cause was mundane: I gave the
   material a pure white base where the project deliberately dims its kit
   materials to `0xb9b9b9`, and under a 2.35-intensity sun with ACES tone
   mapping that difference is the whole shoulder of the curve.

4. **Then the trees glowed bright mint** — reported, and the most interesting bug
   of the phase. Kenney authors colours in a picker and writes those numbers
   straight into `baseColorFactor`, but glTF says that field is **linear**. So
   three correctly reads `0.161, 0.788, 0.671` as linear and renders `#70e6d6`,
   a pale bright mint, when what was meant is `#29c9ab` — the deeper teal on the
   pack's own preview image.

   The fix recovers the raw numbers (`getHex` in *linear* space hands back
   exactly what is in the file) and re-reads them as the sRGB they were always
   meant to be. Foliage now measures `#29c9ab` and bark `#e28357`, matching the
   kit exactly.

5. **The rocks were not rocks.** Reported as "shouldn't the rocks be grey?" —
   and they should. I had picked the kit's `rock_*` family on the strength of the
   name; their materials are `grass` and `dirt`, because they are chunks of
   ground meant for stacking into terrain, not stones. The actual stone is the
   `stone_*` family, whose single material is `stone` `#b8e2e8`. Rocks and
   boulders now measure exactly that.

Worth recording that (4) and (5) were both found by **reading the asset files**
rather than staring at the screen — the glTF material tables say plainly what
colour a thing is supposed to be, and both times that settled in one step what
looking at a screenshot had left ambiguous.

---

## The rocks were enormous

Reported the moment the kit landed, and correct: stone was sized by
`sizeToHeight`, which pins the height and lets the other two dimensions go
wherever the model wants them. The nature kit's rocks are wide and flat, so a
rock asked to stand 2.5 units tall came out **9.6 units across on average and
28.6 at worst** — wider than the castle keep.

Stone is now sized by **width**, which is what you actually read on a boulder.

| | Before | After |
|---|---|---|
| Rock, average width | 9.6 | **2.3** |
| Rock, widest | 28.6 | **3.7** |
| Boulder, average width | 10.6 | **4.0** |

For scale: a villager is 2.25 tall, a house footprint 5.2, the castle 17 across.
Rocks now sit between a person and a doorway, and boulders are things you would
notice rather than things you would climb.

---

## What I'd do differently

- **A kit's file names are not its taxonomy.** `rock_*` being made of grass and
  dirt is not a mistake in the pack - those pieces are terrain blocks, and the
  name is fine in context. Picking assets by name without opening them is how a
  hillside ends up strewn with teal-and-orange lumps. Check the materials.
- **Normalising by one dimension is a trap for anything that is not a tree.**
  `sizeToHeight` is right for trees and characters, which are tall and roughly
  as wide as they are deep. It is wrong for rocks, and it was wrong silently -
  nothing errors, the model simply arrives the size of a building. Anything
  scaled from a kit needs the dimension chosen to match the shape.
- **Most of the kit is still unused.** 41 pieces of 329. The 56 cliff blocks, the
  16 bridge pieces, the 7 paths, the crops, fences, tents, canoes and statues are
  all sitting there. Cliffs in particular would do more for the island's
  silhouette than anything else in the pack — the terrain is smooth heightfield
  everywhere, and a rocky shelf is currently just a steeper patch of grass.
- **Flora is placed blind to biome.** The same grass grows on the shoreline and
  at the timberline. The biome table already exists and flora simply does not
  consult it; palms should have scrub under them and pines should have none.
- **Nothing clears flora except buildings.** A felled tree, a crater from a
  fireball or a battle that levels a district all leave the ground cover
  untouched and pristine, which is a strange thing to notice after the fighting.
- **The kit's own trees are one mesh each**, so a tree is a single instanced draw
  and cannot sway, be felled in stages, or drop leaves. That is the right call at
  this scale, but it does mean tree animation is off the table without splitting
  trunk from canopy.
