import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PLAYABLE_MAP_BOUNDARY_PARAMETERS,
  PlayableMapBoundary,
  playableMapBoundaryVisibilityAtDistance,
  playableMapBoundaryVisibilityAtZoom,
} from '../src/terrain/PlayableMapBoundary.ts';
import { BASELINE_ORBIT_DISTANCE } from '../src/camera/CameraCurves.ts';
import { MAP_SIZE_PRESETS } from '../src/world/worldGenerationSettings.ts';

const HALF_EXTENT = 40;
const terrainHeight = (x: number, z: number) => x * 0.03 + z * 0.015;
const boundary = new PlayableMapBoundary({
  bounds: {
    minX: -HALF_EXTENT,
    maxX: HALF_EXTENT,
    minZ: -HALF_EXTENT,
    maxZ: HALF_EXTENT,
  },
  getHeightAt: terrainHeight,
});

const positions = boundary.mesh.geometry.getAttribute('position');
const index = boundary.mesh.geometry.getIndex();
assert.ok(index, 'the boundary must be indexed');
assert.equal(positions.count % 2, 0, 'every perimeter sample needs an outer/inner pair');
assert.equal(index.count / 3, positions.count, 'the closed strip needs two triangles per pair');

for (let vertex = 0; vertex < positions.count; vertex += 2) {
  const outerX = positions.getX(vertex);
  const outerY = positions.getY(vertex);
  const outerZ = positions.getZ(vertex);
  const innerX = positions.getX(vertex + 1);
  const innerY = positions.getY(vertex + 1);
  const innerZ = positions.getZ(vertex + 1);
  const centerX = (outerX + innerX) * 0.5;
  const centerZ = (outerZ + innerZ) * 0.5;

  assert.ok(
    Math.abs(Math.max(Math.abs(centerX), Math.abs(centerZ)) - HALF_EXTENT) < 1e-5,
    'the ribbon centreline must coincide with the exact playable boundary',
  );
  assert.ok(
    Math.abs(outerY - terrainHeight(outerX, outerZ)
      - PLAYABLE_MAP_BOUNDARY_PARAMETERS.terrainLift) < 1e-5,
    'the outer contour must follow terrain height',
  );
  assert.ok(
    Math.abs(innerY - terrainHeight(innerX, innerZ)
      - PLAYABLE_MAP_BOUNDARY_PARAMETERS.terrainLift) < 1e-5,
    'the inner contour must follow terrain height',
  );
}

const material = boundary.mesh.material;
assert.equal(material.transparent, true);
assert.equal(material.depthTest, true, 'the boundary must not show through intervening hills');
assert.equal(material.depthWrite, false, 'the translucent boundary must not occlude later visuals');
assert.equal(material.toneMapped, false, 'the strategic red must stay legible across exposure changes');
assert.equal(boundary.mesh.castShadow, false);
assert.equal(boundary.mesh.receiveShadow, false);

assert.equal(playableMapBoundaryVisibilityAtZoom(30), 1);
assert.equal(playableMapBoundaryVisibilityAtZoom(55), 1);
assert.ok(
  Math.abs(playableMapBoundaryVisibilityAtZoom(71.5) - 0.5) < 1e-6,
  'the fade midpoint must be smooth and predictable',
);
assert.equal(playableMapBoundaryVisibilityAtZoom(88), 0);
assert.equal(playableMapBoundaryVisibilityAtZoom(100), 0);
assert.equal(playableMapBoundaryVisibilityAtZoom(30, true), 0);

boundary.update(BASELINE_ORBIT_DISTANCE / 0.3, false);
assert.equal(boundary.mesh.visible, true);
assert.equal(
  boundary.mesh.material.opacity,
  PLAYABLE_MAP_BOUNDARY_PARAMETERS.maximumOpacity,
);
assert.equal(playableMapBoundaryVisibilityAtDistance(BASELINE_ORBIT_DISTANCE, false), 0);
boundary.update(BASELINE_ORBIT_DISTANCE, false);
assert.equal(boundary.mesh.visible, false);
assert.equal(boundary.mesh.material.opacity, 0);

const diagnostics = boundary.getDiagnostics();
assert.equal(diagnostics.drawCalls, 0, 'a hidden close-zoom boundary must submit no draw call');
assert.ok(diagnostics.vertexCount > 0);
assert.ok(
  diagnostics.triangleCount <= PLAYABLE_MAP_BOUNDARY_PARAMETERS.maximumTriangles,
  `boundary exceeded its triangle budget: ${diagnostics.triangleCount}`,
);

boundary.update(BASELINE_ORBIT_DISTANCE / 0.3, false);
assert.equal(boundary.getDiagnostics().drawCalls, 1, 'the overview boundary must remain one draw call');
boundary.dispose();

for (const preset of Object.values(MAP_SIZE_PRESETS)) {
  const presetBoundary = new PlayableMapBoundary({
    bounds: {
      minX: -preset.playableHalf,
      maxX: preset.playableHalf,
      minZ: -preset.playableHalf,
      maxZ: preset.playableHalf,
    },
    getHeightAt: () => 0,
  });
  const presetDiagnostics = presetBoundary.getDiagnostics();
  assert.ok(
    presetDiagnostics.width >= PLAYABLE_MAP_BOUNDARY_PARAMETERS.minimumWidth
      && presetDiagnostics.width <= PLAYABLE_MAP_BOUNDARY_PARAMETERS.maximumWidth,
    `${preset.label} boundary width must stay within the authored visual range`,
  );
  assert.ok(
    presetDiagnostics.triangleCount <= PLAYABLE_MAP_BOUNDARY_PARAMETERS.maximumTriangles,
    `${preset.label} boundary exceeded its triangle budget: ${presetDiagnostics.triangleCount}`,
  );
  presetBoundary.dispose();
}

console.log('Playable map boundary checks passed.');
