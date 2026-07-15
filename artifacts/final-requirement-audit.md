# Final requirement audit

Date: 2026-07-15

## Verification gates

- **PASS — complete automated suite:** `npm run test:ci` completed all **23 suites**. Its Rust portion completed **8 tests** with 0 failures.
- **PASS — production client:** `npm run build` completed TypeScript checking and the Vite production build.
- **PASS — complete server crate:** `cargo check --manifest-path server/Cargo.toml` completed without errors.
- **PASS — patch hygiene:** `git diff --check` completed without whitespace errors.
- **PASS — visual evidence:** the dedicated lineup rendered all **21 building kinds**; its DOM and final pixels were checked, including **Pastoral farmstead** and **Woodland swineherd**.

## Requirement matrix

| Requirement | Result | Evidence |
|---|---:|---|
| Remove generic building selection rings; reserve rings for functional work extents | PASS | `src/resources/ResourceInspector.ts` uses a hovering inspection beacon. `src/buildings/buildingExtents.ts` emits only explicit work extents. Repository search finds no building selection-ring implementation. |
| Fields belong to the farmstead, not the mill | PASS | Field placement is constrained to the farmstead work extent in `src/farming/FarmFieldTool.ts`; non-spatial buildings return no extent, covered by `test:expanded-settlement`. |
| Add pastoral gameplay without duplicating the arable farm | PASS | Pastoral farmstead supports cattle or sheep, herd health/capacity/breeding, dairy/preserved-food and wool outcomes, and player-drawn pasture parcels. |
| Cattle affect arable farming through ox power and manure | PASS | `server/src/simulation/livestock.rs` supplies the plough multiplier and fertility bonus; `server/src/simulation/expanded_economy.rs` applies them only to ploughing and directly to field fertility. No manure commodity was introduced. |
| Add woodland swine pannage with meaningful trade-offs | PASS | Swine capacity uses pasture area and live mature-tree count; unsupported pigs require deliberately inefficient grain feed; autumn output is stronger and food dispatch integrates with smokehouses. |
| Add a small hen-yard option without another full farm building | PASS | `hen_yard` is a burgage backyard choice with economy/UI data and an animated chicken visual; covered by `test:backyard-gardens` and `test:livestock`. |
| Player-drawn fenced pastures and management UI | PASS | Pasture tables/reducers, drawing/validation, fence markers, inspectors, specialization controls, herd status, stocking/capacity, and generated bindings are present on client and server. |
| Use free, rigged, animated farm animals | PASS | Cow, bull, sheep, pig, and chicken GLBs are recorded as CC0 1.0 in `public/assets/models/livestock/LICENSE.txt`. `test:livestock` parses every GLB, verifies its articulated skinned mesh, independent cloned rig, and required idle/walk/eating clips. |
| Natural stag/doe or bull/cow distributions rather than even splits | PASS | Deer packs retain their stag/doe distribution. Displayed cattle use cows by default and one bull in established herds; the exact small/medium/large distributions are covered by `test:livestock`. |
| Deer roam near the game resource and flee in first person | PASS | `test:deer-wildlife` verifies local roaming, flee behavior, animation/rig assets, and the static high-zoom game-resource marker. |
| Crouching behind deer suppresses detection; front-cone crouching and all non-crouching approaches alert them | PASS | Cone-based detection and C-toggle crouch integration are covered by `test:deer-wildlife`. |
| Reusable textured construction materials with metric UVs | PASS | Shared plaster, masonry, timber, and clay-tile materials are used across the building library. `test:building-art` verified 24 cards, 21 models, 54 residence variants, 28 shared materials, and 1,296 metric-UV meshes. |
| Vineyard uses SeedThree vines | PASS | `src/vegetation/seedthree/vineyardVines.ts` supplies shared instanced foliage/fruit; `test:building-art` requires the SeedThree cultivated grapevine renderer. |
| Correct final building lineup | PASS | `artifacts/building-lineup-improved.png` is a verified 7×3 gallery of all 21 building kinds, with the pastoral farmstead and woodland swineherd visible in the center row. |

## Audit correction made during this gate

The canonical balance schema already defined `requiresMatureTrees`, but the TypeScript generator omitted all four resource-requirement flags from generated building definitions. The generator now emits `requiresMatureTrees`, `requiresQuarryStone`, `requiresGame`, and `requiresBerries`; generated client balance data was refreshed and the full suite passed afterward.

## Conclusion

All requested feature, gameplay, asset-license, integration, performance-reuse, and visual-evidence requirements in this pass are implemented and verified. No open requirement remains in this scope.
