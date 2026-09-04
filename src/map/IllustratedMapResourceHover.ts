import { UI_TOOLTIP_REPOSITION_EVENT } from '../ui/tooltips.ts';
import { projectedMapButtonHitDistanceSquared } from './projectedMapButtonHitBounds.ts';

type IllustratedMapResourceHoverOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  isActive: () => boolean;
  isBlocked: () => boolean;
};

const MAP_TOOLTIP_ANCHOR_SELECTOR = [
  '.quarry-map-icon',
  '.foraging-map-icon',
  '.military-company-map-icon',
].join(', ');

/**
 * Keeps the renderer as the real pointer target so map wheel/orbit/pan input
 * remains uninterrupted, then mirrors hover onto the existing tooltip anchors.
 */
export class IllustratedMapResourceHover {
  private readonly options: IllustratedMapResourceHoverOptions;
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private activeAnchor: HTMLButtonElement | null = null;

  constructor(options: IllustratedMapResourceHoverOptions) {
    this.options = options;
    options.domElement.addEventListener('pointermove', this.onPointerMove);
    options.domElement.addEventListener('pointerleave', this.onPointerLeave);
    options.domElement.addEventListener('pointercancel', this.onPointerLeave);
    options.uiRoot.ownerDocument.addEventListener('visibilitychange', this.onVisibilityChange);
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
    // Resource anchors are mounted with the map UI, but military-company
    // anchors follow live simulation state and can appear after this helper is
    // constructed. Querying here keeps new bandit companies hoverable too.
    const anchors = this.options.uiRoot.querySelectorAll<HTMLButtonElement>(
      MAP_TOOLTIP_ANCHOR_SELECTOR,
    );
    for (const anchor of anchors) {
      if (!anchor.isConnected || anchor.closest('[hidden], [inert]')) continue;
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
    this.options.domElement.removeEventListener('pointercancel', this.onPointerLeave);
    this.options.uiRoot.ownerDocument.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.options.uiRoot.ownerDocument.defaultView?.removeEventListener('blur', this.onWindowBlur);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.pointerInside = true;
    // Respond at the stamp boundary without waiting for the next render frame.
    // update() still runs each frame for camera movement under a still cursor.
    this.update();
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.setActiveAnchor(null);
  };

  private readonly onWindowBlur = (): void => {
    this.onPointerLeave();
  };

  private readonly onVisibilityChange = (): void => {
    if (this.options.uiRoot.ownerDocument.hidden) this.onPointerLeave();
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
        clientX: this.pointerX,
        clientY: this.pointerY,
      }));
    }
    if (next) {
      next.dispatchEvent(new MouseEventConstructor('mouseover', {
        bubbles: true,
        relatedTarget: previous,
        clientX: this.pointerX,
        clientY: this.pointerY,
      }));
    }
  }
}
