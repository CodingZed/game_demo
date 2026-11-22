import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import fontData from './fonts/helvetiker-aircraft.json' with { type: 'json' };

// The bundled font includes its original MAGENTA license and attribution.
const aircraftFont = new FontLoader().parse(fontData);

export const AIRCRAFT = [
  { id: '737', name: '波音 737-800', subtitle: '双发窄体 · 弯曲翼梢', color: '#48b6aa', emoji: '🌿', model: '737-800', length: 39.5, wingspan: 35.8, engines: 2, capacity: '约 162–189 人', fact: '737-800 长 39.5 米，翼展 35.8 米；两台发动机、弯曲翼梢与单层客舱。' },
  { id: '747', name: '波音 747-8I', subtitle: '洲际客机 · 后掠翼尖', color: '#f3ae50', emoji: '☀️', model: '747-8I', length: 76.3, wingspan: 68.4, engines: 4, capacity: '典型布局约 467 人', fact: '加长的上层客舱、后掠翼尖与四台锯齿尾缘发动机，组成 747-8I 的标志轮廓。' },
  { id: 'a380', name: '空客 A380-800', subtitle: '四发宽体 · 全长双层客舱', color: '#a095d4', emoji: '💜', model: 'A380-800', length: 72.7, wingspan: 79.8, engines: 4, capacity: '典型布局约 525 人', fact: 'A380-800 长 72.7 米，翼展 79.8 米；两层客舱贯穿机身，翼梢有上下小翼。' },
];

// Stylized, dimension-informed models; not engineering/CAD representations.
// Common coordinates: nose -Z, wings along X, up +Y. All detail is static.
export function createAircraft(id = '737', { gearDown = true } = {}) {
  const spec = AIRCRAFT.find((item) => item.id === id) || AIRCRAFT[0];
  const jumbo = spec.id === '747';
  const doubleDeck = spec.id === 'a380';
  const narrow = spec.id === '737';
  const length = narrow ? 11.8 : jumbo ? 13.2 : 12.4;
  const span = (narrow ? 10.7 : jumbo ? 11.84 : 13.6) / 2;
  const radius = narrow ? 0.565 : jumbo ? 0.61 : 0.615;
  const verticalScale = doubleDeck ? 1.22 : 1.04;
  const nose = -length / 2;
  const tail = length / 2;
  const group = new THREE.Group();
  group.name = `aircraft-${spec.id}`;
  group.userData.aircraft = spec;
  group.userData.gearDown = gearDown;
  group.userData.wheelCount = gearDown ? (narrow ? 6 : jumbo ? 18 : 22) : 0;
  group.userData.dimensions = { length, wingspan: span * 2 };

  const white = new THREE.MeshPhysicalMaterial({ color: '#f6f8fa', roughness: 0.30, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
  const wingWhite = new THREE.MeshStandardMaterial({ color: '#dce3e7', roughness: 0.43, metalness: 0.16 });
  const accent = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.38, metalness: 0.06, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: '#152d3c', roughness: 0.2, metalness: 0.3, side: THREE.DoubleSide });
  const seam = new THREE.MeshStandardMaterial({ color: '#9daeb7', roughness: 0.55, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: '#15212a', roughness: 0.8, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: '#a5b4bf', roughness: 0.32, metalness: 0.66 });
  const fanMaterial = new THREE.MeshStandardMaterial({ color: '#647783', roughness: 0.48, metalness: 0.6, side: THREE.DoubleSide });
  const lettering = new THREE.MeshStandardMaterial({ color: '#223544', roughness: 0.55, side: THREE.DoubleSide });
  const exitRed = new THREE.MeshStandardMaterial({ color: '#cf5a50', roughness: 0.65, side: THREE.DoubleSide });

  function mesh(geometry, material, parent = group, name = '') {
    const result = new THREE.Mesh(geometry, material);
    result.name = name;
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  // Interpolated sections keep the fuselage smooth, with a tapered radome and
  // tail cone. The 747 hump is part of the skin, rather than an attached bubble.
  const sections = [
    [0, 0.002], [0.009, jumbo ? 0.28 : doubleDeck ? 0.30 : 0.23],
    [0.03, jumbo ? 0.55 : doubleDeck ? 0.58 : 0.47],
    [0.06, jumbo ? 0.83 : doubleDeck ? 0.85 : 0.76], [0.10, 0.96],
    [0.145, 1], [0.73, 1], [0.81, 0.91], [0.89, 0.66], [0.96, 0.29], [1, 0.008],
  ];
  function smooth(t) { return t * t * (3 - 2 * t); }
  // Monotone Hermite tangents give a continuous slope through the nose,
  // without spline overshoot or a visible ridge at each section station.
  const intervals = sections.slice(1).map((p, i) => p[0] - sections[i][0]);
  const slopes = sections.slice(1).map((p, i) => (p[1] - sections[i][1]) / intervals[i]);
  const tangents = sections.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === sections.length - 1) return slopes.at(-1);
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    const a = 2 * intervals[i] + intervals[i - 1];
    const b = intervals[i] + 2 * intervals[i - 1];
    return (a + b) / (a / slopes[i - 1] + b / slopes[i]);
  });
  function bodyRadius(z) {
    const t = THREE.MathUtils.clamp((z - nose) / length, 0, 1);
    for (let i = 1; i < sections.length; i++) {
      if (t > sections[i][0]) continue;
      const [a, ra] = sections[i - 1];
      const [b, rb] = sections[i];
      const u = (t - a) / (b - a), u2 = u * u, u3 = u2 * u;
      return radius * ((2 * u3 - 3 * u2 + 1) * ra + (u3 - 2 * u2 + u) * (b - a) * tangents[i - 1]
        + (-2 * u3 + 3 * u2) * rb + (u3 - u2) * (b - a) * tangents[i]);
    }
    return radius * 0.008;
  }
  function hump(z) {
    if (!jumbo) return 0;
    const t = (z - nose) / length;
    const rise = smooth(THREE.MathUtils.clamp((t - 0.025) / 0.09, 0, 1));
    const fall = 1 - smooth(THREE.MathUtils.clamp((t - 0.32) / 0.16, 0, 1));
    return 0.45 * rise * fall;
  }
  function surface(z, angle, offset = 0) {
    const r = bodyRadius(z) + offset;
    const c = Math.cos(angle);
    // A gently rising tail cone avoids a blunt cylinder termination.
    const centerY = 0.12 * smooth(THREE.MathUtils.clamp(((z - nose) / length - 0.75) / 0.25, 0, 1));
    return new THREE.Vector3(r * Math.sin(angle), centerY + r * verticalScale * c + hump(z) * Math.max(0, c) ** 1.35, z);
  }
  function gridGeometry(rows, columns, sample) {
    const positions = [], uvs = [], indices = [];
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= columns; col++) {
        const p = sample(row / rows, col / columns);
        positions.push(p.x, p.y, p.z);
        uvs.push(col / columns, row / rows);
        if (row < rows && col < columns) {
          const a = row * (columns + 1) + col;
          indices.push(a, a + columns + 1, a + 1, a + 1, a + columns + 1, a + columns + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  mesh(gridGeometry(128, 64, (u, v) => surface(nose + u * length, v * Math.PI * 2)), white, group, 'fuselage');
  // The livery follows the underside, leaving the cabin and nose predominantly white.
  mesh(gridGeometry(90, 24, (u, v) => surface(nose + 1.35 + u * (length - 1.65), 1.96 + v * 2.36, 0.007)), accent, group, 'belly-livery');

  function roundedRect(w, h, r = 0.02) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function sidePoint(side, z, y, offset = 0.009) {
    let lo = 0, hi = Math.PI;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (surface(z, mid).y > y) lo = mid; else hi = mid;
    }
    const p = surface(z, (lo + hi) / 2, offset);
    p.x *= side;
    p.y = y;
    return p;
  }
  function sideDecal(side, z, y, shape, material, name) {
    const geometry = new THREE.ShapeGeometry(shape, 5);
    const points = geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const p = sidePoint(side, z + points.getX(i), y + points.getY(i));
      points.setXYZ(i, p.x, p.y, p.z);
    }
    geometry.computeVertexNormals();
    return mesh(geometry, material, group, name);
  }
  function sideFrame(side, z, y, w, h, material = seam) {
    const shape = roundedRect(w, h, Math.min(0.025, w * 0.2));
    const hole = roundedRect(w - 0.014, h - 0.014, Math.min(0.02, w * 0.17));
    shape.holes.push(hole);
    return sideDecal(side, z, y, shape, material, 'door-frame');
  }
  const doorZ = narrow ? [nose + 1.8, -0.58, -0.16, tail - 2.0]
    : jumbo ? [nose + 1.85, nose + 3.85, 0.55, 2.7, tail - 2.0]
      : [nose + 1.7, nose + 3.35, -0.55, 1.5, tail - 2.0];
  const windowY = narrow ? 0.17 : jumbo ? 0.12 : -0.025;
  const spacing = narrow ? 0.175 : 0.15;
  const windowShape = roundedRect(narrow ? 0.072 : 0.065, narrow ? 0.105 : 0.092, 0.022);
  for (const side of [-1, 1]) {
    for (let z = nose + 1.98; z < tail - 2.0; z += spacing) {
      if (doorZ.some((door) => Math.abs(z - door) < 0.12)) continue;
      sideDecal(side, z, windowY, windowShape, glass, 'cabin-window');
    }
    if (doubleDeck || jumbo) {
      const upperY = doubleDeck ? 0.40 : 0.78;
      const upperEnd = doubleDeck ? tail - 2.05 : nose + 4.7;
      for (let z = nose + 1.95; z < upperEnd; z += spacing) {
        if (doubleDeck && doorZ.some((door) => Math.abs(z - door) < 0.13)) continue;
        if (jumbo && Math.abs(z - (nose + 4.25)) < 0.15) continue;
        sideDecal(side, z, upperY, windowShape, glass, 'upper-deck-window');
      }
      if (jumbo) sideFrame(side, nose + 4.25, 0.70, 0.19, 0.36);
    }
    doorZ.forEach((z, i) => {
      const overwing = narrow && (i === 1 || i === 2);
      const doorY = overwing ? 0.10 : windowY - 0.15;
      sideFrame(side, z, doorY, overwing ? 0.17 : 0.20, overwing ? 0.29 : 0.49);
      sideDecal(side, z, doorY + (overwing ? 0.03 : 0.12), roundedRect(0.065, 0.075, 0.015), glass, 'door-window');
      sideDecal(side, z + 0.056, doorY - 0.035, roundedRect(0.046, 0.009, 0.003), seam, 'door-handle');
      sideDecal(side, z, doorY + (overwing ? 0.17 : 0.28), roundedRect(0.072, 0.013, 0.002), exitRed, 'exit-marker');
      if (doubleDeck) {
        sideFrame(side, z, 0.38, 0.18, 0.34);
        sideDecal(side, z, 0.42, roundedRect(0.06, 0.063, 0.015), glass, 'upper-door-window');
      }
    });
  }

  function fuselageText(text, side, centerZ, baselineY, height, maximumWidth, material = lettering) {
    const geometry = new THREE.ShapeGeometry(aircraftFont.generateShapes(text, height), 3);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const width = bounds.max.x - bounds.min.x;
    const scaleX = Math.min(1, maximumWidth / width);
    const midpoint = (bounds.max.x + bounds.min.x) / 2;
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const z = centerZ - side * (positions.getX(i) - midpoint) * scaleX;
      const y = baselineY + positions.getY(i);
      const p = sidePoint(side, z, y, 0.012);
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    geometry.computeVertexNormals();
    mesh(geometry, material, group, 'livery-lettering');
  }
  for (const side of [-1, 1]) {
    // A narrow colored cheatline and companion pinstripe run below the windows.
    for (const [y, width, material] of [[windowY - 0.11, 0.035, accent], [windowY - 0.17, 0.009, lettering]]) {
      mesh(gridGeometry(90, 1, (u, v) => {
        const z = nose + 1.55 + u * (length - 3.15);
        return sidePoint(side, z, y + (v - 0.5) * width, 0.010);
      }), material, group, 'fuselage-cheatline');
    }
    fuselageText('LITTLE SKY AIR', side, nose + 3.13, doubleDeck ? 0.18 : 0.34, narrow ? 0.14 : 0.15, 2.15);
    fuselageText(narrow ? 'LS-738' : jumbo ? 'LS-748' : 'LS-380', side, tail - 2.65,
      doubleDeck ? 0.22 : 0.31, 0.067, 0.58);
    fuselageText(spec.model.toUpperCase(), side, nose + 1.39, windowY - 0.29, 0.047, 0.55);
  }

  // Compact sloped panes sit on the flight deck, leaving a rounded white
  // radome below. The 747 cockpit is raised into its upper deck.
  for (const side of [-1, 1]) {
    const panes = jumbo ? [[0.025, 0.28], [0.31, 0.51], [0.54, 0.74]]
      : [[0.025, 0.35], [0.39, 0.65], [0.69, 0.96]];
    for (const [a, b] of panes) {
      const front = jumbo ? 0.95 : doubleDeck ? 0.37 : 0.67;
      const back = jumbo ? 1.14 : doubleDeck ? 0.53 : 0.85;
      const pane = gridGeometry(3, 4, (u, v) => {
        const angle = THREE.MathUtils.lerp(a, b, v);
        const z = nose + THREE.MathUtils.lerp(front, back, u) + angle * 0.30;
        const p = surface(z, angle + 0.10 * (1 - u), 0.013);
        p.x *= side;
        return p;
      });
      mesh(pane, glass, group, 'cockpit-windshield');
    }
  }

  function tube(points, material = seam, width = 0.004, parent = group, name = 'panel-seam') {
    const curve = new THREE.CatmullRomCurve3(points);
    return mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), width, 4, false), material, parent, name);
  }
  for (const z of [nose + 0.55, tail - 1.9]) {
    const points = Array.from({ length: 49 }, (_, i) => surface(z, i / 48 * Math.PI * 2, 0.006));
    tube(points, seam, 0.003);
  }
  // Small static antenna fairings are visible when the camera is close.
  for (const z of [-0.7, 2.7]) {
    const antenna = mesh(new THREE.BoxGeometry(0.026, 0.13, 0.16), white, group, 'antenna');
    antenna.position.set(0, surface(z, 0).y + 0.05, z);
    antenna.rotation.x = 0.24;
  }

  function horizontalPrism(points, y, thickness, material, dihedral = 0, name = '') {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: true, bevelSegments: 1,
      steps: 1, bevelSize: 0.012, bevelThickness: 0.009,
    });
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, positions.getY(i) + y + Math.abs(positions.getX(i)) * dihedral);
    }
    geometry.computeVertexNormals();
    return mesh(geometry, material, group, name);
  }
  function polygon(points, material, name = '', parent = group) {
    const geometry = new THREE.BufferGeometry();
    const positions = [], uv = [], indices = [];
    points.forEach(([x, y, z], i) => { positions.push(x, y, z); uv.push(i % 2, i > 1 ? 1 : 0); });
    for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return mesh(geometry, material, parent, name);
  }
  const wingY = -0.23;
  const wingSlope = doubleDeck ? 0.065 : 0.055;
  const tipLeading = narrow ? 1.85 : jumbo ? 2.45 : 1.8;
  const tipTrailing = tipLeading + (doubleDeck ? 0.59 : jumbo ? 0.34 : 0.46);
  function wingChord(x) {
    x = Math.abs(x);
    let leading;
    if (x <= 1.3) leading = THREE.MathUtils.lerp(-1.30, -1.08, (x - 0.4) / 0.9);
    else if (jumbo && x > span - 0.72) leading = THREE.MathUtils.lerp(1.64, tipLeading, (x - span + 0.72) / 0.72);
    else leading = THREE.MathUtils.lerp(-1.08, jumbo ? 1.64 : tipLeading,
      (x - 1.3) / (span - (jumbo ? 0.72 : 0) - 1.3));
    let trailing;
    if (x < span * 0.44) trailing = THREE.MathUtils.lerp(2.02, 1.62, (x - 0.4) / (span * 0.44 - 0.4));
    else if (jumbo && x > span - 0.72) trailing = THREE.MathUtils.lerp(2.44, tipTrailing, (x - span + 0.72) / 0.72);
    else trailing = THREE.MathUtils.lerp(1.62, jumbo ? 2.44 : tipTrailing,
      (x - span * 0.44) / (span * 0.56 - (jumbo ? 0.72 : 0)));
    return { leading, trailing };
  }
  function wingHeight(x, chordFraction, upper = true) {
    x = Math.abs(x);
    const u = THREE.MathUtils.clamp(chordFraction, 0, 1);
    const { leading, trailing } = wingChord(x);
    const chord = trailing - leading;
    const thicknessRatio = THREE.MathUtils.lerp(0.048, 0.035, x / span);
    const thickness = 5 * thicknessRatio * chord * (0.2969 * Math.sqrt(u) - 0.126 * u
      - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const camber = 0.012 * chord * 4 * u * (1 - u);
    return wingY + x * wingSlope + (jumbo ? 0.08 : 0.035) * (x / span) ** 4
      + camber + (upper ? thickness : -thickness);
  }
  function wingTop(x, z) {
    const { leading, trailing } = wingChord(x);
    return wingHeight(x, z === undefined ? 0.5 : (z - leading) / (trailing - leading)) + 0.004;
  }
  for (const side of [-1, 1]) {
    // Closed cambered airfoil skins replace the previous flat extruded plate.
    for (const upper of [true, false]) {
      const geometry = gridGeometry(24, 32, (u, v) => {
        const x = 0.4 + u * (span - 0.4);
        const { leading, trailing } = wingChord(x);
        return new THREE.Vector3(side * x, wingHeight(x, v, upper), THREE.MathUtils.lerp(leading, trailing, v));
      });
      if ((side > 0) === upper) {
        const index = geometry.index.array;
        for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
        geometry.computeVertexNormals();
      }
      mesh(geometry, wingWhite, group, upper ? 'main-wing-upper' : 'main-wing-lower');
    }
    mesh(gridGeometry(1, 32, (u, v) => new THREE.Vector3(side * span,
      THREE.MathUtils.lerp(wingHeight(span, v, false), wingHeight(span, v, true), u),
      THREE.MathUtils.lerp(tipLeading, tipTrailing, v))), wingWhite, group, 'wing-tip-cap');
    const leadingPoints = Array.from({ length: 22 }, (_, i) => {
      const x = 1.32 + (span - 1.36) * i / 21;
      const z = wingChord(x).leading + 0.024;
      return new THREE.Vector3(side * x, wingTop(x, z), z);
    });
    tube(leadingPoints, metal, 0.009, group, 'leading-edge-metal');
    for (const fraction of [0.31, 0.47, 0.63, 0.79]) {
      const x = span * fraction;
      const { leading, trailing } = wingChord(x);
      const points = Array.from({ length: 12 }, (_, i) => {
        const z = THREE.MathUtils.lerp(leading + 0.08, trailing - 0.03, i / 11);
        return new THREE.Vector3(side * x, wingTop(x, z), z);
      });
      tube(points, seam, 0.0025);
      const fairing = mesh(new THREE.SphereGeometry(1, 16, 8), white, group, 'flap-track-fairing');
      fairing.position.set(side * x, wingTop(x, trailing) - 0.09, trailing - 0.05);
      fairing.scale.set(0.045, 0.05, narrow ? 0.27 : 0.33);
    }
    for (const chordFraction of [0.16, 0.72]) {
      const points = Array.from({ length: 24 }, (_, i) => {
        const x = 0.78 + (span - 0.99) * i / 23;
        const { leading, trailing } = wingChord(x);
        const z = THREE.MathUtils.lerp(leading, trailing, chordFraction);
        return new THREE.Vector3(side * x, wingTop(x, z), z);
      });
      tube(points, seam, 0.003);
    }
    const tipY = wingTop(span);
    if (narrow) {
      polygon([
        [side * (span - 0.22), tipY - 0.01, tipLeading - 0.04],
        [side * (span - 0.08), tipY + 0.16, tipLeading + 0.03],
        [side * span, tipY + 0.74, tipLeading + 0.36],
        [side * span, tipY + 0.78, tipLeading + 0.57],
        [side * (span - 0.09), tipY + 0.12, tipTrailing + 0.03],
        [side * (span - 0.22), tipY - 0.01, tipTrailing],
      ], accent, 'blended-winglet');
    } else if (jumbo) {
      // 747-8 has raked tips, not the upright winglets of the 747-400.
      mesh(gridGeometry(5, 12, (u, v) => {
        const x = span - 0.38 + u * 0.38;
        const { leading, trailing } = wingChord(x);
        return new THREE.Vector3(side * x, wingHeight(x, v, true) + 0.006, THREE.MathUtils.lerp(leading, trailing, v));
      }), accent, group, 'raked-wingtip');
    } else {
      polygon([
        [side * span, tipY - 0.30, tipLeading + 0.38],
        [side * span, tipY + 0.32, tipLeading + 0.19],
        [side * span, tipY + 0.33, tipTrailing - 0.03],
        [side * span, tipY - 0.28, tipTrailing + 0.09],
      ], accent, 'wingtip-fence');
    }
    const tailSpan = narrow ? 1.83 : jumbo ? 2.13 : 2.15;
    horizontalPrism([
      [side * 0.23, tail - 2.00], [side * tailSpan, tail - 0.70],
      [side * tailSpan, tail - 0.27], [side * 0.22, tail - 0.45],
    ], 0.21, 0.055, wingWhite, 0.07, 'horizontal-stabilizer');
    tube([
      new THREE.Vector3(side * 0.36, 0.30, tail - 0.73),
      new THREE.Vector3(side * (tailSpan - 0.05), 0.28 + tailSpan * 0.07, tail - 0.43),
    ], seam, 0.004);
  }

  const finHeight = narrow ? 2.52 : jumbo ? 2.07 : 2.69;
  const finShape = new THREE.Shape();
  finShape.moveTo(tail - 2.22, 0.33);
  finShape.lineTo(tail - 0.83, finHeight);
  finShape.lineTo(tail - 0.27, finHeight + 0.015);
  finShape.lineTo(tail - 0.12, 0.28);
  finShape.closePath();
  const fin = mesh(new THREE.ExtrudeGeometry(finShape, {
    depth: 0.10, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 2,
  }), accent, group, 'vertical-stabilizer');
  fin.rotation.y = -Math.PI / 2;
  fin.position.x = 0.05;
  for (const side of [-1, 1]) {
    // Fictional swept feather insignia; no real airline branding.
    polygon([
      [side * 0.075, finHeight * 0.46, tail - 1.35], [side * 0.075, finHeight * 0.54, tail - 1.34],
      [side * 0.075, finHeight * 0.79, tail - 0.47], [side * 0.075, finHeight * 0.66, tail - 0.64],
    ], white, 'tail-insignia');
    polygon([
      [side * 0.076, finHeight * 0.39, tail - 1.05], [side * 0.076, finHeight * 0.45, tail - 1.02],
      [side * 0.076, finHeight * 0.60, tail - 0.49], [side * 0.076, finHeight * 0.50, tail - 0.64],
    ], white, 'tail-insignia');
    const tailText = new THREE.ShapeGeometry(aircraftFont.generateShapes('LS', 0.11), 3);
    tailText.computeBoundingBox();
    const labelCenter = (tailText.boundingBox.min.x + tailText.boundingBox.max.x) / 2;
    const labelPoints = tailText.attributes.position;
    for (let i = 0; i < labelPoints.count; i++) {
      const z = tail - 0.64 - side * (labelPoints.getX(i) - labelCenter);
      labelPoints.setXYZ(i, side * 0.076, finHeight * 0.85 + labelPoints.getY(i), z);
    }
    tailText.computeVertexNormals();
    mesh(tailText, white, group, 'tail-identifier');
    tube([
      new THREE.Vector3(side * 0.075, 0.55, tail - 0.45),
      new THREE.Vector3(side * 0.075, finHeight - 0.1, tail - 0.43),
    ], seam, 0.004);
  }

  function engine(x, z, size, engineIndex) {
    const engineGroup = new THREE.Group();
    engineGroup.name = `engine-${engineIndex}`;
    engineGroup.userData.isEngine = true;
    engineGroup.position.set(x, narrow ? -0.64 : -0.82 + Math.abs(x) * 0.035, z);
    group.add(engineGroup);
    const engineLength = narrow ? 1.30 : 1.35;
    const flatten = (geometry) => {
      if (!narrow) return geometry;
      const p = geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, Math.max(p.getY(i), -size * 0.78));
      geometry.computeVertexNormals();
      return geometry;
    };
    // Open-ended nacelles: the intake and exhaust have real depth, with no
    // bright cylinder caps obscuring their recessed fan and exhaust cone.
    const shell = new THREE.CylinderGeometry(size * 0.82, size, engineLength, 48, 2, true);
    shell.rotateX(Math.PI / 2);
    if (jumbo) {
      const positions = shell.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        if (positions.getZ(i) < engineLength / 2 - 0.001) continue;
        const theta = (Math.atan2(positions.getY(i), positions.getX(i)) + Math.PI) / (Math.PI * 2);
        const fraction = (theta * 12) % 1;
        positions.setZ(i, engineLength / 2 - 0.055 + (1 - Math.abs(2 * fraction - 1)) * 0.12);
      }
      shell.computeVertexNormals();
    }
    mesh(flatten(shell), white, engineGroup, 'nacelle');
    const lip = new THREE.TorusGeometry(size * 0.947, size * 0.055, 10, 48);
    lip.translate(0, 0, -engineLength / 2);
    mesh(flatten(lip), metal, engineGroup, 'intake-lip');
    const liner = new THREE.LatheGeometry([
      new THREE.Vector2(size * 0.89, -engineLength / 2),
      new THREE.Vector2(size * 0.83, -0.34),
    ], 48);
    liner.rotateX(Math.PI / 2);
    mesh(flatten(liner), dark, engineGroup, 'intake-liner');
    const fan = new THREE.CircleGeometry(size * 0.82, 48);
    fan.rotateY(Math.PI); fan.translate(0, 0, -0.335);
    mesh(flatten(fan), dark, engineGroup, 'fan-backplate');
    const fanPositions = [], fanUvs = [];
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI * 2 / 24;
      const points = [[0.2, angle], [0.80, angle + 0.15], [0.79, angle + 0.25], [0.22, angle + 0.19]]
        .map(([r, a]) => [Math.sin(a) * size * r, Math.cos(a) * size * r, -0.355 - r * 0.035]);
      for (const index of [0, 1, 2, 0, 2, 3]) { fanPositions.push(...points[index]); fanUvs.push(0, 0); }
    }
    const fanGeometry = new THREE.BufferGeometry();
    fanGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fanPositions, 3));
    fanGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(fanUvs, 2)); fanGeometry.computeVertexNormals();
    mesh(flatten(fanGeometry), fanMaterial, engineGroup, 'fan-blades');
    const spinner = mesh(new THREE.ConeGeometry(size * 0.2, size * 0.48, 24), metal, engineGroup, 'fan-spinner');
    spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.42;
    const pylonShape = new THREE.Shape();
    const pylonTop = wingY + Math.abs(x) * wingSlope - engineGroup.position.y + 0.03;
    pylonShape.moveTo(-0.24, size * 0.75);
    pylonShape.lineTo(0.08, pylonTop);
    pylonShape.lineTo(0.68, pylonTop);
    pylonShape.lineTo(0.53, size * 0.75);
    pylonShape.closePath();
    const pylon = mesh(new THREE.ExtrudeGeometry(pylonShape, { depth: 0.10, bevelEnabled: false }), wingWhite, engineGroup, 'pylon');
    pylon.rotation.y = -Math.PI / 2; pylon.position.x = 0.05;
    const exhaustLip = mesh(new THREE.TorusGeometry(size * 0.75, size * 0.065, 8, 40), metal, engineGroup, 'exhaust-rim');
    exhaustLip.position.z = engineLength / 2;
    const exhaust = mesh(new THREE.CircleGeometry(size * 0.73, 40), dark, engineGroup, 'exhaust-interior');
    exhaust.position.z = engineLength / 2 - 0.04;
    const cone = mesh(new THREE.ConeGeometry(size * 0.36, 0.42, 24), fanMaterial, engineGroup, 'exhaust-cone');
    cone.rotation.x = Math.PI / 2; cone.position.z = engineLength / 2 + 0.04;
    for (const seamZ of [-0.43, 0.35]) {
      const ring = new THREE.TorusGeometry(size * (0.91 - seamZ * 0.14), 0.003, 4, 40);
      ring.translate(0, 0, seamZ);
      mesh(flatten(ring), seam, engineGroup, 'nacelle-panel-seam');
    }
    const warning = mesh(new THREE.TorusGeometry(size * 0.98, 0.006, 4, 40), exitRed, engineGroup, 'intake-warning-stripe');
    warning.position.z = -0.56;
    const hatch = mesh(new THREE.BoxGeometry(0.01, 0.07, 0.14), seam, engineGroup, 'nacelle-service-hatch');
    hatch.position.set(Math.sign(x) * size * 0.92, -0.02, 0.13);
  }
  if (narrow) {
    engine(-1.85, -0.72, 0.405, 1);
    engine(1.85, -0.72, 0.405, 2);
  } else {
    let i = 0;
    for (const side of [-1, 1]) {
      engine(side * 2.05, -0.65, doubleDeck ? 0.465 : 0.385, ++i);
      engine(side * (doubleDeck ? 4.18 : 3.87), 0.54, doubleDeck ? 0.445 : 0.365, ++i);
    }
  }
  if (gearDown) {
    const gear = new THREE.Group();
    gear.name = 'landing-gear';
    group.add(gear);
    const rubber = new THREE.MeshStandardMaterial({ color: '#192026', roughness: 0.88 });
    const tread = new THREE.MeshStandardMaterial({ color: '#090e13', roughness: 0.95 });
    const groundY = narrow ? -1.17 : jumbo ? -1.28 : -1.40;
    group.userData.gearContactY = groundY;
    function strut(start, end, radius, material = metal, name = 'landing-gear-strut') {
      return mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(...start), new THREE.Vector3(...end)), 1, radius, 12, false), material, gear, name);
    }
    function wheel(x, y, z, radius) {
      const tire = mesh(new THREE.TorusGeometry(radius * 0.73, radius * 0.27, 12, 32), rubber, gear, 'landing-gear-tire');
      tire.rotation.y = Math.PI / 2;
      tire.position.set(x, y, z);
      tire.userData.isWheel = true;
      // Tread channels are narrow rings on the tire, while hubs and bolts remain
      // separate metal surfaces for convincing close-up light and shadow.
      for (const offset of [-0.025, 0, 0.025]) {
        const groove = mesh(new THREE.TorusGeometry(radius * 0.985, 0.0025, 4, 32), tread, gear, 'tire-tread');
        groove.rotation.y = Math.PI / 2;
        groove.position.set(x + offset, y, z);
      }
      for (const side of [-1, 1]) {
        const hubX = x + side * radius * 0.26;
        const hub = mesh(new THREE.CircleGeometry(radius * 0.49, 24), metal, gear, 'wheel-hub');
        hub.rotation.y = side * Math.PI / 2;
        hub.position.set(hubX, y, z);
        const ring = mesh(new THREE.TorusGeometry(radius * 0.48, 0.006, 6, 24), fanMaterial, gear, 'wheel-hub-rim');
        ring.rotation.y = Math.PI / 2;
        ring.position.copy(hub.position);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          const bolt = mesh(new THREE.SphereGeometry(0.007, 6, 4), metal, gear, 'wheel-hub-bolt');
          bolt.position.set(hubX + side * 0.004, y + Math.sin(angle) * radius * 0.28, z + Math.cos(angle) * radius * 0.28);
        }
      }
    }
    const noseRadius = narrow ? 0.105 : 0.095;
    const noseZ = nose + (narrow ? 1.65 : 1.72);
    const noseAxleY = groundY + noseRadius;
    const noseWheelX = narrow ? 0.082 : 0.074;
    wheel(-noseWheelX, noseAxleY, noseZ, noseRadius);
    wheel(noseWheelX, noseAxleY, noseZ, noseRadius);
    strut([-noseWheelX - 0.035, noseAxleY, noseZ], [noseWheelX + 0.035, noseAxleY, noseZ], 0.024);
    strut([0, -0.38, noseZ - 0.07], [0, noseAxleY, noseZ], 0.035, white);
    strut([0, -0.79, noseZ - 0.02], [0, noseAxleY + 0.02, noseZ], 0.024);
    strut([0, -0.39, noseZ + 0.36], [0, noseAxleY + 0.14, noseZ], 0.022, metal, 'nose-gear-drag-brace');
    for (const side of [-1, 1]) {
      polygon([[side * 0.15, -0.42, noseZ - 0.23], [side * 0.15, -0.42, noseZ + 0.25],
        [side * 0.19, -0.78, noseZ + 0.22], [side * 0.19, -0.78, noseZ - 0.20]], white, 'nose-gear-door', gear);
    }
    function bogie(x, z, axles, bodyGear = false) {
      const radius = narrow ? 0.16 : 0.14;
      const axleY = groundY + radius;
      const halfWidth = narrow ? 0.14 : 0.12;
      const axleSpacing = narrow ? 0 : 0.28;
      const startZ = z - (axles - 1) * axleSpacing / 2;
      for (let axle = 0; axle < axles; axle++) {
        const wheelZ = startZ + axle * axleSpacing;
        for (const side of [-1, 1]) wheel(x + side * halfWidth, axleY, wheelZ, radius);
        strut([x - halfWidth - 0.045, axleY, wheelZ], [x + halfWidth + 0.045, axleY, wheelZ], 0.036);
      }
      if (axles > 1) strut([x, axleY + 0.025, startZ - 0.06], [x, axleY + 0.025, startZ + (axles - 1) * axleSpacing + 0.06], 0.045, fanMaterial, 'bogie-beam');
      const upperY = bodyGear ? -0.44 : -0.19;
      strut([x, upperY, z - 0.10], [x, axleY + 0.08, z], 0.045, white, 'main-gear-oleo');
      strut([x, axleY + 0.38, z - 0.025], [x, axleY + 0.07, z], 0.029);
      strut([x - Math.sign(x) * 0.26, upperY, z - 0.24], [x, axleY + 0.21, z], 0.026, metal, 'main-gear-side-brace');
      strut([x, upperY, z + 0.34], [x, axleY + 0.20, z], 0.022, metal, 'main-gear-drag-brace');
      const side = Math.sign(x);
      polygon([[x + side * 0.065, upperY - 0.06, z - 0.18], [x + side * 0.065, upperY - 0.06, z + 0.24],
        [x + side * 0.10, axleY + 0.22, z + 0.19], [x + side * 0.10, axleY + 0.22, z - 0.15]], white, 'main-gear-door', gear);
    }
    for (const side of [-1, 1]) {
      if (narrow) bogie(side * 0.91, 0.83, 1);
      else {
        bogie(side * (doubleDeck ? 1.22 : 1.13), 1.35, 2);
        bogie(side * 0.43, 2.05, doubleDeck ? 3 : 2, true);
      }
    }
  }

  const red = new THREE.MeshStandardMaterial({ color: '#e44d49', emissive: '#c93632', emissiveIntensity: 0.25 });
  const green = new THREE.MeshStandardMaterial({ color: '#4ba88d', emissive: '#368c73', emissiveIntensity: 0.25 });
  for (const side of [-1, 1]) {
    const light = mesh(new THREE.SphereGeometry(0.038, 10, 8), side < 0 ? red : green, group, 'navigation-light');
    light.position.set(side * (span - 0.03), wingTop(span) + 0.01, tipLeading + 0.065);
  }
  return group;
}
