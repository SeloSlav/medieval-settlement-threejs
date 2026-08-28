import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  bulkStockpileVisualSignature,
  syncBulkStockpileVisuals,
} from '../src/buildings/bulkStockpileVisuals.ts';
import { clayDepositNodeId } from '../src/clay/ClayDepositLayout.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  createMineralDepositRoster,
  mineralDepositLabel,
  mineralDepositMaxYield,
  mineralDepositNodeId,
} from '../src/minerals/MineralDepositLayout.ts';
import { createMineralDepositSystem } from '../src/minerals/MineralDepositSystem.ts';
import {
  BUILDING_STORAGE_CAPS,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
  MINE_CLAY_PER_CYCLE,
  MINE_IRON_PER_CYCLE,
  MINE_SALT_PER_CYCLE,
  MINE_TIMBER_SUPPORT_BUFFER_CYCLES,
  MINE_TIMBER_SUPPORT_PER_CYCLE,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  LARGE_QUARRY_SUPPORT_TARGET,
} from '../src/economy/largeQuarrySupportPolicy.ts';
import {
  RICH_MINE_SUPPORT_TARGET,
  richMineSupportRunwayCycles,
  richMineSupportsReady,
} from '../src/economy/mineSupportPolicy.ts';
import {
  IRON_ICON_HTML,
  SALT_ICON_HTML,
} from '../src/map/resourceMapIconArt.ts';
import {
  describeGeologicalMapMarker,
  geologicalNodeForMapMarker,
  LOW_GEOLOGICAL_RESERVE_SHARE,
} from '../src/map/geologicalMapMarkerState.ts';
import { buildLayoutWorldMapMarkers } from '../src/map/worldMapMarkers.ts';
import { renderMineralMineInspector } from '../src/resources/inspector/mineralMineRenderer.ts';
import { renderLargeQuarryInspector } from '../src/resources/inspector/largeQuarryRenderer.ts';
import { renderStoneQuarryInspector } from '../src/resources/inspector/stoneQuarryRenderer.ts';
import type { InspectorRenderContext } from '../src/resources/inspector/renderInspectableTarget.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { findNearestResourceNodeWithRemaining } from '../src/resources/depletableNodes.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResourceNodeState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  deriveSubSeed,
  resolveWorldDimensions,
  type WorldGenerationSettings,
  type WorldMapSize,
} from '../src/world/worldGenerationSettings.ts';
import { applyTerrainPreset } from '../src/world/worldTerrainPresets.ts';
import { computeWorldBootstrapDataFromLayout } from '../src/world/worldBootstrapData.ts';

const mapSizes: WorldMapSize[] = ['small', 'medium', 'large'];
for (const mapSize of mapSizes) {
  for (const seed of [1, 7, 31]) {
    const settings = worldSettings({ mapSize, seed });
    const layout = createWorldLayout(settings);
    const expectedRich = layout.resourcePlan.richMineralDepositCount;
    const expectedTotal = expectedRich + layout.resourcePlan.ordinaryMineralDepositCount;
    const dims = resolveWorldDimensions(mapSize);

    assert.equal(
      layout.mineralDepositLayout.sites.length,
      expectedTotal,
      `${mapSize}/seed-${seed} must place its full underground-resource budget`,
    );
    assert.equal(
      layout.mineralDepositLayout.sites.filter((site) => site.grade === 'rich').length,
      expectedRich,
      `${mapSize}/seed-${seed} must preserve its seeded rich-deposit count`,
    );
    assert.deepEqual(
      new Set(layout.mineralDepositLayout.sites.map((site) => site.resource)),
      new Set(['iron', 'salt']),
      `${mapSize}/seed-${seed} must expose physical deposits of both materials`,
    );
    for (const site of layout.mineralDepositLayout.sites) {
      assert.ok(site.resource === 'iron' || site.resource === 'salt');
      assert.equal(
        layout.riverLayout.isWaterAt(site.x, site.z),
        false,
        `${mineralDepositLabel(site)} cannot spawn in open water`,
      );
      assert.ok(Math.abs(site.x) < dims.playableHalf);
      assert.ok(Math.abs(site.z) < dims.playableHalf);
    }
  }
}

const delniceMinerals = createWorldLayout(applyTerrainPreset(
  worldSettings({ seed: 0x4310_4d21 }),
  'delnice_meadow',
));
assert.ok(
  delniceMinerals.mineralDepositLayout.sites
    .filter((site) => site.resource === 'salt')
    .every((site) => site.formation === 'dry_basin_evaporite'),
  'waterless maps must place salt as ancient inland-basin evaporites',
);

const vinodolMinerals = createWorldLayout(applyTerrainPreset(
  worldSettings({ seed: 0x5600_7a13 }),
  'vinodol_coast',
));
const coastalSaltSites = vinodolMinerals.mineralDepositLayout.sites.filter(
  (site) => site.resource === 'salt',
);
assert.ok(coastalSaltSites.length > 0);
assert.ok(
  coastalSaltSites.every((site) => {
    const shoreX = vinodolMinerals.riverLayout.getCoastalShoreX(site.z);
    return site.formation === 'coastal_evaporite'
      && shoreX !== null
      && site.x > shoreX
      && site.x - shoreX <= 100;
  }),
  'coastal salt must occupy the dry shore shelf close to saline water',
);

const kupaMinerals = createWorldLayout(applyTerrainPreset(
  worldSettings({ seed: 0x6b70_6c17 }),
  'kupa_valley',
));
assert.ok(
  kupaMinerals.mineralDepositLayout.sites
    .filter((site) => site.resource === 'salt')
    .every((site) => site.formation === 'rock_salt'),
  'freshwater maps must use geological rock salt rather than riverbank evaporites',
);
assert.ok(
  kupaMinerals.mineralDepositLayout.sites
    .filter((site) => site.resource === 'iron')
    .every((site) => site.formation === 'bedrock'),
);

const mineralVisualLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
const mineralVisualSystem = createMineralDepositSystem(
  { getHeightAt: () => 0 } as Parameters<typeof createMineralDepositSystem>[0],
  mineralVisualLayout.mineralDepositLayout,
);
for (const resource of ['iron', 'salt'] as const) {
  const outcrops: THREE.Mesh[] = [];
  mineralVisualSystem.group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith(`${resource} outcrop`)) {
      outcrops.push(object);
    }
  });
  assert.ok(
    outcrops.length >= 10,
    `${resource} deposits must include a readable cluster of close-range 3D outcrops`,
  );
  assert.ok(
    outcrops.every(
      (outcrop) => {
        outcrop.geometry.computeBoundingBox();
        const top = outcrop.geometry.boundingBox?.max.y ?? 0;
        return outcrop.position.y + top * outcrop.scale.y > 0
          && outcrop.receiveShadow;
      },
    ),
    `${resource} outcrops must break the terrain plane and receive scene shadows`,
  );
  assert.ok(
    outcrops.every((outcrop) => {
      const material = outcrop.material as THREE.MeshStandardMaterial;
      return material.map instanceof THREE.DataTexture
        && material.normalMap instanceof THREE.DataTexture
        && material.roughnessMap instanceof THREE.DataTexture
        && material.map.magFilter === THREE.LinearFilter
        && material.map.minFilter === THREE.LinearMipmapLinearFilter
        && material.map.generateMipmaps
        && material.normalMap.magFilter === THREE.LinearFilter
        && material.normalMap.minFilter === THREE.LinearMipmapLinearFilter
        && material.normalMap.generateMipmaps
        && material.roughnessMap.magFilter === THREE.LinearFilter
        && material.roughnessMap.minFilter === THREE.LinearMipmapLinearFilter
        && material.roughnessMap.generateMipmaps
        && material.roughness >= 0.94
        && material.metalness === 0
        && material.vertexColors
        && Math.abs(material.normalScale.x - (resource === 'iron' ? 0.55 : 0.42)) < 1e-9
        && Math.abs(material.normalScale.y - (resource === 'iron' ? 0.55 : 0.42)) < 1e-9
        && material.userData.weatheredMineralSurface?.static === true
        && material.userData.weatheredMineralSurface?.mipReadable === true
        && material.userData.weatheredMineralSurface?.surfaceGrammar === 'scattered-weathered-outcrops'
        && material.userData.weatheredMineralSurface?.planeWeathering === (
          resource === 'iron'
            ? 'patchy-host-rock-oxidation'
            : 'fissured-stratified-salt'
        )
        && material.userData.weatheredMineralSurface?.revision === 'mineral-weathering-v13';
    }),
    `${resource} outcrops must use the quarry's matte material response with restrained normals`,
  );
  assert.equal(
    new Set(outcrops.map((outcrop) => (outcrop.material as THREE.MeshStandardMaterial).map)).size,
    1,
    `${resource} outcrops must share one bounded weathering texture rather than allocate per stone`,
  );
  const materialSet = new Set(
    outcrops.map((outcrop) => outcrop.material as THREE.MeshStandardMaterial),
  );
  const representativeMaterial = [...materialSet][0];
  const texture = representativeMaterial?.map as THREE.DataTexture;
  assert.equal(
    texture.image.width * texture.image.height,
    64 * 64,
    `${resource} weathering texture memory must stay at the bounded 64px profile`,
  );
  const textureProfile = measureWeatheringTexture(texture);
  const normalData = (
    (representativeMaterial.normalMap as THREE.DataTexture).image.data as Uint8Array
  );
  let maximumNormalSlope = 0;
  for (let offset = 0; offset < normalData.length; offset += 4) {
    const normalX = normalData[offset] / 255 * 2 - 1;
    const normalY = normalData[offset + 1] / 255 * 2 - 1;
    maximumNormalSlope = Math.max(maximumNormalSlope, Math.hypot(normalX, normalY));
  }
  assert.ok(
    maximumNormalSlope <= 0.24,
    `${resource} normal map must remain subordinate to the boulder silhouette, got ${maximumNormalSlope.toFixed(3)}`,
  );
  const roughnessData = (
    (representativeMaterial.roughnessMap as THREE.DataTexture).image.data as Uint8Array
  );
  let minimumRoughness = 255;
  for (let offset = 0; offset < roughnessData.length; offset += 4) {
    minimumRoughness = Math.min(minimumRoughness, roughnessData[offset]);
  }
  assert.ok(
    minimumRoughness / 255 >= 0.88,
    `${resource} roughness map must stay matte throughout, got ${(minimumRoughness / 255).toFixed(3)}`,
  );
  const minimumLuminanceRange = resource === 'iron' ? 0.16 : 0.1;
  assert.ok(
    textureProfile.luminanceRange >= minimumLuminanceRange
      && textureProfile.luminanceRange <= (resource === 'iron' ? 0.36 : 0.34),
    `${resource} albedo needs camera-readable but rock-like mottling, got ${textureProfile.luminanceRange.toFixed(3)}`,
  );
  const minimumChannelRange = resource === 'iron' ? 0.15 : 0.1;
  assert.ok(
    textureProfile.channelRanges.every(
      (range) => range >= minimumChannelRange && range <= (resource === 'iron' ? 0.48 : 0.38),
    ),
    `${resource} weathering must remain readable without harsh cavity contrast, got ${textureProfile.channelRanges.map((range) => range.toFixed(3)).join('/')}`,
  );
  const minimumChromaRange = resource === 'iron' ? 0.1 : 0.012;
  const maximumChromaRange = resource === 'iron' ? 0.4 : 0.09;
  assert.ok(
    textureProfile.chromaRange >= minimumChromaRange
      && textureProfile.chromaRange <= maximumChromaRange,
    `${resource} needs restrained resource-specific staining, got chroma range ${textureProfile.chromaRange.toFixed(3)}`,
  );
  const minimumFineContrast = resource === 'iron' ? 0.004 : 0.003;
  const maximumFineContrast = resource === 'iron' ? 0.026 : 0.022;
  const minimumBroadContrast = resource === 'iron' ? 0.025 : 0.018;
  const maximumBroadContrast = resource === 'iron' ? 0.09 : 0.07;
  const minimumScaleSeparation = 1.5;
  assert.ok(
    textureProfile.fineContrast >= minimumFineContrast
      && textureProfile.fineContrast <= maximumFineContrast
      && textureProfile.broadContrast >= minimumBroadContrast
      && textureProfile.broadContrast <= maximumBroadContrast
      && textureProfile.broadContrast / textureProfile.fineContrast >= minimumScaleSeparation,
    `${resource} weathering must retain fine inclusions beneath broader clouds, got ${textureProfile.fineContrast.toFixed(3)}/${textureProfile.broadContrast.toFixed(3)}`,
  );
  assert.ok(
    Math.abs(textureProfile.contactDarkening) <= 0.035,
    `${resource} texture must not encode a horizontal contact band, got ${textureProfile.contactDarkening.toFixed(3)}`,
  );
  assert.ok(
    textureProfile.gradientAxisRatio >= 0.5 && textureProfile.gradientAxisRatio <= 1.7,
    `${resource} weathering must not collapse into directional contour bands, got axis ratio ${textureProfile.gradientAxisRatio.toFixed(3)}`,
  );
  assert.ok(
    textureProfile.strongestShiftCorrelation <= 0.88,
    `${resource} weathering must avoid repeated horizontal, vertical, or diagonal motifs, got correlation ${textureProfile.strongestShiftCorrelation.toFixed(3)}`,
  );
  assert.ok(
    textureProfile.dominantGradientDirectionShare <= 0.28,
    `${resource} weathering must distribute scar and pit edges across nonparallel directions, got dominant share ${textureProfile.dominantGradientDirectionShare.toFixed(3)}`,
  );
  assert.ok(
    textureProfile.localContrastVariation >= 0.12
      && textureProfile.localContrastVariation <= 0.9,
    `${resource} weathering must concentrate subtle inclusions in bounded local regions, got tile variation ${textureProfile.localContrastVariation.toFixed(3)}`,
  );
  const mipProfile = measureBoxFilteredTexture(texture, 4);
  assert.ok(
    mipProfile.luminanceRange >= (resource === 'iron' ? 0.13 : 0.08)
      && mipProfile.luminanceRange <= (resource === 'iron' ? 0.32 : 0.24)
      && mipProfile.adjacentContrast >= (resource === 'iron' ? 0.015 : 0.01)
      && mipProfile.adjacentContrast <= (resource === 'iron' ? 0.05 : 0.04),
    `${resource} mottling must remain camera-readable after a 4x mip reduction without becoming harsh, got ${mipProfile.luminanceRange.toFixed(3)}/${mipProfile.adjacentContrast.toFixed(3)}`,
  );
  assert.ok(
    mipProfile.chromaRange >= (resource === 'iron' ? 0.08 : 0.01)
      && mipProfile.chromaRange <= (resource === 'iron' ? 0.38 : 0.08),
    `${resource} mineral coloration must survive a 4x mip reduction, got ${mipProfile.chromaRange.toFixed(3)}`,
  );
  const paletteLuminance = [...materialSet].map((material) => {
    const color = material.color;
    return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  });
  assert.ok(
    resource === 'iron'
      ? Math.max(...paletteLuminance) <= 0.3
      : Math.min(...paletteLuminance) >= 0.5
        && Math.max(...paletteLuminance) >= 0.78,
    `${resource} palette must remain natural host rock or visibly pale salt`,
  );
  assert.ok(
    outcrops.every((outcrop) => {
      outcrop.geometry.computeBoundingBox();
      const bottom = outcrop.geometry.boundingBox?.min.y ?? 0;
      return outcrop.position.y + bottom * outcrop.scale.y <= 0.08
        && outcrop.userData.mineralSurface?.grounded === true;
    }),
    `${resource} outcrops must bury their broadened base into the terrain instead of floating`,
  );
  const worldWidths = outcrops.map((outcrop) => {
    outcrop.geometry.computeBoundingBox();
    const box = outcrop.geometry.boundingBox!;
    return Math.max(
      (box.max.x - box.min.x) * outcrop.scale.x,
      (box.max.z - box.min.z) * outcrop.scale.z,
    );
  });
  assert.ok(
    outcrops.every(
      (outcrop) => outcrop.userData.mineralSurface?.formation === (
        resource === 'iron' ? 'oxide-mottled-host-rock' : 'matte-salt-host-rock'
      ),
    ),
    `${resource} outcrops must retain their resource-specific static formation profile`,
  );
  assert.ok(
    outcrops.every(
      (outcrop) => outcrop.userData.mineralSurface?.hierarchyRole === 'scattered-outcrop'
        && outcrop.userData.mineralSurface?.continuousParentGeometry === true
        && outcrop.userData.mineralSurface?.attachedToAnchor === false,
    ),
    `${resource} deposits must be made from independent scattered outcrops`,
  );
  assert.ok(
    Math.max(...worldWidths) / Math.min(...worldWidths) <= 5,
    `${resource} deposits must not collapse into one giant anchor surrounded by invisible chips`,
  );
  for (const parent of new Set(outcrops.map((outcrop) => outcrop.parent))) {
    const clusterOutcrops = outcrops.filter((outcrop) => outcrop.parent === parent);
    const alongShares = clusterOutcrops.map(
      (outcrop) => outcrop.userData.mineralSurface?.formationAlongShare as number,
    );
    const crossShares = clusterOutcrops.map(
      (outcrop) => outcrop.userData.mineralSurface?.formationCrossShare as number,
    );
    const radialShares = alongShares.map((along, index) => Math.hypot(along, crossShares[index]));
    const occupiedQuadrants = new Set(clusterOutcrops.map((outcrop) => {
      const along = outcrop.userData.mineralSurface?.formationAlongShare as number;
      const cross = outcrop.userData.mineralSurface?.formationCrossShare as number;
      return `${along >= 0 ? '+' : '-'}${cross >= 0 ? '+' : '-'}`;
    }));
    assert.ok(
      Math.max(...alongShares) - Math.min(...alongShares) >= 0.75
        && Math.max(...crossShares) - Math.min(...crossShares) >= 0.6
        && Math.max(...radialShares) >= 0.55
        && occupiedQuadrants.size >= 3,
      `${resource} outcrops must visibly scatter across the deposit footprint`,
    );
    assert.ok(
      clusterOutcrops.every((outcrop) => {
        const dimensions = worldDimensions(outcrop);
        const bottom = outcrop.geometry.boundingBox!.min.y * outcrop.scale.y + outcrop.position.y;
        const top = outcrop.geometry.boundingBox!.max.y * outcrop.scale.y + outcrop.position.y;
        const burialShare = -bottom / dimensions.height;
        return connectedTriangleComponentCount(outcrop.geometry) === 1
          && bottom <= -0.01
          && top > 0.1
          && burialShare >= 0.12
          && burialShare <= 0.42;
      }),
      `${resource} scattered outcrops must remain continuous, visible, and grounded`,
    );
  }
}
const mineralShadowBatches: THREE.InstancedMesh[] = [];
mineralVisualSystem.group.traverse((object) => {
  const mesh = object as THREE.InstancedMesh;
  if (
    mesh.isInstancedMesh
    && mesh.userData.staticInstancedShadowBatch === true
    && mesh.castShadow
  ) mineralShadowBatches.push(mesh);
});
assert.ok(
  mineralShadowBatches.length > 0,
  'mineral outcrop geometry must retain exact instanced scene-shadow submissions',
);
const mineralOutcrops: THREE.Mesh[] = [];
mineralVisualSystem.group.traverse((object) => {
  if (object instanceof THREE.Mesh && object.name.includes('outcrop')) mineralOutcrops.push(object);
});
assert.equal(
  mineralOutcrops.length,
  mineralVisualLayout.mineralDepositLayout.sites.reduce(
    (count, site) => count + (site.grade === 'rich' ? 18 : 10),
    0,
  ),
  'weathering and contact debris must not add meshes or draw calls',
);
assert.equal(
  new Set(mineralOutcrops.map((outcrop) => outcrop.geometry)).size,
  6,
  'resource-specific face colors must use exactly three continuous shared-structure variants each',
);
const mineralGeometries = [...new Set(mineralOutcrops.map((outcrop) => outcrop.geometry))];
const weatheredMineralGeometries = mineralGeometries.filter(
  (geometry) => geometry.userData.mineralGeometry?.profile === 'continuous-quarry-outcrop',
);
assert.equal(weatheredMineralGeometries.length, 6);
assert.ok(
  weatheredMineralGeometries.every(
    (geometry) => geometry.getIndex() === null
      && geometry.getAttribute('position')?.count === 540,
  ),
  'the six resource-colored continuous quarry outcrops must stay at exactly 180 triangles each',
);
assert.ok(
  mineralGeometries.every(
    (geometry) => geometry.userData.mineralGeometry?.deformation === 'continuous-quarry-v3',
  ),
  'all mineral silhouettes must use the same continuous quarry deformation contract',
);
assert.ok(
  weatheredMineralGeometries.every((geometry) => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uniqueHeights = new Set<number>();
    for (let index = 0; index < position.count; index++) {
      uniqueHeights.add(Math.round(position.getY(index) * 10_000));
    }
    return uniqueHeights.size >= 35;
  }),
  'continuous quarry deformation must retain varied vertex heights instead of quantized shelves',
);
assert.ok(
  mineralOutcrops.every(
    (outcrop) => (outcrop.geometry.getAttribute('position')?.count ?? 0) > 100
      && outcrop.geometry.getAttribute('uv') !== undefined
      && outcrop.geometry.getAttribute('color') !== undefined,
  ),
  'weathered outcrops need static silhouette, UV, and plane-color breakup',
);
const quarryGeometriesByResource = Object.fromEntries(
  (['iron', 'salt'] as const).map((resource) => [
    resource,
    weatheredMineralGeometries
      .filter((geometry) => geometry.userData.mineralGeometry?.resource === resource)
      .sort(
        (a, b) => a.userData.mineralGeometry.structureSeed
          - b.userData.mineralGeometry.structureSeed,
      ),
  ]),
) as Record<'iron' | 'salt', THREE.BufferGeometry[]>;
assert.equal(quarryGeometriesByResource.iron.length, 3);
assert.equal(quarryGeometriesByResource.salt.length, 3);
for (let variant = 0; variant < 3; variant++) {
  const ironGeometry = quarryGeometriesByResource.iron[variant];
  const saltGeometry = quarryGeometriesByResource.salt[variant];
  assert.equal(
    ironGeometry.getAttribute('position'),
    saltGeometry.getAttribute('position'),
    'resource-colored variants must share the exact structural position buffer',
  );
  assert.equal(ironGeometry.getAttribute('normal'), saltGeometry.getAttribute('normal'));
  assert.equal(ironGeometry.getAttribute('uv'), saltGeometry.getAttribute('uv'));
  assert.notEqual(
    ironGeometry.getAttribute('color'),
    saltGeometry.getAttribute('color'),
    'iron oxidation and salt fissuring need distinct static color fields',
  );
}
for (const geometry of mineralGeometries) {
  const color = geometry.getAttribute('color') as THREE.BufferAttribute;
  const resource = geometry.userData.mineralGeometry?.resource as 'iron' | 'salt';
  assert.ok(
    color.array instanceof Uint8Array
      && color.normalized
      && color.itemSize === 3
      && color.count === geometry.getAttribute('position').count,
    `${resource} plane weathering must use one bounded normalized RGB8 color per vertex`,
  );
  const faceColors = new Set<string>();
  let minimumLuminance = Number.POSITIVE_INFINITY;
  let maximumLuminance = Number.NEGATIVE_INFINITY;
  let minimumChroma = Number.POSITIVE_INFINITY;
  let maximumChroma = Number.NEGATIVE_INFINITY;
  for (let face = 0; face < color.count; face += 3) {
    assert.deepEqual(
      [color.getX(face), color.getY(face), color.getZ(face)],
      [color.getX(face + 1), color.getY(face + 1), color.getZ(face + 1)],
      'weathering colors must remain constant across each geological plane',
    );
    assert.deepEqual(
      [color.getX(face), color.getY(face), color.getZ(face)],
      [color.getX(face + 2), color.getY(face + 2), color.getZ(face + 2)],
      'weathering colors must remain constant across each geological plane',
    );
    const red = color.getX(face);
    const green = color.getY(face);
    const blue = color.getZ(face);
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const chroma = red - blue;
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
    minimumChroma = Math.min(minimumChroma, chroma);
    maximumChroma = Math.max(maximumChroma, chroma);
    faceColors.add(`${color.getX(face)}/${color.getY(face)}/${color.getZ(face)}`);
  }
  const faceCount = color.count / 3;
  assert.ok(
    faceColors.size / faceCount >= (resource === 'iron' ? 0.75 : 0.72),
    `${resource} plane field must remain nonrepeating across the silhouette, got ${(faceColors.size / faceCount).toFixed(3)}`,
  );
  const luminanceRange = maximumLuminance - minimumLuminance;
  const chromaRange = maximumChroma - minimumChroma;
  assert.ok(
    resource === 'iron'
      ? luminanceRange >= 0.15 && luminanceRange <= 0.23
        && chromaRange >= 0.4 && chromaRange <= 0.55
      : luminanceRange >= 0.22 && luminanceRange <= 0.35
        && chromaRange >= 0.01 && chromaRange <= 0.06,
    `${resource} plane colors need bounded camera-scale host-rock breakup, got ${luminanceRange.toFixed(3)}/${chromaRange.toFixed(3)}`,
  );
  assert.equal(
    geometry.userData.mineralGeometry?.surfaceColorProfile,
    resource === 'iron'
      ? 'patchy-host-rock-oxidation'
      : 'fissured-stratified-salt',
  );
}
assert.ok(
  mineralOutcrops.every(
    (outcrop) => outcrop.userData.mineralSurface?.geometryProfile === 'continuous-quarry-outcrop',
  ),
  'iron and salt must use only continuous quarry outcrops without a cleaved-salt special form',
);
const renderedMineralTriangles = mineralOutcrops.reduce(
  (triangles, outcrop) => triangles + outcrop.geometry.getAttribute('position').count / 3,
  0,
);
assert.ok(
  renderedMineralTriangles === mineralOutcrops.length * 180,
  'the natural formation must retain the existing 180-triangle quarry silhouette budget per draw',
);
const structuralAttributeArrays = new Set<ArrayLike<number>>();
for (const geometry of mineralGeometries) {
  for (const name of ['position', 'normal', 'uv']) {
    structuralAttributeArrays.add(geometry.getAttribute(name).array);
  }
}
const residentGeometryAttributeBytes = [...structuralAttributeArrays].reduce(
  (bytes, array) => bytes + (array as ArrayBufferView).byteLength,
  0,
);
assert.equal(
  residentGeometryAttributeBytes,
  51_840,
  'resource variants must share exactly three continuous structural buffers',
);
const residentPlaneColorBytes = mineralGeometries.reduce(
  (bytes, geometry) => bytes + geometry.getAttribute('color').array.byteLength,
  0,
);
assert.equal(
  residentPlaneColorBytes,
  9_720,
  'camera-readable plane weathering must cost exactly 9.49 KiB of normalized RGB8 color data',
);
assert.equal(
  residentGeometryAttributeBytes + residentPlaneColorBytes,
  61_560,
  'v12 placement must retain the exact v11 geometry budget without new meshes or draws',
);
const mineralMaterials = new Set(
  mineralOutcrops.map((outcrop) => outcrop.material as THREE.MeshStandardMaterial),
);
assert.equal(mineralMaterials.size, 4, 'mineral outcrops must retain two shared materials per resource');
const mineralTextures = new Set(
  [...mineralMaterials].flatMap((material) => [
    material.map,
    material.normalMap,
    material.roughnessMap,
  ]),
);
assert.equal(
  mineralTextures.size,
  6,
  'iron and salt must retain one shared three-channel weathering texture set each',
);
assert.equal(
  [...mineralTextures].reduce(
    (bytes, texture) => bytes + ((texture as THREE.DataTexture).image.data as Uint8Array).byteLength,
    0,
  ),
  98_304,
  'all six static RGBA weathering maps must remain within the exact 96 KiB CPU texture budget',
);
assert.equal(
  mineralShadowBatches.reduce((count, batch) => count + batch.count, 0),
  mineralVisualLayout.mineralDepositLayout.sites.reduce(
    (count, site) => count + (site.grade === 'rich' ? 18 : 10),
    0,
  ),
  'the initial exact caster prefixes must contain every authored mineral outcrop',
);
const mineralBatchIdentities = [...mineralShadowBatches];
const exhaustedMineralNodes = mineralVisualLayout.mineralDepositLayout.sites.map(
  (site, index): ResourceNodeState => ({
    nodeId: mineralDepositNodeId(site, index),
    kind: 'quarry',
    resource: site.resource,
    remaining: 0,
    maxYield: mineralDepositMaxYield(site),
    x: site.x,
    z: site.z,
    isRich: site.grade === 'rich',
  }),
);
assert.equal(mineralVisualSystem.syncNodes(exhaustedMineralNodes), true);
assert.equal(
  mineralShadowBatches.reduce((count, batch) => count + batch.count, 0),
  mineralVisualLayout.mineralDepositLayout.sites.filter(
    (site) => site.grade === 'rich',
  ).length * 18,
  'ordinary mineral depletion must remove exactly its outcrop casters while rich deposits remain',
);
const mineralBatchesAfterDepletion: THREE.InstancedMesh[] = [];
mineralVisualSystem.group.traverse((object) => {
  const mesh = object as THREE.InstancedMesh;
  if (mesh.isInstancedMesh && mesh.userData.staticInstancedShadowBatch === true) {
    mineralBatchesAfterDepletion.push(mesh);
  }
});
assert.deepEqual(
  mineralBatchesAfterDepletion,
  mineralBatchIdentities,
  'deposit depletion must update reusable caster prefixes without allocating replacement GPU meshes',
);
mineralVisualSystem.dispose();

function measureWeatheringTexture(texture: THREE.DataTexture): {
  luminanceRange: number;
  channelRanges: [number, number, number];
  chromaRange: number;
  fineContrast: number;
  broadContrast: number;
  contactDarkening: number;
  gradientAxisRatio: number;
  strongestShiftCorrelation: number;
  dominantGradientDirectionShare: number;
  localContrastVariation: number;
} {
  const data = texture.image.data as Uint8Array;
  const width = texture.image.width as number;
  const height = texture.image.height as number;
  const luminance = new Float64Array(width * height);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const channelMin: [number, number, number] = [255, 255, 255];
  const channelMax: [number, number, number] = [0, 0, 0];
  let minimumChroma = Number.POSITIVE_INFINITY;
  let maximumChroma = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < luminance.length; index++) {
    const offset = index * 4;
    const value = (
      data[offset] * 0.2126
      + data[offset + 1] * 0.7152
      + data[offset + 2] * 0.0722
    ) / 255;
    luminance[index] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    for (let channel = 0; channel < 3; channel++) {
      channelMin[channel] = Math.min(channelMin[channel], data[offset + channel]);
      channelMax[channel] = Math.max(channelMax[channel], data[offset + channel]);
    }
    const chroma = (data[offset] - data[offset + 2]) / 255;
    minimumChroma = Math.min(minimumChroma, chroma);
    maximumChroma = Math.max(maximumChroma, chroma);
  }

  let horizontalGradient = 0;
  let verticalGradient = 0;
  const gradientDirectionEnergy = new Float64Array(8);
  const tileContrast = new Float64Array(8 * 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = luminance[y * width + x];
      const dx = luminance[y * width + ((x + 1) % width)] - value;
      const dy = luminance[((y + 1) % height) * width + x] - value;
      horizontalGradient += Math.abs(dx);
      verticalGradient += Math.abs(dy);
      const gradientEnergy = Math.hypot(dx, dy);
      const direction = (Math.atan2(dy, dx) + Math.PI) % Math.PI;
      const directionBin = Math.min(
        gradientDirectionEnergy.length - 1,
        Math.floor(direction / Math.PI * gradientDirectionEnergy.length),
      );
      gradientDirectionEnergy[directionBin] += gradientEnergy;
      const tileX = Math.floor(x / (width / 8));
      const tileY = Math.floor(y / (height / 8));
      tileContrast[tileY * 8 + tileX] += gradientEnergy;
    }
  }

  const globalMean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  let variance = 0;
  for (const value of luminance) {
    variance += (value - globalMean) ** 2;
  }
  let strongestShiftCorrelation = Number.NEGATIVE_INFINITY;
  for (const shift of [4, 8, 12, 16, 20, 24]) {
    for (const [shiftX, shiftY] of [[shift, 0], [0, shift], [shift, shift], [shift, -shift]]) {
      let covariance = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const shiftedX = (x + shiftX) % width;
          const shiftedY = (y + shiftY + height) % height;
          covariance += (luminance[y * width + x] - globalMean)
            * (luminance[shiftedY * width + shiftedX] - globalMean);
        }
      }
      strongestShiftCorrelation = Math.max(strongestShiftCorrelation, covariance / variance);
    }
  }
  const directionEnergyTotal = gradientDirectionEnergy.reduce((sum, value) => sum + value, 0);
  const tileContrastMean = tileContrast.reduce((sum, value) => sum + value, 0)
    / tileContrast.length;
  const tileContrastVariance = tileContrast.reduce(
    (sum, value) => sum + (value - tileContrastMean) ** 2,
    0,
  ) / tileContrast.length;

  return {
    luminanceRange: max - min,
    channelRanges: channelMin.map(
      (channelMinimum, channel) => (channelMax[channel] - channelMinimum) / 255,
    ) as [number, number, number],
    chromaRange: maximumChroma - minimumChroma,
    fineContrast: meanWrappedShiftDifference(luminance, width, height, 1),
    broadContrast: meanWrappedShiftDifference(luminance, width, height, width / 8),
    contactDarkening: meanTextureBand(luminance, width, 36, 46)
      - meanTextureBand(luminance, width, 20, 30),
    gradientAxisRatio: horizontalGradient / verticalGradient,
    strongestShiftCorrelation,
    dominantGradientDirectionShare: Math.max(...gradientDirectionEnergy) / directionEnergyTotal,
    localContrastVariation: Math.sqrt(tileContrastVariance) / tileContrastMean,
  };
}

function meanWrappedShiftDifference(
  values: Float64Array,
  width: number,
  height: number,
  shift: number,
): number {
  let difference = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = values[y * width + x];
      difference += Math.abs(value - values[y * width + ((x + shift) % width)]);
      difference += Math.abs(value - values[((y + shift) % height) * width + x]);
    }
  }
  return difference / (width * height * 2);
}

function meanTextureBand(
  values: Float64Array,
  width: number,
  startRow: number,
  endRow: number,
): number {
  let total = 0;
  for (let y = startRow; y < endRow; y++) {
    for (let x = 0; x < width; x++) total += values[y * width + x];
  }
  return total / ((endRow - startRow) * width);
}

function measureBoxFilteredTexture(
  texture: THREE.DataTexture,
  blockSize: number,
): { luminanceRange: number; chromaRange: number; adjacentContrast: number } {
  const data = texture.image.data as Uint8Array;
  const width = texture.image.width as number;
  const height = texture.image.height as number;
  assert.equal(width % blockSize, 0);
  assert.equal(height % blockSize, 0);
  const filteredWidth = width / blockSize;
  const filteredHeight = height / blockSize;
  const luminance = new Float64Array(filteredWidth * filteredHeight);
  const chroma = new Float64Array(filteredWidth * filteredHeight);
  for (let filteredY = 0; filteredY < filteredHeight; filteredY++) {
    for (let filteredX = 0; filteredX < filteredWidth; filteredX++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let localY = 0; localY < blockSize; localY++) {
        for (let localX = 0; localX < blockSize; localX++) {
          const x = filteredX * blockSize + localX;
          const y = filteredY * blockSize + localY;
          const offset = (y * width + x) * 4;
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
        }
      }
      const sampleCount = blockSize * blockSize * 255;
      const index = filteredY * filteredWidth + filteredX;
      luminance[index] = (
        red * 0.2126 + green * 0.7152 + blue * 0.0722
      ) / sampleCount;
      chroma[index] = (red - blue) / sampleCount;
    }
  }
  let adjacentContrast = 0;
  for (let y = 0; y < filteredHeight; y++) {
    for (let x = 0; x < filteredWidth; x++) {
      const value = luminance[y * filteredWidth + x];
      adjacentContrast += Math.abs(
        value - luminance[y * filteredWidth + ((x + 1) % filteredWidth)],
      );
      adjacentContrast += Math.abs(
        value - luminance[((y + 1) % filteredHeight) * filteredWidth + x],
      );
    }
  }
  return {
    luminanceRange: Math.max(...luminance) - Math.min(...luminance),
    chromaRange: Math.max(...chroma) - Math.min(...chroma),
    adjacentContrast: adjacentContrast / (filteredWidth * filteredHeight * 2),
  };
}

function worldDimensions(outcrop: THREE.Mesh): {
  width: number;
  height: number;
  depth: number;
} {
  outcrop.geometry.computeBoundingBox();
  const box = outcrop.geometry.boundingBox!;
  return {
    width: (box.max.x - box.min.x) * outcrop.scale.x,
    height: (box.max.y - box.min.y) * outcrop.scale.y,
    depth: (box.max.z - box.min.z) * outcrop.scale.z,
  };
}

function connectedTriangleComponentCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  assert.equal(position.count % 3, 0);
  const faceCount = position.count / 3;
  const parents = Array.from({ length: faceCount }, (_, index) => index);
  const find = (face: number): number => {
    let root = face;
    while (parents[root] !== root) root = parents[root];
    while (parents[face] !== face) {
      const next = parents[face];
      parents[face] = root;
      face = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const firstFaceByVertex = new Map<string, number>();
  for (let face = 0; face < faceCount; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = face * 3 + corner;
      const key = `${Math.round(position.getX(vertex) * 100_000)}/${Math.round(position.getY(vertex) * 100_000)}/${Math.round(position.getZ(vertex) * 100_000)}`;
      const firstFace = firstFaceByVertex.get(key);
      if (firstFace === undefined) firstFaceByVertex.set(key, face);
      else union(face, firstFace);
    }
  }
  return new Set(parents.map((_, face) => find(face))).size;
}

// The setup panel promises physical ordinary deposits, not merely a regional
// budget. Exercise the dry/wet and lean/plentiful extremes because competing
// river, quarry, clay-bank, forage, and mineral clearances are where a
// deterministic placement fallback is most likely to silently drop a node.
const extremePlacementFailures: string[] = [];
let extremeWorldCount = 0;
for (const mapSize of mapSizes) {
  for (const hydrology of [0, 100]) {
    for (const resourceAbundance of [0, 100]) {
      for (const resourceVariety of [0, 100]) {
        for (let seed = 1; seed <= 16; seed++) {
          const settings = worldSettings({
            mapSize,
            seed,
            hydrology,
            resourceAbundance,
            resourceVariety,
          });
          const layout = createWorldLayout(settings);
          const stoneSites = layout.quarryLayout.sites;
          const claySites = layout.clayDepositLayout.sites;
          const mineralSites = layout.mineralDepositLayout.sites;
          const expectedStone =
            layout.resourcePlan.ordinaryQuarryCount
            + layout.resourcePlan.richStoneDepositCount;
          const expectedClay =
            layout.resourcePlan.ordinaryClayDepositCount
            + layout.resourcePlan.richClayDepositCount;
          const expectedMinerals =
            layout.resourcePlan.ordinaryMineralDepositCount
            + layout.resourcePlan.richMineralDepositCount;
          const ordinaryStone = stoneSites.filter((site) => site.kind === 'small').length;
          const richStone = stoneSites.filter((site) => site.kind === 'large').length;
          const ordinaryClay = claySites.filter((site) => site.kind === 'ordinary').length;
          const richClay = claySites.filter((site) => site.kind === 'rich').length;
          const ordinaryMinerals = mineralSites.filter(
            (site) => site.grade === 'ordinary',
          ).length;
          const richMinerals = mineralSites.filter((site) => site.grade === 'rich').length;
          const ironSites = mineralSites.filter((site) => site.resource === 'iron').length;
          const saltSites = mineralSites.filter((site) => site.resource === 'salt').length;

          extremeWorldCount++;
          if (
            stoneSites.length !== expectedStone
            || claySites.length !== expectedClay
            || mineralSites.length !== expectedMinerals
            || ordinaryStone !== layout.resourcePlan.ordinaryQuarryCount
            || richStone !== layout.resourcePlan.richStoneDepositCount
            || ordinaryClay !== layout.resourcePlan.ordinaryClayDepositCount
            || richClay !== layout.resourcePlan.richClayDepositCount
            || ordinaryMinerals !== layout.resourcePlan.ordinaryMineralDepositCount
            || richMinerals !== layout.resourcePlan.richMineralDepositCount
            || ironSites === 0
            || saltSites === 0
          ) {
            extremePlacementFailures.push(JSON.stringify({
              mapSize,
              seed,
              hydrology,
              resourceAbundance,
              resourceVariety,
              expected: {
                stone: expectedStone,
                clay: expectedClay,
                minerals: expectedMinerals,
                ordinaryStone: layout.resourcePlan.ordinaryQuarryCount,
                richStone: layout.resourcePlan.richStoneDepositCount,
                ordinaryClay: layout.resourcePlan.ordinaryClayDepositCount,
                richClay: layout.resourcePlan.richClayDepositCount,
                ordinaryMinerals: layout.resourcePlan.ordinaryMineralDepositCount,
                richMinerals: layout.resourcePlan.richMineralDepositCount,
              },
              actual: {
                stone: stoneSites.length,
                clay: claySites.length,
                minerals: mineralSites.length,
                ordinaryStone,
                richStone,
                ordinaryClay,
                richClay,
                ordinaryMinerals,
                richMinerals,
                iron: ironSites,
                salt: saltSites,
              },
            }));
          }
        }
      }
    }
  }
}
assert.deepEqual(
  extremePlacementFailures,
  [],
  `every setup must place its complete physical deposit budget; checked ${
    extremeWorldCount
  } extreme worlds, first failures:\n${extremePlacementFailures.slice(0, 8).join('\n')}`,
);

const nonDefaultLayout = createWorldLayout(worldSettings({
  seed: 13,
  mapSize: 'small',
  hydrology: 100,
  resourceAbundance: 100,
  resourceVariety: 0,
}));
const nonDefaultRegistry = WorldLayoutRegistry.fromWorldLayout(nonDefaultLayout);
const nonDefaultBootstrap = computeWorldBootstrapDataFromLayout(nonDefaultLayout);
const expectedQuarryIds = nonDefaultRegistry.definitionList
  .filter((definition) => definition.kind === 'quarry')
  .map((definition) => definition.id);
const expectedClayIds = nonDefaultLayout.clayDepositLayout.sites
  .map((site, index) => clayDepositNodeId(site, index));
assert.deepEqual(
  nonDefaultBootstrap.quarries.map((quarry) => quarry.quarryId),
  expectedQuarryIds,
  'an arbitrary setup must send every stone, iron, and salt node to bootstrap_quarries',
);
assert.deepEqual(
  nonDefaultBootstrap.foragingNodes
    .filter((node) => node.nodeKind === 'clay')
    .map((node) => node.nodeId),
  expectedClayIds,
  'an arbitrary setup must send every clay node to bootstrap_foraging',
);
assert.deepEqual(
  new Set(
    nonDefaultBootstrap.quarries
      .filter((quarry) => quarry.quarryId.startsWith('deposit-'))
      .map((quarry) => quarry.quarryId.split('-')[1]),
  ),
  new Set(['iron', 'salt']),
  'authoritative bootstrap payloads must retain both physical mineral families',
);

let sawIron = false;
let sawSalt = false;
let sawLargeWithBoth = false;
let sawRichMineral = false;
const largeRichCounts = new Set<number>();
for (let seed = 1; seed <= 256; seed++) {
  const settings = worldSettings({
    seed,
    mapSize: 'large',
    resourceAbundance: 50,
    resourceVariety: 50,
  });
  const plan = createRegionalResourcePlan(settings);
  const roster = createMineralDepositRoster({
    seed: deriveSubSeed(seed, 'iron-salt-deposits'),
    mapSize: settings.mapSize,
    richSiteCount: plan.richMineralDepositCount,
    ordinarySiteCount: plan.ordinaryMineralDepositCount,
    resourceVariety: settings.resourceVariety,
  });
  const resources = new Set(roster.map((site) => site.resource));
  sawIron ||= resources.has('iron');
  sawSalt ||= resources.has('salt');
  sawLargeWithBoth ||= resources.size === 2;
  sawRichMineral ||= roster.some((site) => site.grade === 'rich');
  largeRichCounts.add(roster.filter((site) => site.grade === 'rich').length);
}
assert.ok(sawIron && sawSalt, 'different seeds must support either raw resource');
assert.ok(sawLargeWithBoth, 'every region should physically support both iron and salt');
assert.ok(sawRichMineral && largeRichCounts.size > 1, 'large-map rich mineral counts must vary by seed');

const defaultLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
const registry = WorldLayoutRegistry.fromWorldLayout(defaultLayout);
const mineralDefinitions = registry.definitionList.filter(
  (definition) =>
    definition.kind === 'quarry'
    && (definition.resource === 'iron' || definition.resource === 'salt'),
);
assert.equal(
  mineralDefinitions.length,
  defaultLayout.mineralDepositLayout.sites.length,
);
for (let index = 0; index < defaultLayout.mineralDepositLayout.sites.length; index++) {
  const site = defaultLayout.mineralDepositLayout.sites[index];
  const definition = mineralDefinitions.find(
    (candidate) => candidate.id === mineralDepositNodeId(site, index),
  );
  assert.ok(definition, `missing registry row for ${mineralDepositLabel(site)}`);
  assert.equal(definition.label, mineralDepositLabel(site));
  assert.equal(definition.maxYield, mineralDepositMaxYield(site));
  assert.equal(definition.isRich, site.grade === 'rich');
}

const markers = buildLayoutWorldMapMarkers(
  registry,
  defaultLayout.clayDepositLayout.sites,
);
assert.equal(
  markers.filter((marker) => marker.resource === 'iron' || marker.resource === 'salt').length,
  mineralDefinitions.length,
  'iron and salt deposits must reach the far-zoom resource map',
);
assert.ok(IRON_ICON_HTML.includes('map-resource-icon-glyph--iron'));
assert.ok(SALT_ICON_HTML.includes('map-resource-icon-glyph--salt'));

const ordinaryIronMarker = markers.find(
  (marker) => marker.resource === 'iron' && marker.label === 'Iron deposit',
);
assert.ok(ordinaryIronMarker, 'the default seed must expose an ordinary iron marker');
const ordinaryIronNode = mineralNode(
  ordinaryIronMarker.id,
  'iron',
  ordinaryIronMarker.x,
  ordinaryIronMarker.z,
  60,
  300,
  false,
);
const geologicalNodes = new Map([[ordinaryIronNode.nodeId, ordinaryIronNode]]);
assert.equal(
  geologicalNodeForMapMarker(ordinaryIronMarker, geologicalNodes),
  ordinaryIronNode,
  'projected and minimap quarry markers must resolve from the geological node table',
);
assert.equal(
  geologicalNodeForMapMarker(
    { id: ordinaryIronMarker.id, kind: 'game' },
    geologicalNodes,
  ),
  undefined,
  'wild-resource markers must not masquerade as geological nodes',
);
assert.equal(LOW_GEOLOGICAL_RESERVE_SHARE, 0.2);
assert.deepEqual(
  describeGeologicalMapMarker(ordinaryIronMarker, ordinaryIronNode),
  {
    label: 'Iron deposit · 60 / 300 finite iron remaining',
    level: 'low',
  },
);
assert.equal(
  describeGeologicalMapMarker(
    ordinaryIronMarker,
    { ...ordinaryIronNode, remaining: 61 },
  ).level,
  'stable',
  'the low-reserve badge must begin only at the final fifth of a finite seam',
);
assert.equal(
  describeGeologicalMapMarker(
    ordinaryIronMarker,
    { ...ordinaryIronNode, remaining: 0 },
  ).level,
  'depleted',
);
assert.deepEqual(
  describeGeologicalMapMarker(
    { label: 'Rich salt deposit' },
    mineralNode('rich-salt', 'salt', 0, 0, 1_080, 1_080, true),
  ),
  {
    label: 'Rich salt deposit · 1080 / 1080 surface salt remaining · underground salt does not deplete · center Mineworks on this node',
    level: 'deep',
  },
);
assert.deepEqual(
  describeGeologicalMapMarker(
    { label: 'Rich stone deposit' },
    {
      ...ordinaryIronNode,
      nodeId: 'rich-stone',
      resource: 'stone',
      remaining: 120,
      maxYield: 600,
      isRich: true,
    },
  ),
  {
    label: 'Rich stone deposit · 120 / 600 surface stone remaining · underground stone does not deplete · center Quarry on this node',
    level: 'deep',
  },
  'rich stone must use the same surface-plus-underground vocabulary as every mineral',
);
assert.deepEqual(
  describeGeologicalMapMarker(
    { label: 'Rich clay deposit' },
    {
      ...ordinaryIronNode,
      nodeId: 'rich-clay',
      resource: 'clay',
      remaining: 720,
      maxYield: 720,
      isRich: true,
    },
  ),
  {
    label: 'Rich clay deposit · 720 / 720 surface clay remaining · underground clay does not deplete · center Mineworks on this node',
    level: 'deep',
  },
);
const geologicalMarkerProfileStarted = performance.now();
for (let index = 0; index < 100_000; index++) {
  describeGeologicalMapMarker(
    ordinaryIronMarker,
    {
      ...ordinaryIronNode,
      remaining: index % 301,
    },
  );
}
const geologicalMarkerProfileMs =
  performance.now() - geologicalMarkerProfileStarted;
assert.ok(
  geologicalMarkerProfileMs < 250,
  `100k live geological marker projections took ${geologicalMarkerProfileMs.toFixed(1)} ms`,
);

const generated = JSON.parse(
  readFileSync('server/generated/world_quarries.json', 'utf8'),
) as {
  quarries: Array<{
    quarryId: string;
    maxYield: number;
    isRich: boolean;
  }>;
};
const generatedMinerals = generated.quarries.filter(
  (quarry) => quarry.quarryId.startsWith('deposit-'),
);
assert.deepEqual(
  generatedMinerals.map((quarry) => quarry.quarryId),
  mineralDefinitions.map((definition) => definition.id),
  'generated authority rows must use the same deterministic deposit IDs as the client',
);
assert.ok(
  generatedMinerals.every((quarry) =>
    quarry.quarryId.startsWith('deposit-iron-')
    || quarry.quarryId.startsWith('deposit-salt-')
  ),
);

const miningPit = getBuildingDefinition('stone_quarry');
assert.equal(miningPit.label, 'Mining Camp');
for (const resource of ['stone', 'iron', 'salt', 'clay'] as const) {
  assert.ok(
    (BUILDING_STORAGE_CAPS.stone_quarry[resource] ?? 0) > 0,
    `Mining Camp must store extracted surface ${resource}`,
  );
}

const quarry = getBuildingDefinition('large_quarry');
assert.equal(quarry.label, 'Quarry');
assert.ok(BUILDING_STORAGE_CAPS.large_quarry.stone > 0);
assert.equal('iron' in BUILDING_STORAGE_CAPS.large_quarry, false);
assert.equal('salt' in BUILDING_STORAGE_CAPS.large_quarry, false);
assert.equal('clay' in BUILDING_STORAGE_CAPS.large_quarry, false);

const mine = getBuildingDefinition('mine');
assert.equal(mine.label, 'Mineworks');
assert.equal(mine.acceptsLabor, true);
assert.equal(mine.requiresRoad, true);
assert.equal(mine.maxLabor, 4);
assert.equal(BUILDING_STORAGE_CAPS.mine.iron, 75);
assert.equal(BUILDING_STORAGE_CAPS.mine.salt, 50);
assert.equal(BUILDING_STORAGE_CAPS.mine.clay, 75);
assert.equal(BUILDING_STORAGE_CAPS.mine.ironwork, 3);
assert.equal(BUILDING_STORAGE_CAPS.mine.timber, 12);
assert.ok(MINE_IRON_PER_CYCLE > 0);
assert.ok(MINE_SALT_PER_CYCLE > 0);
assert.ok(MINE_CLAY_PER_CYCLE > 0);
assert.equal(MINE_TIMBER_SUPPORT_PER_CYCLE, 1);
assert.equal(MINE_TIMBER_SUPPORT_BUFFER_CYCLES, 3);
assert.equal(RICH_MINE_SUPPORT_TARGET, 3);
assert.equal(richMineSupportRunwayCycles(3), 3);
assert.equal(richMineSupportsReady(0.99), false);
assert.equal(richMineSupportsReady(1), true);
assert.ok(RICH_MINE_THROUGHPUT_MULTIPLIER > 1);

const mineMesh = createBuildingMesh('mine');
assert.equal(mineMesh.name, 'Mineworks');
assert.ok(mineMesh.getObjectByName('Mineworks sorting floor'));
const ironStockpile = mineMesh.getObjectByName('IronMineStockpile');
const saltStockpile = mineMesh.getObjectByName('SaltMineStockpile');
const clayStockpile = mineMesh.getObjectByName('ClayMineStockpile');
const toolStockpile = mineMesh.getObjectByName('CivilianToolStockpile');
const supportStockpile = mineMesh.getObjectByName('MineSupportStockpile');
assert.ok(ironStockpile, 'the mine needs a physical iron stockpile');
assert.ok(saltStockpile, 'the mine needs a physical salt stockpile');
assert.ok(clayStockpile, 'Mineworks needs a physical clay stockpile');
assert.ok(toolStockpile, 'the mine needs a physical replacement-tool rack');
assert.ok(supportStockpile, 'the mine needs a physical prepared shaft-timber pile');
assert.equal(
  ironStockpile.children.filter((child) => child.name === 'IronMineOreSegment').length,
  6,
  'iron inventory must visibly rise and fall in discrete ore piles',
);
assert.equal(
  saltStockpile.children.filter((child) => child.name === 'SaltMineSaltSegment').length,
  6,
  'salt inventory must visibly rise and fall in discrete rock-salt piles',
);
assert.equal(
  clayStockpile.children.filter((child) => child.name === 'ClayMineClaySegment').length,
  6,
  'clay inventory must visibly rise and fall in discrete excavated-clay piles',
);
assert.equal(
  supportStockpile.children.filter(
    (child) => child.name === 'MineSupportTimberSegment',
  ).length,
  4,
  'deep-mine support runway must visibly rise and fall in four beam bundles',
);
const emptySupportSignature = bulkStockpileVisualSignature(
  mineBuilding({ timber: 0 }),
);
const oneCycleSupportSignature = bulkStockpileVisualSignature(
  mineBuilding({ timber: MINE_TIMBER_SUPPORT_PER_CYCLE }),
);
assert.notEqual(
  emptySupportSignature,
  oneCycleSupportSignature,
  'mine presentation must refresh as support timber is delivered or consumed',
);
syncBulkStockpileVisuals(
  mineMesh,
  mineBuilding({ timber: MINE_TIMBER_SUPPORT_PER_CYCLE }),
);
assert.equal(
  supportStockpile.children.filter((child) => child.visible).length,
  1,
  'one support batch should make one prepared-beam bundle visible',
);
syncBulkStockpileVisuals(
  mineMesh,
  mineBuilding({ timber: RICH_MINE_SUPPORT_TARGET }),
);
assert.equal(
  supportStockpile.children.filter((child) => child.visible).length,
  3,
  'the requested three-cycle support buffer must show three discrete beam bundles',
);
mineMesh.traverse((object) => {
  if (object instanceof THREE.Mesh) object.geometry.dispose();
});

const authority = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const mineStart = authority.indexOf('pub fn step_mine');
const mineEnd = authority.indexOf('pub fn step_granary', mineStart);
assert.ok(mineStart >= 0 && mineEnd > mineStart);
const mineStep = authority.slice(mineStart, mineEnd);
assert.match(mineStep, /mineworks_commodity_beneath/);
assert.match(mineStep, /mineworks_geological_commodity/);
assert.match(mineStep, /mineworks_clay_commodity/);
assert.match(mineStep, /MINE_IRON_PER_CYCLE/);
assert.match(mineStep, /MINE_SALT_PER_CYCLE/);
assert.match(mineStep, /MINE_CLAY_PER_CYCLE/);
assert.match(mineStep, /RICH_MINE_THROUGHPUT_MULTIPLIER/);
assert.match(
  mineStep,
  /request_connected_commodity[\s\S]*CommodityKind::Timber[\s\S]*lumber_mill[\s\S]*village_storehouse[\s\S]*rich_mine_support_target/,
  'Mineworks must physically request support timber from connected timber stores',
);
assert.match(
  mineStep,
  /if !rich_mine_supports_ready\(building\.timber\)[\s\S]*return;/,
  'deep extraction must stop safely before advancing without a complete timber crib batch',
);
assert.match(
  mineStep,
  /if produced > 1e-6[\s\S]*CommodityKind::Timber[\s\S]*MINE_TIMBER_SUPPORT_PER_CYCLE/,
  'support timber must wear only after a completed deep extraction batch',
);
assert.match(mineStep, /civilian_tool_throughput_multiplier\(building\.ironwork\)/);
assert.match(
  mineStep,
  /tools_maintained && produced > 1e-6[\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
  'mine tools must wear only after a completed physical extraction batch',
);
assert.doesNotMatch(
  mineStep,
  /remaining:/,
  'Mineworks must never consume the finite surface reserve owned by Mining Camps',
);
assert.match(
  authority,
  /pub fn step_local_material_dispatch[\s\S]*try_start_building_supply_trip[\s\S]*commodity/,
  'local extracted materials must move through physical building supply trips',
);
assert.match(
  authority,
  /\("stone_quarry" \| "mine", CommodityKind::Iron\)[\s\S]*smithy[\s\S]*trading_post[\s\S]*\("stone_quarry" \| "mine", CommodityKind::Salt\)[\s\S]*smokehouse[\s\S]*pastoral_farmstead[\s\S]*trading_post[\s\S]*\("stone_quarry" \| "mine", CommodityKind::Clay\)[\s\S]*potter_kiln/,
  'Mining Camp and Mineworks carts must dispatch iron, salt, and clay to matching processors',
);

const extractionPolicy = readFileSync('server/src/extraction_policy.rs', 'utf8');
assert.match(
  extractionPolicy,
  /"stone_quarry" => matches![\s\S]*CommodityKind::Stone[\s\S]*CommodityKind::Iron[\s\S]*CommodityKind::Salt[\s\S]*CommodityKind::Clay/,
  'Mining Camps must accept the finite surface layer of all four geological resources',
);
assert.match(
  extractionPolicy,
  /mineworks_geological_commodity[\s\S]*if !is_rich[\s\S]*return None[\s\S]*CommodityKind::Iron \| CommodityKind::Salt/,
  'Mineworks must accept only rich iron and salt rows from the geological table',
);
assert.match(
  extractionPolicy,
  /mineworks_clay_commodity[\s\S]*node_id\.starts_with\("clay-rich-"\)/,
  'Mineworks must accept only rich clay rows from the legacy natural-resource table',
);
assert.match(
  extractionPolicy,
  /quarry_geological_commodity[\s\S]*is_rich[\s\S]*CommodityKind::Stone/,
  'Quarries must reserve their deep workings for rich stone',
);

const ordinaryIronDeposit = mineralNode(
  'deposit-iron-ordinary-inspector',
  'iron',
  0,
  0,
  75,
  300,
  false,
);
const inspectorMine = mineBuilding({ assignedLabor: 2, iron: 12 });
let inspectorState = inspectorGameState(inspectorMine, [ordinaryIronDeposit]);
let mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.title, 'Mineworks');
assert.equal(mineInspector.eyebrow, 'Deep extraction');
assert.match(mineInspector.statusText, /no rich iron, salt, or clay deposit beneath the shaft/);
assert.match(mineInspector.detailsHtml, /Missing - Mineworks cannot produce/);

const inspectorMiningPit = mineBuilding({
  id: 'mining-camp-inspector',
  kind: 'stone_quarry',
  workRadius: 40,
  assignedLabor: 2,
  iron: 12,
});
let miningPitInspector = renderStoneQuarryInspector(
  buildingTarget(inspectorMiningPit),
  inspectorContext(inspectorGameState(inspectorMiningPit, [ordinaryIronDeposit])),
);
assert.equal(miningPitInspector.title, 'Mining Camp');
assert.equal(miningPitInspector.eyebrow, 'Surface extraction camp');
assert.match(miningPitInspector.statusText, /Extracting surface iron/);
assert.match(miningPitInspector.detailsHtml, /never snaps to its center/);
assert.match(miningPitInspector.detailsHtml, /Ordinary iron surface deposit · finite/);
assert.match(miningPitInspector.detailsHtml, /Baseline hand tools/);
const richSaltDeposit = mineralNode(
  'deposit-salt-rich-inspector',
  'salt',
  0,
  0,
  0,
  1_080,
  true,
);
inspectorState = inspectorGameState(inspectorMine, [richSaltDeposit]);
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.eyebrow, 'Rich salt mineworks');
assert.match(mineInspector.statusText, /awaits timber supports/);
assert.match(mineInspector.detailsHtml, /0 onsite \/ 3 timber target/);
const recalledUnsupportedMine = {
  ...inspectorMine,
  id: 'mine-recalled-without-supports',
  assignedLabor: 0,
};
mineInspector = renderMineralMineInspector(
  buildingTarget(recalledUnsupportedMine),
  inspectorContext(inspectorGameState(recalledUnsupportedMine, [richSaltDeposit])),
);
assert.match(
  mineInspector.statusText,
  /assign at least 1 miner to request timber supports/,
  'an unstaffed Mineworks must explain that its crew initiates support requests',
);
assert.equal(mineInspector.statusState, 'idle');
const recalledHeldMine = {
  ...recalledUnsupportedMine,
  id: 'mine-recalled-at-target',
  processorOutputTargetPercent: 25,
  salt: 240,
};
mineInspector = renderMineralMineInspector(
  buildingTarget(recalledHeldMine),
  inspectorContext(inspectorGameState(recalledHeldMine, [richSaltDeposit])),
);
assert.match(mineInspector.statusText, /salt yard full/);
assert.equal(mineInspector.statusState, 'idle');
assert.match(mineInspector.detailsHtml, /Production interval<\/span><span>paused/);
const inboundSupportTrip: DeliveryTripState = {
  id: 'support-inbound',
  buildingId: 'lumber-mill',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: inspectorMine.id,
  cargoKind: 'timber',
  amount: MINE_TIMBER_SUPPORT_PER_CYCLE,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 1,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 1,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
};
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState, inboundSupportTrip),
);
assert.match(mineInspector.statusText, /timber supports are approaching/);
assert.equal(mineInspector.statusState, 'idle');
const supportedInspectorMine = {
  ...inspectorMine,
  timber: RICH_MINE_SUPPORT_TARGET,
};
inspectorState = inspectorGameState(supportedInspectorMine, [richSaltDeposit]);
mineInspector = renderMineralMineInspector(
  buildingTarget(supportedInspectorMine),
  inspectorContext(inspectorState),
);
assert.match(mineInspector.statusText, /Extracting rich deep salt - source does not deplete/);
assert.match(mineInspector.detailsHtml, /50% faster deep working/);
assert.match(mineInspector.detailsHtml, /3.0 cycles/);
assert.match(mineInspector.detailsHtml, /1 timber per completed deep batch/);

const richClayDeposit: ResourceNodeState = {
  ...richSaltDeposit,
  nodeId: 'clay-rich-inspector',
  resource: 'clay',
  remaining: 720,
  maxYield: 720,
};
const supportedClayMineworks = {
  ...supportedInspectorMine,
  id: 'clay-mineworks-inspector',
  iron: 0,
  salt: 0,
  clay: 0,
};
mineInspector = renderMineralMineInspector(
  buildingTarget(supportedClayMineworks),
  inspectorContext(inspectorGameState(supportedClayMineworks, [richClayDeposit])),
);
assert.equal(mineInspector.eyebrow, 'Rich clay mineworks');
assert.match(mineInspector.statusText, /Extracting rich deep clay - source does not deplete/);
assert.match(mineInspector.detailsHtml, /Rich deep clay seam - non-depleting deep workings/);
assert.match(mineInspector.detailsHtml, /Mineworks carts serve road-linked potters/);

const exhaustedIron = { ...ordinaryIronDeposit, remaining: 0 };
miningPitInspector = renderStoneQuarryInspector(
  buildingTarget(inspectorMiningPit),
  inspectorContext(inspectorGameState(inspectorMiningPit, [exhaustedIron])),
);
assert.equal(miningPitInspector.statusState, 'warning');
assert.match(miningPitInspector.statusText, /no unexhausted surface deposit in range/);
assert.match(miningPitInspector.detailsHtml, /Harvest interval<\/span><span>paused/);

const richSaltNearQuarry = {
  ...richSaltDeposit,
  x: 100,
  nodeId: 'deposit-salt-rich-near-large-quarry',
};
const largeQuarryBuilding = mineBuilding({
  id: 'large-quarry-inspector',
  kind: 'large_quarry',
  x: 100,
  assignedLabor: 2,
});
const largeQuarryState = inspectorGameState(
  largeQuarryBuilding,
  [richSaltNearQuarry],
);
const largeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(largeQuarryState),
);
assert.equal(largeQuarryInspector.eyebrow, 'Deep stone quarry');
assert.match(largeQuarryInspector.statusText, /no rich stone deposit beneath the quarry/);
assert.doesNotMatch(
  largeQuarryInspector.detailsHtml,
  /underground salt/,
  'a Quarry must not present a rich salt node as its deep source',
);
const richStoneAtQuarry: ResourceNodeState = {
  ...richSaltNearQuarry,
  nodeId: 'quarry-rich-stone-inspector',
  resource: 'stone',
};
const unsupportedLargeQuarryState = inspectorGameState(
  largeQuarryBuilding,
  [richStoneAtQuarry],
);
let supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(unsupportedLargeQuarryState),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /await prepared timber supports/,
);
assert.match(
  supportedLargeQuarryInspector.detailsHtml,
  /0 onsite \/ 6 timber target/,
);
const quarrySupportTrip: DeliveryTripState = {
  ...inboundSupportTrip,
  id: 'quarry-support-inbound',
  targetBuildingId: largeQuarryBuilding.id,
  amount: LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(unsupportedLargeQuarryState, quarrySupportTrip),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /prepared chamber supports are approaching/,
);
const supportedLargeQuarryBuilding = {
  ...largeQuarryBuilding,
  timber: LARGE_QUARRY_SUPPORT_TARGET,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(supportedLargeQuarryBuilding),
  inspectorContext(
    inspectorGameState(supportedLargeQuarryBuilding, [richStoneAtQuarry]),
  ),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /Cutting rich stone from the non-depleting underground source/,
);
assert.match(
  supportedLargeQuarryInspector.detailsHtml,
  /1 timber per completed underground batch/,
);
const recalledUnsupportedLargeQuarry = {
  ...largeQuarryBuilding,
  id: 'large-quarry-recalled-without-supports',
  assignedLabor: 0,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(recalledUnsupportedLargeQuarry),
  inspectorContext(
    inspectorGameState(recalledUnsupportedLargeQuarry, [richStoneAtQuarry]),
  ),
);
assert.match(
  supportedLargeQuarryInspector.statusText,
  /await prepared timber supports/,
);
const recalledHeldLargeQuarry = {
  ...recalledUnsupportedLargeQuarry,
  id: 'large-quarry-recalled-at-target',
  processorOutputTargetPercent: 25,
  stone: 360,
};
supportedLargeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(recalledHeldLargeQuarry),
  inspectorContext(
    inspectorGameState(recalledHeldLargeQuarry, [richStoneAtQuarry]),
  ),
);
assert.match(supportedLargeQuarryInspector.statusText, /stone yard full/);
assert.equal(supportedLargeQuarryInspector.statusState, 'idle');
assert.match(
  supportedLargeQuarryInspector.detailsHtml,
  /Production interval<\/span><span>paused/,
);

const surfaceStone: ResourceNodeState = {
  ...richStoneAtQuarry,
  nodeId: 'quarry-ordinary-stone-inspector',
  x: 0,
  z: 0,
  remaining: 100,
  maxYield: 100,
  isRich: false,
};
const recalledHeldStoneCamp = mineBuilding({
  id: 'stone-camp-recalled-at-target',
  kind: 'stone_quarry',
  assignedLabor: 0,
  workRadius: 40,
  processorOutputTargetPercent: 25,
  stone: 180,
});
let stoneCampInspector = renderStoneQuarryInspector(
  buildingTarget(recalledHeldStoneCamp),
  inspectorContext(inspectorGameState(recalledHeldStoneCamp, [surfaceStone])),
);
assert.match(stoneCampInspector.statusText, /stone yard full/);
assert.equal(stoneCampInspector.statusState, 'idle');
assert.match(stoneCampInspector.detailsHtml, /Harvest interval<\/span><span>paused/);
const recalledSourceLessStoneCamp = {
  ...recalledHeldStoneCamp,
  id: 'stone-camp-recalled-without-source',
  processorOutputTargetPercent: 100,
  stone: 0,
};
stoneCampInspector = renderStoneQuarryInspector(
  buildingTarget(recalledSourceLessStoneCamp),
  inspectorContext(inspectorGameState(recalledSourceLessStoneCamp, [])),
);
assert.match(stoneCampInspector.statusText, /no unexhausted surface deposit in range/);
assert.equal(stoneCampInspector.statusState, 'warning');

const nearbySalt = mineralNode('deposit-salt-nearby', 'salt', 0, 0, 90, 90, false);
const fartherStone: ResourceNodeState = {
  ...nearbySalt,
  nodeId: 'quarry-stone-farther',
  resource: 'stone',
  x: 12,
};
assert.equal(
  findNearestResourceNodeWithRemaining(
    [nearbySalt, fartherStone],
    0,
    0,
    20,
    'quarry',
    'stone',
  )?.nodeId,
  fartherStone.nodeId,
  'stone queries must ignore a closer mineral landmark',
);

const sync = readFileSync(
  'src/data/spacetimeTableSync/syncQuarries.ts',
  'utf8',
);
assert.match(sync, /deposit-iron-/);
assert.match(sync, /deposit-salt-/);

const uiSurfaces = [
  'index.html',
  'src/ui/WorldSetupPanel.ts',
  'src/ui/SettlementHud.ts',
  'src/ui/buildMenuCards.ts',
  'src/resources/inspector/quarryRenderer.ts',
  'src/resources/inspector/mineralMineRenderer.ts',
].map((path) => readFileSync(path, 'utf8')).join('\n');
const buildingInspectorSource = readFileSync(
  'src/resources/inspector/buildingRenderer.ts',
  'utf8',
);
const quarryMapIconSource = readFileSync(
  'src/map/QuarryMapIcons.ts',
  'utf8',
);
const minimapResourceLayerSource = readFileSync(
  'src/map/illustratedMapLayers.ts',
  'utf8',
);
const worldMapUiSource = readFileSync(
  'src/app/worldMapIcons.ts',
  'utf8',
);
assert.match(
  quarryMapIconSource,
  /getGeologicalNodes[\s\S]*describeGeologicalMapMarker[\s\S]*reserveLevel/,
  'stone, iron, and salt projected icons must refresh from live geological rows',
);
assert.match(
  minimapResourceLayerSource,
  /geologicalNodeForMapMarker\(marker, state\.quarries\)[\s\S]*geologicalNode \?\? state\.foragingNodes/,
  'the minimap must resolve quarry and clay markers from geological rows rather than the foraging table',
);
assert.match(
  worldMapUiSource,
  /getGeologicalNodes:\s*\(\)\s*=>\s*getGameState\(\)\.quarries/,
  'the projected quarry layer must receive the authoritative live deposit map',
);
assert.match(
  buildingInspectorSource,
  /case 'mine':[\s\S]*renderMineralMineInspector/,
  'mine selection must route through the deposit-aware inspector',
);
assert.match(
  uiSurfaces,
  /rich iron, salt, or clay deposit/i,
  'player-facing UI must explain which rich deposits Mineworks can exploit',
);
assert.match(
  uiSurfaces,
  /Missing local materials can be imported through a staffed Trading Post/,
  'world setup must expose the attainable trade remedy when a regional roll omits a material',
);
assert.match(
  uiSurfaces,
  /Rich grades roll separately across every node/,
  'world setup must explain how rich grades are assigned in the current regional-resource model',
);
assert.match(
  uiSurfaces,
  /This seed's resource roll/,
  'world setup must present the selected seed result before world creation',
);
assert.match(
  uiSurfaces,
  /No rich roll/,
  'world setup must distinguish an absent rich grade from an absent local deposit',
);
for (const resource of ['stone', 'clay', 'iron', 'salt']) {
  assert.match(
    uiSurfaces,
    new RegExp(`data-resource=["']${resource}["']`),
    `world setup must give ${resource} its own readable survey card`,
  );
}
assert.match(
  uiSurfaces,
  /No local deposit in this roll; regional trade can supply it/,
  'every absent local deposit card must state its regional-trade recovery path',
);
assert.match(
  uiSurfaces,
  /Extracts iron, salt, and clay from rich underground deposits/,
  'the Mineworks card must identify all three of its rich physical outputs',
);
assert.match(
  uiSurfaces,
  /Extracts stone, iron, salt, and clay from nearby surface deposits/,
  'the Mining Camp card must identify all supported surface materials',
);
assert.match(
  uiSurfaces,
  /Excavates stone from rich deposits/,
  'the Quarry card must identify rich stone as its purpose',
);
assert.match(uiSurfaces, /Mineworks/);
assert.doesNotMatch(
  uiSurfaces,
  /Mineral mine/i,
  'player-facing extraction UI must use the Mineworks name consistently',
);
assert.doesNotMatch(
  uiSurfaces,
  /Some regions have local deposits; others must import/,
  'legacy import-only mineral guidance must not return',
);
assert.match(
  uiSurfaces,
  /\/assets\/ui\/build-menu\/cards\/iron-mine\.webp/,
  'the mine card must use its distinct generated artwork',
);

console.log(
  `geological extraction system tests passed (${geologicalMarkerProfileMs.toFixed(1)} ms / 100k marker reads)`,
);

function worldSettings(
  overrides: Partial<WorldGenerationSettings>,
): WorldGenerationSettings {
  return {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    ...overrides,
  };
}

function mineBuilding(
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id: 'mine-inspector',
    kind: 'mine',
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    flax: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    constructionPriority: 2,
    ...overrides,
  };
}

function mineralNode(
  nodeId: string,
  resource: 'iron' | 'salt',
  x: number,
  z: number,
  remaining: number,
  maxYield: number,
  isRich: boolean,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    x,
    z,
    remaining,
    maxYield,
    isRich,
  };
}

function inspectorGameState(
  building: BuildingState,
  deposits: ResourceNodeState[],
): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(deposits.map((deposit) => [deposit.nodeId, deposit])),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map([[building.id, building]]),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}

function buildingTarget(building: BuildingState) {
  return {
    kind: 'building' as const,
    building,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  };
}

function inspectorContext(
  state: GameState,
  inboundSupply: DeliveryTripState | null = null,
): InspectorRenderContext {
  const worldQueries = {
    getActiveDeliveryTrip: () => null,
    getInboundSupplyTrip: () => inboundSupply,
    getBuildingLabel: (kind: BuildingState['kind']) =>
      getBuildingDefinition(kind).label,
    getRoadAccessLabel: () => 'Road connected',
    findNearestQuarryWithRemaining: (
      x: number,
      z: number,
      radius: number,
    ) => [...state.quarries.values()]
      .filter(
        (deposit) =>
          deposit.resource === 'stone'
          && deposit.remaining > 1e-6
          && Math.hypot(deposit.x - x, deposit.z - z) <= radius,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - x, a.z - z)
          - Math.hypot(b.x - x, b.z - z),
      )[0] ?? null,
    findNearestSurfaceDepositWithRemaining: (
      x: number,
      z: number,
      radius: number,
    ) => [...state.quarries.values()]
      .filter(
        (deposit) =>
          deposit.remaining > 1e-6
          && Math.hypot(deposit.x - x, deposit.z - z) <= radius,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - x, a.z - z)
          - Math.hypot(b.x - x, b.z - z),
      )[0] ?? null,
  } as unknown as WorldQueries;
  return {
    gameState: state,
    worldQueries,
    populationStats: computePopulationStats(state),
    resourceTotals: computeResourceTotals(state),
    worldHydrology: 0.5,
  };
}
