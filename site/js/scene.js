// 3D-сцена: три вида на одном холсте.
//   orbit — Земля, реальные спутники, Луна и звёздный фон (1 единица = радиус Земли)
//   solar — Солнечная система по настоящим положениям планет (расстояния сжаты)
//   sky   — небо над вами сейчас: звёзды, созвездия, галактики, планеты, горизонт

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { A, observer, helioEcliptic, geoVectorKm, unitFromRaDec } from './astro.js';
import { S, eci, orbitTrack } from './sats.js';
import { makeEarth, setEarthSun, makePlanet, setSunDir, makeStar, glowSprite, blackbody, bvToTemp } from './models.js';

const R_EARTH = 6371;
const eciToThree = (p, out = new THREE.Vector3()) => out.set(p.x / R_EARTH, p.z / R_EARTH, -p.y / R_EARTH);
const eqjToThree = (v, r = 1, out = new THREE.Vector3()) => out.set(v.x * r, v.z * r, -v.y * r);

// Точка-кружок с мягким краем — общий шейдер для звёзд, спутников и объектов неба
// hard — чёткая точка с ореолом (спутники, объекты), иначе мягкое свечение (звёзды)
function dotMaterial({ additive = true, sizeScale = 1, hard = false } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uPx: { value: Math.min(devicePixelRatio, 2) }, uZoom: { value: 1 }, uScale: { value: sizeScale }, uHard: { value: hard ? 1 : 0 } },
    vertexShader: /* glsl */`attribute float size; uniform float uPx, uZoom, uScale; varying vec3 vC; varying float vS;
      void main(){ vC = color; vS = size; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPx * uZoom * uScale; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`uniform float uHard; varying vec3 vC; varying float vS;
      void main(){ float d = length(gl_PointCoord - .5) * 2.0; if (d > 1.0) discard;
        if (uHard > .5) {
          float dotA = 1.0 - smoothstep(.38, .5, d);          // ядро
          float halo = (1.0 - smoothstep(.5, 1.0, d)) * .35;  // ореол
          gl_FragColor = vec4(mix(vC, vec3(1.0), dotA * .35), max(dotA, halo));
          return;
        }
        float core = 1.0 - smoothstep(0.0, 1.0, d); float a = pow(core, 1.6);
        gl_FragColor = vec4(vC * (a + (1.0 - smoothstep(0., .35, d)) * .6), a); }`,
  });
}

function pointsFrom(items, { pos, color, size }, material) {
  const n = items.length;
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n);
  const v = new THREE.Vector3(), col = new THREE.Color();
  items.forEach((it, i) => {
    pos(it, v); p.set([v.x, v.y, v.z], i * 3);
    color(it, col); c.set([col.r, col.g, col.b], i * 3);
    s[i] = size(it);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(s, 1));
  geo.computeBoundingSphere();
  return new THREE.Points(geo, material);
}

const magToSize = m => Math.max(2, Math.min(12, 8.6 - m * 1.25));
const starColor = (ci, out) => out.copy(blackbody(bvToTemp(ci ?? 0.6))).lerp(new THREE.Color(1, 1, 1), 0.25);

const DSO_COLOR = { galaxy: '#ecd391', nebula: '#ff9ab8', cluster: '#bcd2ff', other: '#f3f0e8' };
const dsoFamily = kind => kind.startsWith('galaxy') ? 'galaxy' : ['nebula', 'planetary', 'snr'].includes(kind) ? 'nebula' : ['globular', 'open'].includes(kind) ? 'cluster' : 'other';

export function createScene(canvas, data, { onLost = () => {}, onRestored = () => {} } = {}) {
  // Видеокарту выбирает браузер: принудительная дискретная на ноутбуках чаще «падает»
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Видеокарта сбросила контекст (драйвер, нехватка памяти) — three.js восстановит его сам, мы только сообщаем
  canvas.addEventListener('webglcontextlost', () => onLost());
  canvas.addEventListener('webglcontextrestored', () => onRestored());
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x05060a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  const loader = new THREE.TextureLoader();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  // =================================================================
  //  ВИД 1. Орбита Земли
  // =================================================================
  const orbit = new THREE.Group();
  scene.add(orbit);
  const earth = makeEarth(loader);
  orbit.add(earth);
  const sunLight = new THREE.DirectionalLight(0xfff1dd, 2.2);
  orbit.add(sunLight, new THREE.AmbientLight(0x404650, 0.6));

  // Наблюдатель — золотая точка на поверхности, вращается вместе с Землёй
  const youMarker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xecd391 }));
  const youGlow = glowSprite(new THREE.Color('#ecd391'), 0.08);
  youMarker.add(youGlow);
  earth.add(youMarker);

  const moon = makePlanet('Moon', 1737.4 / R_EARTH);
  orbit.add(moon);
  const sunSprite = glowSprite(new THREE.Color('#ffe7b0'), 90);
  orbit.add(sunSprite);

  // Звёздный фон из каталога: в орбитальном виде небо «неподвижно» (инерциальная система)
  const bgStars = pointsFrom(data.stars, {
    pos: (s, v) => eqjToThree(unitFromRaDec(s.ra_deg, s.dec_deg), 1500, v),
    color: (s, c) => starColor(s.ci, c),
    size: s => magToSize(s.mag) * 0.8,
  }, dotMaterial());
  orbit.add(bgStars);

  // Спутники: одна система точек на группу
  const satLayers = new Map();    // group → { points, sats, color }
  const satPick = [];
  function setSatellites(group, sats, color) {
    const old = satLayers.get(group);
    if (old) { orbit.remove(old.points); old.points.geometry.dispose(); }
    const n = sats.length;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const c = new THREE.Color(color), cols = new Float32Array(n * 3), sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) { cols.set([c.r, c.g, c.b], i * 3); sizes[i] = group === 'stations' ? 11 : group === 'starlink' ? 5 : 8; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const points = new THREE.Points(geo, dotMaterial({ additive: false, hard: true }));
    points.frustumCulled = false;
    orbit.add(points);
    satLayers.set(group, { points, sats, color, cursor: 0 });
    satPick.length = 0;
    for (const l of satLayers.values()) satPick.push(l);
  }
  function setSatLayerVisible(group, on) {
    const l = satLayers.get(group);
    if (l) l.points.visible = on;
  }

  // Выделенный спутник: кольцо + линия орбиты
  const selRing = glowSprite(new THREE.Color('#fff1c4'), 0.12);
  selRing.visible = false;
  orbit.add(selRing);
  const trackLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xecd391, transparent: true, opacity: 0.7 }));
  trackLine.visible = false;
  orbit.add(trackLine);
  let selected = null, trackAt = 0;

  // =================================================================
  //  ВИД 2. Солнечная система
  // =================================================================
  const solar = new THREE.Group();
  solar.visible = false;
  scene.add(solar);
  const SOLAR_IDS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  const auToScene = au => 9 * Math.pow(au, 0.55);                // сжатая шкала: всё помещается, порядок сохранён
  const sizeOf = km => 0.25 + Math.pow(km / R_EARTH, 0.45) * 0.45;
  const sun3d = makeStar(5772, 2.2);
  solar.add(sun3d);
  const planets = {};
  for (const id of SOLAR_IDS) {
    const b = data.bodies.find(x => x.id === id);
    const model = id === 'Earth' ? makeEarth(loader) : makePlanet(id, sizeOf(b.radius_km));
    if (id === 'Earth') model.scale.setScalar(sizeOf(b.radius_km));
    solar.add(model);
    planets[id] = { model, body: b };
    // Орбита: настоящие положения на один период, пересчитанные в нашу шкалу
    const pts = [];
    const start = new Date(), periodMs = b.period_days * 86400e3;
    for (let i = 0; i <= 256; i++) {
      const e = helioEcliptic(id, new Date(start.getTime() + periodMs * i / 256));
      const r = Math.hypot(e.x, e.y, e.z), k = auToScene(r) / r;
      pts.push(new THREE.Vector3(e.x * k, e.z * k, -e.y * k));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xc49d47, transparent: true, opacity: id === 'Pluto' ? 0.18 : 0.3 }));
    solar.add(line);
    planets[id].orbit = line;
  }
  // Звёзды фоном и в солнечном виде
  const bgStars2 = bgStars.clone();
  solar.add(bgStars2);

  // =================================================================
  //  ВИД 3. Небо над наблюдателем
  // =================================================================
  const sky = new THREE.Group();
  sky.visible = false;
  scene.add(sky);
  const celestial = new THREE.Group();        // система J2000, поворачивается к горизонту каждый кадр
  celestial.matrixAutoUpdate = false;
  sky.add(celestial);
  const SKY_R = 500;
  const eqj = (ra, dec, r, v) => { const u = unitFromRaDec(ra, dec); return v.set(u.x * r, u.y * r, u.z * r); };

  const skyStars = pointsFrom(data.stars, {
    pos: (s, v) => eqj(s.ra_deg, s.dec_deg, SKY_R, v),
    color: (s, c) => starColor(s.ci, c),
    size: s => magToSize(s.mag),
  }, dotMaterial());
  celestial.add(skyStars);

  // Линии созвездий
  const linePts = [];
  for (const c of data.constellations) {
    if (!c.lines_json) continue;
    for (const seg of JSON.parse(c.lines_json)) {
      for (let i = 0; i + 1 < seg.length; i++) {
        linePts.push(eqj(seg[i][0], seg[i][1], SKY_R * 0.99, new THREE.Vector3()), eqj(seg[i + 1][0], seg[i + 1][1], SKY_R * 0.99, new THREE.Vector3()));
      }
    }
  }
  const conLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts),
    new THREE.LineBasicMaterial({ color: 0xc49d47, transparent: true, opacity: 0.22 }));
  celestial.add(conLines);

  // Галактики, туманности, скопления
  const dsoPoints = pointsFrom(data.dso, {
    pos: (d, v) => eqj(d.ra_deg, d.dec_deg, SKY_R * 0.98, v),
    color: (d, c) => c.set(DSO_COLOR[dsoFamily(d.kind)]),
    size: d => 7 + Math.max(0, 9 - (d.mag ?? 9)) * 0.9,
  }, dotMaterial({ additive: false, sizeScale: 0.9, hard: true }));
  celestial.add(dsoPoints);

  // Тела Солнечной системы на небе — светящиеся пятна
  const skyBodies = {};
  for (const b of data.bodies.filter(x => x.id !== 'Earth')) {
    const size = b.id === 'Sun' ? 60 : b.id === 'Moon' ? 34 : ['Jupiter', 'Venus'].includes(b.id) ? 16 : 11;
    const s = glowSprite(new THREE.Color(b.color), size);
    celestial.add(s);
    skyBodies[b.id] = s;
  }

  // Горизонт: тёмная «земля» снизу и сетка высот (не вращается)
  const ground = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * 0.9,   // ближе звёзд — закрывает то, что под горизонтом
     64, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x07070b, transparent: true, opacity: 0.86, side: THREE.BackSide, depthWrite: false }));
  sky.add(ground);
  const horizonRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 180 }, (_, i) => new THREE.Vector3(Math.cos(i / 180 * Math.PI * 2) * SKY_R, 0, Math.sin(i / 180 * Math.PI * 2) * SKY_R))),
    new THREE.LineBasicMaterial({ color: 0xc49d47, transparent: true, opacity: 0.55 }));
  sky.add(horizonRing);
  const altGrid = new THREE.Group();
  for (const alt of [30, 60]) {
    const r = Math.cos(alt * Math.PI / 180) * SKY_R, y = Math.sin(alt * Math.PI / 180) * SKY_R;
    altGrid.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 120 }, (_, i) => new THREE.Vector3(Math.cos(i / 120 * Math.PI * 2) * r, y, Math.sin(i / 120 * Math.PI * 2) * r))),
      new THREE.LineBasicMaterial({ color: 0xc49d47, transparent: true, opacity: 0.12 })));
  }
  sky.add(altGrid);

  // Спутники на небе (только видимые сейчас из станций и выделенный)
  const skySatGeo = new THREE.BufferGeometry();
  skySatGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
  skySatGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(60 * 3).fill(1), 3));
  skySatGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(60).fill(10), 1));
  const skySats = new THREE.Points(skySatGeo, dotMaterial({ additive: false, hard: true }));
  skySats.frustumCulled = false;
  sky.add(skySats);
  let skySatList = [];

  // =================================================================
  //  Переключение видов и камера
  // =================================================================
  let view = 'orbit';
  const savedCam = {};
  let started = false;
  function setView(v) {
    // запоминаем камеру уходящего вида (но не в самый первый раз — камера ещё не настроена)
    if (started && v !== view) savedCam[view] = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
    if (started && v === view) return;
    started = true;
    view = v;
    orbit.visible = v === 'orbit';
    solar.visible = v === 'solar';
    sky.visible = v === 'sky';
    const saved = savedCam[v];
    if (v === 'sky') {
      // Камера в центре сферы, смотрим на север и чуть вверх
      controls.enableZoom = false; controls.enablePan = false; controls.rotateSpeed = -0.35;
      controls.minDistance = 0.001; controls.maxDistance = 0.02;
      camera.fov = saved?.fov ?? 70;
      camera.position.copy(saved?.pos ?? new THREE.Vector3(0, -0.0035, 0.01));
      controls.target.set(0, 0, 0);
    } else {
      controls.enableZoom = true; controls.enablePan = false; controls.rotateSpeed = 0.6;
      controls.minDistance = v === 'orbit' ? 1.15 : 3;
      controls.maxDistance = v === 'orbit' ? 140 : 160;
      camera.fov = freeFov();
      camera.position.copy(saved?.pos ?? (v === 'orbit' ? new THREE.Vector3(2.2, 1.6, 3.6) : new THREE.Vector3(0, 38, 62)));
      controls.target.copy(saved?.target ?? new THREE.Vector3(0, 0, 0));
    }
    camera.updateProjectionMatrix();
    controls.update();
  }

  // Колесо мыши в небе меняет поле зрения (зум телескопа)
  canvas.addEventListener('wheel', e => {
    if (view !== 'sky') return;
    e.preventDefault();
    camera.fov = THREE.MathUtils.clamp(camera.fov * (1 + Math.sign(e.deltaY) * 0.08), 8, 100);
    camera.updateProjectionMatrix();
  }, { passive: false });

  // Плавно направить камеру на объект
  let flyTo = null;
  canvas.addEventListener('pointerdown', () => { flyTo = null; });   // человек взялся за камеру — не мешаем
  function focus(target) {
    const p = worldPosOf(target);
    if (!p) return;
    if (view === 'sky') {
      // направление пересчитываем каждый кадр: небо вращается, а поворот к горизонту обновляется в update()
      flyTo = { kind: 'sky', ref: target };
    } else {
      const dist = view === 'orbit' ? Math.max(1.6, p.length() * 1.6) : 10;
      const pos = view === 'orbit' ? p.clone().normalize().multiplyScalar(dist) : p.clone().add(new THREE.Vector3(0, 4, 8));
      flyTo = { kind: 'free', pos, target: view === 'orbit' ? new THREE.Vector3() : p.clone() };
    }
  }

  // =================================================================
  //  Обновление каждый кадр
  // =================================================================
  let lastSlow = 0;
  function update(date, speed) {
    const gmst = S.gstime(date);
    const now = performance.now();
    const slow = now - lastSlow > (speed ? 60 : 1000);   // тяжёлые расчёты — раз в секунду (или чаще при ускорении)
    if (slow) lastSlow = now;

    if (view === 'orbit') {
      earth.rotation.y = gmst;
      earth.userData.clouds.rotation.y += 0.00004;
      const sunDir = eciToThree(geoVectorKm('Sun', date), tmp).normalize();
      setEarthSun(earth, sunDir);
      sunLight.position.copy(sunDir).multiplyScalar(20);
      sunSprite.position.copy(sunDir).multiplyScalar(900);
      if (slow) {
        eciToThree(geoVectorKm('Moon', date), moon.position);
        setSunDir(moon, sunDir);
      }
      // наблюдатель на поверхности (в системе Земли)
      const la = observer.lat * Math.PI / 180, lo = observer.lon * Math.PI / 180;
      youMarker.position.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(1.002);

      // Спутники: в реальном времени — порциями, при ускорении — все сразу
      const budget = speed ? 2500 : 450;
      let used = 0;
      for (const layer of satLayers.values()) {
        if (!layer.points.visible) continue;
        const arr = layer.points.geometry.attributes.position.array;
        const n = layer.sats.length;
        const count = Math.min(n, Math.max(1, budget - used));
        for (let k = 0; k < count; k++) {
          const i = (layer.cursor + k) % n;
          const sat = layer.sats[i];
          const pv = eci(sat, date);
          if (pv) { eciToThree(pv.position, tmp2); arr[i * 3] = tmp2.x; arr[i * 3 + 1] = tmp2.y; arr[i * 3 + 2] = tmp2.z; sat.pos = [tmp2.x, tmp2.y, tmp2.z]; }
        }
        layer.cursor = (layer.cursor + count) % n;
        used += count;
        layer.points.geometry.attributes.position.needsUpdate = true;
      }
      if (selected?.type === 'sat') {
        const pv = eci(selected.sat, date);
        if (pv) { eciToThree(pv.position, selRing.position); selRing.visible = true; }
        if (now - trackAt > 20000 || speed) {
          trackAt = now;
          const pts = orbitTrack(selected.sat, date, 200).map(p => eciToThree(p, new THREE.Vector3()));
          trackLine.geometry.dispose();
          trackLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          trackLine.visible = true;
        }
      } else { selRing.visible = false; trackLine.visible = false; }
    }

    if (view === 'solar' && slow) {
      for (const [id, p] of Object.entries(planets)) {
        const e = helioEcliptic(id, date);
        const r = Math.hypot(e.x, e.y, e.z), k = auToScene(r) / r;
        p.model.position.set(e.x * k, e.z * k, -e.y * k);
        const sunDir = p.model.position.clone().negate().normalize();
        if (id === 'Earth') setEarthSun(p.model, sunDir); else setSunDir(p.model, sunDir);
        p.model.rotation.y = (date.getTime() / 3.6e6 / Math.abs(p.body.day_hours || 24)) * Math.PI * 2 * Math.sign(p.body.day_hours || 1);
      }
    }

    if (view === 'sky') {
      // Поворот J2000 → горизонт наблюдателя (x — север, y — запад, z — зенит)
      const rot = A.Rotation_EQJ_HOR(A.MakeTime(date), observer.astro).rot;
      celestial.matrix.set(
        -rot[0][1], -rot[1][1], -rot[2][1], 0,
         rot[0][2],  rot[1][2],  rot[2][2], 0,
        -rot[0][0], -rot[1][0], -rot[2][0], 0,
         0, 0, 0, 1);
      celestial.matrixWorldNeedsUpdate = true;
      if (slow) {
        const time = A.MakeTime(date), obs = observer.astro;
        for (const [id, sprite] of Object.entries(skyBodies)) {
          const eq = A.Equator(id, time, obs, false, true);
          eqj(eq.ra * 15, eq.dec, SKY_R * 0.97, sprite.position);
        }
        updateSkySats(date, gmst);
      }
      const zoom = 70 / camera.fov;
      for (const m of [skyStars.material, dsoPoints.material]) m.uniforms.uZoom.value = Math.sqrt(zoom);
    }

    if (flyTo?.kind === 'sky') {
      const p = worldPosOf(flyTo.ref);
      if (p) flyTo.pos = p.normalize().multiplyScalar(-0.01);   // камера с обратной стороны от цели — смотрит на неё через центр
    }
    if (flyTo?.pos) {
      const k = 0.08;
      camera.position.lerp(flyTo.pos, k);
      if (flyTo.target) controls.target.lerp(flyTo.target, k);
      if (camera.position.distanceTo(flyTo.pos) < (view === 'sky' ? 1e-5 : 0.01)) flyTo = null;
    }
    controls.update();
  }

  function updateSkySats(date, gmst) {
    const list = [];
    const consider = [...(satLayers.get('stations')?.sats || [])];
    if (selected?.type === 'sat' && !consider.includes(selected.sat)) consider.push(selected.sat);
    for (const sat of consider) {
      const pv = eci(sat, date);
      if (!pv) continue;
      const look = S.ecfToLookAngles(observer.gd, S.eciToEcf(pv.position, gmst));
      if (look.elevation < -0.05) continue;
      const el = look.elevation, az = look.azimuth;
      list.push({ sat, pos: new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).multiplyScalar(SKY_R * 0.95) });
      if (list.length >= 60) break;
    }
    const arr = skySatGeo.attributes.position.array;
    arr.fill(0);
    list.forEach((it, i) => arr.set([it.pos.x, it.pos.y, it.pos.z], i * 3));
    skySatGeo.attributes.position.needsUpdate = true;
    skySatGeo.setDrawRange(0, list.length);
    skySatList = list;
  }

  // =================================================================
  //  Выбор объектов: ближайший к курсору на экране
  // =================================================================
  const ndc = new THREE.Vector3();
  function screenOf(world) {
    ndc.copy(world).project(camera);
    if (ndc.z > 1 || ndc.z < -1) return null;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return { x: (ndc.x + 1) / 2 * w, y: (1 - ndc.y) / 2 * h };
  }
  // Спутник за Землёй не должен выбираться
  function hiddenByEarth(p) {
    const cam = camera.position, d = tmp.copy(p).sub(cam), len = d.length();
    d.divideScalar(len);
    const b = cam.dot(d), c = cam.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < len;
  }

  function candidates() {
    const out = [];
    if (view === 'orbit') {
      for (const layer of satPick) {
        if (!layer.points.visible) continue;
        for (const sat of layer.sats) if (sat.pos) out.push({ ref: { type: 'sat', sat }, world: tmp2.fromArray(sat.pos).clone(), r: 9, occl: true });
      }
      out.push({ ref: { type: 'body', id: 'Moon' }, world: moon.position.clone(), r: 18 });
      out.push({ ref: { type: 'body', id: 'Earth' }, world: new THREE.Vector3(), r: 0, earth: true });
    } else if (view === 'solar') {
      out.push({ ref: { type: 'body', id: 'Sun' }, world: new THREE.Vector3(), r: 26 });
      for (const [id, p] of Object.entries(planets)) out.push({ ref: { type: 'body', id }, world: p.model.position.clone(), r: 20 });
    } else if (view === 'sky') {
      const m = celestial.matrix;
      for (const [id, s] of Object.entries(skyBodies)) out.push({ ref: { type: 'body', id }, world: s.position.clone().applyMatrix4(m), r: 16, pri: 3 });
      data.dso.forEach((d, i) => out.push({ ref: { type: 'dso', row: d }, world: tmp2.fromArray(dsoPoints.geometry.attributes.position.array, i * 3).clone().applyMatrix4(m), r: 10, pri: 2 }));
      data.stars.forEach((s, i) => { if (s.mag < 4.8) out.push({ ref: { type: 'star', row: s }, world: tmp2.fromArray(skyStars.geometry.attributes.position.array, i * 3).clone().applyMatrix4(m), r: 9, pri: 1 + (s.name_ru || s.name_en ? 1 : 0) - s.mag * 0.1 }); });
      for (const it of skySatList) out.push({ ref: { type: 'sat', sat: it.sat }, world: it.pos.clone(), r: 12, pri: 3 });
    }
    return out;
  }

  function pickAt(x, y) {
    let best = null, bestScore = Infinity;
    for (const c of candidates()) {
      if (c.earth) continue;
      if (c.occl && hiddenByEarth(c.world)) continue;
      if (view === 'sky' && c.world.dot(camera.getWorldDirection(tmp)) < 0) continue;
      const s = screenOf(c.world);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > c.r) continue;
      const score = d - (c.pri || 0) * 3;
      if (score < bestScore) { bestScore = score; best = c.ref; }
    }
    // В орбитальном виде щелчок по Земле открывает карточку Земли
    if (!best && view === 'orbit') {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(x / canvas.clientWidth * 2 - 1, -(y / canvas.clientHeight) * 2 + 1), camera);
      if (ray.intersectObject(earth.userData.surface).length) best = { type: 'body', id: 'Earth' };
    }
    return best;
  }

  function worldPosOf(ref) {
    if (!ref) return null;
    if (view === 'orbit' && ref.type === 'sat' && ref.sat.pos) return new THREE.Vector3().fromArray(ref.sat.pos);
    if (view === 'orbit' && ref.type === 'body' && ref.id === 'Moon') return moon.position.clone();
    if (view === 'solar' && ref.type === 'body') return ref.id === 'Sun' ? new THREE.Vector3() : planets[ref.id]?.model.position.clone();
    if (view === 'sky') {
      const m = celestial.matrix;
      if (ref.type === 'body' && skyBodies[ref.id]) return skyBodies[ref.id].position.clone().applyMatrix4(m);
      if (ref.type === 'star' || ref.type === 'dso') return eqj(ref.row.ra_deg, ref.row.dec_deg, SKY_R, new THREE.Vector3()).applyMatrix4(m);
      if (ref.type === 'sat') return skySatList.find(s => s.sat === ref.sat)?.pos.clone() || null;
    }
    return null;
  }

  // =================================================================
  //  Подписи (HTML поверх холста)
  // =================================================================
  const labelLayer = document.createElement('div');
  labelLayer.className = 'labels';
  document.body.append(labelLayer);
  const pool = [];
  let labelsOn = true;
  function drawLabels(list) {
    let used = 0;
    if (labelsOn) for (const l of list) {
      if (!l.world) continue;
      if (l.occl && hiddenByEarth(l.world)) continue;
      if (view === 'sky' && l.world.dot(camera.getWorldDirection(tmp)) < 0) continue;
      const s = screenOf(l.world);
      if (!s || s.x < -50 || s.y < -20 || s.x > canvas.clientWidth + 50 || s.y > canvas.clientHeight + 20) continue;
      let el = pool[used];
      if (!el) { el = document.createElement('span'); el.className = 'lbl'; labelLayer.append(el); pool.push(el); }
      if (el.textContent !== l.text) el.textContent = l.text;
      el.className = 'lbl' + (l.cls ? ' ' + l.cls : '');
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      el.style.display = '';
      used++;
    }
    for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
  }

  // =================================================================
  //  Цикл отрисовки
  // =================================================================
  // На вертикальном экране телефона раскрываем поле зрения, чтобы Земля и орбиты помещались по ширине
  function freeFov() {
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    return aspect < 1 ? Math.min(72, 45 / Math.pow(aspect, 0.55)) : 45;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      if (view !== 'sky' && !warpTarget) camera.fov = freeFov();
      camera.updateProjectionMatrix();
    }
  }

  let labelsFn = () => [];
  let paused = false;
  // Прыжок при уходе на портал: поле зрения раскрывается, камера улетает вперёд
  let warp = 0, warpTarget = 0, warpFov = 45, warpLast = 0;
  function applyWarp() {
    const now = performance.now(), dt = Math.min(0.05, (now - (warpLast || now)) / 1000);
    warpLast = now;
    if (!warpTarget && warp < 0.001) return;
    warp += (warpTarget - warp) * (1 - Math.exp(-dt * 2.4));
    camera.fov = warpFov + warp * 55;
    camera.updateProjectionMatrix();
    if (view !== 'sky') camera.position.addScaledVector(camera.getWorldDirection(tmp), warp * dt * 6);
  }

  function frame(date, speed) {
    resize();
    if (paused) return;
    update(date, speed);
    applyWarp();
    sun3d.userData.surface.material.uniforms.uTime.value = performance.now() / 1000;
    renderer.render(scene, camera);
    drawLabels(labelsFn(view));
  }

  setView('orbit');

  return {
    frame, setView, focus, pickAt, setSatellites, setSatLayerVisible, worldPosOf,
    get view() { return view; },
    get satLayers() { return satLayers; },
    select(ref) { selected = ref; trackAt = 0; },
    setLabels(fn) { labelsFn = fn; },
    toggleLabels(on) { labelsOn = on; },
    setSkyLayer(name, on) {
      if (name === 'lines') conLines.visible = on;
      if (name === 'dso') dsoPoints.visible = on;
      if (name === 'grid') { altGrid.visible = on; ground.visible = on; }
      if (name === 'orbits') Object.values(planets).forEach(p => { p.orbit.visible = on; });
    },
    pause(v) { paused = v; },
    warpOut() { warpFov = camera.fov; warpTarget = 1; flyTo = null; controls.enabled = false; },
    warpReset() { warpTarget = 0; warp = 0; camera.fov = warpFov; camera.updateProjectionMatrix(); controls.enabled = true; },
    camera, canvas, renderer, three: scene,
  };
}

// Сцена-заглушка, когда WebGL недоступен: сайт работает дальше без 3D
export function createStubScene() {
  let view = 'orbit';
  const satLayers = new Map();
  return {
    frame() {}, focus() {}, select() {}, setLabels() {}, toggleLabels() {}, setSkyLayer() {}, pause() {}, warpOut() {}, warpReset() {},
    setView(v) { view = v; },
    pickAt: () => null,
    worldPosOf: () => null,
    setSatellites(group, sats, color) { satLayers.set(group, { sats, color, points: { visible: true } }); },
    setSatLayerVisible(group, on) { const l = satLayers.get(group); if (l) l.points.visible = on; },
    get view() { return view; },
    get satLayers() { return satLayers; },
    stub: true,
  };
}
