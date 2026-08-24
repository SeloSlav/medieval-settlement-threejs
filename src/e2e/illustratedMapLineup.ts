import type { RiverField } from '../rivers/RiverField.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { createTerrainMinimapImage } from '../map/createTerrainMinimapImage.ts';
import type { IllustratedWoodlandSourceTree } from '../map/illustratedWoodlandProjection.ts';

const FIXTURE_SEED = 0x071a_2e0d;
const WORLD_SPAN = 1_634;
const WORLD_START = -WORLD_SPAN * 0.5;
const RIVER_RESOLUTION = 256;

const host = document.querySelector<HTMLElement>('#map-host');
const metrics = document.querySelector<HTMLElement>('#metrics');
if (!host || !metrics) throw new Error('Illustrated map fixture host is missing.');

const requestedView = new URLSearchParams(window.location.search).get('view');
document.body.dataset.view = requestedView === 'near' || requestedView === 'far'
  ? requestedView
  : 'design';
const bakeStartedAt = performance.now();

const riverField = {
  resolution: RIVER_RESOLUTION,
  startX: WORLD_START,
  startZ: WORLD_START,
  spanX: WORLD_SPAN,
  spanZ: WORLD_SPAN,
  isRenderedWetAtGrid(column: number, row: number): boolean {
    const u = column / (RIVER_RESOLUTION - 1);
    const v = row / (RIVER_RESOLUTION - 1);
    const riverCenter = 0.5
      + Math.sin(v * 9.4 + 0.8) * 0.055
      + Math.sin(v * 22.7) * 0.018;
    const river = Math.abs(u - riverCenter) < 0.012 + v * 0.006;
    const lake = ((u - 0.72) / 0.085) ** 2 + ((v - 0.23) / 0.045) ** 2 < 1;
    return river || lake;
  },
} as unknown as RiverField;

const terrain: Pick<Terrain, 'getHeightAt' | 'generationSize' | 'size'> = {
  generationSize: WORLD_SPAN,
  size: WORLD_SPAN,
  getHeightAt(x: number, z: number): number {
    const u = x / WORLD_SPAN;
    const v = z / WORLD_SPAN;
    const ridge = Math.max(
      0,
      Math.sin((u * 1.3 + v * 0.7 + 0.22) * Math.PI * 3.2),
    );
    const hills = Math.sin(u * 8.1) * 12 + Math.cos(v * 7.3) * 10;
    const edgeRise = Math.pow(Math.max(Math.abs(u), Math.abs(v)) * 2, 2.5) * 48;
    return 28 + hills + ridge * 34 + edgeRise;
  },
};

const treePlacements = createFixtureWoodland(FIXTURE_SEED, 9_800);
const result = await createTerrainMinimapImage({
  riverField,
  terrain,
  treePlacements,
  seed: FIXTURE_SEED,
});
const bakeDurationMs = performance.now() - bakeStartedAt;

host.replaceChildren(result.canvas);
document.body.dataset.ready = 'true';
document.body.dataset.terrainSeed = String(result.diagnostics.seed);
document.body.dataset.woodlandSignature = result.diagnostics.woodland.signature;
document.body.dataset.mapBakeMs = bakeDurationMs.toFixed(1);
metrics.textContent = [
  `${result.canvas.width}×${result.canvas.height}`,
  `seed ${result.diagnostics.seed}`,
  `${result.diagnostics.woodland.drawnTreeGlyphCount} etched trees`,
  `${result.diagnostics.elevation.mountainRangeCount} ridge groups`,
  `${Math.round(bakeDurationMs)} ms bake`,
].join(' · ');

function createFixtureWoodland(
  seed: number,
  count: number,
): IllustratedWoodlandSourceTree[] {
  const random = fixtureRandom(seed);
  const centers = [
    [-0.68, -0.55, 0.24],
    [-0.28, -0.66, 0.2],
    [0.18, -0.53, 0.28],
    [0.58, -0.22, 0.22],
    [-0.52, 0.08, 0.3],
    [-0.05, 0.26, 0.27],
    [0.47, 0.53, 0.31],
    [-0.57, 0.62, 0.2],
  ] as const;
  const species: IllustratedWoodlandSourceTree['species'][] = [
    'beech',
    'ash',
    'silverFir',
    'norwaySpruce',
    'sessileOak',
  ];
  const forms: IllustratedWoodlandSourceTree['form'][] = [
    'broad',
    'midstory',
    'narrow',
    'young',
  ];
  const placements: IllustratedWoodlandSourceTree[] = [];
  for (let index = 0; index < count; index++) {
    const center = centers[Math.floor(random() * centers.length)];
    const angle = random() * Math.PI * 2;
    const radius = Math.pow(random(), 0.7) * center[2] * WORLD_SPAN;
    placements.push({
      layoutIndex: index,
      x: center[0] * WORLD_SPAN * 0.5 + Math.cos(angle) * radius,
      z: center[1] * WORLD_SPAN * 0.5 + Math.sin(angle) * radius,
      species: species[Math.floor(random() * species.length)],
      form: forms[Math.floor(random() * forms.length)],
      scale: 0.7 + random() * 0.65,
    });
  }
  return placements;
}

function fixtureRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
