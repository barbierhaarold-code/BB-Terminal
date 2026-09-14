// Day/night terminator — pure astronomical calculation, no external API.
//
// The terminator is (to an excellent approximation, ignoring atmospheric
// refraction and the sun's finite disc) the set of points exactly 90° of
// angular distance from the subsolar point — the point on Earth where the
// sun is directly overhead. So the approach is: (1) find the subsolar
// point's declination and longitude for the given instant using standard
// low-precision solar position formulas, then (2) for every meridian, solve
// for the latitude at which that meridian crosses the terminator, and close
// the resulting curve into a polygon at whichever pole is in permanent
// night — the pole opposite the subsolar hemisphere.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86400000;
const UNIX_EPOCH_JULIAN_DAY = 2440588;
const J2000_JULIAN_DAY = 2451545;
const OBLIQUITY_OF_ECLIPTIC = 23.4397 * RAD;

function daysSinceJ2000(date: Date): number {
  const julianDay = date.getTime() / MS_PER_DAY - 0.5 + UNIX_EPOCH_JULIAN_DAY;
  return julianDay - J2000_JULIAN_DAY;
}

export interface SunPosition {
  /** Latitude of the subsolar point, in degrees. */
  declinationDeg: number;
  /** Longitude of the subsolar point, in degrees, normalized to [-180, 180]. */
  subsolarLonDeg: number;
}

/** Subsolar point for a given instant. Accurate to well under a degree — plenty for a terminator that redraws every few minutes. */
export function sunPosition(date: Date): SunPosition {
  const d = daysSinceJ2000(date);

  const meanAnomaly = RAD * (357.5291 + 0.98560028 * d);
  const centerCorrection =
    RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
  const perihelionOfEarth = RAD * 102.9372;
  const eclipticLon = meanAnomaly + centerCorrection + perihelionOfEarth + Math.PI;

  const declination = Math.asin(Math.sin(OBLIQUITY_OF_ECLIPTIC) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(
    Math.sin(eclipticLon) * Math.cos(OBLIQUITY_OF_ECLIPTIC),
    Math.cos(eclipticLon)
  );
  const greenwichMeanSiderealTime = RAD * (280.16 + 360.9856235 * d);

  const subsolarLonRad = rightAscension - greenwichMeanSiderealTime;
  const subsolarLonDeg = (((subsolarLonRad * DEG + 180) % 360) + 360) % 360 - 180;

  return { declinationDeg: declination * DEG, subsolarLonDeg };
}

/**
 * Night-side polygon (as [lat, lon] pairs) for the given instant, suitable
 * for a Leaflet Polygon. Sweeps longitude in `stepDeg` increments, solves
 * tan(latTerminator) = -cos(hourAngle) / tan(declination) at each meridian,
 * then closes the ring along the night pole.
 */
export function terminatorPolygon(date: Date, stepDeg = 2): [number, number][] {
  const { declinationDeg, subsolarLonDeg } = sunPosition(date);
  const decRad = declinationDeg * RAD;
  const tanDec = Math.tan(decRad) || 1e-9; // guard the literal-zero-declination instant (equinox)

  const points: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const hourAngle = (lon - subsolarLonDeg) * RAD;
    const lat = Math.atan(-Math.cos(hourAngle) / tanDec) * DEG;
    points.push([lat, lon]);
  }

  const nightPoleLat = declinationDeg >= 0 ? -90 : 90;
  points.push([nightPoleLat, 180]);
  points.push([nightPoleLat, -180]);
  return points;
}
