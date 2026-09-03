import {
  DEVELOPMENT_BRANCHES, DEVELOPMENT_POINT_CAP, DEVELOPMENT_SKILL_BY_ID,
  DevelopmentState, developmentIconUrl, developmentSkillPosition,
} from './developmentTree.ts';
import { applyHeraldryToElement, createHeraldryShield, getCurrentNobleProfile } from './nobleProfile.ts';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

const LOCK = '<svg viewBox="0 0 16 18" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2M2 7h12v10H2z"/><path d="M8 10v4"/></svg>';

export class DevelopmentMenu {
  private readonly root: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly element: HTMLElement;
  private readonly state = new DevelopmentState();
  private readonly onOpenChange: (open: boolean) => void;
  private readonly inertBeforeOpen = new Map<HTMLElement, boolean>();
  private selected = DEVELOPMENT_BRANCHES[0].skills[0].id;
  private open = false;
  private resetArmed = false;
  private returnFocus: HTMLElement | null = null;

  constructor(root: HTMLElement, launcher: HTMLButtonElement, onOpenChange: (open: boolean) => void) {
    this.root = root;
    this.launcher = launcher;
    this.onOpenChange = onOpenChange;
    this.element = document.createElement('section');
    this.element.id = 'development-menu';
    this.element.className = 'development-menu';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'development-title');
    this.element.innerHTML = `
      <header class="development-header">
        <h1 id="development-title">Developments</h1>
        <button type="button" class="development-close" data-development-close aria-label="Close developments">Return to estate <kbd>Esc</kbd></button>
      </header>
      <div class="development-content">
        <div class="development-atlas">
          <div class="development-wheel" role="group" aria-label="Four-branch development tree">
            <div class="development-branch-art development-branch-art--land" aria-hidden="true"></div>
            <div class="development-branch-art development-branch-art--craft" aria-hidden="true"></div>
            <div class="development-branch-art development-branch-art--hearth" aria-hidden="true"></div>
            <div class="development-branch-art development-branch-art--woodland" aria-hidden="true"></div>
            <svg class="development-connections" viewBox="0 0 900 900" aria-hidden="true">
              <circle class="development-ring" cx="450" cy="450" r="440"/>
              <circle class="development-ring development-ring--inner" cx="450" cy="450" r="429"/>
              <path class="development-dividers" d="M141 141 759 759M141 759 759 141"/>
              ${DEVELOPMENT_BRANCHES.map(branch => branch.skills.map((skill, index) => {
                const end = developmentSkillPosition(branch, index);
                return (skill.requires.length ? skill.requires : ['estate']).map(required => {
                  const start = required === 'estate' ? { x: 450, y: 450 } : developmentSkillPosition(branch, branch.skills.findIndex(s => s.id === required));
                  const radial = branch.angle * Math.PI / 180;
                  const bendX = Math.cos(radial) * 45;
                  const bendY = Math.sin(radial) * 45;
                  return `<path class="development-link" data-link-to="${skill.id}" data-link-from="${required}" d="M${start.x} ${start.y} C${start.x + bendX} ${start.y + bendY},${end.x - bendX} ${end.y - bendY},${end.x} ${end.y}"/>`;
                }).join('');
              }).join('')).join('')}
            </svg>
            <div class="development-center"><span data-development-heraldry></span></div>
            ${DEVELOPMENT_BRANCHES.map(branch => `
              <div class="development-branch-label development-branch-label--${branch.id}"><span>${branch.name}</span><small data-branch-count="${branch.id}">0 / 6</small></div>
              ${branch.skills.map((skill, index) => {
                const position = developmentSkillPosition(branch, index);
                return `<button type="button" class="development-node${index === 5 ? ' development-node--mastery' : ''}" data-development-skill="${skill.id}" data-branch="${branch.id}"
                  style="left:${position.x / 9}%;top:${position.y / 9}%" aria-pressed="false">
                  <span class="development-node__seal"><img src="${developmentIconUrl(skill.icon)}" alt="" draggable="false"/><span class="development-node__state" aria-hidden="true"></span></span>
                  <span class="development-node__name">${escapeHtml(skill.name)}</span>
                </button>`;
              }).join('')}`).join('')}
          </div>
          <div class="development-legend" aria-label="Skill states"><span><i class="is-learned"></i>Learned</span><span><i class="is-available"></i>Available</span><span><i class="is-locked"></i>Locked</span></div>
        </div>
        <aside class="development-ledger" aria-label="Development details">
          <div class="development-budget"><div class="development-budget__number"><strong data-development-points>9</strong><span>/ ${DEVELOPMENT_POINT_CAP}</span></div><h2>Development points</h2></div>
          <div class="development-budget__marks" aria-hidden="true">${Array.from({ length: DEVELOPMENT_POINT_CAP }, () => '<i></i>').join('')}</div>
          <section class="development-detail" aria-labelledby="development-skill-title">
            <p class="development-eyebrow" data-detail-branch></p>
            <div class="development-detail__heading"><img data-detail-icon alt=""/><div><span data-detail-tier></span><h2 id="development-skill-title"></h2></div></div>
            <p class="development-detail__description" data-detail-description></p>
            <div class="development-requirements"><h3>Prerequisites <span data-requirement-mode></span></h3><div data-detail-requires></div></div>
            <button type="button" class="development-unlock" data-development-unlock>Unlock <span>1 point</span></button>
          </section>
          <button type="button" class="development-reset" data-development-reset>Reset developments</button>
          <p class="development-announcement" role="status" aria-live="polite" data-development-announcement></p>
        </aside>
      </div>`;
    const shield = createHeraldryShield('development-heraldry');
    applyHeraldryToElement(shield, getCurrentNobleProfile().heraldry);
    this.element.querySelector('[data-development-heraldry]')!.append(shield);
    root.append(this.element);
    this.element.addEventListener('click', this.onClick);
    for (const event of ['pointerdown', 'mousedown', 'wheel', 'dblclick', 'contextmenu']) {
      this.element.addEventListener(event, this.stopWorldInput);
    }
    window.addEventListener('keydown', this.onKeyDown, true);
    this.render();
  }

  isOpen(): boolean { return this.open; }

  openMenu(): void {
    if (this.open) return;
    this.returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : this.launcher;
    this.open = true;
    this.resetArmed = false;
    this.element.hidden = false;
    this.root.classList.add('has-development-open');
    for (const child of this.root.children) {
      if (!(child instanceof HTMLElement) || child === this.element) continue;
      this.inertBeforeOpen.set(child, child.inert);
      child.inert = true;
    }
    this.launcher.setAttribute('aria-expanded', 'true');
    this.onOpenChange(true);
    this.render();
    this.element.querySelector<HTMLButtonElement>(`[data-development-skill="${this.selected}"]`)!.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.hidden = true;
    this.root.classList.remove('has-development-open');
    for (const [child, inert] of this.inertBeforeOpen) child.inert = inert;
    this.inertBeforeOpen.clear();
    this.launcher.setAttribute('aria-expanded', 'false');
    this.onOpenChange(false);
    if (this.returnFocus?.isConnected && !this.returnFocus.closest('[inert], [hidden]')) this.returnFocus.focus({ preventScroll: true });
    else this.launcher.focus({ preventScroll: true });
  }

  dispose(): void {
    this.close();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.element.remove();
  }

  private readonly stopWorldInput = (event: Event): void => {
    event.stopPropagation();
    if (event.type === 'contextmenu') event.preventDefault();
  };

  private readonly onClick = (event: MouseEvent): void => {
    event.stopPropagation();
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    const id = button.dataset.developmentSkill ?? button.dataset.developmentPrerequisite;
    if (id && DEVELOPMENT_SKILL_BY_ID.has(id)) {
      this.selected = id;
      this.resetArmed = false;
      this.render();
      this.element.querySelector<HTMLElement>('.development-ledger')!.scrollTop = 0;
      if (button.hasAttribute('data-development-prerequisite')) {
        this.element.querySelector<HTMLButtonElement>(`[data-development-skill="${id}"]`)!.focus({ preventScroll: true });
      }
    } else if (button.hasAttribute('data-development-close')) this.close();
    else if (button.hasAttribute('data-development-unlock')) {
      if (this.state.unlock(this.selected)) {
        this.resetArmed = false;
        this.render();
        this.announce(`${DEVELOPMENT_SKILL_BY_ID.get(this.selected)!.name} learned. ${this.state.points} development ${this.state.points === 1 ? 'point' : 'points'} remaining.`);
        this.element.querySelector<HTMLButtonElement>(`[data-development-skill="${this.selected}"]`)!.focus({ preventScroll: true });
      }
    } else if (button.hasAttribute('data-development-reset')) {
      if (this.resetArmed) {
        this.state.reset();
        this.resetArmed = false;
        this.render();
        this.announce('All 9 development points refunded.');
      } else {
        this.resetArmed = true;
        button.textContent = 'Confirm reset';
        this.announce('Press Confirm reset again to clear your choices and refund all points.');
      }
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || event.ctrlKey || event.metaKey || event.altKey) return;
    // Registered before the toolbar and settings handlers: a key cannot operate both layers.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.close();
    } else if (event.key === 'Tab') {
      const focusable = [...this.element.querySelectorAll<HTMLElement>('button:not(:disabled)')]
        .filter(el => el.checkVisibility() && !el.closest('[inert]'));
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[next]?.focus({ preventScroll: true });
    }
  };

  private announce(message: string): void {
    this.element.querySelector('[data-development-announcement]')!.textContent = message;
  }

  private render(): void {
    this.element.querySelector('[data-development-points]')!.textContent = String(this.state.points);
    this.launcher.querySelector('[data-development-badge]')!.textContent = String(this.state.points);
    this.launcher.setAttribute('aria-label', `Developments, ${this.state.points} points available`);
    this.launcher.dataset.tooltip = `Developments · ${this.state.points} points available`;
    this.element.querySelectorAll('.development-budget__marks i').forEach((mark, i) => mark.classList.toggle('is-spent', i >= this.state.points));
    for (const branch of DEVELOPMENT_BRANCHES) {
      this.element.querySelector(`[data-branch-count="${branch.id}"]`)!.textContent = `${branch.skills.filter(skill => this.state.has(skill.id)).length} / 6`;
      for (const skill of branch.skills) {
        const button = this.element.querySelector<HTMLButtonElement>(`[data-development-skill="${skill.id}"]`)!;
        const status = this.state.status(skill.id);
        button.dataset.status = status;
        button.setAttribute('aria-pressed', String(skill.id === this.selected));
        button.setAttribute('aria-label', `${skill.name}, ${status === 'unaffordable' ? 'no points remaining' : status}, 1 point`);
        button.title = `${skill.name} — ${skill.description}`;
        button.querySelector('.development-node__state')!.innerHTML = status === 'learned' ? '✓' : status === 'locked' ? LOCK : '1';
      }
    }
    for (const link of this.element.querySelectorAll<SVGElement>('[data-link-to]')) {
      const learned = this.state.has(link.dataset.linkTo!);
      link.classList.toggle('is-learned', learned);
      link.classList.toggle('is-ready', !learned && (link.dataset.linkFrom === 'estate' || this.state.has(link.dataset.linkFrom!)));
    }
    const skill = DEVELOPMENT_SKILL_BY_ID.get(this.selected)!;
    const branch = DEVELOPMENT_BRANCHES.find(b => b.skills.some(s => s.id === skill.id))!;
    const status = this.state.status(skill.id);
    this.element.querySelector('[data-detail-branch]')!.textContent = branch.name;
    this.element.querySelector('[data-detail-tier]')!.textContent = skill.requires.length === 0 ? 'Foundation' : skill.requires.length > 1 ? 'Branch mastery' : 'Specialism';
    this.element.querySelector('#development-skill-title')!.textContent = skill.name;
    this.element.querySelector<HTMLImageElement>('[data-detail-icon]')!.src = developmentIconUrl(skill.icon);
    this.element.querySelector('[data-detail-description]')!.textContent = skill.description;
    this.element.querySelector('[data-requirement-mode]')!.textContent = skill.requires.length > 1 ? '· both required' : '';
    this.element.querySelector('[data-detail-requires]')!.innerHTML = skill.requires.length ? skill.requires.map(id => `<button type="button" data-development-prerequisite="${id}" class="${this.state.has(id) ? 'is-met' : ''}"><span aria-hidden="true">${this.state.has(id) ? '✓' : LOCK}</span>${escapeHtml(DEVELOPMENT_SKILL_BY_ID.get(id)!.name)}</button>`).join('') : '<p>None</p>';
    const unlock = this.element.querySelector<HTMLButtonElement>('[data-development-unlock]')!;
    unlock.disabled = status !== 'available';
    unlock.innerHTML = status === 'learned' ? 'Learned <span>✓</span>' : status === 'locked' ? 'Locked <span>1 point</span>' : status === 'unaffordable' ? 'No points remaining <span>0 / 9</span>' : 'Unlock <span>1 point</span>';
    this.element.querySelector('[data-development-reset]')!.textContent = 'Reset developments';
  }
}
