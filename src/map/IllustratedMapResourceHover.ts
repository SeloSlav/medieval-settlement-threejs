import { UI_TOOLTIP_REPOSITION_EVENT } from '../ui/tooltips.ts';
import { projectedMapButtonHitDistanceSquared } from './projectedMapButtonHitBounds.ts';

type IllustratedMapResourceHoverOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  isActive: () => boolean;
  isBlocked: () => boolean;
};

const RESOURCE_ANCHOR_SELECTOR = '.quarry-map-icon, .foraging-map-icon';

/**
 * Keeps the renderer as the real pointer target so map wheel/orbit/pan input
 * remains uninterrupted, then mirrors hover onto the existing tooltip anchors.
 */
export class IllustratedMapResourceHover {
  private readonly options: IllustratedMapResourceHoverOptions;
  private readonly anchors: readonly HTMLButtonElement[];
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private activeAnchor: HTMLButtonElement | null = null;

  constructor(options: IllustratedMapResourceHoverOptions) {
    this.options = options;
    this.anchors = Array.from(
      options.uiRoot.querySelectorAll<HTMLButtonElement>(RESOURCE_ANCHOR_SELECTOR),
    );
    options.domElement.addEventListener('pointermove', this.onPointerMove);
    options.domElement.addEventListener('pointerleave', this.onPointerLeave);
    options.uiRoot.ownerDocument.defaultView?.addEventListener('blur', this.onWindowBlur);
  }

  update(): void {
    if (
      !this.pointerInside
      || !this.options.isActive()
      || this.options.isBlocked()
    ) {
      this.setActiveAnchor(null);
      return;
    }

    let closest: HTMLButtonElement | null = null;
    let closestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const anchor of this.anchors) {
      if (anchor.hidden) continue;
      const projectedDistanceSquared = projectedMapButtonHitDistanceSquared(
        anchor,
        this.pointerX,
        this.pointerY,
      );
      if (projectedDistanceSquared === null) continue;
      if (projectedDistanceSquared !== undefined) {
        if (projectedDistanceSquared < closestDistanceSquared) {
          closest = anchor;
          closestDistanceSquared = projectedDistanceSquared;
        }
        continue;
      }

      // Fallback for synthetic/test anchors. Production illustrated-map
      // anchors always use the cached projection bounds above.
      const rect = anchor.getBoundingClientRect();
      if (
        this.pointerX < rect.left
        || this.pointerX > rect.right
        || this.pointerY < rect.top
        || this.pointerY > rect.bottom
      ) continue;
      const dx = this.pointerX - (rect.left + rect.right) * 0.5;
      const dy = this.pointerY - (rect.top + rect.bottom) * 0.5;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < closestDistanceSquared) {
        closest = anchor;
        closestDistanceSquared = distanceSquared;
      }
    }

    if (closest === this.activeAnchor) {
      if (closest) {
        this.options.uiRoot.dispatchEvent(new Event(UI_TOOLTIP_REPOSITION_EVENT));
      }
      return;
    }
    this.setActiveAnchor(closest);
  }

  dispose(): void {
    this.setActiveAnchor(null);
    this.options.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.options.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.options.uiRoot.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.pointerInside = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.setActiveAnchor(null);
  };

  private readonly onWindowBlur = (): void => {
    this.pointerInside = false;
    this.setActiveAnchor(null);
  };

  private setActiveAnchor(next: HTMLButtonElement | null): void {
    if (next === this.activeAnchor) return;
    const previous = this.activeAnchor;
    this.activeAnchor = next;
    const MouseEventConstructor = this.options.uiRoot.ownerDocument.defaultView?.MouseEvent
      ?? MouseEvent;
    if (previous) {
      previous.dispatchEvent(new MouseEventConstructor('mouseout', {
        bubbles: true,
        relatedTarget: next,
      }));
    }
    if (next) {
      next.dispatchEvent(new MouseEventConstructor('mouseover', {
        bubbles: true,
        relatedTarget: previous,
      }));
    }
  }
}
