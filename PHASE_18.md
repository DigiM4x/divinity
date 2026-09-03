# Phase 18 — Voice of the World

Twenty thousand lines, twenty-four modules, seventeen phases — and not one audio
call anywhere in the project. The game had enormous mechanical depth and no
sensory depth at all: a silent world under a sun that never moves.

This phase gives the island a voice.

---

## The shape of it

| | |
|---|---|
| `soundconfig.js` | Every clip, gain, cooldown and radius. Pure data, imports nothing. |
| `sound.js` | The mixer, the voice pool, the listeners. Observes only. |

`sound.js` makes the same bargain `prayers.js`, `reckoning.js` and
`graveyard.js` make: **it observes and never commands.** It changes no resource,
moves nothing, and decides nothing. It listens to the bus and reads the camera
position, and that is the whole of its coupling. If it stopped running the game
would play identically — it would simply be silent again.

Web Audio with a pooled `AudioBufferSourceNode` per voice, not `<audio>`
elements: a god game can produce forty simultaneous events and thirty audio
elements will stutter.

---

## Nearly everything it needs already existed

Seventeen phases of *announce facts rather than call each other* turned out to
have built the hook list for free. Eighteen existing events carry almost the
whole soundscape — miracles, throws, buildings rising and falling, deaths varied
by cause, raids, captures, prayers, achievements, the ending.

**One gap, and one new fact.** There was no event for a villager completing a
piece of work, so the axe and the pick had nothing to hang on. Everything else a
villager does was on the bus — born, fed, killed, rescued — but the thing they
spend most of their lives doing was silent. `villager-worked` is the only change
this phase makes to an existing gameplay system.

---

## Three packs, and the split between them is the design

| Pack | Character | Role |
|---|---|---|
| `rpg-audio` | chop, knifeSlice, creak, handleCoins, **books** | hands, leather, timber |
| `impact-sounds` | **impactBell**, impactMining, impactWood, impactSoft | things hitting things |
| `digital-audio` | powerUp, threeTone, zap, phaser | the god layer and the interface |

**A villager's axe is a recording of an axe; an achievement is a tone.** A
fireball is synthesised because nothing in a foley pack is a fireball and nobody
expects magic to sound recorded. Doing it the other way round — a synth blip for
a woodcutter — is the "asset file names are not a taxonomy" mistake wearing a
different hat, and the first pack to arrive would have forced exactly that.

Two details worth keeping:

**Panels are books.** You are a god leafing through a grimoire, and a recorded
page-turn says that in a way a synth blip cannot.

**The bell arrived last.** A town changing hands rang a synthesised power-up
until `impactBell_heavy` turned up in the third pack. A fantasy town coming over
to you without a bell was a missed note, and it is one of the few sounds in the
game the player will remember.

---

## What was going to go wrong

The recurring bug of this project — a collection that only grows — wears an
audible hat here, and the failure is worse because you can hear it.

**A bounded voice pool**, cap 24, oldest stolen first so the most recent thing
that happened is always the thing you hear.

**Per-clip cooldowns.** `villagers-killed` arrives with `count: 20` from a single
lightning bolt. That is **one** sound expressed as volume, not twenty voices.

**Culled before allocation.** A sound beyond the audible range never takes a
voice, rather than playing at zero gain — otherwise a battle across the map would
still consume the whole pool.

**The autoplay gate.** The context starts suspended and resumes on the first
gesture. Until then every call is a no-op and **the game behaves completely
normally** — silence is the correct behaviour, not an error.

**Decoding never blocks.** The game is playable before the clips arrive, and one
that has not decoded yet simply does not play the first time. Silence now beats a
sound arriving a second after the thing that caused it.

---

## Verified

Production build, twelve assertions:

| | |
|---|---|
| Clips decoded | **74 of 74, zero failed** |
| Locked audio | plays nothing, throws nothing |
| 200-event storm | 199 cooled, 1 played, pool never above cap |
| 20 deaths at once | **1 sound** |
| 30 distant events | 30 culled, 0 played |
| Mute | silent, and remembered across a reload |
| Real-pace voices | **peak 3 of 24, median 1, zero stolen** |
| Sim cost | 0.0554 ms/tick, from 0.0415 — the delta is event dispatch |

A ten-minute run produced **64 sounds a minute**, about one a second, which is
the density an island of eighty working people should have.

One number needs explaining rather than quoting: an early measurement showed
*24 of 24 voices and 660 stolen*. That was a test artifact — ten minutes of
simulation compressed into two seconds of wall clock, so every sound started at
once. Re-run at the pace the game actually runs, the pool never went above three.

---

## Still missing

**All 243 clips are one-shots.** There is not a single looping sound among them,
and wind, surf and forest *have* to loop or they are not ambience — the seam in a
repeated one-shot is audible immediately. That layer needs a nature pack and
cannot be faked.

- `ambientWind`, `ambientSea`, `ambientForest` — loops
- `horn` — a heavy metal impact stands in for a raid, honestly poorly
- `fire` — the fireball has a cast but no aftermath
- `creatureCall` — **the beast still has no voice at all**, which for the
  creature the whole game is named around is the most conspicuous absence left

All six are listed in `MISSING` in the config, each next to the hook already
waiting for it. Wiring one later is filling in a filename.

---

## A note on build size

All 243 clips ship to `dist` (2.7 MB), though only 74 are referenced. Vite emits
every globbed file, and nothing unreferenced is ever *fetched* — the runtime cost
is zero and only the deploy is larger. Kept deliberately, the same call made for
the 91 graveyard models: the config can reach for any of them later without
touching the loader.
