import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeWorldBootstrapDataHeadless } from '../src/world/worldBootstrapData.ts';

const generatedDir = join(dirname(fileURLToPath(import.meta.url)), '../server/generated');
const treesPath = join(generatedDir, 'world_trees.json');
const quarriesPath = join(generatedDir, 'world_quarries.json');

const data = computeWorldBootstrapDataHeadless();
mkdirSync(generatedDir, { recursive: true });
writeFileSync(treesPath, JSON.stringify({ trees: data.trees }, null, 2));
writeFileSync(quarriesPath, JSON.stringify({ quarries: data.quarries }, null, 2));

console.log(`Wrote ${data.trees.length} trees to ${treesPath}`);
console.log(`Wrote ${data.quarries.length} quarries to ${quarriesPath}`);
