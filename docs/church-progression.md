# Church progression

Churches use the existing `chapel` building kind and upgrade reducer. Each upgrade
spends materials atomically, preserves its coffer and assigned clergy, and replaces
the model through the existing tier-specific visual signature. No schema change
or database wipe is required.

| Tier | Building | Timber | Stone | Ironwork | Roof tiles | Coffer | Tithe yield | Base upkeep |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Small wooden church | 32 | 12 | 0 | 0 | 240 | 1× | 1× |
| 2 | Small stone church | 32 | 96 | 8 | 48 | 600 | 1.15× | 1.5× |
| 3 | Large stone church | 64 | 240 | 24 | 112 | 1,200 | 1.3× | 2.5× |
| 4 | Cathedral | 160 | 720 | 80 | 320 | 2,400 | 1.5× | 5× |

Tier 1 lists placement cost; later rows list incremental upgrade costs. The
wooden church remains available before ironworking. Masonry tiers require the
smithy/import and tile chains. Cathedral stone cost is three times the preceding
upgrade, while increased upkeep gives its extra tithe income an operating cost.
All values originate in `balance/gameBalance.json`, with generated Rust and
TypeScript constants. Quarry reserve tests include the entire four-tier chain.

The cathedral establishes a **bishop's seat**. A home whose serving parish is a
staffed, complete cathedral takes 25% fewer settlement ticks, applied after the
ordinary church, monastery hospitality, and Sabbath modifiers. For example,
175 ticks becomes 132, rounded up. A nearer ordinary church retains its own
parish: cathedral effects do not stack across churches. Unstaffed, disconnected,
unfinished, or fire-disabled churches cannot supply the effect through the
existing parish eligibility rules. Clergy assignment occupies the bishop's
office at tier 4; it does not create another population unit. Supply readiness
and raider-threat gates still govern settlement.

Every tier reserves a **24.84 × 31.464 m** plot from initial placement. The client
pad, server placement validation, fences, approach, and batched collision proxy
share that extent. This larger plot applies immediately to existing churches;
old crowded layouts may need to be rebuilt. It does not migrate neighboring
buildings or roads.

The model progression is approximately 10.58, 13.18, 16.91, and 29.88 metres tall.
The cathedral's architectural mass is 20.66 × 25.36 m, excluding its perimeter.
It includes two open bell stages, tiled spires, six aisle/clerestory bays per side,
fourteen flying buttresses, a pierced rose window, a processional portal, a
physical bishop's chair in the choir, and a stone precinct wall. Earlier tiers
gain a sheltered timber porch, masonry quoins and portal hood, then a longer
three-bay parish nave. The tier 4 visible triangle ceiling is 36,000; its actual
source geometry is about 26,000 triangles before the separate shadow batches.

## Verification

- `npm run build` and `cargo check --manifest-path server/Cargo.toml --target wasm32-unknown-unknown` pass.
- `cargo test --manifest-path server/logic/Cargo.toml chapel -- --nocapture` passes six tests.
- `test:chapel-upgrade`, `test:cathedral`, the procedural church architecture
  script, chapel community/parish tests, and quarry balance pass.
- `test:church-browser` captures all four compiled models, front/rear/near/far
  cathedral views, clay and silhouette diagnostics. Captures and metrics are
  written to `output/church-progression/`. No post processing is used. This is
  visual/geometry evidence, not a measured GPU performance benchmark.
- The existing interactive gallery supports all tiers at
  `/building-lineup.html?compare=church-tiers&reference=residence`.

Broader suites still fail in unrelated coverage: a founders-camp empty geometry,
hunter/marketplace triangle budgets, the opening-balance cavalry-yard cost
expectation, old backyard/construction inspector text assertions, and marketplace
food staging. Their failure sites are outside the church implementation. All four
church cases in the broad architecture suite pass.
