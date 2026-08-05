import './styles.css';
import { state, notify } from './state';
import { createOrbitalView } from './views/orbital';
import { createSurfaceView } from './views/surface';
import { createControls } from './ui/controls';

const controlsEl = document.querySelector('#controls') as HTMLElement;
const orbitalEl = document.querySelector('#orbital-view') as HTMLElement;
const surfaceEl = document.querySelector('#surface-view') as HTMLElement;
const tabs = document.querySelector('#mobile-tabs') as HTMLElement;

createControls(controlsEl);
const orbital = createOrbitalView(orbitalEl);
const surface = createSurfaceView(surfaceEl);

function layout(): void {
  const o = orbitalEl.getBoundingClientRect();
  const s = surfaceEl.getBoundingClientRect();
  if (o.width > 0 && o.height > 0) orbital.resize(o.width, o.height);
  if (s.width > 0 && s.height > 0) surface.resize(s.width, s.height);
}

window.addEventListener('resize', layout);
layout();

tabs.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const v = btn.dataset.view;
    orbitalEl.classList.toggle('active-mobile', v === 'orbital');
    surfaceEl.classList.toggle('active-mobile', v === 'surface');
    requestAnimationFrame(layout);
  });
});

let last = performance.now();
let uiAcc = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.playSpeed > 0) {
    state.datetime = new Date(state.datetime.getTime() + state.playSpeed * dt * 1000);
    uiAcc += dt;
    if (uiAcc > 0.2) {
      uiAcc = 0;
      notify();
    }
  }
  orbital.render();
  surface.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(layout, 100);
