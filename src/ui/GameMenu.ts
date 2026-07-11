import {
  areBuildingShadowsEnabled,
  areTreeShadowsEnabled,
  setBuildingShadowsEnabled,
  setTreeShadowsEnabled,
} from '../scene/shadowPreference.ts';

type GameMenuOptions = {
  onShadowPreferenceChange: () => void;
  onOpenChange?: (open: boolean) => void;
  onOpenCityAdministration?: () => void;
  onNewWorld?: () => void;
  showButton?: boolean;
  /** When false, Escape will not open the menu (e.g. first-person walk mode). */
  canOpenFromKeyboard?: () => boolean;
};

export class GameMenu {
  private readonly backdrop: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly treeShadowsCheckbox: HTMLInputElement;
  private readonly buildingShadowsCheckbox: HTMLInputElement;
  private readonly menuButton: HTMLButtonElement;
  private open = false;
  private readonly onShadowPreferenceChange: () => void;
  private readonly onOpenChange?: (open: boolean) => void;
  private readonly onOpenCityAdministration?: () => void;
  private readonly onNewWorld?: () => void;
  private readonly canOpenFromKeyboard?: () => boolean;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(parent: HTMLElement, options: GameMenuOptions) {
    this.onShadowPreferenceChange = options.onShadowPreferenceChange;
    this.onOpenChange = options.onOpenChange;
    this.onOpenCityAdministration = options.onOpenCityAdministration;
    this.onNewWorld = options.onNewWorld;
    this.canOpenFromKeyboard = options.canOpenFromKeyboard;

    this.menuButton = document.createElement('button');
    this.menuButton.type = 'button';
    this.menuButton.className = 'hud-menu-button';
    this.menuButton.setAttribute('aria-label', 'Open menu');
    this.menuButton.setAttribute('aria-haspopup', 'dialog');
    this.menuButton.setAttribute('aria-expanded', 'false');
    this.menuButton.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    `;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'game-menu-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.innerHTML = `
      <div class="game-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="game-menu-title">
        <h2 id="game-menu-title" class="game-menu-title">Menu</h2>
        <label class="game-menu-option">
          <input type="checkbox" data-tree-shadows-checkbox />
          <span>Tree shadows</span>
        </label>
        <label class="game-menu-option">
          <input type="checkbox" data-building-shadows-checkbox />
          <span>Building shadows</span>
        </label>
        <button type="button" class="game-menu-action" data-city-admin>City administration…</button>
        <button type="button" class="game-menu-action" data-new-world>New world…</button>
        <button type="button" class="game-menu-return" data-return-button>Return to game</button>
      </div>
    `;

    this.dialog = this.backdrop.querySelector<HTMLElement>('.game-menu-dialog')!;
    this.treeShadowsCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-tree-shadows-checkbox]')!;
    this.buildingShadowsCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-building-shadows-checkbox]')!;
    const returnButton = this.backdrop.querySelector<HTMLButtonElement>('[data-return-button]')!;
    const cityAdminButton = this.backdrop.querySelector<HTMLButtonElement>('[data-city-admin]')!;
    const newWorldButton = this.backdrop.querySelector<HTMLButtonElement>('[data-new-world]')!;

    if (options.showButton !== false) parent.appendChild(this.menuButton);
    parent.appendChild(this.backdrop);

    this.treeShadowsCheckbox.checked = areTreeShadowsEnabled();
    this.buildingShadowsCheckbox.checked = areBuildingShadowsEnabled();
    this.menuButton.addEventListener('click', () => this.toggle());
    returnButton.addEventListener('click', () => this.close());
    cityAdminButton.addEventListener('click', () => {
      this.close();
      this.onOpenCityAdministration?.();
    });
    newWorldButton.addEventListener('click', () => {
      this.close();
      this.onNewWorld?.();
    });
    this.backdrop.addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (event) => event.stopPropagation());
    this.treeShadowsCheckbox.addEventListener('change', () => {
      setTreeShadowsEnabled(this.treeShadowsCheckbox.checked);
      this.onShadowPreferenceChange();
    });
    this.buildingShadowsCheckbox.addEventListener('change', () => {
      setBuildingShadowsEnabled(this.buildingShadowsCheckbox.checked);
      this.onShadowPreferenceChange();
    });

    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || this.isTextInputFocused()) return;

      if (this.open) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }

      if (this.canOpenFromKeyboard?.() === false) return;

      event.preventDefault();
      event.stopPropagation();
      this.openMenu();
    };

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.close();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.menuButton.remove();
    this.backdrop.remove();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    this.open = true;
    this.treeShadowsCheckbox.checked = areTreeShadowsEnabled();
    this.buildingShadowsCheckbox.checked = areBuildingShadowsEnabled();
    this.backdrop.hidden = false;
    this.menuButton.setAttribute('aria-expanded', 'true');
    this.onOpenChange?.(true);
    this.backdrop.querySelector<HTMLButtonElement>('[data-return-button]')?.focus({ preventScroll: true });
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.backdrop.hidden = true;
    this.menuButton.setAttribute('aria-expanded', 'false');
    this.onOpenChange?.(false);
  }

  private isTextInputFocused(): boolean {
    const target = document.activeElement as HTMLElement | null;
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  }
}
