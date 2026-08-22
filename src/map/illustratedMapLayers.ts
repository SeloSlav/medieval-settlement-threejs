import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { getBuildingFootprintCorners } from '../buildings/BuildingTerrainLayout.ts';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import { geologicalNodeForMapMarker } from './geologicalMapMarkerState.ts';
import {
  mapStampKey,
  residenceFootprintCorners,
  worldToMapPixels,
  type MapStampKey,
  type WorldPoint,
} from './illustratedMapGeometry.ts';
import type { WorldMapMarker } from './worldMapMarkers.ts';

export type IllustratedMapStampImages = ReadonlyMap<MapStampKey, CanvasImageSource>;

const MAP_INK = 'rgba(52, 36, 21, 0.88)';
const MAP_INK_SOFT = 'rgba(75, 50, 25, 0.42)';
const BUILDING_WASH = 'rgba(86, 56, 27, 0.28)';
const RESIDENCE_WASH = 'rgba(99, 67, 33, 0.22)';
const MAP_ART_RESOLUTION = 512;

function mapArtScale(context: CanvasRenderingContext2D): number {
  return Math.min(context.canvas.width, context.canvas.height) / MAP_ART_RESOLUTION;
}

export function drawIllustratedMapLayers(options: {
  context: CanvasRenderingContext2D;
  bounds: TerrainBounds;
  roadNetwork: RoadNetwork;
  state: GameState;
}): void {
  const { context, bounds, roadNetwork, state } = options;
  const { width, height } = context.canvas;
  const drawScale = mapArtScale(context);

  context.save();
  context.beginPath();
  context.rect(5 * drawScale, 5 * drawScale, width - 10 * drawScale, height - 10 * drawScale);
  context.clip();

  drawRoadInk(context, bounds, roadNetwork.edges.values());
  drawBuildingFootprints(context, bounds, state.buildings.values(), roadNetwork);
  drawResidenceFootprints(context, bounds, state.residences.values());

  context.restore();
}

export function drawIllustratedResourceStampLayer(options: {
  context: CanvasRenderingContext2D;
  bounds: TerrainBounds;
  state: GameState;
  layoutMarkers: readonly WorldMapMarker[];
  stampImages: IllustratedMapStampImages;
}): void {
  const { context, bounds, state, layoutMarkers, stampImages } = options;
  const drawScale = mapArtScale(context);
  context.save();
  context.beginPath();
  context.rect(
    5 * drawScale,
    5 * drawScale,
    context.canvas.width - 10 * drawScale,
    context.canvas.height - 10 * drawScale,
  );
  context.clip();
  drawResourceStamps(context, bounds, layoutMarkers, state, stampImages);
  context.restore();
}

function drawRoadInk(
  context: CanvasRenderingContext2D,
  bounds: TerrainBounds,
  edges: Iterable<RoadEdge>,
): void {
  const metresPerPixel = (bounds.maxX - bounds.minX) / context.canvas.width;
  const drawScale = mapArtScale(context);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const edge of edges) {
    const path = edge.surfacePath ?? edge.sampledPath;
    if (path.length < 2) continue;
    const roadWidthPixels = clamp(edge.width / metresPerPixel, 0.9 * drawScale, 3.2 * drawScale);

    traceWorldPath(context, bounds, path);
    context.strokeStyle = MAP_INK_SOFT;
    context.lineWidth = roadWidthPixels + 1.15 * drawScale;
    context.stroke();

    traceWorldPath(context, bounds, path);
    context.strokeStyle = MAP_INK;
    context.lineWidth = Math.max(0.72 * drawScale, roadWidthPixels * 0.42);
    context.stroke();
  }

  context.restore();
}

function traceWorldPath(
  context: CanvasRenderingContext2D,
  bounds: TerrainBounds,
  path: readonly WorldPoint[],
): void {
  const first = worldToMapPixels(
    path[0],
    bounds,
    context.canvas.width,
    context.canvas.height,
  );
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < path.length; index += 1) {
    const point = worldToMapPixels(
      path[index],
      bounds,
      context.canvas.width,
      context.canvas.height,
    );
    context.lineTo(point.x, point.y);
  }
}

function drawBuildingFootprints(
  context: CanvasRenderingContext2D,
  bounds: TerrainBounds,
  buildings: Iterable<BuildingState>,
  roadNetwork: RoadNetwork,
): void {
  for (const building of buildings) {
    const yaw = buildingPlacementYaw(building.kind, building.x, building.z, roadNetwork);
    const corners = getBuildingFootprintCorners(
      building.kind,
      building.x,
      building.z,
      yaw,
    );
    drawFootprintPolygon(
      context,
      bounds,
      corners,
      BUILDING_WASH,
      !building.constructionComplete,
    );
  }
}

function drawResidenceFootprints(
  context: CanvasRenderingContext2D,
  bounds: TerrainBounds,
  residences: Iterable<ResidenceState>,
): void {
  for (const residence of residences) {
    drawFootprintPolygon(
      context,
      bounds,
      residenceFootprintCorners(residence),
      RESIDENCE_WASH,
      residence.tier === 0,
    );
  }
}

function drawFootprintPolygon(
  context: CanvasRenderingContext2D,
  bounds: TerrainBounds,
  corners: readonly WorldPoint[],
  fillStyle: string,
  underConstruction: boolean,
): void {
  if (corners.length < 3) return;
  const first = worldToMapPixels(
    corners[0],
    bounds,
    context.canvas.width,
    context.canvas.height,
  );
  context.save();
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < corners.length; index += 1) {
    const point = worldToMapPixels(
      corners[index],
      bounds,
      context.canvas.width,
      context.canvas.height,
    );
    context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
  context.strokeStyle = MAP_INK;
  const drawScale = mapArtScale(context);
  context.lineWidth = 0.82 * drawScale;
  context.setLineDash(underConstruction ? [1.8 * drawScale, 1.2 * drawScale] : []);
  context.stroke();
  context.restore();
}

function drawResourceStamps(
  context: CanvasRenderingContext2D,
  bounds: TerrainBounds,
  markers: readonly WorldMapMarker[],
  state: GameState,
  stampImages: IllustratedMapStampImages,
): void {
  context.save();
  const drawScale = mapArtScale(context);

  for (const marker of markers) {
    const geologicalNode = geologicalNodeForMapMarker(marker, state.quarries);
    const node = geologicalNode ?? state.foragingNodes.get(marker.id);
    const key = mapStampKey(marker, node?.isRich === true);
    const image = key ? stampImages.get(key) : undefined;
    if (!image) continue;

    const point = worldToMapPixels(
      {
        x: node?.x ?? marker.x,
        z: node?.z ?? marker.z,
      },
      bounds,
      context.canvas.width,
      context.canvas.height,
    );
    const rich = node?.isRich === true;
    const size = (rich ? 42 : marker.quarryKind === 'large' ? 31 : 27) * drawScale;
    context.globalAlpha = node && node.remaining <= 0 ? 0.38 : rich ? 0.96 : 0.86;
    context.drawImage(image, point.x - size * 0.5, point.y - size * 0.5, size, size);
  }

  context.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
