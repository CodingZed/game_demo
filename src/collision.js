import * as THREE from 'three';

const LEAF_TRIANGLES = 8;
const STEP_DISTANCE = 0.25;
const STEP_ANGLE = 0.03;

function pointBoxDistanceSquared(point, node) {
  const x = Math.max(node.minX - point.x, 0, point.x - node.maxX);
  const y = Math.max(node.minY - point.y, 0, point.y - node.maxY);
  const z = Math.max(node.minZ - point.z, 0, point.z - node.maxZ);
  return x * x + y * y + z * z;
}

function boxesOverlap(box, node) {
  return box.max.x >= node.minX && box.min.x <= node.maxX
    && box.max.y >= node.minY && box.min.y <= node.maxY
    && box.max.z >= node.minZ && box.min.z <= node.maxZ;
}

/**
 * Build once after batching the static aircraft. Broadphase bounds only prune
 * work: a hit always requires intersection with an actual rendered triangle.
 * Root translation, rotation, and scale may change between queries. Rebuild if
 * child geometry/transforms/visibility change. Queries describe surface contact;
 * the sweep catches entry into a closed fuselage before full containment.
 */
export function createAircraftCollider(group) {
  group.updateWorldMatrix(true, true);
  const inverseRoot = group.matrixWorld.clone().invert();
  const relative = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edge = new THREE.Vector3(), normal = new THREE.Vector3();
  const coordinates = [];
  const triangleBounds = [];
  let boundingRadius = 0;

  group.traverse((child) => {
    if (!child.isMesh) return;
    // The collider follows visible static surfaces, including merged geometry.
    for (let ancestor = child; ancestor && ancestor !== group; ancestor = ancestor.parent) {
      if (!ancestor.visible) return;
    }
    if (!Array.isArray(child.material) && child.material?.visible === false) return;
    const positions = child.geometry.getAttribute('position');
    if (!positions) return;
    relative.multiplyMatrices(inverseRoot, child.matrixWorld);
    const index = child.geometry.getIndex();
    const available = index ? index.count : positions.count;
    const start = Math.max(0, child.geometry.drawRange.start);
    const end = Math.min(available, start + child.geometry.drawRange.count);
    for (let offset = start; offset + 2 < end; offset += 3) {
      if (Array.isArray(child.material)) {
        const drawGroup = child.geometry.groups.find((entry) => offset >= entry.start && offset < entry.start + entry.count);
        if (!drawGroup || child.material[drawGroup.materialIndex]?.visible === false) continue;
      }
      for (const [target, vertex] of [[a, offset], [b, offset + 1], [c, offset + 2]]) {
        target.fromBufferAttribute(positions, index ? index.getX(vertex) : vertex).applyMatrix4(relative);
      }
      normal.subVectors(b, a).cross(edge.subVectors(c, a));
      // Degenerate render triangles have no visible area and cannot be a surface.
      if (normal.lengthSq() < 1e-22) continue;
      coordinates.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
      const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
      const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
      triangleBounds.push({ minX, minY, minZ, maxX, maxY, maxZ,
        x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 });
      boundingRadius = Math.max(boundingRadius, a.length(), b.length(), c.length());
    }
  });
  const vertices = new Float64Array(coordinates);

  function build(indices) {
    const node = { minX: Infinity, minY: Infinity, minZ: Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const index of indices) {
      const bounds = triangleBounds[index];
      node.minX = Math.min(node.minX, bounds.minX); node.maxX = Math.max(node.maxX, bounds.maxX);
      node.minY = Math.min(node.minY, bounds.minY); node.maxY = Math.max(node.maxY, bounds.maxY);
      node.minZ = Math.min(node.minZ, bounds.minZ); node.maxZ = Math.max(node.maxZ, bounds.maxZ);
    }
    if (indices.length <= LEAF_TRIANGLES) {
      node.triangles = indices;
      return node;
    }
    const extents = [node.maxX - node.minX, node.maxY - node.minY, node.maxZ - node.minZ];
    const axis = ['x', 'y', 'z'][extents.indexOf(Math.max(...extents))];
    indices.sort((left, right) => triangleBounds[left][axis] - triangleBounds[right][axis]);
    const middle = Math.floor(indices.length / 2);
    node.left = build(indices.slice(0, middle));
    node.right = build(indices.slice(middle));
    return node;
  }
  const tree = vertices.length ? build(triangleBounds.map((_, i) => i)) : null;
  const triangle = new THREE.Triangle();
  const closest = new THREE.Vector3();
  const localCenter = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const boxInverse = new THREE.Matrix4();
  const rootToBox = new THREE.Matrix4();
  const boxToRoot = new THREE.Matrix4();
  const localBox = new THREE.Box3();
  const identity = new THREE.Matrix4();
  const stack = [];

  function loadTriangle(index, matrix) {
    const offset = index * 9;
    triangle.a.fromArray(vertices, offset);
    triangle.b.fromArray(vertices, offset + 3);
    triangle.c.fromArray(vertices, offset + 6);
    if (matrix) {
      triangle.a.applyMatrix4(matrix); triangle.b.applyMatrix4(matrix); triangle.c.applyMatrix4(matrix);
    }
    return triangle;
  }
  function prepareRoot() {
    group.updateWorldMatrix(true, false);
    if (Math.abs(group.matrixWorld.determinant()) < 1e-15) return false;
    inverse.copy(group.matrixWorld).invert();
    return true;
  }

  return {
    object: group,
    triangleCount: vertices.length / 9,
    boundingRadius,

    intersectsSphere(centerWorld, radius) {
      if (!tree || radius < 0 || !Number.isFinite(radius) || !prepareRoot()) return false;
      localCenter.copy(centerWorld).applyMatrix4(inverse);
      const e = group.matrixWorld.elements;
      const sx = Math.hypot(e[0], e[1], e[2]);
      const sy = Math.hypot(e[4], e[5], e[6]);
      const sz = Math.hypot(e[8], e[9], e[10]);
      const scale = Math.max(sx, sy, sz);
      const orthogonal = Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) < 1e-10 * scale * scale
        && Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) < 1e-10 * scale * scale
        && Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) < 1e-10 * scale * scale;
      const uniform = orthogonal && Math.max(sx, sy, sz) - Math.min(sx, sy, sz) < 1e-10 * scale;
      // An inverse-matrix norm bounds a transformed sphere for arbitrary scale
      // or shear; nonuniform cases still get exact world-space narrowphase.
      const localRadius = radius * (uniform ? 1 / sx : matrixNormBound(inverse));
      const localRadiusSquared = localRadius * localRadius;
      const worldRadiusSquared = radius * radius;
      stack.length = 0; stack.push(tree);
      while (stack.length) {
        const node = stack.pop();
        if (pointBoxDistanceSquared(localCenter, node) > localRadiusSquared) continue;
        if (!node.triangles) { stack.push(node.left, node.right); continue; }
        for (const index of node.triangles) {
          loadTriangle(index, uniform ? null : group.matrixWorld);
          triangle.closestPointToPoint(uniform ? localCenter : centerWorld, closest);
          if (closest.distanceToSquared(uniform ? localCenter : centerWorld)
            <= (uniform ? localRadiusSquared : worldRadiusSquared)) return true;
        }
      }
      return false;
    },

    // With one argument, box is an axis-aligned world-space THREE.Box3.
    // The optional matrix also supports a local box under an arbitrary pose.
    intersectsBox(box, boxMatrixWorld = identity) {
      if (!tree || box.isEmpty() || !prepareRoot()) return false;
      if (Math.abs(boxMatrixWorld.determinant()) < 1e-15) return false;
      boxToRoot.multiplyMatrices(inverse, boxMatrixWorld);
      localBox.copy(box).applyMatrix4(boxToRoot);
      boxInverse.copy(boxMatrixWorld).invert();
      rootToBox.multiplyMatrices(boxInverse, group.matrixWorld);
      stack.length = 0; stack.push(tree);
      while (stack.length) {
        const node = stack.pop();
        if (!boxesOverlap(localBox, node)) continue;
        if (!node.triangles) { stack.push(node.left, node.right); continue; }
        for (const index of node.triangles) {
          if (box.intersectsTriangle(loadTriangle(index, rootToBox))) return true;
        }
      }
      return false;
    },

    // The exact lowest rendered vertex, including bank and pitch. Node bounds
    // prune triangles which cannot lower the current world-space minimum.
    lowestPointY() {
      if (!tree) return Infinity;
      group.updateWorldMatrix(true, false);
      const e = group.matrixWorld.elements;
      let minimum = Infinity;
      stack.length = 0; stack.push(tree);
      while (stack.length) {
        const node = stack.pop();
        const lower = e[1] * (e[1] < 0 ? node.maxX : node.minX)
          + e[5] * (e[5] < 0 ? node.maxY : node.minY)
          + e[9] * (e[9] < 0 ? node.maxZ : node.minZ) + e[13];
        if (lower >= minimum) continue;
        if (!node.triangles) { stack.push(node.left, node.right); continue; }
        for (const index of node.triangles) {
          for (let offset = index * 9; offset < index * 9 + 9; offset += 3) {
            minimum = Math.min(minimum, e[1] * vertices[offset] + e[5] * vertices[offset + 1]
              + e[9] * vertices[offset + 2] + e[13]);
          }
        }
      }
      return minimum;
    },
  };
}

// sqrt(||A||1 * ||A||infinity) is a conservative linear stretch bound, including
// shear. Unlike the Frobenius norm it equals one for the identity transform.
function matrixNormBound(matrix) {
  const e = matrix.elements;
  const columns = Math.max(Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]),
    Math.abs(e[4]) + Math.abs(e[5]) + Math.abs(e[6]), Math.abs(e[8]) + Math.abs(e[9]) + Math.abs(e[10]));
  const rows = Math.max(Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8]),
    Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]), Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10]));
  return Math.sqrt(columns * rows);
}

/**
 * Sample relative translation and rotation in bounded steps, then refine the
 * first detected contact. Return the contact fraction so rendering can stop at
 * impact rather than showing a collision after the objects have separated.
 */
function sweep(collider, plane, previousPosition, previousQuaternion, previousCenter, currentCenter, obstacleRadius, intersects) {
  if (collider.object !== plane) throw new Error('The collider must belong to the swept aircraft');
  if (!collider.triangleCount || obstacleRadius < 0 || !Number.isFinite(obstacleRadius)) return null;
  const endPosition = plane.position.clone();
  const endQuaternion = plane.quaternion.clone();
  const startQuaternion = previousQuaternion.clone().normalize();
  const center = new THREE.Vector3();
  const previousWorldPosition = previousPosition.clone();
  const endWorldPosition = endPosition.clone();
  let parentStretch = 1;
  if (plane.parent) {
    plane.parent.updateWorldMatrix(true, false);
    previousWorldPosition.applyMatrix4(plane.parent.matrixWorld);
    endWorldPosition.applyMatrix4(plane.parent.matrixWorld);
    parentStretch = matrixNormBound(plane.parent.matrixWorld);
  }
  const maximumScale = Math.max(Math.abs(plane.scale.x), Math.abs(plane.scale.y), Math.abs(plane.scale.z));
  const aircraftRadius = collider.boundingRadius * maximumScale * parentStretch;
  const relativeStart = new THREE.Vector3().subVectors(previousCenter, previousWorldPosition);
  const relativeEnd = new THREE.Vector3().subVectors(currentCenter, endWorldPosition);
  const relativeDelta = new THREE.Vector3().subVectors(relativeEnd, relativeStart);
  const closestT = relativeDelta.lengthSq() === 0 ? 0 : THREE.MathUtils.clamp(-relativeStart.dot(relativeDelta) / relativeDelta.lengthSq(), 0, 1);
  const closest = relativeDelta.clone().multiplyScalar(closestT).add(relativeStart);
  if (closest.lengthSq() > (aircraftRadius + obstacleRadius) ** 2) return null;
  const angle = startQuaternion.angleTo(endQuaternion);
  const steps = Math.max(1, Math.ceil((relativeDelta.length() + angle * aircraftRadius) / STEP_DISTANCE), Math.ceil(angle / STEP_ANGLE));
  function at(t) {
    plane.position.lerpVectors(previousPosition, endPosition, t);
    plane.quaternion.slerpQuaternions(startQuaternion, endQuaternion, t);
    center.lerpVectors(previousCenter, currentCenter, t);
    return intersects(center);
  }
  try {
    if (at(0)) return { t: 0 };
    let previousT = 0;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      if (!at(t)) { previousT = t; continue; }
      let low = previousT, high = t;
      // Contact pose error is much smaller than a screen pixel at game scale.
      for (let iteration = 0; iteration < 14; iteration++) {
        const middle = (low + high) / 2;
        if (at(middle)) high = middle; else low = middle;
      }
      return { t: high };
    }
    return null;
  } finally {
    plane.position.copy(endPosition);
    plane.quaternion.copy(endQuaternion);
    plane.updateWorldMatrix(true, false);
  }
}

export function sweepAircraftSphere(collider, plane, previousPosition, previousQuaternion, previousCenter, currentCenter, radius) {
  return sweep(collider, plane, previousPosition, previousQuaternion, previousCenter, currentCenter,
    radius, (center) => collider.intersectsSphere(center, radius));
}

export function sweepAircraftBox(collider, plane, previousPosition, previousQuaternion, previousCenter, currentCenter, halfSize) {
  if (halfSize.x < 0 || halfSize.y < 0 || halfSize.z < 0) return null;
  const box = new THREE.Box3();
  return sweep(collider, plane, previousPosition, previousQuaternion, previousCenter, currentCenter,
    Math.hypot(halfSize.x, halfSize.y, halfSize.z), (center) => {
      box.min.copy(center).sub(halfSize); box.max.copy(center).add(halfSize);
      return collider.intersectsBox(box);
    });
}
