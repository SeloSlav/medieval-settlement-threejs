import { FARM_CROP_DEFINITIONS } from '../generated/gameBalance.ts';
import { getBuildingDefinition } from './buildings.ts';
import { residenceHasActiveProject, type BuildingState, type ResidenceState, type FarmCrop, type LivestockSpecies } from './types.ts';

export function buildingHoverLabel(building: BuildingState): string {
  const name = getBuildingDefinition(building.kind).label;
  return building.constructionComplete === false ? `${name} (under construction)` : name;
}

export function residenceHoverLabel(residence: ResidenceState): string {
  if (residence.tier === 0) return 'Residence (under construction)';
  const name = `Residence (Tier ${residence.tier})`;
  return residenceHasActiveProject(residence) ? `${name} (under construction)` : name;
}

export function fieldHoverLabel(crop: FarmCrop): string {
  return `Field (${crop === 'fallow' ? 'Fallow' : FARM_CROP_DEFINITIONS[crop].label})`;
}

const ANIMAL_NAMES: Record<LivestockSpecies, string> = {
  cattle: 'Cattle', sheep: 'Sheep', swine: 'Swine', horses: 'Horses',
};

export function pastureHoverLabel(species?: LivestockSpecies): string {
  return species ? `Pasture (${ANIMAL_NAMES[species]})` : 'Pasture';
}

export function constructionProgressFraction(progress: number | undefined): number {
  return typeof progress === 'number' && Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
}
