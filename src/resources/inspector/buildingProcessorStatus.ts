import {
  BREWERY_ALE_PER_CYCLE,
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_BREWING_WATER_PER_CYCLE,
  BREWERY_MALT_PER_ALE_CYCLE,
  BREWERY_MALT_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_WATER_PER_CYCLE,
  CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CLAY_PIT_CLAY_PER_CYCLE,
  BAKERY_FIREWOOD_PER_CYCLE,
  BAKERY_FLOUR_PER_CYCLE,
  BAKERY_RYE_BREAD_PER_CYCLE,
  BAKERY_OAT_BREAD_PER_CYCLE,
  BAKERY_MASLIN_BREAD_PER_CYCLE,
  BAKERY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  MONASTERY_OAT_GRAIN_PER_CYCLE,
  MONASTERY_UNLINKED_PRODUCTIVITY,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_IRON_PER_CYCLE,
  SMITHY_IRONWORK_PER_CYCLE,
  SMITHY_WATER_PER_CYCLE,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  POTTER_POTTERY_PER_CYCLE,
  POTTER_WATER_PER_CYCLE,
  WATERMILL_RYE_FLOUR_PER_CYCLE,
  WATERMILL_OAT_FLOUR_PER_CYCLE,
  WATERMILL_MASLIN_FLOUR_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_FLAX_PER_CYCLE,
  WEAVER_FLAX_WATER_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../../generated/gameBalance.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import type { BuildingKind, BuildingState } from '../types.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import {
  seasonalProducerOutputBlocker,
  specialtySeasonStatus,
} from '../../economy/specialtyTrade.ts';
import {
  extractionOutputHeadroom,
  extractionOutputTarget,
  isExtractionOutputTargetKind,
  isProcessorOutputTargetKind,
  processorInputStagingCycles,
  processorOutputHeadroom,
  processorOutputTargetForBuilding,
  type ExtractionOutputCommodity,
} from '../../economy/processorOutputPolicy.ts';
import {
  assessWellWaterSupply,
  formatWellWaterDetailRows,
  wellWaterStatusIssue,
  type WellWaterAssessment,
} from './buildingWaterStatus.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import {
  weaverInputPolicyLabel,
  weaverUsesFlax,
} from '../../economy/weaverInputPolicy.ts';
import {
  renderResourceCost,
  type ResourceCostAmounts,
} from '../../ui/resourceCost.ts';

export type BuildingProcessorContext = {
  matureTrees?: number;
  month?: number;
};

export type BuildingProcessorStatus = {
  statusText: string;
  statusState: 'active' | 'idle' | 'warning';
  waterDetailHtml: string;
};

type StockKey =
  | 'timber'
  | 'firewood'
  | 'stone'
  | 'water'
  | 'food'
  | 'ryeGrain'
  | 'oatGrain'
  | 'maslinGrain'
  | 'barley'
  | 'malt'
  | 'ryeFlour'
  | 'oatFlour'
  | 'maslinFlour'
  | 'ryeBread'
  | 'oatBread'
  | 'maslinBread'
  | 'ale'
  | 'preservedFood'
  | 'wool'
  | 'flax'
  | 'cloth'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery'
  | 'ironwork';

type InputRequirement = {
  key: StockKey;
  label: string;
  required: number;
  deliveryHint?: string;
};

type ProcessorProfile = {
  requiresLabor: boolean;
  waterPerCycle: number;
  inputs: InputRequirement[];
  output: StockKey | null;
  outputPerCycle: number;
  operatingLabel: string;
  idleNoWorkersLabel: string;
};

const PROCESSOR_PROFILES: Partial<Record<BuildingKind, ProcessorProfile>> = {
  bakery: {
    requiresLabor: true,
    waterPerCycle: BAKERY_WATER_PER_CYCLE,
    inputs: [
      { key: 'ryeFlour', label: 'rye flour', required: BAKERY_FLOUR_PER_CYCLE, deliveryHint: 'mill or granary deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: BAKERY_FIREWOOD_PER_CYCLE, deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway' },
    ],
    output: 'ryeBread',
    outputPerCycle: BAKERY_RYE_BREAD_PER_CYCLE,
    operatingLabel: 'Baking bread',
    idleNoWorkersLabel: 'Idle — assign bakers to make bread',
  },
  smokehouse: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'food', label: 'food', required: SMOKEHOUSE_FOOD_PER_CYCLE, deliveryHint: 'granary deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: SMOKEHOUSE_FIREWOOD_PER_CYCLE, deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway' },
      { key: 'salt', label: 'salt', required: SMOKEHOUSE_SALT_PER_CYCLE, deliveryHint: 'mine or market carts may supply it' },
      { key: 'pottery', label: 'pottery', required: SMOKEHOUSE_POTTERY_PER_CYCLE, deliveryHint: 'potter deliveries may supply vessels' },
    ],
    output: 'preservedFood',
    outputPerCycle: SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    operatingLabel: 'Smoking and preserving food',
    idleNoWorkersLabel: 'Idle — assign workers to preserve food',
  },
  watermill: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'ryeGrain', label: 'rye grain', required: WATERMILL_GRAIN_PER_CYCLE, deliveryHint: 'farmstead or granary deliveries may supply' },
    ],
    output: 'ryeFlour',
    outputPerCycle: WATERMILL_RYE_FLOUR_PER_CYCLE,
    operatingLabel: 'Milling grain into flour',
    idleNoWorkersLabel: 'Idle — assign workers to run the mill',
  },
  clay_pit: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [],
    output: 'clay',
    outputPerCycle: CLAY_PIT_CLAY_PER_CYCLE,
    operatingLabel: 'Digging and tempering riverbank clay',
    idleNoWorkersLabel: 'Idle - assign workers to dig clay',
  },
  windmill: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'ryeGrain', label: 'rye grain', required: WATERMILL_GRAIN_PER_CYCLE, deliveryHint: 'farmstead or granary deliveries may supply' },
    ],
    output: 'ryeFlour',
    outputPerCycle: WATERMILL_RYE_FLOUR_PER_CYCLE,
    operatingLabel: 'Wind-milling grain into flour',
    idleNoWorkersLabel: 'Idle — assign workers to run the windmill',
  },
  charcoal_burner: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      {
        key: 'firewood',
        label: 'firewood',
        required: CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
        deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway',
      },
    ],
    output: 'charcoal',
    outputPerCycle: CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
    operatingLabel: 'Tending the covered charcoal clamp',
    idleNoWorkersLabel: 'Idle - assign charcoal burners',
  },
  smithy: {
    requiresLabor: true,
    waterPerCycle: SMITHY_WATER_PER_CYCLE,
    inputs: [
      {
        key: 'iron',
        label: 'iron charge',
        required: SMITHY_IRON_PER_CYCLE,
        deliveryHint: 'mine carts supply ore; Adriatic merchants supply blooms or bars',
      },
      {
        key: 'charcoal',
        label: 'charcoal',
        required: SMITHY_CHARCOAL_PER_CYCLE,
        deliveryHint: "a charcoal burner's yard supplies forge fuel",
      },
    ],
    output: 'ironwork',
    outputPerCycle: SMITHY_IRONWORK_PER_CYCLE,
    operatingLabel: 'Smelting the iron charge, consolidating the bloom, and forging ironwork',
    idleNoWorkersLabel: 'Idle - assign smelters and smiths',
  },
  potter_kiln: {
    requiresLabor: true,
    waterPerCycle: POTTER_WATER_PER_CYCLE,
    inputs: [
      {
        key: 'clay',
        label: 'clay',
        required: POTTER_CLAY_PER_CYCLE,
        deliveryHint: 'riverbank pit deliveries may supply',
      },
      {
        key: 'firewood',
        label: 'firewood',
        required: POTTER_FIREWOOD_PER_CYCLE,
        deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway',
      },
    ],
    output: 'pottery',
    outputPerCycle: POTTER_POTTERY_PER_CYCLE,
    operatingLabel: 'Firing household and preserving vessels',
    idleNoWorkersLabel: 'Idle - assign potters',
  },
};

function selectedCerealProfile(building: BuildingState): ProcessorProfile | null {
  if (building.kind === 'watermill' || building.kind === 'windmill') {
    const recipes = [
      { input: 'ryeGrain', output: 'ryeFlour', label: 'rye grain', rate: WATERMILL_RYE_FLOUR_PER_CYCLE },
      { input: 'oatGrain', output: 'oatFlour', label: 'oat grain', rate: WATERMILL_OAT_FLOUR_PER_CYCLE },
      { input: 'maslinGrain', output: 'maslinFlour', label: 'maslin grain', rate: WATERMILL_MASLIN_FLOUR_PER_CYCLE },
    ] as const;
    const selected = recipes.reduce((best, recipe) =>
      stockAmount(building, recipe.input) > stockAmount(building, best.input)
        ? recipe
        : best,
    );
    return {
      requiresLabor: true,
      waterPerCycle: 0,
      inputs: [{
        key: selected.input,
        label: selected.label,
        required: WATERMILL_GRAIN_PER_CYCLE,
        deliveryHint: 'farmstead or granary deliveries may supply this exact crop',
      }],
      output: selected.output,
      outputPerCycle: selected.rate,
      operatingLabel: building.kind === 'watermill'
        ? `Milling ${selected.label} into ${stockLabel(selected.output)}`
        : `Wind-milling ${selected.label} into ${stockLabel(selected.output)}`,
      idleNoWorkersLabel: building.kind === 'watermill'
        ? 'Idle — assign workers to run the mill'
        : 'Idle — assign workers to run the windmill',
    };
  }
  if (building.kind === 'bakery') {
    const recipes = [
      { input: 'ryeFlour', output: 'ryeBread', label: 'rye flour', rate: BAKERY_RYE_BREAD_PER_CYCLE },
      { input: 'oatFlour', output: 'oatBread', label: 'oat flour', rate: BAKERY_OAT_BREAD_PER_CYCLE },
      { input: 'maslinFlour', output: 'maslinBread', label: 'maslin flour', rate: BAKERY_MASLIN_BREAD_PER_CYCLE },
    ] as const;
    const selected = recipes.reduce((best, recipe) =>
      stockAmount(building, recipe.input) > stockAmount(building, best.input)
        ? recipe
        : best,
    );
    return {
      requiresLabor: true,
      waterPerCycle: BAKERY_WATER_PER_CYCLE,
      inputs: [
        { key: selected.input, label: selected.label, required: BAKERY_FLOUR_PER_CYCLE, deliveryHint: 'mill or granary deliveries may supply this exact flour' },
        { key: 'firewood', label: 'firewood', required: BAKERY_FIREWOOD_PER_CYCLE, deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway' },
      ],
      output: selected.output,
      outputPerCycle: selected.rate,
      operatingLabel: `Baking ${stockLabel(selected.output)}`,
      idleNoWorkersLabel: 'Idle — assign bakers to make bread',
    };
  }
  return null;
}

function stockAmount(building: BuildingState, key: StockKey): number {
  return building[key] ?? 0;
}

function stockLabel(key: StockKey): string {
  if (key === 'preservedFood') return 'preserved staples';
  return key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function storageCapacity(kind: BuildingKind, key: StockKey): number {
  const capacityKey = key === 'ryeFlour' || key === 'oatFlour' || key === 'maslinFlour'
    ? 'flour'
    : key === 'ryeBread' || key === 'oatBread' || key === 'maslinBread'
      ? 'food'
      : key;
  return (buildingStorageCaps(kind) as Record<string, number | undefined>)[capacityKey] ?? 0;
}

function isExtractionOutputCommodity(
  key: StockKey,
): key is ExtractionOutputCommodity {
  return key === 'stone' || key === 'iron' || key === 'salt' || key === 'clay';
}

function isOutputAtLimit(
  building: BuildingState,
  kind: BuildingKind,
  output: StockKey,
): boolean {
  if (isProcessorOutputTargetKind(kind)) {
    return (processorOutputHeadroom(building) ?? Number.POSITIVE_INFINITY) <= 0.001;
  }
  if (isExtractionOutputTargetKind(kind) && isExtractionOutputCommodity(output)) {
    return (
      extractionOutputHeadroom(building, output)
        ?? Number.POSITIVE_INFINITY
    ) <= 0.001;
  }
  const cap = storageCapacity(kind, output);
  return cap != null
    && cap > 0
    && stockAmount(building, output) >= cap - 0.001;
}

function firstMissingInput(building: BuildingState, inputs: InputRequirement[]): InputRequirement | null {
  for (const input of inputs) {
    if (stockAmount(building, input.key) <= 1e-6) {
      return input;
    }
  }
  return null;
}

function formatInputCycleCoverage(cycles: number): string {
  if (!Number.isFinite(cycles)) return 'No current input demand';
  if (cycles >= 100) return 'At least 100 cycles';
  const rounded = cycles < 10
    ? cycles.toFixed(1)
    : Math.floor(cycles + 1e-9).toString();
  return `${rounded} ${Math.abs(cycles - 1) < 0.05 ? 'cycle' : 'cycles'}`;
}

function processorInputCost(inputs: readonly InputRequirement[]): ResourceCostAmounts {
  const amounts: ResourceCostAmounts = {};
  for (const input of inputs) {
    amounts[input.key] = (amounts[input.key] ?? 0) + input.required;
  }
  return amounts;
}

function formatProcessorInputBufferRow(
  building: BuildingState,
  profile: ProcessorProfile,
): string {
  const inputCostRow = profile.inputs.length > 0
    ? `<li><span>Inputs per cycle</span><span>${renderResourceCost(processorInputCost(profile.inputs), { compact: true })}</span></li>`
    : '';
  let limitingCycles = Number.POSITIVE_INFINITY;
  let limitingInput = '';
  for (const input of profile.inputs) {
    const cycles = Math.max(0, stockAmount(building, input.key)) / input.required;
    if (cycles < limitingCycles) {
      limitingCycles = cycles;
      limitingInput = input.label;
    }
  }
  if (profile.waterPerCycle > 0) {
    const waterCycles = Math.max(0, building.water) / profile.waterPerCycle;
    if (waterCycles < limitingCycles) {
      limitingCycles = waterCycles;
      limitingInput = 'water';
    }
  }
  if (!limitingInput) return inputCostRow;
  const stagingCycles = isProcessorOutputTargetKind(building.kind)
    ? processorInputStagingCycles(building.processorOutputTargetPercent)
    : null;
  const inputCoverage = isProcessorOutputTargetKind(building.kind)
    ? `${formatInputCycleCoverage(limitingCycles)} on site / ${stagingCycles} ${
        stagingCycles === 1 ? 'cycle' : 'cycles'
      } staged`
    : formatInputCycleCoverage(limitingCycles);
  const inputRow = `${inputCostRow}<li><span>On-site input buffer</span><span>${inputCoverage} · ${limitingInput} limits</span></li>`;
  if (!profile.output || profile.outputPerCycle <= 1e-9) return inputRow;
  const extractionTarget = isExtractionOutputTargetKind(building.kind)
    && isExtractionOutputCommodity(profile.output)
    ? extractionOutputTarget(
        building.kind,
        profile.output,
        building.processorOutputTargetPercent,
      )
    : null;
  const outputLimit = processorOutputTargetForBuilding(building)
    ?? extractionTarget
    ?? storageCapacity(building.kind, profile.output);
  const outputRoom = isProcessorOutputTargetKind(building.kind)
    ? (processorOutputHeadroom(building) ?? 0)
    : isExtractionOutputTargetKind(building.kind)
        && isExtractionOutputCommodity(profile.output)
      ? (extractionOutputHeadroom(building, profile.output) ?? 0)
      : Math.max(0, outputLimit - Math.max(0, stockAmount(building, profile.output)));
  const outputRoomCycles = outputRoom / profile.outputPerCycle;
  return `${inputRow}<li><span>Output room</span><span>${formatInputCycleCoverage(outputRoomCycles)} · ${stockLabel(profile.output)} before ${outputLimit.toFixed(0)} target</span></li>`;
}

function formatMissingInput(input: InputRequirement): string {
  const hint = input.deliveryHint ? ` — ${input.deliveryHint}` : '';
  return `Waiting for ${input.label} — needs ${input.required} per cycle${hint}`;
}

function buildProcessorStatus(
  building: BuildingState,
  profile: ProcessorProfile,
  waterAssessment: WellWaterAssessment | null,
  onsiteLabor: number,
): BuildingProcessorStatus {
  const waterDetailHtml = formatWellWaterDetailRows(
    waterAssessment,
    profile.waterPerCycle <= 0 ? 'None — uses river power or dry process' : undefined,
  );

  const processorDetailHtml = waterDetailHtml
    + formatProcessorInputBufferRow(building, profile);
  const outputAtLimit = profile.output
    ? isOutputAtLimit(building, building.kind, profile.output)
    : false;

  if (
    profile.requiresLabor
    && onsiteLabor === 0
    && !outputAtLimit
  ) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Work paused - the full roster is away with its cart'
        : profile.idleNoWorkersLabel,
      statusState: 'idle',
      waterDetailHtml: processorDetailHtml,
    };
  }

  if (outputAtLimit) {
    return {
      statusText: 'Output target reached — production paused',
      statusState: 'idle',
      waterDetailHtml: processorDetailHtml,
    };
  }

  // The authoritative processor scales a batch down to the limiting stock.
  // Any positive on-site water can therefore advance production; the full
  // cycle requirement remains visible in the buffer rows.
  const waterIssue = building.water > 1e-6
    ? null
    : wellWaterStatusIssue(waterAssessment);
  if (waterIssue) {
    return {
      statusText: waterIssue,
      statusState: 'warning',
      waterDetailHtml: processorDetailHtml,
    };
  }

  const missingInput = firstMissingInput(building, profile.inputs);
  if (missingInput) {
    return {
      statusText: formatMissingInput(missingInput),
      statusState: 'warning',
      waterDetailHtml: processorDetailHtml,
    };
  }

  return {
    statusText: profile.operatingLabel,
    statusState: 'active',
    waterDetailHtml: processorDetailHtml,
  };
}

function getBreweryStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  onsiteLabor: number,
): BuildingProcessorStatus {
  const barley = Math.max(0, building.barley ?? 0);
  const malt = Math.max(0, building.malt ?? 0);
  const stagingCycles = processorInputStagingCycles(
    building.processorOutputTargetPercent,
  );
  const maltTarget = Math.min(
    BREWERY_MALT_PER_ALE_CYCLE * stagingCycles,
    buildingStorageCaps('brewery').malt ?? 0,
  );
  const shouldMalt = barley > 1e-6 && malt + 1e-6 < maltTarget;
  const inputs: InputRequirement[] = shouldMalt
    ? [
      {
        key: 'barley',
        label: 'barley',
        required: BREWERY_BARLEY_PER_MALT_CYCLE,
        deliveryHint: 'farmstead or granary deliveries may supply',
      },
      {
        key: 'firewood',
        label: 'firewood',
        required: BREWERY_MALTING_FIREWOOD_PER_CYCLE,
        deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway',
      },
    ]
    : [
      {
        key: 'malt',
        label: 'malt',
        required: BREWERY_MALT_PER_ALE_CYCLE,
        deliveryHint: 'barley must first be malted here',
      },
      {
        key: 'firewood',
        label: 'firewood',
        required: BREWERY_BREWING_FIREWOOD_PER_CYCLE,
        deliveryHint: 'household-cleared lodge/storehouse surplus follows work priority and lowest runway',
      },
    ];
  const waterPerCycle = shouldMalt
    ? BREWERY_MALTING_WATER_PER_CYCLE
    : BREWERY_BREWING_WATER_PER_CYCLE;
  const waterAssessment = assessWellWaterSupply(
    building,
    worldQueries,
    waterPerCycle,
  );
  const waterDetailHtml = formatWellWaterDetailRows(waterAssessment);
  let limitingCycles = Math.max(0, building.water) / waterPerCycle;
  let limitingInput = 'water';
  for (const input of inputs) {
    const cycles = stockAmount(building, input.key) / input.required;
    if (cycles < limitingCycles) {
      limitingCycles = cycles;
      limitingInput = input.label;
    }
  }
  const outputLimit = processorOutputTargetForBuilding(building)
    ?? (buildingStorageCaps('brewery').ale ?? 0);
  const outputRoomCycles = (processorOutputHeadroom(building) ?? 0)
    / BREWERY_ALE_PER_CYCLE;
  const processRows = `
    <li><span>Inputs per current step</span><span>${renderResourceCost(processorInputCost(inputs), { compact: true })}</span></li>
    <li><span>Current brewing step</span><span>${shouldMalt ? 'Floor-malting barley' : 'Brewing malt into ale'} · ${formatInputCycleCoverage(limitingCycles)} · ${limitingInput} limits</span></li>
    <li><span>Malt working buffer</span><span>${malt.toFixed(1)} / ${maltTarget.toFixed(1)} staged · ${BREWERY_MALT_PER_CYCLE.toFixed(1)} malt per malting cycle</span></li>
    <li><span>Ale output room</span><span>${formatInputCycleCoverage(outputRoomCycles)} · ale before ${outputLimit.toFixed(0)} target</span></li>
    <li><span>Process design</span><span>One malting cycle + one brewing cycle per ale batch</span></li>
  `;
  const detailHtml = waterDetailHtml + processRows;
  const outputAtLimit = isOutputAtLimit(building, 'brewery', 'ale');

  if (onsiteLabor === 0 && !outputAtLimit) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Work paused - the full roster is away with its cart'
        : 'Idle — assign workers to malt barley and brew ale',
      statusState: 'idle',
      waterDetailHtml: detailHtml,
    };
  }
  if (outputAtLimit) {
    return {
      statusText: 'Ale target reached — malting and brewing paused',
      statusState: 'idle',
      waterDetailHtml: detailHtml,
    };
  }
  const waterIssue = building.water > 1e-6
    ? null
    : wellWaterStatusIssue(waterAssessment);
  if (waterIssue) {
    return {
      statusText: waterIssue,
      statusState: 'warning',
      waterDetailHtml: detailHtml,
    };
  }
  const missingInput = firstMissingInput(building, inputs);
  if (missingInput) {
    return {
      statusText: formatMissingInput(missingInput),
      statusState: 'warning',
      waterDetailHtml: detailHtml,
    };
  }
  return {
    statusText: shouldMalt
      ? 'Floor-malting barley'
      : 'Brewing malt into ale',
    statusState: 'active',
    waterDetailHtml: detailHtml,
  };
}

function getWeaverStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  onsiteLabor: number,
): BuildingProcessorStatus {
  const usesFlax = weaverUsesFlax(building);
  const input = usesFlax
    ? {
        key: 'flax' as const,
        label: 'flax fibre',
        required: WEAVER_FLAX_PER_CYCLE,
        hint: 'farmstead carts supply harvested flax',
      }
    : {
        key: 'wool' as const,
        label: 'wool fleece',
        required: WEAVER_WOOL_PER_CYCLE,
        hint: 'staffed sheep holdings dispatch annual fleece',
      };
  const waterAssessment = usesFlax
    ? assessWellWaterSupply(building, worldQueries, WEAVER_FLAX_WATER_PER_CYCLE)
    : null;
  const routeCycles = usesFlax
    ? Math.min(
        Math.max(0, building.flax ?? 0) / WEAVER_FLAX_PER_CYCLE,
        Math.max(0, building.water) / WEAVER_FLAX_WATER_PER_CYCLE,
      )
    : Math.max(0, building.wool ?? 0) / WEAVER_WOOL_PER_CYCLE;
  const waterRows = formatWellWaterDetailRows(
    waterAssessment,
    usesFlax ? undefined : 'None - wool preparation is a dry process',
  );
  const detailHtml = waterRows + `
    <li><span>Inputs per cycle</span><span>${renderResourceCost(processorInputCost([input]), { compact: true })}</span></li>
    <li><span>Input policy</span><span>${weaverInputPolicyLabel(building.weaverInputPolicy)} · ready alternate fibre remains a fallback</span></li>
    <li><span>Selected textile route</span><span>${usesFlax ? 'Flax + hauled water' : 'Annual sheep fleece'} · ${formatInputCycleCoverage(routeCycles)}</span></li>
    <li><span>${usesFlax ? 'Flax' : 'Wool'} working stock</span><span>${stockAmount(building, input.key).toFixed(1)} onsite · ${input.required.toFixed(1)} per cycle · ${input.hint}</span></li>
    <li><span>Alternative input</span><span>${usesFlax ? `${Math.max(0, building.wool ?? 0).toFixed(1)} wool` : `${Math.max(0, building.flax ?? 0).toFixed(1)} flax + ${Math.max(0, building.water).toFixed(1)} water`} onsite</span></li>
    <li><span>Cloth yield</span><span>${WEAVER_CLOTH_PER_CYCLE.toFixed(1)} per completed cycle</span></li>
  `;
  const outputAtLimit = isOutputAtLimit(building, 'weaver', 'cloth');
  if (onsiteLabor === 0 && !outputAtLimit) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Work paused - the full roster is away with its cart'
        : 'Idle - assign weavers to work the loom',
      statusState: 'idle',
      waterDetailHtml: detailHtml,
    };
  }
  if (outputAtLimit) {
    return {
      statusText: 'Cloth target reached - weaving paused',
      statusState: 'idle',
      waterDetailHtml: detailHtml,
    };
  }
  if (usesFlax && building.water <= 1e-6) {
    return {
      statusText: wellWaterStatusIssue(waterAssessment) ?? 'Waiting for hauled water',
      statusState: 'warning',
      waterDetailHtml: detailHtml,
    };
  }
  if (stockAmount(building, input.key) <= 1e-6) {
    return {
      statusText: `Waiting for ${input.label}`,
      statusState: 'warning',
      waterDetailHtml: detailHtml,
    };
  }
  return {
    statusText: usesFlax
      ? 'Preparing flax and weaving linen cloth'
      : 'Weaving wool into cloth',
    statusState: 'active',
    waterDetailHtml: detailHtml,
  };
}

function getLumberMillStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  matureTrees: number,
  onsiteLabor: number,
): BuildingProcessorStatus {
  const storageCaps = buildingStorageCaps('lumber_mill');
  const waterAssessment = assessWellWaterSupply(building, worldQueries, MILL_WATER_PER_HARVEST);
  const requiresWater = MILL_WATER_PER_HARVEST > 0;
  const storageFull = storageCaps.timber > 0 && building.timber >= storageCaps.timber - 0.001;
  const waterDetailHtml = formatWellWaterDetailRows(
    waterAssessment,
    'None — timber is air-seasoned',
  );

  if (onsiteLabor === 0 && !storageFull && matureTrees > 0) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Harvest paused - the full roster is away with its cart'
        : 'Idle - assign labor to harvest timber',
      statusState: 'idle',
      waterDetailHtml,
    };
  }

  const waterIssue = requiresWater ? wellWaterStatusIssue(waterAssessment) : null;
  if (waterIssue) {
    return {
      statusText: waterIssue,
      statusState: 'warning',
      waterDetailHtml,
    };
  }

  if (storageFull) {
    return {
      statusText: `Storage full — not harvesting (${matureTrees} mature trees in range)`,
      statusState: 'idle',
      waterDetailHtml,
    };
  }

  if (matureTrees > 0) {
    return {
      statusText: `Harvesting — ${matureTrees} mature trees in range`,
      statusState: 'active',
      waterDetailHtml,
    };
  }

  return {
    statusText: 'Idle — no mature trees in range',
    statusState: 'idle',
    waterDetailHtml,
  };
}

function getMonasteryStatus(building: BuildingState, worldQueries: WorldQueries): BuildingProcessorStatus {
  const linked = worldQueries.isMonasteryLinkedToChapel(building);
  const productivity = linked ? 1 : MONASTERY_UNLINKED_PRODUCTIVITY;
  const grainNeeded = MONASTERY_OAT_GRAIN_PER_CYCLE * productivity;
  const inputCostRow = `<li><span>Inputs per cycle</span><span>${renderResourceCost({ oatGrain: grainNeeded }, { compact: true })}</span></li>`;

  if (!linked) {
    return {
      statusText: 'Reduced output — link to a staffed church by road',
      statusState: 'warning',
      waterDetailHtml: inputCostRow,
    };
  }

  if (isOutputAtLimit(building, 'monastery', 'food')) {
    return {
      statusText: 'Storage full — charity hauls paused',
      statusState: 'idle',
      waterDetailHtml: inputCostRow,
    };
  }

  if ((building.oatGrain ?? 0) + 1e-6 < grainNeeded) {
    return {
      statusText: `Waiting for oats — needs ${grainNeeded.toFixed(1)} oat grain per cycle for porridge`,
      statusState: 'warning',
      waterDetailHtml: inputCostRow,
    };
  }

  const hasMarketplace = worldQueries.hasRoadPathToBuildingKind(building.x, building.z, 'marketplace');
  if (!hasMarketplace) {
    return {
      statusText: 'Serving parish — connect marketplace by road for pilgrim income',
      statusState: 'active',
      waterDetailHtml: inputCostRow,
    };
  }

  return {
    statusText: 'Serving parish — charity, feasts, and pilgrimages',
    statusState: 'active',
    waterDetailHtml: inputCostRow,
  };
}

function getSimpleLaborStatus(
  building: BuildingState,
  operatingLabel: string,
  idleLabel: string,
  onsiteLabor: number,
): BuildingProcessorStatus {
  const staffed = onsiteLabor > 0;
  return {
    statusText: staffed
      ? operatingLabel
      : building.assignedLabor > 0
        ? 'Work paused - the full roster is away with its cart'
        : idleLabel,
    statusState: staffed ? 'active' : 'idle',
    waterDetailHtml: '',
  };
}

export function getBuildingProcessorStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  context: BuildingProcessorContext = {},
): BuildingProcessorStatus | null {
  const rosteredOnsiteLabor = onsiteBuildingLabor(
    building,
    worldQueries.getActiveDeliveryTrip?.(building) ?? null,
  );
  const onsiteLabor = rosteredOnsiteLabor;
  if (building.kind === 'brewery') {
    return getBreweryStatus(building, worldQueries, onsiteLabor);
  }
  if (building.kind === 'weaver') {
    return getWeaverStatus(building, worldQueries, onsiteLabor);
  }
  const profile = selectedCerealProfile(building) ?? PROCESSOR_PROFILES[building.kind];
  if (profile) {
    const waterAssessment = assessWellWaterSupply(building, worldQueries, profile.waterPerCycle);
    return buildProcessorStatus(building, profile, waterAssessment, onsiteLabor);
  }

  switch (building.kind) {
    case 'lumber_mill':
      return getLumberMillStatus(building, worldQueries, context.matureTrees ?? 0, onsiteLabor);
    case 'monastery':
      return getMonasteryStatus(building, worldQueries);
    case 'threshing_barn':
      return getSimpleLaborStatus(
        building,
        'Managing farm fields',
        'Idle — assign workers to work the fields',
        onsiteLabor,
      );
    case 'apiary':
    case 'vineyard':
      return getSeasonalProducerStatus(building, context.month, onsiteLabor);
    case 'carpenter':
      return getSimpleLaborStatus(
        building,
        'Supporting construction and cartwright work',
        'Idle — assign workers to the workshop',
        onsiteLabor,
      );
    default: {
      const definition = getBuildingDefinition(building.kind);
      if (!definition.acceptsLabor) return null;
      return getSimpleLaborStatus(
        building,
        'Operating',
        'Awaiting workers',
        onsiteLabor,
      );
    }
  }
}

function getSeasonalProducerStatus(
  building: BuildingState,
  month: number | undefined,
  onsiteLabor: number,
): BuildingProcessorStatus {
  const season = month == null ? null : specialtySeasonStatus(building.kind, month);
  const outputBlocker = seasonalProducerOutputBlocker(building);
  if (
    onsiteLabor === 0
    && !(season && !season.active)
    && outputBlocker === null
  ) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Seasonal work paused - the full roster is away with its cart'
        : building.kind === 'apiary'
          ? 'Idle - assign workers to tend the apiary'
          : 'Idle - assign workers to tend the vineyard',
      statusState: 'idle',
      waterDetailHtml: '',
    };
  }
  if (season && !season.active) {
    return {
      statusText: season.label,
      statusState: 'idle',
      waterDetailHtml: '',
    };
  }
  if (outputBlocker) {
    return {
      statusText: `Seasonal work waiting - ${outputBlocker.label.toLowerCase()} store needs ${outputBlocker.missingRoom.toFixed(1)} more room`,
      statusState: 'warning',
      waterDetailHtml: '',
    };
  }
  return {
    statusText: building.kind === 'apiary'
      ? 'Gathering honey and forest forage'
      : 'Harvesting grapes for wine and food',
    statusState: 'active',
    waterDetailHtml: '',
  };
}
