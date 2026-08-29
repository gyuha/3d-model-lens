import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

export interface Extents {
  min: Vector3;
  max: Vector3;
}

/**
 * 주어진 메시들의 월드 공간 바운딩 박스.
 *
 * `scene.getWorldExtends` 를 쓴다 — glTF 로더가 삽입하는 `__root__` 변환까지 적용된 뒤의
 * 값을 얻어야 하므로 정점 배열을 직접 훑으면 안 된다.
 *
 * 매칭되는 메시가 없으면 Babylon 은 센티넬(min=+MAX, max=-MAX)을 돌려주므로 0 으로 정규화한다.
 */
export function computeExtents(scene: Scene, meshes: readonly AbstractMesh[]): Extents {
  if (meshes.length === 0) {
    return { min: Vector3.Zero(), max: Vector3.Zero() };
  }
  const set = new Set(meshes);
  const { min, max } = scene.getWorldExtends((mesh) => set.has(mesh));
  if (min.x > max.x || min.y > max.y || min.z > max.z) {
    return { min: Vector3.Zero(), max: Vector3.Zero() };
  }
  return { min, max };
}

/** 바운딩 박스의 X/Y/Z 크기. "가로/높이/깊이"라고 부르지 않는다 (ADR 260822-115455c). */
export function extentSizes(extents: Extents): [number, number, number] {
  return [
    extents.max.x - extents.min.x,
    extents.max.y - extents.min.y,
    extents.max.z - extents.min.z,
  ];
}

export function extentDiagonal(extents: Extents): number {
  const [x, y, z] = extentSizes(extents);
  return Math.hypot(x, y, z);
}

/**
 * 1 / 2 / 5 × 10^n 중에서 `target` 에 가장 가까운 "보기 좋은" 간격을 고른다.
 * 그리드 간격을 고정하면 0.01 단위 모델에서는 선이 안 보이고
 * 1000 단위 모델에서는 화면이 선으로 뒤덮인다.
 */
export function niceStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const multiplier = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return multiplier * magnitude;
}
