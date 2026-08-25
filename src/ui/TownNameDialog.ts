export const MAX_TOWN_NAME_CHARACTERS = 48;

type PendingTownName = {
  currentName: string;
  resolve: (name: string | null) => void;
  restoreFocus: HTMLElement | null;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextTownNameDialogId = 1;

/** Focus-trapped rename and confirmation dialog shared by map and report labels. */
export class TownNameDialog {
  private readonly backdrop: HTMLDivElement;
  private readonly dialog: HTMLFormElement;
  private readonly title: HTMLHeadingElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLParagraphElement;
  private readonly count: HTMLElement;
  private readonly cancelButton: HTMLButtonElement;
  private pending: PendingTownName | null = null;
  private disposed = false;

  constructor(parent: HTMLElement) {
    const instanceId = nextTownNameDialogId++;
    const titleId = `town-name-dialog-title-${instanceId}`;
    const descriptionId = `town-name-dialog-description-${instanceId}`;
    const inputId = `town-name-dialog-input-${instanceId}`;
    const errorId = `town-name-dialog-error-${instanceId}`;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'town-name-dialog-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.setAttribute('aria-hidden', 'true');
    this.backdrop.innerHTML = `
      <form class="town-name-dialog" role="dialog" aria-modal="true"
        aria-labelledby="${titleId}" aria-describedby="${descriptionId}" novalidate>
        <header class="town-name-dialog__header">
          <span class="town-name-dialog__sigil" aria-hidden="true">✦</span>
          <div>
            <p>Confirm a new town name</p>
            <h2 id="${titleId}"></h2>
          </div>
        </header>
        <p class="town-name-dialog__description" id="${descriptionId}">This name will be used on the world label, community report, and every other town readout.</p>
        <label class="town-name-dialog__field" for="${inputId}">
          <span>Town name</span>
          <input id="${inputId}" type="text" maxlength="${MAX_TOWN_NAME_CHARACTERS}"
            autocomplete="off" spellcheck="false" aria-describedby="${errorId}" />
          <small data-town-name-count></small>
        </label>
        <p class="town-name-dialog__error" id="${errorId}" role="alert" hidden></p>
        <div class="town-name-dialog__actions">
          <button type="button" data-town-name-cancel>Cancel</button>
          <button type="submit" class="town-name-dialog__confirm">Confirm rename</button>
        </div>
      </form>
    `;

    this.dialog = this.mustElement<HTMLFormElement>('.town-name-dialog');
    this.title = this.mustElement<HTMLHeadingElement>(`#${titleId}`);
    this.input = this.mustElement<HTMLInputElement>(`#${inputId}`);
    this.error = this.mustElement<HTMLParagraphElement>(`#${errorId}`);
    this.count = this.mustElement<HTMLElement>('[data-town-name-count]');
    this.cancelButton = this.mustElement<HTMLButtonElement>('[data-town-name-cancel]');

    this.dialog.addEventListener('submit', this.onSubmit);
    this.input.addEventListener('input', this.onInput);
    this.cancelButton.addEventListener('click', this.onCancel);
    this.backdrop.addEventListener('click', this.onBackdropClick);
    this.backdrop.addEventListener('pointerdown', this.stopBackdropEvent);
    this.backdrop.addEventListener('wheel', this.stopBackdropEvent, { capture: true });
    window.addEventListener('keydown', this.onKeyDown, true);
    parent.appendChild(this.backdrop);
  }

  prompt(currentName: string): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null);
    const restoreFocus = this.pending?.restoreFocus ?? this.currentFocusTarget();
    if (this.pending) this.settle(null, false);
    this.title.textContent = `Rename ${currentName}`;
    this.input.value = currentName;
    this.clearError();
    this.syncCount();
    this.backdrop.hidden = false;
    this.backdrop.removeAttribute('aria-hidden');

    return new Promise<string | null>((resolve) => {
      this.pending = { currentName, resolve, restoreFocus };
      this.input.focus({ preventScroll: true });
      this.input.select();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settle(null);
    this.dialog.removeEventListener('submit', this.onSubmit);
    this.input.removeEventListener('input', this.onInput);
    this.cancelButton.removeEventListener('click', this.onCancel);
    this.backdrop.removeEventListener('click', this.onBackdropClick);
    this.backdrop.removeEventListener('pointerdown', this.stopBackdropEvent);
    this.backdrop.removeEventListener('wheel', this.stopBackdropEvent, { capture: true });
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.backdrop.remove();
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const normalized = normalizeTownName(this.input.value);
    if (!normalized) {
      this.showError('Enter a town name before confirming.');
      return;
    }
    if ([...normalized].length > MAX_TOWN_NAME_CHARACTERS) {
      this.showError(`Town names may contain at most ${MAX_TOWN_NAME_CHARACTERS} characters.`);
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    this.settle(normalized === pending.currentName ? null : normalized);
  };

  private readonly onInput = (): void => {
    this.clearError();
    this.syncCount();
  };

  private readonly onCancel = (): void => this.settle(null);

  private readonly onBackdropClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (event.target === this.backdrop) this.settle(null);
  };

  private readonly stopBackdropEvent = (event: Event): void => event.stopPropagation();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.pending) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.settle(null);
      return;
    }
    if (event.key === 'Tab') this.trapFocus(event);
  };

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => element.tabIndex >= 0);
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? currentIndex <= 0 ? focusable.at(-1) : null
      : currentIndex < 0 || currentIndex === focusable.length - 1 ? focusable[0] : null;
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
  }

  private showError(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
    this.input.setAttribute('aria-invalid', 'true');
    this.input.focus({ preventScroll: true });
  }

  private clearError(): void {
    this.error.textContent = '';
    this.error.hidden = true;
    this.input.removeAttribute('aria-invalid');
  }

  private syncCount(): void {
    this.count.textContent = `${[...this.input.value].length}/${MAX_TOWN_NAME_CHARACTERS}`;
  }

  private settle(name: string | null, restoreFocus = true): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.backdrop.hidden = true;
    this.backdrop.setAttribute('aria-hidden', 'true');
    if (restoreFocus && pending.restoreFocus?.isConnected) {
      pending.restoreFocus.focus({ preventScroll: true });
    }
    pending.resolve(name);
  }

  private currentFocusTarget(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  }

  private mustElement<T extends HTMLElement>(selector: string): T {
    const element = this.backdrop.querySelector<T>(selector);
    if (!element) throw new Error(`Town name dialog is missing ${selector}`);
    return element;
  }
}

export function normalizeTownName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
