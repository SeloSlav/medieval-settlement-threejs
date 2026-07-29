const OVERLAY_ROOT_ID = 'session-connection-overlay';

export class SessionConnectionOverlay {
  private readonly root: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private retryHandler: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    const existing = document.getElementById(OVERLAY_ROOT_ID);
    if (existing) {
      existing.remove();
    }

    this.root = document.createElement('div');
    this.root.id = OVERLAY_ROOT_ID;
    this.root.className = 'session-connection-overlay';
    this.root.hidden = true;
    this.root.setAttribute('role', 'alertdialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'session-connection-label');
    this.root.innerHTML = `
      <div class="session-connection-card">
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <p id="session-connection-label" class="app-loading-label" data-session-label>Connection lost</p>
        <p class="app-loading-detail" data-session-detail>Retrying SpacetimeDB connection…</p>
        <button type="button" class="app-loading-retry" data-session-retry hidden>Retry now</button>
      </div>
    `;
    parent.appendChild(this.root);

    const labelEl = this.root.querySelector<HTMLElement>('[data-session-label]');
    const detailEl = this.root.querySelector<HTMLElement>('[data-session-detail]');
    const retryButton = this.root.querySelector<HTMLButtonElement>('[data-session-retry]');
    if (!labelEl || !detailEl || !retryButton) {
      throw new Error('Session connection overlay markup is incomplete.');
    }
    this.labelEl = labelEl;
    this.detailEl = detailEl;
    this.retryButton = retryButton;
    this.retryButton.addEventListener('click', () => {
      this.retryHandler?.();
    });
  }

  show(label: string, detail: string, onRetry?: () => void): void {
    this.labelEl.textContent = label;
    this.detailEl.textContent = detail;
    this.retryHandler = onRetry ?? null;
    this.retryButton.hidden = onRetry === undefined;
    this.root.hidden = false;
  }

  hide(): void {
    this.retryHandler = null;
    this.retryButton.hidden = true;
    this.root.hidden = true;
  }

  dispose(): void {
    this.retryHandler = null;
    this.root.remove();
  }
}
