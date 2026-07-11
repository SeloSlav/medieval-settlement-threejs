import type { SettlementSchedule } from '../world/settlementSchedule.ts';
import {
  formatCalendarDate,
  formatClockTime,
  formatWeekday,
} from '../world/gameCalendar.ts';

const SETTLEMENT_HUD_HTML = `
  <div class="settlement-hud" data-settlement-hud data-fps-panel aria-label="Settlement overview" aria-live="polite">
    <div class="settlement-hud__clock" data-settlement-clock>
      <span class="settlement-hud__clock-date" data-clock-date>Year 1</span>
      <span class="settlement-hud__clock-time" data-clock-time>06:00</span>
      <span class="settlement-hud__clock-detail" data-clock-detail></span>
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
      <div class="settlement-hud__stat settlement-hud__stat--gold" tabindex="0" data-resource="gold" data-tooltip="Treasury gold from taxed village economic activity. Adjust the mayor tax in City administration (main menu).">
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
  </div>
`;

export class SettlementHud {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly clockDate: HTMLElement;
  private readonly clockTime: HTMLElement;
  private readonly clockDetail: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly zoomValue: HTMLElement;
  readonly zoomStat: HTMLElement;

  constructor(parent: HTMLElement) {
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
    this.fpsValue = this.mustElement('[data-stat="fps"]');
    this.zoomValue = this.mustElement('[data-stat="zoom"]');
    this.zoomStat = this.mustElement('[data-stat-row="zoom"]');
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
    const displayZoom = Math.max(1, Math.round(zoomPercent));
    this.zoomValue.textContent = `${displayZoom}%`;
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.panel.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing settlement HUD element ${selector}`);
    return element;
  }
}
