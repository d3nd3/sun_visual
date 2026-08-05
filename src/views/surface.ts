import * as THREE from 'three';
import { solarPosition, sunENU } from '../astro/sun';
import { state, subscribe } from '../state';

export interface SurfaceView {
  render: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

export function createSurfaceView(container: HTMLElement): SurfaceView {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.position.set(0, 0.05, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';

  // Local frame: X=east, Y=up, Z=-north (Three look convention) → use X=east Y=up Z=south for simple
  // We'll place things in ENU: X=east, Y=up, Z=north, and point camera with lookAt

  let yaw = 180 * (Math.PI / 180); // look south-ish initially toward sun often
  let pitch = 15 * (Math.PI / 180);

  // Sky dome gradient via shader
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
          // twilight orange near horizon
          float twilight = (1.0 - smoothstep(0.0, 12.0, abs(sunEl))) * (1.0 - abs(h));
          vec3 col = mix(nightCol, dayCol, day);
          col = mix(col, vec3(1.0, 0.45, 0.15), twilight * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const nStars = 800;
  const sp = new Float32Array(nStars * 3);
  for (let i = 0; i < nStars; i++) {
    const θ = Math.random() * Math.PI * 2;
    const φ = Math.acos(Math.random()); // upper hemisphere bias
    const r = 70;
    sp[i * 3] = r * Math.sin(φ) * Math.cos(θ);
    sp[i * 3 + 1] = r * Math.cos(φ);
    sp[i * 3 + 2] = r * Math.sin(φ) * Math.sin(θ);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.9 }),
  );
  scene.add(stars);

  // Ground disk
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 48),
    new THREE.MeshBasicMaterial({ color: 0x1a2a18, side: THREE.DoubleSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // Horizon ring + compass labels
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(18, 18.15, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }),
  );
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  const labelCanvas = (text: string, color: string) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    return new THREE.Sprite(mat);
  };
  const compass: { spr: THREE.Sprite; az: number }[] = [
    { spr: labelCanvas('N', '#ff6666'), az: 0 },
    { spr: labelCanvas('E', '#88aaff'), az: 90 },
    { spr: labelCanvas('S', '#ffffff'), az: 180 },
    { spr: labelCanvas('W', '#88aaff'), az: 270 },
  ];
  for (const { spr, az } of compass) {
    const rad = (az * Math.PI) / 180;
    // az from N clockwise: east=sin, north=cos → X=east Z=north
    spr.position.set(Math.sin(rad) * 17, 0.4, Math.cos(rad) * 17);
    spr.scale.set(2, 2, 1);
    scene.add(spr);
  }

  // Sun disk
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
  );
  scene.add(sun);
  const sunHalo = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffaa40, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  scene.add(sunHalo);

  // Day sun path
  const pathMat = new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.7 });
  let pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMat);
  scene.add(pathLine);

  // Analemma
  const analemmaMat = new THREE.LineBasicMaterial({ color: 0xaa88ff, transparent: true, opacity: 0.8 });
  let analemmaLine = new THREE.Line(new THREE.BufferGeometry(), analemmaMat);
  scene.add(analemmaLine);

  function enuToThree(e: number, n: number, u: number, dist: number): THREE.Vector3 {
    return new THREE.Vector3(e, u, n).multiplyScalar(dist);
  }

  function rebuildPath(): void {
    const pts: THREE.Vector3[] = [];
    const base = new Date(state.datetime);
    for (let i = 0; i <= 48; i++) {
      const d = new Date(base);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCMinutes((i / 48) * 24 * 60);
      const [e, n, u] = sunENU(state.lat, state.lon, d);
      if (u > -0.15) pts.push(enuToThree(e, n, u, 50));
    }
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  function rebuildAnalemma(): void {
    if (!state.showAnalemma) {
      analemmaLine.visible = false;
      return;
    }
    analemmaLine.visible = true;
    const pts: THREE.Vector3[] = [];
    const year = state.datetime.getUTCFullYear();
    const h = state.datetime.getUTCHours();
    const m = state.datetime.getUTCMinutes();
    for (let day = 0; day < 365; day += 3) {
      const d = new Date(Date.UTC(year, 0, 1 + day, h, m));
      const [e, n, u] = sunENU(state.lat, state.lon, d);
      pts.push(enuToThree(e, n, u, 48));
    }
    analemmaLine.geometry.dispose();
    analemmaLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  let lastPathKey = '';
  let lastAimKey = '';

  function aimAtSun(): void {
    const { azimuth, elevation } = solarPosition(state.lat, state.lon, state.datetime);
    if (elevation > -5) {
      yaw = (azimuth * Math.PI) / 180;
      pitch = Math.max(0.05, Math.min(1.2, (elevation * Math.PI) / 180));
    }
    updateCamera();
  }

  function updateSun(): void {
    const pos = solarPosition(state.lat, state.lon, state.datetime);
    (sky.material as THREE.ShaderMaterial).uniforms.sunEl.value = pos.elevation;
    (stars.material as THREE.PointsMaterial).opacity =
      pos.elevation < 0 ? 0.95 : Math.max(0, 0.4 - pos.elevation / 20);

    const [e, n, u] = sunENU(state.lat, state.lon, state.datetime);
    const p = enuToThree(e, n, u, 55);
    sun.position.copy(p);
    sunHalo.position.copy(p);
    sun.visible = pos.elevation > -6;
    sunHalo.visible = sun.visible;

    const day = state.datetime.toISOString().slice(0, 10);
    const tod = `${state.datetime.getUTCHours()}:${state.datetime.getUTCMinutes()}`;
    const locDay = `${state.lat.toFixed(3)},${state.lon.toFixed(3)},${day}`;
    const fullKey = `${locDay},${tod},${state.showAnalemma}`;
    if (fullKey !== lastPathKey) {
      const prevLocDay = lastPathKey.split(',').slice(0, 3).join(',');
      if (locDay !== prevLocDay) rebuildPath();
      lastPathKey = fullKey;
      rebuildAnalemma();
    }

    const aimKey = `${state.lat.toFixed(4)},${state.lon.toFixed(4)},${state.lookNonce}`;
    if (aimKey !== lastAimKey) {
      lastAimKey = aimKey;
      aimAtSun();
    }
  }

  function updateCamera(): void {
    const cp = Math.cos(pitch);
    const look = new THREE.Vector3(
      Math.sin(yaw) * cp,
      Math.sin(pitch),
      Math.cos(yaw) * cp,
    );
    camera.position.set(0, 0.08, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
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
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw -= dx * 0.005;
    pitch = Math.max(-0.1, Math.min(Math.PI / 2 - 0.05, pitch - dy * 0.005));
    updateCamera();
  };
  const onUp = () => {
    dragging = false;
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);

  const unsub = subscribe(updateSun);
  updateSun();
  aimAtSun();

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
