# UI audio hierarchy

The interface uses sound to explain intent and consequence, not merely to
acknowledge that a pointer was pressed. Cues share carved wood, parchment,
restrained brass, and wax so they belong to one late-medieval material world.

## New-world setup vocabulary

| Cue | Meaning | Setup examples | Relative weight |
| --- | --- | --- | --- |
| `setup_adjust` | Fine, reversible change | Sliders, selector arrows | 1 |
| `setup_choice` | Ordinary discrete choice | Heraldry color, charge, landscape | 2 |
| `setup_portrait_select` | Identity browsing | Historical portrait | 3 |
| `setup_preset` | Apply a bundled configuration | Heraldry preset, difficulty preset, random seed | 4 |
| `setup_back` | Reverse navigation | Back to Legacy or Heraldry | 4 |
| `setup_advance` | Commit one wizard step | Legacy to Heraldry, Heraldry to Map | 5 |
| `setup_commit` | Final consequential action | Start world | 6 |
| `error` | Rejected or invalid input | Invalid world seed | Interruptive |

Fine-control ticks are limited to one every 42 ms. Range position maps to
playback rate from 0.92 to 1.08, while selector arrows use low pitch for back
and high pitch for forward. This makes direction and motion legible without
requiring more source assets or creating an exhausting stream of identical
clicks.

The setup player reads the same master audio-enabled and sound-effects-volume
preferences as gameplay. Its small vocabulary is preloaded when the wizard
mounts, avoiding first-click latency. Navigation cues are allowed to finish
after a panel unmounts so transitions never cut off their semantic feedback.

## Authoring and provenance

The source prompts and settings are in
`scripts/audio/elevenlabs-audio-manifest.json` under the `ui-hierarchy` group.
Generated MP3 hashes and ElevenLabs model details are recorded in
`public/sounds/elevenlabs-generation.json`.

Generate or verify this group with:

```powershell
npm run audio:generate -- --group ui-hierarchy
npm run audio:verify
npm run audio:browser-verify
```

## Expansion rules

- Reuse a semantic cue when the intent and consequence match, even if the
  visual control differs.
- Add a cue only when players must hear a new class of meaning: destructive
  confirmation, warning escalation, acquisition, loss, or modal interruption.
- Keep routine UI transients dry and centered. Reserve stereo width, long
  tails, and strong low-frequency energy for rare, high-consequence events.
- Never sonify hover by default. Focus and hover sounds are reserved for dense
  controller or keyboard navigation modes where they communicate location.
