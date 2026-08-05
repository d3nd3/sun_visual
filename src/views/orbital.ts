import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ecefToLatLon,
  enuBasis,
  latLonToECEF,
  OBLIQUITY,
  solarPosition,
  sunDirectionECEF,
  sunEclipticLongitude,
  sunTimes,
} from '../astro/sun';
import { setLocation, state, subscribe } from '../state';

const R = 1;
const UP_LEN = 2.8;
const SUN_DIST = 48; // far enough that parallel sun-rays hit the sun mesh (no parallax)
const SUN_LEN = SUN_DIST - 1.5;
const AXIS_LEN = 1.85;
const ARC_R = 2.2;
const ε = (OBLIQUITY * Math.PI) / 180;

export interface OrbitalView {
  render: () => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

function makeTextSprite(text: string, color: string, scale = 0.28): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = 'bold 42px sans-serif';
  ctx.font = font;
  const padX = 36;
  const padY = 20;
  const tw = Math.ceil(ctx.measureText(text).width);
  c.width = Math.max(96, tw + padX * 2);
  c.height = 42 + padY * 2;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 5;
  ctx.strokeText(text, c.width / 2, c.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, c.height / 2);
  const aspect = c.width / c.height;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }),
  );
  spr.scale.set(scale * aspect, scale, 1);
  return spr;
}

export function createOrbitalView(container: HTMLElement): OrbitalView {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5a5a62);

  // Ecliptic frame: XZ = solar plane, Y = ecliptic north
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.up.set(0, 1, 0);
  camera.position.set(0, 0, 3.6);

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
  controls.minDistance = 1.8;
  controls.maxDistance = 9;
  controls.enablePan = false;
  // Lock orbit to the solar/ecliptic plane so axial tilt stays obvious
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;
  controls.target.set(0, 0, 0);
  controls.update();

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

  // Solar plane disc (ecliptic) — camera is locked into this plane
  const solarDisc = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.08, 2.8, 64),
    new THREE.MeshBasicMaterial({
      color: 0xf0b429,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  solarDisc.rotation.x = -Math.PI / 2;
  scene.add(solarDisc);

  const ecliptic = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.12, R * 1.16, 64),
    new THREE.MeshBasicMaterial({
      color: 0xf0b429,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ecliptic.rotation.x = -Math.PI / 2;
  scene.add(ecliptic);

  const planeLabel = makeTextSprite('solar / ecliptic plane', '#f0b429', 0.22);
  planeLabel.position.set(0, 0.02, 2.35);
  scene.add(planeLabel);

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
        // Hard terminator — exaggerate day vs night
        float dayF = smoothstep(-0.02, 0.06, ndl);
        vec3 day = texture2D(dayMap, vUv).rgb * 1.75;
        vec3 nightTex = texture2D(nightMap, vUv).rgb;
        // Near-black night with faint city lights only
        vec3 night = vec3(0.008, 0.01, 0.02) + nightTex * 0.45;
        vec3 col = mix(night, day, dayF);
        float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0,0,1)), 0.0), 3.0);
        col += vec3(0.35, 0.55, 1.0) * rim * 0.14 * dayF;
        // Boost lit side further without washing out night
        col = mix(col, min(col * 1.15, vec3(1.0)), dayF);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  // Tip geographic north (local Y) toward +Z by obliquity (June lean).
  // Parent yaw = +λ so a fixed world sun at +X sees N pole tip toward it in June
  // and away in December — season switches keep the sun/camera view stable.
  const earthSeason = new THREE.Group();
  scene.add(earthSeason);
  const earthTilt = new THREE.Group();
  earthTilt.rotation.x = ε;
  earthSeason.add(earthTilt);

  // Daily spin around the tipped polar axis
  const earthSpin = new THREE.Group();
  earthTilt.add(earthSpin);

  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), earthMat);
  earthSpin.add(earth);

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
  earthSpin.add(atmo);

  // Polar axis in Earth frame (through geographic N/S) — leans vs solar plane
  const polarAxis = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -AXIS_LEN, 0),
      new THREE.Vector3(0, AXIS_LEN, 0),
    ]),
    new THREE.LineBasicMaterial({ color: 0x66ffcc }),
  );
  earthSpin.add(polarAxis);
  const nPole = makeTextSprite('N pole', '#66ffcc', 0.2);
  nPole.position.set(0, AXIS_LEN + 0.08, 0);
  earthSpin.add(nPole);
  const sPole = makeTextSprite('S pole', '#66ffcc', 0.2);
  sPole.position.set(0, -AXIS_LEN - 0.08, 0);
  earthSpin.add(sPole);

  const tiltBadge = makeTextSprite(`axis tilt ${OBLIQUITY.toFixed(1)}°`, '#66ffcc', 0.2);
  tiltBadge.position.set(0.55, AXIS_LEN * 0.55, 0);
  earthSpin.add(tiltBadge);

  function ecefToThree(v: [number, number, number]): THREE.Vector3 {
    return new THREE.Vector3(v[0], v[2], -v[1]);
  }

  function threeToEcef(v: THREE.Vector3): [number, number, number] {
    return [v.x, -v.z, v.y];
  }

  // Latitude parallels: sun can be overhead between the tropics (peak insolation)
  function latParallel(
    lat: number,
    color: number,
    opacity: number,
    label: string,
    labelColor: string,
  ): void {
    const pts: THREE.Vector3[] = [];
    const rr = R * 1.012;
    for (let i = 0; i <= 96; i++) {
      pts.push(ecefToThree(latLonToECEF(lat, (i / 96) * 360 - 180)).multiplyScalar(rr));
    }
    earthSpin.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      ),
    );
    const spr = makeTextSprite(label, labelColor, 0.18);
    spr.position.copy(ecefToThree(latLonToECEF(lat, 20)).multiplyScalar(R * 1.08));
    earthSpin.add(spr);
  }
  latParallel(0, 0xaaccff, 0.85, 'Equator 0°', '#aaccff');
  latParallel(OBLIQUITY, 0xff8844, 0.9, 'Tropic of Cancer', '#ff8844');
  latParallel(-OBLIQUITY, 0x66bbff, 0.9, 'Tropic of Capricorn', '#66bbff');

  const sunGroup = new THREE.Group();
  sunGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffee88 }),
    ),
    new THREE.Mesh(
      new THREE.SphereGeometry(2.3, 24, 24),
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

  let angleLabel = makeTextSprite('zenith 0°', '#ff8866', 0.3);
  angleLabel.userData.text = 'zenith 0°';
  markerGroup.add(angleLabel);
  earthSpin.add(markerGroup);

  const subsolar = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffee55 }),
  );
  earthSpin.add(subsolar);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

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

    // Sun ray: sunrise → sunset only (no line of sight at night)
    const sunT = ecefToThree(sunDirectionECEF(state.datetime)).normalize();
    const zenithRad = Math.acos(Math.min(1, Math.max(-1, upT.dot(sunT))));
    const elev = 90 - (zenithRad * 180) / Math.PI;
    const times = sunTimes(state.lat, state.lon, state.datetime);
    const t = state.datetime.getTime();
    sunRay.visible =
      times.sunrise && times.sunset
        ? t >= times.sunrise.getTime() && t <= times.sunset.getTime()
        : times.dayLengthHours === 24;
    if (sunRay.visible) setAxis(sunRay, sunT, SUN_LEN);

    const zenithHud = solarPosition(state.lat, state.lon, state.datetime).zenith;

    const axis = new THREE.Vector3().crossVectors(upT, sunT);
    const arcPts: THREE.Vector3[] = [];
    const wedgePts: THREE.Vector3[] = [pos.clone()];
    const maxAng = Math.min(Math.PI, zenithRad);
    if (axis.lengthSq() > 1e-8) {
      axis.normalize();
      for (let i = 0; i <= 28; i++) {
        const dir = upT.clone().applyAxisAngle(axis, (i / 28) * maxAng).normalize();
        const p = pos.clone().add(dir.multiplyScalar(ARC_R));
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
      pos.clone().add(upT.clone().multiplyScalar(ARC_R * 1.1));
    const label = elev < -0.5 ? 'night' : `zenith ${zenithHud.toFixed(0)}°`;
    if (angleLabel.userData.text !== label) {
      markerGroup.remove(angleLabel);
      (angleLabel.material as THREE.SpriteMaterial).map?.dispose();
      (angleLabel.material as THREE.Material).dispose();
      angleLabel = makeTextSprite(label, elev < -0.5 ? '#8899aa' : '#ff8866', 0.3);
      angleLabel.userData.text = label;
      markerGroup.add(angleLabel);
    }
    angleLabel.position.copy(mid);
  }

  function updateSun(): void {
    // Keep the sun fixed in world space (+X). Rotate Earth around ecliptic Y by +λ
    // so June tips the N pole toward the sun and December tips it away.
    const λ = (sunEclipticLongitude(state.datetime) * Math.PI) / 180;
    earthSeason.rotation.y = λ;

    const sunWorld = new THREE.Vector3(1, 0, 0);
    earthMat.uniforms.sunDir.value.copy(sunWorld);
    (atmo.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(sunWorld);
    sunGroup.position.set(SUN_DIST, 0, 0);

    // In earthTilt space the sun appears at ecliptic (cos λ, 0, sin λ)
    const sunEcl = new THREE.Vector3(Math.cos(λ), 0, Math.sin(λ));
    const sunLocal = ecefToThree(sunDirectionECEF(state.datetime)).normalize();
    const target = sunEcl.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -ε);
    const from = new THREE.Vector3(sunLocal.x, 0, sunLocal.z).normalize();
    const to = new THREE.Vector3(target.x, 0, target.z).normalize();
    earthSpin.rotation.y = Math.atan2(
      from.z * to.x - from.x * to.z,
      from.x * to.x + from.z * to.z,
    );

    subsolar.position.copy(sunLocal.clone().multiplyScalar(R * 1.02));
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
      const local = earthSpin.worldToLocal(hits[0].point.clone()).normalize();
      const { lat, lon } = ecefToLatLon(...threeToEcef(local));
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
      // Keep orbit axis = ecliptic north
      camera.up.set(0, 1, 0);
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
