# Medieval Road System

A real-time Three.js sandbox for building a medieval settlement on a procedural 3D landscape. Draw dirt road networks across rolling hills, pine forests, and winding rivers — wooden bridges and graded ramps appear automatically when a path crosses water. Place lumber mills, reforesters, and stone quarries to harvest wood and stone from the world. A [SpacetimeDB](https://spacetimedb.com/) Rust module runs the authoritative economy simulation; the client renders replicated state in real time. Drop into first-person walk mode to explore on foot.

![Road network with wooden bridges, ramps, and forest](docs/screenshots/medieval-roads-bridges-forest.png)

## Features

### Road building

- Interactive point-by-point road drawing projected onto a 3D terrain heightfield.
- Terrain projection so roads follow hills, slopes, and ground variation.
- Snapping to existing road nodes and road segments.
- Automatic edge splitting when new roads connect to existing segments.
- Wheel-adjusted curvature per segment (`Ctrl + scroll`).
- Junction classification for endpoints, bends, T-junctions, cross-junctions, and complex junctions.
- Junction and endpoint cap meshes that blend road ribbons into clean intersections.
- Textured medieval dirt road materials with irregular blended shoulders.
- Live road preview while drawing, plus selection and delete with confirmation popup.
- Undo last placed point, undo last committed change, redo (`Ctrl+Y`), and full draft cancel.
- Terrain road-wear blending that tints grass to packed dirt along committed road corridors.
- Automatic river bridge generation when a road crosses water — graded approach ramps, elevated deck, and instanced support posts.
- Wood-log bridge deck material blended onto the road ribbon via a per-vertex `bridgeBlend` attribute.
- Bridge preview tint while drawing, plus placement validation that rejects spans wider than the max bridge length.
- Rock collision checks that block roads through scattered forest and river-shore boulders.

### Economy & settlement

- **Stockpile** — per-player wood, stone, and water tracked in SpacetimeDB and shown in a live HUD.
- **Lumber mill** — harvests the nearest mature tree within a 42 m work radius every 3.5 s, converting it to a stump and crediting wood to your stockpile.
- **Reforester** — regrows stumps within a 38 m radius through `stump → growing → mature` phases; growing trees render as animated saplings.
- **Stone quarry (building)** — extracts 10 stone per harvest from the nearest procedural quarry site within 55 m, every 4 s, until the site is depleted.
- Server-authoritative simulation tick (200 ms) in the Rust module — buildings, tree phases, and quarry yields all run server-side.
- Building placement tool with terrain-following preview, work-radius rings, and validation (no water, slope, or overlap).
- Click-to-inspect resource panel for quarries, placed buildings, and river access — shows yields, tree counts, and remaining stone.
- Game state export/import (JSON v2) from the game menu for backups and sharing layouts offline.

### Exploration

- First-person walk mode with pointer-lock mouse look, spawned from the current orbit camera position.
- Terrain-following locomotion with sprint, jump, crouch toggle, and head-bob camera motion.
- Free-look while holding `Alt` — look around without turning the body; view recenters on release.
- Scrolling compass HUD with cardinal and intercardinal labels while walking.
- Seamless handoff between RTS orbit camera and walk mode via `~` (backtick).
- Walk locomotion samples road deck height so you can traverse built roads and bridges on foot.

### Landscape & environment

- Large procedural heightfield terrain with multi-layer value noise and broad macro shaping.
- TSL grass-blend terrain material mixing meadow, dense, and dry grass PBR texture sets.
- River-carved valleys with muddy shore blending where water meets land.
- Procedural river layout with multiple source corridors, tributaries, and a central confluence drain.
- Animated river water using a 2D virtual-pipes simulation with foam, shore lap, and alpha feathering.
- Organic river shore SDF fields for natural bank shapes and terrain mud tinting.
- Scatter-placed river shore stones along bank edges, with procedural shore-crossing gaps that clear stones for natural ford points.
- Instanced conifer forest with narrow, broad, and young tree forms plus scattered rocks and outcrops.
- Forest undergrowth — instanced bushes and ferns scattered in dense woodland pockets.
- Streamed 3D grass blade tufts with camera-relative LOD, zoom-gated reveal, and road clearance.
- Road-edge tree stumps placed along committed road corridors after tree clearance.
- River shore reeds clustered along bank edges for added shoreline detail.
- Trees automatically cleared along built roads; props respect river blocking zones.
- Procedural rock quarries (one large, two small) carved into the terrain with pit depressions, scattered boulders, and grass clearance pads.
- Animated volumetric-style sky and cloud dome with wind-driven motion.
- Directional sun lighting, exponential fog, soft shadow maps, and shadow bounds fitting.

### Rendering & UI

- WebGPU renderer preferred with automatic WebGL fallback.
- Dual post-processing pipeline: WebGL bloom + color grade, or WebGPU TSL bloom + daylight grade.
- Progressive loading screen with staged status labels while the world initializes.
- Contextual tip cards for camera, walk, and road modes — toggle off via the game menu.
- Game menu with persistent "turn off tips" preference stored in `localStorage`.
- Toast notifications for rejected road and building placements (steep slope, river too wide, rocks in the way, etc.).
- HUD with floating road/build tool buttons, live stockpile readout, FPS and zoom readout, and compass strip.
- Responsive full-screen canvas built with Vite, TypeScript, and Three.js r185.

## Controls

| Action | Control |
| --- | --- |
| Toggle road tool | `R` or click **Roads** |
| Place road point | Left-click on terrain |
| Undo last placed point while drawing | Right-click |
| Curve the road | Hold `Ctrl` and scroll the mouse wheel |
| Commit / build the road | Click the hammer icon or press `Enter` |
| Delete road segment | In road mode, hold `Alt` and left-click a segment |
| Confirm deletion | Click **Remove** in the popup |
| Undo last road change | `Ctrl+Z` / `Cmd+Z` |
| Redo last road change | `Ctrl+Y` / `Cmd+Y` |
| Cancel active road preview | `Escape` (road mode) |
| Toggle lumber mill placement | Click **Lumber mill** in the build toolbar |
| Toggle reforester placement | Click **Reforester** |
| Toggle stone quarry placement | Click **Stone quarry** |
| Place building | Left-click on terrain (building tool active) |
| Inspect quarry / building / river | Left-click on terrain (no tool active) |
| Pan camera | Right-click drag, `WASD`, or arrow keys |
| Rotate camera | Middle-click drag or `Q` / `E` |
| Zoom camera | Mouse wheel |
| Toggle walk mode | Backtick (`~`) |
| Move (walk mode) | `WASD` or arrow keys |
| Sprint | `Shift` |
| Jump | `Space` |
| Crouch toggle | `C` |
| Free look (walk mode) | Hold `Alt` |
| Exit walk mode | `Escape` (walk mode) |
| Open game menu | Click the menu button (top-left) or `Escape` (RTS mode) |
| Export / import game state | Game menu → **Export game state** / **Import game state** |

## Quick Start

Install dependencies:

```bash
npm install
```

Run the development server (roads only — buildings require SpacetimeDB):

```bash
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173/
```

Create a production build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## SpacetimeDB (authoritative backend)

This project uses [SpacetimeDB 2.0.1](https://spacetimedb.com/) for authoritative game state: stockpile, buildings, tree phases, quarry yields, and road networks. The client is a thin renderer — all economy simulation runs in the Rust module via a scheduled `tick_sim` reducer every 200 ms.

### Run locally

1. Start the SpacetimeDB standalone server (once per machine):

```bash
spacetime start
```

2. Publish the Rust module and regenerate TypeScript bindings:

```bash
npm run deploy:local
```

This runs `generate:world-bootstrap` (tree layout data for server bootstrap), publishes the module to database `city-builder`, and writes TypeScript bindings to `src/generated/`.

To wipe and republish from scratch:

```bash
npm run deploy:local-clean
```

3. Start the Vite dev server:

```bash
npm run dev
```

The client connects to `http://localhost:3000` with database name `city-builder`.

### Anonymous identity

No login is required for local dev. On first visit the client generates a random token, stores it in `localStorage` under `medieval-road-system:spacetime-token`, and reconnects with the same SpacetimeDB identity on refresh. Stockpile, buildings, and roads are scoped to that identity.

When real auth is added later, swap the token source in `src/network/identityPersistence.ts` — the connection layer stays the same.

### What syncs through the DB

| Data | Server table | Notes |
| --- | --- | --- |
| Wood / stone / water | `player_resources` | Per anonymous identity |
| Lumber mill, reforester, stone quarry | `building` | Server tick harvests/regrows |
| Tree stump / growing / mature | `tree_entity` | Bootstrapped after forest load |
| Quarry remaining yield | `quarry` | Global world sites (1 large + 2 small) |
| Roads + bridges | `road_network_state` | Full `RoadNetworkSnapshot` JSON per player |
| Sim tick counter | `world_config` | Monotonic server tick |

### Offline / disconnected behavior

- **Roads** — drawing, editing, and undo/redo work locally; changes queue and sync to SpacetimeDB when connected.
- **Buildings & economy** — require SpacetimeDB. If the server is offline, the client shows a toast and building placement is blocked.
- **Export/import** — JSON game state snapshots (v2) can be saved and restored from the game menu regardless of server status (local client state only until reconnected).

## Project Structure

```text
src/
  app/        App bootstrap and frame loop
  buildings/  Building placement tool, meshes, markers, and validation
  camera/     RTS orbit camera, first-person controller, and locomotion helpers
  data/       SpacetimeDB game store (replicated state)
  generated/  SpacetimeDB TypeScript bindings (auto-generated)
  grass/      Streamed 3D grass blade field and zoom LOD math
  input/      Keyboard and pointer state helpers
  network/    SpacetimeDB client + anonymous identity persistence
  props/      Instanced forest, undergrowth, stumps, rocks, road clearance, shadow filters
  quarries/   Quarry site layout, terrain depression, and rock scatter
  resources/  Game state, tree registry, world layout, resource inspector
  rivers/     River layout, field sampling, water sim, banks, reeds, and shore stones
  roads/      Road graph, drawing tool, mesh generation, junctions, bridges, materials
  runtime/    GameRuntime bridge (SpacetimeDB → App)
  scene/      Three.js scene, renderer backend, lighting, post-processing
  sky/        Animated sky/cloud mesh
  terrain/    Procedural heightfield, grass materials, road wear, ray projection
  ui/         Build toolbar, compass HUD, game menu, tip cards, toasts, loading screen
  utils/      Path geometry helpers and Three.js disposal
  world/      Precomputed world bootstrap data (tree positions for server seed)
server/       SpacetimeDB Rust module (authoritative sim tick)
public/
  assets/     Terrain, road, prop, and third-party texture assets
scripts/
  derive_pbr_maps.py           Utility script for derived texture maps
  generate_wood_logs_texture.py  Procedural wood-log bridge albedo generator
  generateWorldBootstrap.mts   Generates tree bootstrap JSON for server publish
docs/
  screenshots/ Project screenshots used by this README
```

## How It Works

The terrain is generated as a continuous heightfield in `src/terrain/Terrain.ts`. It combines several value-noise layers with broad sine/cosine shaping, then uses vertex colors to blend grass tints and a shore-blend attribute for muddy river banks. `TerrainGrassMaterial.ts` builds a TSL node material that samples meadow, dense, and dry PBR sets per vertex.

`RiverLayout.ts` generates procedural river corridors from map edges toward a central drain, with optional tributaries. `RiverField.ts` rasterizes those corridors into mask and signed-distance fields used for terrain carving, shore mud blending, and prop blocking. `RiverWaterMesh.ts` runs a lightweight 2D virtual-pipes water simulation each frame and drives animated foam and shore effects through `RiverWaterMaterial.ts`.

`QuarryLayout.ts` places one large and two small rock quarries on the playable terrain, carving pit depressions into the heightfield and scattering instanced boulders via `QuarrySystem.ts`. Quarry yields and remaining stone are tracked server-side in the `quarry` table.

Road placement is handled by `src/roads/RoadTool.ts`. Pointer input is projected onto the terrain by `TerrainProjector`, collected as clicked road nodes with optional wheel-adjusted curvature, validated against slope and minimum length rules, and committed into a `RoadNetwork`.

`src/roads/RoadNetwork.ts` stores roads as nodes and edges. It resolves endpoint snapping, splits existing road segments when new paths connect into them, detects crossings, prunes orphan nodes, and classifies junction types.

`src/roads/RoadMeshBuilder.ts` turns road graph edges into terrain-following ribbon meshes. It samples Catmull-Rom curves, builds a core dirt ribbon, adds irregular blended shoulders, and keeps the road slightly above the terrain to avoid z-fighting. When a path crosses water, `RiverBridgeSpans.ts` detects wet runs, raises the deck above the water surface, and blends graded approach ramps; `BridgeSupports.ts` places instanced posts under the deck. `RoadJunctionBuilder.ts` adds endpoint caps and junction patch geometry at classified nodes.

`RoadPlacementValidation.ts` checks slope, minimum length, max bridge span, and rock collisions before commit. `RiverShoreCrossingGaps.ts` seeds procedural clearance zones along river banks so shore stones skip natural crossing points.

`src/props/ForestProps.ts`, `ForestUndergrowth.ts`, and `ForestManager.ts` scatter instanced conifer trees, bushes, ferns, and rocks across the playable area, skipping rivers and clearing trees near committed road edges. `RoadStumps.ts` places cut stumps along road shoulders after clearance. `RiverReeds.ts` adds instanced reed clusters along river banks. `ForestVisualSync.ts` mirrors server tree phases (`stump`, `growing`, `mature`) onto the instanced forest — growing trees swap to animated sapling meshes via `TreeSaplings.ts`.

`src/buildings/BuildingTool.ts` handles placement of lumber mills, reforesters, and stone quarries. `BuildingPlacementValidation.ts` rejects water, steep slopes, and overlapping buildings. `BuildingMarkers.ts` renders placed buildings with work-radius rings. Placement calls the SpacetimeDB `place_building` reducer; the server tick then drives harvesting and regrowth.

`src/grass/GrassBladeField.ts` streams instanced 3D grass tufts in camera-relative chunks. Tufts fade in at close zoom (aligned with the terrain dirt LOD band) and are cleared near committed roads. `TerrainRoadWear.ts` updates a per-vertex `roadWearBlend` attribute so the TSL grass material tints to packed dirt along road corridors.

`src/data/spacetimeGameStore.ts` subscribes to replicated tables and maps rows into client `GameState`. `GameRuntime.ts` connects on startup, bootstraps quarries and trees via reducers, and hydrates the road network from the server snapshot.

`src/resources/ResourceInspector.ts` provides the stockpile HUD and click-to-inspect panel for quarries, buildings, and river access. `WorldQueries.ts` resolves inspectable targets from terrain clicks.

`src/camera/CameraController.ts` drives the RTS orbit camera with smooth pan, rotate, and zoom (displayed as a percentage in the HUD). `FirstPersonController.ts` handles walk mode — pointer-lock look, terrain- and road-deck-sampled foot placement, sprint/jump/crouch, free-look, camera bob, and compass heading publication.

`src/ui/BuildToolbar.ts` composes the HUD: tool buttons, contextual tip cards, FPS/zoom stats, compass strip, delete popup, and game menu. `ToastManager.ts` surfaces placement validation errors. `LoadingScreen.ts` shows staged progress during world bootstrap.

`src/scene/SceneManager.ts` owns the renderer backend, terrain, sky, forest, grass field, river system, quarry system, road groups, selection/preview groups, lighting, fog, and post-processing. Forest and grass build asynchronously after the first frame to keep initial load responsive.

## Tech Stack

- TypeScript
- Vite
- Three.js r185 (WebGL + WebGPU)
- TSL node materials for terrain grass, road surfaces, and river water
- ACES tone mapping, soft shadows, bloom, fog, and custom daylight color grading
- [SpacetimeDB 2.0.1](https://spacetimedb.com/) — authoritative multiplayer backend
- Rust (WASM) server module compiled with `spacetime publish`

## Assets

Texture assets are stored under `public/assets/textures`. The road surface uses a medieval dirt texture set with albedo, normal, roughness, ambient occlusion, height, rut mask, and edge mask maps. River bridge decks use a separate wood-log PBR set (procedurally generated via `scripts/generate_wood_logs_texture.py`). Terrain uses multiple manor grass PBR sets (meadow, dense, dry, blend) and prop textures for pine foliage and rocks. Building meshes use procedural geometry with timber, stone, and shingle materials. Everything is loaded locally at runtime — no external asset CDN required.

## Development Notes

- Road editing works offline; buildings and economy require a running SpacetimeDB server (`spacetime start` + `npm run deploy:local`).
- `npm run build` runs TypeScript first, then Vite's production build.
- `npm run deploy:local` regenerates world bootstrap data, publishes the Rust module, and refreshes `src/generated/` bindings — run this after any server schema or reducer change.
- WebGPU is attempted first; if initialization fails or the browser lacks support, the app falls back to WebGL automatically.
- A Vite chunk-size warning may appear because Three.js and post-processing code are bundled into the main client chunk. The build still completes successfully.
- Forest and grass vegetation build asynchronously after the first frame to keep initial load responsive.
- `window.__medievalGameState` exposes dev helpers for get/export/import state in the browser console.
- `dist/`, `node_modules/`, logs, and local editor files are ignored by Git.
