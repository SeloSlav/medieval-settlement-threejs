import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_ROOT = join(ROOT, 'artifacts', 'pbr-material-review', 'patina-candidates');
const MODEL_ID = 'fal-ai/patina/material';
const QUEUE_ENDPOINT = `https://queue.fal.run/${MODEL_ID}`;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 20 * 60 * 1_000;
const REQUIRED_MAPS = ['basecolor', 'normal', 'roughness', 'metalness', 'height'];

const candidates = [
  {
    slug: 'manor-grass-meadow',
    label: 'Open meadow grass',
    source: 'public/assets/textures/terrain/manor_grass_meadow/albedo.png',
    seed: 431021,
    strength: 0.52,
    prompt: [
      'Flat top-down seamless material of dense short temperate upland meadow grass in Gorski Kotar, Croatia.',
      'Interwoven fine grass blades with restrained muted olive, sage, and soft yellow-green variation,',
      'a little fine dry thatch between blades, evenly distributed stochastic detail at 1 to 6 centimeter scale,',
      'natural matte dielectric ground suitable for a medieval landscape strategy game.',
      'No flowers, clover rosettes, stones, bare soil patches, paths, footprints, long standing stalks,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'manor-grass-dense',
    label: 'Dense shaded grass',
    source: 'public/assets/textures/terrain/manor_grass_dense/albedo.png',
    seed: 431022,
    strength: 0.56,
    prompt: [
      'Flat top-down seamless material of dense short shaded forest-edge grass in Gorski Kotar, Croatia.',
      'Closely interwoven fine blades, low soft turf, a trace of moss between blades, deep muted forest green',
      'and olive variation without crushed blacks, evenly distributed detail at 1 to 5 centimeter scale,',
      'natural matte dielectric ground for close and distant game terrain.',
      'No fallen leaves, flowers, stones, bare dirt, paths, footprints, long standing stalks,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'manor-grass-dry',
    label: 'Dry late-summer grass',
    source: 'public/assets/textures/terrain/manor_grass_dry/albedo.png',
    seed: 431023,
    strength: 0.54,
    prompt: [
      'Flat top-down seamless material of short late-summer upland meadow grass in Gorski Kotar, Croatia.',
      'Fine flattened straw-colored blades mixed with surviving muted sage-green grass, subtle dry thatch,',
      'restrained beige olive and dusty green variation, evenly distributed detail at 1 to 7 centimeter scale,',
      'natural matte dry dielectric ground suitable for medieval game terrain.',
      'No flowers, stones, bare soil holes, paths, footprints, cut hay rows, long standing stalks,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-leaf-litter-primary',
    label: 'Primary forest leaf litter',
    source: null,
    seed: 431024,
    prompt: [
      'Flat top-down seamless temperate mountain forest-floor material from Gorski Kotar, Croatia.',
      'Overlapping dry beech, oak, and hornbeam leaf litter with recognizable but irregular broken leaves,',
      'random orientations, sparse hair-thin twigs, curled leaf edges, and dark brown humus visible between them,',
      'restrained ochre russet and deep earthy brown palette, physical features at 2 to 10 centimeter scale,',
      'matte dry dielectric surface for close-view game terrain.',
      'No living plants, mushrooms, pinecones, large branches, rocks, footprints, tire marks, woven or stamped patterns,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-leaf-litter-secondary',
    label: 'Fine decomposed forest litter',
    source: null,
    seed: 431025,
    prompt: [
      'Flat top-down seamless mature temperate forest-floor material from Gorski Kotar, Croatia.',
      'Fine decomposed beech leaf fragments and crumbly dark humus with a few intact small leaves,',
      'sparse slender fir needles and tiny twigs, random orientations, motif-neutral granular organic structure,',
      'muted umber chestnut and dark soil palette, physical features at 0.5 to 6 centimeter scale,',
      'matte dry dielectric surface designed as a stochastic companion to coarser leaf litter.',
      'No living plants, mushrooms, pinecones, large branches, rocks, footprints, tire marks, woven or stamped patterns,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'medieval-dirt-road',
    label: 'Medieval compacted dirt road',
    source: 'public/assets/textures/roads/medieval_dirt/albedo.png',
    seed: 431026,
    strength: 0.55,
    prompt: [
      'Flat top-down seamless material of a compacted medieval rural dirt-road surface in Gorski Kotar, Croatia.',
      'Cool grey-brown and restrained ochre fine earth with embedded pea-sized gravel, tiny angular stones,',
      'subtle irregular compression and crumbly soil variation at millimeter to 4 centimeter scale,',
      'dry matte dielectric ground that can be tinted and weathered by a game shader.',
      'No road edges, wheel ruts, parallel tracks, puddles, mud gloss, grass clumps, footprints, large stones,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'cultivated-garden-soil',
    label: 'Cultivated garden-bed soil',
    source: null,
    seed: 431027,
    prompt: [
      'Flat top-down seamless material of dark cultivated garden-bed soil in a cool Croatian mountain climate.',
      'Small irregular crumbly earth clods, fine organic matter, subtle moist dark-brown variation,',
      'a few tiny natural mineral grains, dense worked-soil structure at 2 millimeter to 4 centimeter scale,',
      'rough non-metallic ground suitable beneath close-view medieval kitchen-garden plants.',
      'No crop rows, furrows, roots, vegetables, leaves, seedlings, weeds, worms, tools, footprints, large stones,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'mossy-karst-rock',
    label: 'Forest mossy karst rock surface',
    source: null,
    seed: 431028,
    prompt: [
      'Flat orthographic seamless material of weathered pale grey-beige karst limestone from Gorski Kotar, Croatia.',
      'Fine porous mineral grain, shallow irregular pits and hairline mineral fissures, softened weathered edges,',
      'restrained scattered low dark-olive moss and faint lichen patches covering roughly fifteen percent of the surface,',
      'natural rough non-metallic stone detail at 1 millimeter to 12 centimeter scale for game rocks and boulders.',
      'No separate stones, pebbles, gravel bed, soil, leaves, plants, thick moss carpet, dramatic cracks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'clean-river-stone',
    label: 'Clean water-worn river stone surface',
    source: null,
    seed: 431029,
    prompt: [
      'Flat orthographic seamless material of clean water-worn karst limestone from a Croatian mountain river.',
      'Pale cool grey and warm grey-beige mineral color, fine dense stone grain, softly rounded shallow pitting,',
      'subtle smoothed abrasion and faint mineral staining at 1 millimeter to 10 centimeter scale,',
      'natural rough non-metallic boulder surface that remains readable when a game shader adds water wetness.',
      'No moss, lichen, algae, soil, leaves, separate pebbles, gravel bed, shells, dramatic cracks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'clean-quarry-limestone',
    label: 'Clean freshly fractured quarry limestone',
    source: null,
    seed: 431030,
    prompt: [
      'Flat orthographic seamless material of clean freshly fractured karst limestone from a Croatian quarry.',
      'Pale neutral grey-beige mineral body, crisp fine crystalline grain, small angular fracture steps,',
      'subtle calcite veins and fresh chalky break variation at 1 millimeter to 8 centimeter scale,',
      'dry rough non-metallic stone for deliberately placed harvestable quarry boulders and exposed faces.',
      'No moss, lichen, algae, soil, leaves, separate rocks, gravel bed, ore crystals, tool marks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-mossy-karst-rock-v2',
    label: 'Forest mossy karst rock surface v2',
    source: null,
    seed: 431031,
    prompt: [
      'Flat orthographic seamless material of weathered grey-beige karst limestone in a damp shaded Gorski Kotar forest.',
      'Fine porous mineral grain and shallow weathered pits remain visible between clearly readable irregular moss patches.',
      'Low velvety dark-olive and forest-green moss cushions form branching organic islands over roughly thirty-five percent',
      'of the stone, with subtle pale lichen speckles and natural rough non-metallic response at 1 millimeter to 10 centimeter scale.',
      'Moss must be visibly green and patchy but thin enough to preserve stone identity.',
      'No soil, leaves, plants, roots, separate stones, gravel, thick continuous moss carpet, dramatic cracks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'clean-quarry-limestone-v2',
    label: 'Clean freshly fractured quarry limestone v2',
    source: null,
    seed: 431032,
    prompt: [
      'Flat orthographic seamless micro-material of clean freshly broken Gorski Kotar limestone from a working quarry.',
      'Warm pale grey-beige dense limestone, fine chalky crystalline grain, tiny angular chips, powdery break variation,',
      'and sparse subtle calcite flecks at 1 millimeter to 4 centimeter scale; dry rough non-metallic stone.',
      'The mesh geometry will own large fracture planes, cracks, edges, and silhouette, so keep this texture motif-neutral.',
      'No long veins, marble pattern, branching white cracks, large facets, moss, lichen, algae, soil, leaves, gravel, ore,',
      'tool marks, wet gloss, directional lighting, cast shadows, perspective, horizon, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-mossy-karst-rock-v3',
    label: 'Forest mossy karst rock surface v3',
    source: null,
    seed: 431033,
    prompt: [
      'Flat orthographic seamless material of weathered grey-beige karst limestone in a damp shaded Gorski Kotar forest.',
      'Fine porous stone and shallow weathered pits remain visible between low velvety dark-olive moss mats.',
      'Moss forms a few connected asymmetrical branching islands with feathery torn organic boundaries,',
      'covering roughly twenty-five percent of the stone, plus very sparse subtle pale lichen grain.',
      'The green moss is clearly readable but thin and irregular, with material detail at 1 millimeter to 12 centimeter scale.',
      'No round moss spots, circular colonies, dots, polka-dot pattern, bubbles, soil, leaves, roots, separate stones, gravel,',
      'thick continuous carpet, dramatic cracks, wet gloss, directional lighting, shadows, perspective, borders, text, or motifs.',
    ].join(' '),
  },
  {
    slug: 'manor-grass-dry-v2',
    label: 'Dry late-summer grass v2',
    source: 'public/assets/textures/terrain/manor_grass_dry/albedo.png',
    seed: 431034,
    strength: 0.35,
    prompt: [
      'Flat top-down seamless material of very short late-summer upland meadow turf in Gorski Kotar, Croatia.',
      'Dense ground-hugging brittle cropped blades and tiny broken thatch fragments from 0.5 to 3 centimeters long,',
      'mixed with sparse short muted sage-green grass, restrained straw beige olive and dusty green variation,',
      'fine isotropic matte dry dielectric detail suitable for medieval game terrain.',
      'No long continuous fibers, hair-like strands, loops, scribbles, hay mat, twigs, cut rows, flowers, stones, bare holes,',
      'paths, footprints, standing stalks, directional lighting, shadows, perspective, borders, text, or repeating motifs.',
    ].join(' '),
  },
];

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadCredentials() {
  const localEnv = parseEnv(await readFile(join(ROOT, '.env.local'), 'utf8'));
  const credentials = process.env.FAL_API_KEY
    || process.env.FAL_KEY
    || localEnv.FAL_API_KEY
    || localEnv.FAL_KEY;
  if (!credentials) {
    throw new Error('Missing FAL_API_KEY (or FAL_KEY) in the environment or .env.local.');
  }
  return credentials;
}

function mimeTypeFor(path) {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'image/png';
  }
}

async function sourceDataUri(relativePath) {
  const bytes = await readFile(join(ROOT, relativePath));
  return `data:${mimeTypeFor(relativePath)};base64,${bytes.toString('base64')}`;
}

async function falFetch(url, credentials, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Key ${credentials}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { raw: bodyText };
  }
  if (!response.ok) {
    throw new Error(`fal request failed (${response.status} ${response.statusText}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function submit(candidate, credentials) {
  const input = {
    prompt: candidate.prompt,
    image_size: 'square_hd',
    num_inference_steps: 8,
    seed: candidate.seed,
    num_images: 1,
    enable_prompt_expansion: true,
    enable_safety_checker: true,
    tiling_mode: 'both',
    tile_size: 128,
    tile_stride: 64,
    maps: REQUIRED_MAPS,
    upscale_factor: 0,
    output_format: 'png',
  };
  if (candidate.source) {
    input.image_url = await sourceDataUri(candidate.source);
    input.strength = candidate.strength;
  }
  const response = await falFetch(QUEUE_ENDPOINT, credentials, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { response, input };
}

async function waitForResult(candidate, submission, credentials) {
  const startedAt = Date.now();
  let lastStatus = '';
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    const status = await falFetch(`${submission.status_url}?logs=1`, credentials);
    if (status.status !== lastStatus) {
      console.log(`[${candidate.slug}] ${status.status}`);
      lastStatus = status.status;
    }
    if (status.status === 'COMPLETED') {
      if (status.error || status.error_type) {
        throw new Error(`[${candidate.slug}] ${status.error_type ?? 'fal error'}: ${status.error ?? 'unknown error'}`);
      }
      const result = await falFetch(submission.response_url, credentials);
      if (result.error || result.error_type) {
        throw new Error(`[${candidate.slug}] ${result.error_type ?? 'fal error'}: ${result.error ?? 'unknown error'}`);
      }
      return result;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`[${candidate.slug}] timed out after ${REQUEST_TIMEOUT_MS / 60_000} minutes`);
}

async function downloadFile(url, outputPath) {
  try {
    await access(outputPath);
    return;
  } catch {
    // Missing candidate output: download it below.
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed (${response.status} ${response.statusText}): ${url}`);
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}

async function saveResult(candidate, requestInput, submission, result) {
  const candidateRoot = join(OUTPUT_ROOT, candidate.slug);
  await mkdir(candidateRoot, { recursive: true });
  const safeInput = { ...requestInput };
  if (safeInput.image_url) safeInput.image_url = `[data URI from ${candidate.source}]`;
  const metadata = {
    model: MODEL_ID,
    label: candidate.label,
    source: candidate.source,
    requestId: submission.request_id,
    requestedInput: safeInput,
    returnedSeed: result.seed,
    returnedPrompt: result.prompt,
    timings: result.timings,
    images: result.images,
    generatedAt: new Date().toISOString(),
  };
  let previewIndex = 0;
  for (const image of result.images ?? []) {
    const name = image.map_type ?? `generated-preview-${++previewIndex}`;
    const extension = image.content_type === 'image/jpeg' ? '.jpg'
      : image.content_type === 'image/webp' ? '.webp'
        : '.png';
    await downloadFile(image.url, join(candidateRoot, `${name}${extension}`));
  }
  const returnedMaps = new Set((result.images ?? []).map((image) => image.map_type).filter(Boolean));
  const missing = REQUIRED_MAPS.filter((map) => !returnedMaps.has(map));
  if (missing.length > 0) {
    throw new Error(`[${candidate.slug}] missing returned maps: ${missing.join(', ')}`);
  }
  await writeFile(
    join(candidateRoot, 'generation.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

async function candidateComplete(candidate) {
  try {
    const metadata = JSON.parse(await readFile(
      join(OUTPUT_ROOT, candidate.slug, 'generation.json'),
      'utf8',
    ));
    const hasMetadata = REQUIRED_MAPS.every(
      (map) => metadata.images?.some((image) => image.map_type === map),
    );
    if (!hasMetadata) return false;
    await Promise.all(REQUIRED_MAPS.map((map) => access(
      join(OUTPUT_ROOT, candidate.slug, `${map}.png`),
    )));
    return true;
  } catch {
    return false;
  }
}

async function runCandidate(candidate, credentials) {
  if (await candidateComplete(candidate)) {
    console.log(`[${candidate.slug}] already complete; skipping`);
    return;
  }
  console.log(`[${candidate.slug}] submitting`);
  const { response: submission, input } = await submit(candidate, credentials);
  console.log(`[${candidate.slug}] queued as ${submission.request_id}`);
  const result = await waitForResult(candidate, submission, credentials);
  await saveResult(candidate, input, submission, result);
  console.log(`[${candidate.slug}] saved`);
}

async function main() {
  const onlyArgument = process.argv.find((argument) => argument.startsWith('--only='));
  const selectedSlugs = onlyArgument
    ? new Set(onlyArgument.slice('--only='.length).split(',').filter(Boolean))
    : null;
  const selected = selectedSlugs
    ? candidates.filter((candidate) => selectedSlugs.has(candidate.slug))
    : candidates;
  if (selected.length === 0) throw new Error('No matching candidates selected.');
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const credentials = await loadCredentials();
  const queue = [...selected];
  const workerCount = Math.min(3, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const candidate = queue.shift();
      await runCandidate(candidate, credentials);
    }
  });
  await Promise.all(workers);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
