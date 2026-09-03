import * as THREE from 'three';
import { updateTerrainCircleRibbonGeometry } from '../placement/TerrainOverlayGeometry.ts';
import type { BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';

/** Full service reach, independent of how many homes currently draw water. */
export class WellServiceCoverage {
  private readonly ring = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0x57c9ff,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  private signature = '';
  private readonly terrain: Pick<Terrain, 'getHeightAt'>;

  constructor(
    parent: THREE.Object3D,
    terrain: Pick<Terrain, 'getHeightAt'>,
  ) {
    this.terrain = terrain;
    this.ring.name = 'Well water service coverage ring';
    this.ring.renderOrder = 46;
    this.ring.visible = false;
    parent.add(this.ring);
  }

  sync(building: BuildingState | null, force = false): void {
    if (
      building?.kind !== 'well'
      || building.constructionComplete === false
      || !Number.isFinite(building.workRadius)
      || building.workRadius <= 0
    ) {
      this.ring.visible = false;
      this.signature = '';
      return;
    }
    const signature = `${building.id}:${building.x}:${building.z}:${building.workRadius}`;
    if (force || signature !== this.signature) {
      updateTerrainCircleRibbonGeometry(
        this.ring.geometry,
        building,
        building.workRadius,
        (x, z) => this.terrain.getHeightAt(x, z),
        { width: 0.8, lift: 0.18, sampleSpacing: 1.5, segmentCount: 192 },
      );
      this.signature = signature;
    }
    this.ring.visible = true;
  }

  dispose(): void {
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
