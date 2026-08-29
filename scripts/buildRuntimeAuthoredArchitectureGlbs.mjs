import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(
  repositoryRoot,
  'public',
  'assets',
  'models',
  'buildings',
  'gorski',
);

const jobs = [
  {
    source: path.join(
      repositoryRoot,
      'art-source',
      'gorski-architecture-kit',
      'examples',
      'tier1-residence',
      'out',
      'tier1_residence_retopo_v25.glb',
    ),
    output: path.join(outputDirectory, 'tier1_residence_retopo_v25.glb'),
  },
  {
    source: path.join(
      repositoryRoot,
      'art-source',
      'gorski-architecture-kit',
      'examples',
      'hunters-camp',
      'out',
      'hunters_camp_textured_v6.glb',
    ),
    output: path.join(outputDirectory, 'hunters_camp_textured_v6.glb'),
  },
];

const externalImages = new Map([
  [
    'building_albedo_atlas',
    '../../../textures/buildings/gorski_building_atlas_v1/building_albedo_atlas.png',
  ],
  [
    'building_normal_atlas',
    '../../../textures/buildings/gorski_building_atlas_v1/building_normal_atlas.png',
  ],
  [
    'building_material_atlas',
    '../../../textures/buildings/gorski_building_atlas_v1/building_material_atlas.png',
  ],
  [
    'aged_canvas_albedo',
    '../../../textures/buildings/gorski_camp_canvas_v1/aged_canvas_albedo.png',
  ],
  [
    'aged_canvas_normal',
    '../../../textures/buildings/gorski_camp_canvas_v1/aged_canvas_normal.png',
  ],
  [
    'aged_canvas_material',
    '../../../textures/buildings/gorski_camp_canvas_v1/aged_canvas_material.png',
  ],
  [
    'stitched_hide_albedo',
    '../../../textures/buildings/gorski_camp_surfaces_v1/stitched_hide_albedo.png',
  ],
  [
    'stitched_hide_normal',
    '../../../textures/buildings/gorski_camp_surfaces_v1/stitched_hide_normal.png',
  ],
  [
    'stitched_hide_material',
    '../../../textures/buildings/gorski_camp_surfaces_v1/stitched_hide_material.png',
  ],
]);

fs.mkdirSync(outputDirectory, { recursive: true });
for (const job of jobs) {
  const sourceBytes = fs.readFileSync(job.source);
  const { json, binary } = parseGlb(sourceBytes);
  const embeddedImageViews = new Set(
    (json.images ?? [])
      .map((image) => image.bufferView)
      .filter((value) => Number.isInteger(value)),
  );

  stripRuntimeOwnedTextureBindings(json);
  compactTextureTables(json);
  externalizeImages(json);
  json.asset.extras = {
    ...(json.asset.extras ?? {}),
    runtimeVariant: 'external-shared-textures',
    sourceGlb: path.basename(job.source),
  };

  const rebuiltBinary = rebuildBinaryBuffer(json, binary, embeddedImageViews);
  const outputBytes = encodeGlb(json, rebuiltBinary);
  fs.writeFileSync(job.output, outputBytes);
  console.log(
    `${path.basename(job.output)}: ${formatMiB(sourceBytes.length)} -> ${formatMiB(outputBytes.length)}`,
  );
}

function stripRuntimeOwnedTextureBindings(json) {
  for (const material of json.materials ?? []) {
    const atlasId = material.extras?.atlas_id;
    const pbr = material.pbrMetallicRoughness ?? {};
    // The production building atlas is already resident and has a game-specific
    // packed channel contract. Runtime code reattaches those shared handles.
    if (atlasId === 'gorski-building-atlas-v1') {
      delete pbr.baseColorTexture;
      delete material.normalTexture;
    }
    // R=roughness/G=metalness/B=AO is intentionally not glTF's metallic-
    // roughness channel order. Runtime materials keep authored scalar values
    // and never ask GLTFLoader to interpret this packed map incorrectly.
    delete pbr.metallicRoughnessTexture;
    delete material.occlusionTexture;
    material.pbrMetallicRoughness = pbr;
  }
}

function compactTextureTables(json) {
  const referencedTextures = new Set();
  for (const material of json.materials ?? []) {
    collectTextureIndex(material.pbrMetallicRoughness?.baseColorTexture, referencedTextures);
    collectTextureIndex(material.pbrMetallicRoughness?.metallicRoughnessTexture, referencedTextures);
    collectTextureIndex(material.normalTexture, referencedTextures);
    collectTextureIndex(material.occlusionTexture, referencedTextures);
    collectTextureIndex(material.emissiveTexture, referencedTextures);
  }

  const textureRemap = new Map();
  const textures = [];
  for (const oldIndex of [...referencedTextures].sort((left, right) => left - right)) {
    const texture = json.textures?.[oldIndex];
    if (!texture) throw new Error(`Missing referenced texture ${oldIndex}`);
    textureRemap.set(oldIndex, textures.length);
    textures.push({ ...texture });
  }
  for (const material of json.materials ?? []) {
    remapTextureInfo(material.pbrMetallicRoughness?.baseColorTexture, textureRemap);
    remapTextureInfo(material.pbrMetallicRoughness?.metallicRoughnessTexture, textureRemap);
    remapTextureInfo(material.normalTexture, textureRemap);
    remapTextureInfo(material.occlusionTexture, textureRemap);
    remapTextureInfo(material.emissiveTexture, textureRemap);
  }

  const imageRemap = new Map();
  const images = [];
  const samplerRemap = new Map();
  const samplers = [];
  for (const texture of textures) {
    if (Number.isInteger(texture.source)) {
      if (!imageRemap.has(texture.source)) {
        const image = json.images?.[texture.source];
        if (!image) throw new Error(`Missing referenced image ${texture.source}`);
        imageRemap.set(texture.source, images.length);
        images.push({ ...image });
      }
      texture.source = imageRemap.get(texture.source);
    }
    if (Number.isInteger(texture.sampler)) {
      if (!samplerRemap.has(texture.sampler)) {
        const sampler = json.samplers?.[texture.sampler];
        if (!sampler) throw new Error(`Missing referenced sampler ${texture.sampler}`);
        samplerRemap.set(texture.sampler, samplers.length);
        samplers.push({ ...sampler });
      }
      texture.sampler = samplerRemap.get(texture.sampler);
    }
  }

  if (textures.length > 0) json.textures = textures;
  else delete json.textures;
  if (images.length > 0) json.images = images;
  else delete json.images;
  if (samplers.length > 0) json.samplers = samplers;
  else delete json.samplers;
}

function externalizeImages(json) {
  for (const image of json.images ?? []) {
    const uri = externalImages.get(image.name);
    if (!uri) throw new Error(`No production texture URI registered for ${image.name}`);
    const diskPath = path.resolve(outputDirectory, uri.replaceAll('/', path.sep));
    if (!fs.existsSync(diskPath)) {
      throw new Error(`Production texture is missing: ${diskPath}`);
    }
    image.uri = uri;
    delete image.bufferView;
    delete image.mimeType;
  }
}

function rebuildBinaryBuffer(json, originalBinary, embeddedImageViews) {
  const chunks = [];
  let cursor = 0;
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    const padding = (4 - (cursor % 4)) % 4;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
      cursor += padding;
    }
    const data = embeddedImageViews.has(index)
      ? Buffer.alloc(4)
      : originalBinary.subarray(
          view.byteOffset ?? 0,
          (view.byteOffset ?? 0) + view.byteLength,
        );
    view.byteOffset = cursor;
    view.byteLength = data.length;
    chunks.push(data);
    cursor += data.length;
  }
  const tailPadding = (4 - (cursor % 4)) % 4;
  if (tailPadding > 0) chunks.push(Buffer.alloc(tailPadding));
  const rebuilt = Buffer.concat(chunks);
  if (!json.buffers?.[0]) throw new Error('Expected one GLB binary buffer');
  json.buffers[0].byteLength = rebuilt.length;
  return rebuilt;
}

function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error('Expected a glTF 2.0 binary file');
  }
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('GLB JSON chunk is missing');
  const json = JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd(),
  );
  const binaryHeader = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  const binaryType = bytes.readUInt32LE(binaryHeader + 4);
  if (binaryType !== 0x004e4942) throw new Error('GLB BIN chunk is missing');
  return {
    json,
    binary: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength),
  };
}

function encodeGlb(json, binary) {
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonPadding = (4 - (rawJson.length % 4)) % 4;
  const jsonChunk = Buffer.concat([rawJson, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - (binary.length % 4)) % 4;
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

function collectTextureIndex(textureInfo, destination) {
  if (Number.isInteger(textureInfo?.index)) destination.add(textureInfo.index);
}

function remapTextureInfo(textureInfo, remap) {
  if (!textureInfo) return;
  const nextIndex = remap.get(textureInfo.index);
  if (!Number.isInteger(nextIndex)) throw new Error(`Texture ${textureInfo.index} was not retained`);
  textureInfo.index = nextIndex;
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
