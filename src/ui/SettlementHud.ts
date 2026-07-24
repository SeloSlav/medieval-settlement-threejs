import type { SettlementSchedule } from '../world/settlementSchedule.ts';
import {
  formatCalendarDate,
  formatClockTime,
  formatWeekday,
} from '../world/gameCalendar.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import { describeEnvironment } from '../world/seasonPolicy.ts';
import {
  GAME_SPEEDS,
  PLAYER_GAME_SPEEDS,
  gameSpeedLabel,
  type GameSpeed,
} from '../world/gameSpeed.ts';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';

const SETTLEMENT_HUD_HTML = `
  <div class="settlement-hud" data-settlement-hud data-fps-panel aria-label="Settlement overview" aria-live="polite">
    <div class="settlement-hud__clock" data-settlement-clock>
      <span class="settlement-hud__clock-date" data-clock-date>Year 1</span>
      <span class="settlement-hud__clock-time" data-clock-time>06:00</span>
      <span class="settlement-hud__clock-detail" data-clock-detail></span>
      <span class="settlement-hud__season" data-season-status></span>
      <div class="settlement-hud__fire-alert" data-fire-alert hidden>
        <strong data-fire-count>Fire</strong>
        <span data-fire-response>Awaiting a staffed well</span>
      </div>
      <div class="settlement-hud__speed" role="group" aria-label="Simulation speed">
        ${PLAYER_GAME_SPEEDS.map((speed) => `
          <button
            type="button"
            class="settlement-hud__speed-button"
            data-game-speed="${speed}"
            data-tooltip="${gameSpeedLabel(speed)} (${speed === 1 ? 1 : speed === 4 ? 2 : 3})"
            aria-label="${gameSpeedLabel(speed)}"
            aria-pressed="${speed === 1}"
          >${speed}×</button>
        `).join('')}
      </div>
    </div>
    <div class="settlement-hud__perf">
      <div
        class="settlement-hud__stat settlement-hud__stat--perf"
        tabindex="0"
        data-tooltip="Frames per second. Turns amber below 60 and gold at 85 or higher."
      >
        <span class="settlement-hud__label">FPS</span>
        <strong class="settlement-hud__value settlement-hud__value--fps" data-stat="fps">--</strong>
      </div>
      <div
        class="settlement-hud__stat settlement-hud__stat--perf"
        tabindex="0"
        data-stat-row="zoom"
        data-tooltip="Camera zoom level. Scroll the mouse wheel to zoom in and out on the map."
      >
        <span class="settlement-hud__label">Zoom</span>
        <strong class="settlement-hud__value settlement-hud__value--zoom" data-stat="zoom">100%</strong>
      </div>
    </div>
    <div class="settlement-hud__body">
      <div class="settlement-hud__stat" tabindex="0" data-resource="timber" data-tooltip="Timber in your treasury plus lumber stored at mills and lodges. Building costs spend treasury first, then pull from building storage.">
        <span class="settlement-hud__label">Timber</span>
        <strong class="settlement-hud__value" data-stockpile="timber">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="stone" data-tooltip="Stone in your treasury plus quarry camp storage. Construction spends treasury first, then quarry storage.">
        <span class="settlement-hud__label">Stone</span>
        <strong class="settlement-hud__value" data-stockpile="stone">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="firewood" data-tooltip="Firewood held in treasury, woodcutter lodges, and residence stocks combined.">
        <span class="settlement-hud__label">Firewood</span>
        <strong class="settlement-hud__value" data-stockpile="firewood">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--water" tabindex="0" data-resource="water" data-tooltip="Water in treasury, wells, and residence stocks combined.">
        <span class="settlement-hud__label">Water</span>
        <strong class="settlement-hud__value" data-stockpile="water">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--food" tabindex="0" data-resource="food" data-tooltip="Food in treasury, supplier buildings, and residence stocks combined.">
        <span class="settlement-hud__label">Food</span>
        <strong class="settlement-hud__value" data-stockpile="food">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--gold" tabindex="0" data-resource="gold" data-tooltip="Treasury gold from taxed village economic activity. Select a staffed Town Hall to adjust tax policy.">
        <span class="settlement-hud__label">Gold</span>
        <strong class="settlement-hud__value" data-stockpile="gold">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="population" data-tooltip="Total population: starting townsfolk plus residents who have moved into homes.">
        <span class="settlement-hud__label">Population</span>
        <strong class="settlement-hud__value" data-stockpile="population">0</strong>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="housing" data-tooltip="Residents housed versus total housing capacity. New homes start empty and attract settlers over time.">
        <span class="settlement-hud__label">Housing</span>
        <strong class="settlement-hud__value" data-stockpile="housing">0/0</strong>
        <span class="settlement-hud__sub" data-stockpile="housing-sub">0 vacant</span>
      </div>
      <div class="settlement-hud__stat" tabindex="0" data-resource="labor" data-tooltip="Workers free to assign. Labor equals population minus workers already assigned to buildings.">
        <span class="settlement-hud__label">Labor</span>
        <strong class="settlement-hud__value" data-stockpile="labor">0</strong>
        <span class="settlement-hud__sub" data-stockpile="labor-sub">available</span>
      </div>
    </div>
    <div class="settlement-hud__stores" aria-label="Specialty stores">
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="grain" data-tooltip="Grain in treasury and farmstead storage.">
        <span class="settlement-hud__label">Grain</span>
        <strong class="settlement-hud__value" data-stockpile="grain">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="flour" data-tooltip="Flour in treasury and mill or granary storage.">
        <span class="settlement-hud__label">Flour</span>
        <strong class="settlement-hud__value" data-stockpile="flour">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="ale" data-tooltip="Ale in treasury, brewhouses, monasteries, and tier-3 homes.">
        <span class="settlement-hud__label">Ale</span>
        <strong class="settlement-hud__value" data-stockpile="ale">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="preservedFood" data-tooltip="Preserved food in treasury, smokehouses, and tier-2 homes.">
        <span class="settlement-hud__label">Preserved</span>
        <strong class="settlement-hud__value" data-stockpile="preservedFood">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="honey" data-tooltip="Honey in treasury and apiary storage.">
        <span class="settlement-hud__label">Honey</span>
        <strong class="settlement-hud__value" data-stockpile="honey">0</strong>
      </div>
      <div class="settlement-hud__stat settlement-hud__stat--store" tabindex="0" data-resource="wine" data-tooltip="Wine in treasury and vineyard storage.">
        <span class="settlement-hud__label">Wine</span>
        <strong class="settlement-hud__value" data-stockpile="wine">0</strong>
      </div>
    </div>
  </div>
`;

export class SettlementHud {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly clockDate: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockDetail: HTMLElement;
  private readonly seasonStatus: HTMLElement;
  private readonly fireAlert: HTMLElement;
  private readonly fireCount: HTMLElement;
  private readonly fireResponse: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[];
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  readonly zoomStat: HTMLElement;

  constructor(parent: HTMLElement, onSetGameSpeed?: (speed: GameSpeed) => void) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = SETTLEMENT_HUD_HTML.trim();
    const panel = wrapper.firstElementChild;
    if (!(panel instanceof HTMLElement)) {
      throw new Error('SettlementHud template failed to parse.');
    }
    parent.appendChild(panel);
    this.root = panel;
    this.panel = panel;
    this.clockDate = this.mustElement('[data-clock-date]');
    this.clockTime = this.mustElement('[data-clock-time]');
    this.clockDetail = this.mustElement('[data-clock-detail]');
    this.seasonStatus = this.mustElement('[data-season-status]');
    this.fireAlert = this.mustElement('[data-fire-alert]');
    this.fireCount = this.mustElement('[data-fire-count]');
    this.fireResponse = this.mustElement('[data-fire-response]');
    this.speedButtons = [...this.panel.querySelectorAll<HTMLButtonElement>('[data-game-speed]')];
    for (const button of this.speedButtons) {
      button.addEventListener('click', () => {
        const speed = Number(button.dataset.gameSpeed) as GameSpeed;
        if (GAME_SPEEDS.includes(speed)) {
          onSetGameSpeed?.(speed);
        }
      });
    }
    this.fpsValue = this.mustElement('[data-stat="fps"]');
    this.zoomValue = this.mustElement('[data-stat="zoom"]');
    this.zoomStat = this.mustElement('[data-stat-row="zoom"]');
  }

  setSimulationState(speed: GameSpeed, environment: EnvironmentState): void {
    const description = describeEnvironment(environment);
    this.seasonStatus.textContent = `${description.symbol} ${description.title}`;
    this.seasonStatus.dataset.tooltip = description.detail;
    this.panel.classList.toggle('is-paused', speed === 0);
    for (const button of this.speedButtons) {
      const buttonSpeed = Number(button.dataset.gameSpeed);
      const active = buttonSpeed === speed;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  setSpeedControlsEnabled(enabled: boolean): void {
    for (const button of this.speedButtons) {
      button.disabled = !enabled;
    }
  }

  setFireState(
    incidents: Iterable<FireIncidentState>,
    trips: Iterable<DeliveryTripState>,
  ): void {
    const burning = [...incidents].filter((incident) => incident.status === 'burning');
    this.fireAlert.hidden = burning.length === 0;
    this.panel.classList.toggle('has-fire', burning.length > 0);
    if (burning.length === 0) return;

    const responders = [...trips].filter((trip) =>
      trip.destinationKind === 'fire' && trip.phase !== 'inbound').length;
    const worst = burning.reduce((current, incident) =>
      incident.damage + incident.intensity > current.damage + current.intensity
        ? incident
        : current);
    this.fireCount.textContent = burning.length === 1
      ? '🔥 Structure fire'
      : `🔥 ${burning.length} structure fires`;
    this.fireResponse.textContent = responders > 0
      ? `${responders} bucket ${responders === 1 ? 'carrier' : 'carriers'} responding`
      : 'No bucket carrier in transit';
    this.fireAlert.dataset.tooltip = [
      `Worst fire: ${Math.round(worst.intensity * 100)}% intensity`,
      `${Math.round(worst.damage * 100)}% damage`,
      `${worst.waterDelivered.toFixed(1)} / ${worst.requiredWater.toFixed(1)} water delivered`,
      worst.extinguishChance > 0
        ? `${Math.round(worst.extinguishChance * 100)}% chance on the last bucket attempt`
        : 'Extinguishing odds improve as buckets cool the fire',
      'Only staffed wells whose work extent reaches the fire can respond.',
    ].join(' · ');
  }

  setSettlementClock(schedule: SettlementSchedule): void {
    this.clockDate.textContent = formatCalendarDate(schedule.clock);
    this.clockTime.textContent = formatClockTime(schedule.clock);
    const pauseLabel = schedule.laborPauseLabel;
    this.clockDetail.textContent = pauseLabel
      ? `${formatWeekday(schedule.clock)} · ${pauseLabel}`
      : formatWeekday(schedule.clock);
    this.panel.classList.toggle('is-sabbath', pauseLabel === 'Sunday sabbath');
    this.panel.classList.toggle('is-night', pauseLabel === 'Night hours');
  }

  setFps(fps: number): void {
    const displayFps = Math.min(90, Math.round(fps));
    this.fpsValue.textContent = displayFps.toString();
    this.panel.classList.toggle('is-low', displayFps < 60);
    this.panel.classList.toggle('is-fast', displayFps >= 85);
  }

  setZoomPercent(zoomPercent: number): void {
    const displayZoom = Math.max(0, Math.round(zoomPercent));
    this.zoomValue.textContent = `${displayZoom}%`;
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.panel.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing settlement HUD element ${selector}`);
    return element;
  }
}
