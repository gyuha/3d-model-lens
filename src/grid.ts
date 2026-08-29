/**
 * 그리드 표시 설정 — 뷰어 캔버스의 바닥 그리드를 보일지 말지.
 *
 * 배경 모드와 같은 부류다: 모델이나 파일의 속성이 아니라 **사람 단위로 정해지는 표시 취향**이라
 * 파일별이 아니라 전역 설정(`modelLens.grid`)에 저장한다 (단위와 반대 판단 — ADR `260822-115455c`
 * 와 대비, 배경과 같은 판단 — ADR `260822-195326`).
 */

/**
 * 설정 파일에는 손으로 아무 값이나 들어갈 수 있으므로 검증하고 폴백한다.
 *
 * **`Boolean(raw)` 로 쓰면 안 된다.** `Boolean('false') === true` 이고 `Boolean(0) === false` 라
 * 두 경우 모두 사용자의 의도와 무관한 값이 된다. 불리언이 아니면 기본값(`true`)으로 떨어뜨리는
 * 것이 유일하게 예측 가능한 동작이다.
 */
export function readGridSetting(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : true;
}
