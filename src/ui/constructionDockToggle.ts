export type DockToggle = {
  button: HTMLButtonElement;
  hotkey?: string;
  getActive: () => boolean;
  setActive: (active: boolean) => void;
  /** When true (default), Escape dismisses this toggle if it is active. */
  dismissOnEscape?: boolean;
};

export function syncDockToggleButton(toggle: Pick<DockToggle, 'button' | 'getActive'>): void {
  const active = toggle.getActive();
  toggle.button.classList.toggle('is-active', active);
  toggle.button.setAttribute('aria-pressed', String(active));
}

export function toggleDockControl(toggle: DockToggle): void {
  toggle.setActive(!toggle.getActive());
}

export function handleDockHotkey(key: string, toggles: readonly DockToggle[]): boolean {
  const normalized = key.toLowerCase();
  for (const toggle of toggles) {
    if (!toggle.hotkey || toggle.hotkey.toLowerCase() !== normalized) continue;
    if (toggle.button.hidden || toggle.button.disabled) continue;
    toggleDockControl(toggle);
    return true;
  }
  return false;
}

/** Dismiss the first active toggle (in order). Returns whether anything was dismissed. */
export function dismissDockToggles(toggles: readonly DockToggle[]): boolean {
  for (const toggle of toggles) {
    if (toggle.dismissOnEscape === false) continue;
    if (!toggle.getActive()) continue;
    toggle.setActive(false);
    return true;
  }
  return false;
}
