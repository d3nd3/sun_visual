import * as THREE from 'three';
import { fromLocalParts, seasonDates, solarPosition, sunENU, toLocalParts } from '../astro/sun';
import { state, subscribe } from '../state';

export interface SurfaceView {
  render: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

const PATH_R = 52;

export function createSurfaceView(container: HTMLElement): SurfaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
  camera.position.set(0, 0.12, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, {
    touchAction: 'none',
    width: '100%',
    height: '100%',
    display: 'block',
  });

  let yaw = Math.PI; // look south
  let pitch = 0.55; // elevated to see full arc

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(80, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        sunEl: { value: 0 },
        topColor: { value: new THREE.Color(0x1a3a7a) },
        bottomColor: { value: new THREE.Color(0xc8dcf0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float sunEl;
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          float day = smoothstep(-12.0, 8.0, sunEl);
          vec3 nightTop = vec3(0.01, 0.02, 0.06);
          vec3 nightBot = vec3(0.02, 0.04, 0.08);
          vec3 dayCol = mix(bottomColor, topColor, max(h, 0.0));
          vec3 nightCol = mix(nightBot, nightTop, max(h, 0.0));
          float twilight = (1.0 - smoothstep(0.0, 12.0, abs(sunEl))) * (1.0 - abs(h));
          vec3 col = mix(nightCol, dayCol, day);
          col = mix(col, vec3(1.0, 0.45, 0.15), twilight * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const θ = Math.random() * Math.PI * 2;
    const φ = Math.acos(Math.random());
    sp[i * 3] = 70 * Math.sin(φ) * Math.cos(θ);
    sp[i * 3 + 1] = 70 * Math.cos(φ);
    sp[i * 3 + 2] = 70 * Math.sin(φ) * Math.sin(θ);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.9 }),
  );
  scene.add(stars);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 48),
    new THREE.MeshBasicMaterial({ color: 0x152018, side: THREE.DoubleSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  const labelCanvas = (text: string, color: string, worldH = 2.2) => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = 'bold 64px sans-serif';
    ctx.font = font;
    const pad = 40;
    const tw = Math.ceil(ctx.measureText(text).width);
    c.width = Math.max(128, tw + pad * 2);
    c.height = 64 + pad;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, c.width / 2, c.height / 2);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }),
    );
    spr.scale.set(worldH * (c.width / c.height), worldH, 1);
    return spr;
  };

  // Elevation guide rings (30° / 60°) — altitude above horizon, not zenith
  for (const el of [30, 60]) {
    const rad = (el * Math.PI) / 180;
    const y = Math.sin(rad) * 16;
    const r = Math.cos(rad) * 16;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.06, r + 0.06, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    scene.add(ring);
    const elLabel = labelCanvas(`${el}° elev`, '#ccddee', 1.4);
    elLabel.position.set(0, y + 0.3, -r);
    scene.add(elLabel);
  }

  const horizon = new THREE.Mesh(
    new THREE.RingGeometry(18, 18.2, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    }),
  );
  horizon.rotation.x = -Math.PI / 2;
  scene.add(horizon);
  const horizonLabel = labelCanvas('horizon 0°', '#ffffff', 1.5);
  horizonLabel.position.set(0, 0.6, -18);
  scene.add(horizonLabel);

  for (const { t, az, col } of [
    { t: 'N', az: 0, col: '#ff6666' },
    { t: 'E', az: 90, col: '#88aaff' },
    { t: 'S', az: 180, col: '#ffffff' },
    { t: 'W', az: 270, col: '#88aaff' },
  ]) {
    const spr = labelCanvas(t, col);
    const rad = (az * Math.PI) / 180;
    spr.position.set(Math.sin(rad) * 17, 0.5, Math.cos(rad) * 17);
    scene.add(spr);
  }

  // Zenith = straight up (green). Zenith angle = angle from this line down to the sun.
  const zenithSpr = labelCanvas('UP', '#44ff88', 2.2);
  zenithSpr.position.set(0, 24, 0);
  scene.add(zenithSpr);
  const upRay = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.1, 0),
      new THREE.Vector3(0, 22, 0),
    ]),
    new THREE.LineBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.7 }),
  );
  scene.add(upRay);

  // Up arc = east → zenith → west (prime vertical). Flat E–W, not slanted like sun paths.
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const φ = (i / 64) * Math.PI; // 0 = east horizon, π/2 = zenith, π = west
      pts.push(new THREE.Vector3(Math.cos(φ), Math.sin(φ), 0).multiplyScalar(PATH_R));
    }
    scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.75 }),
      ),
    );
    const upArcLabel = labelCanvas('up arc (E→W)', '#44ff88', 2.2);
    upArcLabel.position.set(0, PATH_R * 1.08, 0);
    scene.add(upArcLabel);
  }

  const ARC_R = 18;
  const zenithArc = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xff8866 }),
  );
  scene.add(zenithArc);
  const zenithWedge = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xff6644,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  scene.add(zenithWedge);
  let zenithAngleLabel = labelCanvas('zenith 0°', '#ff8866', 2);
  zenithAngleLabel.userData.text = 'zenith 0°';
  scene.add(zenithAngleLabel);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
  );
  scene.add(sun);
  const sunHalo = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffaa40,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
  );
  scene.add(sunHalo);

  // Ray from observer to sun
  const sunBeam = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.85 }),
  );
  scene.add(sunBeam);

  const todayPath = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffdd55 }),
  );
  scene.add(todayPath);

  const traveledPath = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xff8800 }),
  );
  scene.add(traveledPath);

  const hourBeads = new THREE.Group();
  scene.add(hourBeads);

  const seasonGroup = new THREE.Group();
  scene.add(seasonGroup);
  const seasonLines = {
    jun: new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.85 }),
    ),
    equ: new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.7 }),
    ),
    dec: new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8888ff, transparent: true, opacity: 0.85 }),
    ),
  };
  seasonGroup.add(seasonLines.jun, seasonLines.equ, seasonLines.dec);
  const seasonLabels = {
    jun: labelCanvas('June (high sun)', '#ff6644', 2.2),
    equ: labelCanvas('Equinox', '#66ccff', 2.2),
    dec: labelCanvas('December (low sun)', '#8888ff', 2.2),
  };
  seasonGroup.add(seasonLabels.jun, seasonLabels.equ, seasonLabels.dec);

  const analemmaLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xdd99ff, transparent: true, opacity: 0.95 }),
  );
  scene.add(analemmaLine);
  const analemmaBeads = new THREE.Group();
  scene.add(analemmaBeads);
  let analemmaLabel = labelCanvas('analemma', '#dd99ff', 2.4);
  analemmaLabel.visible = false;
  scene.add(analemmaLabel);

  const legend = labelCanvas('today’s path', '#ffdd55', 2.5);
  legend.position.set(-14, 1.2, -14);
  scene.add(legend);

  function enuToThree(e: number, n: number, u: number, dist: number): THREE.Vector3 {
    return new THREE.Vector3(e, u, n).multiplyScalar(dist);
  }

  function peakOf(pts: THREE.Vector3[]): THREE.Vector3 | null {
    if (!pts.length) return null;
    let best = pts[0];
    for (const p of pts) if (p.y > best.y) best = p;
    return best.clone();
  }

  function sampleDayPath(lat: number, lon: number, day: Date, steps = 72): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const base = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    for (let i = 0; i <= steps; i++) {
      const d = new Date(base.getTime() + (i / steps) * 86400000);
      const [e, n, u] = sunENU(lat, lon, d);
      if (u > -0.02) pts.push(enuToThree(e, n, u, PATH_R));
    }
    return pts;
  }

  function rebuildPaths(): void {
    const today = sampleDayPath(state.lat, state.lon, state.datetime);
    todayPath.geometry.dispose();
    todayPath.geometry = new THREE.BufferGeometry().setFromPoints(today);

    while (hourBeads.children.length) {
      const c = hourBeads.children.pop()!;
      (c as THREE.Mesh).geometry?.dispose();
      hourBeads.remove(c);
    }
    const base = new Date(
      Date.UTC(state.datetime.getUTCFullYear(), state.datetime.getUTCMonth(), state.datetime.getUTCDate()),
    );
    for (let h = 0; h < 24; h += 2) {
      const d = new Date(base.getTime() + h * 3600000);
      const [e, n, u] = sunENU(state.lat, state.lon, d);
      if (u < 0.02) continue;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffee88 }),
      );
      bead.position.copy(enuToThree(e, n, u, PATH_R));
      hourBeads.add(bead);
    }

    seasonGroup.visible = state.showSeasonPaths;
    if (state.showSeasonPaths) {
      const y = state.datetime.getUTCFullYear();
      const seasons = seasonDates(y);
      const setSeason = (line: THREE.Line, spr: THREE.Sprite, day: Date) => {
        const pts = sampleDayPath(state.lat, state.lon, day);
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        const peak = peakOf(pts);
        spr.visible = !!peak;
        if (peak) spr.position.copy(peak).multiplyScalar(1.06);
      };
      setSeason(seasonLines.jun, seasonLabels.jun, seasons.junSolstice);
      setSeason(seasonLines.equ, seasonLabels.equ, seasons.marEquinox);
      setSeason(seasonLines.dec, seasonLabels.dec, seasons.decSolstice);
    }

    while (analemmaBeads.children.length) {
      const c = analemmaBeads.children.pop()!;
      (c as THREE.Mesh).geometry?.dispose();
      analemmaBeads.remove(c);
    }
    if (!state.showAnalemma) {
      analemmaLine.visible = false;
      analemmaLabel.visible = false;
      analemmaBeads.visible = false;
    } else {
      // Same local clock time each day → purple figure-8 in the sky
      const loc = toLocalParts(state.datetime, state.lat, state.lon);
      const pts: THREE.Vector3[] = [];
      for (let day = 0; day < 365; day += 2) {
        const d = fromLocalParts(state.lat, state.lon, loc.y, 1, 1 + day, loc.h, loc.m);
        const [e, n, u] = sunENU(state.lat, state.lon, d);
        pts.push(enuToThree(e, n, u, PATH_R - 1));
      }
      analemmaLine.geometry.dispose();
      analemmaLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      analemmaLine.visible = pts.length > 2;
      analemmaBeads.visible = true;
      for (let month = 0; month < 12; month++) {
        const d = fromLocalParts(state.lat, state.lon, loc.y, month + 1, 1, loc.h, loc.m);
        const [e, n, u] = sunENU(state.lat, state.lon, d);
        if (u < -0.05) continue;
        const bead = new THREE.Mesh(
          new THREE.SphereGeometry(0.55, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xeeaaff }),
        );
        bead.position.copy(enuToThree(e, n, u, PATH_R - 1));
        analemmaBeads.add(bead);
      }
      // Label near the highest above-horizon point
      const skyPts = pts.filter((p) => p.y > 0);
      const peak = peakOf(skyPts.length ? skyPts : pts);
      const clock = `${String(loc.h).padStart(2, '0')}:${String(loc.m).padStart(2, '0')}`;
      if (analemmaLabel.userData.clock !== clock) {
        scene.remove(analemmaLabel);
        (analemmaLabel.material as THREE.SpriteMaterial).map?.dispose();
        (analemmaLabel.material as THREE.Material).dispose();
        analemmaLabel = labelCanvas(`analemma @ ${clock}`, '#dd99ff', 2.4);
        analemmaLabel.userData.clock = clock;
        scene.add(analemmaLabel);
      }
      analemmaLabel.visible = !!peak;
      if (peak) analemmaLabel.position.copy(peak).multiplyScalar(1.08);
    }
  }

  let lastPathKey = '';
  let lastAimKey = '';
  let lastTrackLoc = '';

  function aimOverview(): void {
    // Face the meridian (south in NH / north in SH) with pitch to see the arc
    yaw = state.lat >= 0 ? Math.PI : 0;
    pitch = 0.55;
    updateCamera();
  }

  function updateSun(): void {
    const pos = solarPosition(state.lat, state.lon, state.datetime);
    (sky.material as THREE.ShaderMaterial).uniforms.sunEl.value = pos.elevation;
    (stars.material as THREE.PointsMaterial).opacity =
      pos.elevation < 0 ? 0.95 : Math.max(0, 0.35 - pos.elevation / 25);

    const [e, n, u] = sunENU(state.lat, state.lon, state.datetime);
    const p = enuToThree(e, n, u, PATH_R + 3);
    sun.position.copy(p);
    sunHalo.position.copy(p);
    const sunUp = pos.elevation > -6;
    sun.visible = sunUp;
    sunHalo.visible = sunUp;
    sunBeam.visible = sunUp;
    if (sunUp) {
      sunBeam.geometry.dispose();
      sunBeam.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.1, 0),
        p.clone(),
      ]);
    }

    // Zenith angle wedge: from straight up (0,1,0) down to the sun
    const upDir = new THREE.Vector3(0, 1, 0);
    const sunDir = new THREE.Vector3(e, u, n).normalize();
    const zenithRad = Math.acos(Math.min(1, Math.max(-1, upDir.dot(sunDir))));
    const showZen = pos.elevation > -5;
    zenithArc.visible = showZen;
    zenithWedge.visible = showZen;
    zenithAngleLabel.visible = showZen;
    if (showZen) {
      const axis = new THREE.Vector3().crossVectors(upDir, sunDir);
      const arcPts: THREE.Vector3[] = [];
      const wedgePts: THREE.Vector3[] = [new THREE.Vector3(0, 0.1, 0)];
      if (axis.lengthSq() > 1e-8) {
        axis.normalize();
        for (let i = 0; i <= 32; i++) {
          const dir = upDir.clone().applyAxisAngle(axis, (i / 32) * zenithRad).normalize();
          const pt = dir.multiplyScalar(ARC_R);
          arcPts.push(pt);
          wedgePts.push(pt.clone());
        }
      }
      zenithArc.geometry.dispose();
      zenithArc.geometry = new THREE.BufferGeometry().setFromPoints(arcPts);
      zenithWedge.geometry.dispose();
      if (wedgePts.length >= 3) {
        const positions: number[] = [];
        for (let i = 1; i < wedgePts.length - 1; i++) {
          positions.push(
            wedgePts[0].x, wedgePts[0].y, wedgePts[0].z,
            wedgePts[i].x, wedgePts[i].y, wedgePts[i].z,
            wedgePts[i + 1].x, wedgePts[i + 1].y, wedgePts[i + 1].z,
          );
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        zenithWedge.geometry = g;
      }
      const zLabel = `zenith ${pos.zenith.toFixed(0)}°`;
      if (zenithAngleLabel.userData.text !== zLabel) {
        scene.remove(zenithAngleLabel);
        (zenithAngleLabel.material as THREE.SpriteMaterial).map?.dispose();
        (zenithAngleLabel.material as THREE.Material).dispose();
        zenithAngleLabel = labelCanvas(zLabel, '#ff8866', 2.4);
        zenithAngleLabel.userData.text = zLabel;
        scene.add(zenithAngleLabel);
      }
      // Sit beside the sun so the reading stays in view when camera tracks it
      const side = new THREE.Vector3().crossVectors(sunDir, upDir);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      else side.normalize();
      zenithAngleLabel.position.copy(p).add(side.multiplyScalar(6));
    }

    // Traveled portion of today's path (sunrise → now)
    const traveled: THREE.Vector3[] = [];
    const day0 = new Date(
      Date.UTC(state.datetime.getUTCFullYear(), state.datetime.getUTCMonth(), state.datetime.getUTCDate()),
    );
    const nowMs = state.datetime.getTime();
    for (let i = 0; i <= 48; i++) {
      const d = new Date(day0.getTime() + (i / 48) * 86400000);
      if (d.getTime() > nowMs) break;
      const [ee, nn, uu] = sunENU(state.lat, state.lon, d);
      if (uu > -0.02) traveled.push(enuToThree(ee, nn, uu, PATH_R));
    }
    traveledPath.geometry.dispose();
    traveledPath.geometry = new THREE.BufferGeometry().setFromPoints(traveled);

    const loc = toLocalParts(state.datetime, state.lat, state.lon);
    const pathKey = `${state.lat.toFixed(3)},${state.lon.toFixed(3)},${loc.y}-${loc.mo}-${loc.day},${loc.h}:${loc.m},${state.showSeasonPaths},${state.showAnalemma}`;
    if (pathKey !== lastPathKey) {
      const turningAnalemmaOn = state.showAnalemma && !lastPathKey.endsWith(',true');
      lastPathKey = pathKey;
      rebuildPaths();
      if (turningAnalemmaOn) aimOverview();
    }

    const aimKey = String(state.lookNonce);
    if (state.trackSun && pos.elevation > -5) {
      const locKey = `${state.lat.toFixed(4)},${state.lon.toFixed(4)}`;
      const locChanged = lastTrackLoc !== '' && locKey !== lastTrackLoc;
      lastTrackLoc = locKey;
      // Keep view still when only location changes (e.g. latitude slider)
      if (!locChanged) {
        yaw = (pos.azimuth * Math.PI) / 180;
        pitch = Math.max(-0.05, Math.min(Math.PI / 2 - 0.05, (pos.elevation * Math.PI) / 180));
        updateCamera();
      }
    } else if (aimKey !== lastAimKey) {
      lastAimKey = aimKey;
      if (pos.elevation > -5) {
        yaw = (pos.azimuth * Math.PI) / 180;
        pitch = Math.max(0.35, Math.min(1.0, (pos.elevation * Math.PI) / 180 * 0.7 + 0.35));
      } else {
        aimOverview();
      }
      updateCamera();
    }
  }

  function updateCamera(): void {
    const cp = Math.cos(pitch);
    camera.position.set(0, 0.12, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.005;
    pitch = Math.max(-0.05, Math.min(Math.PI / 2 - 0.05, pitch - (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
    updateCamera();
  };
  const onUp = () => {
    dragging = false;
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);

  const unsub = subscribe(updateSun);
  rebuildPaths();
  updateSun();
  aimOverview();

  return {
    render() {
      updateSun();
      renderer.render(scene, camera);
    },
    resize(w, h) {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    },
    dispose() {
      unsub();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
