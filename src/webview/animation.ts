import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';

/**
 * 애니메이션 재생을 소유한다.
 *
 * glTF 로더는 기본값(`animationStartMode = FIRST`)으로 **첫 그룹 하나만** 재생해 둔다.
 * Blender 익스포트는 오브젝트별로 그룹을 쪼개는 경우가 흔해서, 그대로 두면 씬의 절반만
 * 움직인다. 그래서 이 컨트롤러는 생성 시 그 상태를 걷어내고 전체 재생으로 맞춘다.
 *
 * **정지는 `stop()` 이 아니라 `pause()` 다.** `stop()` 은 그룹을 시작 전 자세로 되돌리므로,
 * 멈춘 그 자세의 치수를 재려는 사용자의 의도를 깨뜨린다.
 */

/** `'all'` = 모든 그룹 동시 재생, 숫자 = 그 인덱스의 그룹만. */
export type AnimationSelection = 'all' | number;

export interface AnimationController {
  /** 그룹이 하나라도 있는가 — 패널의 애니메이션 섹션을 숨기는 판단에 쓴다. */
  readonly available: boolean;
  /** 드롭다운에 나열할 그룹 이름. 순서는 인덱스와 같다. */
  readonly names: readonly string[];
  readonly isPlaying: boolean;
  readonly selection: AnimationSelection;
  play(): void;
  pause(): void;
  /** 범위 밖 인덱스는 `'all'` 로 떨어진다 — 다른 파일에서 복원된 상태가 들어올 수 있다. */
  select(selection: AnimationSelection): void;
  /** 상태가 바뀌면 부른다. 패널 갱신과 렌더 요청이 여기에 붙는다. */
  onChange?: () => void;
}

export function createAnimationController(groups: AnimationGroup[]): AnimationController {
  const available = groups.length > 0;
  let selection: AnimationSelection = 'all';
  let playing = false;

  const isSelected = (index: number): boolean => selection === 'all' || selection === index;

  /** 선택과 재생 여부를 실제 그룹에 반영한다. 이 모듈에서 그룹을 건드리는 유일한 지점이다. */
  const apply = (): void => {
    for (const [index, group] of groups.entries()) {
      if (playing && isSelected(index)) {
        // 이미 시작된 그룹은 `play` 가 재개하고, 아닌 그룹은 처음부터 시작한다.
        group.play(true);
      } else {
        group.pause();
      }
    }
  };

  const update = (mutate: () => void): void => {
    if (!available) {
      return;
    }
    mutate();
    apply();
    controller.onChange?.();
  };

  const controller: AnimationController = {
    available,
    names: groups.map((group) => group.name),
    get isPlaying(): boolean {
      return playing;
    },
    get selection(): AnimationSelection {
      return selection;
    },
    play: () => update(() => (playing = true)),
    pause: () => update(() => (playing = false)),
    select: (next) =>
      update(() => {
        selection =
          next !== 'all' && (!Number.isInteger(next) || next < 0 || next >= groups.length)
            ? 'all'
            : next;
      }),
  };

  // 로더가 첫 그룹만 시작해 둔 상태를 여기서 정리한다.
  playing = available;
  apply();

  return controller;
}
