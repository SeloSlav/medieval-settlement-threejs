import * as THREE from 'three';
import type { RoadNetwork } from './RoadNetwork.ts';
import {
  createFadingMarkerMaterial,
  markerRevealOpacity,
} from './BuildingRoadConnections.ts';

const MARKER_LIFT = 0.18;
const MARKER_FADE_IN_RATE = 13;
const MARKER_FADE_OUT_RATE = 9;
const MIN_RENDERED_OPACITY = 0.015;

type RuntimeRoadNodeMarker = {
  id: string;
  position: THREE.Vector3;
  opacity: number;
};

export class RoadNodeSnapMarkers {
  private readonly network: RoadNetwork;
  private readonly group = new THREE.Group();
  private readonly ringGeometry = new THREE.RingGeometry(0.78, 1.14, 20);
  private readonly ringMaterial = createFadingMarkerMaterial(0.9, THREE.DoubleSide);
  private readonly previousOpacityByNodeId = new Map<string, number>();
  private readonly cursorPoint = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly markerPosition = new THREE.Vector3();
  private readonly markerScale = new THREE.Vector3(1, 1, 1);
  private readonly ringRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0),
  );
  private ringMarkers: THREE.InstancedMesh | null = null;
  private ringOpacityAttribute: THREE.InstancedBufferAttribute | null = null;
  private markers: RuntimeRoadNodeMarker[] = [];
  private capacity = 0;
  private topologyRevision = -1;
  private hasCursorPoint = false;

  constructor(options: { parent: THREE.Object3D; network: RoadNetwork }) {
    this.network = options.network;
    this.group.name = 'Road node snap markers';
    this.group.visible = false;
    this.group.renderOrder = 30;
    options.parent.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (visible) {
      this.refresh(true);
      return;
    }
    this.hasCursorPoint = false;
    for (const marker of this.markers) marker.opacity = 0;
    this.updateInstances();
  }

  setCursor(point: THREE.Vector3 | null): void {
    this.hasCursorPoint = point !== null;
    if (point) this.cursorPoint.copy(point);
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.refresh();

    const frameDt = THREE.MathUtils.clamp(dt, 0, 0.1);
    let instancesDirty = false;
    for (const marker of this.markers) {
      const currentOpacity = marker.opacity;
      const targetOpacity = this.hasCursorPoint
        ? markerRevealOpacity(distanceXZ(marker.position, this.cursorPoint), true)
        : 0;
      const rate = targetOpacity > currentOpacity ? MARKER_FADE_IN_RATE : MARKER_FADE_OUT_RATE;
      const blend = 1 - Math.exp(-frameDt * rate);
      let nextOpacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, blend);
      if (targetOpacity === 0 && nextOpacity < MIN_RENDERED_OPACITY) nextOpacity = 0;
      if (nextOpacity !== currentOpacity) {
        marker.opacity = nextOpacity;
        instancesDirty = true;
      }
    }

    if (instancesDirty) this.updateInstances();
  }

  dispose(): void {
    this.ringMarkers?.removeFromParent();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.group.removeFromParent();
  }

  private refresh(force = false): void {
    const revision = this.network.getTopologyRevision();
    if (!force && revision === this.topologyRevision) return;
    this.topologyRevision = revision;

    const previousOpacities = this.previousOpacityByNodeId;
    previousOpacities.clear();
    for (const marker of this.markers) previousOpacities.set(marker.id, marker.opacity);
    this.markers = [...this.network.nodes.values()].map((node) => ({
      id: node.id,
      position: node.position.clone(),
      opacity: previousOpacities.get(node.id) ?? 0,
    }));
    this.updateInstances();
  }

  private updateInstances(): void {
    let activeCount = 0;
    for (const marker of this.markers) {
      if (marker.opacity >= MIN_RENDERED_OPACITY) activeCount += 1;
    }
    if (activeCount > 0) this.ensureCapacity(activeCount);
    if (!this.ringMarkers) return;

    let instanceIndex = 0;
    for (const marker of this.markers) {
      const opacity = marker.opacity;
      if (opacity < MIN_RENDERED_OPACITY) continue;
      const scale = 0.86 + opacity * 0.14;
      this.markerScale.setScalar(scale);
      this.matrix.compose(
        this.markerPosition.set(
          marker.position.x,
          marker.position.y + MARKER_LIFT,
          marker.position.z,
        ),
        this.ringRotation,
        this.markerScale,
      );
      this.ringMarkers.setMatrixAt(instanceIndex, this.matrix);
      this.ringOpacityAttribute?.setX(instanceIndex, opacity);
      instanceIndex += 1;
    }

    this.ringMarkers.count = activeCount;
    this.ringMarkers.instanceMatrix.needsUpdate = true;
    if (this.ringOpacityAttribute) this.ringOpacityAttribute.needsUpdate = true;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    this.capacity = Math.max(4, Math.pow(2, Math.ceil(Math.log2(required))));
    this.ringMarkers?.removeFromParent();
    this.ringOpacityAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.ringGeometry.setAttribute('markerOpacity', this.ringOpacityAttribute);
    this.ringMarkers = new THREE.InstancedMesh(
      this.ringGeometry,
      this.ringMaterial,
      this.capacity,
    );
    this.ringMarkers.name = 'Road node snap rings';
    this.ringMarkers.count = 0;
    this.ringMarkers.renderOrder = 30;
    this.ringMarkers.castShadow = false;
    this.ringMarkers.receiveShadow = false;
    this.ringMarkers.frustumCulled = false;
    this.group.add(this.ringMarkers);
  }
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
