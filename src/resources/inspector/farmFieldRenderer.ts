import {
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_CROP_DEFINITIONS,
} from '../../generated/gameBalance.ts';
import { computeCattleFieldSupport } from '../../farming/cattleFieldSupport.ts';
import {
  cropEnvironmentalSuitability,
  cropHarvestUnit,
  cropLabel,
  cropProduce,
  cropSoilSuitability,
  effectiveFieldMoisture,
  expectedFieldYield,
  fieldCentroid,
  fieldShapeEfficiency,
  moistureSuitability,
} from '../../farming/farmFieldMath.ts';
import {
  activeFieldHarvestYield,
  cropCalendarLabel,
  currentFieldWorkRemaining,
  daysUntilCropHarvestWindow,
  earlyHarvestAvailability,
  fieldAcceptsFarmsteadLabor,
  fieldFarmsteadDistance,
  fieldPerimeter,
  fieldSeedGrainRemaining,
  fieldStageAllowed,
  fieldWorkerDays,
  fullFieldCycleWork,
  projectedCropFertility,
  projectedFieldFertility,
  seedGrainRequired,
  yearThreeCrop,
} from '../../farming/farmWorkPlanning.ts';
import { FARM_CROPS, type FarmCrop, type InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import {
  fieldManureApplied,
  fieldManureFertilityBonus,
  fieldManureRequirement,
} from '../../farming/manurePlanning.ts';
import {
  farmToolThroughputMultiplier,
  farmToolWorkerDayRunway,
} from '../../economy/civilianToolPolicy.ts';
import { breadGrainStock } from '../../economy/cropGoods.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function fieldSeedStock(
  farmstead: NonNullable<Extract<InspectableTarget, { kind: 'farm-field' }>['farmstead']>,
  crop: FarmCrop,
): number {
  switch (crop) {
    case 'rye': return farmstead.ryeGrain ?? 0;
    case 'oats': return farmstead.oatGrain ?? 0;
    case 'barley': return farmstead.barley ?? 0;
    case 'flax': return farmstead.flax ?? 0;
    case 'wheat': return farmstead.maslinGrain ?? 0;
    case 'fallow': return Number.POSITIVE_INFINITY;
  }
}

const STAGE_LABEL = {
  ploughing: 'Ploughing',
  sowing: 'Sowing',
  growing: 'Growing',
  harvesting: 'Harvesting',
} as const;

const PRIORITY_LABEL = ['Paused', 'Normal', 'High', 'Urgent'] as const;

function cropButton(
  crop: FarmCrop,
  current: FarmCrop | null,
  dataAttribute: 'data-field-crop' | 'data-field-following-crop',
): string {
  return `<button type="button" class="resource-action-button" ${dataAttribute}="${crop}" ${crop === current ? 'disabled' : ''}>${cropLabel(crop)}</button>`;
}

export function renderFarmFieldInspector(
  target: Extract<InspectableTarget, { kind: 'farm-field' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { field, farmstead } = target;
  const stageProgress = Math.max(0, Math.min(100, Math.round(field.stageProgress * 100)));
  const expectedYield = activeFieldHarvestYield(field);
  const shape = Math.round(fieldShapeEfficiency(field.corners) * 100);
  const center = fieldCentroid(field.corners);
  const effectiveMoisture = effectiveFieldMoisture(field.moisture, center.x, center.z);
  const moistureFit = Math.round(moistureSuitability(field.crop, effectiveMoisture) * 100);
  const soilFit = Math.round(cropSoilSuitability(field.crop, center.x, center.z) * 100);
  const environmentalFit = Math.round(
    cropEnvironmentalSuitability(field.crop, field.moisture, center.x, center.z) * 100,
  );
  const cattleSupport = computeCattleFieldSupport(context.gameState).get(field.id);
  const manureRequired = fieldManureRequirement(field);
  const manureApplied = fieldManureApplied(field);
  const manureBonus = fieldManureFertilityBonus(field);
  const projectedFertilityValue = projectedFieldFertility(field);
  const projectedFertility = Math.round(projectedFertilityValue * 100);
  const plannedFertility = projectedCropFertility(
    projectedFertilityValue,
    field.nextCrop,
  );
  const plannedYield = expectedFieldYield({
    ...field,
    crop: field.nextCrop,
    fertility: projectedFertilityValue,
  });
  const plannedSeed = seedGrainRequired(field.area, field.nextCrop);
  const thirdCrop = yearThreeCrop(field);
  const yearThreeFertility = projectedCropFertility(plannedFertility, thirdCrop);
  const yearThreeYield = expectedFieldYield({
    ...field,
    crop: thirdCrop,
    fertility: plannedFertility,
  });
  const yearThreeSeed = seedGrainRequired(field.area, thirdCrop);
  const cyclicRotation = field.followingCrop != null;
  const remainingWorkerDays = fieldWorkerDays(
    currentFieldWorkRemaining(field, cattleSupport?.ploughWorkMultiplier, farmstead),
  );
  const cycleWorkerDays = fieldWorkerDays(fullFieldCycleWork(field, farmstead));
  const farmsteadDistance = fieldFarmsteadDistance(field, farmstead);
  const perimeter = fieldPerimeter(field);
  const onsiteLabor = farmstead
    ? onsiteBuildingLabor(farmstead, context.worldQueries.getActiveDeliveryTrip(farmstead))
    : 0;
  const disabledFarmsteads = fireDisabledBuildingIds(context.gameState.fireIncidents.values());
  const eligibleFarmsteads = [...context.gameState.buildings.values()]
    .filter((building) => (
      building.kind === 'threshing_barn'
      && building.constructionComplete !== false
      && !disabledFarmsteads.has(building.id)
      && fieldAcceptsFarmsteadLabor(field, building)
    ));
  const assistingFarmsteads = eligibleFarmsteads
    .filter((building) => building.id !== field.farmsteadId);
  const availableFieldLabor = eligibleFarmsteads.reduce((sum, building) => (
    sum + onsiteBuildingLabor(
      building,
      context.worldQueries.getActiveDeliveryTrip(building),
    )
  ), 0);
  const toolThroughputMultiplier = farmToolThroughputMultiplier(
    farmstead?.ironwork ?? 0,
  );
  const toolCoveredWorkerDays = Math.min(
    remainingWorkerDays,
    farmToolWorkerDayRunway(farmstead?.ironwork ?? 0),
  );
  const adjustedRemainingWorkerDays = toolCoveredWorkerDays
    / CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    + remainingWorkerDays
    - toolCoveredWorkerDays;
  const crewDays = farmstead && availableFieldLabor > 0
    ? adjustedRemainingWorkerDays / availableFieldLabor
    : null;
  const active = Boolean(farmstead && availableFieldLabor > 0 && field.priority > 0);
  const clock = gameClock(context.gameState.tick);
  const month = clock.month;
  const earlyHarvest = earlyHarvestAvailability(field, month);
  const earlyHarvestLocked = field.stage === 'harvesting'
    && (field.harvestYieldMultiplier ?? 1) < 1 - 1e-6;
  const seasonalWindow = cropCalendarLabel(field.crop);
  const stageAllowed = fieldStageAllowed(field, month);
  const seedRemaining = fieldSeedGrainRemaining(field);
  const seedCrop = field.stage === 'ploughing' || field.stage === 'sowing'
    ? field.crop
    : field.nextCrop;
  const seedBlocked = field.stage === 'sowing'
    && stageAllowed
    && seedRemaining > 1e-6
    && (!farmstead || fieldSeedStock(farmstead, seedCrop) <= 1e-6);
  const statusText = !farmstead
    ? 'Orphaned — farmstead missing'
    : field.priority === 0
      ? 'Paused by priority'
      : !stageAllowed
        ? `${STAGE_LABEL[field.stage]} waiting · ${seasonalWindow}`
        : availableFieldLabor === 0 && field.stage !== 'growing'
          ? eligibleFarmsteads.some((building) => building.assignedLabor > 0)
            ? 'Field work paused - eligible farm crews are away with carts'
            : field.priority >= 2
              ? 'Waiting for workers at this or a nearby farmstead'
              : 'Waiting for workers at the linked farmstead'
          : seedBlocked
            ? `Sowing halted · ${seedRemaining.toFixed(1)} seed grain still needed`
            : earlyHarvestLocked
              ? `Early harvest · ${Math.round((field.harvestYieldMultiplier ?? 1) * 100)}% yield locked · ${stageProgress}% gathered`
              : `${STAGE_LABEL[field.stage]} · ${stageProgress}%`;

  const harvestWindowDays = daysUntilCropHarvestWindow(clock, field.crop);
  const harvestMonth = FARM_CROP_DEFINITIONS[field.crop].harvestMonth;
  const harvestMonthLabel = MONTH_LABELS[harvestMonth - 1] ?? `month ${harvestMonth}`;
  const harvestTiming = field.stage === 'harvesting'
    ? crewDays == null
      ? 'Harvest underway · assign an onsite crew to finish'
      : crewDays <= 0.05
        ? 'Completing now'
        : `About ${crewDays.toFixed(crewDays < 10 ? 1 : 0)} working days remaining at current crew`
    : harvestWindowDays <= 1e-6
      ? `${harvestMonthLabel} window open now`
      : `${Math.ceil(harvestWindowDays)} calendar days until the ${harvestMonthLabel} window${field.stage === 'growing' ? '' : ' · fieldwork must finish in season'}`;
  const yieldForecast = cropProduce(field.crop) === 'none'
    ? '0 produce · restores soil fertility'
    : field.stage === 'harvesting'
      ? `${expectedYield.toFixed(1)} ${cropHarvestUnit(field.crop)} total · ${Math.max(0, expectedYield - field.currentYield).toFixed(1)} remaining`
      : `${expectedYield.toFixed(1)} ${cropHarvestUnit(field.crop)} projected`;

  const cropControls = `<div class="inspector-action-panel">
      <p class="resource-inspector-note">Year 2 crop — schedule the next cycle without changing the crop already in the ground.</p>
      <div class="resource-action-row">${FARM_CROPS.map((crop) => cropButton(crop, field.nextCrop, 'data-field-crop')).join('')}</div>
      <p class="resource-inspector-note">Year 3 crop — choosing one enables a repeating ${cropLabel(field.crop)} → ${cropLabel(field.nextCrop)} → Year 3 cycle. Future manure is not promised.</p>
      <div class="resource-action-row">
        ${FARM_CROPS.map((crop) => cropButton(crop, field.followingCrop ?? null, 'data-field-following-crop')).join('')}
        <button type="button" class="resource-action-button" data-field-following-clear ${cyclicRotation ? '' : 'disabled'}>Repeat Year 2</button>
      </div>
    </div>`;
  const priorityControls = `<div class="inspector-action-panel">
      <p class="resource-inspector-note">Field-work priority — each farm handles its own active fields; High and Urgent also enter every nearby farmstead crew’s queue. Priority, seasonal urgency, linked-field ties, then field age decide the order.</p>
      <div class="resource-action-row">${[0, 1, 2, 3].map((priority) => `<button type="button" class="resource-action-button" data-field-priority="${priority}" ${priority === field.priority ? 'disabled' : ''}>${PRIORITY_LABEL[priority]}</button>`).join('')}</div>
    </div>`;
  const earlyHarvestControls = field.stage === 'growing' && cropProduce(field.crop) !== 'none'
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Early harvest — ${!farmstead || farmstead.constructionComplete === false
          ? 'finish the farmstead before ordering the cut.'
          : earlyHarvest.reason} Waiting until ${harvestMonthLabel} keeps 100% yield.</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button" data-field-early-harvest ${!earlyHarvest.available || !farmstead?.constructionComplete ? 'disabled' : ''}>Begin early harvest · ${(expectedYield * earlyHarvest.yieldMultiplier).toFixed(1)} ${cropHarvestUnit(field.crop)} · ${Math.round(earlyHarvest.yieldMultiplier * 100)}%</button>
        </div>
      </div>`
    : '';

  return {
    eyebrow: 'Farm field',
    title: `${cropLabel(field.crop)} field`,
    statusText,
    statusState: seedBlocked ? 'warning' : active || field.stage === 'growing' ? 'active' : 'idle',
    detailsHtml: `
      <li><span>Area</span><span>${Math.round(field.area).toLocaleString()} m² · ${(field.area / 10_000).toFixed(field.area < 1_000 ? 3 : 2)} ha</span></li>
      <li><span>Stage</span><span>${STAGE_LABEL[field.stage]} · ${stageProgress}%</span></li>
      <li><span>${cropProduce(field.crop) === 'none' ? 'Days until rest complete' : 'Days until harvest'}</span><span>${harvestTiming}</span></li>
      <li><span>Projected yield</span><span>${yieldForecast}</span></li>
      <li><span>Three-year rotation</span><span>${cropLabel(field.crop)} → ${cropLabel(field.nextCrop)} → ${cropLabel(thirdCrop)}${cyclicRotation ? ` → ${cropLabel(field.crop)}` : ' · Year 3 repeats until scheduled'}</span></li>
      <li><span>Crop calendar</span><span>${cropCalendarLabel(field.crop)}</span></li>
      <li><span>Priority</span><span>${PRIORITY_LABEL[field.priority] ?? 'Normal'}</span></li>
      <li><span>Available field crews</span><span>${availableFieldLabor} workers across ${eligibleFarmsteads.length} farmstead${eligibleFarmsteads.length === 1 ? '' : 's'}${assistingFarmsteads.length > 0 ? ` · ${assistingFarmsteads.length} neighboring crew${assistingFarmsteads.length === 1 ? '' : 's'} may assist` : field.priority < 2 ? ' · set High or Urgent to request nearby help' : ' · no neighboring farmstead in range'}</span></li>
      <li><span>Ox support</span><span>${cattleSupport
        ? `Active from nearby cattle · ${Math.round((1 - cattleSupport.ploughWorkMultiplier) * 100)}% less ploughing`
        : 'None · requires a top-two priority slot and healthy, supplied cattle within range'}</span></li>
      <li><span>Manure spread</span><span>${manureApplied.toFixed(1)} / ${manureRequired.toFixed(1)} this cycle · +${(manureBonus * 100).toFixed(1)} soil${field.stage === 'ploughing' ? ` · ${Math.max(0, farmstead?.manure ?? 0).toFixed(1)} waiting at farmstead` : ''}</span></li>
      <li><span>Farmstead</span><span>${farmstead ? `${onsiteLabor} on site / ${farmstead.assignedLabor} assigned · ${breadGrainStock(farmstead).toFixed(1)} bread grain (${(farmstead.ryeGrain ?? 0).toFixed(1)} rye / ${(farmstead.oatGrain ?? 0).toFixed(1)} oats / ${(farmstead.maslinGrain ?? 0).toFixed(1)} maslin) · ${Math.round(farmstead.manure ?? 0)} manure stored` : 'Missing'}</span></li>
      <li><span>Field tools</span><span>${toolThroughputMultiplier > 1 ? `Maintained · ${Math.round((toolThroughputMultiplier - 1) * 100)}% faster field work` : 'Baseline hand tools · farmstead needs smith-forged ironwork for faster work'}</span></li>
      <li><span>Land fit</span><span>${environmentalFit}% for ${cropLabel(field.crop).toLowerCase()} · ${soilFit}% soil / ${moistureFit}% moisture</span></li>
      <li><span>Water</span><span>${Math.round(field.moisture * 100)}% groundwater · ${Math.round(effectiveMoisture * 100)}% after soil retention</span></li>
      <li><span>Current-cycle soil</span><span>${Math.round(field.fertility * 100)}% → ${projectedFertility}% fertility</span></li>
      <li><span>Year 2 soil</span><span>${projectedFertility}% → ${Math.round(plannedFertility * 100)}% after ${cropLabel(field.nextCrop).toLowerCase()}</span></li>
      <li><span>Year 3 soil</span><span>${Math.round(plannedFertility * 100)}% → ${Math.round(yearThreeFertility * 100)}% after ${cropLabel(thirdCrop).toLowerCase()} · future manure excluded</span></li>
      <li><span>Average slope</span><span>${field.averageSlopeDegrees.toFixed(1)}°</span></li>
      <li><span>Shape efficiency</span><span>${shape}%</span></li>
      <li><span>Farmstead distance</span><span>${farmstead ? `${farmsteadDistance.toFixed(0)} m · travel adds work each field stage` : 'Unknown · farmstead missing'}</span></li>
      <li><span>Parcel boundary</span><span>${perimeter.toFixed(0)} m · separate parcels repeat setup and turning work</span></li>
      <li><span>Full-cycle labor</span><span>${cycleWorkerDays.toFixed(1)} base worker-days · tools and oxen can reduce elapsed time</span></li>
      ${earlyHarvestLocked ? `<li><span>Harvest decision</span><span>Early cut · ${Math.round((field.harvestYieldMultiplier ?? 1) * 100)}% of normal yield locked</span></li>` : ''}
      <li><span>Next-crop potential</span><span>${cropProduce(field.nextCrop) === 'none' ? 'Worked fallow · restores soil without seed' : `${plannedYield.toFixed(1)} ${cropHarvestUnit(field.nextCrop)} at current moisture · ${plannedSeed.toFixed(1)} seed`}</span></li>
      <li><span>Year 3 potential</span><span>${cropProduce(thirdCrop) === 'none' ? 'Worked fallow · restores soil without seed' : `${yearThreeYield.toFixed(1)} ${cropHarvestUnit(thirdCrop)} at current moisture · ${yearThreeSeed.toFixed(1)} seed`}</span></li>
      <li><span>Protected seed</span><span>${seedRemaining <= 1e-6 ? 'None' : `${seedRemaining.toFixed(1)} grain · ${field.stage === 'ploughing' || field.stage === 'sowing' ? cropLabel(field.crop) : cropLabel(field.nextCrop)}`}</span></li>
      ${field.stage === 'growing' ? '' : `<li><span>Work remaining</span><span>${remainingWorkerDays.toFixed(1)} worker-days${crewDays == null ? ' · assign a crew' : ` · ${crewDays.toFixed(1)} days for this crew`}</span></li>`}
      ${field.stage === 'harvesting' ? `<li><span>Brought in</span><span>${field.currentYield.toFixed(1)} / ${expectedYield.toFixed(1)} ${cropHarvestUnit(field.crop)}</span></li>` : ''}
      <li><span>Last harvest</span><span>${field.harvestCount === 0 ? 'None yet' : `${field.lastYield.toFixed(1)} yield units · ${field.harvestCount} total`}</span></li>
    `,
    demolish: { visible: true, label: 'Remove field', hint: 'Clears the field boundary. Worked land is not refunded.' },
    labor: hiddenLabor(),
    supplementalPanelHtml: `${earlyHarvestControls}${cropControls}${priorityControls}`,
  };
}
