import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import {
  NAV_CUBE_REGIONS,
  projectDirection,
  projectNavCube,
  type NavCubeFaceLabel,
  type NavCubeRegionKind,
  type Vec2,
  type Vec3,
} from './navCubeGeometry.js';
import { shortcutForFace, shortcutForKey } from './cameraShortcuts.js';
import { poseForArrow, poseForNormal, type NavCubeArrow } from './navCubePose.js';

/**
 * SVG 뷰박스 한 변(px). CSS 의 `#nav-cube` 크기와 같게 두므로 **투영 좌표가 곧 화면 px** 이고,
 * 라벨 배치 행렬을 그대로 SVG `matrix()` 에 넣을 수 있다.
 */
const CUBE_SIZE = 90;

/**
 * 클릭을 받는 영역의 종류 — 면 6 + 꼭짓점 8 = 14.
 *
 * 모서리 12개는 **그리기만** 한다 — plan 의 non-goal 이며, 근거는 실사용 빈도가 낮다는 것과
 * 히트 타깃이 얇다는 것이다.
 *
 * **폭은 실측값을 적는다** (`(1 - c)·√2 × scale`, scale = `45/hypot(1, 0.7, 0.7)` = 31.98):
 * 면을 정면으로 볼 때 **13.57px** 이 상한이고, 기본 시작 자세에서는 보이는 5개가
 * **9.77 / 13.11 / 13.11 / 13.57 / 9.77 px**, 자세를 훑으면 스치는 각도에서 **0.5px** 까지
 * 줄어든다. 즉 상한은 마우스 히트 타깃으로 경계선상이고 하한은 쓸 수 없다. 모서리 클릭을
 * 다시 검토하는 사람은 이 수에서 출발하라 — 예전 주석의 `~8px` 는 `1 - c` 에서 √2 를 흘린
 * 값이었다.
 */
const CLICKABLE_KINDS: readonly NavCubeRegionKind[] = ['face', 'corner'];

/**
 * 큐브 바깥 여백(px). 화살표 4개가 이 띠 안에 들어간다 — 큐브 폴리곤은 외접반지름에 맞춰
 * `CUBE_SIZE` 정사각을 꽉 채우므로(`navCubeGeometry.ts`) 여백 없이는 화살표를 놓을 자리가 없다.
 */
const ARROW_MARGIN = 22;

/** SVG 뷰박스 한 변 = 큐브 + 양쪽 여백. **`#nav-cube` 의 CSS 크기와 같아야 한다.** */
const BOX_SIZE = CUBE_SIZE + ARROW_MARGIN * 2;

/**
 * 화살표 삼각형 — 상자 중심에서 잰 밑변·꼭짓점 거리와 밑변 반폭(px).
 *
 * 큐브의 최대 반지름이 `CUBE_SIZE / 2 = 45` 이므로 밑변을 47 에 두면 **어떤 자세에서도** 겹치지
 * 않는다. 히트 타깃은 `17 x 18 px` 이 되는데, 클릭 대상이 아닌 모서리 띠의 상한(13.57px)보다
 * 넉넉해야 하는 이유가 있다: **화살표가 유일한 90° 이동 수단이다** — 면을 정면으로 보면 인접
 * 4면의 `dot(법선, forward)` 가 정확히 0 이 되어 후면 제거되므로, 큐브만으로는 이웃 면에 갈 수
 * 없다(part 1/2 실측: 정면 도달 후 클릭 가능한 것이 면 1 + 꼭짓점 4 = 5개로 줄어든다).
 */
const ARROW_BASE = 47;
const ARROW_TIP = 64;
const ARROW_HALF = 9;

/**
 * 홈 버튼(작은 등각 큐브)의 중심 — 상자 중심에서 오른쪽·아래로 각각 이만큼(px).
 *
 * 대각 모서리가 비어 있는 유일한 자리다: 큐브 폴리곤의 최대 반지름이 45px 이고 화살표는 변
 * 중앙(밑변 반폭 `ARROW_HALF` = 9)만 쓴다. 실측(상자 중심 기준): 아이콘 중심까지 67.88px,
 * **육각형의 가장 가까운 꼭짓점까지 58.28px** 로 45 밖이며(꼭짓점 6개가 58.28 / 61.22 / 66.00 /
 * 71.13 / 75.29 / 77.58px), 오른쪽·아래로 최대 56.66 / 58.00px 이라 상자(반변 67) 안에 들어온다.
 * 예전 주석의 `54.7` 은 육각형 위의 점이 아니었다 — **바운딩 박스**의 모서리(최좌 꼭짓점의 x 와
 * 최상 꼭짓점의 y 를 섞은 `hypot(48-8.66, 48-10)`)여서 여유를 3.6px 작게 보이게 했다.
 */
const HOME_OFFSET = 48;

/**
 * 작은 큐브의 외접반지름(px). 히트 타깃이 `17 x 20px` 로 화살표(`17 x 18`)와 같은 급이다 —
 * 홈 버튼도 클릭 대상이 아닌 모서리 띠의 상한(13.57px)보다 넉넉해야 한다.
 */
const HOME_RADIUS = 10;

/**
 * 축 삼각대의 중심 — 상자 중심에서 왼쪽·아래로 각각 이만큼(px). 홈 버튼(오른쪽 아래)과 대칭인
 * 대각 모서리이므로 큐브 폴리곤(최대 반지름 45)과 변 중앙의 화살표를 둘 다 비껴간다.
 *
 * **여백을 자세 20,000개로 훑어 쟀다**: 문자 중심에서 큐브 실루엣까지 최소 **5.90px**, 선 끝에서
 * **10.05px** 이다. 문자 글리프가 `3.9 x 7px` 로 실측되므로 최악의 자세에서도 글자 상자가 큐브
 * 선에 닿지 않는다. 상자 쪽 여백은 **6.33px** — 삼각대 bbox `[18.33, 104.55, 29.11, 28.05]` vs
 * 상자 `[12, 12, 134, 134]` 로 문자까지 전부 상자 안이다.
 * 세 수(46 · 13 · 18)는 서로 묶여 있다 — 하나를 키우면 큐브나 상자 경계를 먹는다.
 */
const TRIAD_OFFSET = 46;

/** 선 하나의 길이(px). 축이 화면과 나란할 때의 값이고, 시선과 나란하면 0 으로 눌린다. */
const TRIAD_LENGTH = 13;

/** 문자 중심까지의 거리(px). 선 끝(13) 바깥에 두어 선과 겹치지 않게 한다. */
const TRIAD_LABEL = 18;

/**
 * 축 삼각대의 세 축 — 월드 방향과 그 색·문자.
 *
 * **RGB 는 ADR `260826-094348` 의 "M 트라이컬러가 유일한 유채색 예외"에 대한 두 번째 예외다**
 * (ADR `260828-204140`). 근거 둘 중 하나가 **`X`/`Y`/`Z` 문자를 함께 찍어 색맹 전달을 확보한다**
 * 는 것이므로 **문자를 빼면 이 예외가 정당성을 잃는다** — 문자는 장식이 아니라 결정의 전제다.
 *
 * 값은 이 배열에만 둔다(CSS 가 아니라 여기서 attribute 로 붙이는 이유다) — 웹뷰 chrome 의 다른
 * 색은 전부 `var(--ml-*)` 여야 하고, hex 를 스타일시트에 풀어 놓으면 번지기 쉽다.
 *
 * **순수 RGB 를 쓰지 않는다.** 배경 3상태 중 두 극단(`light` = `#ffffff`, `dark` = `#1f1f1f`,
 * `src/background.ts`)에 대해 대비를 재 보면 `#00ff00` 은 흰 배경에서 **1.37:1** 이고
 * `#0000ff` 는 어두운 배경에서 **1.92:1** 로 둘 다 읽히지 않는다. 아래 셋은 실측으로 양쪽 모두
 * **3.8:1 이상**이다 (X 4.05/4.07 · Y 3.84/4.29 · Z 4.06/4.06).
 */
const TRIAD_AXES: readonly { axis: 'X' | 'Y' | 'Z'; direction: Vec3; color: string }[] = [
  { axis: 'X', direction: [1, 0, 0], color: '#d94f4f' },
  { axis: 'Y', direction: [0, 1, 0], color: '#37943f' },
  { axis: 'Z', direction: [0, 0, 1], color: '#3b82c4' },
];

/** 화살표 한 종류. `direction` 은 상자 중심에서 밖으로 향하는 축 방향이다(SVG 는 y 가 아래가 양). */
interface ArrowSpec {
  /** DOM id. e2e 가 이 id 로 실제 클릭한다. */
  id: string;
  arrow: NavCubeArrow;
  direction: Vec2;
}

/** 상·하·좌·우 4개. 회전 축과 부호는 `poseForArrow` 가 소유하며 여기서는 자리만 정한다. */
const ARROWS: readonly ArrowSpec[] = [
  { id: 'nav-cube-arrow-up', arrow: 'up', direction: [0, -1] },
  { id: 'nav-cube-arrow-down', arrow: 'down', direction: [0, 1] },
  { id: 'nav-cube-arrow-left', arrow: 'left', direction: [-1, 0] },
  { id: 'nav-cube-arrow-right', arrow: 'right', direction: [1, 0] },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 큐브가 카메라와 이야기하는 유일한 창구. 씬도 캔버스도 모르게 둔다. */
export interface NavCubeHost {
  /** 현재 카메라 자세. 큐브는 이 값 하나로 전부 그려진다. */
  orientation: () => Quaternion;
  /**
   * 보간이 끝나면 도달할 자세 — 보간 중이 아니면 `orientation()` 과 같다.
   *
   * **화살표만 이것을 읽는다.** 화살표의 목적지는 상대값(현재 자세 + 90°)이라 보간 중인 자세를
   * 읽으면 남은 각도가 버려진다 — 실측으로 `▶` 를 더블클릭하면 180° 가 아니라 **90°** 만
   * 돌았다(`OrbitCamera.destinationOrientationValue`). 그리는 일은 `orientation()` 이 맡는다:
   * 큐브는 보간 중인 **지금** 자세를 보여야 한다.
   */
  destinationOrientation: () => Quaternion;
  /** 클릭한 영역의 [[정규 자세]] 로 부드럽게 옮긴다. */
  animateTo: (orientation: Quaternion) => void;
  /** 첫 자세·거리·타깃으로 되돌린다 — 홈 버튼. 보간 없이 즉시 바뀐다. */
  resetView: () => void;
}

export interface NavCube {
  /** 카메라 자세를 다시 읽어 그린다. 언제 부를지는 호출부가 정한다. */
  render: () => void;
}

const round = (value: number): string => value.toFixed(3);

/** 열린 꺾은선 하나. 채움에 넓이를 더하지 않으므로 도형 안의 선을 그릴 때 쓴다. */
const toPolyline = (points: readonly Vec2[]): string =>
  points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x)},${round(y)}`).join(' ');

const toPathData = (polygon: readonly Vec2[]): string => `${toPolyline(polygon)}Z`;

/** 바깥을 향하는 이등변삼각형 하나. */
const arrowPath = ([dx, dy]: Vec2): string => {
  const center = BOX_SIZE / 2;
  // 밑변은 바깥 방향에 수직이다 — 방향이 축뿐이므로 성분을 맞바꾸면 그것이 수직 벡터다.
  const [px, py] = [-dy, dx];
  return toPathData([
    [center + dx * ARROW_TIP, center + dy * ARROW_TIP],
    [center + dx * ARROW_BASE + px * ARROW_HALF, center + dy * ARROW_BASE + py * ARROW_HALF],
    [center + dx * ARROW_BASE - px * ARROW_HALF, center + dy * ARROW_BASE - py * ARROW_HALF],
  ]);
};

/**
 * **4방향 화살표 — 화면 기준 90° 회전.**
 *
 * 자세와 무관한 정적 도형이므로 `render()` 가 손대지 않는다. 큐브 면과 달리 후면 제거 대상이
 * 아니어서 **어떤 자세에서도 클릭할 수 있고**, 그것이 화살표를 넣는 이유다.
 */
const buildArrows = (host: NavCubeHost): SVGGElement => {
  const group = document.createElementNS(SVG_NS, 'g');
  for (const { id, arrow, direction } of ARROWS) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'arrow');
    path.id = id;
    path.setAttribute('d', arrowPath(direction));
    // 면 클릭과 **같은 `animateTo` 콜백**을 지난다 — 그래야 `main.ts` 의 `canvas.focus()` 를
    // 물려받아 화살표를 누른 뒤에도 방향키가 산다. SVG `path` 는 focusable 이 아니라서 클릭이
    // 캔버스의 포커스를 `<body>` 로 흘려보내고, `keydown` 을 캔버스에서 듣는 `cameraInput` 이
    // 이벤트를 못 받는다 — part 1/2 가 실측으로 잡은 결함이며(ArrowRight 200ms 의 시선 변화가
    // 1.65 -> 0.0000) 새 조작기마다 재발할 수 있다.
    //
    // **`orientation()` 이 아니라 `destinationOrientation()` 에서 90° 를 더한다.** 보간 중인
    // 자세를 읽으면 남은 각도가 버려져 90° 가 누적되지 않는다 — 실측으로 `▶` 더블클릭이
    // 180° 대신 **90°** 였고(두 번째 클릭이 삼켜진다), `▶` 뒤 80ms 에 `◀` 를 누르면 원래
    // 자세에서 **61.44° 어긋난** 곳에 남았다. 목적 자세에 합성하면 둘 다 정확해진다.
    path.addEventListener('click', () =>
      host.animateTo(poseForArrow(host.destinationOrientation(), arrow)),
    );
    group.append(path);
  }
  return group;
};

/**
 * 작은 등각 큐브 하나 — 육각 실루엣과 그 안쪽 모서리 3개를 **두 `path` 로 나눠** 준다.
 *
 * 실루엣을 **하나의 닫힌 육각형**으로 두는 것이 중요하다. 면 3장으로 나누면 세 면이 만나는
 * 중심점이 어느 면의 내부도 아니게 되고, 바운딩 박스 중심을 찍는 클릭(`locator.click()`)이 그
 * 경계에 걸린다.
 *
 * **안쪽 모서리를 같은 `path` 에 넣으면 안 된다.** SVG 는 채움을 계산할 때 열린 서브패스를
 * 암묵적으로 닫는데, 꺾은선 `(-w,-h) → (0,0) → (w,-h)` 가 만드는 삼각형의 감김 방향이 육각형과
 * **반대**라 `fill-rule: nonzero` 가 그 영역을 0 으로 상쇄한다. 실측(합쳐 두었을 때):
 * `isPointInFill(115, 111.67)` = **false**, 같은 지점의 `elementFromPoint` = **`CANVAS#canvas`**
 * (`pointer-events` 기본값이 `visiblePainted` 라 구멍은 클릭도 흘려보낸다), 렌더 픽셀은 다크에서
 * **31**(배경 `#1f1f1f` 그대로) vs 채움 **109**. 육각형 259.8px² 중 **43.3px²(17%)** 가 뚫려
 * 큐브가 아니라 뚜껑 열린 상자로 읽혔고, 그 17% 의 클릭이 캔버스로 새어 나갔다.
 * 예전 주석의 *"열린 서브패스라 채움에 넓이를 더하지 않는다"* 는 사실과 반대였다.
 */
const homeCubePaths = (center: number, r: number): { silhouette: string; edges: string } => {
  // 등각 육각형: 반폭 `r·√3/2`, 위아래 꼭짓점만 `r` 이다.
  const w = (r * Math.sqrt(3)) / 2;
  const h = r / 2;
  const at = (dx: number, dy: number): Vec2 => [center + dx, center + dy];
  return {
    silhouette: toPathData([at(0, -r), at(w, -h), at(w, h), at(0, r), at(-w, h), at(-w, -h)]),
    edges: [
      toPolyline([at(-w, -h), at(0, 0), at(w, -h)]),
      toPolyline([at(0, 0), at(0, r)]),
    ].join(' '),
  };
};

/**
 * **홈 버튼 — 첫 자세·거리·타깃으로 되돌린다.**
 *
 * 화살표와 같은 이유로 자세와 무관한 정적 도형이므로 `render()` 가 손대지 않는다. 되돌리는 일
 * 자체는 `viewer.resetView()` 하나이며(`orbit.frame(extents)`), 큐브는 그것을 호출할 창구만 안다.
 */
const buildHome = (host: NavCubeHost): SVGGElement => {
  const group = document.createElementNS(SVG_NS, 'g');
  const { silhouette, edges } = homeCubePaths(BOX_SIZE / 2 + HOME_OFFSET, HOME_RADIUS);

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', 'home');
  path.id = 'nav-cube-home';
  path.setAttribute('d', silhouette);
  // 아이콘뿐인 조작기라 이름을 붙여 준다. SVG 는 `title` **속성**이 아니라 자식 요소다.
  const title = document.createElementNS(SVG_NS, 'title');
  const home = shortcutForKey('0');
  title.textContent = home ? `Reset view (${home.key})` : 'Reset view';
  path.append(title);
  // 화살표와 같은 포커스 함정이 있다 — 이 클릭도 캔버스의 포커스를 앗아가면 방향키가 죽는다.
  // 되돌리는 것은 `main.ts` 의 콜백이다(큐브는 캔버스를 모르는 채로 둔다).
  path.addEventListener('click', () => host.resetView());

  // 안쪽 모서리는 **채움이 없는 별도 `path`** 이고 클릭을 받지 않는다 — 실루엣 위에 그려도
  // 히트 영역이 온전하고, 클릭·`:hover` 는 그대로 실루엣이 받는다(`homeCubePaths` 주석).
  const inner = document.createElementNS(SVG_NS, 'path');
  inner.setAttribute('class', 'home-edges');
  inner.setAttribute('d', edges);

  group.append(path, inner);
  return group;
};

/**
 * **RGB 축 삼각대 — 큐브 왼쪽 아래.** 월드 `X`·`Y`·`Z` 를 현재 카메라 자세로 투영한 선 3개와
 * 그 끝에 찍는 `X`/`Y`/`Z` 문자 3개다.
 *
 * 자세를 따라 돌아야 하므로 화살표·홈 버튼과 달리 `render()` 가 매 갱신마다 좌표를 갈아 끼운다.
 * 투영은 `projectDirection` 하나에 맡긴다 — 부호를 여기서 다시 유도하면 큐브와 삼각대가 서로
 * 다른 방향으로 도는 결함이 조용히 들어온다(회고 `260828`).
 *
 * **뒤를 향한 축도 그린다.** 후면 제거하면 선·문자의 개수가 자세마다 흔들리고, 축이 통째로
 * 사라지는 순간 "어느 쪽이 X 인가"라는 이 물건의 목적이 깨진다. 시선과 나란한 축은 길이가 0 으로
 * 눌려 점이 되며, 그것이 "이 축은 화면을 향한다"는 올바른 정보다.
 *
 * 클릭 대상이 **아니다** — 그 위를 드래그하면 아래 캔버스가 궤도 회전을 받아야 한다.
 * `pointer-events: none` 은 CSS 가 못 박는다(`webviewHtml.ts` 의 `.triad`).
 */
const buildTriad = (): { group: SVGGElement; update: (orientation: Quaternion) => void } => {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'triad');
  group.id = 'nav-cube-triad';
  const cx = BOX_SIZE / 2 - TRIAD_OFFSET;
  const cy = BOX_SIZE / 2 + TRIAD_OFFSET;

  const axes = TRIAD_AXES.map(({ axis, direction, color }) => {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'triad-line');
    line.id = `nav-cube-triad-${axis.toLowerCase()}`;
    // 색은 CSS 가 아니라 여기서 붙인다 — hex 를 스타일시트로 내보내지 않는다(`TRIAD_AXES`).
    line.setAttribute('stroke', color);
    line.setAttribute('x1', round(cx));
    line.setAttribute('y1', round(cy));

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'triad-label');
    text.dataset.axis = axis;
    text.setAttribute('fill', color);
    text.textContent = axis;
    return { direction, line, text };
  });

  // 선을 먼저, 문자를 뒤에 붙인다 — 큐브가 라벨을 면 위에 올리는 것과 같은 이유다. 두 축이
  // 화면에서 겹칠 때 문자가 선 아래로 숨지 않는다.
  for (const { line } of axes) {
    group.append(line);
  }
  for (const { text } of axes) {
    group.append(text);
  }

  const update = (orientation: Quaternion): void => {
    for (const { direction, line, text } of axes) {
      const [dx, dy] = projectDirection(orientation, direction);
      line.setAttribute('x2', round(cx + dx * TRIAD_LENGTH));
      line.setAttribute('y2', round(cy + dy * TRIAD_LENGTH));
      text.setAttribute('x', round(cx + dx * TRIAD_LABEL));
      text.setAttribute('y', round(cy + dy * TRIAD_LABEL));
    }
  };

  return { group, update };
};

/**
 * **뷰포트 좌상단의 내비게이션 큐브.**
 *
 * 씬이 아니라 DOM/SVG 로 그린다 — 색이 테마를 따라야 하고, 렌더 게이트와 얽히지 않아야 하고,
 * 무엇보다 **[[측정]] 의 픽과 구조적으로 충돌해서는 안 되기** 때문이다. **클릭 대상 `path` 위의**
 * 클릭은 `scene.onPointerObservable` 에 아예 도달하지 않는다 — 상자 전체가 입력을 막는다는 뜻은
 * 아니다: 빈 공간과 클릭 대상이 아닌 모서리 12개는 **일부러** 캔버스로 내려간다(실측: 그려진
 * 비클릭 모서리 5곳의 `elementFromPoint` 는 전부 `#canvas`). ADR `260828-204140`.
 *
 * DOM 은 **한 번만** 만들고 이후에는 `d` 와 라벨 행렬만 갈아 끼운다. 매 프레임 노드를 만들고
 * 지우면 클릭 리스너를 다시 달아야 하고, 후면 제거로 사라진 영역 때문에 "클릭 가능한 영역이
 * 14개"라는 성질도 프레임마다 흔들린다.
 */
export function createNavCube(container: HTMLElement, host: NavCubeHost): NavCube {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${BOX_SIZE} ${BOX_SIZE}`);

  const faces = document.createElementNS(SVG_NS, 'g');
  const captions = document.createElementNS(SVG_NS, 'g');
  const paths = new Map<string, SVGPathElement>();
  const labels = new Map<NavCubeFaceLabel, SVGTextElement>();

  for (const region of NAV_CUBE_REGIONS) {
    const path = document.createElementNS(SVG_NS, 'path');
    const clickable = CLICKABLE_KINDS.includes(region.kind);
    path.setAttribute('class', clickable ? 'region clickable' : 'region');
    path.dataset.region = region.id;
    if (clickable) {
      // 법선을 그대로 넘긴다 — `poseForNormal` 이 정규화까지 맡으므로 꼭짓점도 손댈 필요가 없다.
      const normal = new Vector3(...region.normal);
      path.addEventListener('click', () => host.animateTo(poseForNormal(normal)));
    }
    // 면에는 단축키가 붙어 있다 — 마우스를 올리면 그 키를 알 수 있게 한다. 숫자를 여기
    // 적지 않고 표에서 가져오는 이유는 그것이 키 핸들러가 보는 값과 같아야 하기 때문이다.
    if (region.label) {
      const shortcut = shortcutForFace(region.label);
      if (shortcut) {
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `${shortcut.title} (${shortcut.key})`;
        path.append(title);
      }
    }
    paths.set(region.id, path);
    faces.append(path);

    if (region.label) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', 'label');
      text.dataset.face = region.label;
      text.textContent = region.label;
      labels.set(region.label, text);
      captions.append(text);
    }
  }

  // 라벨을 뒤에 붙여 면 위에 올린다. 볼록 다면체라 앞을 향한 면끼리는 서로를 가리지 않으므로
  // 면들 사이의 순서는 아무래도 좋다 (`navCubeGeometry.ts` 의 후면 제거 주석).
  //
  // 큐브 전체를 여백만큼 옮긴다 — `projectNavCube` 의 좌표계(`[0, CUBE_SIZE]`)와 라벨 배치
  // 행렬을 손대지 않고 화살표 자리를 만드는 유일한 방법이다.
  const cube = document.createElementNS(SVG_NS, 'g');
  cube.setAttribute('transform', `translate(${ARROW_MARGIN},${ARROW_MARGIN})`);
  cube.append(faces, captions);
  const triad = buildTriad();
  svg.append(buildArrows(host), buildHome(host), triad.group, cube);
  container.append(svg);

  const render = (): void => {
    // 자세는 한 번만 읽는다 — 게터가 호출마다 복사본을 만들고, 큐브와 삼각대가 **같은 자세**로
    // 그려져야 한다(새 배관을 만들지 않는다는 것이 삼각대의 요구다).
    const orientation = host.orientation();
    triad.update(orientation);
    for (const path of paths.values()) {
      // 후면 제거된 영역은 빈 `d` 로 남긴다 — 넓이가 0 이라 클릭도 받지 않는다.
      path.setAttribute('d', '');
    }
    for (const label of labels.values()) {
      label.setAttribute('display', 'none');
    }

    for (const { region, polygon, labelMatrix } of projectNavCube(orientation, CUBE_SIZE)) {
      paths.get(region.id)?.setAttribute('d', toPathData(polygon));
      const label = region.label ? labels.get(region.label) : undefined;
      if (label && labelMatrix) {
        label.removeAttribute('display');
        label.setAttribute('transform', `matrix(${labelMatrix.map(round).join(',')})`);
      }
    }
  };

  return { render };
}
