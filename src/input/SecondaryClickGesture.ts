const DEFAULT_DRAG_THRESHOLD_PX = 5;

type SecondaryClickGestureOptions = {
  onClick: (event: MouseEvent) => void;
  dragThresholdPx?: number;
};

/**
 * Keeps the secondary mouse button available to the camera while preserving a
 * stationary right-click as a tool action. Call begin from the owning
 * mousedown handler; movement and release are tracked at window scope so a
 * drag can safely leave the canvas.
 */
export class SecondaryClickGesture {
  private readonly options: SecondaryClickGestureOptions;
  private readonly dragThresholdSquared: number;
  private tracking = false;
  private dragged = false;
  private startX = 0;
  private startY = 0;

  constructor(options: SecondaryClickGestureOptions) {
    this.options = options;
    const threshold = Math.max(0, options.dragThresholdPx ?? DEFAULT_DRAG_THRESHOLD_PX);
    this.dragThresholdSquared = threshold * threshold;
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  begin(event: MouseEvent): boolean {
    if (event.button !== 2) return false;
    this.tracking = true;
    this.dragged = false;
    this.startX = event.clientX;
    this.startY = event.clientY;
    return true;
  }

  cancel(): void {
    this.tracking = false;
    this.dragged = false;
  }

  dispose(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.cancel();
  }

  private updateDragState(clientX: number, clientY: number): void {
    if (this.dragged) return;
    const dx = clientX - this.startX;
    const dy = clientY - this.startY;
    this.dragged = dx * dx + dy * dy > this.dragThresholdSquared;
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.tracking) return;
    if ((event.buttons & 2) === 0) {
      this.cancel();
      return;
    }
    this.updateDragState(event.clientX, event.clientY);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.tracking || event.button !== 2) return;
    this.updateDragState(event.clientX, event.clientY);
    const wasClick = !this.dragged;
    this.cancel();
    if (wasClick) this.options.onClick(event);
  };

  private readonly onWindowBlur = (): void => {
    this.cancel();
  };
}
