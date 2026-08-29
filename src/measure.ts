/** 측정에 쓰는 순수 기하 — Babylon 타입에 의존하지 않는다. */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 피킹된 삼각형의 세 정점. 정점 스냅의 후보 전체다. */
export type Triangle = readonly [Point3, Point3, Point3];

/**
 * 두 점 사이의 거리.
 *
 * 점-점 거리는 회전·반사에 불변이므로 로더의 좌표계 변환에 영향받지 않는다 —
 * 바운딩 박스의 축 표기와 달리 이 값은 언제나 정직하다 (ADR 260822-115455c).
 */
export function distance(a: Point3, b: Point3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** 거리 라벨을 놓을 자리. */
export function midpoint(a: Point3, b: Point3): Point3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * 클릭한 삼각형의 세 정점 중 가장 가까운 정점으로 붙인다.
 *
 * 후보가 3개뿐이라 가속 구조가 필요 없다. 전역 최근접 정점을 찾으려면 옥트리가 필요한데,
 * 코너·모서리 치수를 재는 데는 클릭한 면의 정점만으로 충분하다 (범위 밖으로 둔 이유).
 *
 * 동일 거리에서는 **앞선 정점**을 택한다 — 같은 자리를 두 번 클릭했을 때 결과가 흔들리면
 * 측정 도구로서 신뢰할 수 없기 때문이다.
 */
export function snapToNearestVertex(point: Point3, triangle: Triangle): Point3 {
  let best = triangle[0];
  let bestDistance = distance(point, best);
  for (let i = 1; i < triangle.length; i++) {
    const candidate = triangle[i];
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }
  return best;
}
