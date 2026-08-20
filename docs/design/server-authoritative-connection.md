# Server-authoritative connection model

**Status:** Adopted  
**Last updated:** 2026-07-12

## Principle

**Medieval Settlement is not playable without a live SpacetimeDB connection.**

SpacetimeDB is the single source of truth for all gameplay state: economy, buildings, residences, roads, world bootstrap, and simulation ticks. The client is a renderer and input surface — it never invents or persists gameplay state on its own.

There is no offline mode, no local gameplay queue, and no partial play while disconnected.

---

## Why

The previous hybrid model allowed road drawing while SpacetimeDB was down, but blocked buildings and economy. That created three problems:

1. **Split brain** — Local road edits could diverge from server state. On reconnect, the player might see roads that were never synced, or lose edits that never flushed.
2. **False progress** — Drawing roads offline feels like playing, but nothing durable happens. Buildings and residences are blocked, so the core loop is broken anyway.
3. **Ambiguous lifecycle actions** — “New world” could clear local identity and settings while the server database stayed untouched until reconnect, producing a mismatched world on the next session.

A single rule — **connected or not playing** — removes these edge cases and matches how the Rust module is already written (all reducers, all sim ticks, all persistence server-side).

---

## Connection states

| State | Meaning | Player experience |
| --- | --- | --- |
| **Connecting** | Client is opening WebSocket, subscribing to tables, waiting for identity | Loading screen; no tools enabled |
| **Ready** | Connected, subscribed, world bootstrap complete, generation settings compatible | Full gameplay |
| **Disconnected** | Connection lost after a ready session, or connect/bootstrap failed | Gameplay blocked; reconnect UI with auto-retry |
| **Blocked (mismatch)** | Connected but local world settings disagree with authoritative `world_config` on a non-empty server | Error screen; offer “New world…” (requires connection through entire flow) |

“Playable” means **Ready** only.

---

## Rules by lifecycle

### Boot (first visit or refresh)

1. World setup panel (if needed) collects generation settings — this is configuration, not gameplay.
2. Client generates procedural terrain locally from those settings (visual only until server confirms).
3. Client connects to SpacetimeDB and subscribes to all gameplay tables.
4. Client runs world bootstrap reducers (`configure_world`, quarries, trees, foraging) when the server world is empty or settings match.
5. After subscriptions, bootstrap, and authoritative road hydration complete, the gameplay connection calls `enter_world`.
6. **Only after `enter_world` commits:** mark the session Ready, dismiss the loading screen when presentation is ready, and enable construction, road, camera, and walk controls.

If step 3–4 fail: stay on loading/error screen. Do not enable tools. Do not allow road drawing “while waiting.”

### Mid-session disconnect

1. Immediately block all placement tools (roads, buildings, residences, backyard gardens, marketplace trades, admin reducers).
2. The server's `client_disconnected` reducer removes that exact `ConnectionId` from the private active-session table.
3. When no active gameplay connection remains, authoritative simulation returns before any clock, economy, movement, repair, weather, fire, or combat work. The selected 1×/4×/8× speed is preserved; an intentional manual Pause remains selected.
4. Show a non-dismissable overlay: connection lost, retrying.
5. Auto-retry connect with stored token (clear stale token on 401, same as today).
6. On reconnect: re-subscribe, re-hydrate tables, restore roads from the server snapshot, and call `enter_world` for the new connection.
7. Resume gameplay only when `enter_world` commits and the session is Ready again.

There is no local road queue. If the connection drops mid-edit, unsynced road draft changes are discarded.

### New world

Order is strict and atomic from the player’s perspective:

1. Require live connection before showing confirmation.
2. Call `reset_world` on the server and wait for success.
3. Clear local world settings and stored identity token.
4. Reload with world setup (or stored settings for a fresh generation).

If the server is unreachable, **New world is unavailable** — show an error, do not clear local state, do not reload.

### Identity

- Anonymous JWT in `localStorage` is a reconnect convenience, not an offline credential.
- Token without connection grants nothing.

### Active gameplay sessions

- A WebSocket connection alone does not advance the world. Startup probes and clients that are still loading never call `enter_world`.
- `active_game_session` is a private server table keyed by `ConnectionId`, not identity, so two tabs or future co-op members may remain active independently.
- The simulation runs while at least one active gameplay-session row exists and the player-selected game speed is nonzero.
- Disconnect cleanup deletes only the terminated connection. The last active disconnect pauses the world without rewriting the selected speed, so a successful return naturally resumes 1×/4×/8× while a manually paused world stays paused.

---

## What the client may do without gameplay

These are allowed even when not Ready; they are not “playing”:

- Render procedural terrain and sky (pretty loading backdrop).
- Show world setup panel.
- Show connection error / retry UI.
- Run dev smoke-test hooks (tests must start SpacetimeDB themselves).

---

## What the client must not do without Ready

- Draw, edit, or delete roads.
- Place or demolish buildings, residence zones, or backyard gardens.
- Assign labor, trade at marketplace, change village admin policies.
- Advance or display authoritative economy/sim state as if it were live (no fake offline quarries/trees in `toGameState`).
- Queue reducer calls for later sync.

---

## Implementation notes

These rules are implemented in the client:

- `SessionConnectionGate` — single `isReady()` gate for all tools and reducers
- `GameRuntime` — emits session ready/lost after bootstrap and road hydration
- `LoadingScreen` / `SessionConnectionOverlay` — boot retry and mid-session reconnect UI
- `beginNewWorld()` — refuses when not ready; always calls `reset_world` first

---

## Non-goals

- **Offline-first / progressive web app** — out of scope.
- **Optimistic UI with rollback** — allowed for responsiveness while connected (e.g. labor slider), but only when `isReady`; not a substitute for offline play.
- **Local save slots** — persistence remains SpacetimeDB + identity token; no export/import in this model.

---

## Related docs

- `README.md` — feature inventory and local dev setup (`spacetime start` required).
- `.cursor/rules/spacetimedb.mdc` — reducer and subscription patterns.
- `src/runtime/GameRuntime.ts` — world bootstrap and table hydration entry point.
