export type ResourceStockBand = 'unknown' | 'abundant' | 'steady' | 'low' | 'empty';

export type ResourceStockRingPresentation = {
  fraction: number;
  angleDegrees: number;
  band: ResourceStockBand;
};

type ResourceStock = {
  remaining: number;
  maxYield: number;
};

type ResourceStockRingOptions = {
  /** Rich geology drops the finite surface ring once only its deep source remains. */
  hideWhenEmpty?: boolean;
};

/**
 * Converts authoritative stock into the shared circular marker language.
 * The arc begins at twelve o'clock and its trailing edge retreats
 * counter-clockwise as stock falls.
 */
export function resourceStockRingPresentation(
  stock: ResourceStock | null | undefined,
): ResourceStockRingPresentation {
  if (
    !stock
    || !Number.isFinite(stock.remaining)
    || !Number.isFinite(stock.maxYield)
    || stock.maxYield <= 0
  ) {
    return { fraction: 1, angleDegrees: 360, band: 'unknown' };
  }

  const fraction = Math.min(1, Math.max(0, stock.remaining / stock.maxYield));
  const band: ResourceStockBand = fraction <= 1e-6
    ? 'empty'
    : fraction <= 0.25
      ? 'low'
      : fraction <= 0.55
        ? 'steady'
        : 'abundant';
  return {
    fraction,
    angleDegrees: fraction * 360,
    band,
  };
}

/** Applies the ring without generating repeated style mutations each frame. */
export function syncResourceStockRing(
  element: HTMLElement,
  stock: ResourceStock | null | undefined,
  options: ResourceStockRingOptions = {},
): void {
  const presentation = resourceStockRingPresentation(stock);
  const angle = `${presentation.angleDegrees.toFixed(1)}deg`;
  if (element.style.getPropertyValue('--resource-stock-angle') !== angle) {
    element.style.setProperty('--resource-stock-angle', angle);
  }
  const displayedBand = options.hideWhenEmpty && presentation.band === 'empty'
    ? 'hidden'
    : presentation.band;
  if (element.dataset.resourceStock !== displayedBand) {
    element.dataset.resourceStock = displayedBand;
  }
}
