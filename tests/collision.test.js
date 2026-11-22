import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAircraft } from '../src/aircraft.js';
import { mergeStaticMeshes } from '../src/optimize.js';
import { createAircraftCollider, sweepAircraftSphere } from '../src/collision.js';

const fixtures = new Map();
function fixture(id) {
  if (!fixtures.has(id)) {
    const plane = mergeStaticMeshes(createAircraft(id, { gearDown: false }));
    fixtures.set(id, { plane, collider: createAircraftCollider(plane) });
  }
  const result = fixtures.get(id);
  result.plane.position.set(0, 0, 0);
  result.plane.quaternion.identity();
  result.plane.scale.setScalar(1);
  result.plane.updateMatrixWorld(true);
  return result;
}

for (const id of ['737', '747', 'a380']) {
  test(`${id}: visible forward-fuselage clearance does not trigger an inflated collision`, () => {
    const { collider } = fixture(id);
    assert.ok(collider.triangleCount > 1000);
    assert.equal(collider.intersectsSphere(new THREE.Vector3(1.5, 0, -3), 0.5), false);
    assert.equal(collider.intersectsSphere(new THREE.Vector3(1.15, 0, -3), 0.5), false,
      'a small visible gap beside the fuselage must remain passable');
    assert.equal(collider.intersectsSphere(new THREE.Vector3(0.9, 0, -3), 0.5), true,
      'a sphere overlapping the actual fuselage must collide');
  });

  test(`${id}: nose contact starts at the rendered radome instead of an oversized proxy`, () => {
    const { plane, collider } = fixture(id);
    const noseZ = new THREE.Box3().setFromObject(plane, true).min.z;
    assert.equal(collider.intersectsSphere(new THREE.Vector3(0, 0, noseZ - 0.52), 0.5), false);
    assert.equal(collider.intersectsSphere(new THREE.Vector3(0, 0, noseZ - 0.48), 0.5), true);
  });

  test(`${id}: translation, banking, pitch, and uniform scale preserve physical contact`, () => {
    const { plane, collider } = fixture(id);
    const localClear = new THREE.Vector3(1.15, 0, -3);
    const localTouch = new THREE.Vector3(0.9, 0, -3);
    plane.position.set(8, 5, -14);
    plane.rotation.set(0.18, -0.37, 0.72);
    plane.scale.setScalar(1.4);
    plane.updateMatrixWorld(true);
    assert.equal(collider.intersectsSphere(localClear.clone().applyMatrix4(plane.matrixWorld), 0.7), false);
    assert.equal(collider.intersectsSphere(localTouch.clone().applyMatrix4(plane.matrixWorld), 0.7), true);
  });

  test(`${id}: a boosted obstacle crossing a whole aircraft finds the actual first impact`, () => {
    const { plane, collider } = fixture(id);
    const before = new THREE.Vector3(0, 0, -30);
    const after = new THREE.Vector3(0, 0, 30);
    assert.equal(collider.intersectsSphere(before, 0.5), false);
    assert.equal(collider.intersectsSphere(after, 0.5), false);
    const result = sweepAircraftSphere(collider, plane, plane.position.clone(), plane.quaternion.clone(), before, after, 0.5);
    assert.ok(result && result.t > 0 && result.t < 1);
    const noseZ = new THREE.Box3().setFromObject(plane, true).min.z;
    const expectedContactFraction = (30 + noseZ - 0.5) / 60;
    assert.ok(Math.abs(result.t - expectedContactFraction) < 0.003,
      `impact fraction ${result.t} should match the visible nose at ${expectedContactFraction}`);
    assert.equal(collider.intersectsSphere(before.clone().lerp(after, result.t - 0.005), 0.5), false);
    assert.equal(collider.intersectsSphere(before.clone().lerp(after, result.t + 0.005), 0.5), true);
  });

  test(`${id}: an obstacle sweeping well outside the visible wing stays clear`, () => {
    const { plane, collider } = fixture(id);
    const result = sweepAircraftSphere(collider, plane, plane.position.clone(), plane.quaternion.clone(),
      new THREE.Vector3(12, 0, -30), new THREE.Vector3(12, 0, 30), 0.5);
    assert.equal(result, null);
  });
}

test('a wing can hit during an intermediate bank even when both frame endpoints are clear', () => {
  const { plane, collider } = fixture('737');
  const obstacle = new THREE.Vector3(4.7, 0.11, 1.95);
  assert.equal(collider.intersectsSphere(obstacle, 0.08), true, 'the obstacle touches the visible flat wing');
  plane.rotation.z = -0.65;
  const previousPosition = plane.position.clone();
  const previousQuaternion = plane.quaternion.clone();
  assert.equal(collider.intersectsSphere(obstacle, 0.08), false);
  plane.rotation.z = 0.65;
  const finalQuaternion = plane.quaternion.clone();
  assert.equal(collider.intersectsSphere(obstacle, 0.08), false);
  const result = sweepAircraftSphere(collider, plane, previousPosition, previousQuaternion,
    obstacle, obstacle, 0.08);
  assert.ok(result && result.t > 0 && result.t < 1);
  assert.ok(plane.quaternion.angleTo(finalQuaternion) < 1e-7, 'the sweep restores the render pose');
  assert.ok(plane.position.distanceTo(previousPosition) < 1e-10);
});

test('box collisions use aircraft surfaces and the lowest point follows the banked wing', () => {
  const { plane, collider } = fixture('737');
  const gap = new THREE.Box3(new THREE.Vector3(1.1, -0.2, -3.2), new THREE.Vector3(1.3, 0.2, -2.8));
  const contact = new THREE.Box3(new THREE.Vector3(0.45, -0.2, -3.2), new THREE.Vector3(0.7, 0.2, -2.8));
  assert.equal(collider.intersectsBox(gap), false);
  assert.equal(collider.intersectsBox(contact), true);
  plane.position.y = 4;
  plane.rotation.set(0.2, 0.1, 0.75);
  const visualMinimum = new THREE.Box3().setFromObject(plane, true).min.y;
  assert.ok(Math.abs(collider.lowestPointY() - visualMinimum) < 1e-6);
});
