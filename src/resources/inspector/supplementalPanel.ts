import type { BackyardGardenKind } from '../../residences/backyardGarden.ts';
import {
  parseAnimalPenSpecializationKind,
  parseGardenPickerKind,
  parseOrchardSpecializationKind,
  parseVegetableGardenSpecializationKind,
} from './backyardRenderer.ts';
import type { InspectableTarget } from '../types.ts';

export type SupplementalPanelHandlers = {
  onPlaceBackyardGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onSpecializeOrchard?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onSpecializeAnimalPen?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onSpecializeVegetableGarden?: (residenceId: string, kind: BackyardGardenKind) => void | Promise<void>;
  onUpgradeFlowerGardenLuxury?: (residenceId: string) => void | Promise<void>;
  onUpgradeChapel?: (buildingId: string) => void | Promise<void>;
  onUpgradeResidence?: (residenceId: string) => void | Promise<void>;
  onRetrofitResidenceTileRoof?: (residenceId: string) => void | Promise<void>;
  onSetResidenceUpgradePriority?: (
    residenceId: string,
    priority: number,
  ) => void | Promise<void>;
};

export function handleSupplementalPanelClick(
  target: InspectableTarget | null,
  eventTarget: HTMLElement,
  handlers: SupplementalPanelHandlers,
): boolean {
  const chapelUpgrade = eventTarget.closest<HTMLElement>('[data-action="upgrade-chapel"]');
  if (
    chapelUpgrade
    && target?.kind === 'building'
    && target.building.kind === 'chapel'
  ) {
    void handlers.onUpgradeChapel?.(target.building.id);
    return true;
  }
  const upgradeButton = eventTarget.closest<HTMLElement>('[data-action="upgrade-residence"]');
  if (upgradeButton && target?.kind === 'residence') {
    if (upgradeButton.getAttribute('aria-disabled') === 'true') return true;
    void handlers.onUpgradeResidence?.(target.residence.id);
    return true;
  }
  const roofRetrofitButton = eventTarget.closest<HTMLElement>(
    '[data-action="retrofit-residence-tile-roof"]',
  );
  if (roofRetrofitButton && target?.kind === 'residence') {
    void handlers.onRetrofitResidenceTileRoof?.(target.residence.id);
    return true;
  }
  const upgradePriority = eventTarget
    .closest<HTMLElement>('[data-residence-upgrade-priority]')
    ?.dataset.residenceUpgradePriority;
  const projectResidence = target?.kind === 'residence' || target?.kind === 'backyard'
    ? target.residence
    : null;
  if (upgradePriority != null && projectResidence) {
    void handlers.onSetResidenceUpgradePriority?.(
      projectResidence.id,
      Number(upgradePriority),
    );
    return true;
  }
  const gardenKind = parseGardenPickerKind(eventTarget);
  if (gardenKind && target?.kind === 'backyard' && !target.garden) {
    void handlers.onPlaceBackyardGarden?.(target.residence.id, gardenKind);
    return true;
  }

  const orchardKind = parseOrchardSpecializationKind(eventTarget);
  if (orchardKind && target?.kind === 'backyard' && target.garden?.kind === 'orchard') {
    void handlers.onSpecializeOrchard?.(target.residence.id, orchardKind);
    return true;
  }

  const animalKind = parseAnimalPenSpecializationKind(eventTarget);
  if (animalKind && target?.kind === 'backyard' && target.garden?.kind === 'animal_pen') {
    void handlers.onSpecializeAnimalPen?.(target.residence.id, animalKind);
    return true;
  }

  const vegetableKind = parseVegetableGardenSpecializationKind(eventTarget);
  if (vegetableKind && target?.kind === 'backyard' && target.garden?.kind === 'vegetable_garden') {
    void handlers.onSpecializeVegetableGarden?.(target.residence.id, vegetableKind);
    return true;
  }

  const flowerUpgrade = eventTarget.closest<HTMLElement>(
    '[data-action="upgrade-flower-luxury"]',
  );
  if (
    flowerUpgrade
    && target?.kind === 'backyard'
    && target.garden?.kind === 'flower_garden'
  ) {
    void handlers.onUpgradeFlowerGardenLuxury?.(target.residence.id);
    return true;
  }

  return false;
}
