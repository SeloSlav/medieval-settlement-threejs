# UI audio hierarchy

The live-game interface uses the Lord-portrait selection cue as its common
button press. Explicit result cues still explain consequences such as accepted
placement, rejection, animal selection, and military orders.

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

The live interface uses one delegated `game_press` cue at the shared UI root.
This covers existing and dynamically mounted buttons while explicit result and
specialized selection cues can still replace it for the same interaction.

| Cue | Meaning | Examples | Relative weight |
| --- | --- | --- | --- |
| `game_press` | Common live-game button press | Every ordinary button, including the entire lower construction dock | Lord-portrait selection cue |
| `game_tab` | Move within a peer set | Build category, formation, speed | 2 |
| `game_toggle` | Change binary state | Road tool, overlay, checkbox | 3 |
| `game_panel` | Change UI depth | Open menu, inspector, close/back | 4 |
| `game_cancel` | Leave an active world tool | Stationary right-click exits placement | 4 |
| `game_transaction` | Spend or alter an asset | Buy, trade, upgrade, repair | 5 |
| `game_danger` | Destructive intent | Demolish, remove, reset, new world | 6 |
| `confirm` | Successful commitment | Confirm, save, accepted server action | 7 |
| `development_unlock` | Earn lasting knowledge | Unlock a development | 8, rare |
| `error` | Rejected outcome | Invalid or failed action | Interruptive |
| `road_place` / `dry_stone_wall_place` | Commit terrain infrastructure | Road or wall accepted | Material-specific |
| `road_remove` / `dry_stone_wall_remove` | Remove terrain infrastructure | Road or wall deleted | Material-specific |
| `edit_undo` / `edit_redo` | Reverse or restore a road edit | Road-tool history | Directional |
| `illustrated_map_enter` | Cross into the charcoal overworld map | Outward threshold only; silent on return | Restrained map unfolding |
| `military_order_1` … `military_order_6` | Accepted tactical order | Move or attack order for any militia or mercenary company | Random six-clip pool |
| `military_company_select` | Formation selected | Click or drag-select company | Tactical |
| `quarry_select` / `foraging_select` | Strategic resource selected | Map resource icons | Material-specific |

Direct click acknowledgements for people, laborers, animals, and military
companies use a close-camera gain curve. They reach full volume only at the
closest RTS zoom or in first person, and sit at a six-percent floor from the
baseline view outward. Move and attack order acknowledgements do not use this
falloff and remain legible from the strategic camera.

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
The `development_unlock.mp3` cue likewise uses the authorized user-provided
`Heavy_oak_and_iron_g_#2-1788466170992.mp3` recording and is checksum-locked.

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
- Development unlocks use a sturdy latch, a decisive oak-door opening, and a
  firm wooden stop. The cue is reserved for a successful unlock and never plays
  while merely browsing.
- Keep routine UI transients dry and centered. Reserve stereo width, long
  tails, and strong low-frequency energy for rare, high-consequence events.
- Never sonify hover by default. Focus and hover sounds are reserved for dense
  controller or keyboard navigation modes where they communicate location.
