import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { extentDiagonal, type Extents } from './geometry.js';

/** `ArcRotateCamera` 의 기본값과 같은 감쇠 계수. */
const INERTIA = 0.9;
/** 이 아래로 줄어들면 멈춘 것으로 본다 — 유휴 진입을 막지 않기 위해 필요하다. */
const EPSILON = 1e-4;
/** `animateTo()` 의 기본 보간 시간. 내비게이션 큐브의 면·꼭짓점 클릭이 쓰는 값이다. */
const DEFAULT_ANIMATION_MS = 300;

/** 진행 중인 자세 보간. */
interface PoseAnimation {
  from: Quaternion;
  to: Quaternion;
  /** `now()` 로 잰 시작 시각(ms). */
  startedAt: number;
  durationMs: number;
}

/** 저장·복원되는 카메라 자세. `alpha`/`beta` 와 달리 롤을 표현할 수 있다. */
export interface OrbitCameraState {
  /** 쿼터니언 `[x, y, z, w]`. */
  orientation: [number, number, number, number];
  radius: number;
  target: [number, number, number];
}

/**
 * **자유 자세 궤도 카메라.**
 *
 * `ArcRotateCamera` 를 쓰지 않는 이유는 하나다 — 그것은 자세를 `alpha`/`beta` 로만 표현하고
 * **롤 파라미터가 없어서 화면 기준 회전을 표현할 수 없다.** 좌우 회전이 월드 Y 축 기준이므로,
 * 카메라가 기울어질수록 입력이 시선을 움직이지 못하고 화면만 돌린다
 * (실측: 방향 ≈ `θ·sin β`, 롤 ≈ `θ·cos β`, 교차점 `beta = 45°`).
 * 자세한 근거와 기각한 대안들은 ADR `260826-232902` 에 있다.
 *
 * `TargetCamera` 는 `rotationQuaternion` 으로 자세를 완전히 받고 up 벡터도 그것에서 유도하므로
 * (`targetCamera.pure.js` 의 `_computeViewMatrix`), 월드 Y 고정이 끼어들지 않는다.
 */
export class OrbitCamera {
  public readonly camera: TargetCamera;

  private readonly orientation = new Quaternion();
  private readonly target = Vector3.Zero();
  private radius = 1;
  private minRadius = 0;
  private maxRadius = Number.MAX_VALUE;

  /**
   * 관성 속도. `ArcRotateCamera` 의 `inertia = 0.9` 와 같은 감쇠를 직접 구현한다 — 입력이 끝난
   * 뒤에도 프레임마다 0.9배로 줄면서 이어진다. 유지하는 이유: 요청 범위는 회전 축이고, 체감
   * 변화를 끼워 넣으면 문제가 생겼을 때 축 탓인지 관성 탓인지 분리할 수 없다 (ADR 260826-232902).
   *
   * **자유 자세에서는 회전축이 프레임마다 바뀌므로** 속도를 월드 벡터로 들고 있으면 안 된다 —
   * 화면 기준 각속도(라디안)로 들고 있다가 매 프레임 그 시점의 로컬 축에 적용한다.
   */
  private velocity = { horizontal: 0, vertical: 0 };

  /**
   * 진행 중인 자세 보간. 없으면 `null`.
   *
   * **관성과 한 속도로 합치지 않는다.** 자세를 두 소스가 동시에 끌면 어느 쪽도 정확히 따라가지
   * 못한다 — 입력을 속도에만 넣었더니 드래그가 손가락을 따라가지 못하던 것과 같은 종류의
   * 문제다(ADR `260826-232902`). 그래서 `tick()` 은 애니메이션이 있으면 관성을 건너뛴다.
   */
  private animation: PoseAnimation | null = null;

  /**
   * @param now 시간 제공자(ms). 보간 진행을 `tick()` 호출 횟수가 아니라 경과 시간으로 재므로
   *   프레임 레이트와 무관하다. 주입 가능하게 둔 것은 테스트가 실제로 300ms 를 기다리지 않게
   *   하기 위해서다.
   */
  public constructor(
    scene: Scene,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.camera = new TargetCamera('modelLens.camera', Vector3.Zero(), scene);
    this.camera.rotationQuaternion = new Quaternion();
    this.apply();
  }

  /**
   * **화면 기준 회전.** `horizontal` 은 화면의 수직축(좌우로 돌린다), `vertical` 은 화면의
   * 수평축(위아래로 돌린다) 기준이며 단위는 라디안이다.
   */
  public rotate(horizontal: number, vertical: number): void {
    // **직접 회전은 보간을 이긴다.** 실제 경로에서는 이미 끊겨 있다(드래그는 `pointerdown`,
    // 방향키는 `keydown` 이 `stop()` 을 부른다) — 남는 구멍은 **키를 누른 채로 큐브를 클릭**
    // 하는 경우다. 그때 렌더 루프가 보간과 키 회전을 같은 프레임에 둘 다 적용하면 자세를 두
    // 소스가 끌게 되고, 그것이 ADR `260826-232902` 가 기각한 상태다.
    this.animation = null;
    this.applyRotation(horizontal, vertical);
  }

  /**
   * 관성 꼬리를 시작한다 — 드래그를 놓는 순간의 속도를 넘긴다.
   *
   * **직접 조작과 꼬리를 분리한 이유.** Babylon 은 입력을 속도에만 넣고 매 프레임 감쇠하며
   * 적용하므로, 입력 `θ` 하나가 결국 `θ · Σ0.9ⁿ = 10θ` 만큼 돈다. 즉시 적용까지 하면 `11θ` 가
   * 되어 드래그가 크게 오버슈트한다. 그래서 `rotate()` 는 **1:1 로 즉시** 적용하고(드래그가
   * 손가락을 정확히 따라가며, 불변식도 이 경로에서 단정된다) 꼬리는 이 메서드가 별도로 만든다.
   * 감쇠 계수는 `ArcRotateCamera` 와 같은 `0.9` 다.
   */
  public glide(horizontal: number, vertical: number): void {
    this.velocity.horizontal = horizontal;
    this.velocity.vertical = vertical;
  }

  /**
   * 자세를 `orientation` 으로 부드럽게 옮긴다 — 내비게이션 큐브의 면·꼭짓점 클릭이 쓴다.
   *
   * 보간 중에는 `tick()` 이 `true` 를 돌려주므로 렌더 게이트가 이미 그리고 있고, 끝나면
   * `false` 가 되어 유휴로 들어간다 — **새 렌더 배관이 필요 없다.** 남아 있던 관성 꼬리와
   * 이전 보간은 시작하는 자리에서 버린다.
   */
  public animateTo(orientation: Quaternion, durationMs = DEFAULT_ANIMATION_MS): void {
    this.stop();
    this.animation = {
      from: this.orientation.clone(),
      to: orientation.clone(),
      startedAt: this.now(),
      durationMs,
    };
  }

  /**
   * 진행 중인 자세 보간, 없으면 관성을 한 프레임 진행한다. 움직임이 남아 있으면 `true` —
   * 렌더 게이트가 이걸로 계속 그린다. 입력이 끝난 뒤에도 감쇠가 이어지므로, 이 값이 `false` 가
   * 될 때가 유휴 진입 시점이다.
   */
  public tick(): boolean {
    if (this.animation) {
      return this.advanceAnimation(this.animation);
    }
    const v = this.velocity;
    v.horizontal *= INERTIA;
    v.vertical *= INERTIA;

    if (Math.abs(v.horizontal) <= EPSILON && Math.abs(v.vertical) <= EPSILON) {
      v.horizontal = 0;
      v.vertical = 0;
      return false;
    }
    this.applyRotation(v.horizontal, v.vertical);
    return true;
  }

  /**
   * 관성과 진행 중인 자세 보간을 즉시 끊는다 — 새 드래그가 시작될 때 이전 움직임이 섞이지
   * 않게 한다. 보간 중에 손을 대면 그 자리에서 멈추고, 거기서부터 드래그가 이어진다.
   *
   * **자세를 가져가는 조작만 이것을 부른다.** 자세를 건드리지 않는 조작(줌·팬)은
   * `stopInertia()` 를 부른다 — 아래 주석 참조.
   */
  public stop(): void {
    this.stopInertia();
    this.animation = null;
  }

  /**
   * 관성 꼬리만 끊는다 — **진행 중인 자세 보간은 그대로 둔다.**
   *
   * `stop()` 과 나눈 이유가 실측에 있다. 휠 줌 · 우드래그 팬 · Alt/Ctrl + 방향키는 자세를
   * 건드리지 않으면서 이전 관성만 정리하려고 `stop()` 을 불렀는데, 그 함수가 보간까지 버리는
   * 바람에 큐브 클릭이 **목적 자세에 도달하지 못한 임의의 자세에서 굳었다**(실측: `TOP` 클릭
   * 80ms 뒤 휠 1노치 → 목표 `[0,-1,0]` 에서 40.63° 미달 · `▶` 클릭 80ms 뒤 우드래그 팬 →
   * 90° 중 29.34° 만 회전). "큐브로 면을 보고 곧바로 스크롤로 확대"는 300ms 안에 일어나는
   * 정상 흐름이므로 상시 재현됐다.
   *
   * 줌·팬이 보간과 **공존해도 안전하다**: 보간은 자세만 쓰고 `apply()` 가 매 프레임 자세·거리·
   * 타깃에서 카메라를 다시 만들므로, 그 사이 바뀐 거리·타깃이 그대로 반영된다.
   */
  public stopInertia(): void {
    this.velocity.horizontal = 0;
    this.velocity.vertical = 0;
  }

  /** 자세 보간을 경과 시간만큼 진행한다. 아직 남았으면 `true`. */
  private advanceAnimation(animation: PoseAnimation): boolean {
    const t = Math.min(1, (this.now() - animation.startedAt) / animation.durationMs);
    Quaternion.SlerpToRef(animation.from, animation.to, t, this.orientation);
    this.apply();
    if (t < 1) {
      return true;
    }
    // 보간이 자세를 소유했으므로, 그 사이 들어온 관성 꼬리는 되살리지 않고 함께 버린다.
    this.stop();
    return false;
  }

  private applyRotation(horizontal: number, vertical: number): void {
    // **두 축 모두 카메라 로컬 축 기준으로 post-multiply 한다.** 이것이 화면 기준 회전이다 —
    // 회전축이 화면에 고정돼 있으므로 시선은 입력만큼 정확히 돌고 그 축 방향은 변하지 않는다.
    // 월드 Y 축으로 돌리면(pre-multiply) 카메라가 기울어진 만큼 입력이 롤로 새어 나간다.
    if (horizontal !== 0) {
      this.orientation.copyFrom(
        this.orientation.multiply(Quaternion.RotationAxis(Vector3.Up(), horizontal)),
      );
    }
    if (vertical !== 0) {
      this.orientation.copyFrom(
        this.orientation.multiply(Quaternion.RotationAxis(Vector3.Right(), vertical)),
      );
    }
    this.apply();
  }

  /** 배율 곱. `1` 보다 크면 멀어진다. */
  public zoom(factor: number): void {
    this.applyZoom(factor);
  }

  /** 화면 기준 팬 — 화면 오른쪽·위 방향으로 타깃을 옮긴다. 단위는 월드 거리. */
  public pan(right: number, up: number): void {
    this.applyPan(right, up);
  }

  private applyZoom(factor: number): void {
    this.radius = Math.min(this.maxRadius, Math.max(this.minRadius, this.radius * factor));
    this.apply();
  }

  private applyPan(right: number, up: number): void {
    this.target.addInPlace(this.right.scale(right)).addInPlace(this.up.scale(up));
    this.apply();
  }

  /** 모델 크기에 맞춘 줌·클리핑 한계. 프레이밍과 별개로 항상 적용한다. */
  public applyLimits(extents: Extents): void {
    const diagonal = extentDiagonal(extents) || 1;
    this.minRadius = diagonal * 0.05;
    this.maxRadius = diagonal * 20;
    this.camera.minZ = diagonal * 0.001;
    this.camera.maxZ = diagonal * 100;
  }

  /** 바운딩 박스에 맞춰 프레이밍한다. 자세는 기본 시작 각도로 되돌린다. */
  public frame(extents: Extents): void {
    this.target.set(
      (extents.min.x + extents.max.x) / 2,
      (extents.min.y + extents.max.y) / 2,
      (extents.min.z + extents.max.z) / 2,
    );
    this.radius = (extentDiagonal(extents) || 1) * 1.6;
    // **방위각은 `FRONT`(+Z) 와 `RIGHT`(+X) 의 정확히 중간(45°), 고도는 18°.**
    // 실측: `forward = [-0.672, -0.309, -0.672]` — 카메라가 `+X`·`+Y`·`+Z` 쪽에 있으므로 첫
    // 화면이 RIGHT · TOP · **FRONT** 를 본다. 모델의 앞면을 보게 하는 것이 이 값의 근거다.
    //
    // 여기 있던 *"기존 `ArcRotateCamera` 의 시작 각도(alpha = -π/2.5, beta = π/2.5)와 같은
    // 방향을 준다"* 는 주석은 **틀렸다.** 옛 카메라의 위치 방향은 `[0.294, 0.309, -0.905]` 로
    // 수평 **54° 어긋나** 있었다(BACK 쪽을 봤다). `TargetCamera` 의 yaw 와 `ArcRotateCamera` 의
    // alpha 는 `yaw = -(alpha + 90°)` 관계인데 alpha 를 yaw 에 그대로 넣었기 때문이다.
    // 고도만 그때와 같다 — `pitch = π/2 - π/2.5` 는 `y = 0.309`, 즉 `beta` 와 일치한다.
    this.orientation.copyFrom(
      Quaternion.RotationYawPitchRoll((-3 * Math.PI) / 4, Math.PI / 2 - Math.PI / 2.5, 0),
    );
    this.stop();
    this.apply();
  }

  public state(): OrbitCameraState {
    return {
      orientation: [
        this.orientation.x,
        this.orientation.y,
        this.orientation.z,
        this.orientation.w,
      ],
      radius: this.radius,
      target: [this.target.x, this.target.y, this.target.z],
    };
  }

  public restore(state: OrbitCameraState): void {
    this.orientation.copyFromFloats(...state.orientation);
    this.orientation.normalize();
    this.radius = state.radius;
    this.target.set(...state.target);
    this.stop();
    this.apply();
  }

  /** 현재 타깃까지의 거리. 팬 속도를 여기에 비례시켜야 줌 배율과 무관하게 느낌이 일정하다. */
  public get radiusValue(): number {
    return this.radius;
  }

  /**
   * 현재 자세 — 내비게이션 큐브가 이 값으로 큐브를 그린다.
   *
   * 복사본을 준다. 안쪽 자세는 `apply()` 가 카메라와 동기를 맞추는 단일 출처이므로, 밖에서
   * 손댈 수 있게 두면 큐브 하나 때문에 카메라가 어긋날 수 있다.
   */
  public get orientationValue(): Quaternion {
    return this.orientation.clone();
  }

  /**
   * **보간이 끝나면 도달할 자세.** 보간 중이 아니면 현재 자세와 같다.
   *
   * 내비게이션 큐브의 **화살표**가 이 값에서 90° 를 더한다. 화살표의 목적지는 절대값이 아니라
   * 상대값이므로(현재 자세 + 90°) 보간 중인 자세를 읽으면 아직 남은 각도가 조용히 버려진다 —
   * 실측(`FRONT` 에서 `▶` 두 번, 180° 가 목표): 간격 0ms **93.15°** · 60ms **111.24°** ·
   * 120ms **131.94°** · 200ms **153.84°** 이고 네이티브 더블클릭은 **90.00°** 로 두 번째 클릭이
   * 통째로 삼켜졌다. 목적 자세에 합성하면 세 경우 모두 정확히 180° 가 된다.
   *
   * 면·꼭짓점 클릭은 목적지가 절대값이라 이 게터가 필요 없다 — 현재 자세를 아예 읽지 않는다.
   */
  public get destinationOrientationValue(): Quaternion {
    return (this.animation?.to ?? this.orientation).clone();
  }

  /** 시선 방향(카메라 → 타깃). */
  public get forward(): Vector3 {
    return this.axis(0, 0, 1);
  }

  /** 화면의 수직축. */
  public get up(): Vector3 {
    return this.axis(0, 1, 0);
  }

  /** 화면의 수평축. */
  public get right(): Vector3 {
    return this.axis(1, 0, 0);
  }

  private axis(x: number, y: number, z: number): Vector3 {
    const out = new Vector3(x, y, z);
    out.rotateByQuaternionToRef(this.orientation, out);
    return out.normalize();
  }

  /** 자세·반지름·타깃에서 카메라의 위치와 회전을 다시 만든다. */
  private apply(): void {
    this.camera.rotationQuaternion?.copyFrom(this.orientation);
    this.camera.position.copyFrom(this.target.subtract(this.forward.scale(this.radius)));
  }
}
