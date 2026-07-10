import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import { formatResourceAmount } from './yields.ts';
import { getBuildingDefinition } from './buildings.ts';
import type { InspectableTarget, ResourceStockpile } from './types.ts';
import type { WorldQueries } from './WorldQueries.ts';

type ResourceInspectorOptions = {
  domElement: HTMLElement;
  uiRoot: HTMLElement;
  sceneManager: SceneManager;
  terrainProjector: TerrainProjector;
  worldQueries: WorldQueries;
  isBlocked: () => boolean;
};

export class ResourceInspector {
  private readonly options: ResourceInspectorOptions;
  private readonly panel: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly detailList: HTMLElement;
  private readonly stockpileRoot: HTMLElement;
  private readonly stockpileValues: Record<keyof ResourceStockpile, HTMLElement>;
  private readonly marker: THREE.Mesh;
  private selectedTarget: InspectableTarget | null = null;
  private selectedX = 0;
  private selectedZ = 0;
  private selectedRadius = 6;

  constructor(options: ResourceInspectorOptions) {
    this.options = options;

    options.uiRoot.insertAdjacentHTML(
      'beforeend',
      `
      <div class="resource-stockpile-hud" data-resource-stockpile aria-label="Stockpile">
        <div class="resource-stockpile-item" data-resource="stone">
          <span class="resource-stockpile-label">Stone</span>
          <strong data-stockpile="stone">0</strong>
        </div>
        <div class="resource-stockpile-item" data-resource="wood">
          <span class="resource-stockpile-label">Wood</span>
          <strong data-stockpile="wood">0</strong>
        </div>
        <div class="resource-stockpile-item" data-resource="water">
          <span class="resource-stockpile-label">Water</span>
          <strong data-stockpile="water">0</strong>
        </div>
      </div>

      <aside class="resource-inspector-panel" data-resource-inspector hidden aria-label="Resource inspector">
        <header class="road-controls-header">
          <div>
            <p class="road-controls-eyebrow" data-inspector-eyebrow>Resources</p>
            <h2 class="road-controls-title" data-inspector-title>Select a site</h2>
            <p class="road-controls-status" data-inspector-status>Click terrain to inspect quarries, buildings, or river access.</p>
          </div>
        </header>
        <section class="resource-inspector-details" aria-label="Resource details">
          <ul class="road-controls-list" data-inspector-details></ul>
        </section>
      </aside>
    `,
    );

    this.panel = this.mustElement(options.uiRoot, '[data-resource-inspector]');
    this.eyebrow = this.mustElement(options.uiRoot, '[data-inspector-eyebrow]');
    this.title = this.mustElement(options.uiRoot, '[data-inspector-title]');
    this.status = this.mustElement(options.uiRoot, '[data-inspector-status]');
    this.detailList = this.mustElement(options.uiRoot, '[data-inspector-details]');
    this.stockpileRoot = this.mustElement(options.uiRoot, '[data-resource-stockpile]');
    this.stockpileValues = {
      stone: this.mustElement(options.uiRoot, '[data-stockpile="stone"]'),
      wood: this.mustElement(options.uiRoot, '[data-stockpile="wood"]'),
      water: this.mustElement(options.uiRoot, '[data-stockpile="water"]'),
    };

    this.marker = createSelectionMarker();
    options.sceneManager.selectionGroup.add(this.marker);
    this.marker.visible = false;

    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
  }

  setStockpile(stockpile: ResourceStockpile): void {
    this.stockpileValues.stone.textContent = Math.round(stockpile.stone).toString();
    this.stockpileValues.wood.textContent = Math.round(stockpile.wood).toString();
    this.stockpileValues.water.textContent = Math.round(stockpile.water).toString();
  }

  refreshSelection(): void {
    if (!this.selectedTarget) return;
    const latest = this.options.worldQueries.findInspectableTarget(this.selectedX, this.selectedZ);
    if (!latest) {
      this.clearSelection(false);
      return;
    }
    if (this.selectedTarget.kind === 'building' && latest.kind === 'building' && latest.building.id === this.selectedTarget.building.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'quarry' && latest.kind === 'quarry' && latest.definition.id === this.selectedTarget.definition.id) {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    if (this.selectedTarget.kind === 'river' && latest.kind === 'river') {
      this.selectedTarget = latest;
      this.renderTarget(latest);
      return;
    }
    this.clearSelection(false);
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.sceneManager.selectionGroup.remove(this.marker);
    disposeObject3D(this.marker);
    this.panel.remove();
    this.stockpileRoot.remove();
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    if (this.options.isBlocked()) return;
    if (event.altKey) return;

    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;

    const target = this.options.worldQueries.findInspectableTarget(point.x, point.z);
    if (!target) {
      this.clearSelection(true);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.selectTarget(target);
  };

  private selectTarget(target: InspectableTarget): void {
    this.selectedTarget = target;
    if (target.kind === 'quarry') {
      this.selectedX = target.definition.x;
      this.selectedZ = target.definition.z;
      this.selectedRadius = target.definition.pickRadius * 0.42;
    } else if (target.kind === 'building') {
      this.selectedX = target.building.x;
      this.selectedZ = target.building.z;
      this.selectedRadius = target.building.workRadius * 0.42;
    } else {
      this.selectedX = target.x;
      this.selectedZ = target.z;
      this.selectedRadius = 6;
    }
    this.renderTarget(target);
    this.updateMarker();
    this.panel.hidden = false;
  }

  private clearSelection(hidePanel: boolean): void {
    this.selectedTarget = null;
    this.marker.visible = false;
    if (hidePanel) this.panel.hidden = true;
  }

  private renderTarget(target: InspectableTarget): void {
    if (target.kind === 'quarry') {
      const { definition, state } = target;
      this.eyebrow.textContent = 'Quarry';
      this.title.textContent = definition.label;
      this.status.textContent = `${Math.round(state.remaining)} / ${Math.round(state.maxYield)} stone remaining`;
      this.status.dataset.state = state.remaining > 0 ? 'active' : 'idle';

      const nearestRoad = this.options.worldQueries.getNearestRoadNodeDistance(definition.x, definition.z);
      this.detailList.innerHTML = `
        <li><span>Resource</span><span>stone</span></li>
        <li><span>Site ID</span><span>${definition.id}</span></li>
        <li><span>Yield left</span><span>${Math.round(state.remaining)}</span></li>
        <li><span>Nearest road</span><span>${nearestRoad == null ? 'None nearby' : `${nearestRoad.toFixed(1)} m`}</span></li>
      `;
      return;
    }

    if (target.kind === 'building') {
      const { building, matureTrees, stumpTrees, growingTrees } = target;
      const label = this.options.worldQueries.getBuildingLabel(building.kind);
      this.eyebrow.textContent = 'Building';
      this.title.textContent = label;
      const definition = getBuildingDefinition(building.kind);

      if (building.kind === 'lumber_mill') {
        this.status.textContent = matureTrees > 0
          ? `Harvesting — ${matureTrees} mature trees in range`
          : 'Idle — no mature trees in range';
        this.status.dataset.state = matureTrees > 0 ? 'active' : 'idle';
      } else if (building.kind === 'stone_quarry') {
        const nearestQuarry = this.options.worldQueries.findNearestQuarryWithRemaining(building.x, building.z, building.workRadius);
        this.status.textContent = nearestQuarry
          ? `Extracting — ${Math.round(nearestQuarry.remaining)} stone left at site`
          : 'Idle — no quarry stone in range';
        this.status.dataset.state = nearestQuarry ? 'active' : 'idle';
      } else {
        this.status.textContent = stumpTrees + growingTrees > 0
          ? `Reforesting — ${stumpTrees} stumps, ${growingTrees} growing`
          : 'Idle — no stumps in range';
        this.status.dataset.state = stumpTrees + growingTrees > 0 ? 'active' : 'draft';
      }

      this.detailList.innerHTML = building.kind === 'stone_quarry'
        ? `
        <li><span>Kind</span><span>${building.kind}</span></li>
        <li><span>Work radius</span><span>${definition.workRadius} m</span></li>
        <li><span>Harvest interval</span><span>${definition.harvestInterval}s</span></li>
      `
        : `
        <li><span>Kind</span><span>${building.kind}</span></li>
        <li><span>Work radius</span><span>${definition.workRadius} m</span></li>
        <li><span>Mature trees</span><span>${matureTrees}</span></li>
        <li><span>Stumps</span><span>${stumpTrees}</span></li>
        <li><span>Growing saplings</span><span>${growingTrees}</span></li>
      `;
      return;
    }

    this.eyebrow.textContent = 'River';
    this.title.textContent = target.onWater ? 'Open water' : 'River access';
    this.status.textContent = target.onWater
      ? 'Direct water access — useful for mills and wells.'
      : `Shoreline access (${target.shoreDistance.toFixed(1)} m from bank)`;
    this.status.dataset.state = 'active';
    this.detailList.innerHTML = `
      <li><span>Resource</span><span>water</span></li>
      <li><span>On water</span><span>${target.onWater ? 'Yes' : 'No'}</span></li>
      <li><span>Shore distance</span><span>${target.shoreDistance.toFixed(1)} m</span></li>
      <li><span>Stored water</span><span>${formatResourceAmount('water', 0)}</span></li>
    `;
  }

  private updateMarker(): void {
    const y = this.options.sceneManager.terrain.getHeightAt(this.selectedX, this.selectedZ) + 0.35;
    this.marker.scale.set(this.selectedRadius, 1, this.selectedRadius);
    this.marker.position.set(this.selectedX, y, this.selectedZ);
    this.marker.visible = true;
  }

  private mustElement(root: HTMLElement, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing resource inspector element ${selector}`);
    return element;
  }
}

function createSelectionMarker(): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.72, 1, 48);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicMaterial({
    color: 0xd7b463,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Resource selection marker';
  mesh.renderOrder = 12;
  return mesh;
}
