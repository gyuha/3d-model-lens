import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** 월드 up. glTF 2.0 이 `+Y` up 을 규정하고 로더가 그대로 싣는다 (`handedness.ts` 의 실측 주석). */
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * 법선을 `±Y` 와 평행하다고 볼 경계. 꼭짓점 법선의 `|forward · +Y|` 는 `1/√3 ≈ 0.577` 이라
 * 이 경계에서 한참 멀다 — 정확히 `±Y` 인 두 면만 잡힌다.
 */
const DEGENERATE_EPSILON = 1e-6;

/**
 * **클릭한 영역의 바깥 법선에서 [[정규 자세]] 를 낸다.**
 *
 * 조건은 둘이다. 카메라 `forward` 가 법선의 정확한 반대(그 영역을 정면으로 본다)이고,
 * **롤이 0** — 화면 up 이 그 시선에서 가능한 한 월드 `+Y` 에 가깝다. 두 축이 정해지면 회전은
 * 유일하므로 `right` 는 따라 나온다(자유도가 없어 좌우가 뒤집힐 여지도 없다).
 *
 * 자세 규약은 `OrbitCamera` 와 같다 — 쿼터니언이 로컬 축 `(1,0,0)`/`(0,1,0)`/`(0,0,1)` 을
 * 월드의 `right`/`up`/`forward` 로 보낸다. 씬이 좌수(`useRightHandedSystem` 기본 `false`)라
 * 기저는 `right × up = forward` 를 만족하며(실측 확인), 따라서 `right = up × forward` 다.
 *
 * **축퇴 — `TOP`/`BOTTOM`.** 법선이 `±Y` 와 평행하면 "up 이 `+Y` 에 가장 가깝다"가 정의되지
 * 않는다(가능한 up 이 전부 `+Y` 와 직각이라 모두 동점이다). 규약을 못 박는다:
 * **`TOP` 은 화면 up = 월드 `-Z`** (즉 `FRONT` 가 화면 아래로 온다),
 * **`BOTTOM` 은 화면 up = 월드 `+Z`** (`FRONT` 가 화면 위로 온다).
 *
 * 이 둘이 임의의 선택이 아닌 이유 — **`FRONT` 자세에서 화면 수평축으로 `±90°` 기울인 것과
 * 정확히 같다**(실측: `FRONT` 자세 × `RotationAxis(Right, +π/2)` = `forward [0,-1,0]` ·
 * `up [0,0,-1]` = `TOP`, `-π/2` 는 `BOTTOM`). 즉 사용자가 드래그로 극점을 넘어갈 때 보던
 * 그림이 그대로 이어지고, 큐브 클릭이 화면을 갑자기 뒤집지 않는다.
 *
 * 법선은 단위 길이가 아니어도 된다 — 꼭짓점을 `(±1, ±1, ±1)` 로 그대로 넘길 수 있게 한다.
 */
export function poseForNormal(normal: Vector3): Quaternion {
  const forward = normal.normalizeToNew().scaleInPlace(-1);
  const alignment = Vector3.Dot(WORLD_UP, forward);

  const up =
    Math.abs(alignment) > 1 - DEGENERATE_EPSILON
      ? // 축퇴: forward 가 `-Y`(TOP 을 내려다봄)면 up 은 `-Z`, `+Y`(BOTTOM 을 올려다봄)면 `+Z`.
        new Vector3(0, 0, forward.y)
      : // 월드 `+Y` 에서 시선 성분을 뺀 것 — forward 에 수직인 원 위에서 `up · +Y` 를 최대로
        // 만드는 유일한 방향이다.
        WORLD_UP.subtract(forward.scale(alignment)).normalize();

  const basis = Matrix.Identity();
  Matrix.FromXYZAxesToRef(Vector3.Cross(up, forward), up, forward, basis);
  // `FromRotationMatrix` 의 결과는 길이가 `1` 에서 `1e-8` 쯤 어긋난다(실측) — slerp 보간이
  // 받아 갈 값이므로 여기서 정규화해 둔다.
  return Quaternion.FromRotationMatrix(basis).normalize();
}

/** 큐브 바깥 4방향 화살표. 이름은 **화살표가 가리키는 화면 방향**이다. */
export type NavCubeArrow = 'up' | 'down' | 'left' | 'right';

/** 화살표 한 번의 회전량. */
const QUARTER_TURN = Math.PI / 2;

/**
 * 화살표별 회전축과 부호.
 *
 * **이 표를 새로 유도하지 마라 — `OrbitCamera.applyRotation()` 에서 그대로 옮긴 것이다.**
 * 좌우는 화면 수직축(`Vector3.Up()`), 상하는 화면 수평축(`Vector3.Right()`)이며, 드래그 규약
 * (ADR `260826-232902`)이 **오른쪽 드래그 = `horizontal > 0`** · **아래 드래그 = `vertical > 0`**
 * 이므로 `right` 와 `down` 이 `+` 다.
 *
 * 실측(기본 시작 자세, `Δforward` 를 시작 자세의 축에 투영):
 * `Up +π/2` → `right +1.0000` · `up 0.0000` (= 오른쪽 드래그와 같은 방향),
 * `Right +π/2` → `right 0.0000` · `up -1.0000` (= 아래 드래그와 같은 방향).
 */
const ARROW_ROTATIONS: Record<NavCubeArrow, { axis: Vector3; angle: number }> = {
  right: { axis: Vector3.Up(), angle: QUARTER_TURN },
  left: { axis: Vector3.Up(), angle: -QUARTER_TURN },
  down: { axis: Vector3.Right(), angle: QUARTER_TURN },
  up: { axis: Vector3.Right(), angle: -QUARTER_TURN },
};

/**
 * **현재 자세에서 화면 기준으로 90° 돌린 자세.** 화살표 클릭의 목적지다.
 *
 * `OrbitCamera.applyRotation()` 과 **같은 규약으로 post-multiply** 한다 — 회전축이 카메라
 * 로컬 축이므로 화면에 고정돼 있고, 그래서 롤이 유지된다. 그 덕분에 [[정규 자세]] 에서
 * 누르면 **이웃 면의 정규 자세에 정확히 도달한다**(롤 0 이 보존되므로) — plan 이 "이웃 정규
 * 자세로 이동" 안을 기각하고도 그 이득을 공짜로 얻는다고 적은 성질이다.
 *
 * **`TOP`/`BOTTOM` 은 예외다.** 축퇴 규약이 그 두 자세의 화면 up 을 월드 `∓Z` 로 못 박았고
 * (`poseForNormal`) 화면 수직축 회전은 up 을 보존하므로, `TOP` 에서 좌우 화살표를 누르면
 * `RIGHT`/`LEFT` 를 **보기는 하지만 90° 롤이 남는다**(실측: `forward = [-1, 0, 0]` ·
 * `up = [0, 0, -1]` · `up · +Y = 0`). ADR `260826-232902` 의 축퇴 예외가 화살표에서 드러난
 * 것이며 버그가 아니다 — 롤을 지우려면 큐브 면을 누르면 된다.
 */
export function poseForArrow(orientation: Quaternion, arrow: NavCubeArrow): Quaternion {
  const { axis, angle } = ARROW_ROTATIONS[arrow];
  return orientation.multiply(Quaternion.RotationAxis(axis, angle));
}
