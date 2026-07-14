import { GAME_CONTROL_SECTIONS } from './gameControlsReference.ts';

export class GameControlsModal {
  private readonly backdrop: HTMLElement;
  private readonly dialog: HTMLElement;
  private open = false;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(parent: HTMLElement) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'game-controls-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.innerHTML = `
      <div class="game-controls-dialog" role="dialog" aria-modal="true" aria-labelledby="game-controls-title">
        <header class="game-controls-dialog__header">
          <div>
            <p class="game-controls-dialog__eyebrow">Reference</p>
            <h2 id="game-controls-title" class="game-controls-dialog__title">Game controls</h2>
          </div>
          <button type="button" class="game-controls-dialog__close" data-close aria-label="Close">×</button>
        </header>
        <div class="game-controls-dialog__body">
          ${GAME_CONTROL_SECTIONS.map((section) => `
            <section class="game-controls-section">
              <h3 class="game-controls-section__title">${section.title}</h3>
              <ul class="game-controls-list">
                ${section.entries.map((entry) => `
                  <li class="game-controls-list__item">
                    <span class="game-controls-list__action">${entry.action}</span>
                    <span class="game-controls-list__keys">${entry.keys}</span>
                  </li>
                `).join('')}
              </ul>
            </section>
          `).join('')}
        </div>
      </div>
    `;

    this.dialog = this.backdrop.querySelector<HTMLElement>('.game-controls-dialog')!;
    const closeButton = this.backdrop.querySelector<HTMLButtonElement>('[data-close]')!;

    parent.appendChild(this.backdrop);
    closeButton.addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (event) => event.stopPropagation());

    this.onKeyDown = (event: KeyboardEvent) => {
      if (!this.open || event.key !== 'Escape') return;
      if (this.isTextInputFocused()) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  openModal(): void {
    if (this.open) return;
    this.open = true;
    this.backdrop.hidden = false;
    this.backdrop.querySelector<HTMLButtonElement>('[data-close]')?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.backdrop.hidden = true;
  }

  dispose(): void {
    this.close();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.backdrop.remove();
  }

  private isTextInputFocused(): boolean {
    const target = document.activeElement as HTMLElement | null;
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  }
}
