export const LIMITS = { x: 20, minY: -13, maxY: 15 };
export const GROUND_Y = -11.5;
export const DIFFICULTIES = [
  { id: 'easy', name: '简单', description: '慢慢飞 · 大圆环', speed: 14, obstacleSpacing: 210, obstacleCount: 4, obstacleRadius: 1.8, moving: false, firstObstacleZ: -210, ringTolerance: 7, maxMisses: 0, motionAmplitude: 0 },
  { id: 'normal', name: '普通', description: '加快速度 · 更多障碍', speed: 27, obstacleSpacing: 95, obstacleCount: 8, obstacleRadius: 2.5, moving: false, firstObstacleZ: -140, ringTolerance: 5.5, maxMisses: 0, motionAmplitude: 0 },
  { id: 'hard', name: '困难', description: '极速穿环 · 移动障碍', speed: 44, obstacleSpacing: 46, obstacleCount: 12, obstacleRadius: 3.1, moving: true, firstObstacleZ: -145, ringTolerance: 4.3, maxMisses: 3, motionAmplitude: 3.5 },
];
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function moveTarget(target, input, dt) {
  target.x = clamp(target.x + input.x * dt * 15, -LIMITS.x, LIMITS.x);
  target.y = clamp(target.y + input.y * dt * 12, LIMITS.minY, LIMITS.maxY);
  return target;
}
export function insideRing(plane, ring, tolerance = 7) {
  return Math.hypot(plane.x - ring.x, plane.y - ring.y) < tolerance;
}

export function advanceRingProgress({ score, misses }, collected, difficulty = DIFFICULTIES[0]) {
  const nextScore = collected ? score + 1 : score;
  const nextMisses = collected ? 0 : misses + 1;
  return {
    score: nextScore,
    misses: nextMisses,
    routeFailed: difficulty.maxMisses > 0 && nextMisses >= difficulty.maxMisses,
  };
}
export function ringPosition(index) {
  return { x: Math.sin(index * 1.1) * 10, y: 3 + Math.sin(index * .7) * 5 };
}

export function obstaclePosition(index, difficultyId = 'easy') {
  if (index === 0) return { x: 0, y: 3 };
  const difficulty = DIFFICULTIES.findIndex(({ id }) => id === difficultyId);
  const phase = Math.max(0, difficulty) * 0.41;
  return {
    x: Math.sin(index * 2.17 + phase) * 11,
    y: 5 + Math.sin(index * 1.37 + phase) * 5,
  };
}
