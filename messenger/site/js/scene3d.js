// =====================================================================
//  3D (Three.js из LEXI Space): фон-планета и орбитальная сцена регистрации.
//  Земля и спутник — модели LEXI Space (site/js/models.js), планеты и
//  экзопланеты — процедурный шейдер в том же стиле.
//  На слабых устройствах не загружается вовсе (см. can3D в app.js).
// =====================================================================

import * as THREE from 'three';
import { makeEarth, setEarthSun, makeSatellite } from 'lexi-space/js/models.js';

const SPACE = p => import.meta.resolve('lexi-space/' + p);

const NOISE = /* glsl */`
  float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }`;

// Планеты фона: Солнечная система и экзопланеты
export const PLANETS = [
  { id: 'mars', ru: 'Марс', en: 'Mars', type: 'rock', a: '#6e2a18', b: '#d27448', scale: 4, caps: true },
  { id: 'jupiter', ru: 'Юпитер', en: 'Jupiter', type: 'gas', a: '#8a6446', b: '#efe2c8', c: '#c28a5c', bands: 14, spot: true },
  { id: 'saturn', ru: 'Сатурн', en: 'Saturn', type: 'gas', a: '#a88a5c', b: '#f3e4bc', c: '#d6bb88', bands: 18, ring: true },
  { id: 'neptune', ru: 'Нептун', en: 'Neptune', type: 'gas', a: '#2d4fb0', b: '#6f93ec', c: '#4a6fd4', bands: 8 },
  { id: 'uranus', ru: 'Уран', en: 'Uranus', type: 'gas', a: '#7fbcc6', b: '#bfe8ee', c: '#9ad2da', bands: 6 },
  { id: 'venus', ru: 'Венера', en: 'Venus', type: 'cloud', a: '#b9935a', b: '#f1dcaa', scale: 2.5 },
  { id: 'trappist1e', ru: 'TRAPPIST-1 e', en: 'TRAPPIST-1 e', type: 'ocean', a: '#0f2c4a', b: '#4f6b3a', c: '#a59a6a', caps: true, star: '#ffb08a' },
  { id: 'kepler452b', ru: 'Kepler-452 b', en: 'Kepler-452 b', type: 'ocean', a: '#16385a', b: '#5b7a43', c: '#b9a978', caps: true },
  { id: 'hd189733b', ru: 'HD 189733 b', en: 'HD 189733 b', type: 'gas', a: '#0b1f5c', b: '#3a74e0', c: '#1d47b0', bands: 9 },
  { id: '51pegb', ru: '51 Пегаса b', en: '51 Pegasi b', type: 'gas', a: '#5a1a0a', b: '#f3a050', c: '#d4602a', bands: 11 },
  { id: 'proximab', ru: 'Проксима b', en: 'Proxima b', type: 'rock', a: '#3a2620', b: '#b98b6c', scale: 3.5, star: '#ff9070' },
  { id: '55cnce', ru: '55 Рака e', en: '55 Cancri e', type: 'lava', a: '#1a0705', b: '#3a0f08', c: '#ffa030', scale: 3 },
];

function planetMaterial(look) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(look.a) }, uB: { value: new THREE.Color(look.b) }, uC: { value: new THREE.Color(look.c || look.b) },
      uSun: { value: new THREE.Vector3(-0.7, 0.45, 0.6).normalize() }, uStar: { value: new THREE.Color(look.star || '#fff4e0') },
      uType: { value: { rock: 0, cloud: 1, gas: 2, ocean: 3, lava: 4 }[look.type] }, uScale: { value: look.scale || 3 },
      uBands: { value: look.bands || 10 }, uCaps: { value: look.caps ? 1 : 0 }, uSpot: { value: look.spot ? 1 : 0 }, uTime: { value: 0 },
    },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vWN; varying vec3 vView;
      void main(){ vN = normalize(position); vWN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`uniform vec3 uA, uB, uC, uSun, uStar; uniform float uType, uScale, uBands, uCaps, uSpot, uTime;
      varying vec3 vN; varying vec3 vWN; varying vec3 vView; ${NOISE}
      void main(){
        vec3 n = normalize(vN), col; float glow = 0.0;
        if (uType < .5) {
          float h = fbm(n * uScale); float m = smoothstep(.42, .62, fbm(n * uScale * .5 + 7.0));
          col = mix(uA, uB, h * .9 + m * .25); col *= 1.0 - smoothstep(.72, .78, noise(n * uScale * 6.0)) * .25;
          if (uCaps > .5) col = mix(col, vec3(.95), smoothstep(.86, .93, abs(n.y)));
        } else if (uType < 1.5) {
          col = mix(uA, uB, smoothstep(.3, .8, fbm(n * uScale + vec3(uTime * .02, 0, 0))));
        } else if (uType < 2.5) {
          float lat = n.y + .08 * fbm(n * 4.0 + vec3(uTime * .01, 0, 0));
          col = mix(mix(uA, uB, sin(lat * uBands) * .5 + .5), uC, fbm(vec3(n.x * 2.0, lat * 18.0, n.z * 2.0)) * .55);
          if (uSpot > .5) { vec2 q = vec2(atan(n.z, n.x) - 1.2, (n.y + .38) * 3.2); col = mix(col, vec3(.72,.33,.2), 1.0 - smoothstep(.18, .32, length(q))); }
        } else if (uType < 3.5) {
          float h = fbm(n * 2.2);
          col = mix(uA, mix(uB, uC, smoothstep(.55, .75, h)), smoothstep(.5, .53, h));
          if (uCaps > .5) col = mix(col, vec3(.93), smoothstep(.82, .9, abs(n.y) + h * .1));
          float cl = fbm(n * 3.0 + vec3(uTime * .015, 0, 0));
          col = mix(col, vec3(.95), smoothstep(.55, .75, cl) * .8);
        } else {
          float h = fbm(n * uScale);
          col = mix(uA, uB, h);
          glow = smoothstep(.04, .0, abs(h - .5)) * .9 + smoothstep(.62, .75, fbm(n * 6.0)) * .25;
        }
        vec3 wn = normalize(vWN);
        float light = max(dot(wn, normalize(uSun)), 0.0);
        float rim = pow(1.0 - max(dot(wn, normalize(vView)), 0.0), 3.0);
        vec3 c = col * (0.04 + 1.05 * light) * uStar + rim * light * .35 * uStar + uC * glow;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

function ringMesh(radius) {
  const geo = new THREE.RingGeometry(radius * 1.25, radius * 2.3, 160, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - radius * 1.25) / (radius * 1.05), 0.5);
  const ring = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; ${NOISE} void main(){ float r = vUv.x; float b = .55 + .45 * sin(r * 90.0) * noise(vec3(r * 40.0));
      float cas = smoothstep(.56,.58,r) * (1.0 - smoothstep(.62,.64,r)); float a = (1.0 - cas) * b * smoothstep(0.,.05,r) * (1.0 - smoothstep(.95,1.,r));
      gl_FragColor = vec4(mix(vec3(.75,.65,.48), vec3(.95,.88,.7), r), a * .8); }`,
  }));
  ring.rotation.x = -Math.PI / 2.4;
  return ring;
}

function starPoints(n = 1800, r = 60) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u);
    p.set([r * q * Math.cos(t), r * u, r * q * Math.sin(t)], i * 3);
    s[i] = 0.6 + Math.random() ** 4 * 3.2; ph[i] = Math.random() * 6.28;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('size', new THREE.BufferAttribute(s, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uPx: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `attribute float size; attribute float phase; uniform float uTime, uPx; varying float vA;
      void main(){ vA = .45 + .55 * sin(uTime * (0.6 + phase * .25) + phase); vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = size * uPx; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(1., .97, .9), vA * smoothstep(.5, .0, d)); }`,
  });
  return new THREE.Points(g, m);
}

function makeRenderer(canvas, { alpha = true } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

function loop(fn, fps = 30) {
  let raf = 0, last = 0, stopped = false;
  const step = t => {
    if (stopped) return;
    raf = requestAnimationFrame(step);
    if (document.hidden || t - last < 1000 / fps) return;
    last = t; fn(t / 1000);
  };
  raf = requestAnimationFrame(step);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

// ---------------------------------------------------------------------
//  Фон: планета за всем интерфейсом
// ---------------------------------------------------------------------
export function createBackground(canvas) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  camera.position.set(0, 0, 9);
  const stars = starPoints(1400, 80);
  scene.add(stars);
  const holder = new THREE.Group();
  scene.add(holder);
  let planet = null, mat = null;

  const setPlanet = id => {
    const look = PLANETS.find(p => p.id === id) || PLANETS[0];
    if (planet) { holder.remove(planet); planet.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    planet = new THREE.Group();
    mat = planetMaterial(look);
    planet.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), mat));
    if (look.ring) planet.add(ringMesh(1));
    planet.rotation.z = look.ring ? 0.32 : 0.12;
    holder.add(planet);
    return look;
  };
  const layout = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // крупная планета, частично за правым нижним краем
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(15)) * 9, vw = vh * camera.aspect;
    const r = Math.max(vh, vw) * (w < 700 ? 0.42 : 0.3);
    holder.scale.setScalar(r);
    holder.position.set(vw * 0.36, -vh * 0.3, 0);
  };
  layout();
  const ro = new ResizeObserver(layout); ro.observe(canvas);
  const stop = loop(t => {
    if (planet) planet.rotation.y = t * 0.03;
    if (mat) mat.uniforms.uTime.value = t;
    stars.material.uniforms.uTime.value = t;
    stars.rotation.y = t * 0.002;
    renderer.render(scene, camera);
  }, 30);
  return { setPlanet, dispose() { stop(); ro.disconnect(); renderer.dispose(); } };
}

// ---------------------------------------------------------------------
//  Орбитальная сцена регистрации: Земля, спутники, звёзды
// ---------------------------------------------------------------------
function makeStarlink() {
  // плоский спутник с одной длинной панелью — как на эскизе «STARLINK»
  const g = new THREE.Group();
  const bus = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: 0x8f8a80, metalness: 0.85, roughness: 0.35 }));
  g.add(bus);
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#101a3c'; x.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 512; i += 16) for (let j = 0; j < 128; j += 16) { x.fillStyle = `hsl(225, 55%, ${18 + Math.random() * 8}%)`; x.fillRect(i + 1, j + 1, 14, 14); }
  x.strokeStyle = '#c49d47'; x.lineWidth = 2; x.strokeRect(1, 1, 510, 126);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.03, 1.05), [
    new THREE.MeshStandardMaterial({ color: 0x223 }), new THREE.MeshStandardMaterial({ color: 0x223 }),
    new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.35, emissive: 0x081028 }), new THREE.MeshStandardMaterial({ color: 0x334 }),
    new THREE.MeshStandardMaterial({ color: 0x223 }), new THREE.MeshStandardMaterial({ color: 0x223 }),
  ]);
  panel.position.x = 2.75;
  g.add(panel);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), new THREE.MeshStandardMaterial({ color: 0xc49d47, metalness: 0.9, roughness: 0.3 }));
  arm.rotation.z = Math.PI / 2; arm.position.x = 0.75; g.add(arm);
  return g;
}

export function createOrbitScene(canvas) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 300);
  scene.add(starPoints(2200, 120));
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4); sun.position.set(-6, 3, 5); scene.add(sun);
  const sunDir = sun.position.clone().normalize();

  const loader = new THREE.TextureLoader().setPath(SPACE(''));
  const earth = makeEarth(loader);
  earth.scale.setScalar(3.2);
  earth.rotation.z = 0.41;
  setEarthSun(earth, sunDir);
  scene.add(earth);

  const sats = [makeSatellite(), makeSatellite()];
  sats.forEach((s, i) => { s.scale.setScalar(i ? 0.18 : 0.26); scene.add(s); });
  const starlink = makeStarlink();
  starlink.scale.setScalar(0.5);
  scene.add(starlink);

  // позиции камеры для шагов регистрации
  const SHOTS = {
    hello: { pos: new THREE.Vector3(2.6, 1.4, 10.5), look: new THREE.Vector3(1.4, 1.6, 0), earth: new THREE.Vector3(-2.6, -2.6, 0) },
    profile: { pos: new THREE.Vector3(3.2, 3.6, 5.6), look: new THREE.Vector3(3.6, 3.1, 0), earth: new THREE.Vector3(-2.2, -3.2, -2) },
    welcome: { pos: new THREE.Vector3(0, 0.5, 16), look: new THREE.Vector3(0, 0.6, 0), earth: new THREE.Vector3(0, -6.4, -6) },
  };
  let shot = 'hello';
  const cur = { pos: SHOTS.hello.pos.clone(), look: SHOTS.hello.look.clone(), earth: SHOTS.hello.earth.clone() };
  const anchor = new THREE.Vector3();
  let onAnchor = null;

  const resize = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  const stop = loop(t => {
    const target = SHOTS[shot];
    cur.pos.lerp(target.pos, 0.04); cur.look.lerp(target.look, 0.04); cur.earth.lerp(target.earth, 0.04);
    camera.position.copy(cur.pos); camera.lookAt(cur.look);
    earth.position.copy(cur.earth);
    earth.rotation.y = t * 0.03;
    earth.userData.clouds.rotation.y = t * 0.004;
    // орбиты спутников вокруг Земли
    sats.forEach((s, i) => {
      const a = t * (i ? 0.09 : 0.06) + i * 2.1, R = i ? 4.6 : 5.4;
      s.position.set(cur.earth.x + Math.cos(a) * R, cur.earth.y + Math.sin(a) * R * 0.55 + 2.2, cur.earth.z + Math.sin(a) * R * 0.5);
      s.rotation.set(0.3, -a, 0.2);
    });
    starlink.position.set(2.4 + Math.sin(t * 0.3) * 0.05, 3.1 + Math.sin(t * 0.4) * 0.06, 0);
    starlink.rotation.set(0.35 + Math.sin(t * 0.2) * 0.03, -0.5, 0.12);
    renderer.render(scene, camera);
    // точка «подвеса» карточки — край панели Starlink
    if (onAnchor) {
      anchor.set(2.75 * 0.5 + 2.4, 3.1, 0.25).project(camera);
      onAnchor((anchor.x + 1) / 2 * canvas.clientWidth, (1 - anchor.y) / 2 * canvas.clientHeight);
    }
  }, 40);

  return {
    setShot(name) { if (SHOTS[name]) shot = name; },
    onAnchor(fn) { onAnchor = fn; },
    dispose() { stop(); ro.disconnect(); renderer.dispose(); },
  };
}
