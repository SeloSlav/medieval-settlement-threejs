const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;

type GlbAnimation = {
  name?: string;
  [key: string]: unknown;
};

type GlbDocument = {
  animations?: GlbAnimation[];
  [key: string]: unknown;
};

type GlbChunk = {
  type: number;
  bytes: Uint8Array;
};

export type AnimationLabelValidation = {
  complete: boolean;
  duplicateLabels: string[];
  invalidIndices: number[];
  missingIndices: number[];
};

export function normalizeAnimationLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function validateAnimationLabels(labels: readonly string[]): AnimationLabelValidation {
  const normalized = labels.map(normalizeAnimationLabel);
  const counts = new Map<string, number>();
  const invalidIndices: number[] = [];
  const missingIndices: number[] = [];

  for (let index = 0; index < labels.length; index += 1) {
    const raw = labels[index] ?? '';
    const label = normalized[index] ?? '';
    if (!label) {
      missingIndices.push(index);
      continue;
    }
    if (raw !== label || !/^[a-z][a-z0-9_]*$/.test(label)) {
      invalidIndices.push(index);
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const duplicateLabels = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label)
    .sort();

  return {
    complete:
      missingIndices.length === 0
      && invalidIndices.length === 0
      && duplicateLabels.length === 0,
    duplicateLabels,
    invalidIndices,
    missingIndices,
  };
}

export function readGlbAnimationNames(source: ArrayBuffer): string[] {
  const { document } = parseGlb(source);
  return (document.animations ?? []).map(
    (animation, index) => animation.name ?? `animation_${index + 1}`,
  );
}

export function rewriteGlbAnimationNames(
  source: ArrayBuffer,
  labels: readonly string[],
): ArrayBuffer {
  const parsed = parseGlb(source);
  const animations = parsed.document.animations ?? [];
  if (animations.length !== labels.length) {
    throw new Error(
      `The GLB contains ${animations.length} animations but ${labels.length} labels were provided.`,
    );
  }

  const validation = validateAnimationLabels(labels);
  if (!validation.complete) {
    throw new Error('Every animation needs a unique lowercase semantic name before export.');
  }

  for (let index = 0; index < animations.length; index += 1) {
    animations[index]!.name = normalizeAnimationLabel(labels[index] ?? '');
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(parsed.document));
  const paddedJson = new Uint8Array(alignToFour(jsonBytes.byteLength));
  paddedJson.fill(0x20);
  paddedJson.set(jsonBytes);

  const chunks = parsed.chunks.map((chunk) =>
    chunk.type === JSON_CHUNK_TYPE
      ? { type: JSON_CHUNK_TYPE, bytes: paddedJson }
      : chunk,
  );
  const totalLength = 12 + chunks.reduce(
    (sum, chunk) => sum + 8 + chunk.bytes.byteLength,
    0,
  );
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const outputBytes = new Uint8Array(output);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);

  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.bytes.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    outputBytes.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.byteLength;
  }
  return output;
}

function parseGlb(source: ArrayBuffer): {
  chunks: GlbChunk[];
  document: GlbDocument;
} {
  if (source.byteLength < 20) throw new Error('The selected file is too small to be a GLB.');
  const view = new DataView(source);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('The selected file is not a binary glTF (GLB) file.');
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error('Only glTF 2.0 GLB files are supported.');
  }
  if (view.getUint32(8, true) !== source.byteLength) {
    throw new Error('The GLB header length does not match the file size.');
  }

  const chunks: GlbChunk[] = [];
  let offset = 12;
  while (offset < source.byteLength) {
    if (offset + 8 > source.byteLength) throw new Error('The GLB contains a truncated chunk header.');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > source.byteLength) throw new Error('The GLB contains a truncated chunk.');
    chunks.push({ type, bytes: new Uint8Array(source.slice(start, end)) });
    offset = end;
  }

  const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK_TYPE);
  if (!jsonChunk) throw new Error('The GLB does not contain a JSON chunk.');
  const jsonText = new TextDecoder()
    .decode(jsonChunk.bytes)
    .replace(/[\u0000\u0020]+$/g, '');
  const document = JSON.parse(jsonText) as GlbDocument;
  return { chunks, document };
}

function alignToFour(value: number): number {
  return Math.ceil(value / 4) * 4;
}
