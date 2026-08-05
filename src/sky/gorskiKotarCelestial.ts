import {
  j2000ToEpochPrecessionMatrix,
  transposePrecessionMatrix,
} from './celestialPrecession.ts';

/** Astronomical presentation anchor for the canonical Gorski Kotar world. */
export const GORSKI_KOTAR_LATITUDE_DEG = 45.6;
export const GORSKI_KOTAR_LONGITUDE_DEG = 14.9;
export const GORSKI_KOTAR_CELESTIAL_EPOCH = 1550;

/** Converts an epoch-1550 equatorial ray back to Eanpa's J2000 Tycho atlas. */
export const GORSKI_KOTAR_1550_TO_J2000_PRECESSION = transposePrecessionMatrix(
  j2000ToEpochPrecessionMatrix(GORSKI_KOTAR_CELESTIAL_EPOCH),
);

/**
 * Julian day at 00:00 UT on 1 January 1550 in the historical Julian calendar.
 * The value is calculated instead of rounded so sidereal rotation remains
 * deterministic when calendar/time tests use fractional days.
 */
export const GORSKI_KOTAR_EPOCH_JULIAN_DAY = julianCalendarDay(
  GORSKI_KOTAR_CELESTIAL_EPOCH,
  1,
  1,
);

function julianCalendarDay(year: number, month: number, day: number): number {
  let adjustedYear = year;
  let adjustedMonth = month;
  if (adjustedMonth <= 2) {
    adjustedYear -= 1;
    adjustedMonth += 12;
  }
  return Math.floor(365.25 * (adjustedYear + 4716))
    + Math.floor(30.6001 * (adjustedMonth + 1))
    + day
    - 1524.5;
}
