/**
 * 표시 보조 설정 — 모델의 형태를 읽기 쉽게 만드는 것이 유일한 목적인 표시 설정 (CONTEXT.md).
 *
 * 그리드·배경과 같은 부류다: 모델이나 파일의 속성이 아니라 **사람 단위로 정해지는 표시 취향**이라
 * 파일별이 아니라 전역 설정에 저장한다 (`grid.ts` 와 같은 판단). Display 섹션에 들어가는 것은
 * 전부 전역 설정이라는 이 저장소의 규칙을 따른 것이기도 하다 — 섹션이 곧 지속성 계층이다
 * (ADR `260830-123628`).
 *
 * 그리드와 다른 점은 **기본값이 꺼짐**이라는 것이다. 아무것도 건드리지 않은 첫 화면은 지금과
 * 똑같이 유지되고, 형태가 안 보이는 사람이 켜서 쓴다.
 *
 * 셋을 한 그룹으로 다루는 이유: 배선(설정 읽기 · 변경 전파 · 메시지 왕복 · 체크박스)이 셋 다
 * 동일해서, 따로 두면 같은 코드를 세 번 복붙하게 된다.
 */

/**
 * 설정 키. **이 문자열은 공개 API 다** — 한번 내보내면 이름을 바꾸거나 없앨 때 사용자의
 * `settings.json` 이 조용히 무시되므로, 릴리스 전에 확정해야 한다.
 */
export const SHADING_AID_KEYS = ['axisLighting', 'edges', 'normalColors'] as const;

export type ShadingAidKey = (typeof SHADING_AID_KEYS)[number];

export type ShadingAidState = Record<ShadingAidKey, boolean>;

/**
 * 설정 파일에는 손으로 아무 값이나 들어갈 수 있으므로 검증하고 폴백한다.
 *
 * **`Boolean(raw)` 로 쓰면 안 된다** — `Boolean('false') === true` 이고 `Boolean(0) === false` 라
 * 두 경우 모두 사용자의 의도와 반대가 된다 (`readGridSetting` 이 같은 함정을 기록해 뒀다).
 * 불리언이 아니면 기본값(꺼짐)으로 떨어뜨리는 것이 유일하게 예측 가능한 동작이다.
 */
export function readShadingAids(get: (key: ShadingAidKey) => unknown): ShadingAidState {
  const state = {} as ShadingAidState;
  for (const key of SHADING_AID_KEYS) {
    const raw = get(key);
    state[key] = typeof raw === 'boolean' ? raw : false;
  }
  return state;
}
