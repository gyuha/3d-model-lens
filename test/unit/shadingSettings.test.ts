import { describe, expect, it } from 'vitest';
import { SHADING_AID_KEYS, readShadingAids, type ShadingAidKey } from '../../src/shading';

/**
 * 설정 파일에는 손으로 아무 값이나 들어갈 수 있다. `grid.ts` 가 기록한 함정을 그대로 물려받는다 —
 * **`Boolean(raw)` 로 쓰면 안 된다**: `Boolean('false') === true` 이고 `Boolean(0) === false` 라
 * 두 경우 모두 사용자의 의도와 반대가 된다.
 *
 * 그리드와 다른 점은 **기본값이 꺼짐**이라는 것이다 (ADR `260830-123628`).
 */
describe('표시 보조 설정 읽기', () => {
  it('보조는 셋이고 이름이 고정돼 있다 — 설정 키는 공개 API 라 바뀌면 사용자 settings.json 이 깨진다', () => {
    expect([...SHADING_AID_KEYS]).toEqual(['axisLighting', 'edges', 'normalColors']);
  });

  it('불리언이 아니면 전부 꺼짐으로 떨어진다', () => {
    for (const raw of ['true', 'false', 1, 0, null, undefined, {}, []]) {
      const state = readShadingAids(() => raw);
      expect(
        Object.values(state),
        `${JSON.stringify(raw)} 를 불리언처럼 해석했다`,
      ).toEqual([false, false, false]);
    }
  });

  it('불리언은 그대로 읽는다', () => {
    expect(readShadingAids(() => true)).toEqual({
      axisLighting: true,
      edges: true,
      normalColors: true,
    });
  });

  it('키마다 따로 읽는다 — 하나만 켜도 나머지는 꺼진 채여야 한다', () => {
    const state = readShadingAids((key) => (key as ShadingAidKey) === 'edges');
    expect(state).toEqual({ axisLighting: false, edges: true, normalColors: false });
  });
});
