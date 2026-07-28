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

## ElevenLabs generations

Prompts and generation settings live in
`scripts/audio/elevenlabs-audio-manifest.json`. When generation runs,
`elevenlabs-generation.json` records non-secret provenance and file hashes.
See `docs/AUDIO_PIPELINE.md` for setup and commands.
