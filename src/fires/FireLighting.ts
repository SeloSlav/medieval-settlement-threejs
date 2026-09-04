import {
  DataTexture, FloatType, Frustum, Light, Matrix4,
  PointLight, RGBAFormat, Sphere, Vector3, type Camera, type Object3D,
} from 'three';
import Lighting from 'three/src/renderers/common/Lighting.js';
import LightsNode from 'three/src/nodes/lighting/LightsNode.js';
import { NodeUpdateType } from 'three/src/nodes/core/constants.js';
import type NodeBuilder from 'three/src/nodes/core/NodeBuilder.js';
import type NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import type Node from 'three/src/nodes/core/Node.js';
// Leaf imports avoid this project's deliberately minimal ambient TSL facade.
import { Fn, If, dot, int, ivec2, uniform } from 'three/src/nodes/tsl/TSLBase.js';
import { Loop } from 'three/src/nodes/utils/LoopNode.js';
import { directPointLight } from 'three/src/nodes/lighting/PointLightNode.js';
import { positionView } from 'three/src/nodes/accessors/Position.js';
import { texture, textureLoad } from 'three/src/nodes/accessors/TextureNode.js';

// Two adjacent RGBA texels per light. Height grows without changing the
// texture-node identity or shader layout; there is no scene/per-tile light cap.
const TEXTURE_WIDTH = 256;
const LIGHTS_PER_ROW = TEXTURE_WIDTH / 2;

/** Exact fire-light data, omitting only zero-energy/out-of-view lights. */
export class FireLightData {
  texture = this.createTexture(1);
  count = 0;
  private readonly frustum = new Frustum();
  private readonly projectionView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly viewPosition = new Vector3();

  private createTexture(height: number): DataTexture {
    const result = new DataTexture(
      new Float32Array(TEXTURE_WIDTH * height * 4), TEXTURE_WIDTH, height,
      RGBAFormat, FloatType,
    );
    result.name = 'Shared fire-light data';
    result.needsUpdate = true;
    return result;
  }

  update(lights: readonly PointLight[], camera: Camera): void {
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(
      this.projectionView, camera.coordinateSystem, camera.reversedDepth,
    );
    // Reserve for every candidate; never truncate dense/overlapping fires.
    const rows = Math.max(1, Math.ceil(lights.length / LIGHTS_PER_ROW));
    if (rows > this.texture.image.height) {
      const previous = this.texture;
      this.texture = this.createTexture(2 ** Math.ceil(Math.log2(rows)));
      previous.dispose();
    }
    const data = this.texture.image.data as Float32Array;
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
    if (this.count > 0) this.texture.needsUpdate = true;
  }

  dispose(): void { this.texture.dispose(); }
}

/** Fire lifecycle changes data, never the world's light-dependent shader key. */
export class FireLightsNode extends LightsNode {
  static get type(): string { return 'FireLightsNode'; }
  readonly data = new FireLightData();
  private readonly lightTexture = texture(this.data.texture);
  private readonly lightCount = uniform(0, 'int');
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
    this.data.update(this.fireLights, frame.camera!);
    this.lightTexture.value = this.data.texture;
    this.lightCount.value = this.data.count;
    return undefined;
  }

  override setupLights(builder: NodeBuilder, lightNodes: Parameters<LightsNode['setupLights']>[1]): void {
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
        const uv = ivec2(index.mod(LIGHTS_PER_ROW).mul(2), index.div(LIGHTS_PER_ROW));
        const positionRange = textureLoad(this.lightTexture, uv).toVar();
        const vector = positionRange.xyz.sub(positionView).toVar();
        const distance = positionRange.w;
        If(distance.equal(0).or(dot(vector, vector).lessThanEqual(distance.mul(distance))), () => {
          const colorDecay = textureLoad(this.lightTexture, uv.add(ivec2(1, 0))).toVar();
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

  override getNode(scene: Object3D): LightsNode {
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
