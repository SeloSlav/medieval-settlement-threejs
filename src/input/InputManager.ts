export class InputManager {
  private readonly domElement: HTMLElement;
  private readonly keys = new Set<string>();
  private pointerX = 0;
  private pointerY = 0;

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    domElement.addEventListener('pointermove', this.onPointerMove);
  }

  isDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  getPointer(): { x: number; y: number } {
    return { x: this.pointerX, y: this.pointerY };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.keys.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    this.keys.add(event.key.toLowerCase());
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onWindowBlur = (): void => {
    this.keys.clear();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.keys.clear();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
  };
}

