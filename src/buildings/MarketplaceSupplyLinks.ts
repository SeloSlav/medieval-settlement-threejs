import * as THREE from 'three';
import type {
  MarketStallAssignment,
} from '../economy/marketStallAssignments.ts';
import type { BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';

export const MARKETPLACE_SUPPLY_LINK_COLOR = 0xe7c45c;
export const MARKETPLACE_SUPPLY_LINK_ENDPOINT_LIFT = 2.8;
export const MARKETPLACE_SUPPLY_LINK_MIN_ARC_RISE = 3.5;
export const MARKETPLACE_SUPPLY_LINK_MAX_ARC_RISE = 16;
export const MARKETPLACE_SUPPLY_LINK_ARC_RISE_PER_METER = 0.22;

const MARKETPLACE_SUPPLY_LINK_MIN_SEGMENTS = 18;
const MARKETPLACE_SUPPLY_LINK_MAX_SEGMENTS = 56;
const MARKETPLACE_SUPPLY_LINK_SEGMENT_LENGTH = 1.6;

type SupplyBuildingKind = 'granary' | 'village_storehouse';

export type MarketplaceSupplyLink = {
  sourceId: string;
  sourceKind: SupplyBuildingKind;
  sourceX: number;
  sourceZ: number;
  marketplaceId: string;
  marketplaceX: number;
  marketplaceZ: number;
  stallCount: number;
};

type MarketplaceSupplyLinksOptions = {
  parent: THREE.Object3D;
  terrain: Pick<Terrain, 'getHeightAt'>;
};

/**
 * Resolve the active, stocked stall relationships relevant to one selected
 * depot or Marketplace. Multiple categories sold by the same depot at the
 * same market intentionally collapse to one readable world-space link.
 */
export function marketplaceSupplyLinksForSelection(
  selectedBuilding: BuildingState | null,
  buildings: Iterable<BuildingState>,
  assignments: readonly MarketStallAssignment[],
): MarketplaceSupplyLink[] {
  if (
    selectedBuilding == null
    || (
      selectedBuilding.kind !== 'granary'
      && selectedBuilding.kind !== 'village_storehouse'
      && selectedBuilding.kind !== 'marketplace'
    )
  ) {
    return [];
  }

  const buildingsById = new Map(
    [...buildings].map((building) => [building.id, building]),
  );
  const linksByPair = new Map<string, MarketplaceSupplyLink>();
  for (const assignment of assignments) {
    const isSelectedLink = selectedBuilding.kind === 'marketplace'
      ? assignment.marketplaceId === selectedBuilding.id
      : assignment.workplaceId === selectedBuilding.id;
    if (!isSelectedLink) continue;

    const source = buildingsById.get(assignment.workplaceId);
    const marketplace = buildingsById.get(assignment.marketplaceId);
    if (
      source?.kind !== assignment.workplaceKind
      || marketplace?.kind !== 'marketplace'
    ) {
      continue;
    }

    const key = `${source.id}\u0000${marketplace.id}`;
    const existing = linksByPair.get(key);
    if (existing) {
      existing.stallCount += 1;
      continue;
    }
    linksByPair.set(key, {
      sourceId: source.id,
      sourceKind: source.kind,
      sourceX: source.x,
      sourceZ: source.z,
      marketplaceId: marketplace.id,
      marketplaceX: marketplace.x,
      marketplaceZ: marketplace.z,
      stallCount: 1,
    });
  }

  return [...linksByPair.values()].sort((left, right) =>
    compareIds(left.marketplaceId, right.marketplaceId)
    || compareIds(left.sourceId, right.sourceId)
  );
}

/**
 * A vertical quadratic arch. Its midpoint rises above both endpoints, so the
 * relationship remains visibly three-dimensional even over uneven terrain.
 */
export function marketplaceSupplyArcPoints(
  link: MarketplaceSupplyLink,
  getHeightAt: (x: number, z: number) => number,
): THREE.Vector3[] {
  const start = new THREE.Vector3(
    link.sourceX,
    getHeightAt(link.sourceX, link.sourceZ)
      + MARKETPLACE_SUPPLY_LINK_ENDPOINT_LIFT,
    link.sourceZ,
  );
  const end = new THREE.Vector3(
    link.marketplaceX,
    getHeightAt(link.marketplaceX, link.marketplaceZ)
      + MARKETPLACE_SUPPLY_LINK_ENDPOINT_LIFT,
    link.marketplaceZ,
  );
  const horizontalDistance = Math.hypot(
    end.x - start.x,
    end.z - start.z,
  );
  const arcRise = THREE.MathUtils.clamp(
    horizontalDistance * MARKETPLACE_SUPPLY_LINK_ARC_RISE_PER_METER,
    MARKETPLACE_SUPPLY_LINK_MIN_ARC_RISE,
    MARKETPLACE_SUPPLY_LINK_MAX_ARC_RISE,
  );
  const desiredMidpointY = Math.max(start.y, end.y) + arcRise;
  const control = new THREE.Vector3(
    (start.x + end.x) * 0.5,
    desiredMidpointY * 2 - (start.y + end.y) * 0.5,
    (start.z + end.z) * 0.5,
  );
  const segmentCount = THREE.MathUtils.clamp(
    Math.ceil(horizontalDistance / MARKETPLACE_SUPPLY_LINK_SEGMENT_LENGTH),
    MARKETPLACE_SUPPLY_LINK_MIN_SEGMENTS,
    MARKETPLACE_SUPPLY_LINK_MAX_SEGMENTS,
  );
  return new THREE.QuadraticBezierCurve3(start, control, end)
    .getPoints(segmentCount);
}

export class MarketplaceSupplyLinks {
  readonly group = new THREE.Group();

  private readonly terrain: Pick<Terrain, 'getHeightAt'>;
  private readonly line: THREE.LineSegments<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >;
  private signature: string | null = null;

  constructor(options: MarketplaceSupplyLinksOptions) {
    this.terrain = options.terrain;
    this.group.name = 'Selected marketplace supply links';

    const material = new THREE.LineBasicMaterial({
      color: MARKETPLACE_SUPPLY_LINK_COLOR,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    });
    material.toneMapped = false;
    this.line = new THREE.LineSegments(new THREE.BufferGeometry(), material);
    this.line.name = 'Selected marketplace supply arcs';
    this.line.renderOrder = 15;
    this.line.frustumCulled = false;
    this.line.raycast = () => {};
    this.line.visible = false;
    this.line.userData.marketplaceSupplyLinks = [];
    this.group.add(this.line);
    options.parent.add(this.group);
  }

  sync(
    selectedBuilding: BuildingState | null,
    buildings: Iterable<BuildingState>,
    assignments: readonly MarketStallAssignment[],
  ): void {
    const links = marketplaceSupplyLinksForSelection(
      selectedBuilding,
      buildings,
      assignments,
    );
    const signature = this.createSignature(links);
    if (signature === this.signature) return;
    this.signature = signature;
    this.line.userData.marketplaceSupplyLinks = links.map((link) => ({
      sourceId: link.sourceId,
      marketplaceId: link.marketplaceId,
      stallCount: link.stallCount,
    }));

    if (links.length === 0) {
      this.line.visible = false;
      return;
    }

    const vertices: THREE.Vector3[] = [];
    for (const link of links) {
      const points = marketplaceSupplyArcPoints(
        link,
        this.terrain.getHeightAt.bind(this.terrain),
      );
      for (let index = 0; index < points.length - 1; index += 1) {
        vertices.push(points[index], points[index + 1]);
      }
    }

    const nextGeometry = new THREE.BufferGeometry().setFromPoints(vertices);
    const previousGeometry = this.line.geometry;
    this.line.geometry = nextGeometry;
    previousGeometry.dispose();
    this.line.visible = vertices.length >= 2;
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.group.removeFromParent();
  }

  private createSignature(links: readonly MarketplaceSupplyLink[]): string {
    return links.map((link) => [
      link.sourceId,
      link.marketplaceId,
      link.stallCount,
      link.sourceX.toFixed(3),
      link.sourceZ.toFixed(3),
      this.terrain.getHeightAt(link.sourceX, link.sourceZ).toFixed(3),
      link.marketplaceX.toFixed(3),
      link.marketplaceZ.toFixed(3),
      this.terrain.getHeightAt(link.marketplaceX, link.marketplaceZ).toFixed(3),
    ].join(':')).join('|');
  }
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}
