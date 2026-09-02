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

# Generate all five gameplay-score pieces.
npm run audio:generate -- --group soundtrack

# Generate only the cue selected for setup/loading.
npm run audio:generate -- --id music-charter-beneath-firs

# Replace the current river asset with a native seamless ElevenLabs loop.
npm run audio:generate -- --id ambient-river --force

# Regenerate the close-town bed and four spatial workshop-family loops.
npm run audio:generate -- --group town-depth-ambience-v1 --force

# Audit the weapon-matched combat suite without spending (24 cues, 32.5 s).
npm run audio:generate -- --group combat-weapon-suite-v2 --dry-run

# Generate only the missing weapon, projectile, impact, and charge cues.
npm run audio:generate -- --group combat-weapon-suite-v2

# Audit the strictly nonverbal combat-human suite without spending
# (30 cues, 31.8 s, about 1,272 duration-priced credits).
npm run audio:generate -- --group combat-nonverbal-voices-v1 --dry-run

# Generate the isolated battle, charge, damage, flee, and rout reactions.
npm run audio:generate -- --group combat-nonverbal-voices-v1

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

- Day/night, settlement depth, overview zoom, rain, river distance, and chapel
  schedule drive the ambient layers. An isolated founders camp is a separate
  pre-town acoustic state: `founders_camp_day` provides a restrained campfire,
  sparse indistinct chatter, burdened footsteps, and supply handling without
  activating or stacking the established village and town-interior loops.
  Established settlement ambience has three scales: `village_day` is the
  actual village-life loop imported from Selo Empire and
  serves as the outskirts bed; `town_interior_day` adds close footsteps,
  carts, doors, animals, and indistinct daily life only inside
  civic or burgage cores at close zoom; and four HRTF-positioned production
  loops follow nearby staffed wood, metal/stone, food/farm, or textile/leather
  workplaces. At most two workshop families play at once. Unfinished,
  unstaffed, fire-repairing, production-paused, nighttime, Sabbath/holiday,
  and strategic-zoom workplaces remain silent. Remote industries no longer
  create a false generic village bed by themselves. At overview zoom, the
  rain layer drops out so the environmental mix is wind-only.
  Both `village_day.mp3` and `open_wind_overview.mp3` are authorized imports
  from Selo Empire and are checksum-locked so ElevenLabs regeneration does not
  replace them. A broad zoom hysteresis band prevents wheel movement near the boundary
  from repeatedly switching beds, and role-specific 3.5–6.5 second envelopes
  smooth base, village, weather, and overview transitions.
- A softened derivative of SeedThree's gapless temperate WAV is a separate
  close-detail forest bed. Its runtime version is low-pass filtered at 2.6 kHz
  and attenuated 7.5 dB to remove the raw source's crackly, overbearing edge.
  Strategic views hear it only while zoomed into measured living canopy;
  first-person view retains a faint open-ground breeze and reaches full level
  under trees. Felling and site clearance reduce the sampled canopy mix, and
  the layer follows the normal ambience volume, master mute, score ducking,
  and its own persisted **Forest wind sounds** Settings toggle. The toggle is
  off by default, making the SeedThree bed explicitly opt-in.
- Five non-looping instrumental tracks are chosen by settlement context,
  season, and time of day. Silence between tracks keeps the score from
  fatiguing the player. Active cues gently duck ambience to 86%, with a slower
  release after the cue, so the score remains legible without flattening the
  environmental soundscape.
- `a_charter_beneath_the_firs.mp3` is selected as the looping planning theme,
  while remaining one of the five cues available during normal gameplay. One
  persistent player carries it across noble selection, world setup, and the
  loading overlay. Browsers that block eager playback retry it on the first
  pointer or keyboard gesture. Once both presentation and server state are
  playable, it fades out over seven seconds before releasing the contextual
  gameplay soundtrack scheduler. The handoff records it as the most recently
  played cue so the scheduler cannot immediately repeat it.
- `farm_workers_singing.mp3` is the authorized Selo Empire farm-worker song.
  It fades in only near actively tended grain fields at close zoom and yields
  to the instrumental score when a music cue is active.
- Close workers retain small pooled one-shot effects so large settlements do
  not create an audio element per villager.
- Automatic combat playback contains no intelligible words, commands,
  dialogue, or chants. Each active fighter routes to its rendered weapon
  family; replicated attack-cooldown resets trigger ranged and melee events
  from that fighter's position. A separate generated suite layers strictly
  nonverbal Croatian-frontier and Ottoman-frontier human exertion or panic for
  battle, charge, health-damage, flee, and rout states. Deterministic cadence
  covers missed edges, up to four same-frame attacks can overlap in an
  18-voice weapon pool, combat-target charges use a six-voice movement pool,
  and human reactions use an eight-voice pool with at most two edge reactions
  per tick and a 0.28-second scheduled global interval. The balanced 72-source
  ceiling covers up to 36 fighters per side without letting large battles
  create unbounded audio.
- A direct world click on a villager, guard, founder, hauler, or other visible
  person plays one randomized gender-matched selection line imported from Selo
  Empire. Direct ox clicks use three short ElevenLabs-generated ox reactions.
  These acknowledgements do not run during background sync or programmatic
  inspector focus, and rapid clicks replace the previous cue.
- The Settings menu persists a master Game audio switch; independent Ambience,
  Sound effects, and Music volume sliders; the Forest wind sounds toggle; and
  a Background music switch. Defaults are 80% ambience, 80% sound effects, and
  75% music. Ambience scales environmental beds and positional river audio.
  Sound effects scales worker impacts, footsteps and other world Foley,
  building activity, combat, fires, chapel bells, and UI feedback. The master
  switch still mutes every layer. The five gameplay score cues are normalized
  against browser-decoded source RMS, and the worst-case rain/town/two-worksite
  mix is regression-checked against their default effective level.

The `ambient-extra`, `worker-foley`, and `ui` groups drive active fire
incidents, visible worker activities, and placement feedback respectively.
The `building-foley` group contains one short, non-looping atmospheric cue for
every non-chapel building kind plus occupied residences. These cues describe
only their physical source to ElevenLabs. A short playback gain envelope
supplies the quiet tail separately, keeping that processing out of prompts.
Building cues play only after an explicit selection; they are never scheduled
as background ambience. The separate `chapel-bells` group contains one natural
bell toll for each church tier. A church selection plays its tier's toll once at
exactly 1.0x playback speed. The daily Angelus reuses that same toll at 06:00,
12:00, and 18:00, sequenced in code as 3, pause, 3, pause, 3, pause, then 9 strokes
(18 total), so the timing is exact and is not compressed by audio generation.

The recognition-critical facilities use their own source vocabulary rather
than a generic placeholder: the Weaponsmith & Armorer, Bowyer & Fletcher,
Well, Stable, Cavalry Yard, Kennel, Spinning & Retting House, Tannery, Cobbler,
and Chandlery all have distinct cues. The Well begins with a dominant bucket
splash; the Kennel begins with one working-dog bark. Material-family sharing is
still deliberate where it reads cleanly, especially residences and timber
storage. Wayside Shrines participate in selection playback like other finished
buildings.

The `world-foley` group adds short event-driven cart, logistics, construction,
demolition, first-person surface, fire-response, animal, seasonal, raid,
burial, trade, and household milestone cues. Runtime schedules are sparse and
distance-bounded; state transitions come from the replicated game state rather
than random background playback. The same playback-only tail treatment is
applied to these cues.

Threat announcements follow game-state boundaries instead of general
proximity. Ottoman raid groups warn once when they first enter the map, giving
the player muster time; they do not play a second town-breach sound. Bandit
patrols remain silent on the distant approach, announce once when their camp is
newly established, and announce again only when the patrol enters town.
Wildlife likewise announces only on town entry. Each group is edge-tracked so
multiple replicated agents produce one sound and one Lord Report, while a
returned bandit patrol may announce a later independent breach.
