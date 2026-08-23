export type AlertDialogConfirmOptions = {
  eyebrow?: string;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PendingConfirmation = {
  resolve: (confirmed: boolean) => void;
  restoreFocus: HTMLElement | null;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextAlertDialogId = 1;

/** A reusable, promise-based confirmation dialog for destructive actions. */
export class AlertDialog {
  private readonly backdrop: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly eyebrow: HTMLParagraphElement;
  private readonly title: HTMLHeadingElement;
  private readonly description: HTMLParagraphElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private pending: PendingConfirmation | null = null;
  private disposed = false;

  constructor(parent: HTMLElement) {
    const instanceId = nextAlertDialogId;
    nextAlertDialogId += 1;
    const titleId = `alert-dialog-title-${instanceId}`;
    const descriptionId = `alert-dialog-description-${instanceId}`;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'alert-dialog-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.setAttribute('aria-hidden', 'true');
    this.backdrop.innerHTML = `
      <div
        class="alert-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="${titleId}"
        aria-describedby="${descriptionId}"
        tabindex="-1"
      >
        <header class="alert-dialog__header">
          <span class="alert-dialog__sigil" aria-hidden="true">!</span>
          <div class="alert-dialog__heading">
            <p class="alert-dialog__eyebrow"></p>
            <h2 class="alert-dialog__title" id="${titleId}"></h2>
          </div>
        </header>
        <p class="alert-dialog__description" id="${descriptionId}"></p>
        <div class="alert-dialog__actions">
          <button type="button" class="alert-dialog__button alert-dialog__button--cancel" data-alert-dialog-cancel></button>
          <button type="button" class="alert-dialog__button alert-dialog__button--confirm" data-alert-dialog-confirm></button>
        </div>
      </div>
    `;

    this.dialog = this.mustElement<HTMLDivElement>('.alert-dialog');
    this.eyebrow = this.mustElement<HTMLParagraphElement>('.alert-dialog__eyebrow');
    this.title = this.mustElement<HTMLHeadingElement>('.alert-dialog__title');
    this.description = this.mustElement<HTMLParagraphElement>('.alert-dialog__description');
    this.confirmButton = this.mustElement<HTMLButtonElement>('[data-alert-dialog-confirm]');
    this.cancelButton = this.mustElement<HTMLButtonElement>('[data-alert-dialog-cancel]');

    this.backdrop.addEventListener('click', this.onBackdropClick);
    this.backdrop.addEventListener('pointerdown', this.onBackdropPointerDown);
    this.backdrop.addEventListener('wheel', this.onBackdropWheel, { capture: true });
    this.confirmButton.addEventListener('click', this.onConfirmClick);
    this.cancelButton.addEventListener('click', this.onCancelClick);
    window.addEventListener('keydown', this.onKeyDown, true);
    parent.appendChild(this.backdrop);
  }

  confirm(options: AlertDialogConfirmOptions): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);

    const restoreFocus = this.pending?.restoreFocus ?? this.currentFocusTarget();
    if (this.pending) this.settle(false, false);

    this.eyebrow.textContent = options.eyebrow?.trim() ?? '';
    this.eyebrow.hidden = this.eyebrow.textContent.length === 0;
    this.title.textContent = options.title;
    this.description.textContent = options.description;
    this.confirmButton.textContent = options.confirmLabel?.trim() || 'Confirm';
    this.cancelButton.textContent = options.cancelLabel?.trim() || 'Cancel';
    this.backdrop.hidden = false;
    this.backdrop.removeAttribute('aria-hidden');

    return new Promise<boolean>((resolve) => {
      this.pending = { resolve, restoreFocus };
      // The safe choice receives initial focus so opening the dialog cannot make
      // a destructive Enter/Space key repeat confirm the action accidentally.
      this.cancelButton.focus({ preventScroll: true });
    });
  }

  isOpen(): boolean {
    return this.pending !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settle(false);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.backdrop.removeEventListener('click', this.onBackdropClick);
    this.backdrop.removeEventListener('pointerdown', this.onBackdropPointerDown);
    this.backdrop.removeEventListener('wheel', this.onBackdropWheel, { capture: true });
    this.confirmButton.removeEventListener('click', this.onConfirmClick);
    this.cancelButton.removeEventListener('click', this.onCancelClick);
    this.backdrop.remove();
  }

  private readonly onBackdropClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (event.target === this.backdrop) this.settle(false);
  };

  private readonly onBackdropPointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  private readonly onBackdropWheel = (event: WheelEvent): void => {
    event.stopPropagation();
  };

  private readonly onConfirmClick = (): void => {
    this.settle(true);
  };

  private readonly onCancelClick = (): void => {
    this.settle(false);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.pending) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.settle(false);
      return;
    }
    if (event.key === 'Tab') this.trapFocus(event);
  };

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => (
      !element.closest('[hidden]')
      && element.getAttribute('aria-hidden') !== 'true'
      && element.tabIndex >= 0
    ));

    if (focusable.length === 0) {
      event.preventDefault();
      this.dialog.focus({ preventScroll: true });
      return;
    }

    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? currentIndex <= 0 ? focusable.at(-1) : null
      : currentIndex < 0 || currentIndex === focusable.length - 1 ? focusable[0] : null;
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
  }

  private settle(confirmed: boolean, restoreFocus = true): void {
    const pending = this.pending;
    if (!pending) return;

    // Clear first so click/keydown re-entry and disposal cannot resolve twice.
    this.pending = null;
    this.backdrop.hidden = true;
    this.backdrop.setAttribute('aria-hidden', 'true');
    if (restoreFocus && pending.restoreFocus?.isConnected) {
      pending.restoreFocus.focus({ preventScroll: true });
    }
    pending.resolve(confirmed);
  }

  private currentFocusTarget(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body ? active : null;
  }

  private mustElement<T extends HTMLElement>(selector: string): T {
    const element = this.backdrop.querySelector<T>(selector);
    if (!element) throw new Error(`Alert dialog is missing ${selector}`);
    return element;
  }
}
