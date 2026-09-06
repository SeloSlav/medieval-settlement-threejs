import * as THREE from 'three';
import * as WebGPU from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import { installShadowOverrideCache } from './ShadowOverrideCache.ts';

// BundleGroup exists in Three r185; the bundled ambient declarations omit it.
const BundleGroup = (WebGPU as unknown as {
  BundleGroup: new () => THREE.Group & { static: boolean; version: number; needsUpdate: boolean };
}).BundleGroup;

/** Reuse native commands until the actual visible draw set changes. */
export class StaticRenderBundle extends BundleGroup {
  readonly isCityStaticRenderBundle = true;
  private readonly views = new WeakMap<THREE.Camera, { signature: unknown[]; version: number }>();
  private epoch = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly lastWorld = new THREE.Matrix4();
  private transformsDirty = true;

  constructor() { super(); this.static = false; }

  invalidateTransforms(): void { this.transformsDirty = true; }

  selectView(camera: THREE.Camera): void {
    const view = this.views.get(camera);
    if (view) this.version = view.version;
  }

  override updateMatrixWorld(_force?: boolean): void {
    super.updateWorldMatrix(false, false);
    if (this.transformsDirty || !this.lastWorld.equals(this.matrixWorld)) {
      super.updateMatrixWorld(true);
      this.lastWorld.copy(this.matrixWorld);
      this.transformsDirty = false;
    }
  }

  prepare(camera: THREE.Camera, force: boolean): void {
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
    const previous = this.views.get(camera)?.signature;
    if (force || !previous || signature.length !== previous.length || signature.some((value, i) => value !== previous[i])) {
      this.views.set(camera, { signature, version: ++this.epoch });
    }
    this.selectView(camera);
  }
}

/** Three r185 has no public pre-projection callback for BundleGroup. */
export function installStaticRenderBundlePreparation(renderer: WebGPURenderer): void {
  installShadowOverrideCache(renderer);
  type ProjectionRenderer = {
    _projectObject(object: THREE.Object3D, camera: THREE.Camera, ...args: unknown[]): void;
    _renderBundle(bundle: { bundleGroup: StaticRenderBundle; camera: THREE.Camera }, ...args: unknown[]): void;
  };
  const projectionRenderer = renderer as unknown as ProjectionRenderer;
  const original = projectionRenderer._projectObject;
  const renderBundle = projectionRenderer._renderBundle;
  projectionRenderer._renderBundle = function(bundle, ...args) {
    if (bundle.bundleGroup.isCityStaticRenderBundle) bundle.bundleGroup.selectView(bundle.camera);
    renderBundle.call(this, bundle, ...args);
  };
  projectionRenderer._projectObject = function(object, camera, ...args) {
    if ((object as StaticRenderBundle).isCityStaticRenderBundle) (object as StaticRenderBundle).prepare(camera, false);
    original.call(this, object, camera, ...args);
  };
}
