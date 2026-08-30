import * as THREE from 'three';
import type { ProceduralMaterialRole } from './catalog.ts';
import {
  PROCEDURAL_MATERIAL_ROLE_REGISTRY,
  type ProceduralMaterialRoleDefinition,
  type ProceduralPhysicalUvPolicy,
  type ProceduralStructuralUse,
  type ProceduralUvAxis,
  type ProceduralUvProjection,
} from './materialRoles.ts';

const GEOMETRY_EPSILON = 1e-6;
const ORTHOGONAL_EPSILON = 1e-4;
export const PROCEDURAL_GEOMETRY_WRITER_VERSION = 'semantic-physical-uv-v1';

export type ProceduralPoint3 = THREE.Vector3 | readonly [x: number, y: number, z: number];
export type ProceduralPoint2 = readonly [x: number, y: number];
export type ProceduralUvOffset = readonly [uMeters: number, vMeters: number];

type SemanticPrimitiveOptions = {
  readonly semanticId: string;
  readonly moduleId?: string;
  readonly materialRole: ProceduralMaterialRole;
  readonly structuralUse: ProceduralStructuralUse;
  /** Metre offset used to preserve course phase across adjacent modules. */
  readonly uvOffsetMeters?: ProceduralUvOffset;
};

export type ProceduralBoxOptions = SemanticPrimitiveOptions & {
  readonly center: ProceduralPoint3;
  readonly size: readonly [width: number, height: number, depth: number];
};

export type ProceduralPrismOptions = SemanticPrimitiveOptions & {
  readonly center: ProceduralPoint3;
  /** Convex local XY profile. Input winding may be clockwise or counter-clockwise. */
  readonly profile: readonly ProceduralPoint2[];
  readonly depth: number;
};

export type ProceduralMemberOptions = SemanticPrimitiveOptions & {
  readonly start: ProceduralPoint3;
  readonly end: ProceduralPoint3;
  readonly width: number;
  readonly depth: number;
  /** Guides the cross-section so roof/wall members remain consistently rolled. */
  readonly upHint?: ProceduralPoint3;
};

export type ProceduralRoofPanelOptions = SemanticPrimitiveOptions & {
  /** Lower-left point on the visible roof surface. */
  readonly eaveOrigin: ProceduralPoint3;
  readonly eaveVector: ProceduralPoint3;
  readonly slopeVector: ProceduralPoint3;
  readonly thickness: number;
};

export type ProceduralUvFrameDiagnostic = {
  readonly projection: ProceduralUvProjection;
  readonly uAxis: ProceduralUvAxis;
  readonly vAxis: ProceduralUvAxis;
  readonly origin: readonly [number, number, number];
  readonly uDirection: readonly [number, number, number];
  readonly vDirection: readonly [number, number, number];
  readonly metersPerRepeat: readonly [number, number];
  readonly offsetMeters: ProceduralUvOffset;
};

export type ProceduralPrimitiveDiagnostic = {
  readonly primitive: 'box' | 'prism' | 'member' | 'roof-panel';
  readonly semanticId: string;
  readonly moduleId?: string;
  readonly materialRole: ProceduralMaterialRole;
  readonly structuralUse: ProceduralStructuralUse;
  readonly dimensions: readonly number[];
  readonly triangleStart: number;
  readonly triangleCount: number;
  readonly uvFrame: ProceduralUvFrameDiagnostic;
};

export type CompiledProceduralMaterialSlot = {
  readonly materialRole: ProceduralMaterialRole;
  readonly materialIndex: number;
  readonly geometry: THREE.BufferGeometry;
  readonly sharedMaterialKeys: ProceduralMaterialRoleDefinition['sharedMaterialKeys'];
  readonly sharedDetailMaterialKeys: ProceduralMaterialRoleDefinition['sharedDetailMaterialKeys'];
  readonly atlasTiles: ProceduralMaterialRoleDefinition['atlasTiles'];
  readonly diagnostics: {
    readonly primitiveCount: number;
    readonly triangleCount: number;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly primitives: readonly ProceduralPrimitiveDiagnostic[];
  };
};

export type ProceduralGeometryWriterResult = {
  readonly version: typeof PROCEDURAL_GEOMETRY_WRITER_VERSION;
  readonly slots: readonly CompiledProceduralMaterialSlot[];
  readonly diagnostics: {
    readonly primitiveCount: number;
    readonly triangleCount: number;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly materialSlotCount: number;
    readonly unusedMaterialRoles: readonly ProceduralMaterialRole[];
  };
};

type MutableSlot = {
  readonly materialRole: ProceduralMaterialRole;
  readonly materialIndex: number;
  readonly definition: ProceduralMaterialRoleDefinition;
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
  readonly primitives: ProceduralPrimitiveDiagnostic[];
};

/**
 * Accumulates final-size semantic primitives into one indexed geometry per
 * material role. The returned geometries retain metre UVs and can be passed to
 * addMesh with the corresponding shared material without UV reprojection.
 */
export class ProceduralGeometryWriter {
  private readonly orderedSlots: readonly MutableSlot[];
  private readonly slotsByRole: ReadonlyMap<ProceduralMaterialRole, MutableSlot>;

  constructor(materialRoles: readonly ProceduralMaterialRole[]) {
    if (materialRoles.length === 0) {
      throw new Error('ProceduralGeometryWriter requires at least one material role.');
    }
    const roles = new Set<ProceduralMaterialRole>();
    const slots = materialRoles.map((materialRole, materialIndex): MutableSlot => {
      if (roles.has(materialRole)) {
        throw new Error(`ProceduralGeometryWriter repeats material role ${materialRole}.`);
      }
      roles.add(materialRole);
      const definition = materialRoleDefinition(materialRole);
      assertIsotropicRepeatForAddMesh(materialRole, definition.uvPolicy);
      return {
        materialRole,
        materialIndex,
        definition,
        positions: [],
        normals: [],
        uvs: [],
        indices: [],
        primitives: [],
      };
    });
    this.orderedSlots = slots;
    this.slotsByRole = new Map(slots.map((slot) => [slot.materialRole, slot] as const));
  }

  addBox(options: ProceduralBoxOptions): this {
    const slot = this.slotFor(options, [
      'world-planar',
      'surface-planar',
      'course-aligned',
      'fabric-panel-aligned',
      'weave-aligned',
    ]);
    const center = finitePoint3(options.center, `${options.semanticId} center`);
    const [width, height, depth] = options.size;
    positiveDimension(width, `${options.semanticId} width`);
    positiveDimension(height, `${options.semanticId} height`);
    positiveDimension(depth, `${options.semanticId} depth`);
    const startIndex = slot.indices.length;
    const halfX = width * 0.5;
    const halfY = height * 0.5;
    const halfZ = depth * 0.5;
    const point = (x: number, y: number, z: number): THREE.Vector3 =>
      center.clone().add(new THREE.Vector3(x, y, z));
    const uvOffset = uvOffsetMeters(options);
    const policy = slot.definition.uvPolicy;

    appendQuad(slot,
      [point(-halfX, -halfY, halfZ), point(halfX, -halfY, halfZ), point(halfX, halfY, halfZ), point(-halfX, halfY, halfZ)],
      new THREE.Vector3(0, 0, 1), uvRectangle(width, height, policy, uvOffset));
    appendQuad(slot,
      [point(halfX, -halfY, -halfZ), point(-halfX, -halfY, -halfZ), point(-halfX, halfY, -halfZ), point(halfX, halfY, -halfZ)],
      new THREE.Vector3(0, 0, -1), uvRectangle(width, height, policy, uvOffset));
    appendQuad(slot,
      [point(halfX, -halfY, halfZ), point(halfX, -halfY, -halfZ), point(halfX, halfY, -halfZ), point(halfX, halfY, halfZ)],
      new THREE.Vector3(1, 0, 0), uvRectangle(depth, height, policy, uvOffset));
    appendQuad(slot,
      [point(-halfX, -halfY, -halfZ), point(-halfX, -halfY, halfZ), point(-halfX, halfY, halfZ), point(-halfX, halfY, -halfZ)],
      new THREE.Vector3(-1, 0, 0), uvRectangle(depth, height, policy, uvOffset));
    appendQuad(slot,
      [point(-halfX, halfY, halfZ), point(halfX, halfY, halfZ), point(halfX, halfY, -halfZ), point(-halfX, halfY, -halfZ)],
      new THREE.Vector3(0, 1, 0), uvRectangle(width, depth, policy, uvOffset));
    appendQuad(slot,
      [point(-halfX, -halfY, -halfZ), point(halfX, -halfY, -halfZ), point(halfX, -halfY, halfZ), point(-halfX, -halfY, halfZ)],
      new THREE.Vector3(0, -1, 0), uvRectangle(width, depth, policy, uvOffset));

    recordPrimitive(slot, options, 'box', [width, height, depth], startIndex, {
      origin: point(-halfX, -halfY, -halfZ),
      uDirection: new THREE.Vector3(1, 0, 0),
      vDirection: new THREE.Vector3(0, 1, 0),
    });
    return this;
  }

  addPrism(options: ProceduralPrismOptions): this {
    const slot = this.slotFor(options, [
      'surface-planar',
      'course-aligned',
      'fabric-panel-aligned',
      'weave-aligned',
    ]);
    const center = finitePoint3(options.center, `${options.semanticId} center`);
    const depth = positiveDimension(options.depth, `${options.semanticId} depth`);
    const profile = validatedConvexProfile(options.profile, options.semanticId);
    const xs = profile.map(([x]) => x);
    const ys = profile.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = positiveDimension(maxX - minX, `${options.semanticId} profile width`);
    const height = positiveDimension(maxY - minY, `${options.semanticId} profile height`);
    const halfDepth = depth * 0.5;
    const front = profile.map(([x, y]) => center.clone().add(new THREE.Vector3(x, y, halfDepth)));
    const back = profile.map(([x, y]) => center.clone().add(new THREE.Vector3(x, y, -halfDepth)));
    const policy = slot.definition.uvPolicy;
    const uvOffset = uvOffsetMeters(options);
    const capUvs = profile.map(([x, y]) => physicalUv(x - minX, y - minY, policy, uvOffset));
    const startIndex = slot.indices.length;

    appendConvexPolygon(slot, front, new THREE.Vector3(0, 0, 1), capUvs);
    appendConvexPolygon(slot, back, new THREE.Vector3(0, 0, -1), capUvs);
    for (let index = 0; index < profile.length; index += 1) {
      const next = (index + 1) % profile.length;
      const [x0, y0] = profile[index]!;
      const [x1, y1] = profile[next]!;
      const edge = new THREE.Vector2(x1 - x0, y1 - y0);
      const normal = new THREE.Vector3(edge.y, -edge.x, 0).normalize();
      const sideUvs = Math.abs(edge.y) > GEOMETRY_EPSILON
        ? [
            physicalUv(depth, y0 - minY, policy, uvOffset),
            physicalUv(depth, y1 - minY, policy, uvOffset),
            physicalUv(0, y1 - minY, policy, uvOffset),
            physicalUv(0, y0 - minY, policy, uvOffset),
          ] as const
        : uvRectangle(edge.length(), depth, policy, uvOffset);
      appendQuad(slot,
        [front[index]!, front[next]!, back[next]!, back[index]!],
        normal,
        sideUvs);
    }

    recordPrimitive(slot, options, 'prism', [width, height, depth], startIndex, {
      origin: center.clone().add(new THREE.Vector3(minX, minY, -halfDepth)),
      uDirection: new THREE.Vector3(1, 0, 0),
      vDirection: new THREE.Vector3(0, 1, 0),
    });
    return this;
  }

  addMember(options: ProceduralMemberOptions): this {
    const slot = this.slotFor(options, ['member-aligned']);
    const start = finitePoint3(options.start, `${options.semanticId} start`);
    const end = finitePoint3(options.end, `${options.semanticId} end`);
    const width = positiveDimension(options.width, `${options.semanticId} width`);
    const depth = positiveDimension(options.depth, `${options.semanticId} depth`);
    const lengthAxis = end.clone().sub(start);
    const length = positiveDimension(lengthAxis.length(), `${options.semanticId} length`);
    lengthAxis.multiplyScalar(1 / length);
    const upHint = finitePoint3(options.upHint ?? [0, 1, 0], `${options.semanticId} up hint`);
    positiveDimension(upHint.length(), `${options.semanticId} up hint length`);
    upHint.normalize();
    let widthAxis = new THREE.Vector3().crossVectors(upHint, lengthAxis);
    if (widthAxis.lengthSq() <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
      widthAxis = new THREE.Vector3().crossVectors(leastAlignedAxis(lengthAxis), lengthAxis);
    }
    widthAxis.normalize();
    const depthAxis = new THREE.Vector3().crossVectors(lengthAxis, widthAxis).normalize();
    const center = start.clone().add(end).multiplyScalar(0.5);
    const halfLength = length * 0.5;
    const halfWidth = width * 0.5;
    const halfDepth = depth * 0.5;
    const point = (along: number, across: number, deep: number): THREE.Vector3 => center.clone()
      .addScaledVector(lengthAxis, along)
      .addScaledVector(widthAxis, across)
      .addScaledVector(depthAxis, deep);
    const policy = slot.definition.uvPolicy;
    const uvOffset = uvOffsetMeters(options);
    const startIndex = slot.indices.length;

    appendQuad(slot,
      [point(-halfLength, -halfWidth, halfDepth), point(halfLength, -halfWidth, halfDepth), point(halfLength, halfWidth, halfDepth), point(-halfLength, halfWidth, halfDepth)],
      depthAxis, uvRectangle(length, width, policy, uvOffset));
    appendQuad(slot,
      [point(-halfLength, halfWidth, -halfDepth), point(halfLength, halfWidth, -halfDepth), point(halfLength, -halfWidth, -halfDepth), point(-halfLength, -halfWidth, -halfDepth)],
      depthAxis.clone().negate(), uvRectangle(length, width, policy, uvOffset));
    appendQuad(slot,
      [point(-halfLength, halfWidth, halfDepth), point(halfLength, halfWidth, halfDepth), point(halfLength, halfWidth, -halfDepth), point(-halfLength, halfWidth, -halfDepth)],
      widthAxis, uvRectangle(length, depth, policy, uvOffset));
    appendQuad(slot,
      [point(-halfLength, -halfWidth, -halfDepth), point(halfLength, -halfWidth, -halfDepth), point(halfLength, -halfWidth, halfDepth), point(-halfLength, -halfWidth, halfDepth)],
      widthAxis.clone().negate(), uvRectangle(length, depth, policy, uvOffset));
    appendQuad(slot,
      [point(halfLength, -halfWidth, halfDepth), point(halfLength, -halfWidth, -halfDepth), point(halfLength, halfWidth, -halfDepth), point(halfLength, halfWidth, halfDepth)],
      lengthAxis, uvRectangle(width, depth, policy, uvOffset));
    appendQuad(slot,
      [point(-halfLength, -halfWidth, -halfDepth), point(-halfLength, -halfWidth, halfDepth), point(-halfLength, halfWidth, halfDepth), point(-halfLength, halfWidth, -halfDepth)],
      lengthAxis.clone().negate(), uvRectangle(width, depth, policy, uvOffset));

    recordPrimitive(slot, options, 'member', [length, width, depth], startIndex, {
      origin: start,
      uDirection: lengthAxis,
      vDirection: widthAxis,
    });
    return this;
  }

  addRoofPanel(options: ProceduralRoofPanelOptions): this {
    const slot = this.slotFor(options, ['roof-course-aligned']);
    const origin = finitePoint3(options.eaveOrigin, `${options.semanticId} eave origin`);
    const eave = finitePoint3(options.eaveVector, `${options.semanticId} eave vector`);
    const slope = finitePoint3(options.slopeVector, `${options.semanticId} slope vector`);
    const width = positiveDimension(eave.length(), `${options.semanticId} eave length`);
    const slopeLength = positiveDimension(slope.length(), `${options.semanticId} slope length`);
    const thickness = positiveDimension(options.thickness, `${options.semanticId} thickness`);
    const eaveAxis = eave.clone().multiplyScalar(1 / width);
    const slopeAxis = slope.clone().multiplyScalar(1 / slopeLength);
    if (Math.abs(eaveAxis.dot(slopeAxis)) > ORTHOGONAL_EPSILON) {
      throw new Error(`${options.semanticId} eave and slope vectors must be perpendicular.`);
    }
    const outward = new THREE.Vector3().crossVectors(eaveAxis, slopeAxis).normalize();
    if (outward.y < 0) outward.negate();
    const top = [
      origin.clone(),
      origin.clone().add(eave),
      origin.clone().add(eave).add(slope),
      origin.clone().add(slope),
    ] as const;
    const bottom = top.map((point) => point.clone().addScaledVector(outward, -thickness));
    const policy = slot.definition.uvPolicy;
    const uvOffset = uvOffsetMeters(options);
    const startIndex = slot.indices.length;
    const panelCenter = origin.clone().addScaledVector(eave, 0.5)
      .addScaledVector(slope, 0.5)
      .addScaledVector(outward, -thickness * 0.5);

    appendQuad(slot, top, outward, uvRectangle(width, slopeLength, policy, uvOffset));
    appendQuad(slot,
      [bottom[3]!, bottom[2]!, bottom[1]!, bottom[0]!],
      outward.clone().negate(), uvRectangle(width, slopeLength, policy, uvOffset));
    appendRoofEdge(slot, [top[0], top[1], bottom[1]!, bottom[0]!], panelCenter, width, thickness, policy, uvOffset);
    appendRoofEdge(slot, [top[2], top[3], bottom[3]!, bottom[2]!], panelCenter, width, thickness, policy, uvOffset);
    appendRoofEdge(slot, [top[3], top[0], bottom[0]!, bottom[3]!], panelCenter, slopeLength, thickness, policy, uvOffset);
    appendRoofEdge(slot, [top[1], top[2], bottom[2]!, bottom[1]!], panelCenter, slopeLength, thickness, policy, uvOffset);

    recordPrimitive(slot, options, 'roof-panel', [width, slopeLength, thickness], startIndex, {
      origin,
      uDirection: eaveAxis,
      vDirection: slopeAxis,
    });
    return this;
  }

  build(): ProceduralGeometryWriterResult {
    const slots: CompiledProceduralMaterialSlot[] = [];
    let primitiveCount = 0;
    let triangleCount = 0;
    let vertexCount = 0;
    let indexCount = 0;
    const unusedMaterialRoles: ProceduralMaterialRole[] = [];

    for (const slot of this.orderedSlots) {
      if (slot.indices.length === 0) {
        unusedMaterialRoles.push(slot.materialRole);
        continue;
      }
      const geometry = compileSlotGeometry(slot);
      const diagnostics = {
        primitiveCount: slot.primitives.length,
        triangleCount: slot.indices.length / 3,
        vertexCount: slot.positions.length / 3,
        indexCount: slot.indices.length,
        primitives: slot.primitives.map(clonePrimitiveDiagnostic),
      } as const;
      primitiveCount += diagnostics.primitiveCount;
      triangleCount += diagnostics.triangleCount;
      vertexCount += diagnostics.vertexCount;
      indexCount += diagnostics.indexCount;
      slots.push({
        materialRole: slot.materialRole,
        materialIndex: slot.materialIndex,
        geometry,
        sharedMaterialKeys: slot.definition.sharedMaterialKeys,
        sharedDetailMaterialKeys: slot.definition.sharedDetailMaterialKeys,
        atlasTiles: slot.definition.atlasTiles,
        diagnostics,
      });
    }

    return {
      version: PROCEDURAL_GEOMETRY_WRITER_VERSION,
      slots,
      diagnostics: {
        primitiveCount,
        triangleCount,
        vertexCount,
        indexCount,
        materialSlotCount: slots.length,
        unusedMaterialRoles,
      },
    };
  }

  private slotFor(
    options: SemanticPrimitiveOptions,
    allowedProjections: readonly ProceduralUvProjection[],
  ): MutableSlot {
    assertSemanticId(options.semanticId);
    const slot = this.slotsByRole.get(options.materialRole);
    if (!slot) {
      throw new Error(`${options.semanticId} uses undeclared material slot ${options.materialRole}.`);
    }
    validateStructuralUse(options, slot.definition);
    if (!allowedProjections.includes(slot.definition.uvPolicy.projection)) {
      throw new Error(
        `${options.semanticId} cannot emit ${slot.definition.uvPolicy.projection} UVs with this primitive.`,
      );
    }
    uvOffsetMeters(options);
    return slot;
  }
}

export function createProceduralBoxGeometry(options: ProceduralBoxOptions): THREE.BufferGeometry {
  return singleGeometry(options.materialRole, (writer) => writer.addBox(options));
}

export function createProceduralPrismGeometry(options: ProceduralPrismOptions): THREE.BufferGeometry {
  return singleGeometry(options.materialRole, (writer) => writer.addPrism(options));
}

export function createProceduralMemberGeometry(options: ProceduralMemberOptions): THREE.BufferGeometry {
  return singleGeometry(options.materialRole, (writer) => writer.addMember(options));
}

export function createProceduralRoofPanelGeometry(options: ProceduralRoofPanelOptions): THREE.BufferGeometry {
  return singleGeometry(options.materialRole, (writer) => writer.addRoofPanel(options));
}

function singleGeometry(
  role: ProceduralMaterialRole,
  emit: (writer: ProceduralGeometryWriter) => ProceduralGeometryWriter,
): THREE.BufferGeometry {
  const result = emit(new ProceduralGeometryWriter([role])).build();
  const slot = result.slots[0];
  if (!slot) throw new Error(`Procedural geometry writer emitted no ${role} geometry.`);
  return slot.geometry;
}

function compileSlotGeometry(slot: MutableSlot): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = `Procedural ${slot.materialRole} material slot`;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(slot.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(slot.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(slot.uvs, 2));
  geometry.setIndex(slot.indices);
  geometry.clearGroups();
  geometry.addGroup(0, slot.indices.length, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const policy = slot.definition.uvPolicy;
  geometry.userData.metricUvMeters = policy.metersPerRepeat[0];
  geometry.userData.proceduralGeometryWriter = PROCEDURAL_GEOMETRY_WRITER_VERSION;
  geometry.userData.proceduralMaterialRole = slot.materialRole;
  geometry.userData.proceduralMaterialSlot = slot.materialIndex;
  geometry.userData.proceduralPhysicalUv = {
    projection: policy.projection,
    uAxis: policy.uAxis,
    vAxis: policy.vAxis,
    metersPerRepeat: [...policy.metersPerRepeat],
    course: {
      ...policy.course,
      nominalHeightMeters: policy.course.nominalHeightMeters
        ? [...policy.course.nominalHeightMeters]
        : null,
    },
  };
  geometry.userData.proceduralGeometryDiagnostics = {
    indexed: true,
    hardEdgeFaceVertices: true,
    finalDimensionsBaked: true,
    materialRole: slot.materialRole,
    materialIndex: slot.materialIndex,
    atlasTiles: [...slot.definition.atlasTiles],
    sharedMaterialKeys: [...slot.definition.sharedMaterialKeys],
    sharedDetailMaterialKeys: [...slot.definition.sharedDetailMaterialKeys],
    primitiveCount: slot.primitives.length,
    triangleCount: slot.indices.length / 3,
    vertexCount: slot.positions.length / 3,
    primitives: slot.primitives.map(clonePrimitiveDiagnostic),
  };
  return geometry;
}

function appendQuad(
  slot: MutableSlot,
  corners: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  expectedNormal: THREE.Vector3,
  uvs: readonly [ProceduralPoint2, ProceduralPoint2, ProceduralPoint2, ProceduralPoint2],
): void {
  const normal = finiteUnitVector(expectedNormal, 'quad normal');
  assertTriangleArea(corners[0], corners[1], corners[2], 'quad first triangle');
  assertTriangleArea(corners[0], corners[2], corners[3], 'quad second triangle');
  const base = slot.positions.length / 3;
  for (let index = 0; index < 4; index += 1) {
    appendVertex(slot, corners[index]!, normal, uvs[index]!);
  }
  const winding = new THREE.Vector3().crossVectors(
    corners[1].clone().sub(corners[0]),
    corners[2].clone().sub(corners[0]),
  ).dot(normal);
  if (winding > 0) {
    slot.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    slot.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

function appendConvexPolygon(
  slot: MutableSlot,
  points: readonly THREE.Vector3[],
  expectedNormal: THREE.Vector3,
  uvs: readonly ProceduralPoint2[],
): void {
  const normal = finiteUnitVector(expectedNormal, 'polygon normal');
  if (points.length < 3 || points.length !== uvs.length) {
    throw new Error('Convex polygon requires matching point/UV arrays with at least three entries.');
  }
  const base = slot.positions.length / 3;
  for (let index = 0; index < points.length; index += 1) {
    appendVertex(slot, points[index]!, normal, uvs[index]!);
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[0]!;
    const b = points[index]!;
    const c = points[index + 1]!;
    assertTriangleArea(a, b, c, 'polygon triangle');
    const winding = new THREE.Vector3().crossVectors(
      b.clone().sub(a),
      c.clone().sub(a),
    ).dot(normal);
    if (winding > 0) slot.indices.push(base, base + index, base + index + 1);
    else slot.indices.push(base, base + index + 1, base + index);
  }
}

function appendVertex(
  slot: MutableSlot,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  uv: ProceduralPoint2,
): void {
  if (![point.x, point.y, point.z, normal.x, normal.y, normal.z, uv[0], uv[1]].every(Number.isFinite)) {
    throw new Error(`Procedural ${slot.materialRole} geometry contains a non-finite vertex.`);
  }
  slot.positions.push(point.x, point.y, point.z);
  slot.normals.push(normal.x, normal.y, normal.z);
  slot.uvs.push(uv[0], uv[1]);
}

function appendRoofEdge(
  slot: MutableSlot,
  corners: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3],
  panelCenter: THREE.Vector3,
  length: number,
  thickness: number,
  policy: ProceduralPhysicalUvPolicy,
  offset: ProceduralUvOffset,
): void {
  const faceCenter = corners.reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(0.25);
  const normal = new THREE.Vector3().crossVectors(
    corners[1].clone().sub(corners[0]),
    corners[2].clone().sub(corners[0]),
  ).normalize();
  if (normal.dot(faceCenter.clone().sub(panelCenter)) < 0) normal.negate();
  appendQuad(slot, corners, normal, uvRectangle(length, thickness, policy, offset));
}

function recordPrimitive(
  slot: MutableSlot,
  options: SemanticPrimitiveOptions,
  primitive: ProceduralPrimitiveDiagnostic['primitive'],
  dimensions: readonly number[],
  startIndex: number,
  frame: {
    readonly origin: THREE.Vector3;
    readonly uDirection: THREE.Vector3;
    readonly vDirection: THREE.Vector3;
  },
): void {
  const policy = slot.definition.uvPolicy;
  slot.primitives.push({
    primitive,
    semanticId: options.semanticId,
    ...(options.moduleId ? { moduleId: options.moduleId } : {}),
    materialRole: options.materialRole,
    structuralUse: options.structuralUse,
    dimensions: [...dimensions],
    triangleStart: startIndex / 3,
    triangleCount: (slot.indices.length - startIndex) / 3,
    uvFrame: {
      projection: policy.projection,
      uAxis: policy.uAxis,
      vAxis: policy.vAxis,
      origin: vectorTuple(frame.origin),
      uDirection: vectorTuple(finiteUnitVector(frame.uDirection, `${options.semanticId} U direction`)),
      vDirection: vectorTuple(finiteUnitVector(frame.vDirection, `${options.semanticId} V direction`)),
      metersPerRepeat: [...policy.metersPerRepeat],
      offsetMeters: uvOffsetMeters(options),
    },
  });
}

function clonePrimitiveDiagnostic(
  primitive: ProceduralPrimitiveDiagnostic,
): ProceduralPrimitiveDiagnostic {
  return {
    ...primitive,
    dimensions: [...primitive.dimensions],
    uvFrame: {
      ...primitive.uvFrame,
      origin: [...primitive.uvFrame.origin],
      uDirection: [...primitive.uvFrame.uDirection],
      vDirection: [...primitive.uvFrame.vDirection],
      metersPerRepeat: [...primitive.uvFrame.metersPerRepeat],
      offsetMeters: [...primitive.uvFrame.offsetMeters],
    },
  };
}

function uvRectangle(
  widthMeters: number,
  heightMeters: number,
  policy: ProceduralPhysicalUvPolicy,
  offset: ProceduralUvOffset,
): readonly [ProceduralPoint2, ProceduralPoint2, ProceduralPoint2, ProceduralPoint2] {
  return [
    physicalUv(0, 0, policy, offset),
    physicalUv(widthMeters, 0, policy, offset),
    physicalUv(widthMeters, heightMeters, policy, offset),
    physicalUv(0, heightMeters, policy, offset),
  ];
}

function physicalUv(
  uMeters: number,
  vMeters: number,
  policy: ProceduralPhysicalUvPolicy,
  offset: ProceduralUvOffset,
): ProceduralPoint2 {
  return [
    (uMeters + offset[0]) / policy.metersPerRepeat[0],
    (vMeters + offset[1]) / policy.metersPerRepeat[1],
  ];
}

function uvOffsetMeters(options: SemanticPrimitiveOptions): ProceduralUvOffset {
  const offset = options.uvOffsetMeters ?? [0, 0];
  if (!offset.every(Number.isFinite)) {
    throw new Error(`${options.semanticId} UV offset must be finite.`);
  }
  return [offset[0], offset[1]];
}

function materialRoleDefinition(role: ProceduralMaterialRole): ProceduralMaterialRoleDefinition {
  const definition = (PROCEDURAL_MATERIAL_ROLE_REGISTRY as Record<
    string,
    ProceduralMaterialRoleDefinition | undefined
  >)[role];
  if (!definition) throw new Error(`Unknown procedural material role ${role}.`);
  return definition;
}

function validateStructuralUse(
  options: SemanticPrimitiveOptions,
  definition: ProceduralMaterialRoleDefinition,
): void {
  if (definition.prohibitedUses.includes(options.structuralUse)) {
    throw new Error(`${options.materialRole} prohibits structural use ${options.structuralUse}.`);
  }
  if (!definition.historicallyPermittedUses.includes(options.structuralUse)) {
    throw new Error(`${options.materialRole} does not permit structural use ${options.structuralUse}.`);
  }
}

function assertIsotropicRepeatForAddMesh(
  role: ProceduralMaterialRole,
  policy: ProceduralPhysicalUvPolicy,
): void {
  const [uRepeat, vRepeat] = policy.metersPerRepeat;
  positiveDimension(uRepeat, `${role} U repeat`);
  positiveDimension(vRepeat, `${role} V repeat`);
  if (Math.abs(uRepeat - vRepeat) > GEOMETRY_EPSILON) {
    throw new Error(`${role} uses anisotropic repeats that existing addMesh cannot preserve.`);
  }
}

function assertSemanticId(value: string): void {
  if (value.trim().length === 0) throw new Error('Procedural primitive semanticId cannot be empty.');
}

function validatedConvexProfile(
  input: readonly ProceduralPoint2[],
  semanticId: string,
): ProceduralPoint2[] {
  if (input.length < 3) throw new Error(`${semanticId} prism profile requires at least three points.`);
  const profile = input.map(([x, y], index): ProceduralPoint2 => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`${semanticId} prism profile point ${index} must be finite.`);
    }
    return [x, y];
  });
  let signedArea = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const current = profile[index]!;
    const next = profile[(index + 1) % profile.length]!;
    if (Math.hypot(next[0] - current[0], next[1] - current[1]) <= GEOMETRY_EPSILON) {
      throw new Error(`${semanticId} prism profile contains a degenerate edge.`);
    }
    signedArea += current[0] * next[1] - next[0] * current[1];
  }
  if (Math.abs(signedArea) <= GEOMETRY_EPSILON) {
    throw new Error(`${semanticId} prism profile has zero area.`);
  }
  if (signedArea < 0) profile.reverse();
  let turnSign = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const a = profile[index]!;
    const b = profile[(index + 1) % profile.length]!;
    const c = profile[(index + 2) % profile.length]!;
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn) <= GEOMETRY_EPSILON) {
      throw new Error(`${semanticId} prism profile contains collinear edges.`);
    }
    const sign = Math.sign(turn);
    if (turnSign !== 0 && sign !== turnSign) {
      throw new Error(`${semanticId} prism profile must be convex.`);
    }
    turnSign = sign;
  }
  return profile;
}

function finitePoint3(value: ProceduralPoint3, label: string): THREE.Vector3 {
  const point = value instanceof THREE.Vector3
    ? value.clone()
    : new THREE.Vector3(value[0], value[1], value[2]);
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new Error(`${label} must be finite.`);
  }
  return point;
}

function finiteUnitVector(value: THREE.Vector3, label: string): THREE.Vector3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${label} must be finite.`);
  }
  const length = positiveDimension(value.length(), `${label} length`);
  return value.clone().multiplyScalar(1 / length);
}

function positiveDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= GEOMETRY_EPSILON) {
    throw new Error(`${label} must be finite and greater than ${GEOMETRY_EPSILON}.`);
  }
  return value;
}

function assertTriangleArea(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  label: string,
): void {
  const twiceArea = new THREE.Vector3().crossVectors(
    b.clone().sub(a),
    c.clone().sub(a),
  ).length();
  if (!Number.isFinite(twiceArea) || twiceArea <= GEOMETRY_EPSILON) {
    throw new Error(`${label} is degenerate.`);
  }
}

function leastAlignedAxis(direction: THREE.Vector3): THREE.Vector3 {
  const candidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  return candidates.sort((left, right) =>
    Math.abs(left.dot(direction)) - Math.abs(right.dot(direction)))[0]!.clone();
}

function vectorTuple(vector: THREE.Vector3): readonly [number, number, number] {
  return [vector.x, vector.y, vector.z];
}
