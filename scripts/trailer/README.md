# Selo Empire gameplay trailer

The production assets are written to `artifacts/trailer`. The final edit is
`Selo-Empire-Gameplay-Trailer-60s.mp4`, with the original ElevenLabs score and
its generation provenance beside it.

The capture uses the isolated `selo-trailer-1550` database and the normal game
renderer, economy, movement and combat simulation. Its map is medium-sized,
using the Delnice meadow seed `1125127504`. Normal game databases are separate.

The `trailer` Cargo feature adds staging reducers. They create real parcels,
households, workshops, trade rules, fields, livestock and military entities.
Household tiers, population, initial working stocks and recruitment are cheated.
The initial construction stockpile is removed after the full town is placed;
production, consumption, hauling and trade then use the ordinary simulation.

The player army contains eight 8-person foot companies, two 6-person crossbow
companies and four 6-person cavalry companies: 14 companies and 100 soldiers.
The opposing debug Ottoman raid is expanded to 100 individual agents.

## Capture and edit

1. Build the server with `cargo build --manifest-path server/Cargo.toml --target
   wasm32-unknown-unknown --release --features trailer` and publish its WASM to
   the dedicated database.
2. Run Vite with `VITE_SPACETIME_DB_NAME=selo-trailer-1550`,
   `VITE_SPACETIME_URI=http://localhost:3000`, and port `5176`.
3. Run `node scripts/trailer/captureServer.mjs` from the repository root.
4. Open `http://localhost:5176/?trailer=1`. The studio controls place the stages,
   set cameras and record shots. **Produce full trailer** starts from the early
   village; **Finish city and battle** resumes after the first two shots.
   **Record built village** skips the growth run. **Record battle only** records
   an already staged battle. The corresponding automatic routes are
   `?trailer=1&produce=capture` and `?trailer=1&produce=battle`.
   `?trailer=1&produce=revision` replaces the two army and three combat takes,
   keeping the existing village footage and score. It stages fresh armies,
   waits for melee using simulation steps, then records ground, mid and RTS views.
5. Run `scripts/trailer/editTrailer.py` with Python. `--available` edits only
   source shots already captured. The script uses the workspace FFmpeg binary
   under `.tmp/trailer-python/imageio_ffmpeg/binaries`.

The recorder advances the real server in controlled heartbeats and saves
30 frames for every second of output. This is frame-by-frame gameplay capture;
the exported frame rate is not a claim about real-time game performance.
The delivered MP4 is exactly 60 seconds at 1920×1080 and 30 fps, with H.264
video and stereo AAC audio. Village sources are 1080p; revised military sources
are 720p with authored in-game cameras and no digital cropping. During capture,
the character renderer uses the same fixed presentation clock as the camera,
so skeletal animations, mounted poses and combat interpolation keep advancing
while the server pauses between its simulation steps.

The edit starts with 10 seconds of combat, moves through village growth and
economic activity, introduces the army, then returns to the battle. The final
four seconds show the existing Selo Empire logo on black. The soundtrack mixes
the original 60-second ElevenLabs composition with the game's sound assets.

`raw/` contains source recordings. The editor selects the newest IVF for each
shot name; earlier WebM and blank experimental recordings are not used.
`edit-decision-list.json` records the source files and exact cut timings.
Economy and army JSON snapshots are retained alongside the footage.
