import { describe, expect, it } from 'vitest';
import { niceStep } from '../../src/webview/geometry';

describe('niceStep', () => {
  it('1 / 2 / 5 × 10^n 중에서 고른다', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.4)).toBe(1);
    expect(niceStep(2)).toBe(2);
    expect(niceStep(3)).toBe(2);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(8)).toBe(10);
  });

  it('아주 작은 모델과 아주 큰 모델 모두에서 합리적인 간격을 낸다', () => {
    expect(niceStep(0.0012)).toBe(0.001);
    expect(niceStep(3400)).toBe(2000);
  });

  it('비정상 입력에는 1을 돌려준다 — 그리드가 사라지거나 무한 루프에 빠지지 않게', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
    expect(niceStep(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
