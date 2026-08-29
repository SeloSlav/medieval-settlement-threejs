# Tier 1 Parish Church

Source-first authored church assembly based on the west-front silhouette of
St. John the Baptist in Delnice. The photographed church dates to 1825–1829;
the game asset adapts that recognizable massing to the shared Gorski Kotar
material contract and keeps its clock face runtime-owned.

Revision v2 repairs the church opening and roof-fit contract:

- nave lancet host voids use the same `window_lancet` dimensions as their inserts;
- all four belfry hosts use the shared `window_domestic` aperture dimensions;
- the continuous tower stack is raised so the side louvers remain visibly above the nave roof;
- west-gable shoulders and the rear gable stay below the shingle skins;
- the west oculus and slit window retain a readable masonry interval.

Build from a freshly generated kit library:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background .tmp-tier1-church-kit\gorski_architecture_kit.blend --python-exit-code 1 --python art-source\gorski-architecture-kit\examples\tier1-church\build_tier1_church.py
```

The asset is complete only when source validation and clean-scene GLB
round-trip validation both pass and the front, three-quarter, rear, and scale
comparison renders have been inspected. Revision v2 also includes a full side
elevation and a tower-clearance close view for aperture/roof inspection.
