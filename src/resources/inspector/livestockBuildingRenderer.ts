import {
  LIVESTOCK_MILK_USE_PRESETS,
  livestockMilkUsePolicyForBuilding,
  livestockWaterRequiredPerCycle,
} from '../../economy/livestockPolicy.ts';
import {
  CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
  CATTLE_SLAUGHTER_FOOD_PER_HEAD,
  CATTLE_SLAUGHTER_HIDES_PER_HEAD,
  CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
} from '../../generated/gameBalance.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import type { InspectableTarget, LivestockHerdState, LivestockSpecies } from '../types.ts';
import {
  buildingDemolishHint,
  buildingExtentRow,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { FREE_CONSTRUCTION_COST_TOOLTIP } from '../../ui/resourceCost.ts';
import { livestockLaborForecastByBuilding } from './livestockLaborForecast.ts';

const SPECIES_LABEL: Record<LivestockSpecies, string> = {
  cattle: 'cattle',
  sheep: 'sheep',
  swine: 'pigs',
  horses: 'horses',
};

type SpeciesSummary = {
  headCount: number;
  presentHeadCount: number;
  pastureCount: number;
  pastureCapacity: number;
  suppliedCapacity: number;
};

function summarizeSpecies(
  herds: readonly LivestockHerdState[],
  species: LivestockSpecies,
): SpeciesSummary {
  const matching = herds.filter((herd) => herd.species === species);
  return {
    headCount: matching.reduce((sum, herd) => sum + herd.headCount, 0),
    presentHeadCount: matching.reduce((sum, herd) => (
      sum + (herd.species === 'horses' ? herd.presentHeadCount : herd.headCount)
    ), 0),
    pastureCount: matching.length,
    pastureCapacity: matching.reduce((sum, herd) => sum + herd.pastureCapacity, 0),
    suppliedCapacity: matching.reduce((sum, herd) => sum + herd.suppliedCapacity, 0),
  };
}

export function renderLivestockBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const storageCaps = buildingStorageCaps(building.kind);
  const pastures = context.worldQueries.getPasturesForBuilding(building.id);
  const herds = context.worldQueries.getLivestockHerdsForBuilding(building.id);
  const stockedHerds = herds.filter((herd) => herd.headCount > 0);
  const totalHead = herds.reduce((sum, herd) => sum + herd.headCount, 0);
  const totalPresentHead = herds.reduce((sum, herd) => (
    sum + (herd.species === 'horses' ? herd.presentHeadCount : herd.headCount)
  ), 0);
  const totalSupplied = herds.reduce((sum, herd) => sum + herd.suppliedCapacity, 0);
  const totalPastureCapacity = herds.reduce((sum, herd) => sum + herd.pastureCapacity, 0);
  const totalHay = herds.reduce((sum, herd) => sum + herd.hayStock, 0);
  const totalLastHay = herds.reduce((sum, herd) => sum + herd.lastHayOutput, 0);
  const totalLastFood = herds.reduce((sum, herd) => sum + herd.lastFoodOutput, 0);
  const totalLastPreserved = herds.reduce((sum, herd) => sum + herd.lastPreservedOutput, 0);
  const totalLastWool = herds.reduce((sum, herd) => sum + (herd.lastWoolOutput ?? 0), 0);
  const totalLastCulled = herds.reduce((sum, herd) => sum + herd.lastCulled, 0);
  const weightedHealth = totalPresentHead > 0
    ? herds.reduce((sum, herd) => sum + herd.health * (
      herd.species === 'horses' ? herd.presentHeadCount : herd.headCount
    ), 0) / totalPresentHead
    : 0;
  const waterPerCycle = herds.reduce(
    (sum, herd) => sum + livestockWaterRequiredPerCycle(
      herd.species,
      herd.species === 'horses' ? herd.presentHeadCount : herd.headCount,
    ),
    0,
  );
  const cattle = summarizeSpecies(herds, 'cattle');
  const sheep = summarizeSpecies(herds, 'sheep');
  const swine = summarizeSpecies(herds, 'swine');
  const horses = summarizeSpecies(herds, 'horses');
  const summaries = [
    ['cattle', cattle],
    ['sheep', sheep],
    ['swine', swine],
    ['horses', horses],
  ] as const;
  const speciesSummary = summaries
    .filter(([, summary]) => summary.pastureCount > 0)
    .map(([species, summary]) => `${summary.headCount} ${SPECIES_LABEL[species]} on ${summary.pastureCount}`)
    .join(' · ');
  const unassignedPastures = Math.max(0, pastures.length - herds.length);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const laborForecast = livestockLaborForecastByBuilding(context.gameState).get(building.id);
  const onsiteLabor = laborForecast?.onsiteHumanWorkers
    ?? onsiteBuildingLabor(building, activeTrip);
  const pairedOxen = laborForecast?.pairedOxen ?? 0;
  const milkUse = livestockMilkUsePolicyForBuilding(building);
  const waterStock = Math.max(0, building.water ?? 0);
  const underSupplied = totalPresentHead > totalSupplied + 1e-6;
  const waterShort = waterPerCycle > waterStock + 1e-6;
  const unhealthy = totalPresentHead > 0 && weightedHealth < 0.45;
  const maturePannageTrees = building.kind === 'swineherd'
    ? context.worldQueries.getMaturePannageTreeCount(building.id)
    : 0;

  const statusText = (() => {
    if (pastures.length === 0) {
      return building.kind === 'swineherd' ? 'Fence woodland pannage' : 'Fence a pasture';
    }
    if (herds.length === 0) return building.kind === 'swineherd'
      ? 'Select pannage to stock pigs'
      : 'Select a pasture to choose cattle, sheep, or horses';
    if (totalHead === 0) return `${herds.length} configured pasture${herds.length === 1 ? '' : 's'} · buy breeding stock there`;
    if (onsiteLabor <= 0) return 'Stocked pastures need herders';
    if (waterShort) return `Shared trough short by ${(waterPerCycle - waterStock).toFixed(1)} water/cycle`;
    if (underSupplied) return `${(totalPresentHead - totalSupplied).toFixed(1)} present head unsupported across linked pastures`;
    if (unhealthy) return 'One or more pasture herds are recovering';
    return `${totalPresentHead} present / ${totalHead} owned animals across ${stockedHerds.length} pasture${stockedHerds.length === 1 ? '' : 's'}`;
  })();

  const pastureLabel = building.kind === 'swineherd'
    ? 'Fence woodland pannage'
    : 'Fence pasture';
  const pastureControls = `<div class="inspector-action-panel" data-inspector-panel-title="Pastures">
      <p class="resource-inspector-note">Draw independent livestock parcels inside this holding's work extent. Select a finished pasture to choose cattle, sheep, or horses, trade its animals, and configure its hay meadow. Pasture horses keep their home place while assigned to mounted companies.</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button resource-action-button--icon" data-land-parcel="pasture" data-tooltip-title="${pastureLabel}" data-tooltip="Lay out a fenced parcel inside this holding's work extent." data-tooltip-cost="${FREE_CONSTRUCTION_COST_TOOLTIP}" data-tooltip-cost-affordable="true"><span class="inspector-action-icon" data-action-icon="pasture-parcel" aria-hidden="true"></span><span>${pastureLabel}</span></button>
      </div>
      ${pastures.length > 0 ? `<div class="resource-action-row">${pastures
        .map((pasture, index) => {
          const herd = context.worldQueries.getLivestockHerdForPasture(pasture.id);
          const label = herd
            ? `#${index + 1} · ${herd.headCount} ${SPECIES_LABEL[herd.species]}`
            : `#${index + 1} · choose animals`;
          return `<button type="button" class="inspector-jump-button" data-inspect-pasture="${pasture.id}" aria-label="Inspect pasture ${index + 1}">${label}</button>`;
        })
        .join('')}</div>` : ''}
    </div>`;

  const milkUseControls = building.kind === 'pastoral_farmstead' && (cattle.headCount + sheep.headCount > 0)
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Milk use">
        <p class="resource-inspector-note">This holding-wide policy applies to milk arriving from all linked cattle and sheep pastures.</p>
        <div class="resource-action-row">${LIVESTOCK_MILK_USE_PRESETS
          .map((preset) => `<button type="button" class="resource-action-button" data-livestock-milk-use="${preset.value}" ${milkUse.value === preset.value ? 'disabled' : ''}>${preset.label}</button>`)
          .join('')}</div>
        <p class="inspector-action-panel__hint">${milkUse.hint}</p>
      </div>`
    : '';

  const speciesRows = summaries
    .filter(([, summary]) => summary.pastureCount > 0)
    .map(([species, summary]) => `<li><span>${SPECIES_LABEL[species][0]!.toUpperCase()}${SPECIES_LABEL[species].slice(1)}</span><span>${summary.headCount} owned${species === 'horses' ? ` · ${summary.presentHeadCount} present · ${summary.headCount - summary.presentHeadCount} away` : ''} · ${summary.pastureCount} pasture${summary.pastureCount === 1 ? '' : 's'} · ${summary.suppliedCapacity.toFixed(1)} fully supplied / ${summary.pastureCapacity.toFixed(1)} grazing now</span></li>`)
    .join('');
  const benefitRows = building.kind !== 'pastoral_farmstead'
    ? `<li><span>Pannage trees</span><span>${maturePannageTrees} mature trees across linked pig parcels</span></li>`
    : `${cattle.headCount > 0 ? `<li><span>Cattle benefits</span><span>Milk once monthly from March–November (none in winter), manure, and ox assistance for up to ${CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS} priority fields · ${Math.round((1 - CATTLE_PLOUGH_WORK_MULTIPLIER) * 100)}% less ploughing work</span></li>
       <li><span>Cattle cull yield</span><span>${CATTLE_SLAUGHTER_FOOD_PER_HEAD} fresh meat · ${CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD} cured meat with salt, otherwise fresh · ${CATTLE_SLAUGHTER_HIDES_PER_HEAD} hide per surplus animal</span></li>
       <li><span>Hide store</span><span>${Math.round(Math.max(0, building.hides ?? 0))} / ${Math.round(storageCaps.hides ?? 0)} · hauled to a Tannery, Storehouse, or Trading Post</span></li>` : ''}
       ${sheep.headCount > 0 ? `<li><span>Sheep benefits</span><span>Annual June–July clip · ${SHEEP_WOOL_PER_SHEARING_PER_HEAD} wool per healthy supplied head</span></li>` : ''}
       ${horses.headCount > 0 ? `<li><span>Horse role</span><span>Purchased and pastured here; exact horses are collected by riders for Cavalry Yard muster and return to their reserved pasture on disband</span></li>` : ''}`;

  return {
    eyebrow: 'Mixed livestock holding',
    title: definition.label,
    statusText,
    statusState: waterShort || underSupplied || unhealthy
      ? 'warning'
      : totalHead > 0 && onsiteLabor > 0
        ? 'active'
        : 'idle',
    detailsHtml: `
      <li><span>Role</span><span>Shared herders, trough water, winter Animal Feed, processing, and stores for independently stocked pasture herds</span></li>
      <li><span>Linked pasture herds</span><span>${speciesSummary || 'None'}${unassignedPastures > 0 ? ` · ${unassignedPastures} awaiting animals` : ''}</span></li>
      ${speciesRows}
      <li><span>Combined stocking</span><span>${totalHead} owned · ${totalPresentHead} physically present · ${totalSupplied.toFixed(1)} fully supplied · ${totalPastureCapacity.toFixed(1)} grazing/mast-supported now</span></li>
      <li><span>Shared herding crew</span><span>${onsiteLabor} onsite worker${onsiteLabor === 1 ? '' : 's'}${pairedOxen > 0 ? ` + ${pairedOxen} paired ox${pairedOxen === 1 ? '' : 'en'}` : ''}</span></li>
      <li><span>Shared trough</span><span>${waterStock.toFixed(1)} / ${Math.round(storageCaps.water ?? 0)} water · ${waterPerCycle.toFixed(2)} needed per husbandry cycle</span></li>
      <li><span>Weighted herd health</span><span>${totalPresentHead > 0 ? `${Math.round(weightedHealth * 100)}%` : 'No animals present'}</span></li>
      <li><span>Pasture hay reserves</span><span>${Math.round(totalHay)} / ${Math.round(herds.filter((herd) => herd.species !== 'swine').length * LIVESTOCK_HAY_STORAGE_CAPACITY)} combined · ${Math.round(totalLastHay)} cut last cycle · configured on each pasture</span></li>
      <li><span>Feed workshop</span><span>${building.kind === 'pastoral_farmstead' ? `${Math.round(Math.max(0, building.oatGrain ?? 0))} oats onsite · ${LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE} oat → ${LIVESTOCK_ANIMAL_FEED_PER_CYCLE} Animal Feed per staffed cycle` : 'Finished Animal Feed arrives from pastoral farmsteads; pigs do not consume raw oats'}</span></li>
      ${building.kind === 'pastoral_farmstead' ? `<li><span>Milk use</span><span>${milkUse.label} across every cattle and sheep pasture</span></li>` : ''}
      <li><span>Last combined cycle</span><span>${Math.round(totalLastFood)} fresh food · ${Math.round(totalLastPreserved)} preserved${totalLastWool > 0 ? ` · ${Math.round(totalLastWool)} wool` : ''}${totalLastCulled > 0 ? ` · ${totalLastCulled} culled` : ''}</span></li>
      ${benefitRows}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
    `,
    demolish: {
      visible: true,
      hint: totalHead > 0
        ? `Sell all ${totalHead} animals from their individual pastures before demolishing this holding.`
        : pastures.length > 0
          ? `Remove its ${pastures.length === 1 ? 'pasture' : 'pastures'} first. ${buildingDemolishHint(building.kind)}`
          : buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `${pastureControls}${milkUseControls}`,
  };
}
