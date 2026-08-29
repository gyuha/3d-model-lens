import { describe, expect, it } from 'vitest';
import { RenderGate } from '../../src/webview/renderGate';

/** settle 프레임을 명시해 경계를 정확히 시험한다. */
const gate = (settleFrames = 2): RenderGate => new RenderGate({ settleFrames });

describe('RenderGate', () => {
  it('씬이 준비되기 전에는 계속 그린다 — 반쪽 로드된 프레임에서 멈추면 안 된다', () => {
    const g = gate();
    for (let i = 0; i < 10; i++) {
      expect(g.shouldRender(), `프레임 ${i}`).toBe(true);
    }
  });

  it('씬이 준비되고 변화가 없으면 유휴로 들어간다', () => {
    const g = gate(2);
    g.setSceneReady(true);
    // 준비 직후 settle 예산만 소비하고 멈춘다
    const frames = [g.shouldRender(), g.shouldRender(), g.shouldRender(), g.shouldRender()];
    expect(frames).toEqual([true, true, true, false]);
    expect(g.shouldRender()).toBe(false);
    expect(g.shouldRender()).toBe(false);
  });

  it('dirty 표시가 있으면 다시 그리고 settle 예산이 되살아난다', () => {
    const g = gate(2);
    g.setSceneReady(true);
    while (g.shouldRender()) {
      /* 유휴까지 소진 */
    }
    expect(g.shouldRender()).toBe(false);

    g.markDirty();
    expect([g.shouldRender(), g.shouldRender(), g.shouldRender(), g.shouldRender()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('유휴 도중의 dirty 도 즉시 반응한다 — 한 프레임도 늦지 않는다', () => {
    const g = gate(0);
    g.setSceneReady(true);
    expect(g.shouldRender()).toBe(true); // 준비 직후 1프레임
    expect(g.shouldRender()).toBe(false);
    g.markDirty();
    expect(g.shouldRender()).toBe(true);
    expect(g.shouldRender()).toBe(false);
  });

  it('continuous 는 다른 모든 조건을 덮는다 — Inspector 가 켜진 동안', () => {
    const g = gate(0);
    g.setSceneReady(true);
    while (g.shouldRender()) {
      /* 유휴 진입 */
    }
    g.setContinuous(true);
    for (let i = 0; i < 5; i++) {
      expect(g.shouldRender(), `continuous 프레임 ${i}`).toBe(true);
    }
    g.setContinuous(false);
    // 해제하면 settle 을 거쳐 다시 유휴로
    while (g.shouldRender()) {
      /* settle 소진 */
    }
    expect(g.shouldRender()).toBe(false);
  });

  it('setContinuous 를 같은 값으로 반복 호출해도 유휴를 깨지 않는다 — 매 프레임 호출되기 때문이다', () => {
    const g = gate(0);
    g.setSceneReady(true);
    while (g.shouldRender()) {
      /* 유휴 진입 */
    }
    expect(g.shouldRender()).toBe(false);

    // 렌더 루프가 프레임마다 부른다. 값이 안 바뀌었으면 아무 일도 없어야 한다.
    for (let i = 0; i < 5; i++) {
      g.setContinuous(false);
      expect(g.shouldRender(), `프레임 ${i}`).toBe(false);
    }
    expect(g.isIdle).toBe(true);
  });

  it('씬이 다시 준비되지 않은 상태로 돌아가면 다시 그린다 — 비동기 리소스가 뒤늦게 도착하는 경우', () => {
    const g = gate(0);
    g.setSceneReady(true);
    while (g.shouldRender()) {
      /* 유휴 진입 */
    }
    expect(g.shouldRender()).toBe(false);
    g.setSceneReady(false);
    expect(g.shouldRender()).toBe(true);
  });

  it('유휴 여부를 조회할 수 있다 — 테스트와 진단에 쓴다', () => {
    const g = gate(0);
    expect(g.isIdle).toBe(false);
    g.setSceneReady(true);
    while (g.shouldRender()) {
      /* 유휴 진입 */
    }
    expect(g.isIdle).toBe(true);
    g.markDirty();
    expect(g.isIdle).toBe(false);
  });

  it('settleFrames 를 주지 않으면 기본값을 쓰고 음수는 0으로 본다', () => {
    const withDefault = new RenderGate();
    withDefault.setSceneReady(true);
    let count = 0;
    while (withDefault.shouldRender() && count < 100) {
      count++;
    }
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);

    const negative = new RenderGate({ settleFrames: -5 });
    negative.setSceneReady(true);
    expect(negative.shouldRender()).toBe(true);
    expect(negative.shouldRender()).toBe(false);
  });
});
