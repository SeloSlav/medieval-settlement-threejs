# Audio assets

Runtime audio is stored locally so the game never exposes a generation API
key or depends on ElevenLabs availability during play.

## Farm workers singing

`ambient/farm_workers_singing.mp3` was copied unchanged from:

`C:\WebProjects\selo-empire\client\public\sounds\ambient\andelek_poje.mp3`

Imported on 2026-07-28 at the project owner's request. The source and imported
files have the same SHA-256 digest:

`4c7639f2abcbdad954db703744a0866b3e81afa4d2f27d6bd51907819e26f1c5`

This is a Selo Empire game asset, copyright Martin Erlic 2026, all rights
reserved. It is not part of the source-code license. Reuse outside projects
authorized by the copyright holder requires permission.

## Villager selection voices

`people/male/person_selected_1.mp3` through `person_selected_6.mp3` and
`people/female/person_selected_1.mp3` through `person_selected_6.mp3` were
copied unchanged from the matching `person_selected_*` files in Selo Empire.
The direct-selection acknowledgement clips were imported first. The combat
pass later added the matching male/female attack exertions and death lines at
`combat/selo/`. The spoken attack barks are retained as source assets but are
not part of automatic combat playback. Live combat combines weapon, shot,
impact, and formation-charge Foley with the ElevenLabs-generated, strictly
nonverbal reactions under `combat/voices/`; those isolated cues cover battle,
charge, damage, flee, and rout states without intelligible language. The
nonverbal Selo death lines remain available for discrete casualty events.
The imported files are Selo Empire game assets, copyright Martin Erlic 2026,
all rights reserved, and follow the same reuse terms above.

`animals/ox_selected_1.mp3` through `ox_selected_3.mp3` are generated locally
through ElevenLabs. Their prompts, settings, and non-secret provenance live in
the normal audio manifest and generation report.

## Development unlock

`ui/development_unlock.mp3` is an unchanged copy of the user-provided
`Heavy_oak_and_iron_g_#2-1788466170992.mp3` recording, adopted on 2026-09-03.
Its SHA-256 digest is
`38e10625738380fac0495a6c577322fa0b54e4c01b9ced1b70ed8f4eaf73d54c`.
It is intentionally absent from the ElevenLabs manifest and generation report.

## River water

`ambient/river_water_rushing.mp3` is an unchanged copy of the user-provided
`WATRFlow-Natural_ambient_soun-Elevenlabs.mp3` recording, adopted on 2026-09-03.
Its SHA-256 digest is
`883cbb48bc7f4a7858ac06f1d4a012084eb6164b46fcb2e208c630d72a6145e9`.
It retains the existing river volume, loop, HRTF positioning, and linear
distance falloff and is absent from the generation manifest and report.

## Forest wind

`ambient/forest_wind.mp3` is an unchanged copy of the user-provided
`AMBForst-A_calm_and_peaceful_-Elevenlabs.mp3` recording, adopted on 2026-09-03.
Its SHA-256 digest is
`0744372614a5259f400659de6dc9b7c263aa2552a23aa554f2c0ba3f5fd8ea8a`.
It replaces only the dedicated forest-wind layer and retains that layer's
existing volume, fades, canopy response, camera-distance behavior, and score
ducking. The separate daytime bird ambience is unchanged.

## ElevenLabs generations

Prompts and generation settings live in
`scripts/audio/elevenlabs-audio-manifest.json`. When generation runs,
`elevenlabs-generation.json` records non-secret provenance and file hashes.
See `docs/AUDIO_PIPELINE.md` for setup and commands.
