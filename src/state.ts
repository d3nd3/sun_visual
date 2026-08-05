export type PlaySpeed = 0 | 3600 | 10800 | 86400 | 604800;

export interface AppState {
  lat: number;
  lon: number;
  datetime: Date;
  playSpeed: PlaySpeed;
  showAnalemma: boolean;
  showSeasonPaths: boolean;
  trackSun: boolean;
  lookNonce: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();

export const state: AppState = {
  lat: 40.7,
  lon: -74.0,
  datetime: new Date(),
  playSpeed: 0,
  showAnalemma: false,
  showSeasonPaths: true,
  trackSun: true,
  lookNonce: 0,
};

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  listeners.forEach((fn) => fn());
}

export function setLocation(lat: number, lon: number): void {
  state.lat = clamp(lat, -90, 90);
  state.lon = ((lon + 180) % 360 + 360) % 360 - 180;
  notify();
}

export function setDatetime(d: Date): void {
  state.datetime = d;
  notify();
}

export function setPlaySpeed(s: PlaySpeed): void {
  state.playSpeed = s;
  notify();
}

export function setShowAnalemma(v: boolean): void {
  state.showAnalemma = v;
  notify();
}

export function setShowSeasonPaths(v: boolean): void {
  state.showSeasonPaths = v;
  notify();
}

export function setTrackSun(v: boolean): void {
  state.trackSun = v;
  notify();
}

export function requestLookAtSun(): void {
  state.lookNonce++;
  notify();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
