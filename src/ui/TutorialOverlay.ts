import type { BuildingKind } from '../generated/gameBalance.ts';
import { PersistentTutorialCompletions } from './PersistentTutorialCompletions.ts';

type TutorialId =
  | 'welcome'
  | 'founding'
  | 'roads'
  | 'construction-supply'
  | 'workforce'
  | 'residence-placement'
  | 'first-homes'
  | 'fire';

type TutorialIcon =
  | 'camp'
  | 'road'
  | 'build'
  | 'timber'
  | 'stone'
  | 'firewood'
  | 'water'
  | 'food'
  | 'housing'
  | 'labor';

type TutorialTextPart = {
  text: string;
  emphasis?: 'gold' | 'plain';
};

type TutorialRow = {
  icon: TutorialIcon;
  label: string;
  parts: TutorialTextPart[];
};

type TutorialDefinition = {
  id: TutorialId;
  eyebrow: string;
  title: string;
  rows: TutorialRow[];
  blocksGameplay?: boolean;
};

type TutorialOverlayOptions = {
  onOpenChange?: (open: boolean) => void;
};

const SKIP_TUTORIALS_STORAGE_KEY = 'selo-empire.skip-tutorials.v1';
const COMPLETED_TUTORIALS_STORAGE_KEY = 'selo-empire.completed-tutorials.v1';

const WORKSITE_BUILDING_KINDS = new Set<BuildingKind>([
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'well',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'brewery',
  'smokehouse',
  'granary',
  'bakery',
  'apiary',
  'watermill',
  'carpenter',
  'weaver',
  'ferry_landing',
  'vineyard',
]);

const TUTORIALS: Record<TutorialId, TutorialDefinition> = {
  welcome: {
    id: 'welcome',
    eyebrow: 'Your valley is ready',
    title: 'Begin Your Settlement',
    rows: [
      {
        icon: 'camp',
        label: 'Place the camp',
        parts: [
          { text: 'Choose ' },
          { text: 'Place starter camp', emphasis: 'gold' },
          { text: ' at the bottom of the screen, then pick clear, dry ground near timber, stone, food, and water.' },
        ],
      },
      {
        icon: 'road',
        label: 'Follow the guided steps',
        parts: [
          { text: 'Tutorial cards will appear as you open ' },
          { text: 'Roads, construction, workforce, and homes', emphasis: 'gold' },
          { text: ' for the first time.' },
        ],
      },
      {
        icon: 'build',
        label: 'Open tutorials again',
        parts: [
          { text: 'Use the always-visible ' },
          { text: 'Tutorials', emphasis: 'gold' },
          { text: ' button in the lower-left corner whenever you want to replay the full guide.' },
        ],
      },
    ],
  },
  founding: {
    id: 'founding',
    eyebrow: "Founders' Camp established",
    title: 'A Settlement Takes Root',
    blocksGameplay: false,
    rows: [
      {
        icon: 'camp',
        label: 'Ten founders, ample supplies',
        parts: [
          { text: 'Your camp begins with 10 people plus enough ' },
          { text: 'Timber and Stone for the full starter chain', emphasis: 'gold' },
          { text: '. Watch the bar above—these reserves will not last forever.' },
        ],
      },
      {
        icon: 'road',
        label: 'Road links',
        parts: [
          { text: 'Draw a short ' },
          { text: 'Road', emphasis: 'gold' },
          { text: ' out from the camp. Worksites, carts, and households use roads to share supplies.' },
        ],
      },
      {
        icon: 'build',
        label: 'First buildings',
        parts: [
          { text: 'Secure ' },
          { text: 'Timber, Firewood, Stone, and Food', emphasis: 'gold' },
          { text: " first: place a Lumber Mill, Woodcutter's Lodge, Stonecutter's Camp, and a Forager's Shed, Hunter's Hall, or Fishing Camp. Then add roadside homes." },
        ],
      },
    ],
  },
  roads: {
    id: 'roads',
    eyebrow: 'Road tool opened',
    title: 'Roads & Carts',
    rows: [
      {
        icon: 'road',
        label: 'Laying roads',
        parts: [
          { text: 'Place road points with ' },
          { text: 'Left-click', emphasis: 'gold' },
          { text: '. Use Ctrl + scroll to curve the next segment, then choose the Hammer or press Enter to build.' },
        ],
      },
      {
        icon: 'build',
        label: 'Road advantage',
        parts: [
          { text: 'Local carts can cross open ground, so a missing connection never stops essential supplies. ' },
          { text: 'Road-connected routes move at full speed', emphasis: 'gold' },
          { text: '; off-road hauls run at 45% speed.' },
        ],
      },
      {
        icon: 'labor',
        label: 'Cart journeys',
        parts: [
          { text: 'Delivery workers travel with carts and remain committed while away. ' },
          { text: 'Short road routes', emphasis: 'gold' },
          { text: ' return them to work sooner.' },
        ],
      },
    ],
  },
  'construction-supply': {
    id: 'construction-supply',
    eyebrow: 'First building selected',
    title: 'Keep Construction Moving',
    rows: [
      {
        icon: 'timber',
        label: 'Secure timber',
        parts: [
          { text: 'A staffed ' },
          { text: 'Lumber Mill', emphasis: 'gold' },
          { text: " near mature trees produces construction Timber. A Woodcutter's Lodge makes Firewood instead." },
        ],
      },
      {
        icon: 'stone',
        label: 'Secure stone',
        parts: [
          { text: 'A staffed ' },
          { text: "Stonecutter's Camp", emphasis: 'gold' },
          { text: ' cuts Stone when a surface outcrop lies inside its work area.' },
        ],
      },
      {
        icon: 'build',
        label: 'Keep two hands free',
        parts: [
          { text: 'Assign about two workers to each basic producer and leave ' },
          { text: 'two people unassigned for building and carts', emphasis: 'gold' },
          { text: '. The larger founding crew and cheaper starter sites leave room to recover from mistakes.' },
        ],
      },
    ],
  },
  workforce: {
    id: 'workforce',
    eyebrow: 'First worksite selected',
    title: 'Workforce',
    rows: [
      {
        icon: 'build',
        label: 'Assigning workers',
        parts: [
          { text: 'Select a building and use the ' },
          { text: 'Workforce − / + controls', emphasis: 'gold' },
          { text: ' to assign available Labor.' },
        ],
      },
      {
        icon: 'labor',
        label: 'Builders and workers',
        parts: [
          { text: 'Assigned people build unfinished sites. Once construction is complete, they ' },
          { text: 'operate the worksite', emphasis: 'gold' },
          { text: ' and some jobs send them out with carts.' },
        ],
      },
      {
        icon: 'housing',
        label: 'Available labor',
        parts: [
          { text: 'The Labor number at the top shows unassigned residents. Leave a small reserve for ' },
          { text: 'construction hauling and new jobs', emphasis: 'gold' },
          { text: '.' },
        ],
      },
    ],
  },
  'residence-placement': {
    id: 'residence-placement',
    eyebrow: 'Residence tool opened',
    title: 'Laying Out Homes',
    rows: [
      {
        icon: 'road',
        label: 'Set the frontage',
        parts: [
          { text: 'Click twice along a ' },
          { text: 'Road', emphasis: 'gold' },
          { text: ' to set the frontage, then click behind it to set the depth and complete the rectangle.' },
        ],
      },
      {
        icon: 'housing',
        label: 'Choose the plots',
        parts: [
          { text: 'Use the on-zone ' },
          { text: '− / + controls', emphasis: 'gold' },
          { text: ' to choose how many cottage plots fit. Press F to rotate the road-facing edge when available.' },
        ],
      },
      {
        icon: 'build',
        label: 'Confirm the layout',
        parts: [
          { text: 'Choose the Hammer or press Enter to place a valid layout and reserve its timber and stone. ' },
          { text: 'Right-click or Backspace', emphasis: 'gold' },
          { text: ' steps back.' },
        ],
      },
    ],
  },
  'first-homes': {
    id: 'first-homes',
    eyebrow: 'First residence plots laid',
    title: 'Welcoming Households',
    rows: [
      {
        icon: 'housing',
        label: 'Roadside homes',
        parts: [
          { text: 'Residence plots must face a ' },
          { text: 'Road', emphasis: 'gold' },
          { text: '. Empty homes create Housing; settlers arrive as their needs can be met.' },
        ],
      },
      {
        icon: 'food',
        label: 'Food reaches the market',
        parts: [
          { text: 'Foragers, Hunters, Fishing camps, and Bakeries produce food while free haulers or granary keepers centralize it. Staff a ' },
          { text: 'Granary', emphasis: 'gold' },
          { text: ' and connect a Marketplace so its food stalls can stock and serve road-linked homes. Wells remain unstaffed; storehouse workers supply market fuel and household goods.' },
        ],
      },
      {
        icon: 'labor',
        label: 'Steady growth',
        parts: [
          { text: 'New residents become workers. Grow a few homes at a time, then assign the new ' },
          { text: 'Labor', emphasis: 'gold' },
          { text: ' where the village is short.' },
        ],
      },
    ],
  },
  fire: {
    id: 'fire',
    eyebrow: 'First structure fire reported',
    title: 'Fire in the Settlement',
    rows: [
      {
        icon: 'firewood',
        label: 'Fire damage',
        parts: [
          { text: 'Fire shuts the structure down. Select it to see ' },
          { text: 'intensity, damage, water, and response', emphasis: 'gold' },
          { text: '.' },
        ],
      },
      {
        icon: 'water',
        label: 'Well response',
        parts: [
          { text: 'A completed well with Water inside its work extent ' },
          { text: 'claims an unassigned hauler for buckets', emphasis: 'gold' },
          { text: '. Fire calls take priority, and the nearest short road route wins.' },
        ],
      },
      {
        icon: 'build',
        label: 'Collapse and recovery',
        parts: [
          { text: 'At 100% damage it collapses: most stored goods are lost, homes empty, and ' },
          { text: 'rebuilding costs 70% of the original materials', emphasis: 'gold' },
          { text: '. Extinguished structures still need repair.' },
        ],
      },
    ],
  },
};

function isTutorialId(value: string): value is TutorialId {
  return Object.prototype.hasOwnProperty.call(TUTORIALS, value);
}

const TUTORIAL_ORDER: readonly TutorialId[] = [
  'founding',
  'roads',
  'construction-supply',
  'workforce',
  'residence-placement',
  'first-homes',
  'fire',
];

export class TutorialOverlay {
  private readonly root: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly skipCheckbox: HTMLInputElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly options: TutorialOverlayOptions;
  private readonly shown = new Set<TutorialId>();
  private readonly completions: PersistentTutorialCompletions<TutorialId>;
  private replayQueue: TutorialId[] = [];
  private current: TutorialId | null = null;
  private previousFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement, options: TutorialOverlayOptions = {}) {
    this.options = options;
    this.completions = new PersistentTutorialCompletions(
      () => window.localStorage,
      COMPLETED_TUTORIALS_STORAGE_KEY,
      isTutorialId,
    );
    this.root = document.createElement('div');
    this.root.className = 'tutorial-overlay';
    this.root.hidden = true;
    this.root.innerHTML = `
      <section
        class="tutorial-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-rows"
      >
        <header class="tutorial-dialog__header">
          <p class="tutorial-dialog__eyebrow" data-tutorial-eyebrow></p>
          <h2 class="tutorial-dialog__title" id="tutorial-title" data-tutorial-title></h2>
          <span class="tutorial-dialog__rule" aria-hidden="true"></span>
        </header>
        <div class="tutorial-dialog__rows" id="tutorial-rows" data-tutorial-rows></div>
        <footer class="tutorial-dialog__footer">
          <label class="tutorial-dialog__skip">
            <input type="checkbox" data-tutorial-skip />
            <span class="tutorial-dialog__check" aria-hidden="true"></span>
            <span>Skip all future tutorials</span>
          </label>
          <button class="tutorial-dialog__confirm" type="button" data-tutorial-confirm>
            Got it
          </button>
        </footer>
      </section>
    `;
    parent.appendChild(this.root);

    this.dialog = this.mustElement('.tutorial-dialog');
    this.eyebrow = this.mustElement('[data-tutorial-eyebrow]');
    this.title = this.mustElement('[data-tutorial-title]');
    this.rows = this.mustElement('[data-tutorial-rows]');
    this.skipCheckbox = this.mustElement<HTMLInputElement>('[data-tutorial-skip]');
    this.confirmButton = this.mustElement<HTMLButtonElement>('[data-tutorial-confirm]');

    this.confirmButton.addEventListener('click', this.dismiss);
    this.skipCheckbox.addEventListener('change', this.onSkipChange);
    this.root.addEventListener('mousedown', this.onBackdropPointer);
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  isOpen(): boolean {
    return this.current !== null;
  }

  isGameplayBlocking(): boolean {
    return this.current !== null && TUTORIALS[this.current].blocksGameplay !== false;
  }

  replayAll(): void {
    this.setTutorialsSkipped(false);
    this.shown.clear();
    this.completions.clear();
    this.replayQueue = [...TUTORIAL_ORDER];
    if (!this.isOpen()) this.showNextReplayTutorial();
  }

  notifyWorldReady(hasFoundersCamp: boolean): void {
    if (!hasFoundersCamp) this.show('welcome');
  }

  notifyBuildingPlaced(kind: BuildingKind, buildingKinds: Iterable<BuildingKind>): void {
    const kinds = [...buildingKinds];
    if (kind === 'founders_camp') {
      if (kinds.filter((placedKind) => placedKind === 'founders_camp').length === 1) {
        this.show('founding');
      }
    }
  }

  notifyBuildingToolOpened(
    kind: BuildingKind,
    buildingKinds: Iterable<BuildingKind>,
  ): boolean {
    if (kind === 'founders_camp') return false;
    const kinds = [...buildingKinds];
    const hasFoundersCamp = kinds.includes('founders_camp');
    const hasStartedExpansion = kinds.some((placedKind) =>
      placedKind !== 'founders_camp' && placedKind !== 'salvage_pile'
    );
    return hasFoundersCamp && !hasStartedExpansion && this.show('construction-supply');
  }

  notifyRoadToolOpened(roadCount: number): void {
    if (roadCount === 0) this.show('roads');
  }

  notifyBuildingSelected(kind: BuildingKind): void {
    if (WORKSITE_BUILDING_KINDS.has(kind)) this.show('workforce');
  }

  notifyResidenceToolOpened(zoneCount: number): boolean {
    return zoneCount === 0 && this.show('residence-placement');
  }

  notifyBurgageZonePlaced(zoneCount: number): void {
    if (zoneCount === 1) this.show('first-homes');
  }

  notifyFireStarted(): boolean {
    return this.show('fire');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.confirmButton.removeEventListener('click', this.dismiss);
    this.skipCheckbox.removeEventListener('change', this.onSkipChange);
    this.root.removeEventListener('mousedown', this.onBackdropPointer);
    this.root.remove();
  }

  private show(id: TutorialId): boolean {
    if (this.shown.has(id) || this.completions.has(id) || this.areTutorialsSkipped()) return false;
    if (this.isOpen()) {
      if (!this.replayQueue.includes(id)) this.replayQueue.push(id);
      return true;
    }
    const tutorial = TUTORIALS[id];
    const blocksGameplay = tutorial.blocksGameplay !== false;
    this.shown.add(id);
    this.current = id;
    this.previousFocus = blocksGameplay && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.eyebrow.textContent = tutorial.eyebrow;
    this.title.textContent = tutorial.title;
    this.renderRows(tutorial.rows);
    this.skipCheckbox.checked = false;
    this.root.hidden = false;
    this.root.dataset.tutorial = id;
    this.root.dataset.blocking = String(blocksGameplay);
    this.dialog.setAttribute('aria-modal', String(blocksGameplay));
    // Visibility must not depend on a later animation frame. If the main
    // thread is busy applying the founding snapshot, a deferred class would
    // leave an invisible overlay logically open over the game.
    this.root.classList.add('is-visible');
    if (blocksGameplay) {
      requestAnimationFrame(() => {
        if (!this.isGameplayBlocking()) return;
        this.confirmButton.focus({ preventScroll: true });
      });
    }
    this.options.onOpenChange?.(true);
    return true;
  }

  private renderRows(rowDefinitions: TutorialRow[]): void {
    this.rows.replaceChildren();
    for (const rowDefinition of rowDefinitions) {
      const row = document.createElement('article');
      row.className = 'tutorial-row';

      const icon = document.createElement('span');
      icon.className = `tutorial-row__icon tutorial-row__icon--${rowDefinition.icon}`;
      icon.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('p');
      copy.className = 'tutorial-row__copy';
      for (const part of rowDefinition.parts) {
        const span = document.createElement('span');
        span.textContent = part.text;
        if (part.emphasis === 'gold') span.className = 'tutorial-row__emphasis';
        copy.appendChild(span);
      }

      row.setAttribute('aria-label', rowDefinition.label);
      row.append(icon, copy);
      this.rows.appendChild(row);
    }
  }

  private readonly dismiss = (): void => {
    if (!this.isOpen()) return;
    this.completions.complete(this.current!);
    const skipTutorials = this.skipCheckbox.checked;
    if (skipTutorials) {
      this.setTutorialsSkipped(true);
      this.replayQueue = [];
    }
    this.root.classList.remove('is-visible');
    this.root.hidden = true;
    delete this.root.dataset.tutorial;
    delete this.root.dataset.blocking;
    this.current = null;
    this.options.onOpenChange?.(false);
    this.previousFocus?.focus({ preventScroll: true });
    this.previousFocus = null;
    if (!skipTutorials) this.showNextReplayTutorial();
  };

  private showNextReplayTutorial(): void {
    const next = this.replayQueue.shift();
    if (next) this.show(next);
  }

  private readonly onSkipChange = (): void => {
    this.setTutorialsSkipped(this.skipCheckbox.checked);
  };

  private readonly onBackdropPointer = (event: MouseEvent): void => {
    if (event.target === this.root) {
      event.preventDefault();
      this.dialog.animate(
        [
          { transform: 'translateY(0)' },
          { transform: 'translateY(-2px)' },
          { transform: 'translateY(0)' },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isGameplayBlocking()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dismiss();
      return;
    }
    if (event.key === 'Enter' && document.activeElement !== this.skipCheckbox) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dismiss();
      return;
    }
    if (event.key === 'Tab') {
      const movingBackward = event.shiftKey;
      const focusAtStart = document.activeElement === this.skipCheckbox;
      const focusAtEnd = document.activeElement === this.confirmButton;
      if ((!movingBackward && focusAtEnd) || (movingBackward && focusAtStart)) {
        event.preventDefault();
        (movingBackward ? this.confirmButton : this.skipCheckbox).focus();
      }
    }
    event.stopImmediatePropagation();
  };

  private areTutorialsSkipped(): boolean {
    try {
      return window.localStorage.getItem(SKIP_TUTORIALS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private setTutorialsSkipped(skipped: boolean): void {
    try {
      if (skipped) {
        window.localStorage.setItem(SKIP_TUTORIALS_STORAGE_KEY, '1');
      } else {
        window.localStorage.removeItem(SKIP_TUTORIALS_STORAGE_KEY);
      }
    } catch {
      // Storage can be unavailable in private or sandboxed browser contexts.
    }
  }

  private mustElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing tutorial element ${selector}`);
    return element;
  }
}
