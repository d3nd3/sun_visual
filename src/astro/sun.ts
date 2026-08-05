/** Solar / Earth astronomy helpers (NOAA-style approximations). */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
export const OBLIQUITY = 23.43928;
const REFRACTION = -0.833; // sunrise/sunset solar elevation deg

export interface SunPos {
  elevation: number; // deg above horizon
  azimuth: number; // deg from N, clockwise
  zenith: number; // deg from zenith
  declination: number;
  equationOfTime: number; // minutes
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  dayLengthHours: number;
}

function julianDay(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

function julianCentury(jd: number): number {
  return (jd - 2451545) / 36525;
}

/** Geom mean lon, anomaly, ecc, etc. → declination + EoT */
function sunParams(date: Date): { decl: number; eot: number; ra: number } {
  const T = julianCentury(julianDay(date));
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * DEG) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * DEG) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const eps0 =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);
  const sinDecl = Math.sin(eps * DEG) * Math.sin(lambda * DEG);
  const decl = Math.asin(sinDecl) * RAD;
  const y = Math.tan((eps * DEG) / 2) ** 2;
  const eot =
    4 *
    RAD *
    (y * Math.sin(2 * L0 * DEG) -
      2 * e * Math.sin(M * DEG) +
      4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG) -
      0.5 * y * y * Math.sin(4 * L0 * DEG) -
      1.25 * e * e * Math.sin(2 * M * DEG));
  const ra =
    Math.atan2(
      Math.cos(eps * DEG) * Math.sin(lambda * DEG),
      Math.cos(lambda * DEG),
    ) * RAD;
  return { decl, eot, ra };
}

function utcHours(d: Date): number {
  return (
    d.getUTCHours() +
    d.getUTCMinutes() / 60 +
    d.getUTCSeconds() / 3600 +
    d.getUTCMilliseconds() / 3600000
  );
}

/** True solar time offset minutes at longitude */
function solarTimeMinutes(date: Date, lon: number, eot: number): number {
  return utcHours(date) * 60 + eot + 4 * lon;
}

export function solarPosition(lat: number, lon: number, date: Date): SunPos {
  const { decl, eot } = sunParams(date);
  const st = solarTimeMinutes(date, lon, eot);
  const hourAngle = st / 4 - 180; // deg
  const cosZen =
    Math.sin(lat * DEG) * Math.sin(decl * DEG) +
    Math.cos(lat * DEG) * Math.cos(decl * DEG) * Math.cos(hourAngle * DEG);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZen))) * RAD;
  const elevation = 90 - zenith;
  const azY = -Math.sin(hourAngle * DEG);
  const azX =
    Math.tan(decl * DEG) * Math.cos(lat * DEG) -
    Math.sin(lat * DEG) * Math.cos(hourAngle * DEG);
  let azimuth = Math.atan2(azY, azX) * RAD;
  if (azimuth < 0) azimuth += 360;
  return { elevation, azimuth, zenith, declination: decl, equationOfTime: eot };
}

function hourAngleForElevation(
  lat: number,
  decl: number,
  elev: number,
): number | null {
  const cosH =
    (Math.sin(elev * DEG) - Math.sin(lat * DEG) * Math.sin(decl * DEG)) /
    (Math.cos(lat * DEG) * Math.cos(decl * DEG));
  if (cosH < -1 || cosH > 1) return null;
  return Math.acos(cosH) * RAD;
}

function dateAtUtcMinutes(base: Date, minutes: number): Date {
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
  d.setUTCMinutes(minutes);
  return d;
}

export function sunTimes(lat: number, lon: number, date: Date): SunTimes {
  const noonApprox = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );
  const { decl, eot } = sunParams(noonApprox);
  const noonMin = 720 - 4 * lon - eot; // UTC minutes from midnight
  const solarNoon = dateAtUtcMinutes(date, noonMin);
  const ha = hourAngleForElevation(lat, decl, REFRACTION);
  if (ha == null) {
    const alwaysUp = solarPosition(lat, lon, solarNoon).elevation > 0;
    return {
      sunrise: null,
      sunset: null,
      solarNoon,
      dayLengthHours: alwaysUp ? 24 : 0,
    };
  }
  const sunrise = dateAtUtcMinutes(date, noonMin - ha * 4);
  const sunset = dateAtUtcMinutes(date, noonMin + ha * 4);
  return {
    sunrise,
    sunset,
    solarNoon,
    dayLengthHours: (ha * 8) / 60,
  };
}

/** Unit vector toward the Sun in ECEF (x=prime meridian equator, z=north). */
export function sunDirectionECEF(date: Date): [number, number, number] {
  const { decl, eot } = sunParams(date);
  // Subsolar longitude: where hour angle is 0
  const st = utcHours(date) * 60 + eot; // at lon 0
  const subLon = -(st / 4 - 180); // deg east
  const subLat = decl;
  return latLonToECEF(subLat, subLon);
}

export function latLonToECEF(lat: number, lon: number): [number, number, number] {
  const φ = lat * DEG;
  const λ = lon * DEG;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

export function ecefToLatLon(
  x: number,
  y: number,
  z: number,
): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z) || 1;
  return {
    lat: Math.asin(z / r) * RAD,
    lon: Math.atan2(y, x) * RAD,
  };
}

/** Local ENU unit vectors at lat/lon in ECEF. */
export function enuBasis(lat: number, lon: number) {
  const [ex, ey, ez] = latLonToECEF(lat, lon);
  const up: [number, number, number] = [ex, ey, ez];
  const east: [number, number, number] = [-Math.sin(lon * DEG), Math.cos(lon * DEG), 0];
  const north: [number, number, number] = [
    -Math.sin(lat * DEG) * Math.cos(lon * DEG),
    -Math.sin(lat * DEG) * Math.sin(lon * DEG),
    Math.cos(lat * DEG),
  ];
  return { east, north, up };
}

/** Sun direction in local ENU (unit). */
export function sunENU(lat: number, lon: number, date: Date): [number, number, number] {
  const { elevation, azimuth } = solarPosition(lat, lon, date);
  const el = elevation * DEG;
  const az = azimuth * DEG;
  const e = Math.sin(az) * Math.cos(el);
  const n = Math.cos(az) * Math.cos(el);
  const u = Math.sin(el);
  return [e, n, u];
}

export function shadowLength(elevationDeg: number): number | null {
  if (elevationDeg <= 0.05) return null;
  return 1 / Math.tan(elevationDeg * DEG);
}

export function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

/** Hours east of UTC from longitude (local mean solar time). */
export function lonOffsetHours(lon: number): number {
  return lon / 15;
}

export function formatOffset(lon: number): string {
  const h = lonOffsetHours(lon);
  const sign = h >= 0 ? '+' : '−';
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  return mm ? `UTC${sign}${hh}:${String(mm).padStart(2, '0')}` : `UTC${sign}${hh}`;
}

export interface LocalParts {
  y: number;
  mo: number; // 1-12
  day: number;
  h: number;
  m: number;
  s: number;
}

/** Split an instant into local mean-solar calendar parts at lon. */
export function toLocalParts(date: Date, lon: number): LocalParts {
  const local = new Date(date.getTime() + lonOffsetHours(lon) * 3600000);
  return {
    y: local.getUTCFullYear(),
    mo: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    h: local.getUTCHours(),
    m: local.getUTCMinutes(),
    s: local.getUTCSeconds(),
  };
}

/** Build UTC instant from local mean-solar parts at lon. */
export function fromLocalParts(
  lon: number,
  y: number,
  mo: number,
  day: number,
  h: number,
  m: number,
  s = 0,
): Date {
  return new Date(Date.UTC(y, mo - 1, day, h, m, s) - lonOffsetHours(lon) * 3600000);
}

export function formatLocal(d: Date, lon: number): string {
  const { h, m } = toLocalParts(d, lon);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function localCivilTime(d: Date, lon: number): { h: number; m: number; s: number } {
  const p = toLocalParts(d, lon);
  return { h: p.h, m: p.m, s: p.s };
}

/** Set local clock time, keeping the local calendar date. */
export function setLocalCivilTime(base: Date, lon: number, h: number, m: number): Date {
  const p = toLocalParts(base, lon);
  return fromLocalParts(lon, p.y, p.mo, p.day, h, m);
}

/** Set local calendar date, keeping the local clock time. */
export function setLocalDate(base: Date, lon: number, y: number, mo: number, day: number): Date {
  const p = toLocalParts(base, lon);
  return fromLocalParts(lon, y, mo, day, p.h, p.m, p.s);
}

/** Approximate equinox/solstice UTC dates for a year. */
export function seasonDates(year: number): {
  marEquinox: Date;
  junSolstice: Date;
  sepEquinox: Date;
  decSolstice: Date;
} {
  return {
    marEquinox: new Date(Date.UTC(year, 2, 20, 12)),
    junSolstice: new Date(Date.UTC(year, 5, 21, 12)),
    sepEquinox: new Date(Date.UTC(year, 8, 22, 12)),
    decSolstice: new Date(Date.UTC(year, 11, 21, 12)),
  };
}
