import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ProjectedRaidTarget } from './frontierSecurity.ts';

export const RAID_TARGET_MARKER_THREAT_THRESHOLD = 0.4;
export const MAX_RAID_TARGET_MARKERS = 4;

type FrontierRiskMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
};

type MarkerPosition = {
  x: number;
  y: number;
  z: number;
  height: number;
};

/**
 * A bounded, pooled world overlay for the current server-equivalent raid
 * projection. The authoritative forecast can select only a handful of targets,
 * so two small instanced meshes cover the entire feature.
 */
export class FrontierRiskMarkers {
  private readonly group = new THREE.Group();
  private readonly ringGeometry: THREE.RingGeometry;
  private readonly beaconGeometry: THREE.OctahedronGeometry;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly beaconMaterial: THREE.MeshBasicMaterial;
  private readonly rings: THREE.InstancedMesh;
  private readonly beacons: THREE.InstancedMesh;
  private readonly positions: MarkerPosition[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private elapsed = 0;
  private threat = 0;

  constructor(options: FrontierRiskMarkersOptions) {
    this.group.name = 'Projected raid target markers';
    this.group.renderOrder = 18;

    this.ringGeometry = new THREE.RingGeometry(0.78, 1, 48);
    this.ringGeometry.rotateX(-Math.PI * 0.5);
    this.beaconGeometry = new THREE.OctahedronGeometry(0.68, 0);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xd39b3a,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beaconMaterial = new THREE.MeshBasicMaterial({
      color: 0xf2c15f,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    this.rings = new THREE.InstancedMesh(
      this.ringGeometry,
      this.ringMaterial,
      MAX_RAID_TARGET_MARKERS,
    );
    this.beacons = new THREE.InstancedMesh(
      this.beaconGeometry,
      this.beaconMaterial,
      MAX_RAID_TARGET_MARKERS,
    );
    this.rings.name = 'Projected raid target rings';
    this.beacons.name = 'Projected raid target beacons';
    this.rings.count = 0;
    this.beacons.count = 0;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beacons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.frustumCulled = false;
    this.beacons.frustumCulled = false;
    this.rings.renderOrder = 18;
    this.beacons.renderOrder = 19;
    this.group.add(this.rings, this.beacons);
    options.parent.add(this.group);

    this.terrain = options.terrain;
  }

  private readonly terrain: Terrain;

  sync(
    targets: readonly ProjectedRaidTarget[],
    threat: number,
    enabled: boolean,
  ): void {
    this.threat = THREE.MathUtils.clamp(threat, 0, 1);
    this.positions.length = 0;
    if (enabled && this.threat >= RAID_TARGET_MARKER_THREAT_THRESHOLD) {
      for (const target of targets.slice(0, MAX_RAID_TARGET_MARKERS)) {
        this.positions.push({
          x: target.x,
          y: this.terrain.getHeightAt(target.x, target.z),
          z: target.z,
          height: target.kind === 'residence' ? 6.2 : 8.2,
        });
      }
    }
    this.rings.count = this.positions.length;
    this.beacons.count = this.positions.length;
    this.group.visible = this.positions.length > 0;
    this.updateInstances();
  }

  tick(dt: number): void {
    if (!this.group.visible) return;
    this.elapsed += Math.max(0, dt);
    this.updateInstances();
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ringGeometry.dispose();
    this.beaconGeometry.dispose();
    this.ringMaterial.dispose();
    this.beaconMaterial.dispose();
    this.positions.length = 0;
  }

  private updateInstances(): void {
    const urgency = THREE.MathUtils.clamp(
      (this.threat - RAID_TARGET_MARKER_THREAT_THRESHOLD)
        / (1 - RAID_TARGET_MARKER_THREAT_THRESHOLD),
      0,
      1,
    );
    const pulse = 1 + Math.sin(this.elapsed * (2.4 + urgency * 1.8)) * (0.05 + urgency * 0.04);
    const ringRadius = (5.4 + urgency * 1.2) * pulse;
    const beaconBob = Math.sin(this.elapsed * 2.2) * 0.35;
    this.ringMaterial.color.setRGB(
      THREE.MathUtils.lerp(0.83, 0.94, urgency),
      THREE.MathUtils.lerp(0.61, 0.20, urgency),
      THREE.MathUtils.lerp(0.23, 0.14, urgency),
    );
    this.beaconMaterial.color.copy(this.ringMaterial.color).offsetHSL(0, 0, 0.12);
    this.ringMaterial.opacity = 0.3 + urgency * 0.2;
    this.beaconMaterial.opacity = 0.72 + urgency * 0.2;

    for (let index = 0; index < this.positions.length; index += 1) {
      const marker = this.positions[index];
      this.position.set(marker.x, marker.y + 0.18, marker.z);
      this.scale.set(ringRadius, 1, ringRadius);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.rings.setMatrixAt(index, this.matrix);

      this.position.set(marker.x, marker.y + marker.height + beaconBob, marker.z);
      const beaconScale = 0.9 + urgency * 0.35;
      this.scale.setScalar(beaconScale);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.beacons.setMatrixAt(index, this.matrix);
    }
    this.rings.instanceMatrix.needsUpdate = this.positions.length > 0;
    this.beacons.instanceMatrix.needsUpdate = this.positions.length > 0;
  }
}
