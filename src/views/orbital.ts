import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ecefToLatLon,
  enuBasis,
  latLonToECEF,
  OBLIQUITY,
  solarPosition,
  sunDirectionECEF,
  sunENU,
} from '../astro/sun';
import { setLocation, state, subscribe } from '../state';

const R = 1;
const UP_LEN = 0.75;
const SUN_LEN = 0.95;
const AXIS_LEN = 1.85;

export interface OrbitalView {
  render: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

function makeTextSprite(text: string, color: string, scale = 0.45): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 8;
  ctx.strokeText(text, 256, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 64);
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }),
  );
  spr.scale.set(scale * 2, scale * 0.5, 1);
  return spr;
}

export function createOrbitalView(container: HTMLElement): OrbitalView {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0.5, 1.2, 3.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, {
    touchAction: 'none',
    width: '100%',
    height: '100%',
    display: 'block',
  });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.6;
  controls.maxDistance = 8;
  controls.enablePan = false;

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1200 * 3);
  for (let i = 0; i < 1200; i++) {
    const r = 40 + Math.random() * 20;
    const θ = Math.random() * Math.PI * 2;
    const φ = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(φ) * Math.cos(θ);
    starPos[i * 3 + 1] = r * Math.sin(φ) * Math.sin(θ);
    starPos[i * 3 + 2] = r * Math.cos(φ);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, sizeAttenuation: true }),
    ),
  );

  const loader = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL;
  const dayMap = loader.load(`${base}textures/earth_day.jpg`);
  const nightMap = loader.load(`${base}textures/earth_night.jpg`);
  dayMap.colorSpace = THREE.SRGBColorSpace;
  nightMap.colorSpace = THREE.SRGBColorSpace;

  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform vec3 sunDir;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 n = normalize(vWorld);
        float ndl = dot(n, normalize(sunDir));
        float dayF = smoothstep(-0.08, 0.12, ndl);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb * 1.35;
        vec3 col = mix(night, day, dayF);
        float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0,0,1)), 0.0), 3.0);
        col += vec3(0.25, 0.45, 0.9) * rim * 0.15 * dayF;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  // Earth stays fixed in ECEF — only the sun direction moves (no quaternion flips)
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), earthMat);
  scene.add(earth);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.018, 48, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorld = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          float I = pow(0.65 - dot(normalize(vNormal), vec3(0,0,1)), 2.5);
          float lit = smoothstep(-0.2, 0.5, dot(normalize(vWorld), normalize(sunDir)));
          gl_FragColor = vec4(0.3, 0.55, 1.0, I * 0.45 * lit);
        }
      `,
    }),
  );
  scene.add(atmo);

  // Polar axis through N/S poles (Earth's spin axis) — extends beyond the sphere
  const polarAxis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -AXIS_LEN, 0),
      new THREE.Vector3(0, AXIS_LEN, 0),
    ]),
    new THREE.LineBasicMaterial({ color: 0x66ffcc }),
  );
  scene.add(polarAxis);
  const nPole = makeTextSprite('N pole', '#66ffcc', 0.35);
  nPole.position.set(0, AXIS_LEN + 0.08, 0);
  scene.add(nPole);
  const sPole = makeTextSprite('S pole', '#66ffcc', 0.35);
  sPole.position.set(0, -AXIS_LEN - 0.08, 0);
  scene.add(sPole);

  // Equatorial ring (perpendicular to spin axis)
  const eqRing = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.05, R * 1.07, 64),
    new THREE.MeshBasicMaterial({
      color: 0x88aacc,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  eqRing.rotation.x = Math.PI / 2;
  scene.add(eqRing);

  // Ecliptic ring tipped by obliquity — shows the axial tilt vs orbit plane
  const ecliptic = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.12, R * 1.14, 64),
    new THREE.MeshBasicMaterial({
      color: 0xf0b429,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ecliptic.rotation.x = Math.PI / 2;
  ecliptic.rotation.z = (OBLIQUITY * Math.PI) / 180;
  scene.add(ecliptic);
  const tiltLabel = makeTextSprite(`tilt ${OBLIQUITY.toFixed(1)}°`, '#f0b429', 0.32);
  tiltLabel.position.set(0, 0.15, R * 1.25);
  scene.add(tiltLabel);

  const sunGroup = new THREE.Group();
  sunGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffee88 }),
    ),
    new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffaa33,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    ),
  );
  scene.add(sunGroup);

  const markerGroup = new THREE.Group();
  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3355 }),
  );
  markerGroup.add(pin);

  const makeLine = (color: number, opacity = 1) =>
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
    );
  const upLine = makeLine(0x44ff88);
  const sunRay = makeLine(0xffcc33);
  const eastLine = makeLine(0x4488ff, 0.35);
  const northLine = makeLine(0xffffff, 0.35);
  markerGroup.add(upLine, sunRay, eastLine, northLine);

  const wedge = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0xff6644,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  markerGroup.add(wedge);

  const angleArc = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xff8866 }),
  );
  markerGroup.add(angleArc);

  let angleLabel = makeTextSprite('zenith 0°', '#ff8866', 0.55);
  angleLabel.userData.text = 'zenith 0°';
  markerGroup.add(angleLabel);
  scene.add(markerGroup);

  const subsolar = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffee55 }),
  );
  scene.add(subsolar);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function ecefToThree(v: [number, number, number]): THREE.Vector3 {
    return new THREE.Vector3(v[0], v[2], -v[1]);
  }

  function threeToEcef(v: THREE.Vector3): [number, number, number] {
    return [v.x, -v.z, v.y];
  }

  function updateMarker(): void {
    const pos = ecefToThree(latLonToECEF(state.lat, state.lon)).multiplyScalar(R);
    pin.position.copy(pos);

    const { east, north, up } = enuBasis(state.lat, state.lon);
    const upT = ecefToThree(up);
    const eastT = ecefToThree(east);
    const northT = ecefToThree(north);

    const setAxis = (line: THREE.Line, dir: THREE.Vector3, len: number) => {
      line.geometry.setFromPoints([pos.clone(), pos.clone().add(dir.clone().multiplyScalar(len))]);
    };
    setAxis(upLine, upT, UP_LEN);
    setAxis(eastLine, eastT, 0.28);
    setAxis(northLine, northT, 0.28);

    const [e, n, u] = sunENU(state.lat, state.lon, state.datetime);
    const sunEcef: [number, number, number] = [
      east[0] * e + north[0] * n + up[0] * u,
      east[1] * e + north[1] * n + up[1] * u,
      east[2] * e + north[2] * n + up[2] * u,
    ];
    const sunT = ecefToThree(sunEcef).normalize();
    setAxis(sunRay, sunT, SUN_LEN);

    const zenith = solarPosition(state.lat, state.lon, state.datetime).zenith;
    const elev = 90 - zenith;

    const axis = new THREE.Vector3().crossVectors(upT, sunT);
    const arcPts: THREE.Vector3[] = [];
    const wedgePts: THREE.Vector3[] = [pos.clone()];
    const maxAng = Math.min(Math.PI, Math.acos(Math.min(1, Math.max(-1, upT.dot(sunT)))));
    if (axis.lengthSq() > 1e-8) {
      axis.normalize();
      for (let i = 0; i <= 28; i++) {
        const dir = upT.clone().applyAxisAngle(axis, (i / 28) * maxAng).normalize();
        const p = pos.clone().add(dir.multiplyScalar(0.58));
        arcPts.push(p);
        wedgePts.push(p.clone());
      }
    }
    angleArc.geometry.dispose();
    angleArc.geometry = new THREE.BufferGeometry().setFromPoints(arcPts);

    wedge.geometry.dispose();
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
      wedge.geometry = g;
    }
    const showAngle = elev > -5 && arcPts.length > 1;
    wedge.visible = showAngle;
    angleArc.visible = showAngle;

    const mid =
      arcPts[Math.floor(arcPts.length / 2)] ??
      pos.clone().add(upT.clone().multiplyScalar(0.65));
    const label = elev < -0.5 ? 'night' : `zenith ${zenith.toFixed(0)}°`;
    if (angleLabel.userData.text !== label) {
      markerGroup.remove(angleLabel);
      (angleLabel.material as THREE.SpriteMaterial).map?.dispose();
      (angleLabel.material as THREE.Material).dispose();
      angleLabel = makeTextSprite(label, elev < -0.5 ? '#8899aa' : '#ff8866', 0.55);
      angleLabel.userData.text = label;
      markerGroup.add(angleLabel);
    }
    angleLabel.position.copy(mid);
  }

  function updateSun(): void {
    // Smooth: move light/sun around a fixed upright Earth (no globe flipping)
    const dir = ecefToThree(sunDirectionECEF(state.datetime)).normalize();
    earthMat.uniforms.sunDir.value.copy(dir);
    (atmo.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(dir);
    sunGroup.position.copy(dir.clone().multiplyScalar(6));
    subsolar.position.copy(dir.clone().multiplyScalar(R * 1.02));
  }

  function onPointer(e: PointerEvent): void {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(earth);
      if (!hits.length) return;
      const p = hits[0].point.clone().normalize();
      const { lat, lon } = ecefToLatLon(...threeToEcef(p));
      setLocation(lat, lon);
    };
    window.addEventListener('pointerup', onUp);
  }
  renderer.domElement.addEventListener('pointerdown', onPointer);

  const unsub = subscribe(() => {
    updateSun();
    updateMarker();
  });
  updateSun();
  updateMarker();

  return {
    render() {
      updateSun();
      updateMarker();
      controls.update();
      renderer.render(scene, camera);
    },
    resize(w, h) {
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    },
    dispose() {
      unsub();
      renderer.domElement.removeEventListener('pointerdown', onPointer);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
