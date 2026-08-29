import { describe, expect, it } from 'vitest';
import { readGridSetting } from '../../src/grid';

describe('readGridSetting', () => {
  it('불리언은 그대로 통과시킨다', () => {
    expect(readGridSetting(true)).toBe(true);
    expect(readGridSetting(false)).toBe(false);
  });

  it('설정 파일이 손으로 편집돼 불리언이 아닌 값이 들어오면 기본값 true 로 떨어진다', () => {
    for (const raw of ['yes', 'true', 'false', '', 0, 1, null, undefined, {}, []]) {
      expect(readGridSetting(raw), JSON.stringify(raw) ?? 'undefined').toBe(true);
    }
  });

  it('Boolean() 강제 변환이 아니다 — 문자열 "false" 와 숫자 0 이 그 차이를 드러낸다', () => {
    // Boolean('false') === true, Boolean(0) === false 이므로 강제 변환은 둘 다 틀린다.
    expect(readGridSetting('false')).toBe(true);
    expect(readGridSetting(0)).toBe(true);
  });
});
