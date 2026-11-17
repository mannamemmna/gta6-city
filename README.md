# mannamemmna/gta6-city

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mannamemmna/gta6-city/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mannamemmna/gta6-city/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Vela Costa** is an original open-world crime game that runs in the browser from static files alone: a seeded coastal city of eight by five blocks, driveable low-poly cars, a pedestrian crowd that reacts to gunfire, a five-level police response with pursuit cruisers, a minimap, and a chain of collection missions. Every model, city block, vehicle name, character and mission is generated from the seed in `game/src/` — no external assets, no network calls, no build step at play time.

## Run it

```sh
cd game && python3 -m http.server 8098
```

Then open `http://127.0.0.1:8098/` in a desktop browser with WebGL2. Add `?shot=cover`, `?shot=driving`, `?shot=mission` or `?shot=vista` to stage a deterministic frame for screenshots.

To regenerate the entry bundle (screenshots plus `dossier.json`):

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=y7cjn3nn&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
