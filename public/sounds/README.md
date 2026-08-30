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

## ElevenLabs generations

Prompts and generation settings live in
`scripts/audio/elevenlabs-audio-manifest.json`. When generation runs,
`elevenlabs-generation.json` records non-secret provenance and file hashes.
See `docs/AUDIO_PIPELINE.md` for setup and commands.
