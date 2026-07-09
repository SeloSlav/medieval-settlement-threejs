import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import { RoadMeshBuilder } from './RoadMeshBuilder.ts';

export class RoadPreview {
  private readonly meshBuilder: RoadMeshBuilder;
  readonly group = new THREE.Group();
  private previewMesh: THREE.Mesh | null = null;
  private readonly marker: THREE.Mesh;
  private readonly anchors = new THREE.Group();
  private readonly anchorGeometry = new THREE.SphereGeometry(0.45, 12, 8);
  private readonly anchorMaterialValid = new THREE.MeshBasicMaterial({ color: 0xf2d889, depthWrite: false });
  private readonly anchorMaterialInvalid = new THREE.MeshBasicMaterial({ color: 0xc97055, depthWrite: false });

  constructor(meshBuilder: RoadMeshBuilder, materials: RoadMaterialFactory) {
    this.meshBuilder = meshBuilder;
    this.group.name = 'Road preview';
    this.marker = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.55, 40), materials.snap);
    this.marker.name = 'Snap marker';
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 30;
    this.group.add(this.marker, this.anchors);
  }

  update(points: THREE.Vector3[], valid: boolean, width: number, snapPoint: THREE.Vector3 | null): void {
    if (this.previewMesh) {
      this.group.remove(this.previewMesh);
      disposeObject3D(this.previewMesh);
      this.previewMesh = null;
    }
    const mesh = this.meshBuilder.buildPreview(points, width, valid);
    if (mesh) {
      mesh.renderOrder = 25;
      this.previewMesh = mesh;
      this.group.add(mesh);
    }
    this.updateAnchors(points, valid);
    if (snapPoint) {
      this.marker.visible = true;
      this.marker.position.set(snapPoint.x, snapPoint.y + 0.22, snapPoint.z);
    } else {
      this.marker.visible = false;
    }
  }

  clear(): void {
    if (this.previewMesh) {
      this.group.remove(this.previewMesh);
      disposeObject3D(this.previewMesh);
      this.previewMesh = null;
    }
    this.marker.visible = false;
    this.anchors.clear();
  }

  dispose(): void {
    this.clear();
    this.marker.geometry.dispose();
    this.anchorGeometry.dispose();
    this.anchorMaterialValid.dispose();
    this.anchorMaterialInvalid.dispose();
  }

  private updateAnchors(points: THREE.Vector3[], valid: boolean): void {
    this.anchors.clear();
    const material = valid ? this.anchorMaterialValid : this.anchorMaterialInvalid;
    const step = Math.max(1, Math.floor(points.length / 12));
    for (let i = 0; i < points.length; i += step) {
      const sphere = new THREE.Mesh(this.anchorGeometry, material);
      sphere.position.copy(points[i]).add(new THREE.Vector3(0, 0.32, 0));
      sphere.renderOrder = 31;
      this.anchors.add(sphere);
    }
  }
}

