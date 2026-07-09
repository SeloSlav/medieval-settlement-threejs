export type ToolbarStats = {
  nodes: number;
  edges: number;
  selected: boolean;
  mode: 'road' | 'idle';
};

export class BuildToolbar {
  private readonly roadButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly nodeCount: HTMLElement;
  private readonly edgeCount: HTMLElement;
  private readonly selectionState: HTMLElement;
  private readonly fpsPanel: HTMLElement;
  private readonly fpsValue: HTMLElement;

  constructor(
    root: HTMLElement,
    handlers: {
      onToggleRoad: () => void;
      onUndo: () => void;
      onDelete: () => void;
    }
  ) {
    root.innerHTML = `
      <div class="toolbar" aria-label="Build tools">
        <button type="button" data-action="road" title="Road tool">Road</button>
        <span class="divider" aria-hidden="true"></span>
        <button type="button" data-action="undo" title="Undo last road">Undo</button>
        <button type="button" data-action="delete" title="Delete selected road">Delete</button>
      </div>
      <div class="stats-panel" aria-live="polite">
        <span class="status-pill is-idle" data-stat="mode">Idle</span>
        <span>Nodes <strong data-stat="nodes">0</strong></span>
        <span>Segments <strong data-stat="edges">0</strong></span>
        <span data-stat="selected">None</span>
      </div>
      <div class="fps-panel" data-fps-panel aria-live="polite">
        <strong data-stat="fps">--</strong>
        <span>FPS</span>
      </div>
    `;

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.undoButton = this.mustButton(root, '[data-action="undo"]');
    this.deleteButton = this.mustButton(root, '[data-action="delete"]');
    this.status = this.mustElement(root, '[data-stat="mode"]');
    this.nodeCount = this.mustElement(root, '[data-stat="nodes"]');
    this.edgeCount = this.mustElement(root, '[data-stat="edges"]');
    this.selectionState = this.mustElement(root, '[data-stat="selected"]');
    this.fpsPanel = this.mustElement(root, '[data-fps-panel]');
    this.fpsValue = this.mustElement(root, '[data-stat="fps"]');

    this.roadButton.addEventListener('click', handlers.onToggleRoad);
    this.undoButton.addEventListener('click', handlers.onUndo);
    this.deleteButton.addEventListener('click', handlers.onDelete);
  }

  setStats(stats: ToolbarStats): void {
    this.roadButton.classList.toggle('is-active', stats.mode === 'road');
    this.status.textContent = stats.mode === 'road' ? 'Road' : 'Idle';
    this.status.classList.toggle('is-idle', stats.mode !== 'road');
    this.nodeCount.textContent = String(stats.nodes);
    this.edgeCount.textContent = String(stats.edges);
    this.selectionState.textContent = stats.selected ? 'Selected' : 'None';
    this.deleteButton.disabled = !stats.selected;
    this.undoButton.disabled = stats.edges === 0;
  }

  setFps(fps: number): void {
    const displayFps = Math.min(90, Math.round(fps));
    this.fpsValue.textContent = displayFps.toString();
    this.fpsPanel.classList.toggle('is-low', displayFps < 60);
    this.fpsPanel.classList.toggle('is-fast', displayFps >= 85);
  }

  private mustButton(root: HTMLElement, selector: string): HTMLButtonElement {
    const element = root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing toolbar button ${selector}`);
    return element;
  }

  private mustElement(root: HTMLElement, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing toolbar element ${selector}`);
    return element;
  }
}
