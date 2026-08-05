import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ecefToLatLon,
  enuBasis,
  latLonToECEF,
  sunDirectionECEF,
  sunENU,
} from '../astro/sun';
import { setLocation, state, subscribe } from '../state';

const R = 1;

export interface OrbitalView {
  render: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

export function createOrbitalView(container: HTMLElement): OrbitalView {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0.6, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.6;
  controls.maxDistance = 8;
  controls.enablePan = false;

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starCount = 1500;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
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
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform vec3 sunDir;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPos;
      void main() {
        vec3 n = normalize(vPos);
        float ndl = dot(n, normalize(sunDir));
        float dayF = smoothstep(-0.08, 0.12, ndl);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb * 1.35;
        vec3 col = mix(night, day, dayF);
        // soft terminator + atmosphere rim
        float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0,0,1)), 0.0), 3.0);
        col += vec3(0.25, 0.45, 0.9) * rim * 0.15 * dayF;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  // Three.js uses Y-up; ECEF uses Z-up. Map ECEF (x,y,z) -> Three (x,z,-y) wait...
  // Standard: Three Y-up. We'll use Three coords as ECEF with Y = north pole:
  // three(x,y,z) = ecef(x,z,y)  i.e. ECEF Z (north) -> Three Y
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), earthMat);
  // SphereGeometry: Y is up (north), U wraps from +X. Matches lon=0 at +X, lat from Y.
  scene.add(earth);

  // Atmosphere glow
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.018, 48, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPos = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          float I = pow(0.65 - dot(normalize(vNormal), vec3(0,0,1)), 2.5);
          float lit = smoothstep(-0.2, 0.5, dot(normalize(vPos), normalize(sunDir)));
          gl_FragColor = vec4(0.3, 0.55, 1.0, I * 0.45 * lit);
        }
      `,
    }),
  );
  scene.add(atmo);

  // Sun (visual + light dir)
  const sunGroup = new THREE.Group();
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffee88 }),
  );
  sunGroup.add(sunMesh);
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  sunGroup.add(sunGlow);
  scene.add(sunGroup);

  // Location marker + axes
  const markerGroup = new THREE.Group();
  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3355 }),
  );
  markerGroup.add(pin);

  const makeLine = (color: number) => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 0.35, 0),
    ]);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
  };
  const upLine = makeLine(0x44ff88);
  const sunLine = makeLine(0xffcc33);
  const eastLine = makeLine(0x4488ff);
  const northLine = makeLine(0xffffff);
  markerGroup.add(upLine, sunLine, eastLine, northLine);
  scene.add(markerGroup);

  // Subsolar marker
  const subsolar = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffee55 }),
  );
  scene.add(subsolar);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function ecefToThree(v: [number, number, number]): THREE.Vector3 {
    // ECEF: x equator 0 lon, y 90E, z north → Three Y-up: (x, z, -y) keeps right-handed & lon sense
    return new THREE.Vector3(v[0], v[2], -v[1]);
  }

  function threeToEcef(v: THREE.Vector3): [number, number, number] {
    return [v.x, -v.z, v.y];
  }

  function updateMarker(): void {
    const pos = ecefToThree(latLonToECEF(state.lat, state.lon)).multiplyScalar(R);
    pin.position.copy(pos);

    const { east, north, up } = enuBasis(state.lat, state.lon);
    const setAxis = (line: THREE.Line, dir: [number, number, number], len: number) => {
      const a = pos.clone();
      const b = pos.clone().add(ecefToThree(dir).multiplyScalar(len));
      line.geometry.setFromPoints([a, b]);
    };
    setAxis(upLine, up, 0.4);
    setAxis(eastLine, east, 0.22);
    setAxis(northLine, north, 0.22);

    const [e, n, u] = sunENU(state.lat, state.lon, state.datetime);
    // Compose sun dir in ECEF from ENU
    const sunEcef: [number, number, number] = [
      east[0] * e + north[0] * n + up[0] * u,
      east[1] * e + north[1] * n + up[1] * u,
      east[2] * e + north[2] * n + up[2] * u,
    ];
    const sunLen = 0.55;
    sunLine.geometry.setFromPoints([
      pos.clone(),
      pos.clone().add(ecefToThree(sunEcef).multiplyScalar(sunLen)),
    ]);
  }

  function updateSun(): void {
    const dir = sunDirectionECEF(state.datetime);
    const t = ecefToThree(dir);
    earthMat.uniforms.sunDir.value.copy(t);
    (atmo.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(t);
    sunGroup.position.copy(t.clone().multiplyScalar(6));
    subsolar.position.copy(t.clone().multiplyScalar(R * 1.01));
  }

  function onPointer(e: PointerEvent): void {
    if (e.button !== 0) return;
    // Distinguish click from orbit drag
    const startX = e.clientX;
    const startY = e.clientY;
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      if (Math.hypot(up.clientX - startX, up.clientY - startY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((up.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((up.clientY - rect.top) / rect.height) * 2 + 1;
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
