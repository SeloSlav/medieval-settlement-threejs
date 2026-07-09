import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createForestProps } from '../props/ForestProps.ts';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import { RoadJunctionBuilder } from '../roads/RoadJunctionBuilder.ts';
import { RoadMaterialFactory } from '../roads/RoadMaterialFactory.ts';
import { RoadMeshBuilder } from '../roads/RoadMeshBuilder.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { SkyCloudMesh } from '../sky/SkyCloudMesh.ts';
import { Terrain } from '../terrain/Terrain.ts';
import { TerrainProjector } from '../terrain/TerrainProjector.ts';
import { disposeObject3D } from '../utils/dispose.ts';

const DAYLIGHT_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.0 },
    contrast: { value: 1.03 },
    vignette: { value: 0.1 },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;

    vec3 adjustSaturation(vec3 color, float amount) {
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      return mix(vec3(luma), color, amount);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      color = (color - 0.5) * contrast + 0.5;
      color = adjustSaturation(color, saturation);
      color = mix(color, color * vec3(1.03, 1.01, 0.97), 0.18);
      float distanceFromCenter = distance(vUv, vec2(0.5));
      float edge = smoothstep(0.18, 0.78, distanceFromCenter);
      color *= mix(1.0, 1.0 - vignette, edge);
      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }
  `,
};

export class SceneManager {
  private readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly cameraTarget = new THREE.Vector3();
  readonly terrain: Terrain;
  readonly terrainProjector: TerrainProjector;
  readonly materials: RoadMaterialFactory;
  readonly roadMeshBuilder: RoadMeshBuilder;
  readonly previewGroup = new THREE.Group();
  readonly selectionGroup = new THREE.Group();
  private readonly sky: SkyCloudMesh;
  private readonly sunDirection = new THREE.Vector3();
  private readonly forestGroup: THREE.Group;
  private readonly roadGroup = new THREE.Group();
  private readonly junctionGroup = new THREE.Group();
  private readonly edgeVisuals = new Map<string, { revision: number; group: THREE.Group }>();

  private constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, materials: RoadMaterialFactory) {
    this.container = container;
    this.renderer = renderer;
    this.materials = materials;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.FogExp2(0xc3d8ef, 0.0012);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1600);
    this.sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(43), THREE.MathUtils.degToRad(225));
    this.terrain = new Terrain(materials.terrain);
    this.terrainProjector = new TerrainProjector(this.terrain, this.camera, this.renderer.domElement);
    this.roadMeshBuilder = new RoadMeshBuilder(this.terrain, materials);
    this.sky = new SkyCloudMesh({
      sunDirection: this.sunDirection,
      cloudCoverage: 0.58,
      cloudHeight: 145,
      cloudThickness: 78,
      cloudAbsorption: 0.52,
      hazeStrength: 0.1,
      maxCloudDistance: 4200,
      radius: 1100,
      windSpeedX: 0.18,
      windSpeedZ: 0.1,
      widthSegments: 56,
      heightSegments: 28,
    });
    this.forestGroup = createForestProps(this.terrain, this.renderer.capabilities.getMaxAnisotropy());

    this.roadGroup.name = 'Road network visuals';
    this.junctionGroup.name = 'Road junction visuals';
    this.previewGroup.name = 'Road preview root';
    this.selectionGroup.name = 'Road selection root';

    this.scene.add(this.sky, this.terrain.mesh, this.forestGroup, this.roadGroup, this.junctionGroup, this.previewGroup, this.selectionGroup);
    this.addLighting();
    this.composer = this.createPostProcessing();
  }

  static async create(container: HTMLElement): Promise<SceneManager> {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.setClearColor(0x86bdf1, 1);
    container.appendChild(renderer.domElement);
    const materials = await RoadMaterialFactory.create(renderer);
    return new SceneManager(container, renderer, materials);
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.sky.updateResolution(width * pixelRatio, height * pixelRatio);
  }

  render(dt: number): void {
    const elapsed = performance.now() * 0.001;
    this.sky.updateCamera(this.camera);
    this.sky.updateSun(this.sunDirection);
    this.sky.updateTime(elapsed);
    this.composer.render(dt);
  }

  getPerformanceStats(): { calls: number; triangles: number; pixelRatio: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  syncRoadNetwork(network: RoadNetwork): void {
    for (const [edgeId, visual] of this.edgeVisuals) {
      if (!network.edges.has(edgeId)) {
        this.roadGroup.remove(visual.group);
        disposeObject3D(visual.group);
        this.edgeVisuals.delete(edgeId);
      }
    }

    for (const edge of network.edges.values()) {
      this.upsertEdge(edge);
    }

    this.rebuildJunctions(network);
  }

  getRoadPickMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const visual of this.edgeVisuals.values()) {
      visual.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child);
      });
    }
    return meshes;
  }

  dispose(): void {
    for (const visual of this.edgeVisuals.values()) disposeObject3D(visual.group);
    this.edgeVisuals.clear();
    disposeObject3D(this.forestGroup);
    (this.forestGroup.userData.disposeResources as (() => void) | undefined)?.();
    this.sky.dispose();
    this.composer.dispose();
    disposeObject3D(this.junctionGroup);
    disposeObject3D(this.previewGroup);
    disposeObject3D(this.selectionGroup);
    this.terrain.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private upsertEdge(edge: RoadEdge): void {
    const existing = this.edgeVisuals.get(edge.id);
    if (existing && existing.revision === edge.revision) return;
    if (existing) {
      this.roadGroup.remove(existing.group);
      disposeObject3D(existing.group);
      this.edgeVisuals.delete(edge.id);
    }
    const group = this.roadMeshBuilder.buildEdge(edge);
    this.roadGroup.add(group);
    this.edgeVisuals.set(edge.id, { revision: edge.revision, group });
  }

  private rebuildJunctions(network: RoadNetwork): void {
    disposeObject3D(this.junctionGroup);
    this.junctionGroup.clear();
    const builder = new RoadJunctionBuilder(this.terrain, this.materials);
    const next = builder.build(network);
    for (const child of [...next.children]) this.junctionGroup.add(child);
  }

  private addLighting(): void {
    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x56644a, 1.9);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xb8d1ff, 0.2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffefd2, 4.9);
    sun.name = 'Sun';
    sun.position.copy(this.sunDirection).multiplyScalar(180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 15;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.00008;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);

    const blueFill = new THREE.DirectionalLight(0x9fc8ff, 0.45);
    blueFill.name = 'Sky fill';
    blueFill.position.copy(this.sunDirection).multiplyScalar(-90).add(new THREE.Vector3(0, 65, 0));
    this.scene.add(blueFill);
  }

  private createPostProcessing(): EffectComposer {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.38, 0.82);
    composer.addPass(bloomPass);

    const gradePass = new ShaderPass(DAYLIGHT_GRADE_SHADER);
    composer.addPass(gradePass);
    composer.addPass(new OutputPass());
    return composer;
  }
}
