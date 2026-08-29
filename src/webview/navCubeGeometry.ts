import type { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

/** 면 라벨. 월드 축 대응은 `FACES` 의 실측표 주석에 있다. */
export type NavCubeFaceLabel = 'TOP' | 'BOTTOM' | 'FRONT' | 'BACK' | 'RIGHT' | 'LEFT';

export type NavCubeRegionKind = 'face' | 'edge' | 'corner';

/** 모서리 깎은 정육면체의 한 면(영역). 면 6 · 모서리 12 · 꼭짓점 8 = 26개. */
export interface NavCubeRegion {
  /** 부호 있는 축 조합. 면 `'+Y'` · 모서리 `'+Y+Z'` · 꼭짓점 `'+X+Y+Z'` (축 순서는 X→Y→Z). */
  id: string;
  kind: NavCubeRegionKind;
  /** 면일 때만 라벨을 가진다. */
  label: NavCubeFaceLabel | null;
  /** 바깥을 향하는 단위 법선. */
  normal: Vec3;
  /** `NAV_CUBE_VERTICES` 의 인덱스. 다면체 바깥에서 볼 때 한 방향으로 도는 순서다. */
  vertices: readonly number[];
}

/** 후면 제거를 통과한 영역 하나를 화면 좌표로 옮긴 결과. */
export interface NavCubeProjectedRegion {
  region: NavCubeRegion;
  /** SVG `path` 로 그대로 이을 수 있는 화면 폴리곤. 단위는 px, y 는 아래가 양이다. */
  polygon: readonly Vec2[];
  /** 라벨을 그 면 평면에 얹는 SVG `matrix(a, b, c, d, e, f)`. 면이 아니면 `null`. */
  labelMatrix: readonly [number, number, number, number, number, number] | null;
}

/**
 * 면 사각형의 반폭. 정육면체 반폭을 1 로 두었을 때의 값이다.
 *
 * **깎인 모서리 띠의 폭은 `1 - c` 가 아니라 `(1 - c)·√2` 다** — `1 - c = 0.30` 은 축 방향으로
 * 들어간 깊이일 뿐이고, 띠의 실제 폭은 정점 `(±c, 1, c)` 와 `(±c, c, 1)` 사이 거리이므로
 * `0.4243` 이다(실측 확인). 이 수가 `navCube.ts` 의 화면 px 환산으로 이어지므로 √2 를 흘리면
 * 히트 타깃 판단이 1.41배 작게 나온다.
 *
 * 0.7 은 면이 지배적으로 크되 모서리·꼭짓점이 눈에 보이는 값이다 — 클릭 대상이 아닌
 * 모서리까지 크게 만들 이유가 없다.
 */
const FACE_HALF = 0.7;

/** 원점에서 가장 먼 정점까지의 거리. 어떤 자세에서도 잘리지 않도록 이 값으로 상자에 맞춘다. */
const CIRCUMRADIUS = Math.hypot(1, FACE_HALF, FACE_HALF);

/**
 * 후면 제거 기준. 정확히 0 으로 자르면 실루엣에 걸친 면이 부동소수 오차로 살아남아
 * 넓이 0 인 폴리곤(= 선 하나)이 그려진다.
 */
const CULL_EPSILON = 1e-6;

/** 정점을 같은 영역으로 묶을 때 쓰는 허용 오차. 좌표가 `±1`/`±c` 뿐이라 넉넉하다. */
const SUPPORT_EPSILON = 1e-9;

interface FaceSpec {
  label: NavCubeFaceLabel;
  normal: Vec3;
  /** 그 면을 정면으로 볼 때 화면 **오른쪽**이 되는 월드 방향 — 라벨의 로컬 +x. */
  labelRight: Vec3;
  /** 그 면을 정면으로 볼 때 화면 **아래**가 되는 월드 방향 — 라벨의 로컬 +y (SVG 는 y 가 아래). */
  labelDown: Vec3;
}

/**
 * 라벨 ↔ 월드 축 (plan.md 의 실측표).
 *
 * glTF 2.0 은 `+Y` up 이고 에셋 앞면이 `+Z` 를 향한다고 정의하며, 로더가 `diag(-1, 1, 1)` 을
 * 건다(`handedness.ts`). 그래서 `TOP=+Y` · `FRONT=+Z` · `RIGHT=+X` 다.
 *
 * `labelRight`/`labelDown` 은 그 면의 [[정규 자세]] 에서 화면 오른쪽·아래가 되는 월드 방향이다.
 * 씬이 좌수(`right × up = forward`)이므로 `+Z` 를 보는 자세에서 화면 오른쪽은 월드 `-X` 다 —
 * 직관과 반대로 보이지만 실측값이다. `TOP`/`BOTTOM` 은 법선이 `±Y` 와 나란해 "up 이 `+Y` 에
 * 가장 가깝다"가 정의되지 않으므로, `TOP` 은 `FRONT` 가 화면 아래로 가도록(up = `-Z`),
 * `BOTTOM` 은 그 반대로 못 박았다.
 */
const FACES: readonly FaceSpec[] = [
  { label: 'RIGHT', normal: [1, 0, 0], labelRight: [0, 0, 1], labelDown: [0, -1, 0] },
  { label: 'LEFT', normal: [-1, 0, 0], labelRight: [0, 0, -1], labelDown: [0, -1, 0] },
  { label: 'TOP', normal: [0, 1, 0], labelRight: [-1, 0, 0], labelDown: [0, 0, 1] },
  { label: 'BOTTOM', normal: [0, -1, 0], labelRight: [-1, 0, 0], labelDown: [0, 0, -1] },
  { label: 'FRONT', normal: [0, 0, 1], labelRight: [-1, 0, 0], labelDown: [0, -1, 0] },
  { label: 'BACK', normal: [0, 0, -1], labelRight: [1, 0, 0], labelDown: [0, -1, 0] },
];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * 정점 24개. 한 좌표가 `±1` 이고 나머지 둘이 `±c` 인 모든 조합 — 축 3 × 부호 2×2×2 = 24 이며
 * 중복이 없다. 세 종류의 영역이 모두 이 배열을 공유하므로 인접한 영역은 정확히 같은 점을
 * 쓴다(모서리에 틈이 생기지 않는다).
 */
const buildVertices = (): Vec3[] => {
  const vertices: Vec3[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    for (const main of [1, -1]) {
      for (const first of [1, -1]) {
        for (const second of [1, -1]) {
          const point: [number, number, number] = [0, 0, 0];
          point[axis] = main;
          point[(axis + 1) % 3] = first * FACE_HALF;
          point[(axis + 2) % 3] = second * FACE_HALF;
          vertices.push(point);
        }
      }
    }
  }
  return vertices;
};

/** 다면체의 정점 24개. 영역은 이 배열의 인덱스로만 자기 폴리곤을 가리킨다. */
export const NAV_CUBE_VERTICES: readonly Vec3[] = buildVertices();

/**
 * 그 방향으로 가장 멀리 나간 정점들 — 볼록 다면체의 support face 다.
 * 면·모서리·꼭짓점을 **한 규칙으로** 만들 수 있고(각각 4·4·3 개), 뽑힌 정점들이 모두 같은
 * `dot` 값을 가지므로 폴리곤이 평평하다는 것도 규칙에서 따라 나온다.
 */
const supportVertices = (normal: Vec3): number[] => {
  const offsets = NAV_CUBE_VERTICES.map((vertex) => dot(vertex, normal));
  const max = Math.max(...offsets);
  const picked = offsets
    .map((offset, index) => ({ offset, index }))
    .filter((entry) => max - entry.offset < SUPPORT_EPSILON)
    .map((entry) => entry.index);

  // 법선 둘레 각도로 정렬해 폴리곤 경계를 한 방향으로 훑는다. 이 다면체는 세 종류 영역의
  // 무게중심이 모두 법선 위에 있으므로(대칭), 무게중심을 따로 빼지 않고 정점을 그대로 써도
  // 각도가 올바르게 나온다.
  const seed: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(normal, seed));
  const e2 = cross(normal, e1);
  const angle = (index: number): number =>
    Math.atan2(dot(NAV_CUBE_VERTICES[index], e2), dot(NAV_CUBE_VERTICES[index], e1));
  return picked.sort((a, b) => angle(a) - angle(b));
};

const AXIS_NAMES = ['X', 'Y', 'Z'] as const;

/** 부호 벡터를 `'+Y-Z'` 같은 안정적인 id 로 만든다. */
const regionId = (signs: readonly number[]): string =>
  signs
    .map((sign, axis) => (sign === 0 ? '' : `${sign > 0 ? '+' : '-'}${AXIS_NAMES[axis]}`))
    .join('');

/** 면 6개를 id 로 찾는다 — 모서리·꼭짓점 id 는 축이 둘 이상이라 절대 걸리지 않는다. */
const FACE_BY_ID = new Map(FACES.map((spec) => [regionId(spec.normal), spec]));

interface BuiltRegion {
  region: NavCubeRegion;
  face: FaceSpec | null;
}

/**
 * 26개 영역. 부호 벡터 `s ∈ {-1, 0, 1}³` 에서 0 이 아닌 성분이 1개면 면, 2개면 모서리,
 * 3개면 꼭짓점이다 — 6 + 12 + 8 = 26.
 */
const buildRegions = (): BuiltRegion[] => {
  const built: BuiltRegion[] = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        const signs = [x, y, z];
        const nonZero = signs.filter((sign) => sign !== 0).length;
        if (nonZero === 0) {
          continue;
        }
        const id = regionId(signs);
        const face = FACE_BY_ID.get(id) ?? null;
        const normal = normalize([x, y, z]);
        built.push({
          region: {
            id,
            kind: nonZero === 1 ? 'face' : nonZero === 2 ? 'edge' : 'corner',
            label: face?.label ?? null,
            normal,
            vertices: supportVertices(normal),
          },
          face,
        });
      }
    }
  }
  return built;
};

const BUILT_REGIONS: readonly BuiltRegion[] = buildRegions();

/** 26개 영역 — 면 6 · 모서리 12 · 꼭짓점 8. 자세와 무관한 정적 데이터다. */
export const NAV_CUBE_REGIONS: readonly NavCubeRegion[] = BUILT_REGIONS.map(
  (entry) => entry.region,
);

/** 자세 쿼터니언에서 카메라 로컬 축을 꺼낸다 — `OrbitCamera` 가 `forward`/`up`/`right` 를 얻는 방식과 같다. */
const cameraAxis = (orientation: Quaternion, x: number, y: number, z: number): Vec3 => {
  const out = new Vector3(x, y, z);
  out.rotateByQuaternionToRef(orientation, out);
  out.normalize();
  return [out.x, out.y, out.z];
};

/**
 * 월드 방향 하나를 화면 방향으로 옮긴다 — `projectNavCube` 과 **같은 직교 투영·같은 부호 규약**
 * (화면 x 는 카메라 `right`, 화면 y 는 카메라 `up` 의 **반대** — SVG 는 아래가 양).
 *
 * 축 삼각대가 쓴다. 부호 규약을 이 파일 한 곳에 두는 것이 요점이다 — 호출부에서 다시 유도하면
 * 큐브와 삼각대가 서로 다른 방향으로 도는 결함이 조용히 들어온다(회고 `260828` 의 최대 사고가
 * 부호를 다시 유도한 것이었다). 배율과 중심은 정하지 않는다 — 단위 방향이면 결과 길이가 `≤ 1`
 * 이고(시선과 나란하면 0), px 로 옮기는 것은 `navCube.ts` 다.
 */
export function projectDirection(orientation: Quaternion, direction: Vec3): Vec2 {
  const right = cameraAxis(orientation, 1, 0, 0);
  const up = cameraAxis(orientation, 0, 1, 0);
  return [dot(direction, right), -dot(direction, up)];
}

/**
 * 큐브를 화면으로 옮긴다 — **직교 투영**이고, 카메라를 등진 영역은 버린다.
 *
 * **원근이 아니라 직교인 이유**: 면 위의 라벨을 화면으로 옮기는 변환이 affine 으로 **정확**해진다
 * (원근이면 근사가 되어 글자가 미세하게 어긋난다). 큐브는 크기가 고정이라 원근이 주는 것이 없다
 * (ADR `260828-204140`).
 *
 * **볼록 다면체라 후면 제거만으로 충분하고 깊이 정렬이 필요 없다.** 앞을 향한 면끼리는 서로를
 * 절대 가리지 않기 때문이며, 이 성질이 투영·클리핑을 직접 짜는 비용을 감당 가능하게 만든다.
 * 결과 배열은 그래서 순서를 신경 쓰지 않고 그대로 그려도 된다.
 *
 * @param orientation 카메라 자세(카메라 로컬 → 월드). `OrbitCamera` 가 들고 있는 것과 같다.
 * @param size 정사각 뷰박스 한 변(px). 결과 좌표는 항상 `[0, size]` 안에 있다.
 */
export function projectNavCube(orientation: Quaternion, size: number): NavCubeProjectedRegion[] {
  const right = cameraAxis(orientation, 1, 0, 0);
  const up = cameraAxis(orientation, 0, 1, 0);
  const forward = cameraAxis(orientation, 0, 0, 1);

  const half = size / 2;
  const scale = half / CIRCUMRADIUS;
  // 월드 점 → 화면. 화면 x 는 카메라 right, y 는 카메라 up 의 **반대**(SVG 는 아래가 양)다.
  const toScreen = (point: Vec3): Vec2 => [
    half + dot(point, right) * scale,
    half - dot(point, up) * scale,
  ];

  const visible: NavCubeProjectedRegion[] = [];
  for (const { region, face } of BUILT_REGIONS) {
    if (dot(region.normal, forward) >= -CULL_EPSILON) {
      continue;
    }
    const center = toScreen(region.normal);
    visible.push({
      region,
      polygon: region.vertices.map((index) => toScreen(NAV_CUBE_VERTICES[index])),
      // 라벨의 로컬 좌표는 "그 면을 정면으로 볼 때의 화면 px" 다. 그래서 정면 자세에서
      // 선형부가 정확히 항등이 되고(글자가 원래 크기·방향으로 놓인다), 면이 기울면 그만큼
      // 눌린 모양이 된다. 배율(`scale`)을 곱하지 않는 것은 글자 크기를 CSS 가 정하기 때문이다.
      labelMatrix: face
        ? [
            dot(face.labelRight, right),
            -dot(face.labelRight, up),
            dot(face.labelDown, right),
            -dot(face.labelDown, up),
            center[0],
            center[1],
          ]
        : null,
    });
  }
  return visible;
}
