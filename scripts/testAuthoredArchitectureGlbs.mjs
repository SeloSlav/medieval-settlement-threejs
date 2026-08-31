import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const buildingMeshes = readFileSync('src/buildings/BuildingMeshes.ts', 'utf8');
const buildingMarkers = readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');
const residenceMarkers = readFileSync('src/residences/ResidenceMarkers.ts', 'utf8');
const finalizer = readFileSync('src/buildings/proceduralArchitecture/finalize.ts', 'utf8');
const coverageGate = readFileSync('scripts/testProceduralArchitectureCoverage.mts', 'utf8');
const publicAssetFilter = readFileSync('scripts/productionPublicAssets.ts', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');

assert.match(
  buildingMeshes,
  /satisfies Record<BuildingKind, ProceduralBuildingGenerator>/,
  'the gameplay registry must stay exhaustive over every canonical BuildingKind',
);
assert.match(
  buildingMarkers,
  /createBuildingMesh\(\s*building\.kind,/,
  'completed placeable buildings must enter through the procedural registry',
);
assert.doesNotMatch(
  buildingMeshes,
  /authoredArchitectureModels|GLTFLoader|\.glb['"]|createAuthored/,
  'the gameplay building registry must not import or select authored architecture GLBs',
);
assert.match(
  residenceMarkers,
  /completedTier == null[\s\S]*createInitialResidenceConstructionMesh\(appearanceSeed\)[\s\S]*createResidenceMesh\(/,
  'residences must select procedural construction and completed-tier generators',
);
assert.match(
  finalizer,
  /delete root\.userData\.authoredGlbAsset[\s\S]*delete root\.userData\.authoredGlbVersion[\s\S]*delete root\.userData\.authoredGlbUrl/,
  'procedural finalization must reject stale authored-model metadata',
);
assert.match(
  coverageGate,
  /authoredGlbAsset[\s\S]*authoredGlbVersion[\s\S]*authoredGlbUrl/,
  'lineup coverage must keep auditing the absence of authored-model metadata',
);

assert.match(
  publicAssetFilter,
  /ARCHITECTURE_REFERENCE_ROOT = 'assets\/models\/buildings\/gorski'/,
  'normal production copies must recognize the dormant architecture-reference root',
);
assert.match(
  publicAssetFilter,
  /if \(insideArchitectureReferences\) return includeArchitectureReferences/,
  'normal production copies must exclude architecture references unless explicitly requested',
);
assert.match(
  viteConfig,
  /includeArchitectureReferences = includeQaArchives \|\| mode === 'e2e'/,
  'only E2E and visual-reference builds may copy authored architecture comparison assets',
);

console.log('procedural architecture runtime gate passed: gameplay has no authored-building GLB dependency');
