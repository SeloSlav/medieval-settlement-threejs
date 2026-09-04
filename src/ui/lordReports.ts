import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { computePopulationStats } from '../resources/resourceTotals.ts';
import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import {
  formatSettlementClock,
  gameClock,
} from '../world/gameCalendar.ts';
import { holidayObservanceForClock } from '../world/holidayCalendar.ts';
import {
  SUNDAY_MASS_END_HOUR,
  SUNDAY_MASS_START_HOUR,
} from '../settlement/chapelMass.ts';

export type LordReportKind =
  | 'sabbath'
  | 'labor'
  | 'fire'
  | 'bandit'
  | 'wildlife'
  | 'military';
export type LordReportTone = 'settled' | 'notice' | 'warning' | 'danger';

export type LordReportContext = {
  sabbathObservanceEnabled: boolean;
};

export type LordReportTarget = {
  kind: 'building' | 'residence' | 'world' | 'combat-group';
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

function buildingLabel(building: BuildingState): string {
  return getBuildingDefinition(building.kind).label;
}

function residenceLabel(residence: ResidenceState): string {
  return `Burgage household ${residence.parcelIndex + 1}`;
}

function reportTime(state: GameState): string {
  return formatSettlementClock(state.tick);
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
      detail: '',
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

function formatScheduleHour(hour: number): string {
  const wholeHour = Math.floor(hour);
  const minutes = Math.round((hour - wholeHour) * 60);
  return `${String(wholeHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function deriveSabbathReports(
  current: GameState,
  previous: GameState | null,
  context: LordReportContext | undefined,
): LordReport[] {
  if (!context) return [];
  const clock = gameClock(current.tick);
  if (!clock.isSunday) return [];

  const previousClock = previous ? gameClock(previous.tick) : null;
  if (previousClock?.totalDays === clock.totalDays) return [];

  const fireDisabled = fireDisabledBuildingIds(current.fireIncidents.values());
  const completedChurches = [...current.buildings.values()].filter((building) => (
    building.kind === 'chapel'
    && building.constructionComplete !== false
  ));
  const staffedChurches = completedChurches.filter((building) => (
    building.assignedLabor > 0
    && !fireDisabled.has(building.id)
  ));
  const sabbathObserved = context.sabbathObservanceEnabled
    && staffedChurches.length > 0;
  const holiday = holidayObservanceForClock(clock);
  const reportChurch = staffedChurches[0] ?? completedChurches[0];
  const population = computePopulationStats(current);
  const peopleLabel = `${population.total} ${population.total === 1 ? 'person' : 'people'}`;
  const churchLabel = `${staffedChurches.length} staffed ${staffedChurches.length === 1 ? 'church' : 'churches'}`;
  const committedCarts = current.deliveryTrips.size;
  const committedCartLabel = committedCarts === 0
    ? 'no carts are currently committed'
    : `${committedCarts} committed ${committedCarts === 1 ? 'cart continues' : 'carts continue'}`;
  const massWindow = `${formatScheduleHour(SUNDAY_MASS_START_HOUR)}–${formatScheduleHour(SUNDAY_MASS_END_HOUR)}`;
  const sickPeople = population.sick ?? 0;
  const sickPeopleLabel = sickPeople > 0
    ? ` · ${sickPeople} sick ${sickPeople === 1 ? 'resident remains' : 'residents remain'} home`
    : '';
  const massStatus = staffedChurches.length > 0
    ? `Mass ${massWindow} for road-linked homes${sickPeopleLabel}`
    : 'no staffed church for parish Mass';

  let tone: LordReportTone = 'settled';
  let detail: string;
  if (holiday) {
    detail = `${holiday.label} is a protected holy day · labor and new cart departures pause regardless of parish policy · household consumption is frozen · ${massStatus} · ${committedCartLabel}.`;
  } else if (sabbathObserved) {
    detail = `${peopleLabel} · ${churchLabel} · labor and new cart departures pause · households keep eating and service shortage clocks continue · ${massStatus} · ${committedCartLabel}.`;
  } else if (context.sabbathObservanceEnabled) {
    tone = 'warning';
    detail = `Observance is ordered, but no staffed, serviceable church can lead it · normal labor and deliveries continue for ${peopleLabel} · no parish Mass.`;
  } else {
    tone = 'notice';
    detail = `Parish policy does not order Sabbath rest · normal labor and deliveries continue for ${peopleLabel} · ${massStatus}.`;
  }

  return [{
    id: `sabbath:${current.seed}:${clock.totalDays}`,
    kind: 'sabbath',
    tone,
    title: holiday
      ? `It is Sunday — the Sabbath and ${holiday.label} are observed`
      : `It is Sunday — the Sabbath is ${sabbathObserved ? '' : 'not '}observed`,
    detail,
    timeLabel: reportTime(current),
    ...(reportChurch
      ? {
          target: {
            kind: 'building' as const,
            id: reportChurch.id,
            x: reportChurch.x,
            z: reportChurch.z,
          },
          targetLabel: buildingLabel(reportChurch),
        }
      : {}),
  }];
}

/** Rising-edge reports; entity events baseline on hydration, while Sunday may be announced. */
export function deriveLordReportTransitions(
  current: GameState,
  previous: GameState | null,
  context?: LordReportContext,
): LordReport[] {
  const establishesBaseline = previous === null
    || current.seed !== previous.seed
    || current.tick < previous.tick;
  const sabbathReports = deriveSabbathReports(
    current,
    establishesBaseline ? null : previous,
    context,
  );
  if (establishesBaseline) return sabbathReports;
  return [
    ...deriveFireReports(current, previous),
    ...deriveLaborReports(current, previous),
    ...sabbathReports,
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
  sabbath: '✝',
  labor: '✦',
  fire: '♦',
  bandit: '⚑',
  wildlife: '◆',
  military: '⚔',
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
    const time = document.createElement('time');
    time.className = 'noble-hud__report-time';
    time.textContent = report.timeLabel;
    copy.append(title);
    if (report.detail.trim()) {
      const detail = document.createElement('span');
      detail.className = 'noble-hud__report-detail';
      detail.textContent = report.detail;
      copy.append(detail);
    }
    copy.append(time);
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
