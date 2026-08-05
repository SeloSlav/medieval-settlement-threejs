const CATALOG_EPOCH = 2000;
const DEG_TO_RAD = Math.PI / 180;
const ARCSEC_TO_RAD = DEG_TO_RAD / 3600;

export type EquatorialCoordinate = {
  rightAscensionDeg: number;
  declinationDeg: number;
};

export type Matrix3RowMajor = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** Precesses a J2000 equatorial coordinate to a historical visual epoch. */
export function precessEquatorialCoordinate(
  rightAscensionDeg: number,
  declinationDeg: number,
  targetEpoch: number,
): EquatorialCoordinate {
  if (targetEpoch === CATALOG_EPOCH) {
    return { rightAscensionDeg: wrapDegrees(rightAscensionDeg), declinationDeg };
  }

  // IAU 1976/Meeus precession is amply accurate for a visual 16th-century sky.
  const centuries = (targetEpoch - CATALOG_EPOCH) / 100;
  const centuriesSquared = centuries * centuries;
  const centuriesCubed = centuriesSquared * centuries;
  const zeta = (
    2306.2181 * centuries
    + 0.30188 * centuriesSquared
    + 0.017998 * centuriesCubed
  ) * ARCSEC_TO_RAD;
  const z = (
    2306.2181 * centuries
    + 1.09468 * centuriesSquared
    + 0.018203 * centuriesCubed
  ) * ARCSEC_TO_RAD;
  const theta = (
    2004.3109 * centuries
    - 0.42665 * centuriesSquared
    - 0.041833 * centuriesCubed
  ) * ARCSEC_TO_RAD;
  const rightAscension = rightAscensionDeg * DEG_TO_RAD;
  const declination = declinationDeg * DEG_TO_RAD;
  const shiftedRightAscension = rightAscension + zeta;
  const cosDeclination = Math.cos(declination);
  const a = cosDeclination * Math.sin(shiftedRightAscension);
  const b = Math.cos(theta) * cosDeclination * Math.cos(shiftedRightAscension)
    - Math.sin(theta) * Math.sin(declination);
  const c = Math.sin(theta) * cosDeclination * Math.cos(shiftedRightAscension)
    + Math.cos(theta) * Math.sin(declination);

  return {
    rightAscensionDeg: wrapDegrees((Math.atan2(a, b) + z) / DEG_TO_RAD),
    declinationDeg: Math.asin(clamp(c, -1, 1)) / DEG_TO_RAD,
  };
}

/** Rotation taking a J2000 equatorial unit vector into the requested epoch. */
export function j2000ToEpochPrecessionMatrix(targetEpoch: number): Matrix3RowMajor {
  const x = equatorialVector(precessEquatorialCoordinate(0, 0, targetEpoch));
  const y = equatorialVector(precessEquatorialCoordinate(0, 90, targetEpoch));
  const z = equatorialVector(precessEquatorialCoordinate(90, 0, targetEpoch));
  return [
    x[0], y[0], z[0],
    x[1], y[1], z[1],
    x[2], y[2], z[2],
  ];
}

/** Inverse of a pure precession rotation. */
export function transposePrecessionMatrix(matrix: Matrix3RowMajor): Matrix3RowMajor {
  return [
    matrix[0], matrix[3], matrix[6],
    matrix[1], matrix[4], matrix[7],
    matrix[2], matrix[5], matrix[8],
  ];
}

function equatorialVector(
  coordinate: EquatorialCoordinate,
): readonly [number, number, number] {
  const rightAscension = coordinate.rightAscensionDeg * DEG_TO_RAD;
  const declination = coordinate.declinationDeg * DEG_TO_RAD;
  const cosDeclination = Math.cos(declination);
  return [
    cosDeclination * Math.cos(rightAscension),
    Math.sin(declination),
    cosDeclination * Math.sin(rightAscension),
  ];
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
