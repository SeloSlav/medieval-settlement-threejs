#!/usr/bin/env node
/** Install FAL PATINA field-soil candidates as runtime PBR state sets. */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const REVIEW_ROOT = join(ROOT, 'artifacts', 'pbr-material-review', 'patina-candidates');
const TARGET_ROOT = join(ROOT, 'public', 'assets', 'textures', 'terrain', 'field_soil_states_v1');

const materials = [
  { state: 'ploughed', slug: 'field-soil-fresh-ploughed-v1', normalStrength: 0.58, roughness: [0.74, 0.96], metresPerTile: 2.8 },
  { state: 'seedbed', slug: 'field-soil-fine-seedbed-v1', normalStrength: 0.4, roughness: [0.84, 0.99], metresPerTile: 2.4 },
  { state: 'fallow', slug: 'field-soil-weathered-fallow-v1', normalStrength: 0.34, roughness: [0.82, 0.99], metresPerTile: 3.2 },
  { state: 'harvested', slug: 'field-soil-dry-harvested-v3', normalStrength: 0.32, roughness: [0.86, 1], metresPerTile: 2.9 },
];

async function magick(...args) {
  await execFileAsync('magick', args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
}

async function channelMean(path, channel) {
  const { stdout } = await execFileAsync(
    'magick',
    [path, '-alpha', 'off', '-format', `%[fx:mean.${channel}]`, 'info:'],
    { windowsHide: true },
  );
  return Number.parseFloat(stdout.trim());
}

async function prepareRuntimeNormal(source, target, strength, temporaryRoot) {
  const meanR = await channelMean(source, 'r');
  const meanG = await channelMean(source, 'g');
  const red = join(temporaryRoot, 'normal-r.png');
  const green = join(temporaryRoot, 'normal-g.png');
  const blue = join(temporaryRoot, 'normal-b.png');
  await magick(source, '-alpha', 'off', '-channel', 'R', '-separate',
    '-fx', `clamp(0.5 + (u - ${meanR}) * ${strength})`, red);
  await magick(source, '-alpha', 'off', '-channel', 'G', '-separate',
    '-fx', `clamp(0.5 + ((${meanG}) - u) * ${strength})`, green);
  await magick(source, '-alpha', 'off', '-channel', 'B', '-separate',
    '-fill', 'white', '-colorize', '100', blue);
  await magick(red, green, blue, '-combine', '-define', 'png:color-type=2', target);
  return {
    greenChannelFlipped: true,
    meanTiltRemoved: true,
    xyStrength: strength,
    sourceMeanRG: [Number(meanR.toFixed(6)), Number(meanG.toFixed(6))],
  };
}

async function prepareRoughness(source, target, minimum, maximum) {
  await magick(
    source, '-alpha', 'off', '-colorspace', 'Gray',
    '-fx', `${minimum}+(${maximum - minimum})*u`,
    '-define', 'png:color-type=0', target,
  );
}

async function deriveAo(source, target) {
  // PATINA height owns the same clods as the other maps. This conservative
  // remap keeps cavities darker without introducing an unrelated noise field.
  await magick(
    source, '-alpha', 'off', '-colorspace', 'Gray',
    '-fx', '0.68+0.32*u', '-define', 'png:color-type=0', target,
  );
}

async function prepareMetalness(source, target) {
  await magick(
    source, '-alpha', 'off', '-colorspace', 'Gray',
    '-fill', 'black', '-colorize', '100',
    '-define', 'png:color-type=0', target,
  );
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function install(material, temporaryRoot) {
  const source = join(REVIEW_ROOT, material.slug);
  const target = join(TARGET_ROOT, material.state);
  await mkdir(target, { recursive: true });
  await copyFile(join(source, 'basecolor.png'), join(target, 'albedo.png'));
  const normalProcessing = await prepareRuntimeNormal(
    join(source, 'normal.png'), join(target, 'normal.png'),
    material.normalStrength, temporaryRoot,
  );
  await prepareRoughness(
    join(source, 'roughness.png'), join(target, 'roughness.png'),
    material.roughness[0], material.roughness[1],
  );
  await copyFile(join(source, 'height.png'), join(target, 'height.png'));
  await deriveAo(join(source, 'height.png'), join(target, 'ao.png'));
  await prepareMetalness(join(source, 'basecolor.png'), join(target, 'metalness.png'));
  await copyFile(join(source, 'generation.json'), join(target, 'generation.json'));
  const fileNames = ['albedo.png', 'normal.png', 'roughness.png', 'ao.png', 'height.png', 'metalness.png'];
  const files = Object.fromEntries(await Promise.all(fileNames.map(async (name) => [
    name, await sha256(join(target, name)),
  ])));
  const metadata = {
    state: material.state,
    sourceModel: 'fal-ai/patina/material',
    reviewCandidate: material.slug,
    metresPerTile: material.metresPerTile,
    normalProcessing,
    roughnessRange: material.roughness,
    metalness: 0,
    maps: files,
  };
  await writeFile(join(target, 'runtime-material.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(join(target, 'README.md'), `# ${material.state[0].toUpperCase()}${material.state.slice(1)} field soil PBR

- Generated by \`fal-ai/patina/material\` from \`${material.slug}\`.
- Physical texture scale: \`${material.metresPerTile.toFixed(1)}\` metres per tile.
- Base color is sRGB; normal, roughness, AO, height, and metalness are linear.
- Runtime normal flips PATINA's green channel, removes mean tilt, and limits XY relief to \`${material.normalStrength.toFixed(2)}\`.
- Roughness is constrained to \`${material.roughness[0].toFixed(2)}–${material.roughness[1].toFixed(2)}\`; metalness is zero.
- Raw API output and its exact prompt remain in \`artifacts/pbr-material-review/patina-candidates/${material.slug}/\`.
`);
  return metadata;
}

async function main() {
  await mkdir(TARGET_ROOT, { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'field-soil-pbr-'));
  try {
    const installed = [];
    for (const material of materials) installed.push(await install(material, temporaryRoot));
    const manifest = {
      version: 1,
      coordinateDomain: 'world-xz-metres',
      antiTiling: 'shared low-frequency coordinate warp across all PBR channels',
      edgeTransition: 'continuous fieldEdgeBlend alpha over a deterministic irregular metre-scale band',
      states: Object.fromEntries(installed.map((entry) => [entry.state, entry])),
      growing: {
        source: '../mammoth_terrain_dirt',
        reason: 'Established crop soil reuses the approved backyard garden-bed loam.',
        metresPerTile: 2.2,
      },
      unploughed: {
        source: 'native terrain',
        reason: 'Unworked land does not receive an artificial cultivated-soil overlay.',
      },
    };
    await writeFile(join(TARGET_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Installed ${installed.length} field-soil PBR state sets in ${TARGET_ROOT}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
