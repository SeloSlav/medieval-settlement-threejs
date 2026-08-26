import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RAW_ROOT = join(ROOT, 'artifacts', 'pbr-material-review', 'patina-candidates');
const OUTPUT_ROOT = join(
  ROOT,
  'public',
  'assets',
  'textures',
  'buildings',
  'gorski_building_atlas_v1',
);
const vendorRequire = createRequire(resolve(ROOT, 'vendor', 'seedthree', 'package.json'));
const sharp = vendorRequire('sharp');

const COLUMNS = 5;
const ROWS = 4;
const CELL_SIZE = 512;
const GUTTER = 32;
const CONTENT_SIZE = CELL_SIZE - GUTTER * 2;
const ATLAS_WIDTH = COLUMNS * CELL_SIZE;
const ATLAS_HEIGHT = ROWS * CELL_SIZE;

const materials = [
  tile('lime-plaster', 'building-lime-plaster', 'Hand-trowelled lime plaster', [0.84, 0.98], 0, 0.48),
  tile('limestone-ashlar', 'building-limestone-ashlar', 'Limestone ashlar masonry', [0.78, 0.96], 0, 0.68),
  tile('fieldstone-mortar', 'building-fieldstone-mortar', 'Fieldstone and lime mortar', [0.82, 0.98], 0, 0.72),
  tile('quarry-stone', 'building-quarry-stone', 'Rough quarry stone', [0.80, 0.97], 0, 0.72),
  tile('rough-hewn-timber', 'building-rough-hewn-timber', 'Rough-hewn structural timber', [0.72, 0.94], 0, 0.62),
  tile('sawn-planks', 'building-sawn-planks', 'Sawn oak planks', [0.68, 0.91], 0, 0.56),
  tile('weathered-planks', 'building-weathered-planks', 'Weathered exterior planks', [0.79, 0.97], 0, 0.66),
  tile('stacked-log-wall', 'building-stacked-log-wall', 'Stacked timber wall', [0.76, 0.96], 0, 0.65),
  tile('wicker-weave', 'building-wicker-weave', 'Wattle and wicker weave', [0.80, 0.98], 0, 0.58),
  tile('split-shingles', 'building-split-shingles', 'Split wooden roof shingles', [0.82, 0.99], 0, 0.72),
  tile('clay-roof-tiles', 'building-clay-roof-tiles', 'Handmade clay roof tiles', [0.70, 0.92], 0, 0.72),
  tile('thatch-roof', 'building-thatch-roof', 'Bundled reed thatch', [0.88, 1], 0, 0.78),
  tile('slate-roof', 'building-slate-roof', 'Hand-split slate roof', [0.72, 0.93], 0.02, 0.64),
  tile('packed-earth', 'building-packed-earth', 'Packed workshop earth', [0.84, 0.99], 0, 0.52),
  tile('linen-canvas', 'building-linen-canvas', 'Heavy linen canvas', [0.86, 0.99], 0, 0.46),
  tile('wrought-iron', 'building-wrought-iron', 'Hand-forged wrought iron', [0.42, 0.68], [0.72, 0.94], 0.54),
  tile('aged-brass', 'building-aged-brass', 'Hammered aged brass', [0.34, 0.62], [0.68, 0.92], 0.5),
  tile('fired-clay', 'building-fired-clay', 'Unglazed fired clay', [0.74, 0.94], 0, 0.55),
  tile('mossy-surface', 'building-mossy-surface', 'Thin roof and wall moss', [0.88, 1], 0, 0.55),
  tile('turf-roof', 'building-turf-roof', 'Short turf roof', [0.86, 0.99], 0, 0.54),
];

function tile(id, slug, label, roughnessRange, metalness, normalStrength) {
  return { id, slug, label, roughnessRange, metalness, normalStrength };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

async function decodedRgb(path) {
  return sharp(path)
    .resize(CONTENT_SIZE, CONTENT_SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function decodedLuminance(path) {
  return sharp(path)
    .resize(CONTENT_SIZE, CONTENT_SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function prepareNormal(decoded, strength) {
  const source = decoded.data;
  const count = CONTENT_SIZE * CONTENT_SIZE;
  let meanX = 0;
  let meanY = 0;
  for (let index = 0; index < count; index += 1) {
    meanX += source[index * 3] / 127.5 - 1;
    meanY += -(source[index * 3 + 1] / 127.5 - 1);
  }
  meanX /= count;
  meanY /= count;
  const output = Buffer.alloc(count * 3);
  for (let index = 0; index < count; index += 1) {
    const nx = (source[index * 3] / 127.5 - 1 - meanX) * strength;
    const ny = (-(source[index * 3 + 1] / 127.5 - 1) - meanY) * strength;
    const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    output[index * 3] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
    output[index * 3 + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
    output[index * 3 + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
  }
  return { data: output, channels: 3 };
}

async function preparePackedMaterial(material) {
  const sourceRoot = join(RAW_ROOT, material.slug);
  const [roughness, metalness, height] = await Promise.all([
    decodedLuminance(join(sourceRoot, 'roughness.png')),
    decodedLuminance(join(sourceRoot, 'metalness.png')),
    decodedLuminance(join(sourceRoot, 'height.png')),
  ]);
  const blurredHeight = await sharp(height.data, {
    raw: { width: CONTENT_SIZE, height: CONTENT_SIZE, channels: 1 },
  }).blur(7).raw().toBuffer();
  const output = Buffer.alloc(CONTENT_SIZE * CONTENT_SIZE * 4);
  const [roughMinimum, roughMaximum] = material.roughnessRange;
  const heightMean = height.data.reduce((sum, value) => sum + value, 0) / height.data.length;
  for (let index = 0; index < height.data.length; index += 1) {
    const rough = roughMinimum
      + (roughMaximum - roughMinimum) * (roughness.data[index] / 255);
    let metal = material.metalness;
    if (Array.isArray(material.metalness)) {
      metal = material.metalness[0]
        + (material.metalness[1] - material.metalness[0]) * (metalness.data[index] / 255);
    }
    const cavity = Math.max(0, blurredHeight[index] - height.data[index]);
    const ao = clamp(255 - cavity * 1.8, 160, 255);
    const centeredHeight = clamp(Math.round(height.data[index] + 127.5 - heightMean), 0, 255);
    output[index * 4] = Math.round(rough * 255);
    output[index * 4 + 1] = Math.round(metal * 255);
    output[index * 4 + 2] = Math.round(ao);
    output[index * 4 + 3] = centeredHeight;
  }
  return { data: output, channels: 4 };
}

function copyWrappedCell(target, targetChannels, source, sourceChannels, tileIndex) {
  const column = tileIndex % COLUMNS;
  const row = Math.floor(tileIndex / COLUMNS);
  for (let cellY = 0; cellY < CELL_SIZE; cellY += 1) {
    const sourceY = (cellY - GUTTER + CONTENT_SIZE) % CONTENT_SIZE;
    const atlasY = row * CELL_SIZE + cellY;
    for (let cellX = 0; cellX < CELL_SIZE; cellX += 1) {
      const sourceX = (cellX - GUTTER + CONTENT_SIZE) % CONTENT_SIZE;
      const atlasX = column * CELL_SIZE + cellX;
      const sourceOffset = (sourceY * CONTENT_SIZE + sourceX) * sourceChannels;
      const targetOffset = (atlasY * ATLAS_WIDTH + atlasX) * targetChannels;
      for (let channel = 0; channel < targetChannels; channel += 1) {
        target[targetOffset + channel] = source[sourceOffset + channel];
      }
    }
  }
}

async function saveAtlas(data, channels, filename) {
  const outputPath = join(OUTPUT_ROOT, filename);
  await sharp(data, {
    raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath);
  return outputPath;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const albedoAtlas = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 3);
  const normalAtlas = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 3);
  const materialAtlas = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const manifestTiles = [];

  for (const [index, material] of materials.entries()) {
    const sourceRoot = join(RAW_ROOT, material.slug);
    const [albedo, rawNormal, packed] = await Promise.all([
      decodedRgb(join(sourceRoot, 'basecolor.png')),
      decodedRgb(join(sourceRoot, 'normal.png')),
      preparePackedMaterial(material),
    ]);
    const normal = prepareNormal(rawNormal, material.normalStrength);
    copyWrappedCell(albedoAtlas, 3, albedo.data, 3, index);
    copyWrappedCell(normalAtlas, 3, normal.data, 3, index);
    copyWrappedCell(materialAtlas, 4, packed.data, 4, index);
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    manifestTiles.push({
      id: material.id,
      label: material.label,
      patinaCandidate: material.slug,
      index,
      column,
      rowTopToBottom: row,
      metersPerTile: suggestedMetersPerTile(material.id),
      contentPixels: {
        x: column * CELL_SIZE + GUTTER,
        y: row * CELL_SIZE + GUTTER,
        width: CONTENT_SIZE,
        height: CONTENT_SIZE,
      },
      roughnessRange: material.roughnessRange,
      metalness: material.metalness,
      normalStrength: material.normalStrength,
    });
    console.log(`[${material.id}] packed`);
  }

  const [albedoPath, normalPath, materialPath] = await Promise.all([
    saveAtlas(albedoAtlas, 3, 'building_albedo_atlas.png'),
    saveAtlas(normalAtlas, 3, 'building_normal_atlas.png'),
    saveAtlas(materialAtlas, 4, 'building_material_atlas.png'),
  ]);
  const files = {};
  for (const path of [albedoPath, normalPath, materialPath]) {
    const bytes = await readFile(path);
    files[path.split(/[\\/]/).at(-1)] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  const manifest = {
    id: 'gorski-building-atlas-v1',
    generator: 'fal-ai/patina/material',
    generatedAt: new Date().toISOString(),
    dimensions: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT },
    grid: { columns: COLUMNS, rows: ROWS, cellSize: CELL_SIZE, gutter: GUTTER, contentSize: CONTENT_SIZE },
    channels: {
      albedo: 'sRGB RGB',
      normal: 'OpenGL tangent-space RGB; Patina green flipped, mean tilt removed, Z reconstructed',
      material: 'R=roughness, G=metalness, B=height-derived ambient occlusion, A=centered height',
    },
    files,
    tiles: manifestTiles,
  };
  await writeFile(join(OUTPUT_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(OUTPUT_ROOT, 'README.md'), [
    '# Gorski building material atlas v1',
    '',
    'Twenty seamless, physically coherent building surfaces generated with `fal-ai/patina/material`.',
    'Every 512 px cell contains a 448 px repeating surface plus a 32 px wrapped gutter on all sides.',
    'Runtime sampling uses fractional metric UVs constrained to the content rectangle so material repeats cannot bleed into neighboring cells.',
    '',
    '- `building_albedo_atlas.png`: sRGB base color.',
    '- `building_normal_atlas.png`: corrected OpenGL tangent-space normals.',
    '- `building_material_atlas.png`: R roughness, G metalness, B AO, A centered height.',
    '- `manifest.json`: tile identities, physical scale, response ranges, and source candidates.',
    '',
    'Raw Patina results and request metadata remain under `artifacts/pbr-material-review/patina-candidates/building-*`.',
    '',
  ].join('\n'));
  console.log(`Saved ${materials.length} tiles to ${OUTPUT_ROOT}`);
}

function suggestedMetersPerTile(id) {
  if (id.includes('plaster')) return 2.6;
  if (id.includes('ashlar') || id.includes('fieldstone') || id.includes('quarry')) return 2.4;
  if (id.includes('shingles') || id.includes('tiles') || id.includes('slate')) return 2.2;
  if (id.includes('thatch')) return 1.6;
  if (id.includes('canvas') || id.includes('iron') || id.includes('brass') || id.includes('clay')) return 1.2;
  if (id.includes('moss') || id.includes('turf')) return 1.4;
  if (id.includes('earth')) return 2;
  if (id.includes('wicker')) return 1.1;
  return 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
