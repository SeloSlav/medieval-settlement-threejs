import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { preservedFoodStock } from './foodInventory.ts';
import { breadStock, flourStock } from './cropGoods.ts';
import {
  normalizePotterFiringPolicy,
  POTTER_FIRE_ROOF_TILES,
} from './potterFiringPolicy.ts';
import {
  breweryPolicyOutput,
  breweryRecipeRequestsInput,
  type BreweryRecipeInput,
} from './breweryRecipePolicy.ts';
import {
  selectedSmokehouseRecipePolicy,
  smokehouseRecipeOutput,
} from './smokehouseRecipePolicy.ts';
import {
  spinningRettingRecipeRequestsInput,
  weaverRecipeRequestsInput,
  weaverUsesFlax,
} from './weaverInputPolicy.ts';
import {
  isStorageCommodity,
  storageAcceptsCommodity,
} from './storageAcceptancePolicy.ts';
import { buildingSharedStorageRoom } from './sharedStorageCapacity.ts';

export const PROCESSOR_OUTPUT_TARGET_KINDS = [
  'watermill',
  'windmill',
  'bakery',
  'brewery',
  'smokehouse',
  'spinning_retting_house',
  'weaver',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'tannery',
  'cobbler',
  'chandlery',
] as const satisfies readonly BuildingKind[];

export type ProcessorOutputTargetKind =
  (typeof PROCESSOR_OUTPUT_TARGET_KINDS)[number];

export const EXTRACTION_OUTPUT_TARGET_KINDS = [
  'stone_quarry',
  'large_quarry',
  'mine',
] as const satisfies readonly BuildingKind[];

export type ExtractionOutputTargetKind =
  (typeof EXTRACTION_OUTPUT_TARGET_KINDS)[number];

export type ProcessorOutputCommodity =
  | 'flour'
  | 'bread'
  | 'ale'
  | 'cider'
  | 'pearCider'
  | 'mead'
  | 'curedMeat'
  | 'smokedFish'
  | 'cheese'
  | 'yarn'
  | 'linen'
  | 'cloth'
  | 'charcoal'
  | 'ironwork'
  | 'pottery'
  | 'roofTiles'
  | 'leather'
  | 'shoes'
  | 'candles';

export type ExtractionOutputCommodity = 'stone' | 'iron' | 'salt' | 'clay';

export type ProcessorInputCommodity =
  | 'ryeGrain'
  | 'oatGrain'
  | 'maslinGrain'
  | 'barley'
  | 'malt'
  | 'apples'
  | 'pears'
  | 'honey'
  | 'ryeFlour'
  | 'maslinFlour'
  | 'water'
  | 'firewood'
  | 'food'
  | 'wool'
  | 'flax'
  | 'yarn'
  | 'linen'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery'
  | 'ironwork'
  | 'hides'
  | 'leather'
  | 'wax';

export const PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT = 100;
export const PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES = 3;

const OUTPUT_BY_KIND: Record<
  ProcessorOutputTargetKind,
  ProcessorOutputCommodity
> = {
  watermill: 'flour',
  windmill: 'flour',
  bakery: 'bread',
  brewery: 'ale',
  smokehouse: 'curedMeat',
  spinning_retting_house: 'yarn',
  weaver: 'cloth',
  charcoal_burner: 'charcoal',
  smithy: 'ironwork',
  potter_kiln: 'pottery',
  tannery: 'leather',
  cobbler: 'shoes',
  chandlery: 'candles',
};

const INPUTS_BY_KIND: Record<
  ProcessorOutputTargetKind,
  readonly ProcessorInputCommodity[]
> = {
  watermill: ['ryeGrain', 'maslinGrain'],
  windmill: ['ryeGrain', 'maslinGrain'],
  bakery: ['ryeFlour', 'maslinFlour', 'water', 'firewood'],
  brewery: ['barley', 'malt', 'apples', 'pears', 'honey', 'water', 'firewood'],
  smokehouse: ['food', 'firewood', 'salt'],
  spinning_retting_house: ['wool', 'flax', 'water'],
  weaver: ['yarn', 'linen'],
  charcoal_burner: ['firewood'],
  smithy: ['iron', 'charcoal', 'water'],
  potter_kiln: ['clay', 'firewood', 'water'],
  tannery: ['hides', 'water', 'firewood'],
  cobbler: ['leather'],
  chandlery: ['wax', 'firewood'],
};

export function isProcessorOutputTargetKind(
  kind: BuildingKind,
): kind is ProcessorOutputTargetKind {
  return (PROCESSOR_OUTPUT_TARGET_KINDS as readonly BuildingKind[]).includes(kind);
}

export function isExtractionOutputTargetKind(
  kind: BuildingKind,
): kind is ExtractionOutputTargetKind {
  return (EXTRACTION_OUTPUT_TARGET_KINDS as readonly BuildingKind[]).includes(kind);
}

export function normalizeProcessorOutputTargetPercent(
  _percent: number | undefined,
): number {
  return PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT;
}

export function processorOutputCommodity(
  kind: ProcessorOutputTargetKind,
): ProcessorOutputCommodity {
  return OUTPUT_BY_KIND[kind];
}

export function processorOutputCommodityForBuilding(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'potterFiringPolicy'
    | 'breweryRecipePolicy'
    | 'smokehouseRecipePolicy'
    | 'barley'
    | 'malt'
    | 'apples'
    | 'honey'
    | 'meat'
    | 'fish'
    | 'milk'
    | 'wool'
    | 'flax'
    | 'water'
    | 'weaverInputPolicy'
  >,
): ProcessorOutputCommodity | null {
  if (!isProcessorOutputTargetKind(building.kind)) return null;
  if (building.kind === 'brewery') {
    return breweryPolicyOutput(building.breweryRecipePolicy, building);
  }
  if (building.kind === 'smokehouse') {
    return smokehouseRecipeOutput(
      selectedSmokehouseRecipePolicy(building.smokehouseRecipePolicy, building),
    );
  }
  if (building.kind === 'spinning_retting_house') {
    return weaverUsesFlax(building) ? 'linen' : 'yarn';
  }
  if (
    building.kind === 'potter_kiln'
    && normalizePotterFiringPolicy(building.potterFiringPolicy) === POTTER_FIRE_ROOF_TILES
  ) {
    return 'roofTiles';
  }
  return processorOutputCommodity(building.kind);
}

export function processorInputCommodities(
  kind: ProcessorOutputTargetKind,
): readonly ProcessorInputCommodity[] {
  return INPUTS_BY_KIND[kind];
}

export function processorOutputTarget(
  capacity: number,
  percent: number | undefined,
): number {
  if (!Number.isFinite(capacity)) return 0;
  return Math.max(0, capacity)
    * normalizeProcessorOutputTargetPercent(percent)
    / 100;
}

export function processorInputStagingCycles(
  _percent: number | undefined,
): number {
  return PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES;
}

export function processorOutputTargetForBuilding(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'processorOutputTargetPercent'
    | 'potterFiringPolicy'
    | 'breweryRecipePolicy'
    | 'smokehouseRecipePolicy'
    | 'barley'
    | 'malt'
    | 'apples'
    | 'honey'
    | 'meat'
    | 'fish'
    | 'milk'
    | 'wool'
    | 'flax'
    | 'water'
    | 'weaverInputPolicy'
  >,
): number | null {
  const output = processorOutputCommodityForBuilding(building);
  if (!output || !isProcessorOutputTargetKind(building.kind)) return null;
  const capacities = BUILDING_STORAGE_CAPS[building.kind] as Partial<
    Record<ProcessorOutputCommodity | 'food' | 'preservedFood', number>
  >;
  const capacity = output === 'bread'
    ? capacities.food ?? 0
    : output === 'curedMeat' || output === 'smokedFish' || output === 'cheese'
      ? capacities.preservedFood ?? 0
    : capacities[output] ?? 0;
  return processorOutputTarget(capacity, building.processorOutputTargetPercent);
}

export function processorOutputHeadroom(
  building: BuildingState,
): number | null {
  const output = processorOutputCommodityForBuilding(building);
  if (!output) return null;
  const target = processorOutputTargetForBuilding(building) ?? 0;
  const stock = building.kind === 'smokehouse'
    ? preservedFoodStock(building)
    : output === 'flour'
      ? flourStock(building)
      : output === 'bread'
        ? breadStock(building)
        : Math.max(0, building[output] ?? 0);
  return Math.max(0, target - stock);
}

export function extractionOutputTarget(
  kind: ExtractionOutputTargetKind,
  commodity: ExtractionOutputCommodity,
): number {
  return (
    BUILDING_STORAGE_CAPS[kind] as Partial<
      Record<ExtractionOutputCommodity, number>
    >
  )[commodity] ?? 0;
}

export function extractionOutputHeadroom(
  building: BuildingState,
  commodity: ExtractionOutputCommodity,
): number | null {
  if (!isExtractionOutputTargetKind(building.kind)) return null;
  const target = extractionOutputTarget(
    building.kind,
    commodity,
  );
  return Math.min(
    Math.max(0, target - Math.max(0, building[commodity] ?? 0)),
    buildingSharedStorageRoom(building),
  );
}

export function extractionOutputCommodity(
  kind: BuildingKind,
  mineralResource: 'iron' | 'salt' | 'clay' | null = null,
): ExtractionOutputCommodity | null {
  switch (kind) {
    case 'stone_quarry':
    case 'large_quarry':
      return 'stone';
    case 'mine':
      return mineralResource;
    default:
      return null;
  }
}

/**
 * Replacement tools are durable worksite reserves, but they still need room in
 * the same physical yard. Unknown mineral sites remain ineligible because they
 * have no valid workface.
 */
export function extractionAcceptsMaintenance(
  building: BuildingState,
  mineralResource: 'iron' | 'salt' | 'clay' | null = null,
): boolean {
  if (!isExtractionOutputTargetKind(building.kind)) return true;
  const output = extractionOutputCommodity(building.kind, mineralResource);
  return output !== null && buildingSharedStorageRoom(building) > 1e-6;
}

export function processorNeedsInputs(
  building: BuildingState,
): boolean {
  const headroom = processorOutputHeadroom(building);
  return headroom == null || headroom > 1e-6;
}

export function processorUsesInput(
  kind: BuildingKind,
  commodity: ProcessorInputCommodity,
): boolean {
  return isProcessorOutputTargetKind(kind)
    && INPUTS_BY_KIND[kind].includes(commodity);
}

/**
 * New logistics demand is narrower than physical acceptance for a focused
 * recipe. Existing alternate stock and already-inbound cargo remain valid.
 */
export function processorRequestsInput(
  building: Pick<BuildingState, 'kind' | 'breweryRecipePolicy' | 'weaverInputPolicy'>,
  commodity: ProcessorInputCommodity,
): boolean {
  if (building.kind === 'brewery') {
    return !processorUsesInput('brewery', commodity)
      || breweryRecipeRequestsInput(
        building.breweryRecipePolicy,
        commodity as BreweryRecipeInput,
      );
  }
  if (building.kind === 'spinning_retting_house') {
    return commodity !== 'wool' && commodity !== 'flax' && commodity !== 'water'
      || spinningRettingRecipeRequestsInput(building.weaverInputPolicy, commodity);
  }
  if (building.kind === 'weaver') {
    return commodity !== 'yarn' && commodity !== 'linen'
      || weaverRecipeRequestsInput(building.weaverInputPolicy, commodity);
  }
  // Smokehouse food demand is typed at the dispatch source; both kiln recipes
  // share all inputs, so neither needs filtering here.
  return true;
}

export function processorAcceptsInput(
  building: BuildingState,
  commodity: ProcessorInputCommodity,
): boolean {
  if (isStorageCommodity(commodity) && !storageAcceptsCommodity(building, commodity)) {
    return false;
  }
  if (
    (building.kind === 'watermill' || building.kind === 'windmill')
    && commodity === 'oatGrain'
  ) return false;
  if (
    building.kind === 'pastoral_farmstead'
    && (
      commodity === 'ryeGrain'
      || commodity === 'oatGrain'
      || commodity === 'maslinGrain'
    )
  ) {
    return commodity === 'oatGrain'
      && (building.animalFeed ?? 0) + 1e-6
        < (BUILDING_STORAGE_CAPS.pastoral_farmstead.animalFeed ?? 0);
  }
  if (building.kind === 'pastoral_farmstead' && commodity === 'salt') {
    return preservedFoodStock(building) + 1e-6
      < (BUILDING_STORAGE_CAPS.pastoral_farmstead.preservedFood ?? 0);
  }
  if (
    building.kind === 'spinning_retting_house'
    && (commodity === 'wool' || commodity === 'flax' || commodity === 'water')
  ) {
    const output = commodity === 'wool' ? 'yarn' : 'linen';
    const capacity = BUILDING_STORAGE_CAPS.spinning_retting_house[output] ?? 0;
    const target = processorOutputTarget(capacity, building.processorOutputTargetPercent);
    return Math.max(0, building[output] ?? 0) + 1e-6 < target;
  }
  return !processorUsesInput(building.kind, commodity)
    || processorNeedsInputs(building);
}
