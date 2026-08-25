export const ILLUSTRATED_MAP_OPACITY_TRANSITION = Object.freeze({
  /** Roughly four frames at 60 Hz. */
  fadeOutMs: 70,
  /** Roughly five frames at 60 Hz. */
  fadeInMs: 85,
});

/**
 * Briefly dips the shared renderer canvas to transparent, commits the render
 * owner at zero opacity, then restores it. Both directions use the same path.
 */
export class IllustratedMapOpacityTransition {
  private readonly element: HTMLElement;
  private animation: Animation | null = null;
  private token = 0;
  private disposed = false;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  play(commitRenderOwner: () => void): () => void {
    if (this.disposed || typeof this.element.animate !== 'function') {
      commitRenderOwner();
      return () => undefined;
    }
    this.cancel();
    const token = ++this.token;
    this.element.style.willChange = 'opacity';
    const fadeOut = this.element.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: ILLUSTRATED_MAP_OPACITY_TRANSITION.fadeOutMs,
        easing: 'ease-out',
        fill: 'forwards',
      },
    );
    this.animation = fadeOut;
    fadeOut.onfinish = () => {
      if (this.disposed || token !== this.token) return;
      // Pin the transparent midpoint while the first animation is replaced.
      this.element.style.opacity = '0';
      fadeOut.cancel();
      commitRenderOwner();
      const fadeIn = this.element.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: ILLUSTRATED_MAP_OPACITY_TRANSITION.fadeInMs,
          easing: 'ease-in',
          fill: 'forwards',
        },
      );
      this.animation = fadeIn;
      fadeIn.onfinish = () => {
        if (this.disposed || token !== this.token) return;
        fadeIn.cancel();
        this.animation = null;
        this.element.style.opacity = '';
        this.element.style.willChange = '';
      };
    };
    return () => {
      if (token === this.token) this.cancel();
    };
  }

  cancel(): void {
    this.token += 1;
    this.animation?.cancel();
    this.animation = null;
    this.element.style.opacity = '';
    this.element.style.willChange = '';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }
}
