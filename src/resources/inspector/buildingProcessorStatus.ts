import {
  BREWERY_ALE_PER_CYCLE,
  BREWERY_FIREWOOD_PER_CYCLE,
  BREWERY_GRAIN_PER_CYCLE,
  BREWERY_WATER_PER_CYCLE,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_FLOUR_PER_CYCLE,
  GRANARY_FOOD_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  MONASTERY_GRAIN_PER_CYCLE,
  MONASTERY_UNLINKED_PRODUCTIVITY,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  WATERMILL_FLOUR_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../../generated/gameBalance.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import type { BuildingKind, BuildingState } from '../types.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import { specialtySeasonStatus } from '../../economy/specialtyTrade.ts';
import {
  isProcessorOutputTargetKind,
  processorInputStagingCycles,
  processorOutputHeadroom,
  processorOutputTargetForBuilding,
} from '../../economy/processorOutputPolicy.ts';
import {
  assessWellWaterSupply,
  formatWellWaterDetailRows,
  wellWaterStatusIssue,
  type WellWaterAssessment,
} from './buildingWaterStatus.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';

export type BuildingProcessorContext = {
  matureTrees?: number;
  month?: number;
};

export type BuildingProcessorStatus = {
  statusText: string;
  statusState: 'active' | 'idle' | 'warning';
  waterDetailHtml: string;
};

type StockKey = 'timber' | 'firewood' | 'stone' | 'water' | 'food' | 'grain' | 'flour' | 'ale' | 'preservedFood' | 'wool' | 'cloth';

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
  granary: {
    requiresLabor: true,
    waterPerCycle: GRANARY_WATER_PER_CYCLE,
    inputs: [
      { key: 'flour', label: 'flour', required: GRANARY_FLOUR_PER_CYCLE, deliveryHint: 'mill deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: GRANARY_FIREWOOD_PER_CYCLE, deliveryHint: 'lodge deliveries may supply' },
    ],
    output: 'food',
    outputPerCycle: GRANARY_FOOD_PER_CYCLE,
    operatingLabel: 'Baking staple food',
    idleNoWorkersLabel: 'Idle — assign workers to bake food',
  },
  brewery: {
    requiresLabor: true,
    waterPerCycle: BREWERY_WATER_PER_CYCLE,
    inputs: [
      { key: 'grain', label: 'grain', required: BREWERY_GRAIN_PER_CYCLE, deliveryHint: 'farmstead or granary deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: BREWERY_FIREWOOD_PER_CYCLE, deliveryHint: 'lodge or storehouse deliveries may supply' },
    ],
    output: 'ale',
    outputPerCycle: BREWERY_ALE_PER_CYCLE,
    operatingLabel: 'Brewing ale',
    idleNoWorkersLabel: 'Idle — assign workers to brew ale',
  },
  smokehouse: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'food', label: 'food', required: SMOKEHOUSE_FOOD_PER_CYCLE, deliveryHint: 'granary deliveries may supply' },
      { key: 'firewood', label: 'firewood', required: SMOKEHOUSE_FIREWOOD_PER_CYCLE, deliveryHint: 'lodge deliveries may supply' },
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
      { key: 'grain', label: 'grain', required: WATERMILL_GRAIN_PER_CYCLE, deliveryHint: 'farmstead or granary deliveries may supply' },
    ],
    output: 'flour',
    outputPerCycle: WATERMILL_FLOUR_PER_CYCLE,
    operatingLabel: 'Milling grain into flour',
    idleNoWorkersLabel: 'Idle — assign workers to run the mill',
  },
  weaver: {
    requiresLabor: true,
    waterPerCycle: 0,
    inputs: [
      { key: 'wool', label: 'wool', required: WEAVER_WOOL_PER_CYCLE, deliveryHint: 'staffed sheep holdings dispatch annual fleece by road' },
    ],
    output: 'cloth',
    outputPerCycle: WEAVER_CLOTH_PER_CYCLE,
    operatingLabel: 'Weaving wool into cloth',
    idleNoWorkersLabel: 'Idle — assign weavers to work the loom',
  },
};

function stockAmount(building: BuildingState, key: StockKey): number {
  return building[key] ?? 0;
}

function stockLabel(key: StockKey): string {
  return key === 'preservedFood' ? 'preserved food' : key;
}

function isOutputAtLimit(
  building: BuildingState,
  kind: BuildingKind,
  output: StockKey,
): boolean {
  if (isProcessorOutputTargetKind(kind)) {
    return (processorOutputHeadroom(building) ?? Number.POSITIVE_INFINITY) <= 0.001;
  }
  const cap = buildingStorageCaps(kind)[output];
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

function formatProcessorInputBufferRow(
  building: BuildingState,
  profile: ProcessorProfile,
): string {
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
  if (!limitingInput) return '';
  const stagingCycles = isProcessorOutputTargetKind(building.kind)
    ? processorInputStagingCycles(building.processorOutputTargetPercent)
    : null;
  const inputCoverage = isProcessorOutputTargetKind(building.kind)
    ? `${formatInputCycleCoverage(limitingCycles)} on site / ${stagingCycles} ${
        stagingCycles === 1 ? 'cycle' : 'cycles'
      } staged`
    : formatInputCycleCoverage(limitingCycles);
  const inputRow = `<li><span>On-site input buffer</span><span>${inputCoverage} · ${limitingInput} limits</span></li>`;
  if (!profile.output || profile.outputPerCycle <= 1e-9) return inputRow;
  const outputLimit = processorOutputTargetForBuilding(building)
    ?? (buildingStorageCaps(building.kind)[profile.output] ?? 0);
  const outputRoom = isProcessorOutputTargetKind(building.kind)
    ? (processorOutputHeadroom(building) ?? 0)
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

  if (profile.requiresLabor && onsiteLabor === 0) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Work paused - the full roster is away with its cart'
        : profile.idleNoWorkersLabel,
      statusState: 'idle',
      waterDetailHtml: processorDetailHtml,
    };
  }

  if (profile.output && isOutputAtLimit(building, building.kind, profile.output)) {
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

  if (onsiteLabor === 0) {
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
  const grainNeeded = MONASTERY_GRAIN_PER_CYCLE * productivity;

  if (!linked) {
    return {
      statusText: 'Reduced output — link to a staffed chapel by road',
      statusState: 'warning',
      waterDetailHtml: '',
    };
  }

  if (isOutputAtLimit(building, 'monastery', 'food')) {
    return {
      statusText: 'Storage full — charity hauls paused',
      statusState: 'idle',
      waterDetailHtml: '',
    };
  }

  if (building.grain + 1e-6 < grainNeeded) {
    return {
      statusText: `Waiting for grain — needs ${grainNeeded.toFixed(1)} per cycle; farmstead or granary deliveries may supply`,
      statusState: 'warning',
      waterDetailHtml: '',
    };
  }

  const hasMarketplace = worldQueries.hasRoadPathToBuildingKind(building.x, building.z, 'marketplace');
  if (!hasMarketplace) {
    return {
      statusText: 'Serving parish — connect marketplace by road for pilgrim income',
      statusState: 'active',
      waterDetailHtml: '',
    };
  }

  return {
    statusText: 'Serving parish — charity, feasts, and pilgrimages',
    statusState: 'active',
    waterDetailHtml: '',
  };
}

function getFerryStatus(
  building: BuildingState,
  worldQueries: WorldQueries,
  onsiteLabor: number,
): BuildingProcessorStatus {
  if (onsiteLabor === 0) {
    return {
      statusText: building.assignedLabor > 0
        ? 'Crossing paused - the full roster is away with its cart'
        : 'Idle - assign workers to operate the ferry',
      statusState: 'idle',
      waterDetailHtml: '',
    };
  }

  const hasMarketplace = worldQueries.hasRoadPathToBuildingKind(building.x, building.z, 'marketplace');
  if (!hasMarketplace) {
    return {
      statusText: 'Idle — needs a road link to the marketplace',
      statusState: 'warning',
      waterDetailHtml: '',
    };
  }

  return {
    statusText: 'Operating river crossing — regional trade income',
    statusState: 'active',
    waterDetailHtml: '',
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
  const onsiteLabor = onsiteBuildingLabor(
    building,
    worldQueries.getActiveDeliveryTrip?.(building) ?? null,
  );
  const profile = PROCESSOR_PROFILES[building.kind];
  if (profile) {
    const waterAssessment = assessWellWaterSupply(building, worldQueries, profile.waterPerCycle);
    return buildProcessorStatus(building, profile, waterAssessment, onsiteLabor);
  }

  switch (building.kind) {
    case 'lumber_mill':
      return getLumberMillStatus(building, worldQueries, context.matureTrees ?? 0, onsiteLabor);
    case 'monastery':
      return getMonasteryStatus(building, worldQueries);
    case 'ferry_landing':
      return getFerryStatus(building, worldQueries, onsiteLabor);
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
  if (onsiteLabor === 0) {
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
  const season = month == null ? null : specialtySeasonStatus(building.kind, month);
  if (season && !season.active) {
    return {
      statusText: season.label,
      statusState: 'idle',
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
