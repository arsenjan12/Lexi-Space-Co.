// Модели для визуализации: планеты, Солнце и звёзды, галактики, туманности, скопления,
// спутники и астероиды. Всё процедурное (кроме Земли — у неё текстуры с портала),
// поэтому ничего не надо скачивать, а каждая модель строится по данным из базы.

import * as THREE from 'three';

// ---------------------------------------------------------------------
//  Общие шейдерные куски
// ---------------------------------------------------------------------
const NOISE = /* glsl */`
  float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }
`;

// Внешний вид планет: базовые цвета и тип поверхности
const LOOKS = {
  Mercury: { type: 'rock', a: '#5d5650', b: '#a39a8f', scale: 6 },
  Venus:   { type: 'cloud', a: '#b9935a', b: '#f1dcaa', scale: 2.5 },
  Mars:    { type: 'rock', a: '#7a2f1c', b: '#d7774c', scale: 4, caps: true },
  Jupiter: { type: 'gas', a: '#8a6446', b: '#efe2c8', c: '#c28a5c', bands: 14, spot: true },
  Saturn:  { type: 'gas', a: '#a88a5c', b: '#f3e4bc', c: '#d6bb88', bands: 18, ring: true },
  Uranus:  { type: 'gas', a: '#7fbcc6', b: '#bfe8ee', c: '#9ad2da', bands: 6 },
  Neptune: { type: 'gas', a: '#2d4fb0', b: '#6f93ec', c: '#4a6fd4', bands: 8 },
  Pluto:   { type: 'rock', a: '#7a6553', b: '#e8d8c0', scale: 3, heart: true },
  Moon:    { type: 'rock', a: '#55524c', b: '#c9c4ba', scale: 5 },
};

function planetMaterial(id, sunDir = new THREE.Vector3(1, 0.3, 0.6).normalize()) {
  const look = LOOKS[id] || LOOKS.Moon;
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(look.a) }, uB: { value: new THREE.Color(look.b) }, uC: { value: new THREE.Color(look.c || look.b) },
      uSun: { value: sunDir.clone() }, uType: { value: { rock: 0, cloud: 1, gas: 2 }[look.type] },
      uScale: { value: look.scale || 3 }, uBands: { value: look.bands || 10 }, uCaps: { value: look.caps ? 1 : 0 },
      uSpot: { value: look.spot ? 1 : 0 }, uHeart: { value: look.heart ? 1 : 0 }, uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP; varying vec3 vWN;
      void main(){ vP = position; vN = normalize(position); vWN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uA, uB, uC, uSun; uniform float uType, uScale, uBands, uCaps, uSpot, uHeart, uTime;
      varying vec3 vN; varying vec3 vP; varying vec3 vWN;
      ${NOISE}
      void main(){
        vec3 n = normalize(vN); vec3 col;
        if (uType < .5) {                       // каменистая: пятна, «моря» и кратеры
          float h = fbm(n * uScale);
          float m = smoothstep(.42, .62, fbm(n * uScale * .5 + 7.0));
          col = mix(uA, uB, h * .9 + m * .25);
          float cr = smoothstep(.72, .78, noise(n * uScale * 6.0)) * .25;
          col *= 1.0 - cr;
          if (uCaps > .5) col = mix(col, vec3(.95), smoothstep(.86, .93, abs(n.y)));
          if (uHeart > .5) { vec2 q = vec2(atan(n.z, n.x), n.y * 1.6); float d = length(q - vec2(.6, .05)); col = mix(col, vec3(.96,.92,.86), 1.0 - smoothstep(.3, .5, d + .15 * fbm(n * 9.0))); }
        } else if (uType < 1.5) {               // сплошные облака (Венера)
          float h = fbm(n * uScale + vec3(uTime * .02, 0, 0));
          col = mix(uA, uB, smoothstep(.3, .8, h));
        } else {                                // газовый гигант: полосы с турбулентностью
          float lat = n.y + .08 * fbm(n * 4.0 + vec3(uTime * .01, 0, 0));
          float b = sin(lat * uBands) * .5 + .5;
          float t = fbm(vec3(n.x * 2.0, lat * 18.0, n.z * 2.0));
          col = mix(mix(uA, uB, b), uC, t * .55);
          if (uSpot > .5) { vec2 q = vec2(atan(n.z, n.x) - 1.2, (n.y + .38) * 3.2); col = mix(col, vec3(.72,.33,.2), 1.0 - smoothstep(.18, .32, length(q))); }
        }
        float light = max(dot(normalize(vWN), normalize(uSun)), 0.0);
        float rim = pow(1.0 - abs(dot(normalize(vWN), vec3(0,0,1))), 3.0) * .12;
        gl_FragColor = vec4(col * (0.06 + 1.05 * light) + rim * col, 1.0);
      }`,
  });
}

// Кольца Сатурна — полупрозрачные полосы
function saturnRings(radius) {
  const geo = new THREE.RingGeometry(radius * 1.25, radius * 2.3, 128, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - radius * 1.25) / (radius * 1.05), 0.5);
  }
  const mat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: /* glsl */`varying vec2 vUv; ${NOISE}
      void main(){ float r = vUv.x; float bands = .55 + .45 * sin(r * 90.0) * noise(vec3(r * 40.0));
        float cassini = smoothstep(.56, .58, r) * (1.0 - smoothstep(.62, .64, r));
        float a = (1.0 - cassini) * bands * smoothstep(0., .05, r) * (1.0 - smoothstep(.95, 1., r));
        gl_FragColor = vec4(mix(vec3(.75,.65,.48), vec3(.95,.88,.7), r), a * .85); }`,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

export function makePlanet(id, radius = 1, sunDir) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), planetMaterial(id, sunDir));
  group.add(mesh);
  if (LOOKS[id]?.ring) {
    const ring = saturnRings(radius);
    group.add(ring);
    group.rotation.z = THREE.MathUtils.degToRad(26.7);
  }
  if (id === 'Uranus') group.rotation.z = THREE.MathUtils.degToRad(97.8);
  group.userData.surface = mesh;
  return group;
}

export function setSunDir(planetGroup, dir) {
  planetGroup.traverse(o => { if (o.material?.uniforms?.uSun) o.material.uniforms.uSun.value.copy(dir); });
}

// ---------------------------------------------------------------------
//  Земля — текстуры портала: день, ночь, облака, блики океана
// ---------------------------------------------------------------------
export function makeEarth(loader) {
  const tex = name => { const t = loader.load(`textures/earth-${name}.jpg`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const day = tex('day'), night = tex('night'), spec = tex('spec'), clouds = tex('clouds');
  const group = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.ShaderMaterial({
    uniforms: { uDay: { value: day }, uNight: { value: night }, uSpec: { value: spec }, uSun: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uDay, uNight, uSpec; uniform vec3 uSun;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main(){
        vec3 n = normalize(vN), s = normalize(uSun);
        float d = dot(n, s);
        float dayMix = smoothstep(-0.12, 0.18, d);
        vec3 dayCol = texture2D(uDay, vUv).rgb * (0.25 + 0.95 * max(d, 0.0));
        vec3 nightCol = texture2D(uNight, vUv).rrr * vec3(1.0, 0.78, 0.45) * 1.25;
        vec3 col = mix(nightCol, dayCol, dayMix);
        float spec = texture2D(uSpec, vUv).r;
        vec3 h = normalize(s + normalize(vView));
        col += spec * pow(max(dot(n, h), 0.0), 60.0) * 0.3 * dayMix * vec3(1.0, .93, .8);
        float twilight = exp(-pow(d * 12.0, 2.0)) * .07;
        col += vec3(.9, .5, .25) * twilight;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  group.add(surface);

  const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 72), new THREE.MeshLambertMaterial({
    alphaMap: clouds, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.85,
  }));
  group.add(cloudMesh);

  // Атмосфера: светящийся ободок
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 72), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: /* glsl */`uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 v = normalize(cameraPosition - vW); float rim = pow(1.0 - abs(dot(normalize(vN), v)), 2.2);
        float lit = smoothstep(-.4, .5, dot(normalize(vW), normalize(uSun)));
        gl_FragColor = vec4(vec3(.35,.6,1.) * rim * (0.15 + .85 * lit), rim * .9); }`,
  }));
  group.add(atmo);
  group.userData = { surface, clouds: cloudMesh, atmo };
  return group;
}

export function setEarthSun(earth, dirWorld) {
  earth.userData.surface.material.uniforms.uSun.value.copy(dirWorld);
  earth.userData.atmo.material.uniforms.uSun.value.copy(dirWorld);
}

// ---------------------------------------------------------------------
//  Солнце и звёзды
// ---------------------------------------------------------------------

// Цвет абсолютно чёрного тела (приближение Таннера Хелланда), T в кельвинах
export function blackbody(T) {
  const t = Math.min(Math.max(T, 1000), 40000) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
  const c = v => Math.min(Math.max(v, 0), 255) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}
export const bvToTemp = bv => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

let glowTexture = null;
export function glowSprite(color, size) {
  if (!glowTexture) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.18, 'rgba(255,255,255,.75)');
    grad.addColorStop(.45, 'rgba(255,255,255,.18)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    glowTexture = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

export function makeStar(tempK, radius = 1) {
  const color = blackbody(tempK);
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uTime; varying vec3 vN; varying vec3 vP; ${NOISE}
      void main(){ float mu = max(dot(normalize(vN), vec3(0,0,1)), 0.0);
        float limb = 0.4 + 0.6 * pow(mu, 0.55);                    // потемнение к краю
        float gran = fbm(normalize(vP) * 18.0 + vec3(uTime * .05)); // грануляция
        vec3 col = uColor * limb * (0.85 + 0.3 * gran) + vec3(1.0) * pow(mu, 6.0) * .15;
        gl_FragColor = vec4(col, 1.0); }`,
  }));
  group.add(mesh);
  group.add(glowSprite(color, radius * 5));
  group.userData.surface = mesh;
  return group;
}

// ---------------------------------------------------------------------
//  Галактики, скопления, туманности — облака частиц
// ---------------------------------------------------------------------
const rand = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(42);
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function particleCloud(points, size = 2.2, intensity = 1) {
  const n = points.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
  points.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); col.set([p.c.r * intensity, p.c.g * intensity, p.c.b * intensity], i * 3); sz[i] = p.s ?? 1; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uSize: { value: size }, uPx: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: /* glsl */`attribute float size; uniform float uSize, uPx; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * size * uPx * (30.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5); float a = 1.0 - smoothstep(0., .5, d); gl_FragColor = vec4(vC * a, a); }',
  });
  return new THREE.Points(geo, mat);
}

export function makeGalaxy(kind, seedShift = 0) {
  for (let i = 0; i < seedShift; i++) rand();
  const pts = [];
  const core = new THREE.Color('#ffe2a8'), arm = new THREE.Color('#9fb8ff'), dust = new THREE.Color('#ff9f7a'), old = new THREE.Color('#ffcf8a');
  if (kind === 'galaxy_spiral' || kind === 'galaxy_lenticular') {
    const arms = kind === 'galaxy_spiral' ? 2 + Math.floor(rand() * 2) : 0;
    for (let i = 0; i < 1600; i++) {                   // балдж
      const r = Math.abs(gauss()) * .22;
      const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
      pts.push({ x: r * Math.sin(ph) * Math.cos(th), y: r * Math.cos(ph) * .6, z: r * Math.sin(ph) * Math.sin(th), c: core, s: 1.2 });
    }
    for (let i = 0; i < 9000; i++) {                   // диск и рукава
      const r = Math.pow(rand(), .7) * 1.1;
      let th = rand() * Math.PI * 2;
      if (arms) { const a = Math.floor(rand() * arms); th = a * 2 * Math.PI / arms + Math.log(r + .05) * 2.6 + gauss() * .28 / (r + .3); }
      const y = gauss() * .025 * (1.2 - r);
      const c = (arms && rand() < .55) ? arm.clone().lerp(core, 1 - r) : old.clone().lerp(core, .4);
      pts.push({ x: r * Math.cos(th), y, z: r * Math.sin(th), c: rand() < .05 && arms ? dust : c, s: .6 + rand() * .7 });
    }
  } else if (kind === 'galaxy_elliptical') {
    for (let i = 0; i < 9000; i++) {
      const r = Math.pow(rand(), 2.2) * 1.0, th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
      pts.push({ x: r * Math.sin(ph) * Math.cos(th), y: r * Math.cos(ph) * .62, z: r * Math.sin(ph) * Math.sin(th) * .85, c: old.clone().lerp(core, 1 - r), s: .7 + rand() * .6 });
    }
  } else {                                              // неправильная: несколько сгустков
    const clumps = Array.from({ length: 6 }, () => [gauss() * .4, gauss() * .12, gauss() * .4]);
    for (let i = 0; i < 7000; i++) {
      const [cx, cy, cz] = clumps[Math.floor(rand() * clumps.length)];
      pts.push({ x: cx + gauss() * .18, y: cy + gauss() * .08, z: cz + gauss() * .18, c: rand() < .6 ? arm : old, s: .6 + rand() * .8 });
    }
  }
  const cloud = particleCloud(pts, 1.3, 0.32);   // тысячи точек складываются — приглушаем каждую
  cloud.rotation.x = .5;
  return cloud;
}

export function makeCluster(kind) {
  const pts = [];
  const globular = kind === 'globular';
  const n = globular ? 6000 : 300;
  for (let i = 0; i < n; i++) {
    const r = globular ? Math.pow(rand(), 2.6) * 1.1 : Math.pow(rand(), .8) * 1.0;
    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
    const T = globular ? 3800 + rand() * 2500 : 6000 + rand() * 20000;
    pts.push({ x: r * Math.sin(ph) * Math.cos(th), y: r * Math.cos(ph), z: r * Math.sin(ph) * Math.sin(th), c: blackbody(T), s: globular ? .6 + rand() * .5 : 1 + rand() * 2.5 });
  }
  return particleCloud(pts, globular ? 1.2 : 2.4, globular ? 0.45 : 1);
}

export function makeNebula(kind) {
  const pts = [];
  const palette = kind === 'planetary' ? ['#5fe0d0', '#4f8cff', '#ff6f8a'] : kind === 'snr' ? ['#ff8a5c', '#7fa8ff', '#ffe08a'] : ['#ff5f8f', '#ff9a6a', '#6fa0ff'];
  const cols = palette.map(c => new THREE.Color(c));
  for (let i = 0; i < 8000; i++) {
    let x, y, z;
    if (kind === 'planetary') {           // оболочка-кольцо
      const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), r = .7 + gauss() * .06;
      x = r * Math.sin(ph) * Math.cos(th); y = r * Math.cos(ph) * .75; z = r * Math.sin(ph) * Math.sin(th);
    } else if (kind === 'snr') {          // рваная оболочка с волокнами
      const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), r = .8 + gauss() * .12 * (1 + Math.sin(th * 7) * .5);
      x = r * Math.sin(ph) * Math.cos(th); y = r * Math.cos(ph); z = r * Math.sin(ph) * Math.sin(th) * .7;
    } else {                              // диффузная туманность
      x = gauss() * .55; y = gauss() * .35; z = gauss() * .3;
      x += Math.sin(y * 6) * .15;
    }
    const c = cols[Math.floor(rand() * cols.length)].clone().multiplyScalar(.6 + rand() * .4);
    pts.push({ x, y, z, c, s: .8 + rand() * 1.4 });
  }
  const group = new THREE.Group();
  group.add(particleCloud(pts, 1.6, 0.4));
  if (kind === 'planetary' || kind === 'nebula') group.add(glowSprite(new THREE.Color('#dfe8ff'), kind === 'planetary' ? .25 : .5));
  return group;
}

// ---------------------------------------------------------------------
//  Спутник и астероид
// ---------------------------------------------------------------------
export function makeSatellite() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xc49d47, metalness: .9, roughness: .35 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1b2a55, metalness: .4, roughness: .3, emissive: 0x0a1230 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x9a968c, metalness: .7, roughness: .4 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .7), gold));
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, .02, .55), panel);
    wing.position.x = s * 1.05; g.add(wing);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .3), frame);
    arm.rotation.z = Math.PI / 2; arm.position.x = s * .32; g.add(arm);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), frame);
  dish.material.side = THREE.DoubleSide; dish.rotation.x = Math.PI; dish.position.y = -.38; g.add(dish);
  return g;
}

export function makeAsteroid(seed = 1) {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + .25 * Math.sin(v.x * 3 + seed) * Math.cos(v.y * 2.3 - seed) + .12 * Math.sin(v.z * 7 + seed * 2);
    v.multiplyScalar(k); p.setXYZ(i, v.x, v.y * .75, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a8174, roughness: .95, flatShading: true }));
}

// ---------------------------------------------------------------------
//  Мини-просмотр в карточке объекта
// ---------------------------------------------------------------------
export function createPreview(canvas, spec) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
  camera.position.set(0, .6, 4.2); camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, .35));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.2); sun.position.set(3, 1.5, 2); scene.add(sun);
  const sunDir = sun.position.clone().normalize();

  let model;
  switch (spec.type) {
    case 'planet': model = makePlanet(spec.id, 1, sunDir); if (spec.id === 'Saturn') camera.position.set(0, 1.4, 6); break;
    case 'earth': model = makeEarth(new THREE.TextureLoader()); setEarthSun(model, sunDir); break;
    case 'star': model = makeStar(spec.temp || 5800, .9); break;
    case 'galaxy': model = makeGalaxy(spec.kind, spec.seed || 0); model.scale.setScalar(1.5); break;
    case 'cluster': model = makeCluster(spec.kind); model.scale.setScalar(1.3); break;
    case 'nebula': model = makeNebula(spec.kind); model.scale.setScalar(1.5); break;
    case 'satellite': model = makeSatellite(); model.scale.setScalar(1.1); break;
    case 'asteroid': model = makeAsteroid(spec.seed || 1); model.scale.setScalar(.9); break;
    default: model = glowSprite(new THREE.Color('#ecd391'), 1.5);
  }
  scene.add(model);

  let raf = 0, alive = true;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const t0 = performance.now();
  const loop = () => {
    if (!alive) return;
    resize();
    const t = (performance.now() - t0) / 1000;
    model.rotation.y = t * (spec.type === 'galaxy' ? .08 : .25);
    model.traverse(o => { if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = t; });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => { alive = false; cancelAnimationFrame(raf); renderer.dispose(); renderer.forceContextLoss(); };
}
