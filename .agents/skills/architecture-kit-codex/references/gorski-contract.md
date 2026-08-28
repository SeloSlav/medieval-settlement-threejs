# Gorski Kotar / Primorje 1550 kit contract

Use this reference only for the `medieval-road-system` regional kit.

## Local authority

Read these sources in order:

1. `docs/design/building-visual-language.md` — locked game visual language;
2. `src/generated/gameBalance.ts` — authoritative 44-kind building catalog;
3. `docs/GORSKI_KOTAR_VISUAL_GOAL.md` — regional image goal;
4. existing building generators and approved reference renders under `artifacts/`.

The kit source lives in `art-source/gorski-architecture-kit`. Do not edit the generated `.blend` as the source of truth.

## Regional language

- Era: circa 1550.
- Region: Gorski Kotar and the Croatian Littoral.
- Settlement structure: compact buildings aligned with roads, gardens and service yards behind.
- Primary materials: local fieldstone and warm limestone, fir/pine shingles, weathered plank walls, dark structural oak, restrained limewash, and limited terracotta tile on higher-status or coastal-influenced roofs.
- Climate response: steep roofs, deep eaves, snow catches, raised or stone lower work on wet slopes, compact enclosed volume.
- Avoid: ornamental Tudor shorthand, oversized fantasy masonry, generic alpine-chalet decoration, and modern industrial mining equipment.

Historical support:

- Hrčak paper on traditional Gorski Kotar houses: older dwellings commonly combined log or board construction, split fir/pine shingles, and stone foundations, cellars, or slope-ground floors: `https://hrcak.srce.hr/file/264086`.
- Croatian Encyclopedia mining history: `https://enciklopedija.hr/clanak/rudarstvo`.

## Dimensional law

- Blender units are metres.
- X is run, Y is depth, Z is up.
- Public wall face is Y=0; wall body extends toward +Y.
- Base grid is 2 m with authored 1 m and 0.5 m fractions.
- Storeys are 2.40 m humble, 2.70 m domestic, and 3.00 m civic; upper storey is 2.45 m.
- Nominal roof pitch is 50 degrees with 0.32 m eaves and 0.24 m verges.
- Do not use non-uniform component scale.

## Scope

The current catalog contains 44 building kinds. Supplemental coverage must include five residence tiers, six crop kinds, all backyard specializations, road, bridge, pasture, vineyard, burial ground, and dry-stone wall systems.

Keep the output modular. No completed residence, chapel, mill, mine, town hall, or other individual building assembly belongs in the library.
