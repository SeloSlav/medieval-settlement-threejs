import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SURFACE_ID = process.env.GK_CAMP_SURFACE_ID ?? 'stitched_hide';
const MANIFEST_ID = process.env.GK_CAMP_MANIFEST_ID ?? 'gorski-camp-surfaces-v1';
const OUTPUT_ROOT = resolve(
  process.env.GK_CAMP_SURFACE_OUTPUT_ROOT
    ?? resolve(ROOT, 'public/assets/textures/buildings/gorski_camp_surfaces_v1'),
);
const SOURCE = resolve(OUTPUT_ROOT, `${SURFACE_ID}_imagegen_source.png`);
const METRES_PER_TILE = Number(process.env.GK_CAMP_METRES_PER_TILE ?? 1.6);
const SIZE = 1024;
const EDGE_BLEND = 112;
const vendorRequire = createRequire(resolve(ROOT, 'vendor/seedthree/package.json'));
const sharp = vendorRequire('sharp');

function clamp(value, minimum = 0, maximum = 255) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function makePeriodic(source, width, height, channels) {
  const output = Buffer.from(source);
  for (let distance = 0; distance < EDGE_BLEND; distance += 1) {
    const preserve = smoothstep(distance / (EDGE_BLEND - 1));
    for (let y = 0; y < height; y += 1) {
      const left = (y * width + distance) * channels;
      const right = (y * width + (width - 1 - distance)) * channels;
      for (let channel = 0; channel < channels; channel += 1) {
        const average = (source[left + channel] + source[right + channel]) * 0.5;
        output[left + channel] = Math.round(average * (1 - preserve) + source[left + channel] * preserve);
        output[right + channel] = Math.round(average * (1 - preserve) + source[right + channel] * preserve);
      }
    }
  }
  const horizontal = Buffer.from(output);
  for (let distance = 0; distance < EDGE_BLEND; distance += 1) {
    const preserve = smoothstep(distance / (EDGE_BLEND - 1));
    for (let x = 0; x < width; x += 1) {
      const top = (distance * width + x) * channels;
      const bottom = ((height - 1 - distance) * width + x) * channels;
      for (let channel = 0; channel < channels; channel += 1) {
        const average = (output[top + channel] + output[bottom + channel]) * 0.5;
        horizontal[top + channel] = Math.round(average * (1 - preserve) + output[top + channel] * preserve);
        horizontal[bottom + channel] = Math.round(average * (1 - preserve) + output[bottom + channel] * preserve);
      }
    }
  }
  return horizontal;
}

function periodicSample(buffer, width, height, x, y) {
  const wrappedX = (x + width) % width;
  const wrappedY = (y + height) % height;
  return buffer[wrappedY * width + wrappedX];
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const decoded = await sharp(SOURCE)
    .resize(SIZE, SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const albedo = makePeriodic(decoded.data, SIZE, SIZE, 3);
  const albedoPath = resolve(OUTPUT_ROOT, `${SURFACE_ID}_albedo.png`);
  await sharp(albedo, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(albedoPath);

  const luma = Buffer.alloc(SIZE * SIZE);
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 3;
    luma[index] = Math.round(
      albedo[offset] * 0.2126 + albedo[offset + 1] * 0.7152 + albedo[offset + 2] * 0.0722,
    );
  }
  const broad = await sharp(luma, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .blur(9)
    .raw()
    .toBuffer();
  const height = Buffer.alloc(SIZE * SIZE);
  for (let index = 0; index < height.length; index += 1) {
    height[index] = Math.round(clamp(128 + (luma[index] - broad[index]) * 1.7));
  }

  const normal = Buffer.alloc(SIZE * SIZE * 3);
  const packed = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const index = y * SIZE + x;
      const dx = (
        periodicSample(height, SIZE, SIZE, x + 1, y - 1)
        + 2 * periodicSample(height, SIZE, SIZE, x + 1, y)
        + periodicSample(height, SIZE, SIZE, x + 1, y + 1)
        - periodicSample(height, SIZE, SIZE, x - 1, y - 1)
        - 2 * periodicSample(height, SIZE, SIZE, x - 1, y)
        - periodicSample(height, SIZE, SIZE, x - 1, y + 1)
      ) / 255;
      const dy = (
        periodicSample(height, SIZE, SIZE, x - 1, y + 1)
        + 2 * periodicSample(height, SIZE, SIZE, x, y + 1)
        + periodicSample(height, SIZE, SIZE, x + 1, y + 1)
        - periodicSample(height, SIZE, SIZE, x - 1, y - 1)
        - 2 * periodicSample(height, SIZE, SIZE, x, y - 1)
        - periodicSample(height, SIZE, SIZE, x + 1, y - 1)
      ) / 255;
      const nx = -dx * 1.9;
      const ny = dy * 1.9;
      const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const normalOffset = index * 3;
      normal[normalOffset] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
      normal[normalOffset + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
      normal[normalOffset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);

      const cavity = Math.max(0, broad[index] - luma[index]);
      const packedOffset = index * 4;
      packed[packedOffset] = Math.round(clamp(225 + Math.abs(luma[index] - broad[index]) * 0.28, 214, 247));
      packed[packedOffset + 1] = 0;
      packed[packedOffset + 2] = Math.round(clamp(255 - cavity * 1.55, 168, 255));
      packed[packedOffset + 3] = height[index];
    }
  }

  const normalPath = resolve(OUTPUT_ROOT, `${SURFACE_ID}_normal.png`);
  const materialPath = resolve(OUTPUT_ROOT, `${SURFACE_ID}_material.png`);
  await Promise.all([
    sharp(normal, { raw: { width: SIZE, height: SIZE, channels: 3 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(normalPath),
    sharp(packed, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(materialPath),
  ]);

  const files = {};
  for (const path of [albedoPath, normalPath, materialPath]) {
    const bytes = await readFile(path);
    files[path.split(/[\\/]/).at(-1)] = { bytes: bytes.length, sha256: await sha256(path) };
  }
  await writeFile(resolve(OUTPUT_ROOT, 'manifest.json'), `${JSON.stringify({
    id: MANIFEST_ID,
    generatedAt: new Date().toISOString(),
    source: `${SURFACE_ID}_imagegen_source.png`,
    sourceMethod: 'OpenAI built-in image generation; periodic edge reconciliation and derived PBR channels',
    dimensions: { width: SIZE, height: SIZE },
    metersPerTile: METRES_PER_TILE,
    channels: {
      albedo: 'sRGB RGB',
      normal: 'OpenGL tangent-space RGB',
      material: 'R=roughness, G=metalness, B=height-derived ambient occlusion, A=centered height',
    },
    files,
  }, null, 2)}\n`);
  console.log(`Prepared ${SURFACE_ID} PBR surface in ${OUTPUT_ROOT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
