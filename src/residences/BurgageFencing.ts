import * as THREE from 'three';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { BurgageZoneState } from '../resources/types.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { timberMaterial } from '../buildings/buildingMaterials.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import {
  getParcelFenceSegments,
  resolveFenceOpeningOnEdge,
  type BurgageParcelLayout,
  type ParcelFenceOpening,
  type ResolvedParcelFenceOpening,
} from './burgageLayout.ts';
import { layoutFromBurgageZone } from './burgageZoneLayout.ts';
import { createBurgageFenceRoadClipper } from './burgageFenceRoadClearance.ts';
import {
  pickResidenceAppearance,
  residenceGroundDoorLocalX,
} from './residenceAppearance.ts';

const MAX_POSTS = 2048;
const MAX_RAILS = 6144;
const MAX_GATE_TIMBERS = 1024;
export const BURGAGE_WOOD_FENCE_STYLE = {
  postSpacing: 2.2,
  postHeight: 1.08,
  postBuryDepth: 0.22,
  postWidth: 0.13,
  railHeights: [0.34, 0.64, 0.9] as const,
  railWidth: 0.105,
  railHeight: 0.09,
  railEndOverlap: 0.04,
  terrainLift: 0.06,
  openingWidth: 1.8,
} as const;
const POST_SPACING = BURGAGE_WOOD_FENCE_STYLE.postSpacing;
const POST_HEIGHT = BURGAGE_WOOD_FENCE_STYLE.postHeight;
const POST_BURY_DEPTH = BURGAGE_WOOD_FENCE_STYLE.postBuryDepth;
const RAIL_HEIGHTS = BURGAGE_WOOD_FENCE_STYLE.railHeights;
const RAIL_WIDTH = BURGAGE_WOOD_FENCE_STYLE.railWidth;
const RAIL_HEIGHT = BURGAGE_WOOD_FENCE_STYLE.railHeight;
const TERRAIN_LIFT = BURGAGE_WOOD_FENCE_STYLE.terrainLift;
const FRONT_GATE_WIDTH = BURGAGE_WOOD_FENCE_STYLE.openingWidth;
const GATE_POST_HEIGHT = 1.84;
const GATE_POST_BURY_DEPTH = 0.22;
const GATE_POST_WIDTH = 0.19;
const GATE_LINTEL_HEIGHT = 1.62;
const GATE_BEAM_WIDTH = 0.15;
const GATE_BEAM_HEIGHT = 0.13;
const LOCAL_RAIL_AXIS = new THREE.Vector3(0, 0, 1);

export function createBurgageFenceBoxGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  colors.fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

type FenceSegment = readonly [Point2, Point2];
type FenceGateway = ResolvedParcelFenceOpening & {
  residenceId: string;
  hasFrame: boolean;
};
export type TerrainFenceBay = {
  start: Point2;
  end: Point2;
  startGroundHeight: number;
  endGroundHeight: number;
};
type TerrainFenceGateway = FenceGateway & {
  startGroundHeight: number;
  endGroundHeight: number;
};

export type BurgageFenceSyncOptions = {
  /**
   * Rewrites the instance buffers even when the authored fence layout is
   * unchanged. Startup vegetation baking temporarily retargets the renderer,
   * so the first playable scene needs one explicit upload afterwards.
   */
  forceInstanceUpload?: boolean;
};

type FencedResidence = {
  id: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
  tier?: number;
};

function fenceSignature(
  segmentBays: TerrainFenceBay[][],
  gateways: TerrainFenceGateway[],
): string {
  const segmentSignature = segmentBays
    .flat()
    .map((bay) => [
      bay.start.x.toFixed(2),
      bay.start.z.toFixed(2),
      bay.startGroundHeight.toFixed(3),
      bay.end.x.toFixed(2),
      bay.end.z.toFixed(2),
      bay.endGroundHeight.toFixed(3),
    ].join(','))
    .join('|');
  const gatewaySignature = gateways
    .map((gateway) => [
      gateway.start.x.toFixed(2),
      gateway.start.z.toFixed(2),
      gateway.startGroundHeight.toFixed(3),
      gateway.end.x.toFixed(2),
      gateway.end.z.toFixed(2),
      gateway.endGroundHeight.toFixed(3),
      gateway.hasFrame ? 'frame' : 'gap',
    ].join(','))
    .join('|');
  return `${segmentSignature}#${gatewaySignature}`;
}

export function sampleTerrainFenceBays(
  start: Point2,
  end: Point2,
  getHeightAt: (x: number, z: number) => number,
): TerrainFenceBay[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return [];

  const bayCount = Math.max(1, Math.ceil(length / POST_SPACING));
  const points = Array.from({ length: bayCount + 1 }, (_, index) => {
    const t = index / bayCount;
    const point = {
      x: start.x + dx * t,
      z: start.z + dz * t,
    };
    return {
      point,
      groundHeight: getHeightAt(point.x, point.z),
    };
  });

  return Array.from({ length: bayCount }, (_, index) => ({
    start: points[index].point,
    end: points[index + 1].point,
    startGroundHeight: points[index].groundHeight,
    endGroundHeight: points[index + 1].groundHeight,
  }));
}

function residencesByZone(
  residences: Iterable<FencedResidence>,
): Map<string, FencedResidence[]> {
  const byZone = new Map<string, FencedResidence[]>();
  for (const residence of residences) {
    let zoneResidences = byZone.get(residence.zoneId);
    if (!zoneResidences) {
      zoneResidences = [];
      byZone.set(residence.zoneId, zoneResidences);
    }
    zoneResidences.push(residence);
  }
  return byZone;
}

function projectResidenceDoorToFrontage(
  residence: FencedResidence,
  parcel: BurgageParcelLayout,
): Point2 {
  const appearance = pickResidenceAppearance(hashStringSeed(residence.id));
  const doorLocalX = residenceGroundDoorLocalX(appearance);
  const cos = Math.cos(residence.yaw);
  const sin = Math.sin(residence.yaw);
  const doorPoint = {
    x: residence.x + doorLocalX * cos,
    z: residence.z - doorLocalX * sin,
  };

  const dx = parcel.frontRight.x - parcel.frontLeft.x;
  const dz = parcel.frontRight.z - parcel.frontLeft.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= 1e-6
    ? 0.5
    : THREE.MathUtils.clamp(
      ((doorPoint.x - parcel.frontLeft.x) * dx + (doorPoint.z - parcel.frontLeft.z) * dz) / lengthSq,
      0,
      1,
    );
  return {
    x: parcel.frontLeft.x + dx * t,
    z: parcel.frontLeft.z + dz * t,
  };
}

/** Resolve the residence entrance onto this parcel's road-facing fence edge. */
export function resolveResidenceFrontageGateway(
  residence: FencedResidence,
  parcel: BurgageParcelLayout,
): FenceGateway | null {
  const gateway = resolveFenceOpeningOnEdge(
    parcel.frontLeft,
    parcel.frontRight,
    {
      center: projectResidenceDoorToFrontage(residence, parcel),
      width: FRONT_GATE_WIDTH,
    },
  );
  return gateway
    ? {
        ...gateway,
        residenceId: residence.id,
        hasFrame: residenceHasFramedGateway(residence.id, residence.tier ?? 1),
      }
    : null;
}

/**
 * Tier-one plots alternate deterministically between a full hewn entrance
 * frame and a literal break in the frontage fence. The independent salted
 * roll avoids reshuffling the residence appearance sequence for saved games.
 */
export function residenceHasFramedGateway(
  residenceId: string,
  tier = 1,
): boolean {
  if (tier > 1) return true;
  const rng = mulberry32(hashStringSeed(residenceId) ^ 0x6a09e667);
  return rng() < 0.46;
}

function collectFenceLayout(
  zones: Iterable<BurgageZoneState>,
  residences: Iterable<FencedResidence>,
): { segments: FenceSegment[]; gateways: FenceGateway[] } {
  const residencesForZone = residencesByZone(residences);
  const segments: FenceSegment[] = [];
  const gateways: FenceGateway[] = [];
  for (const zone of zones) {
    const layout = layoutFromBurgageZone(zone);
    if (!layout) continue;
    const zoneResidences = residencesForZone.get(zone.id);
    if (!zoneResidences || zoneResidences.length === 0) continue;

    const occupied = new Set(zoneResidences.map((residence) => residence.parcelIndex));
    const openings = new Map<number, ParcelFenceOpening>();
    for (const residence of zoneResidences) {
      const parcel = layout.parcels.find((candidate) => candidate.index === residence.parcelIndex);
      if (!parcel) continue;
      const gateway = resolveResidenceFrontageGateway(residence, parcel);
      if (!gateway) continue;
      openings.set(residence.parcelIndex, {
        center: gateway.center,
        width: gateway.width,
      });
      gateways.push(gateway);
    }
    segments.push(...getParcelFenceSegments(layout, occupied, openings));
  }
  return { segments, gateways };
}

export class BurgageFencing {
  private readonly roadNetwork: RoadNetwork | undefined;
  private readonly root = new THREE.Group();
  private readonly posts: THREE.InstancedMesh;
  private readonly rails: THREE.InstancedMesh;
  private readonly gateTimbers: THREE.InstancedMesh;
  // Match the bridge railing/support finish so plot boundaries read as the
  // same rough-hewn outdoor timber instead of pale weathered boards.
  private readonly fenceMaterial = timberMaterial('mid');
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly railDirection = new THREE.Vector3();
  private lastSignature = '';

  constructor(parent: THREE.Group, roadNetwork?: RoadNetwork) {
    this.roadNetwork = roadNetwork;
    this.root.name = 'Burgage fencing';
    this.root.frustumCulled = false;

    this.posts = new THREE.InstancedMesh(
      createBurgageFenceBoxGeometry(),
      this.fenceMaterial,
      MAX_POSTS,
    );
    this.posts.name = 'Fence posts';
    this.posts.count = 0;
    this.posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.posts.frustumCulled = false;
    this.posts.castShadow = false;
    this.posts.receiveShadow = false;

    this.rails = new THREE.InstancedMesh(
      createBurgageFenceBoxGeometry(),
      this.fenceMaterial,
      MAX_RAILS,
    );
    this.rails.name = 'Fence rails';
    this.rails.count = 0;
    this.rails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rails.frustumCulled = false;
    this.rails.castShadow = false;
    this.rails.receiveShadow = false;

    this.gateTimbers = new THREE.InstancedMesh(
      createBurgageFenceBoxGeometry(),
      this.fenceMaterial,
      MAX_GATE_TIMBERS,
    );
    this.gateTimbers.name = 'Frontage gate frames';
    this.gateTimbers.count = 0;
    this.gateTimbers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gateTimbers.frustumCulled = false;
    this.gateTimbers.castShadow = false;
    this.gateTimbers.receiveShadow = false;

    this.root.add(this.posts, this.rails, this.gateTimbers);
    parent.add(this.root);
  }

  syncZones(
    zones: Iterable<BurgageZoneState>,
    residences: Iterable<FencedResidence>,
    getHeightAt: (x: number, z: number) => number,
    options: BurgageFenceSyncOptions = {},
  ): void {
    const layout = collectFenceLayout(zones, residences);
    // Re-read the current network on every sync, including after road hydration
    // or edits. Never let reconstructed parcel chords run through the road.
    const roadClipper = this.roadNetwork && createBurgageFenceRoadClipper(this.roadNetwork);
    const segments = roadClipper ? layout.segments.flatMap(roadClipper.clip) : layout.segments;
    const gateways = roadClipper
      ? layout.gateways.filter((gateway) => roadClipper.isClear([gateway.start, gateway.end]))
      : layout.gateways;
    const segmentBays = segments.map(([start, end]) => (
      sampleTerrainFenceBays(start, end, getHeightAt)
    ));
    const terrainGateways = gateways.map((gateway): TerrainFenceGateway => ({
      ...gateway,
      startGroundHeight: getHeightAt(gateway.start.x, gateway.start.z),
      endGroundHeight: getHeightAt(gateway.end.x, gateway.end.z),
    }));
    const signature = fenceSignature(segmentBays, terrainGateways);
    if (signature === this.lastSignature && !options.forceInstanceUpload) return;
    this.lastSignature = signature;

    let postCount = 0;
    let railCount = 0;

    for (const bays of segmentBays) {
      if (bays.length === 0) continue;
      const availableBays = Math.min(
        bays.length,
        MAX_POSTS - postCount - 1,
        Math.floor((MAX_RAILS - railCount) / RAIL_HEIGHTS.length),
      );
      if (availableBays <= 0) break;

      this.quaternion.identity();
      const postMeshHeight = POST_HEIGHT + POST_BURY_DEPTH;
      for (let index = 0; index <= availableBays; index++) {
        const bay = index === 0 ? bays[0] : bays[index - 1];
        const point = index === 0 ? bay.start : bay.end;
        const groundHeight = index === 0 ? bay.startGroundHeight : bay.endGroundHeight;
        const y = groundHeight + (POST_HEIGHT - POST_BURY_DEPTH) * 0.5;
        this.scale.set(
          BURGAGE_WOOD_FENCE_STYLE.postWidth,
          postMeshHeight,
          BURGAGE_WOOD_FENCE_STYLE.postWidth,
        );
        this.position.set(point.x, y, point.z);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.posts.setMatrixAt(postCount, this.matrix);
        postCount += 1;
      }

      for (let index = 0; index < availableBays; index++) {
        const bay = bays[index];
        this.railDirection.set(
          bay.end.x - bay.start.x,
          bay.endGroundHeight - bay.startGroundHeight,
          bay.end.z - bay.start.z,
        );
        const railLength = this.railDirection.length();
        if (railLength <= 1e-6) continue;
        this.quaternion.setFromUnitVectors(
          LOCAL_RAIL_AXIS,
          this.railDirection.multiplyScalar(1 / railLength),
        );
        this.position.set(
          (bay.start.x + bay.end.x) * 0.5,
          (bay.startGroundHeight + bay.endGroundHeight) * 0.5 + TERRAIN_LIFT,
          (bay.start.z + bay.end.z) * 0.5,
        );

        for (const railHeight of RAIL_HEIGHTS) {
          this.scale.set(
            RAIL_WIDTH,
            RAIL_HEIGHT,
            railLength + BURGAGE_WOOD_FENCE_STYLE.railEndOverlap,
          );
          this.position.y = (
            (bay.startGroundHeight + bay.endGroundHeight) * 0.5
            + TERRAIN_LIFT
            + railHeight
          );
          this.matrix.compose(this.position, this.quaternion, this.scale);
          this.rails.setMatrixAt(railCount, this.matrix);
          railCount += 1;
        }
      }
    }

    let gateTimberCount = 0;
    for (const gateway of terrainGateways) {
      if (!gateway.hasFrame) continue;
      if (gateTimberCount + 3 > MAX_GATE_TIMBERS) break;

      gateTimberCount = this.setGatePost(
        gateTimberCount,
        gateway.start,
        gateway.startGroundHeight,
      );
      gateTimberCount = this.setGatePost(
        gateTimberCount,
        gateway.end,
        gateway.endGroundHeight,
      );

      const lintelStart = new THREE.Vector3(
        gateway.start.x,
        gateway.startGroundHeight + TERRAIN_LIFT + GATE_LINTEL_HEIGHT,
        gateway.start.z,
      );
      const lintelEnd = new THREE.Vector3(
        gateway.end.x,
        gateway.endGroundHeight + TERRAIN_LIFT + GATE_LINTEL_HEIGHT,
        gateway.end.z,
      );
      gateTimberCount = this.setGateBeam(gateTimberCount, lintelStart, lintelEnd);
    }

    this.posts.count = postCount;
    this.posts.instanceMatrix.needsUpdate = postCount > 0;
    this.rails.count = railCount;
    this.rails.instanceMatrix.needsUpdate = railCount > 0;
    this.gateTimbers.count = gateTimberCount;
    this.gateTimbers.instanceMatrix.needsUpdate = gateTimberCount > 0;
    this.root.visible = postCount > 0 || railCount > 0 || gateTimberCount > 0;
  }

  private setGatePost(index: number, point: Point2, groundHeight: number): number {
    const postMeshHeight = GATE_POST_HEIGHT + GATE_POST_BURY_DEPTH;
    this.quaternion.identity();
    this.scale.set(GATE_POST_WIDTH, postMeshHeight, GATE_POST_WIDTH);
    this.position.set(
      point.x,
      groundHeight + TERRAIN_LIFT + (GATE_POST_HEIGHT - GATE_POST_BURY_DEPTH) * 0.5,
      point.z,
    );
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.gateTimbers.setMatrixAt(index, this.matrix);
    return index + 1;
  }

  private setGateBeam(index: number, start: THREE.Vector3, end: THREE.Vector3): number {
    this.railDirection.subVectors(end, start);
    const length = this.railDirection.length();
    if (length <= 1e-6) return index;
    this.quaternion.setFromUnitVectors(
      LOCAL_RAIL_AXIS,
      this.railDirection.multiplyScalar(1 / length),
    );
    this.scale.set(GATE_BEAM_WIDTH, GATE_BEAM_HEIGHT, length + 0.08);
    this.position.copy(start).add(end).multiplyScalar(0.5);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.gateTimbers.setMatrixAt(index, this.matrix);
    return index + 1;
  }

  dispose(): void {
    this.posts.geometry.dispose();
    this.rails.geometry.dispose();
    this.gateTimbers.geometry.dispose();
    // Timber materials are shared by all buildings and disposed by the
    // BuildingMaterialLibrary at scene teardown.
    this.root.removeFromParent();
  }
}
