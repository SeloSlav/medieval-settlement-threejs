import * as THREE from 'three';
import * as WebGPU from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import { installShadowOverrideCache } from './ShadowOverrideCache.ts';
import { isRetainedRenderSubtree } from './StaticTransformBoundary.ts';

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
  type RenderObject = { object: THREE.Mesh; getDrawParameters(): { vertexCount: number; instanceCount: number } | null };
  type BundleData = { renderObjects?: RenderObject[] };
  type ProjectionRenderer = {
    _projectObject(object: THREE.Object3D, camera: THREE.Camera, ...args: unknown[]): void;
    _renderBundle(bundle: { bundleGroup: StaticRenderBundle; camera: THREE.Camera }, ...args: unknown[]): void;
    _currentRenderContext: object;
    _bundles: { get(group: THREE.Group, camera: THREE.Camera, context: object): object };
    backend: { get(bundle: object): BundleData };
    _bundleNeedsUpdate(group: THREE.Group, data: BundleData): boolean;
    info: { render: { drawCalls: number; triangles: number } };
  };
  const projectionRenderer = renderer as unknown as ProjectionRenderer;
  const original = projectionRenderer._projectObject;
  const renderBundle = projectionRenderer._renderBundle;
  const statistics = new WeakMap<BundleData, { draws: number; triangles: number }>();
  projectionRenderer._renderBundle = function(bundle, ...args) {
    if (!bundle.bundleGroup.isCityStaticRenderBundle) return renderBundle.call(this, bundle, ...args);
    bundle.bundleGroup.selectView(bundle.camera);
    const data = this.backend.get(this._bundles.get(bundle.bundleGroup, bundle.camera, this._currentRenderContext));
    const recording = this._bundleNeedsUpdate(bundle.bundleGroup, data);
    renderBundle.call(this, bundle, ...args);
    let stats = statistics.get(data);
    if (recording || !stats) {
      stats = { draws: 0, triangles: 0 };
      for (const object of data.renderObjects ?? []) {
        const batch = object.object as THREE.BatchedMesh & { _multiDrawCount: number; _multiDrawCounts: Int32Array };
        if (batch.isBatchedMesh) {
          stats.draws += batch._multiDrawCount;
          for (let i = 0; i < batch._multiDrawCount; i++) stats.triangles += batch._multiDrawCounts[i]! / 3;
        } else {
          const draw = object.getDrawParameters();
          if (draw) { stats.draws++; stats.triangles += draw.vertexCount * draw.instanceCount / 3; }
        }
      }
      statistics.set(data, stats);
    }
    // Three only increments these when encoding, although cached commands are
    // still executed by the GPU. Keep the frame's actual workload visible.
    if (!recording) {
      this.info.render.drawCalls += stats.draws;
      this.info.render.triangles += stats.triangles;
    }
  };
  projectionRenderer._projectObject = function(object, camera, ...args) {
    if (isRetainedRenderSubtree(object)) return;
    if ((object as StaticRenderBundle).isCityStaticRenderBundle) (object as StaticRenderBundle).prepare(camera, false);
    original.call(this, object, camera, ...args);
  };
}
