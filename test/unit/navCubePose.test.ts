import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { poseForArrow, poseForNormal } from '../../src/webview/navCubePose';
import { OrbitCamera } from '../../src/webview/orbitCamera';

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * **자세를 실제 카메라로 재읽는다.** 쿼터니언에서 축을 뽑는 계산을 테스트가 다시 짜면
 * "구현과 테스트가 서로 같은가"만 확인하게 되어, 규약을 통째로 뒤집어도 초록이 된다
 * (회고 `260828` 의 교훈 3). 그래서 `OrbitCamera.restore()` 에 자세를 실어 그 카메라가
 * 내놓는 `forward`/`up` 을 읽는다 — 이 값이 실제 렌더에 쓰이는 바로 그 값이다.
 */
const axesOf = (orientation: Quaternion): { forward: Vector3; up: Vector3; right: Vector3 } => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const orbit = new OrbitCamera(scene);
    orbit.restore({
      orientation: [orientation.x, orientation.y, orientation.z, orientation.w],
      radius: 1,
      target: [0, 0, 0],
    });
    return { forward: orbit.forward.clone(), up: orbit.up.clone(), right: orbit.right.clone() };
  } finally {
    scene.dispose();
    engine.dispose();
  }
};

/**
 * 클릭 가능한 면 6개. 법선과 라벨은 `.forge/plan.md` 의 실측표를 그대로 따른다
 * (glTF 2.0 `+Y` up · 앞면 `+Z`).
 *
 * `up` 을 **절대 좌표로 못 박는다** — "forward 와 up 이 서로 수직인가" 같은 상대 단정만 두면
 * 14개 자세가 통째로 뒤집혀도 통과한다.
 */
const FACES = [
  { label: 'RIGHT', normal: [1, 0, 0], up: [0, 1, 0] },
  { label: 'LEFT', normal: [-1, 0, 0], up: [0, 1, 0] },
  // 축퇴 규약: TOP 은 화면 up = 월드 -Z (FRONT 가 화면 아래), BOTTOM 은 화면 up = 월드 +Z.
  { label: 'TOP', normal: [0, 1, 0], up: [0, 0, -1] },
  { label: 'BOTTOM', normal: [0, -1, 0], up: [0, 0, 1] },
  { label: 'FRONT', normal: [0, 0, 1], up: [0, 1, 0] },
  { label: 'BACK', normal: [0, 0, -1], up: [0, 1, 0] },
] as const;

/** 꼭짓점 8개. 정규화는 `poseForNormal` 이 하므로 부호 조합을 그대로 넘긴다. */
const CORNERS = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) =>
    [-1, 1].map((z) => ({ label: `corner(${x},${y},${z})`, normal: [x, y, z] as const })),
  ),
);

const REGIONS = [
  ...FACES.map((f) => ({ label: f.label, normal: f.normal as readonly number[] })),
  ...CORNERS.map((c) => ({ label: c.label, normal: c.normal as readonly number[] })),
];

/** 축퇴가 아닌 12개 — 면 4개(±X, ±Z) + 꼭짓점 8개. 법선이 `±Y` 와 평행한 두 면만 빠진다. */
const NON_DEGENERATE = REGIONS.filter((r) => r.normal[0] !== 0 || r.normal[2] !== 0);

const vec = (a: readonly number[]): Vector3 => new Vector3(a[0], a[1], a[2]);

describe('navCubePose — 클릭 영역 법선에서 정규 자세를 낸다', () => {
  it('영역 표가 면 6 + 꼭짓점 8 = 14개이고 축퇴가 아닌 것이 12개다', () => {
    expect(REGIONS).toHaveLength(14);
    expect(NON_DEGENERATE).toHaveLength(12);
  });

  // (a) forward 가 법선의 정확한 반대.
  for (const { label, normal } of REGIONS) {
    it(`${label} — forward 가 법선의 반대를 향한다`, () => {
      const { forward } = axesOf(poseForNormal(vec(normal)));
      const opposite = vec(normal).normalize().scaleInPlace(-1);
      expect(Vector3.Dot(forward, opposite)).toBeGreaterThan(0.999);
    });
  }

  // (b) 축퇴가 아닌 12개는 `up · +Y` 가 그 방향에서 가능한 최댓값.
  for (const { label, normal } of NON_DEGENERATE) {
    it(`${label} — up 이 그 시선에서 월드 +Y 에 가장 가깝다 (롤 0)`, () => {
      const { forward, up } = axesOf(poseForNormal(vec(normal)));
      // forward 를 축으로 up 을 한 바퀴 돌려 본다. 실제 up 을 이기는 각도가 하나라도 있으면
      // 그 자세는 롤이 남아 있는 것이다 — 공식을 다시 유도하지 않고 직접 재는 방식이다.
      for (let step = 1; step < 720; step += 1) {
        const rotated = up.clone();
        rotated.rotateByQuaternionToRef(
          Quaternion.RotationAxis(forward, (step * Math.PI) / 360),
          rotated,
        );
        expect(Vector3.Dot(rotated, WORLD_UP)).toBeLessThanOrEqual(Vector3.Dot(up, WORLD_UP) + 1e-9);
      }
      expect(Vector3.Dot(up, WORLD_UP)).toBeGreaterThan(0);
    });
  }

  // (a)+(c) 면 6개는 forward·up 을 절대 좌표로 못 박는다 — TOP/BOTTOM 축퇴 규약 포함.
  for (const { label, normal, up: expectedUp } of FACES) {
    it(`${label} — forward·up 이 절대 좌표와 일치한다`, () => {
      const { forward, up } = axesOf(poseForNormal(vec(normal)));
      const expectedForward = vec(normal).scaleInPlace(-1);
      expect(forward.x).toBeCloseTo(expectedForward.x, 6);
      expect(forward.y).toBeCloseTo(expectedForward.y, 6);
      expect(forward.z).toBeCloseTo(expectedForward.z, 6);
      expect(up.x).toBeCloseTo(expectedUp[0], 6);
      expect(up.y).toBeCloseTo(expectedUp[1], 6);
      expect(up.z).toBeCloseTo(expectedUp[2], 6);
    });
  }

  /**
   * 축퇴 규약이 임의의 선택이 아님을 못 박는다 — `FRONT` 에서 화면 수평축으로 `±90°` 기울인
   * 자세(= 사용자가 드래그로 극점을 넘어갈 때 보는 그림)와 `TOP`/`BOTTOM` 자세가 일치해야
   * 큐브 클릭이 화면을 갑자기 뒤집지 않는다.
   */
  for (const { label, normal, tilt } of [
    { label: 'TOP', normal: [0, 1, 0], tilt: Math.PI / 2 },
    { label: 'BOTTOM', normal: [0, -1, 0], tilt: -Math.PI / 2 },
  ] as const) {
    it(`${label} 축퇴 규약 — FRONT 에서 화면 수평축으로 기울인 자세와 같다`, () => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      try {
        const orbit = new OrbitCamera(scene);
        const front = poseForNormal(new Vector3(0, 0, 1));
        orbit.restore({
          orientation: [front.x, front.y, front.z, front.w],
          radius: 1,
          target: [0, 0, 0],
        });
        orbit.rotate(0, tilt);

        const expected = axesOf(poseForNormal(vec(normal)));
        expect(Vector3.Dot(orbit.forward, expected.forward)).toBeCloseTo(1, 6);
        expect(Vector3.Dot(orbit.up, expected.up)).toBeCloseTo(1, 6);
      } finally {
        scene.dispose();
        engine.dispose();
      }
    });
  }

  // (d) 모든 쿼터니언이 단위 길이.
  for (const { label, normal } of REGIONS) {
    it(`${label} — 단위 쿼터니언이다`, () => {
      expect(poseForNormal(vec(normal)).length()).toBeCloseTo(1, 12);
    });
  }

  it('법선이 단위 길이가 아니어도 같은 자세를 낸다', () => {
    const unit = poseForNormal(new Vector3(0, 0, 1));
    const scaled = poseForNormal(new Vector3(0, 0, 7));
    expect(Math.abs(Quaternion.Dot(unit, scaled))).toBeCloseTo(1, 9);
  });
});

/** 화살표 4방향. 반시계로 읽지 말 것 — 축과 부호는 아래 표가 유일한 출처다. */
const ARROWS = [
  // `▶` 는 오른쪽 드래그와 같다: 시선이 화면 오른쪽(`+right`)으로 간다.
  { arrow: 'right', glyph: '▶', drag: [1, 0], dRight: 1, dUp: 0 },
  { arrow: 'left', glyph: '◀', drag: [-1, 0], dRight: -1, dUp: 0 },
  // `▼` 는 아래 드래그와 같다: 시선이 화면 아래(`-up`)로 간다.
  { arrow: 'down', glyph: '▼', drag: [0, 1], dRight: 0, dUp: -1 },
  { arrow: 'up', glyph: '▲', drag: [0, -1], dRight: 0, dUp: 1 },
] as const;

const QUARTER = Math.PI / 2;

const START_EXTENTS = { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1) };

/** 기본 시작 자세(`frame()`). 세 축 어느 것도 월드 축과 나란하지 않아 부호가 우연히 맞지 않는다. */
const startPose = (): Quaternion => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const orbit = new OrbitCamera(scene);
    orbit.applyLimits(START_EXTENTS);
    orbit.frame(START_EXTENTS);
    return orbit.orientationValue;
  } finally {
    scene.dispose();
    engine.dispose();
  }
};

/**
 * **화살표는 화면 기준 90° 회전이며, 부호를 드래그에서 상속한다.**
 *
 * 회고 `260828` 의 최대 사고가 조작 부호를 두 축 모두 반대로 낸 것이었다. 그 재발을 막는 가장
 * 싼 방법이 **부호를 다시 유도하지 않는 것**이므로 `poseForArrow` 는 `OrbitCamera.rotate()` 와
 * 같은 규약(로컬 축 post-multiply)을 그대로 쓴다. 이 describe 가 그것을 두 방향에서 못 박는다:
 * (1) **절대 방향** — `Δforward` 를 시작 자세의 `right`/`up` 에 투영한 값이 표와 일치한다.
 * (2) **드래그와의 동일성** — `rotate()` 로 `±90°` 돈 자세와 쿼터니언이 같다.
 *
 * (2) 만 두면 두 축 전역 반전이 초록으로 통과하고((1) 이 그걸 잡는다), (1) 만 두면 "규약을
 * 상속한다"는 설계가 깨져도 통과한다. **둘 다 필요하다.**
 */
describe('navCubePose — 화살표 4방향은 화면 기준 90° 회전이다', () => {
  // (1) 절대 방향. 직교 성분까지 함께 재서 축이 뒤바뀐 경우도 잡는다 — 부호만 보면
  // `▶`/`▼` 가 서로 맞바뀌어도 통과한다.
  for (const { arrow, glyph, dRight, dUp } of ARROWS) {
    it(`${glyph} — Δforward 가 [right ${dRight}, up ${dUp}] 쪽이다 (절대 방향)`, () => {
      const start = startPose();
      const before = axesOf(start);
      const after = axesOf(poseForArrow(start, arrow));
      const delta = after.forward.subtract(before.forward);
      const shown = `Δforward = [${delta.x.toFixed(3)}, ${delta.y.toFixed(3)}, ${delta.z.toFixed(3)}]`;
      expect(Vector3.Dot(delta, before.right), `${shown} — right 성분`).toBeCloseTo(dRight, 6);
      expect(Vector3.Dot(delta, before.up), `${shown} — up 성분`).toBeCloseTo(dUp, 6);
    });
  }

  // (2) 드래그와 같은 규약인가 — `rotate()` 로 같은 각을 준 자세와 쿼터니언이 일치해야 한다.
  for (const { arrow, glyph, drag } of ARROWS) {
    it(`${glyph} — rotate(${drag[0] * 90}°, ${drag[1] * 90}°) 와 같은 자세다`, () => {
      const start = startPose();
      const engine = new NullEngine();
      const scene = new Scene(engine);
      try {
        const orbit = new OrbitCamera(scene);
        orbit.restore({ orientation: [start.x, start.y, start.z, start.w], radius: 1, target: [0, 0, 0] });
        orbit.rotate(drag[0] * QUARTER, drag[1] * QUARTER);
        // 부호가 반대인 쿼터니언은 같은 자세다 — `|dot|` 로 비교한다.
        expect(Math.abs(Quaternion.Dot(orbit.orientationValue, poseForArrow(start, arrow)))).toBeCloseTo(1, 6);
      } finally {
        scene.dispose();
        engine.dispose();
      }
    });
  }

  /**
   * **FRONT 정규 자세에서는 네 화살표 전부가 이웃 면의 정규 자세에 정확히 도달한다.**
   *
   * 이것이 plan 이 "이웃 정규 자세로 이동" 안을 기각하고도 그 이득을 공짜로 얻는다고 적은
   * 성질이다 — 롤 0 이 보존되므로 90° 회전만으로 정규 자세가 나온다.
   */
  for (const { arrow, glyph, face, normal } of [
    { arrow: 'right', glyph: '▶', face: 'RIGHT', normal: [1, 0, 0] },
    { arrow: 'left', glyph: '◀', face: 'LEFT', normal: [-1, 0, 0] },
    { arrow: 'down', glyph: '▼', face: 'TOP', normal: [0, 1, 0] },
    { arrow: 'up', glyph: '▲', face: 'BOTTOM', normal: [0, -1, 0] },
  ] as const) {
    it(`FRONT 에서 ${glyph} → ${face} 정규 자세에 정확히 도달한다`, () => {
      const reached = axesOf(poseForArrow(poseForNormal(new Vector3(0, 0, 1)), arrow));
      const expected = axesOf(poseForNormal(vec(normal)));
      expect(Vector3.Dot(reached.forward, expected.forward)).toBeCloseTo(1, 6);
      expect(Vector3.Dot(reached.up, expected.up)).toBeCloseTo(1, 6);
    });
  }

  /**
   * **TOP 에서는 좌우 화살표가 정규 자세에 도달하지 못한다 — 축퇴 규약의 대가다.**
   *
   * plan 의 완료 기준 (e) 는 *"`TOP` 정규 자세에서 `▶` 를 누르면 이웃 면의 정규 자세에 정확히
   * 도달"* 이라고 적었지만 **실측으로 거짓이다.** `TOP` 의 화면 up 은 축퇴 규약이 월드 `-Z` 로
   * 못 박았고(`poseForNormal`), 화면 수직축 회전은 그 up 을 보존하므로 `RIGHT`(정규 up = 월드
   * `+Y`)에 도달할 수 없다. 실측: `forward = [-1, 0, 0]` (RIGHT 를 보기는 한다) · `up =
   * [0, 0, -1]` · `up · +Y = 0` — 즉 **90° 롤이 남는다.**
   *
   * 버그가 아니라 ADR `260826-232902` 가 기록한 축퇴 예외가 화살표에서 드러난 것이다.
   * 이 테스트는 그 한계를 절대 좌표로 고정한다 — 나중에 축퇴 규약을 손대면 여기서 잡힌다.
   */
  it('TOP 에서 ▶ 는 RIGHT 를 보지만 롤 90° 가 남는다 — 축퇴 규약의 대가', () => {
    const { forward, up } = axesOf(poseForArrow(poseForNormal(new Vector3(0, 1, 0)), 'right'));
    expect(forward.x).toBeCloseTo(-1, 6);
    expect(up.z).toBeCloseTo(-1, 6);
    expect(Vector3.Dot(up, WORLD_UP), 'up 이 월드 +Y 쪽으로 섰다면 롤이 0 이다').toBeCloseTo(0, 6);
  });

  it('결과가 단위 쿼터니언이다 — slerp 가 그대로 받아 간다', () => {
    const start = startPose();
    for (const { arrow } of ARROWS) {
      expect(poseForArrow(start, arrow).length()).toBeCloseTo(1, 9);
    }
  });
});
