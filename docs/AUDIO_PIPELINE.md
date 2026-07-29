# Game audio pipeline

The game ships static audio files. ElevenLabs is a development-time content
tool, not a browser dependency: the secret API key is used only by a local
Node script, and the generated MP3 files are served by Vite with the rest of
the game.

## API boundary

- Sound effects and ambience use
  [`POST /v1/sound-generation`](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).
  The manifest uses `eleven_text_to_sound_v2`, explicit durations, and native
  seamless looping for ambience.
- Full instrumental score uses
  [`POST /v1/music`](https://elevenlabs.io/docs/api-reference/music/compose)
  with `music_v2`.
- Authentication is the `xi-api-key` header. The key is never exposed through
  `import.meta.env`, committed to the repository, or sent by the game client.

Create a restricted ElevenLabs key with only Sound Effects and Music access
and a credit quota. Copy `.env.audio.example` to `.env.audio.local`, then put
the key there:

```dotenv
ELEVENLABS_API_KEY=your_key_here
```

`.env.audio.local` is covered by the repository's `*.local` ignore rule.
Setting `ELEVENLABS_API_KEY` in the terminal environment works as well.

## Generate

The source of truth is
`scripts/audio/elevenlabs-audio-manifest.json`. Running without a selection
prints help and does not call the API.

```powershell
# Inspect the whole request and its duration/credit envelope without spending.
npm run audio:generate -- --all --dry-run

# Generate the four missing soundtrack pieces.
npm run audio:generate -- --group soundtrack

# Replace the current river asset with a native seamless ElevenLabs loop.
npm run audio:generate -- --id ambient-river --force

# Forge the complete catalog. Existing tracked ambience is replaced only
# because --force is explicit.
npm run audio:generate -- --all --force

# Require every generated file and verify its model record, size, MP3 header,
# and SHA-256 provenance hash.
npm run audio:verify

# Decode every runtime clip in Chromium and verify duration, sample rate,
# channels, signal level, and non-silent loop edges.
npm run audio:browser-verify
```

Requests run sequentially so a failed generation stops before spending on
later assets. Existing files are skipped without `--force`. After every
successful request, `public/sounds/elevenlabs-generation.json` records the
model, timestamp, response metadata, byte count, and SHA-256 hash—but never
the key.

The printed sound-effect estimate uses ElevenLabs' documented
duration-priced rate of 40 credits per requested second. Music pricing varies
by plan, so the script reports requested music duration without guessing its
cost.

## Runtime mix

- Day/night, village proximity, overview zoom, rain, river distance, and
  chapel schedule drive the existing ambient layers. At overview zoom, the
  rain layer drops out so the environmental mix is wind-only.
  `open_wind_overview.mp3` is the authorized overview wind imported from Selo
  Empire and is checksum-locked so ElevenLabs regeneration does not replace
  it. A broad zoom hysteresis band prevents wheel movement near the boundary
  from repeatedly switching beds, and role-specific 3.5–6.5 second envelopes
  smooth base, village, weather, and overview transitions.
- Four non-looping instrumental tracks are chosen by settlement context,
  season, and time of day. Silence between tracks keeps the score from
  fatiguing the player. Active cues gently duck ambience to 86%, with a slower
  release after the cue, so the score remains legible without flattening the
  environmental soundscape.
- `farm_workers_singing.mp3` is the authorized Selo Empire farm-worker song.
  It fades in only near actively tended grain fields at close zoom and yields
  to the instrumental score when a music cue is active.
- Close workers retain small pooled one-shot effects so large settlements do
  not create an audio element per villager.
- The Settings menu persists a master Game audio switch, independent Ambience
  and Music volume sliders, and a Background music switch. Defaults are 80%
  ambience and 75% music. The Ambience slider scales both the environmental
  beds and positional river loop. The master switch also mutes worker, farm,
  fire, river, ambience, chapel, and UI layers. The four score cues are
  normalized against browser-decoded source RMS, and the combined
  rain/village bed is regression-checked against their default effective
  level.

The `ambient-extra`, `worker-foley`, and `ui` groups drive active fire
incidents, visible worker activities, and placement feedback respectively.
