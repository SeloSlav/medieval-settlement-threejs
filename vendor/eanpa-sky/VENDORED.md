# Vendored Eanpa Sky

- Upstream: https://github.com/SkyeShark/Eanpa-Sky
- Version: 0.1.0
- Commit: `d70adc14cb674c76787861a49a11f022666548de`
- License: MIT (see `LICENSE`)

Included runtime files:

- `engine/sky_system.js`: Eanpa's world-space WebGPU/TSL atmospheric and
  volumetric cloud engine.
- `assets/starmap_tycho_4k.jpg`: Eanpa's crisp 4096x2048 Tycho star and
  Milky Way panorama.
- `assets/moon_color_1k.jpg`: the Eanpa-distributed NASA CGI Moon Kit LROC
  color map. NASA source imagery is public domain.

Local integration changes to `sky_system.js` are intentionally small:

- expose the engine as an ES module using the application's single Three.js
  runtime;
- accept an observer latitude and local sidereal angle;
- precess Eanpa's J2000 Tycho panorama into epoch 1550 while sampling it in
  equatorial space;
- combine that dense field with the application's authoritative naked-eye
  catalogue using Eanpa's contrast-squared response;
- retain the catalogue alpha channel for optional constellation guides; and
- expose sun/moon direction setters so the authoritative seasonal day/night
  presentation drives Eanpa instead of its demonstration clock;
- leave Eanpa's optional MRT node unset for the application's forward-only
  Three r185 render path, avoiding an empty WebGPU output structure.

The game still builds its own precessed 1550 catalogue from real star
coordinates. It supplies authoritative bright-star color, magnitude, and
constellation guides; the Tycho panorama supplies Eanpa's sharper faint-star
and Milky Way detail. Both layers use the same local time, month, latitude, and
sidereal transform at Gorski Kotar.
