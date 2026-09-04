import {
  Frustum, Light, Matrix4, PointLight, Sphere, Vector3,
  type BufferAttribute, type Camera, type Object3D,
} from 'three';
import * as WebGPU from 'three/webgpu';
import * as TSL from 'three/tsl';
import type LightsNodeType from 'three/src/nodes/lighting/LightsNode.js';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import type NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import type Node from 'three/src/nodes/core/Node.js';
// This project's ambient facades omit these APIs. Use leaf modules for TYPES
// only: runtime leaf imports create a second TSL stack, breaking lighting-model
// assignments made by the bundled WebGPURenderer.
const { Lighting, LightsNode, NodeUpdateType, StorageBufferAttribute } = WebGPU as unknown as {
  Lighting: typeof import('three/src/renderers/common/Lighting.js').default;
  LightsNode: typeof LightsNodeType;
  NodeUpdateType: typeof import('three/src/nodes/core/constants.js').NodeUpdateType;
  StorageBufferAttribute: typeof import('three/src/renderers/common/StorageBufferAttribute.js').default;
};
const { Fn, If, dot, int, uniform, Loop, directPointLight, positionView, storage, renderGroup } = TSL as unknown as
  Pick<typeof import('three/src/nodes/tsl/TSLBase.js'), 'Fn' | 'If' | 'dot' | 'int' | 'uniform'> &
  Pick<typeof import('three/src/nodes/utils/LoopNode.js'), 'Loop'> &
  Pick<typeof import('three/src/nodes/lighting/PointLightNode.js'), 'directPointLight'> &
  Pick<typeof import('three/src/nodes/accessors/Position.js'), 'positionView'> &
  Pick<typeof import('three/src/nodes/accessors/StorageBufferNode.js'), 'storage'> &
  Pick<typeof import('three/src/nodes/core/UniformGroupNode.js'), 'renderGroup'>;

// Two vec4s per light. An unsized, read-only storage array can grow without
// recompiling, and doesn't consume the terrain's already-full texture budget.
const INITIAL_CAPACITY = 128;

/** Exact fire-light data, omitting only zero-energy/out-of-view lights. */
export class FireLightData {
  attribute = new StorageBufferAttribute(INITIAL_CAPACITY * 2, 4);
  count = 0;
  releaseAttribute: ((attribute: BufferAttribute) => void) | null = null;
  private readonly frustum = new Frustum();
  private readonly projectionView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly viewPosition = new Vector3();

  update(lights: readonly PointLight[], camera: Camera): void {
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(
      this.projectionView, camera.coordinateSystem, camera.reversedDepth,
    );
    // Reserve for every candidate; never truncate dense/overlapping fires.
    if (lights.length * 2 > this.attribute.count) {
      const previous = this.attribute;
      this.attribute = new StorageBufferAttribute(2 ** Math.ceil(Math.log2(lights.length)) * 2, 4);
      this.releaseAttribute?.(previous);
    }
    const data = this.attribute.array as Float32Array;
    this.count = 0;
    for (const light of lights) {
      if (light.intensity === 0) continue;
      this.sphere.center.setFromMatrixPosition(light.matrixWorld);
      this.sphere.radius = light.distance;
      // Cull the whole influence sphere, NOT the flame/point position: an
      // offscreen fire can still illuminate ground at the screen edge.
      if (light.distance > 0 && !this.frustum.intersectsSphere(this.sphere)) continue;
      this.viewPosition.copy(this.sphere.center).applyMatrix4(camera.matrixWorldInverse);
      const offset = this.count++ * 8;
      data[offset] = this.viewPosition.x;
      data[offset + 1] = this.viewPosition.y;
      data[offset + 2] = this.viewPosition.z;
      data[offset + 3] = light.distance;
      data[offset + 4] = light.color.r * light.intensity;
      data[offset + 5] = light.color.g * light.intensity;
      data[offset + 6] = light.color.b * light.intensity;
      data[offset + 7] = light.decay;
    }
    if (this.count > 0) this.attribute.needsUpdate = true;
  }

  dispose(): void { this.releaseAttribute?.(this.attribute); }
}

/** Fire lifecycle changes data, never the world's light-dependent shader key. */
export class FireLightsNode extends LightsNode {
  static get type(): string { return 'FireLightsNode'; }
  readonly data = new FireLightData();
  // Keep resizable storage out of material texture groups: r185 caches those
  // groups by texture IDs and can otherwise reuse the old buffer after growth.
  private readonly lightBuffer = storage(this.data.attribute, 'vec4', 0).toReadOnly().setGroup(renderGroup);
  private readonly lightCount = uniform(0, 'int').setGroup(renderGroup);
  private fireLights: PointLight[] = [];
  private allLights: Light[] = [];

  constructor() {
    super();
    this.updateBeforeType = NodeUpdateType.RENDER;
  }

  override setLights(lights: Light[]): this {
    this.allLights = lights;
    this.fireLights = [];
    const materialLights: Light[] = [];
    // compileAsync(object, camera, scene) can supply a target's lights twice.
    const seen = new Set<Light>();
    for (const light of lights) {
      if (seen.has(light)) continue;
      seen.add(light);
      if (light instanceof PointLight && light.userData.runtimeFireLight === true
        && !light.castShadow) this.fireLights.push(light);
      else materialLights.push(light);
    }
    return super.setLights(materialLights);
  }

  override getLights(): Light[] { return this.allLights; }

  // Include the loop in the FIRST compilation, even with no fires. Zero -> one
  // must not introduce a new light type. Sun/shadows retain Three's normal path.
  override get hasLights(): boolean { return true; }

  override updateBefore(frame: NodeFrame): undefined {
    // Three has no public disposal API for standalone storage attributes. Use
    // the same owner as geometry disposal, keeping allocation counters correct.
    if (frame.renderer && !this.data.releaseAttribute) {
      const attributes = (frame.renderer as unknown as {
        _attributes: { delete(attribute: BufferAttribute): void };
      })._attributes;
      this.data.releaseAttribute = attribute => attributes.delete(attribute);
    }
    this.data.update(this.fireLights, frame.camera!);
    this.lightBuffer.value = this.data.attribute;
    this.lightCount.value = this.data.count;
    return undefined;
  }

  override setupLights(builder: NodeBuilder, lightNodes: Parameters<LightsNodeType['setupLights']>[1]): void {
    // Declare accumulators outside the loop, as in Three's batched lighting.
    const { reflectedLight } = builder.context as {
      reflectedLight: { directDiffuse: Node; directSpecular: Node };
    };
    reflectedLight.directDiffuse.toStack();
    reflectedLight.directSpecular.toStack();
    super.setupLights(builder, lightNodes);
    Fn(() => {
      Loop({ start: 0, end: this.lightCount, type: 'int' }, ({ i }) => {
        const index = int(i);
        const positionRange = this.lightBuffer.element(index.mul(2)).toVar();
        const vector = positionRange.xyz.sub(positionView).toVar();
        const distance = positionRange.w;
        If(distance.equal(0).or(dot(vector, vector).lessThanEqual(distance.mul(distance))), () => {
          const colorDecay = this.lightBuffer.element(index.mul(2).add(1)).toVar();
          this.setupDirectLight(builder, this, directPointLight({
            color: colorDecay.rgb,
            // @types/three still calls this lightViewPosition; r185 uses lightVector.
            // @ts-expect-error Runtime parameter verified in PointLightNode.js.
            lightVector: vector,
            cutoffDistance: distance, decayExponent: colorDecay.w,
          }));
        });
      });
    }, 'void')();
  }
}

/** Scene-owned shared lighting, installed before loading-screen compilation. */
export class FireLighting extends Lighting {
  private readonly nodes = new Map<Object3D, FireLightsNode>();
  private readonly unlit = new LightsNode();

  override createNode(lights: Light[] = []): FireLightsNode {
    return new FireLightsNode().setLights(lights);
  }

  override getNode(scene: Object3D): LightsNodeType {
    if (scene.type !== 'Scene' && scene.type !== 'Group') return this.unlit;
    let node = this.nodes.get(scene);
    if (!node) {
      node = this.createNode();
      this.nodes.set(scene, node);
    }
    return node;
  }

  dispose(): void {
    for (const node of this.nodes.values()) node.data.dispose();
    this.nodes.clear();
  }
}
