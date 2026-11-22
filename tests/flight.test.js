import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LIMITS, DIFFICULTIES, moveTarget, insideRing, ringPosition,
  obstaclePosition, advanceRingProgress,
} from '../src/flight.js';
import { AIRCRAFT, createAircraft } from '../src/aircraft.js';

test('holding controls keeps the plane inside the playable sky', () => {
  const target = { x: 0, y: 3 };
  for (let frame = 0; frame < 1200; frame++) {
    moveTarget(target, { x: 1, y: 1 }, 1 / 60);
    assert.ok(target.x <= LIMITS.x);
    assert.ok(target.y <= LIMITS.maxY);
  }
  assert.equal(target.x, LIMITS.x);
  assert.equal(target.y, LIMITS.maxY);
  for (let frame = 0; frame < 1200; frame++) {
    moveTarget(target, { x: -1, y: -1 }, 1 / 60);
    assert.ok(target.x >= -LIMITS.x);
    assert.ok(target.y >= LIMITS.minY);
  }
  assert.equal(target.x, -LIMITS.x);
  assert.equal(target.y, LIMITS.minY);
});

test('movement is consistent across frame rates', () => {
  const at30fps = { x: 0, y: 3 };
  const at120fps = { x: 0, y: 3 };
  for (let frame = 0; frame < 15; frame++) moveTarget(at30fps, { x: 1, y: -0.5 }, 1 / 30);
  for (let frame = 0; frame < 60; frame++) moveTarget(at120fps, { x: 1, y: -0.5 }, 1 / 120);
  assert.ok(Math.abs(at30fps.x - at120fps.x) < 1e-10);
  assert.ok(Math.abs(at30fps.y - at120fps.y) < 1e-10);
  assert.ok(at30fps.x > 0 && at30fps.y < 3);
});

test('released controls and a paused timestep do not move the target', () => {
  const target = { x: 12.345, y: -4.567 };
  for (let frame = 0; frame < 1000; frame++) moveTarget(target, { x: 0, y: 0 }, 1 / 60);
  assert.deepEqual(target, { x: 12.345, y: -4.567 });
  moveTarget(target, { x: 1, y: -1 }, 0);
  assert.deepEqual(target, { x: 12.345, y: -4.567 });
});

test('difficulty increases speed and obstacle density, with movement only on hard', () => {
  assert.deepEqual(DIFFICULTIES.map(({ id }) => id), ['easy', 'normal', 'hard']);
  for (let i = 1; i < DIFFICULTIES.length; i++) {
    assert.ok(DIFFICULTIES[i].speed > DIFFICULTIES[i - 1].speed);
    assert.ok(DIFFICULTIES[i].obstacleSpacing < DIFFICULTIES[i - 1].obstacleSpacing);
    assert.ok(DIFFICULTIES[i].obstacleCount > DIFFICULTIES[i - 1].obstacleCount);
    assert.ok(DIFFICULTIES[i].obstacleRadius > DIFFICULTIES[i - 1].obstacleRadius);
    assert.ok(-DIFFICULTIES[i].firstObstacleZ / DIFFICULTIES[i].speed
      < -DIFFICULTIES[i - 1].firstObstacleZ / DIFFICULTIES[i - 1].speed,
    'higher difficulties allow less time before the first obstacle');
    assert.ok(DIFFICULTIES[i].ringTolerance < DIFFICULTIES[i - 1].ringTolerance);
  }
  assert.ok(DIFFICULTIES[2].speed >= DIFFICULTIES[0].speed * 3);
  assert.ok(DIFFICULTIES[0].obstacleSpacing >= DIFFICULTIES[2].obstacleSpacing * 4);
  assert.deepEqual(DIFFICULTIES.map(({ moving }) => moving), [false, false, true]);
  assert.deepEqual(DIFFICULTIES.map(({ motionAmplitude }) => motionAmplitude), [0, 0, 3.5]);
});

test('ring precision visibly tightens across the three difficulties', () => {
  const ring = { x: 0, y: 3 };
  const [easy, normal, hard] = DIFFICULTIES;
  assert.equal(insideRing({ x: 6, y: 3 }, ring, easy.ringTolerance), true);
  assert.equal(insideRing({ x: 6, y: 3 }, ring, normal.ringTolerance), false);
  assert.equal(insideRing({ x: 5, y: 3 }, ring, normal.ringTolerance), true);
  assert.equal(insideRing({ x: 5, y: 3 }, ring, hard.ringTolerance), false);
  assert.equal(insideRing({ x: 4, y: 3 }, ring, hard.ringTolerance), true);
});

test('only hard ends the route after three consecutive missed rings', () => {
  for (const difficulty of DIFFICULTIES) {
    let progress = { score: 4, misses: 0 };
    for (let misses = 1; misses <= 12; misses++) {
      progress = advanceRingProgress(progress, false, difficulty);
      assert.equal(progress.score, 4);
      assert.equal(progress.misses, misses);
      assert.equal(progress.routeFailed, difficulty.id === 'hard' && misses >= 3);
    }
  }
});

test('collecting a ring resets the missed-ring streak and awards one point', () => {
  const hard = DIFFICULTIES[2];
  const initial = { score: 1, misses: 2 };
  let progress = advanceRingProgress(initial, true, hard);
  assert.deepEqual(progress, { score: 2, misses: 0, routeFailed: false });
  assert.deepEqual(initial, { score: 1, misses: 2 }, 'progress updates do not mutate their input');
  progress = advanceRingProgress(progress, false, hard);
  progress = advanceRingProgress(progress, false, hard);
  assert.equal(progress.routeFailed, false);
  progress = advanceRingProgress(progress, false, hard);
  assert.deepEqual(progress, { score: 2, misses: 3, routeFailed: true });
});

test('obstacles begin on the initial flight path and all later positions are reachable', () => {
  for (const { id } of DIFFICULTIES) {
    assert.deepEqual(obstaclePosition(0, id), { x: 0, y: 3 });
    for (let i = 1; i < 1000; i++) {
      const position = obstaclePosition(i, id);
      assert.deepEqual(position, obstaclePosition(i, id), 'routes must be deterministic');
      assert.ok(position.x >= -11 && position.x <= 11);
      assert.ok(position.y >= 0 && position.y <= 10);
    }
  }
});

test('ring collection is forgiving near the edge but rejects a genuine miss', () => {
  const ring = { x: -4, y: 5 };
  assert.equal(insideRing({ x: -4, y: 5 }, ring), true);
  assert.equal(insideRing({ x: 2.9, y: 5 }, ring), true);
  assert.equal(insideRing({ x: 3.1, y: 5 }, ring), false);
  assert.equal(insideRing({ x: 1, y: 10 }, ring), false);
  assert.equal(insideRing({ x: -8, y: 1 }, ring), true);
});

test('every ring in a long flight remains reachable within movement limits', () => {
  const positions = new Set();
  for (let i = 0; i < 1000; i++) {
    const ring = ringPosition(i);
    assert.ok(Number.isFinite(ring.x) && Number.isFinite(ring.y));
    assert.ok(ring.x >= -LIMITS.x && ring.x <= LIMITS.x);
    assert.ok(ring.y >= LIMITS.minY && ring.y <= LIMITS.maxY);
    assert.equal(insideRing(ring, ring), true);
    positions.add(`${ring.x.toFixed(1)},${ring.y.toFixed(1)}`);
  }
  assert.ok(positions.size > 100, 'the ring route should offer varied positions');
});

test('the chooser offers three recognizable aircraft with different liveries', () => {
  assert.deepEqual(AIRCRAFT.map(({ id }) => id), ['737', '747', 'a380']);
  assert.equal(new Set(AIRCRAFT.map(({ color }) => color)).size, 3);
  for (const aircraft of AIRCRAFT) {
    assert.ok(aircraft.name && aircraft.subtitle && aircraft.fact);
  }
});

test('the jumbo model identifies the 747-8I with its matching reference dimensions', () => {
  const jumbo = AIRCRAFT.find(({ id }) => id === '747');
  assert.equal(jumbo.model, '747-8I');
  assert.match(jumbo.name, /747-8I/);
  assert.equal(jumbo.length, 76.3);
  assert.equal(jumbo.wingspan, 68.4);
});

for (const id of ['737', '747', 'a380']) {
  test(`${id} has renderable geometry, expected engine count, and a usable scale`, () => {
    const model = createAircraft(id);
    assert.ok(model.isGroup);
    assert.equal(model.userData.aircraft.id, id);
    let engines = 0;
    let meshCount = 0;
    model.traverse((child) => {
      if (child.userData.isEngine) engines++;
      if (!child.isMesh) return;
      meshCount++;
      const positions = child.geometry.getAttribute('position');
      assert.ok(positions?.count > 0);
      for (const component of positions.array) assert.ok(Number.isFinite(component));
      assert.ok(child.material?.isMaterial);
    });
    assert.equal(engines, id === '737' ? 2 : 4);
    assert.ok(meshCount > 40, 'passenger windows and engine details are present');
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x > 10 && size.x < 16, `unexpected wingspan ${size.x}`);
    assert.ok(size.z > 11 && size.z < 15, `unexpected length ${size.z}`);
    assert.ok(size.y > 3 && size.y < 6, `unexpected height ${size.y}`);
    assert.ok(bounds.min.z < -5 && bounds.max.z > 5);
  });

  test(`${id} has the correct landing gear in the hangar and retracts it for flight`, () => {
    const parked = createAircraft(id);
    const flying = createAircraft(id, { gearDown: false });
    const expectedWheels = { '737': 6, '747': 18, a380: 22 }[id];
    const tires = [];
    parked.traverse((child) => { if (child.userData.isWheel) tires.push(child); });
    assert.equal(parked.userData.gearDown, true);
    assert.equal(parked.userData.wheelCount, expectedWheels);
    assert.equal(tires.length, expectedWheels, 'the rendered wheel count must match the aircraft');
    parked.updateMatrixWorld(true);
    for (const tire of tires) {
      assert.ok(tire.isMesh);
      assert.ok(tire.getWorldPosition(new THREE.Vector3()).y < 0, 'landing gear belongs below the aircraft');
    }
    let flightWheels = 0;
    let flightEngines = 0;
    flying.traverse((child) => {
      if (child.userData.isWheel) flightWheels++;
      if (child.userData.isEngine) flightEngines++;
    });
    assert.equal(flying.userData.gearDown, false);
    assert.equal(flying.userData.wheelCount, 0);
    assert.equal(flightWheels, 0, 'flight models must not retain invisible wheel geometry in their colliders');
    assert.equal(flightEngines, id === '737' ? 2 : 4);

    const parkedBounds = new THREE.Box3().setFromObject(parked, true);
    const flightBounds = new THREE.Box3().setFromObject(flying, true);
    assert.ok(parkedBounds.min.y < flightBounds.min.y - 0.1,
      'retracting the gear must remove the low wheel silhouette');
    const parkedSize = parkedBounds.getSize(new THREE.Vector3());
    const flightSize = flightBounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(parkedSize.x - flightSize.x) < 1e-5);
    assert.ok(Math.abs(parkedSize.z - flightSize.z) < 1e-5);
    assert.ok(flightSize.x > 10 && flightSize.x < 15);
    assert.ok(flightSize.z > 11 && flightSize.z < 14);
    const spec = AIRCRAFT.find((aircraft) => aircraft.id === id);
    assert.ok(Math.abs(flightSize.x / flightSize.z - spec.wingspan / spec.length) < 0.04,
      'the flying silhouette should preserve the reference wingspan-to-length ratio');
  });
}

test('an unknown aircraft selection falls back to the 737', () => {
  assert.equal(createAircraft('unavailable').userData.aircraft.id, '737');
});
