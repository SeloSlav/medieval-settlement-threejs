import type { InspectableTarget } from '../types.ts';
import {
  livestockPurchaseCost,
  livestockPurchaseGoldPerHead,
} from '../../economy/livestockPolicy.ts';
import {
  currentPastureHeadCapacity,
  livestockHoldingWholeHeadLimit,
  neutralPastureHeadCapacity,
  neutralPastureHoldingHeadCapacity,
  pannageHoldingHeadCapacity,
  pastureAreaHeadCapacity,
} from '../../farming/pastureCapacity.ts';
import {
  CATTLE_STARTER_HERD,
  LIVESTOCK_MINIMUM_BREEDING_HEADS,
  SHEEP_STARTER_HERD,
  SWINE_STARTER_HERD,
} from '../../generated/gameBalance.ts';
import { renderResourceAmount } from '../../ui/resourceCost.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

const SPECIES_LABEL = {
  cattle: 'Cattle pasture',
  sheep: 'Sheep pasture',
  swine: 'Woodland pannage',
} as const;

export function renderPastureInspector(
  target: Extract<InspectableTarget, { kind: 'pasture' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { pasture, farmstead, herd } = target;
  const title = herd ? SPECIES_LABEL[herd.species] : 'Fenced pasture';
  const holdingPastures = farmstead
    ? context.worldQueries.getPasturesForBuilding(farmstead.id)
    : [];
  const neutralCapacity = herd
    ? neutralPastureHeadCapacity(pasture, herd.species)
    : null;
  const currentCapacity = herd
    ? currentPastureHeadCapacity(pasture, holdingPastures, herd)
    : null;
  const parcelPannageCapacity = herd?.species === 'swine'
    ? pannageHoldingHeadCapacity(
      [pasture],
      context.worldQueries.getMaturePannageTreeCountForPasture(pasture.id),
    )
    : null;
  const holdingPannageCapacity = herd?.species === 'swine' && farmstead
    ? pannageHoldingHeadCapacity(
      holdingPastures,
      context.worldQueries.getMaturePannageTreeCount(farmstead.id),
    )
    : null;
  const neutralHoldingCapacity = !herd
    ? 0
    : herd.species === 'swine'
      ? holdingPannageCapacity?.headCapacity ?? 0
      : neutralPastureHoldingHeadCapacity(holdingPastures, herd.species);
  const holdingHeadLimit = herd
    ? livestockHoldingWholeHeadLimit(neutralHoldingCapacity, herd.species)
    : 0;
  const availableStockingSlots = herd
    ? Math.max(0, holdingHeadLimit - herd.headCount)
    : 0;
  const parcelCapacity = !herd
    ? 'Choose a herd to calculate carrying capacity'
    : herd.species === 'swine'
      ? `${parcelPannageCapacity?.headCapacity.toFixed(1) ?? '0.0'} pigs neutral · ${pastureAreaHeadCapacity(pasture, herd.species).toFixed(1)} by area / ${parcelPannageCapacity?.mastHeadCapacity.toFixed(1) ?? '0.0'} by woodland mast (${parcelPannageCapacity?.matureTrees ?? 0} mature trees)`
      : `${currentCapacity?.toFixed(1) ?? '0.0'} ${herd.species} now · ${neutralCapacity?.toFixed(1) ?? '0.0'} in neutral conditions`;
  const productionRhythm = !herd
    ? 'No herd linked'
    : herd.species === 'swine'
      ? 'Mature woodland trees provide seasonal mast capacity · pigs forage in warm seasons and use remaining winter mast before prepared Animal Feed · pork comes from surplus culls in October–November, not a parcel harvest'
      : 'Warm-season grazing supports dairy and breeding · the linked holding cuts local hay June–August and uses it before Animal Feed in winter';
  const feedingOrder = !herd
    ? 'Choose a herd first'
    : herd.species === 'swine'
      ? 'Warm-season woodland forage; in winter, reduced mast → prepared Animal Feed · trough water is supplied separately at the sty'
      : 'Warm-season grazing; in winter, reduced pasture → local hay → prepared Animal Feed · trough water is supplied separately at the holding';
  const recentOutput = herd
    ? `${Math.round(herd.lastFoodOutput)} fresh food · ${Math.round(herd.lastPreservedOutput)} preserved${herd.lastHayOutput > 0 ? ` · ${Math.round(herd.lastHayOutput)} hay` : ''}${herd.lastCulled > 0 ? ` · ${herd.lastCulled} culled` : ''}`
    : 'None';
  const starterTarget = herd?.species === 'cattle'
    ? CATTLE_STARTER_HERD
    : herd?.species === 'sheep'
      ? SHEEP_STARTER_HERD
      : SWINE_STARTER_HERD;
  const starterOrder = Math.min(
    Math.max(0, starterTarget - (herd?.headCount ?? 0)),
    availableStockingSlots,
  );
  const treasuryGold = Math.max(0, context.resourceTotals.gold);
  const purchasePrice = herd ? livestockPurchaseGoldPerHead(herd.species) : 0;
  const springGrowth = !herd
    ? 'Choose a herd first'
    : herd.headCount < LIVESTOCK_MINIMUM_BREEDING_HEADS
      ? `Needs at least ${LIVESTOCK_MINIMUM_BREEDING_HEADS} head`
      : herd.headCount >= holdingHeadLimit
        ? `At the linked land ceiling of ${holdingHeadLimit} head`
        : `${Math.round(herd.breedingProgress * 100)}% toward the next birth · spring only · stops at ${holdingHeadLimit} head`;
  const switchingHint = !herd || herd.species === 'swine'
    ? ''
    : ' Changing cattle ↔ sheep is a holding conversion, not a free parcel toggle: sell the whole herd from the farmstead and remove every linked pasture before respecializing.';
  const stockingControls = herd && farmstead
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Stock shared herd">
        <p class="resource-inspector-note">This is the purchase point for new animals. Stock bought from this pasture joins the one shared herd at the linked holding; all ${holdingPastures.length} linked pasture${holdingPastures.length === 1 ? '' : 's'} combine into the purchase and breeding ceiling.${switchingHint}</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button" data-livestock-trade="1" ${availableStockingSlots < 1 || treasuryGold + 1e-6 < purchasePrice ? 'disabled' : ''}>Buy 1 · ${renderResourceAmount('gold', purchasePrice, { compact: true })}</button>
          ${starterOrder > 1 ? `<button type="button" class="resource-action-button" data-livestock-trade="${starterOrder}" ${treasuryGold + 1e-6 < livestockPurchaseCost(herd.species, starterOrder) ? 'disabled' : ''}>Buy starter ${starterOrder} · ${renderResourceAmount('gold', livestockPurchaseCost(herd.species, starterOrder), { compact: true })}</button>` : ''}
        </div>
        <p class="inspector-action-panel__hint">${holdingHeadLimit} whole-head slots from ${neutralHoldingCapacity.toFixed(1)} neutral combined capacity; ${availableStockingSlots} open. Healthy, 90%-supplied breeding stock grows only in spring. The default reserve keeps growth up to this ceiling; lower the holding’s autumn reserve when you want planned meat culls.</p>
      </div>`
    : '';
  return {
    eyebrow: 'Functional work parcel',
    title,
    statusText: !farmstead
      ? 'Orphaned — livestock building missing'
      : farmstead.assignedLabor > 0
        ? 'Herders are using this parcel'
        : 'Awaiting herders',
    statusState: farmstead?.assignedLabor ? 'active' : 'idle',
    detailsHtml: `
      <li><span>Linked holding</span><span>${farmstead ? farmstead.kind.replaceAll('_', ' ') : 'Missing'}</span></li>
      <li><span>Area</span><span>${Math.round(pasture.area)} m²</span></li>
      <li><span>Average slope</span><span>${pasture.averageSlopeDegrees.toFixed(1)}°</span></li>
      <li><span>Moisture</span><span>${Math.round(pasture.moisture * 100)}%</span></li>
      <li><span>Herd</span><span>${herd ? `${herd.headCount} ${herd.species}` : 'None'}</span></li>
      <li><span>This parcel supports</span><span>${parcelCapacity}</span></li>
      <li><span>Shared holding ceiling</span><span>${herd ? `${herd.headCount} / ${holdingHeadLimit} head · ${neutralHoldingCapacity.toFixed(1)} neutral capacity across ${holdingPastures.length} parcel${holdingPastures.length === 1 ? '' : 's'}` : 'Not calculated'}</span></li>
      <li><span>Current support</span><span>${herd ? `${herd.pastureCapacity.toFixed(1)} seasonal pasture · ${herd.suppliedCapacity.toFixed(1)} fully supplied` : 'Not calculated'}</span></li>
      <li><span>Spring reproduction</span><span>${springGrowth}</span></li>
      <li><span>Feeding order</span><span>${feedingOrder}</span></li>
      <li><span>Production rhythm</span><span>${productionRhythm}</span></li>
      <li><span>Linked holding's last cycle</span><span>${recentOutput}</span></li>
    `,
    demolish: {
      visible: true,
      label: herd?.species === 'swine' ? 'Remove pannage fence' : 'Remove pasture',
      hint: 'Clears this functional parcel and lowers the linked herd’s carrying capacity.',
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: stockingControls,
  };
}
