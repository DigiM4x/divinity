// grid.js - a uniform spatial hash over the XZ plane.
//
// This is a UTILITY, not a system: it holds no game state of its own, it is not
// registered on `state`, and systems construct their own private instances. It
// sits beside noise.js for the same reason - shared maths that several systems
// need, without any of them importing each other.
//
// Why it exists. Everything in this game has been a flat array scanned linearly,
// which was correct while the counts were small and the scans were rare. Fleeing
// changed that: every living villager has to ask "is there an enemy soldier near
// me?" on every tick, which at 150 villagers against 120 soldiers is 18,000
// distance tests per tick and 360,000 a second - before targeting and the
// creature's war scan do their own passes over the same data.
//
// The grid is rebuilt from scratch each sim tick rather than maintained
// incrementally. Rebuilding is O(n) with a very small constant and needs no
// bookkeeping when things move, die or are removed mid-tick; incremental updates
// would be faster in theory and a source of stale-bucket bugs in practice.

/**
 * @param {number} cell Cell size in world units. Query radii should be of the
 *   same order: much smaller and every query walks mostly-empty cells, much
 *   larger and each cell holds everything and the grid buys nothing.
 */
export function createGrid(cell = 24) {
  /** @type {Map<number, Array>} bucket key -> items */
  const buckets = new Map();
  const inv = 1 / cell;

  // Cell coordinates are offset before packing so negative world coordinates
  // (the island spans roughly -210..210) still produce distinct positive keys.
  // 4096 cells of slack each way is far more than EXTENT / cell will ever need.
  const OFFSET = 4096;
  const STRIDE = 8192;
  const keyOf = (cx, cz) => (cx + OFFSET) * STRIDE + (cz + OFFSET);

  /** Discard everything. Called at the start of every rebuild. */
  function clear() {
    // Keeping the arrays and emptying them avoids re-allocating a few hundred
    // arrays every tick; the Map itself is small and stable after warm-up.
    for (const list of buckets.values()) list.length = 0;
  }

  function insert(item, x, z) {
    const k = keyOf(Math.floor(x * inv), Math.floor(z * inv));
    let list = buckets.get(k);
    if (!list) buckets.set(k, list = []);
    list.push(item);
  }

  /**
   * Refill from a list. `accept` filters (skip the dead), `posOf` reads the
   * position - both default to the shapes used throughout this project.
   */
  function rebuild(items, accept = null, posOf = (o) => o.pos) {
    clear();
    for (const item of items) {
      if (accept && !accept(item)) continue;
      const p = posOf(item);
      if (p) insert(item, p.x, p.z);
    }
  }

  /**
   * Visit every item in the cells overlapping the query circle.
   *
   * Candidates are NOT exact: a cell overlapping the bounding box of the circle
   * is walked whole, so the callback sees things outside `radius` and must do
   * its own distance test. That is the usual bargain, and it keeps this cheap.
   */
  function near(x, z, radius, fn) {
    const minX = Math.floor((x - radius) * inv);
    const maxX = Math.floor((x + radius) * inv);
    const minZ = Math.floor((z - radius) * inv);
    const maxZ = Math.floor((z + radius) * inv);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const list = buckets.get(keyOf(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) fn(list[i]);
      }
    }
  }

  /**
   * Nearest item within `radius` passing `filter`, or null.
   * Returns the item itself; callers wanting the distance can recompute it.
   */
  function nearest(x, z, radius, filter = null) {
    let best = null;
    let bestD2 = radius * radius;
    near(x, z, radius, (item) => {
      if (filter && !filter(item)) return;
      const p = item.pos;
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = item; }
    });
    return best;
  }

  /** Diagnostic: how full the grid is, for the debug panel. */
  function stats() {
    let used = 0;
    let items = 0;
    let worst = 0;
    for (const list of buckets.values()) {
      if (!list.length) continue;
      used++;
      items += list.length;
      if (list.length > worst) worst = list.length;
    }
    return { cells: used, items, worst };
  }

  return { cell, rebuild, insert, near, nearest, stats };
}
