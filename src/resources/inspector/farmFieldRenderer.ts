import { FARM_OPTIMAL_FIELD_AREA } from '../../generated/gameBalance.ts';
import { computeCattleFieldSupport } from '../../farming/cattleFieldSupport.ts';
import {
  cropHarvestUnit,
  cropLabel,
  cropProduce,
  expectedFieldYield,
  fieldShapeEfficiency,
  fieldSizeEfficiency,
  moistureSuitability,
} from '../../farming/farmFieldMath.ts';
import {
  activeFieldHarvestYield,
  cropCalendarLabel,
  currentFieldWorkRemaining,
  earlyHarvestAvailability,
  fieldSeedGrainRemaining,
  fieldStageAllowed,
  fieldWorkerDays,
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
  const sizeEfficiency = Math.round(fieldSizeEfficiency(field.area) * 100);
  const moistureFit = Math.round(moistureSuitability(field.crop, field.moisture) * 100);
  const cattleSupport = computeCattleFieldSupport(context.gameState).get(field.id);
  const projectedFertilityValue = projectedFieldFertility(
    field,
    cattleSupport?.fertilityBonus,
  );
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
    currentFieldWorkRemaining(field, cattleSupport?.ploughWorkMultiplier),
  );
  const onsiteLabor = farmstead
    ? onsiteBuildingLabor(farmstead, context.worldQueries.getActiveDeliveryTrip(farmstead))
    : 0;
  const crewDays = farmstead && onsiteLabor > 0
    ? remainingWorkerDays / onsiteLabor
    : null;
  const active = Boolean(farmstead && onsiteLabor > 0 && field.priority > 0);
  const month = gameClock(context.gameState.tick).month;
  const earlyHarvest = earlyHarvestAvailability(field, month);
  const earlyHarvestLocked = field.stage === 'harvesting'
    && (field.harvestYieldMultiplier ?? 1) < 1 - 1e-6;
  const seasonalWindow = cropCalendarLabel(field.crop);
  const stageAllowed = fieldStageAllowed(field, month);
  const seedRemaining = fieldSeedGrainRemaining(field);
  const seedBlocked = field.stage === 'sowing'
    && stageAllowed
    && seedRemaining > 1e-6
    && (farmstead?.grain ?? 0) <= 1e-6;
  const statusText = !farmstead
    ? 'Orphaned — farmstead missing'
    : field.priority === 0
      ? 'Paused by priority'
      : !stageAllowed
        ? `${STAGE_LABEL[field.stage]} waiting · ${seasonalWindow}`
        : onsiteLabor === 0 && field.stage !== 'growing'
          ? farmstead.assignedLabor > 0
            ? 'Field work paused - the farm crew is away with its cart'
            : 'Waiting for farmstead workers'
          : seedBlocked
            ? `Sowing halted · ${seedRemaining.toFixed(1)} seed grain still needed`
            : earlyHarvestLocked
              ? `Early harvest · ${Math.round((field.harvestYieldMultiplier ?? 1) * 100)}% yield locked · ${stageProgress}% gathered`
              : `${STAGE_LABEL[field.stage]} · ${stageProgress}%`;

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
      <p class="resource-inspector-note">Farmstead work priority — also decides which nearby fields receive the limited ox team. Ties favor the older field.</p>
      <div class="resource-action-row">${[0, 1, 2, 3].map((priority) => `<button type="button" class="resource-action-button" data-field-priority="${priority}" ${priority === field.priority ? 'disabled' : ''}>${PRIORITY_LABEL[priority]}</button>`).join('')}</div>
    </div>`;
  const earlyHarvestControls = field.stage === 'growing' && cropProduce(field.crop) !== 'none'
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Early harvest — ${!farmstead || farmstead.constructionComplete === false
          ? 'finish the farmstead before ordering the cut.'
          : earlyHarvest.reason} Waiting until September keeps 100% yield.</p>
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
      <li><span>Area</span><span>${Math.round(field.area)} m²</span></li>
      <li><span>Stage</span><span>${STAGE_LABEL[field.stage]} · ${stageProgress}%</span></li>
      <li><span>Three-year rotation</span><span>${cropLabel(field.crop)} → ${cropLabel(field.nextCrop)} → ${cropLabel(thirdCrop)}${cyclicRotation ? ` → ${cropLabel(field.crop)}` : ' · Year 3 repeats until scheduled'}</span></li>
      <li><span>Crop calendar</span><span>${cropCalendarLabel(field.crop)}</span></li>
      <li><span>Priority</span><span>${PRIORITY_LABEL[field.priority] ?? 'Normal'}</span></li>
      <li><span>Ox support</span><span>${cattleSupport
        ? `Active from nearby cattle · ${Math.round((1 - cattleSupport.ploughWorkMultiplier) * 100)}% less ploughing · +${Math.round(cattleSupport.fertilityBonus * 100)} fertility after cycle`
        : 'None · requires a top-two priority slot and healthy, supplied cattle within range'}</span></li>
      <li><span>Farmstead</span><span>${farmstead ? `${onsiteLabor} on site / ${farmstead.assignedLabor} assigned · ${Math.round(farmstead.grain)} grain stored` : 'Missing'}</span></li>
      <li><span>Moisture</span><span>${Math.round(field.moisture * 100)}% · ${moistureFit}% crop fit</span></li>
      <li><span>Current-cycle soil</span><span>${Math.round(field.fertility * 100)}% → ${projectedFertility}% fertility</span></li>
      <li><span>Year 2 soil</span><span>${projectedFertility}% → ${Math.round(plannedFertility * 100)}% after ${cropLabel(field.nextCrop).toLowerCase()}</span></li>
      <li><span>Year 3 soil</span><span>${Math.round(plannedFertility * 100)}% → ${Math.round(yearThreeFertility * 100)}% after ${cropLabel(thirdCrop).toLowerCase()} · future manure excluded</span></li>
      <li><span>Average slope</span><span>${field.averageSlopeDegrees.toFixed(1)}°</span></li>
      <li><span>Shape efficiency</span><span>${shape}%</span></li>
      <li><span>Size efficiency</span><span>${sizeEfficiency}% · full through ${FARM_OPTIMAL_FIELD_AREA.toLocaleString()} m²</span></li>
      <li><span>Expected harvest</span><span>${cropProduce(field.crop) === 'none' ? 'Restores fertility' : `${expectedYield.toFixed(1)} ${cropHarvestUnit(field.crop)}`}</span></li>
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
