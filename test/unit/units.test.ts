import { describe, expect, it } from 'vitest';
import { formatLength, resolveUnit, type UnitSetting } from '../../src/units';

describe('resolveUnit', () => {
  it('auto 에서 glTF/GLB 는 미터다 — glTF 2.0 스펙이 선형 거리를 미터로 정의한다', () => {
    expect(resolveUnit('.gltf', 'auto')).toBe('m');
    expect(resolveUnit('.glb', 'auto')).toBe('m');
  });

  it('auto 에서 STL 은 라벨이 없다 — 포맷에 단위 필드가 없으므로 아는 척하지 않는다', () => {
    expect(resolveUnit('.stl', 'auto')).toBe('none');
  });

  it('사용자 지정 단위는 항상 auto 판정을 덮는다', () => {
    for (const unit of ['mm', 'cm', 'm', 'in'] as const) {
      expect(resolveUnit('.stl', unit)).toBe(unit);
      expect(resolveUnit('.glb', unit)).toBe(unit);
    }
  });

  it('알 수 없는 설정값은 auto 로 되돌린다 — 손으로 고친 settings.json 에 죽지 않게', () => {
    expect(resolveUnit('.glb', 'furlong' as unknown as UnitSetting)).toBe('m');
    expect(resolveUnit('.stl', '' as unknown as UnitSetting)).toBe('none');
  });
});

describe('formatLength', () => {
  it('단위가 있으면 값 뒤에 붙인다', () => {
    expect(formatLength(1.5, 'm', 3)).toBe('1.500 m');
    expect(formatLength(20, 'mm', 1)).toBe('20.0 mm');
  });

  it("단위가 'none' 이면 순수 숫자만 낸다 — 'units' 같은 가짜 라벨도 붙이지 않는다", () => {
    expect(formatLength(20, 'none', 2)).toBe('20.00');
    expect(formatLength(20, 'none', 0)).toBe('20');
  });

  it('자릿수를 0~10 으로 제한한다 — toFixed 가 RangeError 를 던지지 않게', () => {
    expect(formatLength(1.23456789, 'm', -1)).toBe('1 m');
    expect(formatLength(1.23456789, 'm', 99)).toBe('1.2345678900 m');
  });

  it('유한하지 않은 값은 숫자처럼 보이는 거짓말 대신 그대로 드러낸다', () => {
    expect(formatLength(Number.NaN, 'm', 3)).toBe('—');
    expect(formatLength(Number.POSITIVE_INFINITY, 'mm', 3)).toBe('—');
  });
});
