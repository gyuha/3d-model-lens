/**
 * 카메라 상태의 형태.
 *
 * 원본 확장에서는 이 타입들이 `viewerState.ts` 안에 있었다 — 탭 전환에서 살아남기 위해
 * 직렬화되던 것들이기 때문이다. 창이 파괴되지 않는 데스크톱 앱에서는 그 직렬화가 사라졌지만
 * (ADR 260829-143640a), **카메라 상태를 읽고 쓰는 일 자체는 남는다** — 내비게이션 큐브가
 * 자세를 옮기고, 홈 버튼이 거리와 타깃까지 되돌린다. 그래서 타입만 여기로 옮겼다.
 */

export type Triple = [number, number, number];
export type Quad = [number, number, number, number];

/**
 * 카메라 자세. **`alpha`/`beta` 가 아니라 쿼터니언이다** — 화면 기준 회전은 롤을 표현할 수
 * 있어야 하고 `alpha`/`beta` 로는 롤을 담을 수 없다 (ADR `260826-232902`).
 */
export interface CameraState {
  /** 쿼터니언 `[x, y, z, w]`. */
  orientation: Quad;
  radius: number;
  target: Triple;
}
