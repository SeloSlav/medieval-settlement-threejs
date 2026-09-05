import * as THREE from 'three';
import * as WebGPU from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';

// BundleGroup exists in Three r185; the bundled ambient declarations omit it.
const BundleGroup = (WebGPU as unknown as {
  BundleGroup: new () => THREE.Group & { static: boolean; version: number; needsUpdate: boolean };
}).BundleGroup;

/** Reuse native commands until the actual visible draw set changes. */
export class StaticRenderBundle extends BundleGroup {
  readonly isCityStaticRenderBundle = true;
  private readonly views = new WeakMap<THREE.Camera, unknown[]>();
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();

  constructor() { super(); this.static = false; }

  prepare(camera: THREE.Camera): void {
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem, camera.reversedDepth);
    const signature: unknown[] = [];
    this.traverseVisible(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.layers.test(camera.layers)) return;
      const visible = !mesh.frustumCulled || this.frustum.intersectsObject(mesh);
      signature.push(mesh, visible);
      if (!visible) return;
      signature.push(mesh.geometry, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder,
        (mesh as THREE.InstancedMesh).count, mesh.geometry.drawRange.start, mesh.geometry.drawRange.count);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        signature.push(material, material.version, material.visible, material.side, material.transparent);
      }
    });
    const previous = this.views.get(camera);
    if (!previous || signature.length !== previous.length || signature.some((value, i) => value !== previous[i])) {
      this.views.set(camera, signature);
      this.needsUpdate = true;
    }
  }
}

/** Three r185 has no public pre-projection callback for BundleGroup. */
export function installStaticRenderBundlePreparation(renderer: WebGPURenderer): void {
  type ProjectionRenderer = {
    _projectObject(object: THREE.Object3D, camera: THREE.Camera, ...args: unknown[]): void;
  };
  const projectionRenderer = renderer as unknown as ProjectionRenderer;
  const original = projectionRenderer._projectObject;
  projectionRenderer._projectObject = function(object, camera, ...args) {
    if ((object as StaticRenderBundle).isCityStaticRenderBundle) (object as StaticRenderBundle).prepare(camera);
    original.call(this, object, camera, ...args);
  };
}
