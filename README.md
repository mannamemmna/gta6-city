# mannamemmna/gta6-city

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mannamemmna/gta6-city/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mannamemmna/gta6-city/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Cobalt Bay** is an open-world crime game that runs in a browser tab with no build step, no
network requests and no engine. You play Ren Okonkwo, a courier who takes one last job at the
docks and spends eleven missions finding out who set him up. Walk the island, steal a car,
outrun a three-star pursuit, and watch the sun go down over the water.

Everything is original: the city is generated from a seed at load time, the cars and people are
built from instanced boxes and cylinders, and every sound — engines, sirens, gunshots, the
mission stinger — is synthesised in WebAudio at runtime. There are no image, audio or font files
in the repository. The renderer is hand-written WebGL2: one instanced draw per primitive, a
gradient sky with a sun disc, distance fog, and a 2D canvas HUD layered on top.

What you can do:

- **Explore** a seven-by-seven island of five districts — Cobalt Heights, the Salt Flats, Ferro
  Yards, Pier Nine and the Palisade — on foot, with sprint, crouch, jump and swim.
- **Drive** nine kinds of vehicle, stolen from the street or parked at the kerb, with arcade
  handling, handbrake slides and a speedometer that reads in km/h.
- **Fight** with a pistol, an SMG and a shotgun: hitscan, spread, recoil, tracers, explosions,
  and pedestrians who panic and run.
- **Get wanted.** Crimes raise a five-star meter; cruisers spawn, officers dismount and chase on
  foot, and the search timer only starts once you break line of sight.
- **Play the story.** Eleven missions with a mission card, an objective marker on the minimap, a
  fail state and a payout.
- **Save.** Progress is written to a versioned localStorage slot and restored on reload.

## Run it

    cd game
    python3 -m http.server 8098

Then open http://127.0.0.1:8098/ in desktop Chrome. No install, no build, works offline.

Controls: **WASD** move, **mouse** look (click to lock the pointer), **Shift** sprint or
handbrake, **C** crouch, **Space** jump, **F** enter or leave a vehicle, **left click** fire,
**1/2/3** switch weapon, **R** reload, **Esc** pause, **F5/F9** quick save and load.

### Staged screenshots

Append `?shot=<name>` to build a deterministic scene instead of the title screen, simulate it for
a fixed number of steps, and set `window.__shotReady`. The four names:

    ?shot=cover     three-star pursuit, low chase camera, two cruisers in frame
    ?shot=driving   street-level driving beat down the coast road
    ?shot=mission   armed confrontation outside the Ferro Yards warehouse
    ?shot=vista     elevated wide view over Cobalt Bay

## Build the bundle

    node main.ts

`main.ts` validates `game/` and `screenshots/` against the bounty's caps — index.html present,
one to four images, each a real JPEG or PNG by magic bytes and at most 262144 bytes — copies both
into the output directory (`MAKEFUN_OUTPUT_DIR`, default `/output`), writes `dossier.json` with
the kit's `buildDossier`, and prints file and byte counts plus the dossier's sha256. The same run
twice produces the same dossier hash.

<sub>Entered on [make.fun](https://make.fun/?ref=y7cjn3nn&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
