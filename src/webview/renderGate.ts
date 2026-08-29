/**
 * 프레임을 그릴지 말지 결정한다.
 *
 * 3D 뷰어는 아무것도 변하지 않아도 60fps 로 계속 그리면서 GPU 를 태운다. 정지된 모델을
 * 보고 있는 동안의 그 작업은 전부 낭비다. 이 게이트가 그것을 없앤다.
 *
 * **렌더 루프 자체는 멈추지 않는다** — `engine.stopRenderLoop()` 을 쓰면 wake 소스를 하나
 * 놓치는 순간 뷰어가 얼어붙는 정확성 버그가 된다. 아끼는 것은 마이크로초짜리 RAF 콜백뿐이고,
 * 비용의 거의 전부인 GPU 작업은 `scene.render()` 를 건너뛰는 것만으로 사라진다.
 * 그래서 이 게이트는 "그리지 마라"만 말하고, 루프의 생사에는 관여하지 않는다.
 */
export interface RenderGateOptions {
  /** 마지막 변화 이후 더 그려 줄 프레임 수. 새 메시·텍스처가 한 프레임 늦게 나타나는 경우를 덮는다. */
  settleFrames?: number;
}

const DEFAULT_SETTLE_FRAMES = 2;

export class RenderGate {
  private readonly settleFrames: number;
  private dirty = false;
  private settleRemaining = 0;
  private continuous = false;
  private sceneReady = false;

  public constructor(options: RenderGateOptions = {}) {
    this.settleFrames = Math.max(0, Math.trunc(options.settleFrames ?? DEFAULT_SETTLE_FRAMES));
  }

  /** 무언가 바뀌었다 — 카메라 이동, 측정 변경, 표시 토글, 리사이즈. */
  public markDirty(): void {
    this.dirty = true;
  }

  /**
   * 연속 렌더가 필요한 동안 켠다 — Inspector 의 fps 카운터·기즈모, 재생 중인 애니메이션.
   *
   * 렌더 루프가 프레임마다 부르므로 **값이 바뀔 때만** 반응한다. 매번 dirty 를 세우면
   * 해제 상태에서 영원히 유휴에 못 들어간다.
   */
  public setContinuous(continuous: boolean): void {
    if (continuous === this.continuous) {
      return;
    }
    this.continuous = continuous;
    if (!continuous) {
      // 해제 직후에는 한 번 정리 렌더를 준다.
      this.dirty = true;
    }
  }

  /**
   * 씬이 렌더할 준비가 됐는지. 준비되지 않은 동안에는 계속 그린다 —
   * 텍스처·IBL 이 비동기로 도착하므로 반쪽 로드된 프레임에서 멈추면 안 된다.
   */
  public setSceneReady(ready: boolean): void {
    if (ready !== this.sceneReady) {
      this.sceneReady = ready;
      this.dirty = true;
    }
  }

  /** 유휴 상태인가 — 테스트와 진단용 조회. */
  public get isIdle(): boolean {
    return this.sceneReady && !this.continuous && !this.dirty && this.settleRemaining === 0;
  }

  /** 프레임마다 정확히 한 번 호출한다. settle 예산을 소비하므로 부수 효과가 있다. */
  public shouldRender(): boolean {
    if (this.continuous || !this.sceneReady) {
      return true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.settleRemaining = this.settleFrames;
      return true;
    }
    if (this.settleRemaining > 0) {
      this.settleRemaining--;
      return true;
    }
    return false;
  }
}
