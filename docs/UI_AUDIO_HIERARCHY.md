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
| `setup_commit` | Cross from setup into the world | Start world; iron latch and opening oak door | 6 |
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

## Live-game vocabulary

The live interface uses delegated semantic audio at the shared UI root. This
covers existing and dynamically mounted controls without adding a click call
to every panel.

| Cue | Meaning | Examples | Relative weight |
| --- | --- | --- | --- |
| `game_press` | Routine action | Ordinary utility button | 1 |
| `game_tab` | Move within a peer set | Build category, formation, speed | 2 |
| `game_toggle` | Change binary state | Road tool, overlay, checkbox | 3 |
| `game_panel` | Change UI depth | Open menu, inspector, close/back | 4 |
| `game_cancel` | Leave an active world tool | Stationary right-click exits placement | 4 |
| `game_transaction` | Spend or alter an asset | Buy, trade, upgrade, repair | 5 |
| `game_danger` | Destructive intent | Demolish, remove, reset, new world | 6 |
| `confirm` | Successful commitment | Confirm, save, accepted server action | 7 |
| `error` | Rejected outcome | Invalid or failed action | Interruptive |
| `road_place` / `dry_stone_wall_place` | Commit terrain infrastructure | Road or wall accepted | Material-specific |
| `road_remove` / `dry_stone_wall_remove` | Remove terrain infrastructure | Road or wall deleted | Material-specific |
| `edit_undo` / `edit_redo` | Reverse or restore a road edit | Road-tool history | Directional |
| `military_move_order` | Accepted tactical movement | Right-click open ground | Tactical |
| `military_attack_order` | Accepted hostile order | Right-click enemy or camp | Tactical, heavier |
| `military_company_select` | Formation selected | Click or drag-select company | Tactical |
| `quarry_select` / `foraging_select` | Strategic resource selected | Map resource icons | Material-specific |

Open/on directions use a slightly raised playback rate; close/off directions
use a lowered rate. Sliders map their value continuously to pitch and are
limited to one tick every 45 ms.

Controls can override automatic classification with `data-ui-sound` set to a
catalog ID, or opt out with `data-ui-sound="none"`. Explicit result sounds
emitted by a control handler take precedence over delegated feedback, avoiding
double-triggered clicks. Asynchronous outcomes may deliberately follow the
immediate intent cue with a later confirmation or error. Inspector reducer
failures, invalid placements, road synchronization failures, and rejected
military orders all emit the shared `error` cue.

## Authoring and provenance

The source prompts and settings are in
`scripts/audio/elevenlabs-audio-manifest.json` under the `ui-hierarchy`,
`ui-game-hierarchy`, and `gameplay-gap-pass-v1` groups.
Generated MP3 hashes and ElevenLabs model details are recorded in
`public/sounds/elevenlabs-generation.json`.
The `game_cancel.mp3` cue is the authorized user-provided
`small_wooden_latch_c_#3-1788345667176.mp3` recording. It is intentionally
absent from the ElevenLabs manifest and checksum-locked against replacement.

Generate or verify this group with:

```powershell
npm run audio:generate -- --group ui-hierarchy
npm run audio:generate -- --group ui-game-hierarchy
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
