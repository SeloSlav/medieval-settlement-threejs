import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  isPeopleRenderingEnabled,
  type CrowdViewState,
} from './crowdView.ts';

export type CompanyStandardFaction = 'player' | 'mercenary' | 'ottoman' | 'bandit';

export type CompanyStandardRenderAgent = {
  /** Stable company/member-derived id. It owns the persistent cloth state. */
  id: string;
  faction: CompanyStandardFaction;
  x: number;
  y: number;
  z: number;
  yaw: number;
  active?: boolean;
  /** Optional body lean used by hurt/fall presentation. */
  pitch?: number;
  roll?: number;
  /**
   * Optional world-space left-hand mount. Supplying position alone keeps the
   * pole aligned to the bearer body while making the leather wrap meet the
   * animated L_Hand exactly. A corrected mount quaternion may also be supplied
   * when the close rig exposes one; it is interpreted as the standard frame,
   * not the raw GLTF bone basis.
   */
  gripPose?: {
    x: number;
    y: number;
    z: number;
    quaternion?: readonly [number, number, number, number];
  };
  /** Stable variation only; never feed frame counters into this value. */
  appearanceSeed?: number;
  /** Camp anchors name the pole foot, not a soldier's body origin. */
  planted?: boolean;
};

/**
 * Artwork is intentionally injected. Character-creation owns heraldry and can
 * replace these maps without coupling persistence to the cloth simulation.
 * Textures remain caller-owned and are never disposed by this renderer.
 */
export type CompanyStandardArtwork = {
  playerHeraldry?: THREE.Texture | null;
  playerCroatian?: THREE.Texture | null;
  mercenary?: THREE.Texture | null;
  ottoman?: THREE.Texture | null;
  bandit?: THREE.Texture | null;
};

export type CompanyStandardWindSample = {
  x: number;
  z: number;
  /** Metres per second; values are clamped before entering the solver. */
  speed: number;
};

export type CompanyStandardWindSampler = (
  x: number,
  y: number,
  z: number,
  elapsedSeconds: number,
) => CompanyStandardWindSample;

export type CompanyStandardDiagnostic = {
  standards: number;
  /** Duplicate company ids rejected before they can share one cloth state. */
  duplicateStandards: number;
  droppedStandards: number;
  panels: number;
  simulationNodes: number;
  renderVertices: number;
  triangles: number;
  hardwareInstances: number;
  drawCalls: number;
  maxStretchRatio: number;
  /** Furthest node reach divided by that row's material distance to its hoist. */
  maxOwnershipReachRatio: number;
  /** Solver states reset after violating their owning pole/material envelope. */
  ownershipResets: number;
  fixedStepHz: number;
};

export type CompanyStandardPhysicsSnapshot = {
  id: string;
  faction: CompanyStandardFaction;
  panels: Array<{
    role: CompanyStandardPanelRole;
    columns: number;
    rows: number;
    positions: Float32Array;
  }>;
};

export type CompanyStandardRendererOptions = {
  parent: THREE.Group;
  /** Camp cloth is a persistent site prop; armies keep their existing cheaper shadow policy. */
  clothCastShadow?: boolean;
  capacity?: number;
  artwork?: CompanyStandardArtwork;
  windSampler?: CompanyStandardWindSampler;
};

export const COMPANY_STANDARD_VISUAL_CONTRACT = Object.freeze({
  poleHeightMeters: 3.72,
  playerPanelCount: 2,
  mercenaryPanelCount: 1,
  ottomanPanelCount: 1,
  hoistEdgePinned: true,
  freeEdgeProfile: 'forked-and-tapered',
  hardwareMaterials: ['ash', 'aged-brass-and-steel', 'oxblood-leather'],
  clothSides: 2,
});

export const COMPANY_STANDARD_PERFORMANCE_BUDGET = Object.freeze({
  maxStandards: 512,
  maxDrawCalls: 8,
  fixedStepHz: 30,
  maxPhysicsStepsPerFrame: 2,
  nodesPerPanel: 60,
});

const DEFAULT_CAPACITY = COMPANY_STANDARD_PERFORMANCE_BUDGET.maxStandards;
const FIXED_DT = 1 / COMPANY_STANDARD_PERFORMANCE_BUDGET.fixedStepHz;
const MAX_ACCUMULATOR = FIXED_DT
  * COMPANY_STANDARD_PERFORMANCE_BUDGET.maxPhysicsStepsPerFrame;
const MAX_INPUT_DT = 0.05;
const TELEPORT_RESET_DISTANCE_SQ = 2.8 * 2.8;
const ROTATION_RESET_RADIANS = 0.9;
const MAX_RENDERABLE_STRUCTURAL_STRETCH = 1.22;
const MAX_RENDERABLE_MATERIAL_REACH = 1.18;
const MATERIAL_REACH_SLACK_METERS = 0.04;
const POLE_LOCAL_X = -0.32;
const POLE_LOCAL_Z = 0.035;
const POLE_GRIP_LOCAL_Y = 1.19;
const POLE_HEIGHT = COMPANY_STANDARD_VISUAL_CONTRACT.poleHeightMeters;

const FULL_QUALITY_GRID = [10, 6] as const;

type CompanyStandardPanelRole =
  | 'player-heraldry'
  | 'player-croatian'
  | 'mercenary'
  | 'bandit'
  | 'ottoman';

type PanelLayout = {
  role: CompanyStandardPanelRole;
  top: number;
  width: number;
  height: number;
  edgeProfile: readonly number[];
};

const PLAYER_LAYOUTS: readonly PanelLayout[] = [
  {
    role: 'player-heraldry',
    top: 3.39,
    width: 1.42,
    height: 1.02,
    edgeProfile: [0.9, 0.96, 1, 0.98, 0.93],
  },
  {
    role: 'player-croatian',
    top: 2.23,
    width: 1.24,
    height: 0.82,
    edgeProfile: [1, 0.88, 0.66, 0.88, 1],
  },
];

const OTTOMAN_LAYOUTS: readonly PanelLayout[] = [
  {
    role: 'ottoman',
    top: 3.4,
    width: 1.58,
    height: 1.34,
    // A single central fly point: the middle projects furthest from the pole,
    // while the upper and lower fly corners taper inward.
    edgeProfile: [0.72, 0.88, 1, 0.88, 0.72],
  },
];

const MERCENARY_LAYOUTS: readonly PanelLayout[] = [
  {
    role: 'mercenary',
    top: 3.35,
    width: 1.5,
    height: 1.08,
    // A forked fly distinguishes the hired company's own field sign from the
    // lord's stacked heraldry and the Ottoman single-pointed standard.
    edgeProfile: [1, 0.97, 0.72, 0.97, 1],
  },
];

const BANDIT_LAYOUTS: readonly PanelLayout[] = [
  { ...MERCENARY_LAYOUTS[0]!, role: 'bandit' },
];

type ClothConstraint = {
  a: number;
  b: number;
  rest: number;
  stiffness: number;
};

type ClothPanelState = {
  layout: PanelLayout;
  columns: number;
  rows: number;
  positions: Float32Array;
  previous: Float32Array;
  restLocal: Float32Array;
  constraints: ClothConstraint[];
};

type StandardState = {
  id: string;
  faction: CompanyStandardFaction;
  seed: number;
  panels: ClothPanelState[];
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  previousYaw: number;
  previousPitch: number;
  previousRoll: number;
  quaternion: THREE.Quaternion;
  previousQuaternion: THREE.Quaternion;
  maxStretchRatio: number;
  maxOwnershipReachRatio: number;
};

type ClothLayer = {
  role: CompanyStandardPanelRole;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  positionAttribute: THREE.BufferAttribute;
  normalAttribute: THREE.BufferAttribute;
  uvAttribute: THREE.BufferAttribute;
  indexAttribute: THREE.BufferAttribute;
  vertexCount: number;
  indexCount: number;
};

type ActiveStandard = {
  agent: CompanyStandardRenderAgent;
  distance: number;
};

/**
 * Batched company-standard renderer. One hardware instance and at most two
 * full-resolution cloth panels are emitted per company. Every visible standard
 * uses the same deterministic fixed-step constrained Verlet sheet at every
 * camera distance; batching reduces submission cost without changing topology
 * or simulation quality. All panels sharing an artwork role remain one draw.
 */
export class CompanyStandardRenderer {
  private readonly group = new THREE.Group();
  private readonly capacity: number;
  private readonly states = new Map<string, StandardState>();
  private readonly active: ActiveStandard[] = [];
  private readonly seenIds = new Set<string>();
  private readonly layers: Readonly<Record<CompanyStandardPanelRole, ClothLayer>>;
  private readonly hardwareGeometry: THREE.BufferGeometry;
  private readonly hardwareMaterials: THREE.MeshStandardMaterial[];
  private readonly hardware: THREE.InstancedMesh;
  private readonly hardwareMatrix = new THREE.Matrix4();
  private readonly hardwarePosition = new THREE.Vector3();
  private readonly hardwareScale = new THREE.Vector3(1, 1, 1);
  private readonly windSampler: CompanyStandardWindSampler;
  private elapsedSeconds = 0;
  private accumulator = 0;
  private duplicateStandards = 0;
  private droppedStandards = 0;
  private ownershipResets = 0;
  private disposed = false;

  constructor(options: CompanyStandardRendererOptions) {
    this.capacity = Math.max(1, Math.min(
      COMPANY_STANDARD_PERFORMANCE_BUDGET.maxStandards,
      Math.floor(
        options.capacity ?? DEFAULT_CAPACITY,
      ),
    ));
    this.group.name = 'Company standards · batched cloth and hardware';
    options.parent.add(this.group);

    this.layers = {
      'player-heraldry': createClothLayer(
        'player-heraldry',
        this.capacity,
        0x8f6f39,
        'Player heraldic standard cloth',
      ),
      'player-croatian': createClothLayer(
        'player-croatian',
        this.capacity,
        0xc8b48c,
        'Croatian checkerboard lower standard cloth',
      ),
      mercenary: createClothLayer(
        'mercenary',
        this.capacity,
        0x315744,
        'Mercenary frog standard cloth',
      ),
      bandit: createClothLayer(
        'bandit', this.capacity, 0x302b26, 'Bandit outlaw standard cloth',
      ),
      ottoman: createClothLayer(
        'ottoman',
        this.capacity,
        0x8a2528,
        'Ottoman field standard cloth',
      ),
    };
    for (const layer of Object.values(this.layers)) {
      layer.mesh.castShadow = options.clothCastShadow ?? false;
      this.group.add(layer.mesh);
    }

    const hardware = createStandardHardwareGeometry();
    this.hardwareGeometry = hardware.geometry;
    this.hardwareMaterials = hardware.materials;
    this.hardware = new THREE.InstancedMesh(
      this.hardwareGeometry,
      this.hardwareMaterials,
      this.capacity,
    );
    this.hardware.name = 'Company standard · tall ash pole and finial';
    this.hardware.count = 0;
    this.hardware.frustumCulled = false;
    this.hardware.castShadow = true;
    this.hardware.receiveShadow = false;
    this.hardware.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.hardware);

    this.windSampler = options.windSampler ?? defaultCompanyStandardWind;
    this.setArtwork(options.artwork ?? {});
  }

  setArtwork(artwork: CompanyStandardArtwork): void {
    this.setLayerMap(this.layers['player-heraldry'], artwork.playerHeraldry ?? null);
    this.setLayerMap(this.layers['player-croatian'], artwork.playerCroatian ?? null);
    this.setLayerMap(this.layers.mercenary, artwork.mercenary ?? null);
    this.setLayerMap(this.layers.ottoman, artwork.ottoman ?? null);
    this.setLayerMap(this.layers.bandit, artwork.bandit ?? null);
  }

  sync(
    agents: readonly CompanyStandardRenderAgent[],
    view?: CrowdViewState,
    dtSeconds = 0,
  ): void {
    if (this.disposed) return;
    const renderEnabled = isPeopleRenderingEnabled(view);
    this.group.visible = renderEnabled;
    if (!renderEnabled) return;

    const dt = Math.min(MAX_INPUT_DT, Math.max(0, finiteOr(dtSeconds, 0)));
    this.elapsedSeconds += dt;
    this.accumulator = Math.min(MAX_ACCUMULATOR, this.accumulator + dt);

    this.active.length = 0;
    const listenerX = view?.listenerX ?? view?.centerX ?? 0;
    const listenerZ = view?.listenerZ ?? view?.centerZ ?? 0;
    for (const agent of agents) {
      if (agent.active === false) continue;
      const dx = agent.x - listenerX;
      const dz = agent.z - listenerZ;
      this.active.push({ agent, distance: Math.hypot(dx, dz) });
    }
    this.active.sort((left, right) => (
      left.distance - right.distance
      || left.agent.id.localeCompare(right.agent.id, undefined, { numeric: true })
    ));
    // A company id owns exactly one persistent cloth sheet. If an upstream
    // presentation snapshot contains the same bearer twice, updating that one
    // state from two transforms in a single frame leaves hardware at both
    // transforms while both batched cloth copies come from the final one. At
    // strategic scale that reads as flags merging or bridging between poles.
    // Keep the nearest deterministic row and reject every duplicate before any
    // state or batch writes happen.
    this.seenIds.clear();
    this.duplicateStandards = 0;
    let uniqueCount = 0;
    for (let index = 0; index < this.active.length; index += 1) {
      const active = this.active[index]!;
      if (this.seenIds.has(active.agent.id)) {
        this.duplicateStandards += 1;
        continue;
      }
      this.seenIds.add(active.agent.id);
      this.active[uniqueCount] = active;
      uniqueCount += 1;
    }
    this.active.length = uniqueCount;
    this.droppedStandards = Math.max(0, this.active.length - this.capacity);
    if (this.droppedStandards > 0) {
      throw new RangeError(
        `CompanyStandardRenderer capacity ${this.capacity} cannot represent `
        + `${this.active.length} visible company standards without omission.`,
      );
    }

    this.seenIds.clear();
    let hardwareCount = 0;
    for (const active of this.active) {
      const agent = active.agent;
      this.seenIds.add(agent.id);
      let state = this.states.get(agent.id);
      if (!state || state.faction !== agent.faction) {
        state = this.createState(agent);
        this.states.set(agent.id, state);
      } else {
        this.updateStateFrame(state, agent);
      }
      this.writeHardwareInstance(state, hardwareCount);
      hardwareCount += 1;
    }
    for (const id of this.states.keys()) {
      if (!this.seenIds.has(id)) this.states.delete(id);
    }
    this.hardware.count = hardwareCount;
    publishInstancePrefix(this.hardware.instanceMatrix, hardwareCount);

    let steps = 0;
    while (
      this.accumulator >= FIXED_DT
      && steps < COMPANY_STANDARD_PERFORMANCE_BUDGET.maxPhysicsStepsPerFrame
    ) {
      for (const { agent } of this.active) {
        const state = this.states.get(agent.id);
        if (!state) continue;
        this.stepState(state, FIXED_DT);
      }
      this.accumulator -= FIXED_DT;
      steps += 1;
    }

    // A moving pole must retain exact hand/hoist contact on paused frames and
    // on render frames between fixed solver ticks.
    for (const { agent } of this.active) {
      const state = this.states.get(agent.id);
      if (!state) continue;
      for (const panel of state.panels) this.pinHoist(state, panel);
    }
    this.rebuildClothBatches();
  }

  diagnostics(): CompanyStandardDiagnostic {
    let panels = 0;
    let simulationNodes = 0;
    let maxStretchRatio = 1;
    for (const state of this.states.values()) {
      panels += state.panels.length;
      for (const panel of state.panels) {
        simulationNodes += panel.columns * panel.rows;
      }
      maxStretchRatio = Math.max(maxStretchRatio, state.maxStretchRatio);
    }
    let renderVertices = 0;
    let indexCount = 0;
    let activeClothLayers = 0;
    for (const layer of Object.values(this.layers)) {
      renderVertices += layer.vertexCount;
      indexCount += layer.indexCount;
      if (layer.indexCount > 0) activeClothLayers += 1;
    }
    const hardwareDrawCalls = this.hardware.count > 0
      ? this.hardwareGeometry.groups.length
      : 0;
    return {
      standards: this.states.size,
      duplicateStandards: this.duplicateStandards,
      droppedStandards: this.droppedStandards,
      panels,
      simulationNodes,
      renderVertices,
      triangles: Math.floor(indexCount / 3),
      hardwareInstances: this.hardware.count,
      drawCalls: activeClothLayers + hardwareDrawCalls,
      maxStretchRatio,
      maxOwnershipReachRatio: maxPanelOwnershipReachRatio(this.states.values()),
      ownershipResets: this.ownershipResets,
      fixedStepHz: COMPANY_STANDARD_PERFORMANCE_BUDGET.fixedStepHz,
    };
  }

  physicsSnapshot(id: string): CompanyStandardPhysicsSnapshot | null {
    const state = this.states.get(id);
    if (!state) return null;
    return {
      id: state.id,
      faction: state.faction,
      panels: state.panels.map((panel) => ({
        role: panel.layout.role,
        columns: panel.columns,
        rows: panel.rows,
        positions: panel.positions.slice(),
      })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.states.clear();
    for (const layer of Object.values(this.layers)) {
      layer.mesh.removeFromParent();
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.hardware.removeFromParent();
    this.hardwareGeometry.dispose();
    for (const material of this.hardwareMaterials) material.dispose();
    this.group.removeFromParent();
  }

  private setLayerMap(layer: ClothLayer, map: THREE.Texture | null): void {
    if (layer.material.map === map) return;
    layer.material.map = map;
    layer.material.color.setHex(map ? 0xffffff : fallbackLayerColor(layer.role));
    layer.material.needsUpdate = true;
  }

  private createState(
    agent: CompanyStandardRenderAgent,
  ): StandardState {
    const frame = resolveStandardFrame(agent);
    const state: StandardState = {
      id: agent.id,
      faction: agent.faction,
      seed: (agent.appearanceSeed ?? hashString(agent.id)) >>> 0,
      panels: [],
      x: frame.x,
      y: frame.y,
      z: frame.z,
      yaw: frame.yaw,
      pitch: frame.pitch,
      roll: frame.roll,
      previousX: frame.x,
      previousY: frame.y,
      previousZ: frame.z,
      previousYaw: frame.yaw,
      previousPitch: frame.pitch,
      previousRoll: frame.roll,
      quaternion: new THREE.Quaternion(),
      previousQuaternion: new THREE.Quaternion(),
      maxStretchRatio: 1,
      maxOwnershipReachRatio: 1,
    };
    updateFrameQuaternion(state);
    state.previousQuaternion.copy(state.quaternion);
    this.rebuildStatePanels(state);
    return state;
  }

  private updateStateFrame(
    state: StandardState,
    agent: CompanyStandardRenderAgent,
  ): void {
    const frame = resolveStandardFrame(agent);
    state.previousX = state.x;
    state.previousY = state.y;
    state.previousZ = state.z;
    state.previousYaw = state.yaw;
    state.previousPitch = state.pitch;
    state.previousRoll = state.roll;
    state.previousQuaternion.copy(state.quaternion);
    state.x = frame.x;
    state.y = frame.y;
    state.z = frame.z;
    state.yaw = frame.yaw;
    state.pitch = frame.pitch;
    state.roll = frame.roll;
    updateFrameQuaternion(state);

    const dx = state.x - state.previousX;
    const dy = state.y - state.previousY;
    const dz = state.z - state.previousZ;
    const angularDelta = Math.max(
      Math.abs(shortestAngle(state.yaw - state.previousYaw)),
      Math.abs(shortestAngle(state.pitch - state.previousPitch)),
      Math.abs(shortestAngle(state.roll - state.previousRoll)),
    );
    const teleported = dx * dx + dy * dy + dz * dz
      > TELEPORT_RESET_DISTANCE_SQ;
    if (teleported || angularDelta > ROTATION_RESET_RADIANS) {
      for (const panel of state.panels) resetPanelToFrame(state, panel);
      state.maxStretchRatio = 1;
      state.maxOwnershipReachRatio = 1;
    } else if (dx !== 0 || dy !== 0 || dz !== 0 || angularDelta > 0) {
      // Cloth particles live in world space, but their ownership is local to
      // this bearer. Carry both current and previous nodes with the complete
      // bearer-frame delta so a paused or low-rate update cannot leave the
      // free edge at an old company position while the hoist advances.
      for (const panel of state.panels) {
        advectPanelState(state, panel);
      }
    }
  }

  private rebuildStatePanels(
    state: StandardState,
  ): void {
    const [columns, rows] = FULL_QUALITY_GRID;
    const layouts = state.faction === 'player'
      ? PLAYER_LAYOUTS
      : state.faction === 'mercenary' ? MERCENARY_LAYOUTS
        : state.faction === 'bandit' ? BANDIT_LAYOUTS : OTTOMAN_LAYOUTS;
    state.panels = layouts.map((layout) => createPanelState(
      state,
      layout,
      columns,
      rows,
    ));
    state.maxStretchRatio = 1;
    state.maxOwnershipReachRatio = 1;
  }

  private writeHardwareInstance(state: StandardState, index: number): void {
    this.hardwarePosition.set(state.x, state.y, state.z);
    this.hardwareMatrix.compose(
      this.hardwarePosition,
      state.quaternion,
      this.hardwareScale,
    );
    this.hardware.setMatrixAt(index, this.hardwareMatrix);
  }

  private stepState(state: StandardState, dt: number): void {
    const sample = this.windSampler(
      state.x,
      state.y + 2.5,
      state.z,
      this.elapsedSeconds,
    );
    const speed = THREE.MathUtils.clamp(finiteOr(sample.speed, 0), 0, 12);
    const windLength = Math.hypot(sample.x, sample.z);
    const windX = windLength > 1e-5 ? sample.x / windLength * speed : 0;
    const windZ = windLength > 1e-5 ? sample.z / windLength * speed : 0;
    for (const panel of state.panels) {
      stepPanel(
        state,
        panel,
        dt,
        windX,
        windZ,
        speed,
        this.elapsedSeconds,
      );
      state.maxStretchRatio = Math.max(
        state.maxStretchRatio,
        panelStretchRatio(panel),
      );
      state.maxOwnershipReachRatio = Math.max(
        state.maxOwnershipReachRatio,
        panelOwnershipReachRatio(panel),
      );
      if (!panelStateBelongsToStandard(panel)) {
        resetPanelToFrame(state, panel);
        state.maxStretchRatio = 1;
        state.maxOwnershipReachRatio = 1;
        this.ownershipResets += 1;
      }
    }
  }

  private pinHoist(state: StandardState, panel: ClothPanelState): void {
    for (let row = 0; row < panel.rows; row += 1) {
      const index = row * panel.columns;
      writeWorldRestPoint(state, panel, index, panel.positions, index);
      copyNode(panel.positions, panel.previous, index);
    }
  }

  private rebuildClothBatches(): void {
    for (const layer of Object.values(this.layers)) resetLayer(layer);
    for (const { agent } of this.active) {
      const state = this.states.get(agent.id);
      if (!state) continue;
      for (const panel of state.panels) {
        if (!panelStateBelongsToStandard(panel)) {
          resetPanelToFrame(state, panel);
          state.maxStretchRatio = 1;
          state.maxOwnershipReachRatio = 1;
          this.ownershipResets += 1;
        }
        writePanelToLayer(panel, this.layers[panel.layout.role]);
      }
    }
    for (const layer of Object.values(this.layers)) commitLayer(layer);
  }
}

function createClothLayer(
  role: CompanyStandardPanelRole,
  capacity: number,
  fallbackColor: number,
  name: string,
): ClothLayer {
  const maxVertices = capacity
    * COMPANY_STANDARD_PERFORMANCE_BUDGET.nodesPerPanel;
  const maxIndices = capacity * (10 - 1) * (6 - 1) * 6;
  const positions = new Float32Array(maxVertices * 3);
  const normals = new Float32Array(maxVertices * 3);
  const uvs = new Float32Array(maxVertices * 2);
  const indices = new Uint16Array(maxIndices);
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const normalAttribute = new THREE.BufferAttribute(normals, 3);
  const uvAttribute = new THREE.BufferAttribute(uvs, 2);
  const indexAttribute = new THREE.BufferAttribute(indices, 1);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  normalAttribute.setUsage(THREE.DynamicDrawUsage);
  uvAttribute.setUsage(THREE.DynamicDrawUsage);
  indexAttribute.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('normal', normalAttribute);
  geometry.setAttribute('uv', uvAttribute);
  geometry.setIndex(indexAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshStandardMaterial({
    name,
    color: fallbackColor,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.visible = false;
  return {
    role,
    mesh,
    geometry,
    material,
    positions,
    normals,
    uvs,
    indices,
    positionAttribute,
    normalAttribute,
    uvAttribute,
    indexAttribute,
    vertexCount: 0,
    indexCount: 0,
  };
}

function createPanelState(
  state: StandardState,
  layout: PanelLayout,
  columns: number,
  rows: number,
): ClothPanelState {
  const nodeCount = columns * rows;
  const panel: ClothPanelState = {
    layout,
    columns,
    rows,
    positions: new Float32Array(nodeCount * 3),
    previous: new Float32Array(nodeCount * 3),
    restLocal: new Float32Array(nodeCount * 3),
    constraints: [],
  };
  for (let row = 0; row < rows; row += 1) {
    const v = rows === 1 ? 0 : row / (rows - 1);
    const edge = sampleProfile(layout.edgeProfile, v);
    for (let column = 0; column < columns; column += 1) {
      const u = columns === 1 ? 0 : column / (columns - 1);
      const index = row * columns + column;
      const offset = index * 3;
      panel.restLocal[offset] = POLE_LOCAL_X - layout.width * u * edge;
      panel.restLocal[offset + 1] = layout.top - layout.height * v;
      panel.restLocal[offset + 2] = POLE_LOCAL_Z;
    }
  }
  addPanelConstraints(panel);
  resetPanelToFrame(state, panel);
  return panel;
}

function addPanelConstraints(panel: ClothPanelState): void {
  const { columns, rows } = panel;
  const add = (a: number, b: number, stiffness: number): void => {
    panel.constraints.push({
      a,
      b,
      rest: localNodeDistance(panel.restLocal, a, b),
      stiffness,
    });
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (column + 1 < columns) add(index, index + 1, 1);
      if (row + 1 < rows) add(index, index + columns, 1);
      if (column + 1 < columns && row + 1 < rows) {
        add(index, index + columns + 1, 0.72);
        add(index + 1, index + columns, 0.72);
      }
      if (column + 2 < columns) add(index, index + 2, 0.28);
      if (row + 2 < rows) add(index, index + columns * 2, 0.28);
    }
  }
}

function resetPanelToFrame(state: StandardState, panel: ClothPanelState): void {
  const nodeCount = panel.columns * panel.rows;
  for (let index = 0; index < nodeCount; index += 1) {
    writeWorldRestPoint(state, panel, index, panel.positions, index);
    copyNode(panel.positions, panel.previous, index);
  }
}

function advectPanelState(
  state: StandardState,
  panel: ClothPanelState,
): void {
  const current = state.quaternion;
  const previous = state.previousQuaternion;
  // current * inverse(previous), expanded here to avoid per-company temporary
  // Quaternion and Vector3 allocation on the presentation hot path.
  const qx = current.w * -previous.x
    + current.x * previous.w
    + current.y * -previous.z
    - current.z * -previous.y;
  const qy = current.w * -previous.y
    - current.x * -previous.z
    + current.y * previous.w
    + current.z * -previous.x;
  const qz = current.w * -previous.z
    + current.x * -previous.y
    - current.y * -previous.x
    + current.z * previous.w;
  const qw = current.w * previous.w
    - current.x * -previous.x
    - current.y * -previous.y
    - current.z * -previous.z;
  advectPanelArray(state, panel.positions, qx, qy, qz, qw);
  advectPanelArray(state, panel.previous, qx, qy, qz, qw);
}

function advectPanelArray(
  state: StandardState,
  values: Float32Array,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
): void {
  for (let offset = 0; offset < values.length; offset += 3) {
    const x = values[offset]! - state.previousX;
    const y = values[offset + 1]! - state.previousY;
    const z = values[offset + 2]! - state.previousZ;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    values[offset] = state.x + ix * qw + iw * -qx + iy * -qz - iz * -qy;
    values[offset + 1] = state.y + iy * qw + iw * -qy + iz * -qx - ix * -qz;
    values[offset + 2] = state.z + iz * qw + iw * -qz + ix * -qy - iy * -qx;
  }
}

/**
 * Validates a sheet against its own material coordinates, never against the
 * other standards that happen to share its draw batch. The row-wise reach
 * bound is the physical amount of cloth between a node and its pinned hoist;
 * therefore a node cannot form a world-space bridge to another pole even when
 * several bearers overlap in a melee or move on a paused (`dt = 0`) frame.
 */
function panelStateBelongsToStandard(panel: ClothPanelState): boolean {
  for (let offset = 0; offset < panel.positions.length; offset += 1) {
    if (
      !Number.isFinite(panel.positions[offset])
      || !Number.isFinite(panel.previous[offset])
    ) return false;
  }
  for (const constraint of panel.constraints) {
    if (constraint.stiffness < 0.99 || constraint.rest <= 1e-6) continue;
    const allowed = constraint.rest * MAX_RENDERABLE_STRUCTURAL_STRETCH
      + MATERIAL_REACH_SLACK_METERS;
    if (nodeDistanceSq(panel.positions, constraint.a, constraint.b) > allowed * allowed) {
      return false;
    }
  }
  for (let row = 0; row < panel.rows; row += 1) {
    const hoist = row * panel.columns;
    let materialReach = 0;
    for (let column = 1; column < panel.columns; column += 1) {
      const previousNode = hoist + column - 1;
      const index = previousNode + 1;
      materialReach += localNodeDistance(panel.restLocal, previousNode, index);
      const allowed = materialReach * MAX_RENDERABLE_MATERIAL_REACH
        + MATERIAL_REACH_SLACK_METERS;
      if (nodeDistanceSq(panel.positions, hoist, index) > allowed * allowed) {
        return false;
      }
    }
  }
  return true;
}

function panelOwnershipReachRatio(panel: ClothPanelState): number {
  let maxRatio = 1;
  for (let row = 0; row < panel.rows; row += 1) {
    const hoist = row * panel.columns;
    let materialReach = 0;
    for (let column = 1; column < panel.columns; column += 1) {
      const previousNode = hoist + column - 1;
      const index = previousNode + 1;
      materialReach += localNodeDistance(panel.restLocal, previousNode, index);
      if (materialReach <= 1e-6) continue;
      maxRatio = Math.max(
        maxRatio,
        Math.sqrt(nodeDistanceSq(panel.positions, hoist, index)) / materialReach,
      );
    }
  }
  return maxRatio;
}

function maxPanelOwnershipReachRatio(states: Iterable<StandardState>): number {
  let maxRatio = 1;
  for (const state of states) {
    maxRatio = Math.max(maxRatio, state.maxOwnershipReachRatio);
  }
  return maxRatio;
}

function nodeDistanceSq(values: Float32Array, a: number, b: number): number {
  const ai = a * 3;
  const bi = b * 3;
  const dx = values[bi]! - values[ai]!;
  const dy = values[bi + 1]! - values[ai + 1]!;
  const dz = values[bi + 2]! - values[ai + 2]!;
  return dx * dx + dy * dy + dz * dz;
}

function stepPanel(
  state: StandardState,
  panel: ClothPanelState,
  dt: number,
  windX: number,
  windZ: number,
  windSpeed: number,
  elapsedSeconds: number,
): void {
  const q = state.quaternion;
  // Third column of the quaternion rotation matrix: local cloth-plane normal
  // in world space, calculated without allocating per-panel vectors.
  const normalX = 2 * (q.x * q.z + q.w * q.y);
  const normalZ = 1 - 2 * (q.x * q.x + q.y * q.y);
  const pressure = (windX * normalX + windZ * normalZ) * 0.19;
  const dtSq = dt * dt;
  const damping = Math.pow(0.982, dt / FIXED_DT);
  for (let row = 0; row < panel.rows; row += 1) {
    const v = row / Math.max(1, panel.rows - 1);
    for (let column = 1; column < panel.columns; column += 1) {
      const u = column / Math.max(1, panel.columns - 1);
      const index = row * panel.columns + column;
      const offset = index * 3;
      const x = panel.positions[offset]!;
      const y = panel.positions[offset + 1]!;
      const z = panel.positions[offset + 2]!;
      const vx = (x - panel.previous[offset]!) * damping;
      const vy = (y - panel.previous[offset + 1]!) * damping;
      const vz = (z - panel.previous[offset + 2]!) * damping;
      panel.previous[offset] = x;
      panel.previous[offset + 1] = y;
      panel.previous[offset + 2] = z;

      const phase = elapsedSeconds * (3.1 + windSpeed * 0.16)
        + u * 5.8
        + v * 2.7
        + (state.seed & 0xffff) * 0.00037;
      const flutter = (Math.sin(phase) + Math.sin(phase * 0.47 + 1.4) * 0.42)
        * (0.22 + windSpeed * 0.025)
        * u;
      const pressureForce = pressure * (0.55 + 0.45 * u);
      const drag = 0.035 + u * 0.025;
      panel.positions[offset] = x + vx
        + (windX * drag + normalX * (pressureForce + flutter)) * dtSq;
      panel.positions[offset + 1] = y + vy + (-1.75 + flutter * 0.08) * dtSq;
      panel.positions[offset + 2] = z + vz
        + (windZ * drag + normalZ * (pressureForce + flutter)) * dtSq;
    }
  }

  // Nine over-relaxed Gauss-Seidel passes keep the free edge supple while holding
  // structural stretch below the perceptual rubber-sheet threshold.
  for (let iteration = 0; iteration < 9; iteration += 1) {
    for (const constraint of panel.constraints) {
      solveConstraint(panel, constraint);
    }
    for (let row = 0; row < panel.rows; row += 1) {
      const index = row * panel.columns;
      writeWorldRestPoint(state, panel, index, panel.positions, index);
    }
  }
  // Pin velocities as well as positions. This prevents energy injection when
  // the bearer changes direction while the free edge retains useful inertia.
  for (let row = 0; row < panel.rows; row += 1) {
    const index = row * panel.columns;
    copyNode(panel.positions, panel.previous, index);
  }
}

function solveConstraint(
  panel: ClothPanelState,
  constraint: ClothConstraint,
): void {
  const aOffset = constraint.a * 3;
  const bOffset = constraint.b * 3;
  const dx = panel.positions[bOffset]! - panel.positions[aOffset]!;
  const dy = panel.positions[bOffset + 1]! - panel.positions[aOffset + 1]!;
  const dz = panel.positions[bOffset + 2]! - panel.positions[aOffset + 2]!;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return;
  const correction = (distance - constraint.rest) / distance
    * 0.5
    * constraint.stiffness
    * 1.16;
  const aPinned = constraint.a % panel.columns === 0;
  const bPinned = constraint.b % panel.columns === 0;
  const aWeight = aPinned ? 0 : bPinned ? 2 : 1;
  const bWeight = bPinned ? 0 : aPinned ? 2 : 1;
  panel.positions[aOffset] += dx * correction * aWeight;
  panel.positions[aOffset + 1] += dy * correction * aWeight;
  panel.positions[aOffset + 2] += dz * correction * aWeight;
  panel.positions[bOffset] -= dx * correction * bWeight;
  panel.positions[bOffset + 1] -= dy * correction * bWeight;
  panel.positions[bOffset + 2] -= dz * correction * bWeight;
}

function panelStretchRatio(panel: ClothPanelState): number {
  let ratio = 1;
  for (const constraint of panel.constraints) {
    if (constraint.stiffness < 0.7 || constraint.rest <= 1e-6) continue;
    const a = constraint.a * 3;
    const b = constraint.b * 3;
    const distance = Math.hypot(
      panel.positions[b]! - panel.positions[a]!,
      panel.positions[b + 1]! - panel.positions[a + 1]!,
      panel.positions[b + 2]! - panel.positions[a + 2]!,
    );
    ratio = Math.max(ratio, distance / constraint.rest);
  }
  return ratio;
}

function writePanelToLayer(panel: ClothPanelState, layer: ClothLayer): void {
  const baseVertex = layer.vertexCount;
  const nodeCount = panel.columns * panel.rows;
  const panelIndexCount = (panel.columns - 1) * (panel.rows - 1) * 6;
  if (baseVertex + nodeCount > layer.positions.length / 3) {
    throw new RangeError(
      `Company-standard ${layer.role} vertex batch cannot represent another `
      + `${nodeCount}-node panel without omission.`,
    );
  }
  if (layer.indexCount + panelIndexCount > layer.indices.length) {
    throw new RangeError(
      `Company-standard ${layer.role} index batch cannot represent another `
      + `${panelIndexCount}-index panel without omission.`,
    );
  }
  for (let index = 0; index < nodeCount; index += 1) {
    const source = index * 3;
    const destination = (baseVertex + index) * 3;
    layer.positions[destination] = panel.positions[source]!;
    layer.positions[destination + 1] = panel.positions[source + 1]!;
    layer.positions[destination + 2] = panel.positions[source + 2]!;
    const row = Math.floor(index / panel.columns);
    const column = index % panel.columns;
    const uv = (baseVertex + index) * 2;
    layer.uvs[uv] = column / Math.max(1, panel.columns - 1);
    layer.uvs[uv + 1] = 1 - row / Math.max(1, panel.rows - 1);
  }
  for (let row = 0; row + 1 < panel.rows; row += 1) {
    for (let column = 0; column + 1 < panel.columns; column += 1) {
      const a = baseVertex + row * panel.columns + column;
      const b = a + 1;
      const c = a + panel.columns;
      const d = c + 1;
      layer.indices[layer.indexCount++] = a;
      layer.indices[layer.indexCount++] = c;
      layer.indices[layer.indexCount++] = b;
      layer.indices[layer.indexCount++] = b;
      layer.indices[layer.indexCount++] = c;
      layer.indices[layer.indexCount++] = d;
    }
  }
  layer.vertexCount += nodeCount;
}

function resetLayer(layer: ClothLayer): void {
  layer.vertexCount = 0;
  layer.indexCount = 0;
}

function commitLayer(layer: ClothLayer): void {
  if (layer.indexCount > 0) computeLayerNormals(layer);
  layer.geometry.setDrawRange(0, layer.indexCount);
  layer.mesh.visible = layer.indexCount > 0;
  publishAttributePrefix(layer.positionAttribute, layer.vertexCount * 3);
  publishAttributePrefix(layer.normalAttribute, layer.vertexCount * 3);
  publishAttributePrefix(layer.uvAttribute, layer.vertexCount * 2);
  publishAttributePrefix(layer.indexAttribute, layer.indexCount);
}

function publishAttributePrefix(
  attribute: THREE.BufferAttribute,
  componentCount: number,
): void {
  attribute.clearUpdateRanges();
  if (componentCount > 0) attribute.addUpdateRange(0, componentCount);
  attribute.needsUpdate = componentCount > 0;
}

function computeLayerNormals(layer: ClothLayer): void {
  layer.normals.fill(0, 0, layer.vertexCount * 3);
  for (let index = 0; index < layer.indexCount; index += 3) {
    const ai = layer.indices[index]! * 3;
    const bi = layer.indices[index + 1]! * 3;
    const ci = layer.indices[index + 2]! * 3;
    const abx = layer.positions[bi]! - layer.positions[ai]!;
    const aby = layer.positions[bi + 1]! - layer.positions[ai + 1]!;
    const abz = layer.positions[bi + 2]! - layer.positions[ai + 2]!;
    const acx = layer.positions[ci]! - layer.positions[ai]!;
    const acy = layer.positions[ci + 1]! - layer.positions[ai + 1]!;
    const acz = layer.positions[ci + 2]! - layer.positions[ai + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    layer.normals[ai] += nx;
    layer.normals[ai + 1] += ny;
    layer.normals[ai + 2] += nz;
    layer.normals[bi] += nx;
    layer.normals[bi + 1] += ny;
    layer.normals[bi + 2] += nz;
    layer.normals[ci] += nx;
    layer.normals[ci + 1] += ny;
    layer.normals[ci + 2] += nz;
  }
  for (let index = 0; index < layer.vertexCount; index += 1) {
    const offset = index * 3;
    const length = Math.hypot(
      layer.normals[offset]!,
      layer.normals[offset + 1]!,
      layer.normals[offset + 2]!,
    );
    if (length <= 1e-6) {
      layer.normals[offset + 2] = 1;
      continue;
    }
    layer.normals[offset] /= length;
    layer.normals[offset + 1] /= length;
    layer.normals[offset + 2] /= length;
  }
}

function createStandardHardwareGeometry(): {
  geometry: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
} {
  const woodParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];
  const leatherParts: THREE.BufferGeometry[] = [];
  woodParts.push(transformedGeometry(
    new THREE.CylinderGeometry(0.023, 0.029, POLE_HEIGHT, 10, 1, false),
    POLE_LOCAL_X,
    POLE_HEIGHT * 0.5,
    POLE_LOCAL_Z,
  ));
  leatherParts.push(transformedGeometry(
    new THREE.CylinderGeometry(0.033, 0.033, 0.42, 10, 1, false),
    POLE_LOCAL_X,
    1.19,
    POLE_LOCAL_Z,
  ));
  metalParts.push(transformedGeometry(
    new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10, 1, false),
    POLE_LOCAL_X,
    0.08,
    POLE_LOCAL_Z,
  ));
  metalParts.push(transformedGeometry(
    new THREE.SphereGeometry(0.06, 10, 6),
    POLE_LOCAL_X,
    POLE_HEIGHT + 0.035,
    POLE_LOCAL_Z,
  ));
  metalParts.push(transformedGeometry(
    new THREE.ConeGeometry(0.075, 0.27, 8, 1, false),
    POLE_LOCAL_X,
    POLE_HEIGHT + 0.19,
    POLE_LOCAL_Z,
  ));
  for (const y of [3.36, 2.88, 2.26, 1.82]) {
    metalParts.push(transformedGeometry(
      new THREE.TorusGeometry(0.035, 0.008, 5, 10),
      POLE_LOCAL_X,
      y,
      POLE_LOCAL_Z,
      0,
      Math.PI * 0.5,
      0,
    ));
  }

  const wood = requireMergedGeometry(woodParts, 'standard pole wood');
  const metal = requireMergedGeometry(metalParts, 'standard pole metalwork');
  const leather = requireMergedGeometry(leatherParts, 'standard pole leather grip');
  const geometry = mergeGeometries([wood, metal, leather], true);
  wood.dispose();
  metal.dispose();
  leather.dispose();
  if (!geometry) throw new Error('Failed to merge company-standard hardware.');
  geometry.name = 'Tall company-standard pole assembly';
  geometry.computeVertexNormals();
  return {
    geometry,
    materials: [
      new THREE.MeshStandardMaterial({
        name: 'Standard pole · waxed ash',
        color: 0x77512f,
        roughness: 0.76,
        metalness: 0,
      }),
      new THREE.MeshStandardMaterial({
        name: 'Standard pole · aged brass and iron',
        color: 0xa99258,
        roughness: 0.34,
        metalness: 0.82,
      }),
      new THREE.MeshStandardMaterial({
        name: 'Standard pole · oxblood leather grip',
        color: 0x552a23,
        roughness: 0.9,
        metalness: 0,
      }),
    ],
  };
}

function transformedGeometry(
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
): THREE.BufferGeometry {
  geometry.rotateX(rotationX);
  geometry.rotateY(rotationY);
  geometry.rotateZ(rotationZ);
  geometry.translate(x, y, z);
  return geometry;
}

function requireMergedGeometry(
  geometries: THREE.BufferGeometry[],
  label: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error(`Failed to merge ${label}.`);
  return merged;
}

function writeWorldRestPoint(
  state: StandardState,
  panel: ClothPanelState,
  restIndex: number,
  target: Float32Array,
  targetIndex: number,
): void {
  const source = restIndex * 3;
  const x = panel.restLocal[source]!;
  const y = panel.restLocal[source + 1]!;
  const z = panel.restLocal[source + 2]!;
  const q = state.quaternion;
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  const destination = targetIndex * 3;
  target[destination] = state.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  target[destination + 1] = state.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  target[destination + 2] = state.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
}

function resolveStandardFrame(agent: CompanyStandardRenderAgent): {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
} {
  let yaw = finiteOr(agent.yaw, 0);
  let pitch = finiteOr(agent.pitch, 0);
  let roll = finiteOr(agent.roll, 0);
  const quaternion = new THREE.Quaternion();
  const supplied = agent.gripPose?.quaternion;
  if (supplied) {
    quaternion.set(
      finiteOr(supplied[0], 0),
      finiteOr(supplied[1], 0),
      finiteOr(supplied[2], 0),
      finiteOr(supplied[3], 1),
    );
    if (quaternion.lengthSq() <= 1e-8) quaternion.identity();
    else quaternion.normalize();
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    pitch = euler.x;
    yaw = euler.y;
    roll = euler.z;
  } else {
    quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  }

  const grip = agent.gripPose;
  if (!grip) {
    const footOffset = agent.planted
      ? new THREE.Vector3(POLE_LOCAL_X, 0, POLE_LOCAL_Z).applyQuaternion(quaternion)
      : new THREE.Vector3();
    return {
      x: finiteOr(agent.x, 0) - footOffset.x,
      y: finiteOr(agent.y, 0),
      z: finiteOr(agent.z, 0) - footOffset.z,
      yaw,
      pitch,
      roll,
    };
  }
  const gripOffset = new THREE.Vector3(
    POLE_LOCAL_X,
    POLE_GRIP_LOCAL_Y,
    POLE_LOCAL_Z,
  ).applyQuaternion(quaternion);
  return {
    x: finiteOr(grip.x, agent.x) - gripOffset.x,
    y: finiteOr(grip.y, agent.y + POLE_GRIP_LOCAL_Y) - gripOffset.y,
    z: finiteOr(grip.z, agent.z) - gripOffset.z,
    yaw,
    pitch,
    roll,
  };
}

function updateFrameQuaternion(state: StandardState): void {
  state.quaternion.setFromEuler(new THREE.Euler(
    state.pitch,
    state.yaw,
    state.roll,
    'YXZ',
  ));
}

function copyNode(
  source: Float32Array,
  target: Float32Array,
  index: number,
): void {
  const offset = index * 3;
  target[offset] = source[offset]!;
  target[offset + 1] = source[offset + 1]!;
  target[offset + 2] = source[offset + 2]!;
}

function localNodeDistance(values: Float32Array, a: number, b: number): number {
  const aOffset = a * 3;
  const bOffset = b * 3;
  return Math.hypot(
    values[bOffset]! - values[aOffset]!,
    values[bOffset + 1]! - values[aOffset + 1]!,
    values[bOffset + 2]! - values[aOffset + 2]!,
  );
}

function sampleProfile(profile: readonly number[], t: number): number {
  if (profile.length === 0) return 1;
  if (profile.length === 1) return profile[0]!;
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * (profile.length - 1);
  const start = Math.floor(scaled);
  const end = Math.min(profile.length - 1, start + 1);
  return THREE.MathUtils.lerp(profile[start]!, profile[end]!, scaled - start);
}

function fallbackLayerColor(role: CompanyStandardPanelRole): number {
  if (role === 'bandit') return 0x302b26;
  if (role === 'ottoman') return 0x8a2528;
  if (role === 'mercenary') return 0x315744;
  if (role === 'player-croatian') return 0xc8b48c;
  return 0x8f6f39;
}

function defaultCompanyStandardWind(
  x: number,
  _y: number,
  z: number,
  elapsedSeconds: number,
): CompanyStandardWindSample {
  const field = x * 0.013 + z * 0.009;
  const heading = 0.58 + Math.sin(field + elapsedSeconds * 0.071) * 0.24;
  const gust = Math.sin(elapsedSeconds * 0.83 + field * 1.7) * 0.48
    + Math.sin(elapsedSeconds * 0.29 - field) * 0.26;
  return {
    x: Math.cos(heading),
    z: Math.sin(heading),
    speed: 3.4 + gust,
  };
}

function publishInstancePrefix(
  attribute: THREE.InstancedBufferAttribute,
  count: number,
): void {
  attribute.clearUpdateRanges();
  if (count > 0) attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = count > 0;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function shortestAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
