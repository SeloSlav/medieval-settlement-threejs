export type MilitaryDeployment = { facingX: number; facingZ: number; frontage: number };

/** The drag draws the front rank; its perpendicular faces away from the troops. */
export function militaryDeploymentFromDrag(start: { x: number; z: number }, end: { x: number; z: number }, source: { x: number; z: number }): MilitaryDeployment & { x: number; z: number } {
  const x = (start.x + end.x) / 2;
  const z = (start.z + end.z) / 2;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  let facingX = length > 0.001 ? -dz / length : 0;
  let facingZ = length > 0.001 ? dx / length : 1;
  if (facingX * (x - source.x) + facingZ * (z - source.z) < 0) {
    facingX *= -1;
    facingZ *= -1;
  }
  return { x, z, facingX, facingZ, frontage: Math.max(0.5, Math.min(200, length)) };
}
