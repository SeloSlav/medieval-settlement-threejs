type ProjectedButtonHitBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

const projectedButtonHitBounds = new WeakMap<HTMLButtonElement, ProjectedButtonHitBounds>();

export function setProjectedMapButtonHitBounds(
  button: HTMLButtonElement,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): void {
  const bounds = projectedButtonHitBounds.get(button) ?? {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    centerX: 0,
    centerY: 0,
  };
  bounds.left = centerX - width * 0.5;
  bounds.right = centerX + width * 0.5;
  bounds.top = centerY - height * 0.5;
  bounds.bottom = centerY + height * 0.5;
  bounds.centerX = centerX;
  bounds.centerY = centerY;
  projectedButtonHitBounds.set(button, bounds);
}

export function clearProjectedMapButtonHitBounds(button: HTMLButtonElement): void {
  projectedButtonHitBounds.delete(button);
}

export function projectedMapButtonHitDistanceSquared(
  button: HTMLButtonElement,
  clientX: number,
  clientY: number,
): number | null | undefined {
  const bounds = projectedButtonHitBounds.get(button);
  if (!bounds) return undefined;
  if (
    clientX < bounds.left
    || clientX > bounds.right
    || clientY < bounds.top
    || clientY > bounds.bottom
  ) return null;
  const dx = clientX - bounds.centerX;
  const dy = clientY - bounds.centerY;
  return dx * dx + dy * dy;
}
