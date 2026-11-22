import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Batch a fully static mesh hierarchy into one draw call per shared material.
 * The root, its transforms, and its userData are retained. Child identities are
 * replaced, so apply this before attaching any animation to individual parts.
 * Materials are retained; superseded geometries are disposed only after all
 * replacement batches have been built successfully.
 */
export function mergeStaticMeshes(group) {
  group.updateWorldMatrix(true, true);
  const rootInverse = group.matrixWorld.clone().invert();
  const batches = new Map();
  const originalGeometries = new Set();
  const temporaryGeometries = [];
  const replacements = [];

  try {
    group.traverse((child) => {
      if (!child.isMesh) return;
      if (child.isSkinnedMesh || child.isInstancedMesh || Array.isArray(child.material)
        || Object.keys(child.geometry.morphAttributes).length) {
        throw new Error('mergeStaticMeshes requires static, single-material meshes');
      }

      // Standard primitives mix indexed and nonindexed layouts. Normalize the
      // copies so BufferGeometryUtils can merge them without changing triangles.
      const geometry = child.geometry.index
        ? child.geometry.toNonIndexed()
        : child.geometry.clone();
      temporaryGeometries.push(geometry);
      const localMatrix = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);
      geometry.applyMatrix4(localMatrix);
      originalGeometries.add(child.geometry);

      // Keep rendering flags distinct even when two parts share a material.
      const key = `${child.castShadow}/${child.receiveShadow}/${child.renderOrder}/${child.layers.mask}`;
      let byFlags = batches.get(child.material);
      if (!byFlags) batches.set(child.material, (byFlags = new Map()));
      let batch = byFlags.get(key);
      if (!batch) {
        batch = { material: child.material, source: child, geometries: [] };
        byFlags.set(key, batch);
      }
      batch.geometries.push(geometry);
    });

    for (const byFlags of batches.values()) {
      for (const batch of byFlags.values()) {
        const geometry = mergeGeometries(batch.geometries, false);
        if (!geometry) throw new Error('Unable to batch incompatible static geometry');
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const result = new THREE.Mesh(geometry, batch.material);
        result.name = 'static-batch';
        result.castShadow = batch.source.castShadow;
        result.receiveShadow = batch.source.receiveShadow;
        result.renderOrder = batch.source.renderOrder;
        result.layers.mask = batch.source.layers.mask;
        replacements.push(result);
      }
    }
  } catch (error) {
    for (const mesh of replacements) mesh.geometry.dispose();
    throw error;
  } finally {
    for (const geometry of temporaryGeometries) geometry.dispose();
  }

  if (replacements.length) {
    group.clear();
    group.add(...replacements);
    for (const geometry of originalGeometries) geometry.dispose();
  }
  return group;
}
