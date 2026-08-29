import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createAnimationController } from '../../src/webview/animation';

/**
 * 브라우저 없이 **실제 Babylon AnimationGroup** 을 돌린다 (NullEngine) — `extents.test.ts` 와 같은 방식.
 * 페이크 그룹을 쓰면 `play`/`pause`/`stop` 의 실제 상태 전이를 놓치는데, 이 모듈의 요점이 바로 그 전이다.
 */
let engine: NullEngine;
let scene: Scene;

function makeGroup(name: string): AnimationGroup {
  const node = new TransformNode(`${name}-node`, scene);
  const animation = new Animation(
    `${name}-anim`,
    'position.x',
    30,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CYCLE,
  );
  animation.setKeys([
    { frame: 0, value: 0 },
    { frame: 30, value: 1 },
  ]);
  const group = new AnimationGroup(name, scene);
  group.addTargetedAnimation(animation, node);
  return group;
}

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe('createAnimationController', () => {
  it('그룹이 하나도 없으면 사용할 수 없다 — 패널의 애니메이션 섹션을 숨기는 판단에 쓴다', () => {
    const controller = createAnimationController([]);
    expect(controller.available).toBe(false);
    expect(controller.isPlaying).toBe(false);
    expect(controller.names).toEqual([]);
  });

  it('그룹 이름을 순서대로 노출한다 — 드롭다운 항목이 된다', () => {
    const controller = createAnimationController([makeGroup('walk'), makeGroup('wave')]);
    expect(controller.available).toBe(true);
    expect(controller.names).toEqual(['walk', 'wave']);
  });

  it('기본 선택은 전체이며 모든 그룹을 재생한다', () => {
    const groups = [makeGroup('walk'), makeGroup('wave')];
    const controller = createAnimationController(groups);

    expect(controller.selection).toBe('all');
    expect(controller.isPlaying).toBe(true);
    expect(groups.map((g) => g.isPlaying)).toEqual([true, true]);
  });

  it('로더가 첫 그룹만 시작해 둔 상태를 생성자가 전체 재생으로 정리한다', () => {
    // glTF 로더의 기본값 animationStartMode=FIRST 가 만들어 놓는 상태를 재현한다.
    const groups = [makeGroup('walk'), makeGroup('wave')];
    groups[0].start(true);
    // Boolean 으로 정규화한다 — 한 번도 시작되지 않은 그룹은 `_isStarted` 가 초기화되지 않아
    // `isPlaying` 이 타입 선언(boolean)과 달리 undefined 를 낸다.
    expect(groups.map((g) => Boolean(g.isPlaying))).toEqual([true, false]);

    createAnimationController(groups);
    expect(groups.map((g) => g.isPlaying)).toEqual([true, true]);
  });

  it('일시정지는 자세를 유지한다 — 정지시키면 그 자세에서 측정할 수 없다', () => {
    const groups = [makeGroup('walk')];
    const controller = createAnimationController(groups);

    controller.pause();

    expect(controller.isPlaying).toBe(false);
    expect(groups[0].isPlaying).toBe(false);
    // stop() 이 아니라 pause() 여야 한다 — stop 은 그룹을 시작 전 상태로 되돌린다.
    expect(groups[0].isStarted).toBe(true);
  });

  it('일시정지한 뒤 다시 재생할 수 있다', () => {
    const groups = [makeGroup('walk'), makeGroup('wave')];
    const controller = createAnimationController(groups);

    controller.pause();
    controller.play();

    expect(controller.isPlaying).toBe(true);
    expect(groups.map((g) => g.isPlaying)).toEqual([true, true]);
  });

  it('개별 그룹을 고르면 그 그룹만 재생한다', () => {
    const groups = [makeGroup('walk'), makeGroup('wave')];
    const controller = createAnimationController(groups);

    controller.select(1);

    expect(controller.selection).toBe(1);
    expect(groups.map((g) => g.isPlaying)).toEqual([false, true]);
  });

  it('개별 그룹에서 전체로 되돌릴 수 있다', () => {
    const groups = [makeGroup('walk'), makeGroup('wave')];
    const controller = createAnimationController(groups);

    controller.select(0);
    controller.select('all');

    expect(controller.selection).toBe('all');
    expect(groups.map((g) => g.isPlaying)).toEqual([true, true]);
  });

  it('일시정지 상태에서 고르면 선택만 바뀌고 재생되지 않는다', () => {
    const groups = [makeGroup('walk'), makeGroup('wave')];
    const controller = createAnimationController(groups);

    controller.pause();
    controller.select(1);

    expect(controller.selection).toBe(1);
    expect(controller.isPlaying).toBe(false);
    expect(groups.map((g) => g.isPlaying)).toEqual([false, false]);
  });

  it('범위 밖 인덱스는 전체로 떨어진다 — 다른 파일에서 복원된 상태가 들어올 수 있다', () => {
    const groups = [makeGroup('walk')];
    const controller = createAnimationController(groups);

    controller.select(7);

    expect(controller.selection).toBe('all');
    expect(groups[0].isPlaying).toBe(true);
  });

  it('상태가 바뀌면 알린다 — 패널 갱신과 렌더 요청이 여기에 붙는다', () => {
    const controller = createAnimationController([makeGroup('walk')]);
    let calls = 0;
    controller.onChange = (): void => {
      calls++;
    };

    controller.pause();
    controller.play();
    controller.select(0);

    expect(calls).toBe(3);
  });

  it('그룹이 없으면 재생·선택이 아무 일도 하지 않는다', () => {
    const controller = createAnimationController([]);
    controller.play();
    controller.select(0);
    expect(controller.isPlaying).toBe(false);
    expect(controller.selection).toBe('all');
  });
});
