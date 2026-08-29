import { describe, expect, it } from 'vitest';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import {
  NAV_CUBE_REGIONS,
  NAV_CUBE_VERTICES,
  projectDirection,
  projectNavCube,
  type NavCubeFaceLabel,
  type Vec2,
  type Vec3,
} from '../../src/webview/navCubeGeometry';

const SIZE = 90;

/**
 * 라벨과 월드 축의 대응 (plan.md 의 실측표: glTF 2.0 은 `+Y` up · 앞면 `+Z`, 로더가 `diag(-1,1,1)`).
 * **절대 축으로 못 박는다** — 회고 `260828` 의 교훈 1: "서로 같은가"만 보는 테스트는 전역
 * 반전을 초록으로 통과시킨다.
 */
const FACE_AXIS: Record<NavCubeFaceLabel, Vec3> = {
  TOP: [0, 1, 0],
  BOTTOM: [0, -1, 0],
  FRONT: [0, 0, 1],
  BACK: [0, 0, -1],
  RIGHT: [1, 0, 0],
  LEFT: [-1, 0, 0],
};

/**
 * 그 면을 정면으로 보는 자세에서 화면 up 이 되는 월드 방향.
 * `TOP`/`BOTTOM` 은 법선이 `±Y` 와 평행해 "up 이 `+Y` 에 가장 가깝다"가 정의되지 않으므로 규약이다
 * (`TOP` 은 `FRONT` 가 화면 아래로 가도록 up = `-Z`).
 */
const FACE_UP: Record<NavCubeFaceLabel, Vec3> = {
  TOP: [0, 0, -1],
  BOTTOM: [0, 0, 1],
  FRONT: [0, 1, 0],
  BACK: [0, 1, 0],
  RIGHT: [0, 1, 0],
  LEFT: [0, 1, 0],
};

/**
 * 카메라 축 셋에서 자세 쿼터니언을 만든다.
 *
 * 실측: `Matrix.FromValues` 의 세 행에 (right, up, forward) 를 넣고 `FromRotationMatrix` 를
 * 태우면, 그 쿼터니언으로 `(1,0,0)/(0,1,0)/(0,0,1)` 을 돌렸을 때 그 셋이 그대로 나온다 —
 * `OrbitCamera` 가 자세에서 축을 꺼내는 방식과 같은 규약이다.
 */
const poseFromBasis = (right: Vector3, up: Vector3, forward: Vector3): Quaternion =>
  Quaternion.FromRotationMatrix(
    // prettier-ignore
    Matrix.FromValues(
      right.x, right.y, right.z, 0,
      up.x, up.y, up.z, 0,
      forward.x, forward.y, forward.z, 0,
      0, 0, 0, 1,
    ),
  );

/** 그 면을 정면으로 보는 자세. 좌수 기저는 `right × up = forward` 를 만족한다 (실측: `(1,0,0)×(0,1,0)=(0,0,1)`). */
const headOnPose = (label: NavCubeFaceLabel): Quaternion => {
  const forward = new Vector3(...FACE_AXIS[label]).scale(-1);
  const up = new Vector3(...FACE_UP[label]);
  return poseFromBasis(Vector3.Cross(up, forward), up, forward);
};

const centroid3 = (points: readonly Vec3[]): Vec3 => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
  points.reduce((sum, p) => sum + p[2], 0) / points.length,
];

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 볼록 폴리곤 내부 판정 — 모든 변에 대해 외적 부호가 같으면 안쪽이다. */
const contains = (polygon: readonly Vec2[], px: number, py: number): boolean => {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (Math.abs(cross) < 1e-9) {
      continue;
    }
    if (sign === 0) {
      sign = Math.sign(cross);
    } else if (Math.sign(cross) !== sign) {
      return false;
    }
  }
  return true;
};

describe('navCubeGeometry — 26면 다면체', () => {
  it('영역이 정확히 26개이고 면 6 · 모서리 12 · 꼭짓점 8 이다', () => {
    expect(NAV_CUBE_REGIONS).toHaveLength(26);
    const count = (kind: string): number =>
      NAV_CUBE_REGIONS.filter((region) => region.kind === kind).length;
    expect(count('face')).toBe(6);
    expect(count('edge')).toBe(12);
    expect(count('corner')).toBe(8);
  });

  it('정점이 중복 없이 24개이고 모든 영역이 그 인덱스만 쓴다', () => {
    expect(NAV_CUBE_VERTICES).toHaveLength(24);
    const keys = new Set(NAV_CUBE_VERTICES.map((v) => v.join(',')));
    expect(keys.size).toBe(24);

    const used = new Set<number>();
    for (const region of NAV_CUBE_REGIONS) {
      // 면 사각형 4 · 모서리 사각형 4 · 꼭짓점 삼각형 3.
      expect(region.vertices).toHaveLength(region.kind === 'corner' ? 3 : 4);
      expect(new Set(region.vertices).size).toBe(region.vertices.length);
      for (const index of region.vertices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(24);
        used.add(index);
      }
    }
    expect(used.size).toBe(24);
  });

  it('모든 영역의 법선이 바깥을 향하고 단위 길이다', () => {
    for (const region of NAV_CUBE_REGIONS) {
      const center = centroid3(region.vertices.map((index) => NAV_CUBE_VERTICES[index]));
      expect(dot3(region.normal, center)).toBeGreaterThan(0);
      expect(Math.hypot(...region.normal)).toBeCloseTo(1, 12);
      // 모든 정점이 그 법선이 정의하는 한 평면 위에 있다 — 폴리곤이 실제로 평평하다.
      const offsets = region.vertices.map((index) => dot3(region.normal, NAV_CUBE_VERTICES[index]));
      for (const offset of offsets) {
        expect(offset).toBeCloseTo(offsets[0], 12);
      }
    }
  });

  it('면 6개의 법선이 라벨↔월드축 실측표와 정확히 일치한다', () => {
    const faces = NAV_CUBE_REGIONS.filter((region) => region.kind === 'face');
    const byLabel = new Map(faces.map((face) => [face.label, face.normal]));
    expect(byLabel.size).toBe(6);
    for (const [label, axis] of Object.entries(FACE_AXIS) as [NavCubeFaceLabel, Vec3][]) {
      expect(byLabel.get(label)).toEqual(axis);
    }
    // 면이 아닌 영역은 라벨을 갖지 않는다.
    for (const region of NAV_CUBE_REGIONS) {
      expect(region.label === null).toBe(region.kind !== 'face');
    }
  });
});

describe('navCubeGeometry — 직교 투영과 후면 제거', () => {
  it('TOP 정면 자세에서는 카메라를 향한 9개(면 1 · 모서리 4 · 꼭짓점 4)만 남는다', () => {
    const visible = projectNavCube(headOnPose('TOP'), SIZE);
    expect(visible).toHaveLength(9);
    const kinds = visible.map((item) => item.region.kind);
    expect(kinds.filter((k) => k === 'face')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'edge')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'corner')).toHaveLength(4);
    expect(visible.find((item) => item.region.kind === 'face')?.region.label).toBe('TOP');
  });

  it('TOP 정면 자세에서 FRONT(+Z) 쪽이 화면 아래로 간다 — 축퇴 규약의 절대 방향', () => {
    const visible = projectNavCube(headOnPose('TOP'), SIZE);
    const front = visible.find((item) => item.region.id === '+Y+Z');
    expect(front).toBeDefined();
    const y = front!.polygon.reduce((sum, p) => sum + p[1], 0) / front!.polygon.length;
    expect(y).toBeGreaterThan(SIZE / 2);
    const back = visible.find((item) => item.region.id === '+Y-Z');
    expect(back).toBeDefined();
    const backY = back!.polygon.reduce((sum, p) => sum + p[1], 0) / back!.polygon.length;
    expect(backY).toBeLessThan(SIZE / 2);
  });

  it('여섯 면 각각의 정면 자세에서 그 면이 화면 중심을 덮고 라벨 affine 이 항등이다', () => {
    for (const label of Object.keys(FACE_AXIS) as NavCubeFaceLabel[]) {
      const visible = projectNavCube(headOnPose(label), SIZE);
      const face = visible.find((item) => item.region.label === label);
      expect(face, label).toBeDefined();
      expect(contains(face!.polygon, SIZE / 2, SIZE / 2), label).toBe(true);

      const matrix = face!.labelMatrix;
      expect(matrix, label).not.toBeNull();
      const [a, b, c, d, e, f] = matrix!;
      // 회전·전단이 없다: 비대각이 0, 대각이 1. 뒤집힘(-1)이나 90° 회전(0,1,-1,0)이면 여기서 걸린다.
      expect(a, label).toBeCloseTo(1, 9);
      expect(b, label).toBeCloseTo(0, 9);
      expect(c, label).toBeCloseTo(0, 9);
      expect(d, label).toBeCloseTo(1, 9);
      expect(e, label).toBeCloseTo(SIZE / 2, 9);
      expect(f, label).toBeCloseTo(SIZE / 2, 9);
    }
  });

  it('기울어진 자세에서도 라벨 affine 이 그 면의 폴리곤과 정확히 맞는다', () => {
    // 정면 자세에서는 affine 의 비대각(b, c)이 0 이라 **부호를 검사할 수 없다.** 기울여야
    // 라벨이 뒤집혔는지(거울상)가 드러난다.
    //
    // 라벨의 로컬 단위는 "정면에서 본 화면 px" 이므로, 면 사각형의 로컬 반폭은 정면 자세
    // 폴리곤에서 **재서** 얻는다 — 구현 상수를 테스트로 베껴 오지 않는다.
    const topHeadOn = projectNavCube(headOnPose('TOP'), SIZE);
    const topFace = topHeadOn.find((item) => item.region.label === 'TOP')!;
    const halfWidth = Math.max(...topFace.polygon.map(([x]) => Math.abs(x - SIZE / 2)));
    expect(halfWidth).toBeGreaterThan(1);

    // 세 축 어느 것과도 나란하지 않은 자세 둘 — 첫 번째가 `orbit.frame()` 의 기본 시작 자세다.
    const tilted = [
      Quaternion.RotationYawPitchRoll((-3 * Math.PI) / 4, Math.PI / 2 - Math.PI / 2.5, 0),
      Quaternion.RotationYawPitchRoll((-3 * Math.PI) / 4, Math.PI / 3, 0.4),
    ];
    for (const pose of tilted) {
      for (const item of projectNavCube(pose, SIZE)) {
        if (item.region.kind !== 'face') {
          continue;
        }
        const [a, b, c, d, e, f] = item.labelMatrix!;
        // affine 이 로컬 네 귀퉁이를 보내는 자리와 실제 투영 폴리곤이 같은 점 집합이어야 한다.
        const mapped = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([u, v]) => [
          a * u * halfWidth + c * v * halfWidth + e,
          b * u * halfWidth + d * v * halfWidth + f,
        ]);
        for (const [px, py] of item.polygon) {
          const nearest = Math.min(...mapped.map(([mx, my]) => Math.hypot(mx - px, my - py)));
          expect(nearest, `${item.region.label} (${px}, ${py})`).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('면이 아닌 영역은 라벨 affine 을 내지 않는다', () => {
    const visible = projectNavCube(headOnPose('TOP'), SIZE);
    for (const item of visible) {
      expect(item.labelMatrix === null).toBe(item.region.kind !== 'face');
    }
  });

  it('어떤 자세에서도 투영이 상자 밖으로 나가지 않고, 남는 영역이 9~13개다', () => {
    // 결정적 난수(LCG) — 실패를 재현할 수 있어야 한다.
    let seed = 20260828;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const q = new Quaternion(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1, next() * 2 - 1);
      if (q.length() < 1e-6) {
        continue;
      }
      q.normalize();
      const visible = projectNavCube(q, SIZE);
      // 볼록 다면체의 실루엣: 어떤 방향에서도 절반 남짓만 보인다.
      expect(visible.length).toBeGreaterThanOrEqual(9);
      expect(visible.length).toBeLessThanOrEqual(13);
      for (const item of visible) {
        for (const [x, y] of item.polygon) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(SIZE);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(SIZE);
        }
      }
    }
  });
});

/**
 * **축 삼각대의 부호 규약을 절대 방향으로 못 박는다.**
 *
 * 회고 `260828` 의 교훈 3: *"서로 같은가"* 만 보는 테스트는 두 축 전역 반전을 초록으로
 * 통과시킨다 — v0.3.0 에서 실제로 그 사고가 났다. 그래서 알려진 자세 둘에서 각 월드 축이
 * **화면의 어느 쪽으로 뻗는지**를 값으로 박는다. 화면 y 는 아래가 양이므로 `-1` 이 위다.
 */
describe('navCubeGeometry — 방향 하나의 투영 (축 삼각대)', () => {
  const expectVec2 = (actual: Vec2, expected: Vec2, name: string): void => {
    const shown = `[${actual.map((n) => n.toFixed(6)).join(', ')}]`;
    expect(Math.abs(actual[0] - expected[0]), `${name} = ${shown}`).toBeLessThan(1e-9);
    expect(Math.abs(actual[1] - expected[1]), `${name} = ${shown}`).toBeLessThan(1e-9);
  };

  it('FRONT 정규 자세: +X 는 화면 왼쪽 · +Y 는 위 · +Z 는 카메라를 향해 길이 0 이다', () => {
    // `FRONT` 를 정면으로 보면 화면 오른쪽이 월드 `-X` 다(`FACES` 의 `labelRight`) — 좌수
    // 기저의 결과이며 직관과 반대로 보이지만 실측값이다. `+Z` 는 시선과 나란해 점으로 눌린다.
    const pose = headOnPose('FRONT');
    expectVec2(projectDirection(pose, [1, 0, 0]), [-1, 0], 'FRONT +X');
    expectVec2(projectDirection(pose, [0, 1, 0]), [0, -1], 'FRONT +Y');
    expectVec2(projectDirection(pose, [0, 0, 1]), [0, 0], 'FRONT +Z');
  });

  it('TOP 정규 자세: +Z 는 화면 아래다 — 축퇴 규약(up = -Z)이 그대로 드러난다', () => {
    const pose = headOnPose('TOP');
    expectVec2(projectDirection(pose, [1, 0, 0]), [-1, 0], 'TOP +X');
    expectVec2(projectDirection(pose, [0, 1, 0]), [0, 0], 'TOP +Y');
    expectVec2(projectDirection(pose, [0, 0, 1]), [0, 1], 'TOP +Z');
  });

  /**
   * 삼각대가 **큐브와 같은 투영**을 쓴다는 것을 규약 수준에서 잡는다.
   *
   * 두 곳이 부호나 축을 따로 유도하면 큐브와 삼각대가 서로 다른 방향으로 도는데, 그 결함은
   * 눈으로만 잡히고 위의 두 테스트는 통과한다(둘 다 옳게 유도했더라도 한쪽만 나중에 바뀔 수
   * 있다). 면 중심의 투영 오프셋이 **법선의 투영과 같은 방향이고 배율이 하나**임을 요구한다.
   */
  it('면 중심 오프셋이 법선의 투영과 같은 방향·같은 배율이다 — 큐브와 규약이 하나다', () => {
    let seed = 20260829;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const half = SIZE / 2;
    let samples = 0;
    let scale: number | null = null;
    for (let trial = 0; trial < 100; trial += 1) {
      const q = new Quaternion(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1, next() * 2 - 1);
      if (q.length() < 1e-6) {
        continue;
      }
      q.normalize();
      for (const item of projectNavCube(q, SIZE)) {
        if (item.region.kind !== 'face') {
          continue;
        }
        const [ox, oy] = [item.labelMatrix![4] - half, item.labelMatrix![5] - half];
        const [px, py] = projectDirection(q, item.region.normal);
        const length = Math.hypot(px, py);
        // 정면으로 보는 면은 투영 길이가 0 이라 방향이 정의되지 않는다 — 건너뛴다.
        if (length < 1e-3) {
          continue;
        }
        const where = `${item.region.label}: 오프셋 [${ox.toFixed(4)}, ${oy.toFixed(4)}] vs 투영 [${px.toFixed(4)}, ${py.toFixed(4)}]`;
        expect(Math.abs(ox * py - oy * px), `${where} — 방향이 어긋난다`).toBeLessThan(1e-6);
        expect(ox * px + oy * py, `${where} — 방향이 반대다`).toBeGreaterThan(0);
        const ratio = Math.hypot(ox, oy) / length;
        if (scale === null) {
          scale = ratio;
        }
        expect(Math.abs(ratio - scale), `${where} — 배율이 ${ratio} (기준 ${scale})`).toBeLessThan(1e-9);
        samples += 1;
      }
    }
    // 표본이 없으면 위 단정이 하나도 실행되지 않고도 초록이 된다.
    expect(samples, '표본이 너무 적다 — 단정이 실행되지 않았다').toBeGreaterThan(200);
  });
});
