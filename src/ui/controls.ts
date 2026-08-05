import {
  formatDuration,
  formatLocal,
  localCivilTime,
  seasonDates,
  setLocalCivilTime,
  shadowLength,
  solarPosition,
  sunTimes,
} from '../astro/sun';
import {
  setDatetime,
  setLocation,
  setPlaySpeed,
  setShowAnalemma,
  requestLookAtSun,
  state,
  subscribe,
} from '../state';
import type { PlaySpeed } from '../state';

export function createControls(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="panel-header">
      <h1>SunVisualizer</h1>
      <button type="button" class="collapse-btn" id="toggle-panel" aria-label="Toggle controls">▾</button>
    </div>
    <div class="panel-body" id="panel-body">
      <section>
        <label>Location <span id="latlon" class="mono"></span></label>
        <div class="row">
          <button type="button" id="geo-btn">Use my location</button>
        </div>
        <p class="hint">Tap the globe to set your location.</p>
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
        <label>Local time (lon/15) <span id="time-label" class="mono"></span></label>
        <input type="range" id="time-slider" min="0" max="1439" step="1" />
        <div class="row shortcuts">
          <button type="button" id="btn-sunrise">Sunrise</button>
          <button type="button" id="btn-noon">Solar noon</button>
          <button type="button" id="btn-sunset">Sunset</button>
        </div>
      </section>

      <section>
        <label>Play speed</label>
        <div class="row speeds" id="speeds">
          <button type="button" data-speed="0">Pause</button>
          <button type="button" data-speed="1">1×</button>
          <button type="button" data-speed="10">10×</button>
          <button type="button" data-speed="60">60×</button>
          <button type="button" data-speed="86400">1 day/s</button>
        </div>
      </section>

      <section class="readouts">
        <div><span>Elevation</span><strong id="r-el">—</strong></div>
        <div><span>Azimuth</span><strong id="r-az">—</strong></div>
        <div><span>Zenith angle</span><strong id="r-zen">—</strong></div>
        <div><span>Day length</span><strong id="r-day">—</strong></div>
        <div><span>Sunrise</span><strong id="r-rise">—</strong></div>
        <div><span>Sunset</span><strong id="r-set">—</strong></div>
        <div><span>Shadow (unit stick)</span><strong id="r-shadow">—</strong></div>
        <div><span>Declination</span><strong id="r-decl">—</strong></div>
      </section>

      <section>
        <label class="check">
          <input type="checkbox" id="analemma" /> Show analemma (same clock time over year)
        </label>
      </section>

      <section class="legend">
        <div><i class="swatch up"></i> Up (zenith)</div>
        <div><i class="swatch sun"></i> Toward sun</div>
        <div><i class="swatch east"></i> East</div>
        <div><i class="swatch north"></i> North</div>
        <div><i class="swatch sub"></i> Subsolar point</div>
      </section>
    </div>
  `;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector('#' + id) as T;
  const dateInput = $<HTMLInputElement>('date-input');
  const timeSlider = $<HTMLInputElement>('time-slider');
  const analemma = $<HTMLInputElement>('analemma');
  const panelBody = $('panel-body');
  const toggleBtn = $('toggle-panel');

  let syncing = false;

  function pad(n: number) {
    return String(n).padStart(2, '0');
  }

  function refresh(): void {
    syncing = true;
    const d = state.datetime;
    dateInput.value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const { h, m } = localCivilTime(d, state.lon);
    timeSlider.value = String(h * 60 + m);
    $('time-label').textContent = `${pad(h)}:${pad(m)}`;
    $('latlon').textContent = `${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}°`;

    const pos = solarPosition(state.lat, state.lon, d);
    const times = sunTimes(state.lat, state.lon, d);
    $('r-el').textContent = `${pos.elevation.toFixed(1)}°`;
    $('r-az').textContent = `${pos.azimuth.toFixed(1)}°`;
    $('r-zen').textContent = `${pos.zenith.toFixed(1)}°`;
    $('r-day').textContent = formatDuration(times.dayLengthHours);
    $('r-rise').textContent = times.sunrise ? formatLocal(times.sunrise, state.lon) : '—';
    $('r-set').textContent = times.sunset ? formatLocal(times.sunset, state.lon) : '—';
    $('r-decl').textContent = `${pos.declination.toFixed(2)}°`;
    const sh = shadowLength(pos.elevation);
    $('r-shadow').textContent = sh == null ? '∞ / night' : `${sh.toFixed(2)}×`;

    root.querySelectorAll<HTMLButtonElement>('#speeds button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === state.playSpeed);
    });
    analemma.checked = state.showAnalemma;
    syncing = false;
  }

  dateInput.addEventListener('change', () => {
    if (syncing) return;
    const [y, mo, day] = dateInput.value.split('-').map(Number);
    const nd = new Date(state.datetime);
    nd.setUTCFullYear(y, mo - 1, day);
    setDatetime(nd);
  });

  timeSlider.addEventListener('input', () => {
    if (syncing) return;
    const mins = Number(timeSlider.value);
    setDatetime(setLocalCivilTime(state.datetime, state.lon, Math.floor(mins / 60), mins % 60));
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

  root.querySelectorAll<HTMLButtonElement>('#speeds button').forEach((b) => {
    b.addEventListener('click', () => setPlaySpeed(Number(b.dataset.speed) as PlaySpeed));
  });

  root.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.season as keyof ReturnType<typeof seasonDates>;
      const seasons = seasonDates(state.datetime.getUTCFullYear());
      const { h, m } = localCivilTime(state.datetime, state.lon);
      const nd = seasons[key];
      setDatetime(setLocalCivilTime(nd, state.lon, h, m));
    });
  });

  analemma.addEventListener('change', () => setShowAnalemma(analemma.checked));

  $('geo-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setLocation(p.coords.latitude, p.coords.longitude),
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
