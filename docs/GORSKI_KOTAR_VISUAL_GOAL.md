# Gorski Kotar 1550 — Visual-Only Codex Goal

```text
/goal

Use GPT-5.6-sol with xhigh reasoning in Codex. Work on our EXISTING Three.js
Gorski Kotar 1550 AD village/town builder. Focus exclusively on presentation
quality: art direction, lighting, atmosphere, terrain and water readability,
historically grounded building materials, roads, weather, VFX, camera
composition, loading presentation, UI/HUD finish, and rendering performance.

Do not redesign gameplay, mechanics, controls, economy, simulation, missions,
or persistence. Preserve all existing behavior unless a strictly visual
presentation hook is required.

Hard dependency boundary:
- Do not modify vendor/**.
- Do not modify src/vegetation/seedthree/** or replace SeedThree.
- Vegetation may be changed only by modifying our Seloslav fork and integrating
  that fork through the project's existing integration boundary.
- If the Seloslav fork is not available or a vegetation change is not essential,
  leave vegetation unchanged.
- Do not change package libraries or dependency versions.

Aim for a cohesive, historically credible depiction of Gorski Kotar around
1550: a cold, forested Croatian mountain frontier with believable timber and
stone construction, restrained earth pigments, wet roads, mist, seasonal
weather, readable day/night lighting, strong settlement silhouettes, and a
convincing sense of terrain scale. Use shaders, procedural/generative surface
variation, instancing, LOD, culling, and restrained post-processing where they
improve image quality without making the simulation sluggish.

Fan out specialized sub-agents for:
1. scene cinematography, lighting, sky, fog, water, post-processing, and camera;
2. buildings, terrain, roads, surface weathering, and world-detail cohesion;
3. an independent harsh visual critic.

The critic must visually inspect fixed-size captures from setup, loading,
daylight gameplay, twilight/night gameplay, overview, and close settlement
views. It must compare the work against the visual standards of current
high-end historical strategy and town-builder games, call out artifacts,
repetition, poor hierarchy, illegibility, historical mismatch, and performance
problems, and refuse approval when the evidence does not justify it.

Iterate implementation and independent critique. Never claim “AAA,” “perfect,”
or “better than the reference” without evidence. Preserve user-owned work.
Run the production build and focused visual tests. Record screenshots and
report both improvements and remaining blockers honestly.
```
