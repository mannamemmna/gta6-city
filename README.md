# mannamemmna/gta6-city

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mannamemmna/gta6-city/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mannamemmna/gta6-city/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Vela Costa** is an original browser open-world crime game — *Marisol Heat*. A seeded coastal
city is generated at load: eight by five blocks of low-poly towers along a beachfront strip, with
driveable cars on the road grid, pedestrians that walk the pavements and scatter when you draw a
weapon or clip someone, and a five-level police response whose pursuit cruisers actually chase,
box you in and shoot back. There is a minimap, collection missions handed out at glowing contact
markers, and a save game that survives a reload. Everything is static files: no network requests,
no build step at play time — the browser loads `index.html` and twenty-odd ES modules and that is
the whole game.

## Run it

```
cd game && python3 -m http.server 8098
```

Then open http://127.0.0.1:8098/

`game/` is a plain static directory, so any file server works; it has to be served over HTTP
rather than opened as `file://` because the game is ES modules with an import map.

### Staged screenshots

Add a `?shot=` query parameter to stage a deterministic frame instead of gameplay:

| query | frame |
| --- | --- |
| `?shot=cover` | the title-facing hero shot over the boulevard |
| `?shot=driving` | Marisol behind the wheel at speed, HUD in car mode |
| `?shot=mission` | a contact marker mission live, objective panel filled |
| `?shot=vista` | the long view from the hills over the whole coastline |

Each one moves the real simulation — real traffic, real pedestrians, a real wanted level with
cruisers closing — to a photogenic moment and renders two frames before signalling ready. Nothing
is painted on top; the HUD element that belongs to that moment is the one that gets shown.

`?seed=` picks a different city. The default is 1337, which is the city the screenshots show.

## Rebuild the hand-in

```
MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` into the output directory, checks the entry against
the bounty's caps (four renders at 256 KiB, 993 game entries, 48 MiB, 1000-byte paths, and that
every render really is a PNG or JPEG by its magic bytes), and writes `out/dossier.json` with the
vendored `make.fun` library. Node 22 or newer, standard library only — no install, no compiler.

## Re-render the screenshots

The four JPEGs in `screenshots/` are 1600×900 renders of the staged frames, the first by name the
cover. To redo them, serve the game and drive a headless browser at each `?shot=` URL, then check
the result is under 256 KiB.

---

<sub>Entered on [make.fun](https://make.fun/?ref=y7cjn3nn&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
