# Project development rules

- This game is in pre-production and development databases are disposable.
- Do not add migrations, retired-ID tombstones, compatibility adapters, or other code solely to preserve existing saves or database contents unless the user explicitly requests backward compatibility.
- Prefer the cleanest current schema and implementation. It is acceptable for schema-changing work to require a clean database wipe.
