import type { InspectableTarget } from '../types.ts';
import {
  currentPastureHeadCapacity,
  neutralPastureHeadCapacity,
  pannageHoldingHeadCapacity,
  pastureAreaHeadCapacity,
} from '../../farming/pastureCapacity.ts';
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
  const parcelCapacity = !herd
    ? 'Choose a herd to calculate carrying capacity'
    : herd.species === 'swine'
      ? `${parcelPannageCapacity?.headCapacity.toFixed(1) ?? '0.0'} pigs neutral · ${pastureAreaHeadCapacity(pasture, herd.species).toFixed(1)} by area / ${parcelPannageCapacity?.mastHeadCapacity.toFixed(1) ?? '0.0'} by woodland browse/mast (${parcelPannageCapacity?.matureTrees ?? 0} mature trees)`
      : `${currentCapacity?.toFixed(1) ?? '0.0'} ${herd.species} now · ${neutralCapacity?.toFixed(1) ?? '0.0'} in neutral conditions`;
  const productionRhythm = !herd
    ? 'No herd linked'
    : herd.species === 'swine'
      ? 'Mature woodland trees are an abstract browse/mast proxy · pork comes from surplus culls in October–November, not a parcel harvest'
      : 'Grazing supports continuous dairy and breeding · hay is cut June–August at the linked holding';
  const recentOutput = herd
    ? `${Math.round(herd.lastFoodOutput)} fresh food · ${Math.round(herd.lastPreservedOutput)} preserved${herd.lastHayOutput > 0 ? ` · ${Math.round(herd.lastHayOutput)} hay` : ''}${herd.lastCulled > 0 ? ` · ${herd.lastCulled} culled` : ''}`
    : 'None';
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
      <li><span>Holding capacity</span><span>${herd ? `${herd.pastureCapacity.toFixed(1)} pasture · ${herd.suppliedCapacity.toFixed(1)} supplied` : 'Not calculated'}</span></li>
      <li><span>Production rhythm</span><span>${productionRhythm}</span></li>
      <li><span>Linked holding's last cycle</span><span>${recentOutput}</span></li>
    `,
    demolish: {
      visible: true,
      label: herd?.species === 'swine' ? 'Remove pannage fence' : 'Remove pasture',
      hint: 'Clears this functional parcel and lowers the linked herd’s carrying capacity.',
    },
    labor: hiddenLabor(),
  };
}
