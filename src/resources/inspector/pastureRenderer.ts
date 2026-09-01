import {
  effectiveLivestockBreedingReserve,
  livestockBreedingPhaseForMonth,
  livestockHaymakingPresets,
  livestockMatingSeason,
  livestockPendingOffspring,
  livestockPurchaseCost,
  livestockPurchaseGoldPerHead,
  livestockReservePresets,
  livestockSaleGoldPerHead,
  livestockSaleProceeds,
} from '../../economy/livestockPolicy.ts';
import {
  livestockHoldingWholeHeadLimit,
  livestockPastureManagementHeadAllowance,
  neutralPastureHeadCapacity,
  pannageHoldingHeadCapacity,
  pastureAreaHeadCapacity,
} from '../../farming/pastureCapacity.ts';
import {
  CATTLE_MAX_SLOPE_DEGREES,
  CATTLE_STARTER_HERD,
  HORSE_MAX_SLOPE_DEGREES,
  HORSE_STARTER_HERD,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_MINIMUM_BREEDING_HEADS,
  SHEEP_MAX_SLOPE_DEGREES,
  SHEEP_STARTER_HERD,
  SWINE_STARTER_HERD,
} from '../../generated/gameBalance.ts';
import { renderResourceAmount } from '../../ui/resourceCost.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import type { InspectableTarget, LivestockSpecies } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

const SPECIES_LABEL: Record<LivestockSpecies, string> = {
  cattle: 'Cattle pasture',
  sheep: 'Sheep pasture',
  swine: 'Woodland pannage',
  horses: 'Horse pasture',
};

function starterHerd(species: LivestockSpecies): number {
  if (species === 'cattle') return CATTLE_STARTER_HERD;
  if (species === 'sheep') return SHEEP_STARTER_HERD;
  if (species === 'horses') return HORSE_STARTER_HERD;
  return SWINE_STARTER_HERD;
}

export function renderPastureInspector(
  target: Extract<InspectableTarget, { kind: 'pasture' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { pasture, farmstead, herd } = target;
  const siblingPastures = farmstead
    ? context.worldQueries.getPasturesForBuilding(farmstead.id)
    : [];
  const siblingHerds = farmstead
    ? context.worldQueries.getLivestockHerdsForBuilding(farmstead.id)
    : [];
  const matureTrees = context.worldQueries.getMaturePannageTreeCountForPasture(pasture.id);
  const pannage = pannageHoldingHeadCapacity([pasture], matureTrees);
  const neutralCapacityFor = (species: LivestockSpecies): number => species === 'swine'
    ? pannage.headCapacity
    : neutralPastureHeadCapacity(pasture, species) ?? 0;
  const otherHerds = siblingHerds.filter((candidate) => candidate.pastureId !== pasture.id);
  const headLimitFor = (species: LivestockSpecies): number => Math.min(
    livestockHoldingWholeHeadLimit(neutralCapacityFor(species), species),
    livestockPastureManagementHeadAllowance(species, otherHerds),
  );
  const cattleCapacity = neutralCapacityFor('cattle');
  const sheepCapacity = neutralCapacityFor('sheep');
  const horseCapacity = neutralCapacityFor('horses');
  const cattleLimit = headLimitFor('cattle');
  const sheepLimit = headLimitFor('sheep');
  const horseLimit = headLimitFor('horses');
  const speciesCompatible = (species: 'cattle' | 'sheep' | 'horses'): boolean => (
    pasture.averageSlopeDegrees <= (
      species === 'cattle'
        ? CATTLE_MAX_SLOPE_DEGREES
        : species === 'sheep'
          ? SHEEP_MAX_SLOPE_DEGREES
          : HORSE_MAX_SLOPE_DEGREES
    ) + 1e-6
    && headLimitFor(species) > 0
  );

  const neutralCapacity = herd ? neutralCapacityFor(herd.species) : 0;
  const headLimit = herd ? headLimitFor(herd.species) : 0;
  const openSlots = herd ? Math.max(0, headLimit - herd.headCount) : 0;
  const starterOrder = herd
    ? Math.min(Math.max(0, starterHerd(herd.species) - herd.headCount), openSlots)
    : 0;
  const treasuryGold = Math.max(0, context.resourceTotals.gold);
  const purchasePrice = herd ? livestockPurchaseGoldPerHead(herd.species) : 0;
  const salePrice = herd ? livestockSaleGoldPerHead(herd.species) : 0;
  const pastureHorses = herd?.species === 'horses'
    ? [...context.gameState.cavalryHorses.values()].filter((horse) => horse.pastureId === pasture.id)
    : [];
  const availableHorseCount = pastureHorses.filter((horse) => (
    horse.atPasture && horse.assignedCompanyId === null
  )).length;
  const presentHeads = herd?.species === 'horses'
    ? Math.max(0, herd.presentHeadCount)
    : Math.max(0, herd?.headCount ?? 0);
  const awayHorseCount = herd?.species === 'horses'
    ? Math.max(0, herd.headCount - presentHeads)
    : 0;
  const sellableHeads = herd?.species === 'horses' ? availableHorseCount : herd?.headCount ?? 0;
  const breedingReserve = herd
    ? effectiveLivestockBreedingReserve(herd.species, herd.breedingReserve)
    : 0;
  const healthyEnough = Boolean(herd && herd.health >= 0.72);
  const supportRatio = herd && presentHeads > 0
    ? Math.min(1, Math.max(0, herd.suppliedCapacity) / presentHeads)
    : 1;
  const month = gameClock(context.gameState.tick).month;
  const breedingPhase = herd ? livestockBreedingPhaseForMonth(herd.species, month) : 'waiting';
  const matingSeason = herd ? livestockMatingSeason(herd.species) : 'summer';
  const pendingOffspring = herd ? livestockPendingOffspring(herd.breedingProgress) : 0;
  const nextOffspringProgress = herd
    ? Math.round((Math.max(0, herd.breedingProgress) % 1) * 100)
    : 0;
  const breedingStatus = !herd
    ? 'Choose the animals for this pasture'
    : herd.species === 'horses'
      ? `${availableHorseCount} available for muster · ${awayHorseCount} away with mounted companies`
    : breedingPhase === 'spring-births'
      ? pendingOffspring > 0
        ? `${pendingOffspring} offspring due this spring · stops at ${headLimit}`
        : `Spring birth window · no confirmed offspring waiting · ${matingSeason} mating`
      : breedingPhase === 'conception'
        ? herd.headCount < LIVESTOCK_MINIMUM_BREEDING_HEADS
          ? `Mating season · needs at least ${LIVESTOCK_MINIMUM_BREEDING_HEADS} animals`
          : herd.headCount >= headLimit
            ? `Mating season · at this pasture's ${headLimit}-head ceiling`
            : !healthyEnough || supportRatio < 0.9
              ? `Mating paused · needs 72% health and 90% supply (${Math.round(herd.health * 100)}% / ${Math.round(supportRatio * 100)}%)`
              : `${pendingOffspring} due in spring · ${nextOffspringProgress}% toward another · stops at ${headLimit}`
        : pendingOffspring > 0
          ? `${pendingOffspring} offspring due in spring · ${matingSeason} mating complete`
          : `No offspring pending · mating season is ${matingSeason}`;

  const speciesControls = farmstead?.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Animals for this pasture">
        <p class="resource-inspector-note">Each fenced pasture keeps its own herd and carrying limit. ${herd?.headCount
          ? `Sell this pasture's ${herd.headCount} animals before changing species. The fence and every sibling pasture remain untouched.`
          : 'Choose cattle, sheep, or horses for this empty pasture. Reclassifying it does not affect its fence or siblings.'}</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button resource-action-button--icon" data-livestock-species="cattle" ${herd?.species === 'cattle' || Boolean(herd?.headCount) || !speciesCompatible('cattle') ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="cattle-herd" aria-hidden="true"></span><span>Cattle · ${cattleLimit} max</span></button>
          <button type="button" class="resource-action-button resource-action-button--icon" data-livestock-species="sheep" ${herd?.species === 'sheep' || Boolean(herd?.headCount) || !speciesCompatible('sheep') ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="sheep-flock" aria-hidden="true"></span><span>Sheep · ${sheepLimit} max</span></button>
          <button type="button" class="resource-action-button resource-action-button--icon" data-livestock-species="horses" ${herd?.species === 'horses' || Boolean(herd?.headCount) || !speciesCompatible('horses') ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="cavalry" aria-hidden="true"></span><span>Horses · ${horseLimit} max</span></button>
        </div>
        <p class="inspector-action-panel__hint">Neutral capacity: ${cattleCapacity.toFixed(1)} cattle, ${sheepCapacity.toFixed(1)} sheep, or ${horseCapacity.toFixed(1)} horses.${pasture.averageSlopeDegrees > CATTLE_MAX_SLOPE_DEGREES ? ' It is too steep for cattle.' : ''}${pasture.averageSlopeDegrees > HORSE_MAX_SLOPE_DEGREES ? ' It is too steep for horses.' : ''}</p>
      </div>`
    : '';

  const tradeControls = herd
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Stock this pasture">
        <p class="resource-inspector-note">Animals bought here belong to this pasture. ${herd.species === 'horses' ? 'A mounted company reserves its exact horses while away; they return here on disband.' : 'Its own land sets the purchase and spring-breeding ceiling.'}</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button" data-livestock-trade="1" ${openSlots < 1 || treasuryGold + 1e-6 < purchasePrice ? 'disabled' : ''}>Buy 1 · ${renderResourceAmount('gold', purchasePrice, { compact: true })}</button>
          ${starterOrder > 1 ? `<button type="button" class="resource-action-button" data-livestock-trade="${starterOrder}" ${treasuryGold + 1e-6 < livestockPurchaseCost(herd.species, starterOrder) ? 'disabled' : ''}>Buy starter ${starterOrder} · ${renderResourceAmount('gold', livestockPurchaseCost(herd.species, starterOrder), { compact: true })}</button>` : ''}
          ${sellableHeads > 0 ? `<button type="button" class="resource-action-button" data-livestock-trade="-1">Sell 1 · ${renderResourceAmount('gold', salePrice, { compact: true })}</button>` : ''}
          ${sellableHeads > 1 ? `<button type="button" class="resource-action-button" data-livestock-trade="-${sellableHeads}">Sell available ${sellableHeads} · ${renderResourceAmount('gold', livestockSaleProceeds(herd.species, sellableHeads), { compact: true })}</button>` : ''}
        </div>
        <p class="inspector-action-panel__hint">${herd.headCount} / ${headLimit} owned · ${presentHeads} present · ${openSlots} open.${herd.species === 'horses' && sellableHeads < presentHeads ? ` ${presentHeads - sellableHeads} present horses are already reserved for muster.` : ''} Regional stock sells for less than it costs.</p>
      </div>`
    : farmstead?.kind === 'swineherd'
      ? '<div class="inspector-action-panel" data-inspector-panel-title="Stock this pannage"><p class="resource-inspector-note">The linked swineherd is preparing this parcel for pigs.</p></div>'
      : '';

  const reserveControls = herd && herd.species !== 'horses'
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Breeding reserve">
        <p class="resource-inspector-note">${herd.species === 'cattle' ? 'Cattle mate in summer' : herd.species === 'sheep' ? 'Sheep mate in autumn' : 'Woodland swine mate in autumn'} when healthy and supplied; confirmed offspring arrive in spring. Lowering the reserve marks surplus animals here for autumn culling.</p>
        <div class="resource-action-row">${livestockReservePresets(herd.species)
          .map((preset) => `<button type="button" class="resource-action-button" data-livestock-breeding-reserve="${preset.reserve}" ${breedingReserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
          .join('')}</div>
      </div>`
    : '';

  const hayControls = herd && herd.species !== 'swine' && farmstead?.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Hay meadow">
        <p class="resource-inspector-note">Reserve part of this pasture for June–August haymaking. Its hay is stored for this herd and consumed before prepared Animal Feed in winter.</p>
        <div class="resource-action-row">${livestockHaymakingPresets()
          .map((preset) => `<button type="button" class="resource-action-button" data-livestock-haymaking-percent="${preset.percent}" ${herd.haymakingPercent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
          .join('')}</div>
        <p class="inspector-action-panel__hint">${Math.round(herd.hayStock)} / ${Math.round(LIVESTOCK_HAY_STORAGE_CAPACITY)} hay stored for this pasture · last cut ${Math.round(herd.lastHayOutput)}</p>
      </div>`
    : '';

  const parcelCapacity = !herd
    ? `${cattleCapacity.toFixed(1)} cattle / ${sheepCapacity.toFixed(1)} sheep / ${horseCapacity.toFixed(1)} horses neutral`
    : herd.species === 'swine'
      ? `${neutralCapacity.toFixed(1)} pigs neutral · ${pastureAreaHeadCapacity(pasture, 'swine').toFixed(1)} by area / ${pannage.mastHeadCapacity.toFixed(1)} by mast (${matureTrees} mature trees)`
      : `${herd.pastureCapacity.toFixed(1)} now · ${neutralCapacity.toFixed(1)} in neutral conditions`;
  const recentOutput = herd
    ? `${Math.round(herd.lastFoodOutput)} fresh food · ${Math.round(herd.lastPreservedOutput)} preserved${herd.lastWoolOutput ? ` · ${Math.round(herd.lastWoolOutput)} wool` : ''}${herd.lastCulled ? ` · ${herd.lastCulled} culled` : ''}`
    : 'None';

  return {
    eyebrow: 'Independent livestock parcel',
    title: herd ? SPECIES_LABEL[herd.species] : farmstead?.kind === 'swineherd' ? 'Unstocked pannage' : 'Unstocked pasture',
    statusText: !farmstead
      ? 'Orphaned — livestock building missing'
      : !herd
        ? farmstead.kind === 'swineherd' ? 'Awaiting pig herd setup' : 'Choose cattle, sheep, or horses'
        : herd.headCount <= 0
          ? `${herd.species} selected · buy breeding stock`
          : farmstead.assignedLabor <= 0
            ? 'Stocked · assign herders at the linked farmstead'
            : herd.suppliedCapacity + 1e-6 < presentHeads
              ? `${(presentHeads - herd.suppliedCapacity).toFixed(1)} present head unsupported`
              : herd.species === 'horses' && awayHorseCount > 0
                ? `${availableHorseCount} available · ${awayHorseCount} away`
              : 'Herd tended',
    statusState: herd && herd.headCount > 0 && farmstead?.assignedLabor && herd.suppliedCapacity + 1e-6 >= presentHeads
      ? 'active'
      : herd && presentHeads > herd.suppliedCapacity
        ? 'warning'
        : 'idle',
    detailsHtml: `
      <li><span>Linked holding</span><span>${farmstead ? farmstead.kind.replaceAll('_', ' ') : 'Missing'} · ${siblingPastures.length} pasture${siblingPastures.length === 1 ? '' : 's'} / ${siblingHerds.reduce((sum, candidate) => sum + candidate.headCount, 0)} total head</span></li>
      <li><span>Area</span><span>${Math.round(pasture.area)} m²</span></li>
      <li><span>Average slope</span><span>${pasture.averageSlopeDegrees.toFixed(1)}°</span></li>
      <li><span>Moisture</span><span>${Math.round(pasture.moisture * 100)}%</span></li>
      <li><span>This pasture's herd</span><span>${herd ? `${herd.headCount} ${herd.species} owned · ${presentHeads} present${awayHorseCount ? ` · ${awayHorseCount} away` : ''} · ${headLimit} maximum` : 'None'}</span></li>
      <li><span>This pasture supports</span><span>${parcelCapacity}</span></li>
      <li><span>Current full supply</span><span>${herd ? `${herd.suppliedCapacity.toFixed(1)} / ${presentHeads} present head` : 'Not stocked'}</span></li>
      <li><span>Health</span><span>${herd && herd.headCount > 0 ? `${Math.round(herd.health * 100)}%` : 'Not stocked'}</span></li>
      <li><span>Herd movement</span><span>${herd?.species === 'horses' ? 'Exact horses graze here, ride to the Cavalry Yard when mustered, and return here after disbanding' : 'Confined within this fence · staffed shearing, milking, and culling rounds use the pasture entrance'}</span></li>
      <li><span>${herd?.species === 'horses' ? 'Military availability' : 'Seasonal breeding'}</span><span>${breedingStatus}</span></li>
      <li><span>Last husbandry cycle</span><span>${recentOutput}</span></li>
    `,
    demolish: {
      visible: true,
      label: herd?.species === 'swine' || farmstead?.kind === 'swineherd'
        ? 'Remove pannage fence'
        : 'Remove pasture',
      hint: herd && herd.headCount > 0
        ? `Sell this pasture's ${herd.headCount} animals before removing its fence.`
        : 'Removes only this empty livestock parcel; sibling pastures remain linked.',
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: `${speciesControls}${tradeControls}${reserveControls}${hayControls}`,
  };
}
