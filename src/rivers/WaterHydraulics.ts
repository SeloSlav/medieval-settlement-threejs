import { getRiverChannelRockContactRadius, type RiverChannelRockPlacement } from './RiverChannelRocks.ts';

/** Render-only velocity field, in metres/second. Does not change gameplay hydrology. */
export function deflectWaterAroundRock(
  vx: number, vz: number, x: number, z: number, rock: RiverChannelRockPlacement,
): readonly [number, number] {
  const dx = x - rock.x, dz = z - rock.z;
  const radius = getRiverChannelRockContactRadius(rock.scale);
  const r2 = dx * dx + dz * dz;
  if (r2 < radius * radius * 0.82) return [0, 0];
  // Potential flow around a cylinder: zero normal velocity at the contact,
  // stagnation at the nose, and accelerated flow at both shoulders.
  const safeR2 = Math.max(r2, radius * radius);
  const influence = radius * radius / safeR2;
  const radialDot = (vx * dx + vz * dz) / safeR2;
  let ux = vx * (1 + influence) - 2 * influence * radialDot * dx;
  let uz = vz * (1 + influence) - 2 * influence * radialDot * dz;
  const along = dx * rock.flowX + dz * rock.flowZ;
  const cross = -dx * rock.flowZ + dz * rock.flowX;
  // Dissipative lee shelter added to the inviscid solution. This is an authored
  // approximation, not a Navier–Stokes solver; the wake's foam owns its energy.
  const lee = Math.max(0, Math.min(1, along / radius))
    * Math.exp(-Math.max(0, along) / (radius * 3))
    * Math.exp(-((cross / (radius * 0.9)) ** 2));
  ux *= 1 - lee * 0.78;
  uz *= 1 - lee * 0.78;
  // A sheltered pair of lee eddies adds recirculation to the separated wake.
  // Derivatives of one local streamfunction keep this addition divergence
  // free. Its ramp and derivative both vanish at the rock's downstream pole,
  // preserving the impermeable contact boundary above.
  const q = Math.max(0, Math.min(1, along / radius - 1));
  const ramp = q * q * (3 - 2 * q);
  const rampDerivative = q > 0 && q < 1 ? 6 * q * (1 - q) / radius : 0;
  const alongSigma2 = (radius * 1.4) ** 2, crossSigma2 = (radius * 0.85) ** 2;
  const center = along - radius * 2.4;
  const eddy = 0.65 * Math.hypot(vx, vz) * Math.exp(-center * center / alongSigma2 - cross * cross / crossSigma2);
  const localU = -eddy * ramp * (1 - 2 * cross * cross / crossSigma2);
  const localW = eddy * cross * (rampDerivative - 2 * ramp * center / alongSigma2);
  ux += localU * rock.flowX - localW * rock.flowZ;
  uz += localU * rock.flowZ + localW * rock.flowX;
  const speed = Math.hypot(ux, uz);
  const limit = speed > 3.8 ? 3.8 / speed : 1;
  return [ux * limit, uz * limit];
}

export function waterBankVelocityScale(shoreDistance: number): number {
  const t = Math.max(0, Math.min(1, shoreDistance / 5));
  return 0.16 + 0.84 * Math.sqrt(t);
}
