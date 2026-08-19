import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.ts';
import type { RoadEdge } from './RoadEdge.ts';
import { RoadMaterialFactory } from './RoadMaterialFactory.ts';
import type { RoadNetwork } from './RoadNetwork.ts';
import {
  ROAD_JUNCTION_REACH,
  roadTerminalTrimDistance,
  trimPathAtEndpoint,
} from './roadEndpoint.ts';
import {
  applyBridgeHeightsToPath,
  detectBridgeSpans,
  type BridgeSamplingContext,
  type BridgeSpan,
} from './RiverBridgeSpans.ts';
import {
  BRIDGE_RAILING_START_BLEND,
  buildBridgeRailings,
} from './BridgeRailings.ts';
import { buildBridgeSupports } from './BridgeSupports.ts';
import {
  BUILDING_ACCESS_SPUR_Y_LIFT,
  ROAD_BRIDGE_CORE_Y_OFFSET,
  ROAD_BRIDGE_SHOULDER_LIFT,
  ROAD_CORE_EDGE_JITTER_RATIO,
  ROAD_VISUAL_CORE_Y_OFFSET,
  ROAD_VISUAL_SHOULDER_Y_OFFSET,
  ROAD_WIDTH,
  roadVisualWidth,
} from './roadDimensions.ts';

/** Matches placed-road centerline sampling in `sampleEdge`. */
export const ROAD_PLACED_SAMPLE_SPACING = 1.15;
const OUTER_EDGE_JITTER_RATIO = 0.52 / ROAD_WIDTH;
/** How far the feathered shoulder extends under the opaque core, relative to width. */
const BLEND_INNER_OVERLAP_RATIO = 0.14 / ROAD_WIDTH;
const ROAD_CAP_SEGMENTS = 20;
const ROAD_CAP_LONGITUDINAL_SCALE = 1.08;

type RoadEndpointCaps = {
  start: boolean;
  end: boolean;
};

type RoadCrossSection = {
  leftCore: THREE.Vector3;
  rightCore: THREE.Vector3;
  normal: THREE.Vector3;
  bridgeBlend: number;
};

export class RoadMeshBuilder {
  private readonly terrain: Terrain;
  private readonly materials: RoadMaterialFactory;
  private readonly bridgeCtx: BridgeSamplingContext | null;
  private readonly curveScratch = new THREE.CatmullRomCurve3([]);
  private readonly curvePointScratch = new THREE.Vector3();
  private readonly surfacePointScratch = new THREE.Vector3();
  private readonly tangentScratch = new THREE.Vector3();
  private readonly normalScratch = new THREE.Vector3();
  private readonly leftCoreScratch = new THREE.Vector3();
  private readonly rightCoreScratch = new THREE.Vector3();
  private readonly blendVertexScratch = new THREE.Vector3();

  constructor(terrain: Terrain, materials: RoadMaterialFactory, bridgeCtx?: BridgeSamplingContext) {
    this.terrain = terrain;
    this.materials = materials;
    this.bridgeCtx = bridgeCtx ?? null;
  }

  buildEdge(edge: RoadEdge, network: RoadNetwork): THREE.Group {
    const visualWidth = roadVisualWidth(edge.width);
    const sampled = this.sampleEdge(edge);
    edge.sampledPath = sampled;
    edge.length = pathLength(sampled);

    const ribbonPath = sampled.map((point) => point.clone());
    const spans = this.resolveBridgeSpans(ribbonPath, edge);
    let bridgeBlends = spans.length > 0
      ? applyBridgeHeightsToPath(
          ribbonPath,
          spans,
          this.requireBridgeCtx(),
          ROAD_BRIDGE_CORE_Y_OFFSET,
        )
      : new Float32Array(ribbonPath.length);
    // Publish the same elevated centerline used by the rendered ribbon. Player,
    // villager, and delivery-agent ground sampling must not read the untouched
    // riverbed-height path while the visible bridge sits above it.
    const untrimmedSurfacePath = ribbonPath.map((point) => point.clone());
    edge.surfacePath = untrimmedSurfacePath;

    const startNode = network.nodes.get(edge.startNodeId);
    const endNode = network.nodes.get(edge.endNodeId);
    const startIsEndpoint = startNode ? network.getNodeDegree(startNode) === 1 : false;
    const endIsEndpoint = endNode ? network.getNodeDegree(endNode) === 1 : false;
    const endpointCount = Number(startIsEndpoint) + Number(endIsEndpoint);
    const availableTrim = Math.max(0, pathLength(ribbonPath) - 0.2);
    const terminalTrim = Math.min(
      roadTerminalTrimDistance(visualWidth),
      endpointCount > 0 ? availableTrim / endpointCount : 0,
    );
    if (startNode && startIsEndpoint) {
      trimPathAtEndpoint(ribbonPath, edge.startNodeId, edge, visualWidth, terminalTrim);
    }
    if (endNode && endIsEndpoint) {
      trimPathAtEndpoint(ribbonPath, edge.endNodeId, edge, visualWidth, terminalTrim);
    }
    const startTrim = startIsEndpoint ? terminalTrim : 0;
    if (endpointCount > 0) {
      bridgeBlends = resamplePathAttribute(
        untrimmedSurfacePath,
        bridgeBlends,
        ribbonPath,
        startTrim,
      );
    }
    const renderedSpans = offsetBridgeSpans(spans, startTrim);

    const group = new THREE.Group();
    group.name = `Road edge ${edge.id}`;
    group.userData.edgeId = edge.id;
    group.userData.logicalWidth = edge.width;
    group.userData.visualWidth = visualWidth;

    const crossSections = this.buildCrossSections(ribbonPath, visualWidth, edge.id, true, bridgeBlends);
    const hasBridge = spans.length > 0;
    const endpointCaps = { start: startIsEndpoint, end: endIsEndpoint };
    const core = this.buildRibbonFromSections(
      crossSections,
      ribbonPath,
      visualWidth,
      this.materials.road,
      bridgeBlends,
      endpointCaps,
    );
    core.name = `Road core ${edge.id}`;
    core.userData.edgeId = edge.id;
    core.userData.fpNoCollision = true;
    core.castShadow = false;
    core.receiveShadow = true;
    core.renderOrder = hasBridge ? 13 : 11;
    group.add(core);

    const edgeBlend = this.buildEdgeBlend(
      crossSections,
      ribbonPath,
      visualWidth,
      edge.id,
      endpointCaps,
    );
    edgeBlend.name = `Road edge blend ${edge.id}`;
    edgeBlend.userData.edgeId = edge.id;
    edgeBlend.userData.fpNoCollision = true;
    edgeBlend.castShadow = false;
    edgeBlend.receiveShadow = true;
    edgeBlend.renderOrder = hasBridge ? 12 : 10;
    group.add(edgeBlend);

    if (hasBridge && this.bridgeCtx) {
      const supports = buildBridgeSupports(
        ribbonPath,
        visualWidth,
        renderedSpans,
        this.bridgeCtx,
        this.materials.bridgeSupport,
      );
      if (supports) group.add(supports);
      const railings = buildBridgeRailings(
        crossSections.map((section, index) => ({
          center: ribbonPath[index],
          leftDeck: section.leftCore,
          rightDeck: section.rightCore,
          bridgeBlend: section.bridgeBlend,
        })),
        this.materials.bridgeSupport,
        {
          start: !startIsEndpoint && bridgeBlends[0] > BRIDGE_RAILING_START_BLEND
            ? visualWidth * ROAD_JUNCTION_REACH
            : 0,
          end: !endIsEndpoint
            && bridgeBlends[bridgeBlends.length - 1] > BRIDGE_RAILING_START_BLEND
            ? visualWidth * ROAD_JUNCTION_REACH
            : 0,
        },
      );
      if (railings) group.add(railings);
    }

    edge.mesh = group;
    return group;
  }

  /**
   * Builds a narrow, presentation-only road using the same terrain conformity,
   * irregular edge profile, and feathered shoulder as the placed-road mesh.
   */
  buildBuildingAccessSpur(
    points: THREE.Vector3[],
    width: number,
    seed: string,
  ): THREE.Group | null {
    const ribbonPath = this.samplePath(points, 0.7);
    if (ribbonPath.length < 2) return null;

    const bridgeBlends = new Float32Array(ribbonPath.length);
    const crossSections = this.buildCrossSections(
      ribbonPath,
      width,
      `building-access:${seed}`,
      true,
      bridgeBlends,
    );
    const core = this.buildRibbonFromSections(
      crossSections,
      ribbonPath,
      width,
      this.materials.road,
      bridgeBlends,
    );
    core.geometry.translate(0, BUILDING_ACCESS_SPUR_Y_LIFT, 0);
    core.name = `Building access spur core ${seed}`;
    core.userData.fpNoCollision = true;
    core.userData.buildingAccessSpur = true;
    core.castShadow = false;
    core.receiveShadow = true;
    core.renderOrder = 11.1;

    const edgeBlend = this.buildEdgeBlend(
      crossSections,
      ribbonPath,
      width,
      `building-access:${seed}`,
    );
    edgeBlend.geometry.translate(0, BUILDING_ACCESS_SPUR_Y_LIFT, 0);
    edgeBlend.name = `Building access spur blend ${seed}`;
    edgeBlend.userData.fpNoCollision = true;
    edgeBlend.userData.buildingAccessSpur = true;
    edgeBlend.castShadow = false;
    edgeBlend.receiveShadow = true;
    edgeBlend.renderOrder = 10.1;

    const group = new THREE.Group();
    group.name = `Building access spur ${seed}`;
    group.userData.buildingAccessSpur = true;
    group.userData.visualWidth = width;
    group.add(edgeBlend, core);
    return group;
  }

  buildPreview(
    points: THREE.Vector3[],
    width: number,
    valid: boolean,
    sampledPath?: THREE.Vector3[],
  ): THREE.Group | null {
    const sampled = sampledPath ?? this.samplePath(points, ROAD_PLACED_SAMPLE_SPACING);
    if (sampled.length < 2) return null;

    const visualWidth = roadVisualWidth(width);
    const ribbonPath = sampled;
    const bridgeBlends = new Float32Array(ribbonPath.length);
    const crossSections = this.buildCrossSections(
      ribbonPath,
      visualWidth,
      'preview',
      false,
      bridgeBlends,
    );

    const coreMaterial = valid ? this.materials.previewValid : this.materials.previewInvalid;
    const blendMaterial = valid ? this.materials.previewBlendValid : this.materials.previewBlendInvalid;

    const core = this.buildRibbonFromSections(
      crossSections,
      ribbonPath,
      visualWidth,
      coreMaterial,
      bridgeBlends,
    );
    core.name = 'Road preview core';
    core.userData.previewPart = 'core';
    core.castShadow = false;
    core.receiveShadow = false;
    core.frustumCulled = false;
    core.renderOrder = 25;

    const edgeBlend = this.buildEdgeBlend(crossSections, ribbonPath, visualWidth, 'preview');
    edgeBlend.name = 'Road preview edge blend';
    edgeBlend.userData.previewPart = 'blend';
    edgeBlend.material = blendMaterial;
    edgeBlend.castShadow = false;
    edgeBlend.receiveShadow = false;
    edgeBlend.frustumCulled = false;
    edgeBlend.renderOrder = 24;

    const group = new THREE.Group();
    group.name = 'Road preview ribbon';
    group.add(edgeBlend, core);
    return group;
  }

  /** Lightweight hover ribbon — no shoulder blend, path Y only, capped samples. */
  buildPreviewFast(
    sampledPath: THREE.Vector3[],
    width: number,
    valid: boolean,
    reuse?: THREE.Mesh | null,
  ): THREE.Mesh | null {
    if (sampledPath.length < 2) return null;
    const material = valid ? this.materials.previewValid : this.materials.previewInvalid;
    return this.buildFastRibbonInto(
      sampledPath,
      roadVisualWidth(width),
      material,
      reuse ?? null,
      0.12,
    );
  }

  buildFastRibbonInto(
    path: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    reuseMesh: THREE.Mesh | null,
    yOffset: number,
  ): THREE.Mesh {
    const pointCount = path.length;
    const vertCount = pointCount * 2;
    const positionCount = vertCount * 3;
    const half = width * 0.5;
    const distances = cumulativeDistances(path);

    let positions: Float32Array;
    let uvs: Float32Array;
    let geometry: THREE.BufferGeometry;
    let mesh: THREE.Mesh;

    if (
      reuseMesh
      && reuseMesh.geometry.getAttribute('position')?.count === vertCount
      && reuseMesh.geometry.index?.count === (pointCount - 1) * 6
    ) {
      mesh = reuseMesh;
      geometry = mesh.geometry;
      positions = geometry.getAttribute('position').array as Float32Array;
      uvs = geometry.getAttribute('uv').array as Float32Array;
    } else {
      positions = new Float32Array(positionCount);
      uvs = new Float32Array(vertCount * 2);
      const indices: number[] = [];
      for (let i = 0; i < pointCount - 1; i++) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setIndex(indices);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('uv2', geometry.getAttribute('uv'));
      if (reuseMesh) {
        reuseMesh.geometry.dispose();
        reuseMesh.geometry = geometry;
        mesh = reuseMesh;
      } else {
        mesh = new THREE.Mesh(geometry, material);
      }
    }

    for (let i = 0; i < pointCount; i++) {
      const tangent = tangentAtInto(path, i, this.tangentScratch);
      const normal = this.normalScratch.set(-tangent.z, 0, tangent.x).normalize();
      const baseY = path[i].y + yOffset;
      const left = this.leftCoreScratch.copy(path[i]).addScaledVector(normal, half);
      const right = this.rightCoreScratch.copy(path[i]).addScaledVector(normal, -half);
      left.y = baseY;
      right.y = baseY;
      const offset = i * 6;
      positions[offset] = left.x;
      positions[offset + 1] = left.y;
      positions[offset + 2] = left.z;
      positions[offset + 3] = right.x;
      positions[offset + 4] = right.y;
      positions[offset + 5] = right.z;
      const uvOffset = i * 4;
      const v = distances[i] / 5.8;
      uvs[uvOffset] = 0;
      uvs[uvOffset + 1] = v;
      uvs[uvOffset + 2] = 1;
      uvs[uvOffset + 3] = v;
    }

    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('uv').needsUpdate = true;
    const index = geometry.index;
    if (index) {
      orientTrianglesUpwardXZ(index.array, positions);
      index.needsUpdate = true;
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    mesh.material = material;
    mesh.name = 'Road preview core';
    mesh.userData.previewPart = 'core';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 25;
    return mesh;
  }

  samplePathInto(
    points: THREE.Vector3[],
    spacing: number,
    out: THREE.Vector3[],
    maxDivisions = 240,
  ): THREE.Vector3[] {
    out.length = 0;
    if (points.length < 2) return out;

    const length = pathLength(points);
    const curvatureBoost = estimateCurvature(points) * 8;
    const divisions = THREE.MathUtils.clamp(Math.ceil(length / spacing + curvatureBoost), 8, maxDivisions);
    this.curveScratch.points = points;
    const curve = this.curveScratch;
    curve.curveType = 'centripetal';
    curve.tension = 0.45;

    for (let i = 0; i <= divisions; i++) {
      curve.getPoint(i / divisions, this.curvePointScratch);
      this.terrain.getPointAtInto(
        this.curvePointScratch.x,
        this.curvePointScratch.z,
        this.surfacePointScratch,
        0,
      );
      let sample = out[i];
      if (!sample) {
        sample = new THREE.Vector3();
        out[i] = sample;
      }
      sample.copy(this.surfacePointScratch);
    }
    out.length = divisions + 1;
    return out;
  }

  buildSelection(edge: RoadEdge): THREE.Mesh | null {
    const path = edge.surfacePath && edge.surfacePath.length >= 2
      ? edge.surfacePath
      : edge.sampledPath.length >= 2
        ? edge.sampledPath
        : edge.controlPoints;
    if (path.length < 2) return null;
    const mesh = this.buildSimpleRibbon(
      path,
      roadVisualWidth(edge.width) + 0.9,
      this.materials.selection,
      0.18,
      `${edge.id}-selection`,
      false,
    );
    mesh.renderOrder = 20;
    return mesh;
  }

  samplePath(points: THREE.Vector3[], spacing: number): THREE.Vector3[] {
    return this.samplePoints(points, spacing);
  }

  private sampleEdge(edge: RoadEdge): THREE.Vector3[] {
    return this.samplePoints(edge.controlPoints, ROAD_PLACED_SAMPLE_SPACING);
  }

  private samplePoints(points: THREE.Vector3[], spacing: number): THREE.Vector3[] {
    if (points.length < 2) return [];
    const length = pathLength(points);
    const curvatureBoost = estimateCurvature(points) * 8;
    const divisions = THREE.MathUtils.clamp(Math.ceil(length / spacing + curvatureBoost), 8, 240);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.45);
    const sampled: THREE.Vector3[] = [];
    for (let i = 0; i <= divisions; i++) {
      const p = curve.getPoint(i / divisions);
      sampled.push(this.terrain.getPointAt(p.x, p.z, 0));
    }
    return sampled;
  }

  private resolveBridgeSpans(path: THREE.Vector3[], edge: RoadEdge): BridgeSpan[] {
    if (!this.bridgeCtx) return edge.materialData?.bridgeSpans ?? [];
    const spans = detectBridgeSpans(path, this.bridgeCtx);
    edge.materialData = {
      surface: 'medieval_dirt',
      bridgeSpans: spans.length > 0 ? spans : undefined,
    };
    return spans;
  }

  private requireBridgeCtx(): BridgeSamplingContext {
    if (!this.bridgeCtx) throw new Error('Bridge sampling context is not configured.');
    return this.bridgeCtx;
  }

  private buildCrossSections(
    path: THREE.Vector3[],
    width: number,
    seed: string,
    irregular: boolean,
    bridgeBlends: Float32Array,
  ): RoadCrossSection[] {
    const half = width * 0.5;
    const edgeJitter = width * ROAD_CORE_EDGE_JITTER_RATIO;
    const sections: RoadCrossSection[] = [];

    for (let i = 0; i < path.length; i++) {
      const tangent = tangentAtInto(path, i, this.tangentScratch);
      const normal = this.normalScratch.set(-tangent.z, 0, tangent.x).normalize();
      const leftJitter = irregular ? smoothEdgeJitter(seed, i, 0) * edgeJitter : 0;
      const rightJitter = irregular ? smoothEdgeJitter(seed, i, 1) * edgeJitter : 0;
      const leftCore = this.leftCoreScratch.copy(path[i]).addScaledVector(normal, half + leftJitter);
      const rightCore = this.rightCoreScratch.copy(path[i]).addScaledVector(normal, -half + rightJitter);
      const bridgeBlend = bridgeBlends[i] ?? 0;
      const centerY = path[i].y;
      const leftTerrainY = this.terrain.getHeightAt(leftCore.x, leftCore.z)
        + ROAD_VISUAL_CORE_Y_OFFSET;
      const rightTerrainY = this.terrain.getHeightAt(rightCore.x, rightCore.z)
        + ROAD_VISUAL_CORE_Y_OFFSET;
      leftCore.y = THREE.MathUtils.lerp(leftTerrainY, centerY, bridgeBlend);
      rightCore.y = THREE.MathUtils.lerp(rightTerrainY, centerY, bridgeBlend);
      sections.push({
        leftCore: leftCore.clone(),
        rightCore: rightCore.clone(),
        normal: normal.clone(),
        bridgeBlend,
      });
    }

    return sections;
  }

  private buildRibbonFromSections(
    crossSections: RoadCrossSection[],
    path: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    bridgeBlends: Float32Array,
    endpointCaps: RoadEndpointCaps = { start: false, end: false },
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const bridgeAttrs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);

    // Keep a centerline vertex in every station. When a turn radius becomes
    // tighter than the road half-width, only the inner half-ribbon can fold;
    // the opposite half retains stable UVs and coverage instead of sharing a
    // single bow-tie quad across the full road.
    for (let i = 0; i < crossSections.length; i++) {
      const { leftCore, rightCore } = crossSections[i];
      const blend = bridgeBlends[i] ?? crossSections[i].bridgeBlend;
      const center = path[i];
      const centerY = this.terminalSurfaceY(
        center.x,
        center.z,
        center.y,
        blend,
        ROAD_VISUAL_CORE_Y_OFFSET,
      );
      positions.push(
        leftCore.x,
        leftCore.y,
        leftCore.z,
        center.x,
        centerY,
        center.z,
        rightCore.x,
        rightCore.y,
        rightCore.z,
      );
      const v = distances[i] / 5.8;
      uvs.push(0, v, 0.5, v, 1, v);
      bridgeAttrs.push(blend, blend, blend);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 3;
      indices.push(
        a, a + 3, a + 1,
        a + 1, a + 3, a + 4,
        a + 1, a + 4, a + 2,
        a + 2, a + 4, a + 5,
      );
    }

    if (endpointCaps.start) {
      this.appendCoreTerminalCap(
        crossSections,
        path,
        width,
        distances,
        'start',
        positions,
        uvs,
        bridgeAttrs,
        indices,
      );
    }
    if (endpointCaps.end) {
      this.appendCoreTerminalCap(
        crossSections,
        path,
        width,
        distances,
        'end',
        positions,
        uvs,
        bridgeAttrs,
        indices,
      );
    }

    orientTrianglesUpwardXZ(indices, positions);

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('bridgeBlend', new THREE.Float32BufferAttribute(bridgeAttrs, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  private buildSimpleRibbon(
    path: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    _yOffset: number,
    seed: string,
    irregular: boolean,
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);
    const half = width * 0.5;
    const edgeJitter = width * ROAD_CORE_EDGE_JITTER_RATIO;

    for (let i = 0; i < path.length; i++) {
      const tangent = tangentAt(path, i);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const jitter = irregular ? smoothEdgeJitter(seed, i, 0) * edgeJitter : 0;
      const left = path[i].clone().addScaledVector(normal, half + jitter);
      const right = path[i].clone().addScaledVector(
        normal,
        -half + smoothEdgeJitter(seed, i, 1) * (irregular ? edgeJitter : 0),
      );
      const baseY = path[i].y;
      left.y = baseY;
      right.y = baseY;
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      uvs.push(0, distances[i] / 5.8, 1, distances[i] / 5.8);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    orientTrianglesUpwardXZ(indices, positions);

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }

  private buildEdgeBlend(
    crossSections: RoadCrossSection[],
    path: THREE.Vector3[],
    width: number,
    seed: string,
    endpointCaps: RoadEndpointCaps = { start: false, end: false },
  ): THREE.Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const edgeFades: number[] = [];
    const bridgeAttrs: number[] = [];
    const indices: number[] = [];
    const distances = cumulativeDistances(path);
    const shoulderMid = width * 0.48;
    const shoulderOuter = width * 0.92;
    const outerEdgeJitter = width * OUTER_EDGE_JITTER_RATIO;
    const innerOverlap = width * BLEND_INNER_OVERLAP_RATIO;

    for (let i = 0; i < crossSections.length; i++) {
      const { leftCore, rightCore, normal, bridgeBlend } = crossSections[i];
      const leftOuterJitter = smoothEdgeJitter(seed, i, 2) * outerEdgeJitter;
      const rightOuterJitter = smoothEdgeJitter(seed, i, 3) * outerEdgeJitter;
      this.pushBlendVertex(positions, leftCore, normal, shoulderOuter + leftOuterJitter, bridgeBlend);
      this.pushBlendVertex(positions, leftCore, normal, shoulderMid + leftOuterJitter * 0.62, bridgeBlend);
      this.pushBlendVertex(positions, leftCore, normal, -innerOverlap, bridgeBlend);
      this.pushBlendVertex(positions, rightCore, normal, innerOverlap, bridgeBlend);
      this.pushBlendVertex(positions, rightCore, normal, -(shoulderMid + rightOuterJitter * 0.62), bridgeBlend);
      this.pushBlendVertex(positions, rightCore, normal, -(shoulderOuter + rightOuterJitter), bridgeBlend);
      const v = distances[i] / 5.8;
      uvs.push(0, v, 0.42, v, 1, v, 1, v, 0.42, v, 0, v);
      edgeFades.push(0, 0.42, 1, 1, 0.42, 0);
      for (let j = 0; j < 6; j++) bridgeAttrs.push(bridgeBlend);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 6;
      indices.push(a, a + 6, a + 1, a + 1, a + 6, a + 7);
      indices.push(a + 1, a + 7, a + 2, a + 2, a + 7, a + 8);
      indices.push(a + 3, a + 9, a + 4, a + 4, a + 9, a + 10);
      indices.push(a + 4, a + 10, a + 5, a + 5, a + 10, a + 11);
    }

    if (endpointCaps.start) {
      this.appendBlendTerminalCap(
        crossSections,
        path,
        distances,
        'start',
        positions,
        uvs,
        edgeFades,
        bridgeAttrs,
        indices,
      );
    }
    if (endpointCaps.end) {
      this.appendBlendTerminalCap(
        crossSections,
        path,
        distances,
        'end',
        positions,
        uvs,
        edgeFades,
        bridgeAttrs,
        indices,
      );
    }

    orientTrianglesUpwardXZ(indices, positions);

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('edgeFade', new THREE.Float32BufferAttribute(edgeFades, 1));
    geometry.setAttribute('bridgeBlend', new THREE.Float32BufferAttribute(bridgeAttrs, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.materials.roadEdge);
  }

  /**
   * Compile a dead-end cap into the same indexed fabric as the road core.
   * The two diameter vertices are the ribbon's real terminal vertices, so
   * terrain height, UV phase, and vertex normals cannot diverge at the join.
   */
  private appendCoreTerminalCap(
    crossSections: RoadCrossSection[],
    path: THREE.Vector3[],
    width: number,
    distances: number[],
    end: 'start' | 'end',
    positions: number[],
    uvs: number[],
    bridgeAttrs: number[],
    indices: number[],
  ): void {
    const sectionIndex = end === 'start' ? 0 : crossSections.length - 1;
    const section = crossSections[sectionIndex];
    const frame = terminalFrame(path, sectionIndex, end);
    const leftIndex = sectionIndex * 3;
    const rightIndex = leftIndex + 2;
    const sides = terminalSideIndices(
      frame.center,
      frame.perp,
      section.leftCore,
      leftIndex,
      section.rightCore,
      rightIndex,
    );
    const centerIndex = positions.length / 3;
    const centerY = this.terminalSurfaceY(
      frame.center.x,
      frame.center.z,
      path[sectionIndex].y,
      section.bridgeBlend,
      ROAD_VISUAL_CORE_Y_OFFSET,
    );
    positions.push(frame.center.x, centerY, frame.center.z);
    const terminalV = (distances[sectionIndex] ?? 0) / 5.8;
    uvs.push(0.5, terminalV);
    bridgeAttrs.push(section.bridgeBlend);

    const boundary = [sides.minusIndex];
    const bulge = Math.max(
      0.1,
      (sides.minusRadius + sides.plusRadius) * 0.5 * ROAD_CAP_LONGITUDINAL_SCALE,
    );
    for (let segment = 1; segment < ROAD_CAP_SEGMENTS; segment++) {
      const theta = -Math.PI * 0.5 + segment / ROAD_CAP_SEGMENTS * Math.PI;
      const sinTheta = Math.sin(theta);
      const outwardDistance = Math.cos(theta) * bulge;
      const sideMix = (sinTheta + 1) * 0.5;
      const lateralRadius = THREE.MathUtils.lerp(
        sides.minusRadius,
        sides.plusRadius,
        sideMix,
      );
      const lateralDistance = sinTheta * lateralRadius;
      const point = frame.center
        .clone()
        .addScaledVector(frame.exterior, outwardDistance)
        .addScaledVector(frame.perp, lateralDistance);
      const vertexIndex = positions.length / 3;
      positions.push(
        point.x,
        this.terminalSurfaceY(
          point.x,
          point.z,
          path[sectionIndex].y,
          section.bridgeBlend,
          ROAD_VISUAL_CORE_Y_OFFSET,
        ),
        point.z,
      );
      uvs.push(
        0.5 + lateralDistance / Math.max(1, width),
        terminalV + (end === 'start' ? -1 : 1) * outwardDistance / 5.8,
      );
      bridgeAttrs.push(section.bridgeBlend);
      boundary.push(vertexIndex);
    }
    boundary.push(sides.plusIndex);

    for (let index = 0; index < boundary.length - 1; index++) {
      indices.push(centerIndex, boundary[index], boundary[index + 1]);
    }
  }

  /**
   * Continue the two shoulder strips around a dead end as one semi-annulus.
   * Reusing all six terminal strip vertices removes the detached mouth wings
   * that previously produced paired triangular notches on uneven terrain.
   */
  private appendBlendTerminalCap(
    crossSections: RoadCrossSection[],
    path: THREE.Vector3[],
    distances: number[],
    end: 'start' | 'end',
    positions: number[],
    uvs: number[],
    edgeFades: number[],
    bridgeAttrs: number[],
    indices: number[],
  ): void {
    const sectionIndex = end === 'start' ? 0 : crossSections.length - 1;
    const section = crossSections[sectionIndex];
    const frame = terminalFrame(path, sectionIndex, end);
    const base = sectionIndex * 6;
    const terminalV = (distances[sectionIndex] ?? 0) / 5.8;
    const ringPairs = [
      { first: base + 2, second: base + 3, fadeU: 1 },
      { first: base + 1, second: base + 4, fadeU: 0.42 },
      { first: base, second: base + 5, fadeU: 0 },
    ];
    const rings = ringPairs.map(({ first, second, fadeU }) => {
      const firstPoint = positionAt(positions, first);
      const secondPoint = positionAt(positions, second);
      const sides = terminalSideIndices(
        frame.center,
        frame.perp,
        firstPoint,
        first,
        secondPoint,
        second,
      );
      const ring = [sides.minusIndex];
      const bulge = Math.max(0.1, (sides.minusRadius + sides.plusRadius) * 0.5);
      for (let segment = 1; segment < ROAD_CAP_SEGMENTS; segment++) {
        const theta = -Math.PI * 0.5 + segment / ROAD_CAP_SEGMENTS * Math.PI;
        const sinTheta = Math.sin(theta);
        const outwardDistance = Math.cos(theta) * bulge;
        const sideMix = (sinTheta + 1) * 0.5;
        const lateralRadius = THREE.MathUtils.lerp(
          sides.minusRadius,
          sides.plusRadius,
          sideMix,
        );
        const lateralDistance = sinTheta * lateralRadius;
        const point = frame.center
          .clone()
          .addScaledVector(frame.exterior, outwardDistance)
          .addScaledVector(frame.perp, lateralDistance);
        const vertexIndex = positions.length / 3;
        positions.push(
          point.x,
          this.terminalSurfaceY(
            point.x,
            point.z,
            path[sectionIndex].y + ROAD_BRIDGE_SHOULDER_LIFT * section.bridgeBlend,
            section.bridgeBlend,
            ROAD_VISUAL_SHOULDER_Y_OFFSET,
          ),
          point.z,
        );
        uvs.push(
          fadeU,
          terminalV + (end === 'start' ? -1 : 1) * outwardDistance / 5.8,
        );
        edgeFades.push(fadeU);
        bridgeAttrs.push(section.bridgeBlend);
        ring.push(vertexIndex);
      }
      ring.push(sides.plusIndex);
      return ring;
    });

    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
      const inner = rings[ringIndex];
      const outer = rings[ringIndex + 1];
      for (let index = 0; index < inner.length - 1; index++) {
        const a = inner[index];
        const b = inner[index + 1];
        const c = outer[index + 1];
        const d = outer[index];
        indices.push(a, d, b, b, d, c);
      }
    }
  }

  private terminalSurfaceY(
    x: number,
    z: number,
    bridgeY: number,
    bridgeBlend: number,
    terrainOffset: number,
  ): number {
    return THREE.MathUtils.lerp(
      this.terrain.getHeightAt(x, z) + terrainOffset,
      bridgeY,
      bridgeBlend,
    );
  }

  /** Re-sample terrain height at the shoulder XZ so sloped edges don't intersect the ground mesh. */
  private pushBlendVertex(
    positions: number[],
    core: THREE.Vector3,
    normal: THREE.Vector3,
    lateralOffset: number,
    bridgeBlend: number,
  ): void {
    const point = this.blendVertexScratch.copy(core).addScaledVector(normal, lateralOffset);
    const terrainY = this.terrain.getHeightAt(point.x, point.z)
      + ROAD_VISUAL_SHOULDER_Y_OFFSET;
    point.y = THREE.MathUtils.lerp(
      terrainY,
      core.y + ROAD_BRIDGE_SHOULDER_LIFT * bridgeBlend,
      bridgeBlend,
    );
    positions.push(point.x, point.y, point.z);
  }
}

function tangentAt(path: THREE.Vector3[], index: number): THREE.Vector3 {
  return tangentAtInto(path, index, new THREE.Vector3());
}

/**
 * Keep terrain-conforming road fabric front-facing even when a parallel
 * offset locally folds inside a turn tighter than its half-width.
 */
function orientTrianglesUpwardXZ(
  indices: { readonly length: number; [index: number]: number },
  positions: ArrayLike<number>,
): void {
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    const areaY = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a])
      - (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
    if (areaY >= 0) continue;
    const swap = indices[offset + 1];
    indices[offset + 1] = indices[offset + 2];
    indices[offset + 2] = swap;
  }
}

function tangentAtInto(path: THREE.Vector3[], index: number, target: THREE.Vector3): THREE.Vector3 {
  const prev = path[Math.max(0, index - 1)];
  const next = path[Math.min(path.length - 1, index + 1)];
  target.set(next.x - prev.x, 0, next.z - prev.z);
  if (target.lengthSq() < 1e-6) return target.set(1, 0, 0);
  return target.normalize();
}

type TerminalFrame = {
  center: THREE.Vector3;
  exterior: THREE.Vector3;
  perp: THREE.Vector3;
};

function terminalFrame(
  path: THREE.Vector3[],
  sectionIndex: number,
  end: 'start' | 'end',
): TerminalFrame {
  const center = path[sectionIndex].clone();
  const neighborIndex = end === 'start' ? Math.min(1, path.length - 1) : Math.max(0, path.length - 2);
  const interior = path[neighborIndex].clone().sub(center).setY(0);
  if (interior.lengthSq() < 1e-6) interior.set(1, 0, 0);
  interior.normalize();
  const exterior = interior.clone().multiplyScalar(-1);
  const perp = new THREE.Vector3(-interior.z, 0, interior.x).normalize();
  return { center, exterior, perp };
}

function terminalSideIndices(
  center: THREE.Vector3,
  perp: THREE.Vector3,
  firstPoint: THREE.Vector3,
  firstIndex: number,
  secondPoint: THREE.Vector3,
  secondIndex: number,
): {
  minusIndex: number;
  minusRadius: number;
  plusIndex: number;
  plusRadius: number;
} {
  const firstOffset = firstPoint.clone().sub(center).dot(perp);
  const secondOffset = secondPoint.clone().sub(center).dot(perp);
  if (firstOffset <= secondOffset) {
    return {
      minusIndex: firstIndex,
      minusRadius: Math.abs(firstOffset),
      plusIndex: secondIndex,
      plusRadius: Math.abs(secondOffset),
    };
  }
  return {
    minusIndex: secondIndex,
    minusRadius: Math.abs(secondOffset),
    plusIndex: firstIndex,
    plusRadius: Math.abs(firstOffset),
  };
}

function positionAt(positions: number[], index: number): THREE.Vector3 {
  const offset = index * 3;
  return new THREE.Vector3(positions[offset], positions[offset + 1], positions[offset + 2]);
}

function cumulativeDistances(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < path.length; i++) result.push(result[i - 1] + path[i - 1].distanceTo(path[i]));
  return result;
}

function pathLength(path: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return length;
}

function resamplePathAttribute(
  sourcePath: THREE.Vector3[],
  sourceValues: Float32Array,
  targetPath: THREE.Vector3[],
  targetStartDistance: number,
): Float32Array {
  const result = new Float32Array(targetPath.length);
  if (sourcePath.length < 2 || sourceValues.length !== sourcePath.length || targetPath.length === 0) {
    return result;
  }

  const sourceDistances = cumulativeDistancesXZ(sourcePath);
  const targetDistances = cumulativeDistancesXZ(targetPath);
  let sourceIndex = 0;
  for (let targetIndex = 0; targetIndex < targetPath.length; targetIndex++) {
    const distance = targetStartDistance + targetDistances[targetIndex];
    while (
      sourceIndex < sourceDistances.length - 2
      && sourceDistances[sourceIndex + 1] < distance
    ) {
      sourceIndex += 1;
    }
    const startDistance = sourceDistances[sourceIndex];
    const endDistance = sourceDistances[sourceIndex + 1];
    const t = THREE.MathUtils.clamp(
      (distance - startDistance) / Math.max(1e-6, endDistance - startDistance),
      0,
      1,
    );
    result[targetIndex] = THREE.MathUtils.lerp(
      sourceValues[sourceIndex],
      sourceValues[sourceIndex + 1],
      t,
    );
  }
  return result;
}

function offsetBridgeSpans(spans: BridgeSpan[], startDistance: number): BridgeSpan[] {
  if (startDistance <= 1e-6) return spans;
  return spans.map((span) => ({
    ...span,
    rampStart: span.rampStart - startDistance,
    deckStart: span.deckStart - startDistance,
    deckEnd: span.deckEnd - startDistance,
    rampEnd: span.rampEnd - startDistance,
  }));
}

function cumulativeDistancesXZ(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let index = 1; index < path.length; index++) {
    result.push(
      result[index - 1]
      + Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z),
    );
  }
  return result;
}

function estimateCurvature(points: THREE.Vector3[]): number {
  let curvature = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = new THREE.Vector2(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z).normalize();
    const b = new THREE.Vector2(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z).normalize();
    curvature += Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  }
  return curvature;
}

function edgeJitter(seed: string, index: number, side: number): number {
  const seedValue = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Math.sin(index * 1.734 + side * 11.91 + seedValue * 0.137) * 0.65 + Math.sin(index * 0.431 + seedValue) * 0.35;
}

function smoothEdgeJitter(seed: string, index: number, side: number): number {
  return edgeJitter(seed, index - 1, side) * 0.24
    + edgeJitter(seed, index, side) * 0.52
    + edgeJitter(seed, index + 1, side) * 0.24;
}
