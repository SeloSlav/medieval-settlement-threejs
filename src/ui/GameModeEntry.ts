import './gameModeEntry.css';

/** The bare game URL is the front door. Existing world and preview links stay direct. */
export function showGameModeEntry(root: HTMLElement): boolean {
  if (window.location.search) return false;
  document.getElementById('app-loading')?.remove();
  const entry = document.createElement('main');
  entry.className = 'game-mode-entry';
  entry.innerHTML = `
    <section class="game-mode-entry__ledger" aria-labelledby="game-mode-title">
      <p class="game-mode-entry__eyebrow">Gorski Kotar · 1550</p>
      <h1 id="game-mode-title">Selo Empire</h1>
      <p class="game-mode-entry__intro">Choose where your settlement begins.</p>
      <nav class="game-mode-entry__choices" aria-label="Game mode">
        <a class="game-mode-entry__choice" data-mode="single">
          <span class="game-mode-entry__name">Single player</span>
          <span>Your own world, with map settings, pause and time controls.</span>
          <strong>Enter your world <span aria-hidden="true">→</span></strong>
        </a>
        <a class="game-mode-entry__choice" data-mode="multiplayer">
          <span class="game-mode-entry__name">Persistent realm</span>
          <span>One shared world for up to 50 settlers. Your camp is placed near resources.</span>
          <small>Five minutes per day · The world continues while you are away</small>
          <strong>Join the realm <span aria-hidden="true">→</span></strong>
        </a>
      </nav>
      <p class="game-mode-entry__return">Returning settlers continue with their existing settlement.</p>
    </section>`;
  for (const link of entry.querySelectorAll<HTMLAnchorElement>('a[data-mode]')) {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', link.dataset.mode!);
    link.href = url.href;
  }
  root.replaceChildren(entry);
  return true;
}
