import {
  formatDuration,
  formatLocal,
  formatOffset,
  fromLocalParts,
  seasonDates,
  setLocalCivilTime,
  setLocalDate,
  shadowLength,
  solarPosition,
  sunTimes,
  toLocalParts,
} from '../astro/sun';
import {
  requestLookAtSun,
  setDatetime,
  setLocation,
  setPlaySpeed,
  setShowAnalemma,
  setShowSeasonPaths,
  setTrackSun,
  state,
  subscribe,
} from '../state';
import type { PlaySpeed } from '../state';

const LAT_PRESETS: { label: string; lat: number }[] = [
  { label: 'Equator', lat: 0 },
  { label: 'Tropic 23°', lat: 23.4 },
  { label: '40°N', lat: 40 },
  { label: 'London 51°', lat: 51.5 },
  { label: 'Arctic 66°', lat: 66.5 },
];

export function createControls(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="panel-header">
      <h1>SunVisualizer</h1>
      <button type="button" class="collapse-btn" id="toggle-panel" aria-label="Toggle controls">▾</button>
    </div>
    <div class="panel-body" id="panel-body">
      <p class="purpose">
        Watch the <strong>sun’s path across your sky</strong>, and how the
        <strong>up↔sun angle</strong> on the globe opens and closes as Earth turns.
      </p>

      <section class="hero-readout">
        <div>
          <span>Zenith angle (up↔sun)</span>
          <strong id="r-zen">—</strong>
        </div>
        <div>
          <span>Elevation (sky)</span>
          <strong id="r-el">—</strong>
        </div>
      </section>

      <section>
        <label>Location <span id="latlon" class="mono"></span></label>
        <div class="row">
          <button type="button" id="geo-btn">Use my location</button>
          <button type="button" id="now-btn">Now</button>
        </div>
        <div class="row seasons" id="lat-presets"></div>
        <p class="hint">Tap the globe, or jump latitude — sun arcs reshape with lat. Clock uses the zone’s DST.</p>
      </section>

      <section>
        <label>Date</label>
        <input type="date" id="date-input" />
        <div class="row seasons">
          <button type="button" data-season="marEquinox">Mar equinox</button>
          <button type="button" data-season="junSolstice">Jun solstice</button>
          <button type="button" data-season="sepEquinox">Sep equinox</button>
          <button type="button" data-season="decSolstice">Dec solstice</button>
        </div>
      </section>

      <section>
        <label>Local time <span id="tz-label" class="mono"></span> <span id="time-label" class="mono"></span></label>
        <input type="range" id="time-slider" min="0" max="1439" step="1" />
        <div class="row shortcuts">
          <button type="button" id="btn-sunrise">Sunrise</button>
          <button type="button" id="btn-noon">Solar noon</button>
          <button type="button" id="btn-sunset">Sunset</button>
        </div>
      </section>

      <section class="readouts">
        <div><span>Azimuth</span><strong id="r-az">—</strong></div>
        <div><span>Day length</span><strong id="r-day">—</strong></div>
        <div><span>Sunrise</span><strong id="r-rise">—</strong></div>
        <div><span>Sunset</span><strong id="r-set">—</strong></div>
        <div><span>Shadow</span><strong id="r-shadow">—</strong></div>
        <div><span>Declination</span><strong id="r-decl">—</strong></div>
      </section>

      <section>
        <label class="check tip">
          <input type="checkbox" id="season-paths" checked />
          <span>
            Season sun paths
            <span class="tip-mark" tabindex="0" aria-label="What are season sun paths?">?</span>
            <span class="tip-bubble" role="tooltip">
              In the Surface sky: three colored arcs for the same place — June’s high
              path, December’s low path, and the middle path at equinox — so you can
              compare how the sun’s daily track changes with the seasons.
            </span>
          </span>
        </label>
        <label class="check tip">
          <input type="checkbox" id="analemma" />
          <span>
            Analemma (purple figure‑8)
            <span class="tip-mark" tabindex="0" aria-label="What is an analemma?">?</span>
            <span class="tip-bubble" role="tooltip">
              Looks at the Surface sky. Set the clock near noon, then tick this.
              A purple figure‑8 appears: where the sun sits at that same clock time
              on every day of the year. Turn off “Lock camera to sun” and look around
              to see the whole loop.
            </span>
          </span>
        </label>
      </section>

      <section class="legend">
        <div><i class="swatch up"></i> Up (zenith)</div>
        <div><i class="swatch sun"></i> Toward sun</div>
        <div><i class="swatch angle"></i> Zenith angle wedge</div>
        <div><i class="swatch axis"></i> Polar axis (spin)</div>
        <div><i class="swatch ecliptic"></i> Ecliptic (orbit plane)</div>
        <div><i class="swatch equator"></i> Equator — sun overhead at equinox</div>
        <div><i class="swatch cancer"></i> Tropic of Cancer — sun overhead at Jun solstice</div>
        <div><i class="swatch capricorn"></i> Tropic of Capricorn — sun overhead at Dec solstice</div>
        <p class="hint">
          Between the tropics the noon sun can pass straight overhead — that’s where
          peak sunlight (and heat) happens. Outside them the sun never reaches zenith.
        </p>
        <div><i class="swatch path-today"></i> Today’s path</div>
        <div><i class="swatch path-jun"></i> Jun solstice path</div>
        <div><i class="swatch path-equ"></i> Equinox path</div>
        <div><i class="swatch path-dec"></i> Dec solstice path</div>
      </section>
    </div>
  `;

  const presets = root.querySelector('#lat-presets')!;
  for (const p of LAT_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      setLocation(p.lat, state.lon);
      requestLookAtSun();
    });
    presets.appendChild(b);
  }

  const $ = <T extends HTMLElement>(id: string) => root.querySelector('#' + id) as T;
  const dateInput = $<HTMLInputElement>('date-input');
  const timeSlider = $<HTMLInputElement>('time-slider');
  const analemma = $<HTMLInputElement>('analemma');
  const seasonPaths = $<HTMLInputElement>('season-paths');
  const trackSun = document.querySelector('#track-sun') as HTMLInputElement;
  const speeds = document.querySelector('#speeds') as HTMLElement;
  const panelBody = $('panel-body');
  const toggleBtn = $('toggle-panel');

  let syncing = false;
  const pad = (n: number) => String(n).padStart(2, '0');

  function refresh(): void {
    syncing = true;
    const d = state.datetime;
    const loc = toLocalParts(d, state.lat, state.lon);
    dateInput.value = `${loc.y}-${pad(loc.mo)}-${pad(loc.day)}`;
    timeSlider.value = String(loc.h * 60 + loc.m);
    $('time-label').textContent = `${pad(loc.h)}:${pad(loc.m)}`;
    $('tz-label').textContent = `(${formatOffset(d, state.lat, state.lon)})`;
    $('latlon').textContent = `${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}°`;

    const pos = solarPosition(state.lat, state.lon, d);
    const times = sunTimes(state.lat, state.lon, d);
    $('r-el').textContent = `${pos.elevation.toFixed(1)}°`;
    $('r-az').textContent = `${pos.azimuth.toFixed(1)}°`;
    $('r-zen').textContent = `${pos.zenith.toFixed(1)}°`;
    $('r-day').textContent = formatDuration(times.dayLengthHours);
    $('r-rise').textContent = times.sunrise
      ? formatLocal(times.sunrise, state.lat, state.lon)
      : '—';
    $('r-set').textContent = times.sunset
      ? formatLocal(times.sunset, state.lat, state.lon)
      : '—';
    $('r-decl').textContent = `${pos.declination.toFixed(2)}°`;
    const sh = shadowLength(pos.elevation);
    $('r-shadow').textContent = sh == null ? '∞ / night' : `${sh.toFixed(2)}×`;

    speeds.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === state.playSpeed);
    });
    analemma.checked = state.showAnalemma;
    seasonPaths.checked = state.showSeasonPaths;
    trackSun.checked = state.trackSun;
    syncing = false;
  }

  dateInput.addEventListener('change', () => {
    if (syncing) return;
    const [y, mo, day] = dateInput.value.split('-').map(Number);
    setDatetime(setLocalDate(state.datetime, state.lat, state.lon, y, mo, day));
  });

  timeSlider.addEventListener('input', () => {
    if (syncing) return;
    const mins = Number(timeSlider.value);
    setDatetime(
      setLocalCivilTime(state.datetime, state.lat, state.lon, Math.floor(mins / 60), mins % 60),
    );
  });

  $('btn-sunrise').addEventListener('click', () => {
    const t = sunTimes(state.lat, state.lon, state.datetime).sunrise;
    if (t) {
      setDatetime(t);
      requestLookAtSun();
    }
  });
  $('btn-noon').addEventListener('click', () => {
    setDatetime(sunTimes(state.lat, state.lon, state.datetime).solarNoon);
    requestLookAtSun();
  });
  $('btn-sunset').addEventListener('click', () => {
    const t = sunTimes(state.lat, state.lon, state.datetime).sunset;
    if (t) {
      setDatetime(t);
      requestLookAtSun();
    }
  });

  speeds.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.addEventListener('click', () => setPlaySpeed(Number(b.dataset.speed) as PlaySpeed));
  });

  root.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.season as keyof ReturnType<typeof seasonDates>;
      const p = toLocalParts(state.datetime, state.lat, state.lon);
      const seasons = seasonDates(p.y);
      const sp = toLocalParts(seasons[key], state.lat, state.lon);
      setDatetime(fromLocalParts(state.lat, state.lon, sp.y, sp.mo, sp.day, p.h, p.m));
    });
  });

  analemma.addEventListener('change', () => {
    setShowAnalemma(analemma.checked);
    // Unlock sun-cam so the full figure-8 is visible in the sky view
    if (analemma.checked) setTrackSun(false);
  });
  seasonPaths.addEventListener('change', () => setShowSeasonPaths(seasonPaths.checked));
  trackSun.addEventListener('change', () => setTrackSun(trackSun.checked));
  $('now-btn').addEventListener('click', () => setDatetime(new Date()));

  $('geo-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation(pos.coords.latitude, pos.coords.longitude);
        setDatetime(new Date());
        requestLookAtSun();
      },
      () => alert('Could not get location'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  toggleBtn.addEventListener('click', () => {
    panelBody.classList.toggle('hidden');
    const collapsed = panelBody.classList.contains('hidden');
    toggleBtn.textContent = collapsed ? '▸' : '▾';
    root.classList.toggle('collapsed', collapsed);
    window.dispatchEvent(new Event('resize'));
  });

  const unsub = subscribe(refresh);
  refresh();
  return unsub;
}
