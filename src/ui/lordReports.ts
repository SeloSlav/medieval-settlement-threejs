import { flourStock, breadGrainBulkStock } from '../economy/cropGoods.ts';
import { isCivilianToolSite } from '../economy/civilianToolPolicy.ts';
import { freshFoodStock, preservedFoodStock } from '../economy/foodInventory.ts';
import type { StorageCaps } from '../generated/gameBalance.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  buildingStorageCaps,
  computePopulationStats,
} from '../resources/resourceTotals.ts';
import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import { formatSettlementClock } from '../world/gameCalendar.ts';

export type LordReportKind = 'dawn' | 'labor' | 'storage' | 'fire';
export type LordReportTone = 'settled' | 'notice' | 'warning' | 'danger';

export type LordReportTarget = {
  kind: 'building' | 'residence';
  id: string;
  x: number;
  z: number;
};

export type LordReport = {
  id: string;
  kind: LordReportKind;
  tone: LordReportTone;
  title: string;
  detail: string;
  timeLabel: string;
  target?: LordReportTarget;
  targetLabel?: string;
};

export type StorageOccupancyChannel = {
  key: keyof StorageCaps;
  label: string;
  amount: number;
  capacity: number;
  purpose: 'working-stock' | 'maintenance-reserve';
};

const STORAGE_CHANNEL_LABELS: Record<keyof StorageCaps, string> = {
  timber: 'Timber store',
  firewood: 'Firewood store',
  stone: 'Stone store',
  water: 'Water store',
  food: 'Fresh-food store',
  grain: 'Grain bay',
  barley: 'Barley bay',
  malt: 'Malt store',
  flax: 'Flax store',
  flour: 'Flour room',
  ale: 'Ale store',
  cider: 'Cider cellar',
  pearCider: 'Pear-cider cellar',
  mead: 'Mead store',
  preservedFood: 'Preserved-food store',
  honey: 'Honey store',
  wine: 'Wine cellar',
  wool: 'Wool store',
  cloth: 'Cloth store',
  ironwork: 'Ironwork store',
  polearms: 'Polearm rack',
  iron: 'Iron store',
  clay: 'Clay store',
  salt: 'Salt store',
  charcoal: 'Charcoal store',
  pottery: 'Pottery store',
  hides: 'Hide store',
  leather: 'Leather store',
  shoes: 'Shoe store',
  roofTiles: 'Roof-tile stack',
  manure: 'Manure store',
  remedies: 'Remedy store',
  animalFeed: 'Animal feed store',
};

const STORAGE_CHANNEL_KEYS = Object.keys(STORAGE_CHANNEL_LABELS) as (keyof StorageCaps)[];
const FULL_EPSILON = 1e-6;

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function storageChannelAmount(
  building: BuildingState,
  key: keyof StorageCaps,
): number {
  if (key === 'food') return freshFoodStock(building);
  if (key === 'preservedFood') return preservedFoodStock(building);
  if (key === 'grain') return breadGrainBulkStock(building);
  if (key === 'barley') {
    return finiteStock(building.barleySheaves) + finiteStock(building.barley);
  }
  if (key === 'flour') return flourStock(building);
  return finiteStock(building[key] as number | undefined);
}

/**
 * Returns the physical storage buckets used by the simulation and inspector.
 * Food, grain, barley, and flour each share a capacity across several stock fields.
 */
export function storageOccupancyChannels(
  building: BuildingState,
): StorageOccupancyChannel[] {
  const caps = buildingStorageCaps(building.kind);
  return STORAGE_CHANNEL_KEYS.flatMap((key) => {
    const capacity = key === 'water' && building.kind === 'well'
      ? building.waterCapacity
      : caps[key];
    if (capacity == null || capacity <= 0) return [];
    return [{
      key,
      label: STORAGE_CHANNEL_LABELS[key],
      amount: storageChannelAmount(building, key),
      capacity,
      purpose: key === 'ironwork' && isCivilianToolSite(building.kind)
        ? 'maintenance-reserve'
        : 'working-stock',
    }];
  });
}

/**
 * Report notifications are about working stores that can block production or
 * deliveries. Small ironwork tool racks are maintenance reserves, even though
 * they share the building row's physical `ironwork` stock field.
 */
export function reportableStorageOccupancyChannels(
  building: BuildingState,
): StorageOccupancyChannel[] {
  // Marketplace bays are service inventory: reaching their target capacity
  // means the stall is fully stocked, not that local production is blocked.
  if (building.kind === 'marketplace') return [];
  return storageOccupancyChannels(building).filter(
    (channel) => channel.purpose === 'working-stock',
  );
}

export function fullStorageChannels(
  building: BuildingState,
): StorageOccupancyChannel[] {
  if (building.constructionComplete === false) return [];
  return reportableStorageOccupancyChannels(building).filter(
    (channel) => channel.amount + FULL_EPSILON >= channel.capacity,
  );
}

function buildingLabel(building: BuildingState): string {
  return getBuildingDefinition(building.kind).label;
}

function residenceLabel(residence: ResidenceState): string {
  return `Burgage household ${residence.parcelIndex + 1}`;
}

function reportTime(state: GameState): string {
  return formatSettlementClock(state.tick);
}

function storageReportTitle(building: BuildingState): string {
  if (building.kind === 'granary') return 'Granary storage is full';
  if (building.kind === 'village_storehouse') return 'Storehouse storage is full';
  return `${buildingLabel(building)} local storage is full`;
}

function formatFullChannels(channels: readonly StorageOccupancyChannel[]): string {
  return channels.map((channel) => (
    `${channel.label} ${Math.round(channel.amount)}/${Math.round(channel.capacity)}`
  )).join(' · ');
}

function deriveLaborReports(
  current: GameState,
  previous: GameState,
): LordReport[] {
  let remainingCityGrowth = Math.max(
    0,
    computePopulationStats(current).total - computePopulationStats(previous).total,
  );
  if (remainingCityGrowth <= 0) return [];
  const reports: LordReport[] = [];
  for (const residence of current.residences.values()) {
    if (remainingCityGrowth <= 0) break;
    if (residence.tier <= 0) continue;
    const priorPopulation = previous.residences.get(residence.id)?.population ?? 0;
    const joined = Math.min(
      remainingCityGrowth,
      Math.max(0, residence.population - priorPopulation),
    );
    if (joined <= 0) continue;
    remainingCityGrowth -= joined;
    const label = residenceLabel(residence);
    reports.push({
      id: `labor:${residence.id}:${current.tick}`,
      kind: 'labor',
      tone: 'notice',
      title: joined === 1
        ? 'A new laborer joined the city'
        : `${joined} new laborers joined the city`,
      detail: `${label} now houses ${residence.population}.`,
      timeLabel: reportTime(current),
      target: {
        kind: 'residence',
        id: residence.id,
        x: residence.x,
        z: residence.z,
      },
      targetLabel: label,
    });
  }
  return reports;
}

function deriveStorageReports(
  current: GameState,
  previous: GameState,
): LordReport[] {
  const reports: LordReport[] = [];
  for (const building of current.buildings.values()) {
    // A well's passive recharge repeatedly reaches its desired full state; it
    // is not a blocked local-output store that needs the Lord's attention.
    if (building.kind === 'well') continue;
    const nowFull = fullStorageChannels(building);
    if (nowFull.length === 0) continue;
    const prior = previous.buildings.get(building.id);
    const previouslyFull = new Set(
      prior ? fullStorageChannels(prior).map((channel) => channel.key) : [],
    );
    const newlyFull = nowFull.filter((channel) => !previouslyFull.has(channel.key));
    if (newlyFull.length === 0) continue;
    const label = buildingLabel(building);
    reports.push({
      id: `storage:${building.id}:${newlyFull.map((channel) => channel.key).join(',')}:${current.tick}`,
      kind: 'storage',
      tone: 'warning',
      title: storageReportTitle(building),
      detail: `${formatFullChannels(newlyFull)}.`,
      timeLabel: reportTime(current),
      target: {
        kind: 'building',
        id: building.id,
        x: building.x,
        z: building.z,
      },
      targetLabel: label,
    });
  }
  return reports;
}

function fireTarget(
  state: GameState,
  targetKind: 'building' | 'residence',
  targetId: string,
  fallbackX: number,
  fallbackZ: number,
): { target: LordReportTarget; label: string } {
  if (targetKind === 'building') {
    const building = state.buildings.get(targetId);
    return {
      target: {
        kind: 'building',
        id: targetId,
        x: building?.x ?? fallbackX,
        z: building?.z ?? fallbackZ,
      },
      label: building ? buildingLabel(building) : 'a structure',
    };
  }
  const residence = state.residences.get(targetId);
  return {
    target: {
      kind: 'residence',
      id: targetId,
      x: residence?.x ?? fallbackX,
      z: residence?.z ?? fallbackZ,
    },
    label: residence ? residenceLabel(residence) : 'a residence',
  };
}

function deriveFireReports(
  current: GameState,
  previous: GameState,
): LordReport[] {
  const reports: LordReport[] = [];
  for (const incident of current.fireIncidents.values()) {
    const prior = previous.fireIncidents.get(incident.id);
    if (prior?.status === incident.status) continue;
    const { target, label } = fireTarget(
      current,
      incident.targetKind,
      incident.targetId,
      incident.x,
      incident.z,
    );
    if (incident.status === 'burning') {
      reports.push({
        id: `fire:${incident.id}:burning`,
        kind: 'fire',
        tone: 'danger',
        title: `Fire reported at ${label}`,
        detail: `Bucket response requested · ${Math.round(incident.damage * 100)}% damage reported.`,
        timeLabel: reportTime(current),
        target,
        targetLabel: label,
      });
    } else if (incident.status === 'extinguished') {
      reports.push({
        id: `fire:${incident.id}:extinguished`,
        kind: 'fire',
        tone: 'settled',
        title: `Fire extinguished at ${label}`,
        detail: `${incident.waterDelivered.toFixed(1)} water delivered · ${Math.round(incident.damage * 100)}% damage.`,
        timeLabel: reportTime(current),
        target,
        targetLabel: label,
      });
    } else if (incident.status === 'destroyed') {
      reports.push({
        id: `fire:${incident.id}:destroyed`,
        kind: 'fire',
        tone: 'danger',
        title: `${label} was destroyed by fire`,
        detail: 'Most stores were lost; durable remnants may remain beside the ruin.',
        timeLabel: reportTime(current),
        target,
        targetLabel: label,
      });
    }
  }
  return reports;
}

/** Rising-edge reports only. The first hydrated snapshot establishes a baseline. */
export function deriveLordReportTransitions(
  current: GameState,
  previous: GameState | null,
): LordReport[] {
  if (
    previous === null
    || current.seed !== previous.seed
    || current.tick < previous.tick
  ) return [];
  return [
    ...deriveFireReports(current, previous),
    ...deriveLaborReports(current, previous),
    ...deriveStorageReports(current, previous),
  ];
}

export class LordReportCollection {
  private reports: LordReport[] = [];

  get size(): number {
    return this.reports.length;
  }

  values(): readonly LordReport[] {
    return this.reports;
  }

  add(report: LordReport): boolean {
    const existingIndex = this.reports.findIndex((entry) => entry.id === report.id);
    if (existingIndex === 0 && this.reports[0] === report) return false;
    if (existingIndex >= 0) this.reports.splice(existingIndex, 1);
    this.reports.unshift(report);
    return true;
  }

  dismiss(id: string): boolean {
    const index = this.reports.findIndex((report) => report.id === id);
    if (index < 0) return false;
    this.reports.splice(index, 1);
    return true;
  }

  clear(): boolean {
    if (this.reports.length === 0) return false;
    this.reports = [];
    return true;
  }
}

const REPORT_SYMBOLS: Record<LordReportKind, string> = {
  dawn: '☀',
  labor: '✦',
  storage: '▣',
  fire: '♦',
};

export class LordReportLedger {
  readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly collection = new LordReportCollection();
  private onTarget: ((target: LordReportTarget) => void) | null = null;

  constructor(parent: HTMLElement) {
    const root = document.createElement('section');
    root.className = 'noble-hud__reports';
    root.dataset.lordReports = '';
    root.setAttribute('aria-label', 'Reports to the Lord');
    root.hidden = true;

    const header = document.createElement('header');
    header.className = 'noble-hud__reports-header';

    const heading = document.createElement('strong');
    heading.textContent = 'Reports to the Lord';
    const count = document.createElement('span');
    count.className = 'noble-hud__reports-count';
    count.setAttribute('aria-live', 'polite');

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'noble-hud__reports-clear';
    clearButton.dataset.reportClear = '';
    clearButton.textContent = 'Clear';
    clearButton.setAttribute('aria-label', 'Dismiss all reports');

    const list = document.createElement('ol');
    list.className = 'noble-hud__reports-list';
    list.dataset.reportList = '';
    list.setAttribute('role', 'log');
    list.setAttribute('aria-live', 'polite');
    list.setAttribute('aria-relevant', 'additions');

    header.append(heading, count, clearButton);
    root.append(header, list);
    parent.appendChild(root);

    this.root = root;
    this.count = count;
    this.list = list;
    this.clearButton = clearButton;
    this.root.addEventListener('click', this.onClick);
  }

  setTargetHandler(handler: ((target: LordReportTarget) => void) | null): void {
    this.onTarget = handler;
    this.render();
  }

  add(report: LordReport): void {
    if (!this.collection.add(report)) return;
    this.render();
    this.list.scrollTop = 0;
  }

  addAll(reports: Iterable<LordReport>): void {
    let changed = false;
    for (const report of reports) changed = this.collection.add(report) || changed;
    if (!changed) return;
    this.render();
    this.list.scrollTop = 0;
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.remove();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('button')
      : null;
    if (!button || !this.root.contains(button)) return;
    if ('reportClear' in button.dataset) {
      if (this.collection.clear()) this.render();
      return;
    }
    const dismissId = button.dataset.reportDismiss;
    if (dismissId !== undefined) {
      if (this.collection.dismiss(dismissId)) this.render();
      return;
    }
    const targetId = button.dataset.reportTarget;
    if (targetId === undefined) return;
    const report = this.collection.values().find((entry) => entry.id === targetId);
    if (report?.target) this.onTarget?.(report.target);
  };

  private render(): void {
    const reports = this.collection.values();
    this.root.hidden = reports.length === 0;
    this.count.textContent = String(reports.length);
    this.clearButton.hidden = reports.length === 0;
    this.list.replaceChildren(...reports.map((report) => this.renderReport(report)));
  }

  private renderReport(report: LordReport): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'noble-hud__report';
    item.dataset.tone = report.tone;
    item.dataset.kind = report.kind;

    const body = report.target
      ? document.createElement('button')
      : document.createElement('div');
    body.className = 'noble-hud__report-body';
    if (body instanceof HTMLButtonElement) {
      body.type = 'button';
      body.dataset.reportTarget = report.id;
      body.disabled = this.onTarget === null;
      body.setAttribute(
        'aria-label',
        `View ${report.targetLabel ?? 'reported location'} at about 25 percent zoom: ${report.title}`,
      );
    }

    const symbol = document.createElement('span');
    symbol.className = 'noble-hud__report-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = REPORT_SYMBOLS[report.kind];

    const copy = document.createElement('span');
    copy.className = 'noble-hud__report-copy';
    const title = document.createElement('strong');
    title.textContent = report.title;
    const detail = document.createElement('span');
    detail.className = 'noble-hud__report-detail';
    detail.textContent = report.detail;
    const time = document.createElement('time');
    time.className = 'noble-hud__report-time';
    time.textContent = report.timeLabel;
    copy.append(title, detail, time);
    body.append(symbol, copy);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'noble-hud__report-dismiss';
    dismiss.dataset.reportDismiss = report.id;
    dismiss.setAttribute('aria-label', `Dismiss report: ${report.title}`);
    dismiss.textContent = '×';

    item.append(body, dismiss);
    return item;
  }
}
