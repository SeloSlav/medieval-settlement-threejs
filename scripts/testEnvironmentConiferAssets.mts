import assert from 'node:assert/strict';
import { MeshStandardMaterial, Vector3 } from 'three';
import { GORSKI_KOTAR_SPECIES } from '../src/vegetation/seedthree/gorskiKotarPresets.ts';
import { ENVIRONMENT_CONIFER_TRIAL } from '../src/e2e/environmentConiferTrial.ts';
import { Rng } from '../vendor/seedthree/src/core/rng.js';
import { generateSkeleton } from '../vendor/seedthree/src/core/weber-penn.js';
import { buildFoliage } from '../vendor/seedthree/src/core/leaf-cards.js';
import { planBranchCardCrownUnderlay } from '../vendor/seedthree/src/core/branch-cards.js';

// Compare the review-only authoring with the unchanged production defaults.
// This geometry check does not authorize installing the trial by itself.
const controls = {
  douglasFir: { leavesPerBranch: 10, size: 0.6, startFrac: 0.15 },
  loblolly: { leavesPerBranch: 8, size: 0.85, startFrac: 0.2 },
  pine: { leavesPerBranch: 9, size: 0.7, startFrac: 0.15 },
};
const material = new MeshStandardMaterial();
const results = [];
for (const [key, control] of Object.entries(controls)) {
  const species = GORSKI_KOTAR_SPECIES[key];
  const trialFoliage = { ...species.foliage, ...ENVIRONMENT_CONIFER_TRIAL[key] };
  for (const seed of [17, 4096, 98765]) {
    const { stems } = generateSkeleton(species.params, new Rng(`${species.name}:${seed}`));
    const terminals = stems.filter(stem => stem.level === stem.maxLevel);
    const build = foliage => buildFoliage(terminals, foliage, new Rng(`${species.name}:${seed}:foliage0`), material, { value: new Vector3() });
    const baseline = build({ ...species.foliage, ...control });
    const candidate = build(trialFoliage);
    const repeated = build(trialFoliage);
    assert.ok(candidate.count <= baseline.count, `${key}/${seed}: close foliage instance budget increased`);
    assert.equal(candidate.geometry.index.count, baseline.geometry.index.count, 'each spray retains the same crossed-card topology');
    assert.deepEqual(candidate.instanceMatrix.array, repeated.instanceMatrix.array, 'foliage authoring must be deterministic');
    assert.ok(candidate.instanceMatrix.array.every(Number.isFinite), `${key}/${seed}: invalid card transform`);
    candidate.computeBoundingBox();
    baseline.computeBoundingBox();
    const candidateSize = candidate.boundingBox.getSize(new Vector3());
    const baselineSize = baseline.boundingBox.getSize(new Vector3());
    assert.ok(candidateSize.x < baselineSize.x * 1.2 && candidateSize.z < baselineSize.z * 1.2, 'fuller sprays must not turn the tree into a much wider collision silhouette');
    assert.ok(candidateSize.y < baselineSize.y + 2, 'foliage cannot add an oversized false leader');
    const oldPlan = planBranchCardCrownUnderlay({ ...species.foliage, ...control }, 1);
    assert.deepEqual(planBranchCardCrownUnderlay(trialFoliage, 1), oldPlan, 'canopy underlay topology and policy are preserved');
    results.push({ key, seed, baselineInstances: baseline.count, instances: candidate.count, width: Number(candidateSize.x.toFixed(2)), height: Number(candidateSize.y.toFixed(2)) });
    for (const mesh of [baseline, candidate, repeated]) mesh.geometry.dispose();
  }
}
material.dispose();
console.log(JSON.stringify({ passed: true, cases: results }, null, 2));
