import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { backgroundColorFor, isBackgroundMode, type BackgroundMode } from '../background.js';
import type { HostToWebview } from '../messages.js';
import { formatLength, isUnitSetting, resolveUnit, type UnitSetting } from '../units.js';
import type { Chrome } from './chrome.js';
import { extentSizes } from './geometry.js';
import type { MeasurementTool } from './measurement.js';
import {
  shortcutForKey,
  shortcutForTarget,
  type CameraShortcut,
} from './cameraShortcuts.js';
import { createNavCube } from './navCube.js';
import { poseForNormal } from './navCubePose.js';
import { createViewer, type Viewer } from './viewer.js';
import { readBootConfig } from '../bootConfig.js';
import { initializeHostBridge, post } from '../host.js';

const root = requireElement<HTMLDivElement>('root');
const canvas = requireElement<HTMLCanvasElement>('canvas');
const panel = requireElement<HTMLDivElement>('panel');
const loading = requireElement<HTMLDivElement>('loading');
const errorBox = requireElement<HTMLDivElement>('error');
const labelHost = requireElement<HTMLDivElement>('labels');
const navCubeBox = requireElement<HTMLDivElement>('nav-cube');

/*
 * 부트 설정은 뷰어를 만들기 전에 필요하므로 여기서 읽는다 — `boot()` 의 try 바깥이다.
 * 그래서 실패를 **여기서** 화면에 내보내야 한다. 던지기만 하면 모듈 평가가 중단되면서
 * 로딩 오버레이가 그대로 남아 "영원히 로딩 중"으로 보인다 (실제로 그렇게 만들었다가 고쳤다).
 *
 * 모델 없이 열린 창은 지금은 이 에러 화면을 본다. **빈 창 UI 는 2of3 의 몫**이고,
 * 그때 이 자리를 `Drop a .gltf / .glb / .stl` 안내가 대신한다.
 */
let config: ReturnType<typeof readBootConfig>;
try {
  config = readBootConfig();
} catch (error) {
  showBootFailure(error);
  throw error;
}

// 파일명은 HTML 에 정적으로 박을 수 없다 — 창마다 다르다.
document.title = `${config.fileName} — 3D Model Lens`;
requireElement<HTMLDivElement>('loading').querySelectorAll('.overlay-detail')[0]
  ?.replaceChildren(config.fileName);
setChecked('toggle-grid', config.grid);

applyBackground(config.background);

/**
 * 배경 모드를 실제 색으로 적용한다.
 *
 * `theme` 이면 선언을 **지운다** — CSS 의 `--ml-bg` 폴백이 다시 드러나야
 * 하기 때문이다. 그냥 두면 이전 모드의 색이 남아 테마 따르기가 깨진다(빈 문자열을 넘기면
 * CSSOM 이 선언을 제거한다).
 *
 * **색을 커스텀 속성 하나에 담는 이유**: 바탕색을 쓰는 곳이 `body` 배경 하나가 아니다 — 축
 * 삼각대의 X/Y/Z 문자가 **그 색으로 헤일로**를 깔아 축 선이 글리프를 가로지르지 못하게 한다
 * (`style.css` 의 `.triad-label`). `--ml-bg` 를 직접 쓰면 배경을
 * `light`/`dark` 로 고정한 사용자에게 헤일로만 테마 색으로 남아 얼룩이 된다.
 */
function applyBackground(mode: BackgroundMode): void {
  const color = backgroundColorFor(mode);
  document.body.style.setProperty('--model-lens-backdrop', color ?? '');
  root.dataset.background = mode;
}

// 뷰어를 먼저 띄우고, 셸과의 채널은 **따로** 연다.
//
// 한때 `initializeHostBridge().then(boot)` 였다. IPC 가 응답하지 않으면 그 Promise 는
// reject 되지 않고 영원히 pending 이라 catch 도 걸리지 않고 boot 도 시작되지 않는다 —
// 로딩 화면에 영구히 멈춘다. 브라우저 e2e 는 `isTauri()` 가 false 라 이 경로를 밟지
// 않으므로 구조적으로 잡을 수 없었다.
void boot();
void initializeHostBridge();

async function boot(): Promise<void> {
  try {
    // 제목과 파일명은 HTML 에 이미 있다 — 여기서는 진행률 줄만 채운다. `loading` 자체의
    // textContent 를 쓰면 M 스트라이프와 제목까지 지워진다.
    const loadingProgress = requireElement<HTMLDivElement>('loading-progress');
    const viewer = await createViewer(canvas, labelHost, config, null, (ratio) => {
      loadingProgress.textContent = ratio === undefined ? '' : `${Math.round(ratio * 100)}%`;
    });

    loading.hidden = true;
    applyPanelVisible(true);
    wireSections();
    wirePanel(viewer.chrome, viewer);
    wireNavCube(viewer);
    wireCameraShortcuts(viewer);

    // 뷰어 상태를 DOM 에 노출한다 — 자동 검증(헤드리스 렌더 테스트)이 붙을 지점이고,
    // 파트 3/4 의 치수·측정 단정도 여기를 읽는다.
    const sizes = extentSizes(viewer.extents);
    const rerenderUnits = wireUnits(sizes, viewer.measure);
    wireDisplaySettings(rerenderUnits);
    wireMeasurePanel(viewer.measure, viewer);
    wireAnimationPanel(viewer);
    wireBackgroundPanel();

    root.dataset.state = 'ready';
    root.dataset.meshCount = String(viewer.meshes.length);
    root.dataset.extents = JSON.stringify(sizes);
    root.dataset.inspector = 'off';

    wireHostMessages(viewer, rerenderUnits);

    if (config.inspectorOnStart) {
      applyInspector(viewer, true);
    }
    exposeTestSeam(viewer);
    post({ type: 'ready' });
    window.addEventListener('unload', () => viewer.dispose(), { once: true });
  } catch (error) {
    showError(error);
  }
}

/**
 * 접었다 펼 수 있는 패널 섹션의 이름. 치수와 모델 단위는 늘 열려 있는 머리이므로 섹션이 아니다.
 *
 * `animation` 이 목록에 없는 이유: 그 섹션은 그룹이 있는 파일에서만 존재하고, 있으면 늘 펼쳐진
 * 채 시작한다 — 접힘 상태를 저장할 것이 없다.
 */
const PANEL_SECTIONS = ['measure', 'display', 'debug'] as const;
export type PanelSectionName = (typeof PANEL_SECTIONS)[number];

/**
 * 패널 섹션을 펼치거나 접는다.
 *
 * 접힘은 `hidden` 속성으로 표현한다 — CSS 클래스가 아니라 속성이어야 자동 검증(Playwright)의
 * 가시성 판정과 접근성 트리가 함께 따라온다. `aria-expanded` 는 헤더 버튼이 들고 있다.
 */
function setSectionExpanded(name: PanelSectionName, expanded: boolean): void {
  const header = requireElement<HTMLButtonElement>(`${name}-header`);
  const body = requireElement<HTMLDivElement>(`${name}-body`);
  header.setAttribute('aria-expanded', String(expanded));
  body.hidden = !expanded;
  const chevron = header.querySelector<HTMLSpanElement>('.chevron');
  if (chevron) {
    chevron.textContent = expanded ? '▾' : '▸';
  }
}

function isSectionExpanded(name: PanelSectionName): boolean {
  return requireElement<HTMLButtonElement>(`${name}-header`).getAttribute('aria-expanded') === 'true';
}

/** 섹션 헤더를 클릭·키보드로 조작할 수 있게 한다. `<button>` 이므로 Enter/Space 는 공짜다. */
function wireSections(): void {
  for (const name of PANEL_SECTIONS) {
    setSectionExpanded(name, false);
    requireElement<HTMLButtonElement>(`${name}-header`).addEventListener('click', () => {
      setSectionExpanded(name, !isSectionExpanded(name));
    });
  }
}

function wirePanel(chrome: Chrome, viewer: Viewer): void {
  // 표시가 바뀌면 다시 그려야 한다 — 유휴 상태였다면 화면이 갱신되지 않는다.
  bindCheckbox('toggle-grid', (on) => {
    chrome.setGridVisible(on);
    viewer.markDirty();
  });
  // 호스트 통보는 `bindCheckbox` 의 초기 apply 에 섞지 않는다 — 그러면 뷰어를 열 때마다
  // `gridChanged` 가 나가 전역 설정을 다시 쓴다. 사용자의 조작(`change`)에만 반응해야 한다.
  requireElement<HTMLInputElement>('toggle-grid').addEventListener('change', (event) => {
    post({ type: 'gridChanged', grid: (event.target as HTMLInputElement).checked });
  });

  // 측정 모드도 같은 이유로 맨 `change` 리스너다 — `bindCheckbox` 의 초기 apply 에 태우면
  // 뷰어를 열 때마다 `measureModeState` 가 나간다.
  requireElement<HTMLInputElement>('toggle-measure').addEventListener('change', (event) => {
    applyMeasureMode(viewer, (event.target as HTMLInputElement).checked);
  });

  // Inspector 는 꺼진 채로 시작하므로 `bindCheckbox` 의 초기 apply 를 쓰지 않는다.
  requireElement<HTMLInputElement>('toggle-inspector').addEventListener('change', (event) => {
    applyInspector(viewer, (event.target as HTMLInputElement).checked);
  });
}

/**
 * 내비게이션 큐브를 붙인다.
 *
 * 다시 그리는 시점을 `onAfterRenderObservable` 에 얹는다 — 카메라가 바뀌면 렌더 게이트가 이미
 * 프레임을 그리고 있고 유휴에서는 그리지 않으므로, **큐브의 갱신 주기가 씬과 정확히 같아진다.**
 * 큐브 전용 타이머도, 자세 변화를 따로 감시하는 배관도 필요 없다.
 */
/**
 * 숫자키로 [[정규 자세]] 와 기본 위치로 옮긴다.
 *
 * **`document` 에서 듣는다.** 방향키를 캔버스에서 듣는 `cameraInput` 과 다른 선택인데, 이유가
 * 있다 — 방향키는 "지금 보고 있는 것을 미세 조정"이라 캔버스에 포커스가 있는 것이 자연스럽지만,
 * 숫자키는 "어디에 있든 그 면으로 간다"는 성격이다. 패널을 한 번 클릭했다고 죽으면 쓸모의
 * 절반이 사라진다.
 *
 * 대신 두 가지를 막는다.
 *   - **입력 요소에 포커스가 있으면 흘려보낸다.** `Decimals` 칸에 `3` 을 치면 값이 들어가야지
 *     카메라가 움직이면 안 된다. 이것이 네이티브 메뉴에 accelerator 를 달지 않은 이유이기도
 *     하다 — 메뉴 단축키는 웹뷰보다 먼저 키를 가로채므로 이 예외를 만들 수 없다.
 *   - **수정키 조합은 무시한다.** `⌘1` 같은 OS/브라우저 단축키를 빼앗지 않는다.
 *
 * 이동 후 `canvas.focus()` 를 부르는 것은 큐브 클릭과 같은 이유다 — 방향키를 캔버스에서 듣기
 * 때문에, 포커스를 돌려놓지 않으면 "숫자키로 면을 보고 방향키로 미세 조정"이 끊긴다
 * (`wireNavCube` 의 실측 주석 참조).
 */
function wireCameraShortcuts(viewer: Viewer): void {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (isTextEntry(event.target)) {
      return;
    }
    const shortcut = shortcutForKey(event.key);
    if (!shortcut) {
      return;
    }
    event.preventDefault();
    moveCameraTo(viewer, shortcut);
  });
}

/**
 * 단축키 한 항목이 뜻하는 이동을 실제로 수행한다. **키와 메뉴가 이 함수를 공유한다** —
 * 두 진입점이 각자 이동을 구현하면 언젠가 다른 자세로 간다.
 *
 * `canvas.focus()` 는 큐브 클릭과 같은 이유다 — 방향키를 캔버스에서 듣기 때문에, 포커스를
 * 돌려놓지 않으면 "면을 본 뒤 방향키로 미세 조정"이 끊긴다(`wireNavCube` 의 실측 주석).
 */
function moveCameraTo(viewer: Viewer, shortcut: CameraShortcut): void {
  canvas.focus();
  if (shortcut.normal === null) {
    // 홈 버튼과 완전히 같은 경로 — 자세·거리·타깃을 보간 없이 되돌린다.
    viewer.resetView();
    return;
  }
  const [x, y, z] = shortcut.normal;
  viewer.animateCameraTo(poseForNormal(new Vector3(x, y, z)));
}

/** 글자를 받는 요소인가 — 그렇다면 숫자키는 그쪽 것이다. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

function wireNavCube(viewer: Viewer): void {
  const cube = createNavCube(navCubeBox, {
    orientation: () => viewer.cameraOrientation(),
    // 화살표 전용 — 보간 중이면 **가려던 자세**를 준다. 그리는 것은 위 `orientation()` 이다.
    destinationOrientation: () => viewer.cameraDestinationOrientation(),
    animateTo: (orientation) => {
      // **포커스를 캔버스로 되돌린다.** SVG `path` 는 focusable 이 아니므로 큐브 클릭이
      // `#canvas`(tabindex=0)의 포커스를 `<body>` 로 흘려보내고, 방향키를 **캔버스에서** 듣는
      // `cameraInput` 이 더는 이벤트를 받지 못한다. 실측: 큐브 `+Y` 클릭 후 ArrowRight 200ms 의
      // 시선 변화량이 0.0000 이었고, 캔버스를 다시 클릭하면 1.83 로 회복했다. 큐브는 설정
      // 표면이 아니라 **카메라 조작기**라 "큐브로 면을 보고 방향키로 미세 조정"이 기본 흐름이다.
      //
      // 큐브가 아니라 여기서 하는 이유: 큐브는 캔버스를 모르는 채로 둔다(ADR `260828-204140` —
      // 오버레이는 씬도 캔버스도 건드리지 않는다). 이 콜백이 둘이 만나는 유일한 자리다.
      canvas.focus();
      viewer.animateCameraTo(orientation);
    },
    // 홈 버튼 — 회전·줌·팬을 한 번에 첫 상태로 되돌린다. `resetView()` 가 `orbit.frame(extents)`
    // 하나이고 그것이 **첫 로드와 같은 코드 경로**이므로(`createCamera`) 되돌린 값이 첫 값과
    // 정확히 같다. 포커스를 되돌리는 것은 위와 같은 이유다 — 이 콜백도 SVG `path` 의 클릭에서
    // 오므로 그냥 두면 방향키가 죽는다.
    resetView: () => {
      canvas.focus();
      viewer.resetView();
    },
  });
  viewer.scene.onAfterRenderObservable.add(() => cube.render());
  // 첫 그림. 로드 직후의 자세는 이미 정해져 있으므로 첫 프레임을 기다리지 않는다.
  cube.render();
}

/**
 * 치수 표시와 단위 드롭다운.
 *
 * 축은 `X / Y / Z` 로만 표기한다 — glTF 로더의 좌표계 변환과 STL 의 Z-up 관행 때문에
 * "가로/높이/깊이"로 부르면 절반은 틀린다 (ADR 260822-115455c).
 */
function wireUnits(
  sizes: readonly [number, number, number],
  measure: MeasurementTool,
): () => void {
  const select = requireElement<HTMLSelectElement>('unit');
  const cells = (['x', 'y', 'z'] as const).map((axis) =>
    requireElement<HTMLSpanElement>(`dim-${axis}`),
  );

  const render = (setting: UnitSetting): void => {
    const unit = resolveUnit(config.pluginExtension, setting);
    cells.forEach((cell, axis) => {
      cell.textContent = formatLength(sizes[axis], unit, config.decimals);
    });
    // 이미 만든 측정의 라벨도 함께 갱신한다.
    measure.setUnit(unit, config.decimals);
    root.dataset.unit = unit;
  };

  select.value = config.unitSetting;
  render(config.unitSetting);

  select.addEventListener('change', () => {
    if (!isUnitSetting(select.value)) {
      return;
    }
    render(select.value);
    // 호스트가 파일별로 기억한다.
    post({ type: 'unitChanged', unit: select.value });
  });

  // 자릿수가 바뀌었을 때 현재 단위 그대로 다시 그리기 위한 손잡이.
  return () => {
    if (isUnitSetting(select.value)) {
      render(select.value);
    }
  };
}

/**
 * 표시 설정 — 소수 자릿수와 "시작 시 Inspector".
 *
 * 원본 확장에서 이 둘은 VS Code 설정 화면에만 있었고 뷰어 패널에는 없었다. 데스크톱 앱에는
 * 그 설정 화면이 없으므로 [[뷰어 패널]] 이 그 자리를 겸한다 — 패널은 이미 배경·그리드 같은
 * 전역 설정을 담고 있어 새로 생기는 개념이 아니다.
 */
function wireDisplaySettings(rerender: () => void): void {
  const decimals = requireElement<HTMLInputElement>('decimals');
  decimals.value = String(config.decimals);
  decimals.addEventListener('change', () => {
    const value = Math.min(10, Math.max(0, Math.trunc(Number(decimals.value))));
    if (!Number.isFinite(value)) {
      decimals.value = String(config.decimals);
      return;
    }
    decimals.value = String(value);
    config.decimals = value;
    rerender();
    post({ type: 'decimalsChanged', decimals: value });
  });

  const onStart = requireElement<HTMLInputElement>('toggle-inspector-start');
  onStart.checked = config.inspectorOnStart;
  onStart.addEventListener('change', () => {
    post({ type: 'inspectorOnStartChanged', value: onStart.checked });
  });
}

function setChecked(id: string, checked: boolean): void {
  requireElement<HTMLInputElement>(id).checked = checked;
}

/**
 * 브라우저에서의 자동 검증이 붙는 **좁은 이음매**.
 *
 * 노출하는 것은 좌표 변환 하나뿐이다 — 테스트가 "이 정점이 화면 어디에 있나"를 알아야
 * **실제 포인터 이벤트**로 클릭할 수 있기 때문이다. 측정 자체를 호출하는 API 는 노출하지
 * 않는다. 그러면 상호작용을 우회해 버려서 검증의 의미가 없어진다.
 *
 * `npm run uat` 의 수동 확인과 후속 작업(playwright-webview-render-tests)이 이걸 쓴다.
 */
function exposeTestSeam(viewer: Viewer): void {
  (window as unknown as Record<string, unknown>).__modelLens = {
    projectToScreen: viewer.projectToScreen,
    extents: extentSizes(viewer.extents),
    // 읽기 전용 질의 — 측정을 만들지 않는다. measurement.ts 의 probeAt 주석 참조.
    probeAt: (x: number, y: number) => viewer.measure.probeAt(x, y),
    // 유휴 렌더 중단을 검증하는 관측점. 렌더를 유발하는 API 는 노출하지 않는다.
    renderCount: () => viewer.renderCount(),
    isIdle: () => viewer.isIdle(),
    // 빈 화면 회귀의 관측점 — 유휴인데 렌더되지 않는 메시가 남아 있으면 화면이 비어 있다.
    readyMeshes: () => viewer.readyMeshes(),
    // 궤도 회전의 관측점. 각도를 **읽기만** 한다 — 회전을 유발하는 API 는 노출하지 않는다.
    // 저장 상태(sessionStorage)를 대신 읽으면 디바운스된 저장 경로가 끼어들어, 실패했을 때
    // "회전이 안 됐다"와 "저장이 안 됐다"를 구별할 수 없다.
    camera: () => viewer.cameraState(),
    // 회전 관측점 — 시선·화면축. 읽기만 하며 회전을 유발하지 않는다.
    cameraAxes: () => viewer.cameraAxes(),
  };
}

/** 측정 목록 · 정점 스냅 토글 · 전체 삭제. */
function wireMeasurePanel(measure: MeasurementTool, viewer: Viewer): void {
  const list = requireElement<HTMLDivElement>('measure-list');
  const state = requireElement<HTMLSpanElement>('measure-state');
  const clear = requireElement<HTMLButtonElement>('measure-clear');

  bindCheckbox('toggle-snap', (on) => measure.setSnap(on));
  clear.addEventListener('click', () => measure.clear());

  measure.onChange = (): void => {
    // 측정이 추가·삭제·선택되면 선·마커가 바뀌므로 다시 그린다.
    viewer.markDirty();
    // 켜짐 여부는 체크박스가 말하므로 여기는 힌트만 남긴다 — 꺼져 있을 때는 할 말이 없다.
    state.textContent = measure.isActive ? 'pick two points' : '';
    root.dataset.measure = measure.isActive ? 'on' : 'off';
    root.dataset.measureCount = String(measure.list.length);

    list.replaceChildren(
      ...measure.list.map((measurement) => {
        const row = document.createElement('div');
        row.className = measurement.id === measure.selected ? 'row selected' : 'row';

        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'pick';
        pick.textContent = measure.labelFor(measurement);
        pick.title = 'Select';
        pick.addEventListener('click', () =>
          measure.select(measurement.id === measure.selected ? undefined : measurement.id),
        );

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '✕';
        remove.title = 'Remove';
        remove.addEventListener('click', () => measure.remove(measurement.id));

        row.append(pick, remove);
        return row;
      }),
    );
  };
  measure.onChange();
}

/**
 * 배경 드롭다운.
 *
 * 선택을 호스트에 알리면 호스트가 **전역 설정**에 저장하고, 그 설정 변경이 열려 있는 모든
 * 뷰어로 되돌아온다(`setBackground`). 즉 이 웹뷰도 자기 선택을 호스트를 거쳐 다시 받는데,
 * `applyBackground` 는 멱등이고 프로그래매틱한 `value` 대입은 `change` 를 다시 쏘지 않으므로
 * 루프가 생기지 않는다.
 */
function wireBackgroundPanel(): void {
  const select = requireElement<HTMLSelectElement>('background-select');
  // 원본 확장에서는 호스트가 HTML 을 조립하며 `selected` 를 박았다. HTML 이 정적이 된 지금은
  // 여기가 그 자리다 — 빠뜨리면 드롭다운이 늘 'Theme' 로 보이면서 실제 배경은 다른 상태가 된다.
  select.value = config.background;
  select.addEventListener('change', () => {
    if (!isBackgroundMode(select.value)) {
      return;
    }
    applyBackground(select.value);
    post({ type: 'backgroundChanged', background: select.value });
  });
}

/**
 * 애니메이션 재생 컨트롤.
 *
 * 그룹 이름은 파일에서 오므로 항목을 런타임에 채운다. 그룹이 없는 파일(STL, 정적 glTF)에서는
 * 섹션 자체를 숨긴 채로 둔다.
 */
function wireAnimationPanel(viewer: Viewer): void {
  const section = requireElement<HTMLElement>('animation-section');
  const toggle = requireElement<HTMLButtonElement>('animation-toggle');
  const select = requireElement<HTMLSelectElement>('animation-select');
  const { animations } = viewer;

  if (!animations.available) {
    root.dataset.animation = 'none';
    return;
  }

  select.replaceChildren(
    ...['All', ...animations.names].map((label, index) => {
      const option = document.createElement('option');
      // 첫 항목이 'All' 이므로 그룹 인덱스는 하나씩 밀린다.
      option.value = index === 0 ? 'all' : String(index - 1);
      option.textContent = label;
      return option;
    }),
  );

  toggle.addEventListener('click', () =>
    animations.isPlaying ? animations.pause() : animations.play(),
  );
  select.addEventListener('change', () =>
    animations.select(select.value === 'all' ? 'all' : Number(select.value)),
  );

  animations.onChange = (): void => {
    toggle.textContent = animations.isPlaying ? 'Pause' : 'Play';
    select.value = animations.selection === 'all' ? 'all' : String(animations.selection);
    root.dataset.animation = animations.isPlaying ? 'playing' : 'paused';
    // 일시정지 직후의 정리 렌더. 재생 중에는 렌더 루프가 알아서 계속 그린다.
    viewer.markDirty();
  };
  animations.onChange();

  // 그룹이 있는 파일에서만 섹션이 존재하고, 있으면 펼쳐진 채로 시작한다 —
  // 재생/일시정지는 자주 누르는 버튼이라 한 단계 뒤에 두지 않는다.
  section.hidden = false;
}

/** 확장 호스트의 명령(제목 표시줄 아이콘 · 명령 팔레트)을 받는다. */
function wireHostMessages(viewer: Viewer, rerenderUnits: () => void): void {
  window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
    const message = event.data;
    if (message?.type === 'setCameraPose') {
      const shortcut = shortcutForTarget(message.target);
      if (shortcut) {
        moveCameraTo(viewer, shortcut);
      }
      return;
    }
    if (message?.type === 'setDecimals') {
      config.decimals = message.decimals;
      requireElement<HTMLInputElement>('decimals').value = String(message.decimals);
      rerenderUnits();
      viewer.markDirty();
      return;
    }
    if (message?.type === 'setGrid') {
      // 그리드는 배경(CSS)과 달리 **씬**을 바꾼다 — 유휴였다면 아무도 다시 그리지 않으므로
      // markDirty 가 없으면 나란히 열린 다른 탭의 화면이 얼어붙은 채 남는다.
      viewer.chrome.setGridVisible(message.grid);
      setChecked('toggle-grid', message.grid);
      viewer.markDirty();
      return;
    }
    if (message?.type === 'setBackground') {
      applyBackground(message.background);
      requireElement<HTMLSelectElement>('background-select').value = message.background;
      return;
    }
    if (message?.type === 'setMeasureMode') {
      applyMeasureMode(viewer, message.active);
      return;
    }
    if (message?.type === 'setPanelVisible') {
      applyPanelVisible(message.visible);
      return;
    }
    if (message?.type !== 'setInspector') {
      return;
    }
    applyInspector(viewer, message.visible);
  });
}

/**
 * 측정 모드를 켜고 끈다 — 제목 표시줄 아이콘 · 패널 체크박스 · 탭 복원의 **공통 경로**.
 *
 * `applyInspector` 와 같은 이유로 하나로 모은다. 호스트는 `measureModeState` 로만 현재 상태를
 * 아는데, 그게 어긋나면 다음 아이콘 클릭의 토글 방향이 뒤집힌다. **특히 복원 경로가 알리지
 * 않으면** 세션은 `measureActive: false` 로 시작하므로, 측정 모드를 켠 채 탭을 떠났다 돌아오면
 * 아이콘이 한 번 먹히지 않는다.
 *
 * 새 메시지 타입을 만들지 않는 이유: 호스트가 하는 일이 `session.measureActive` 갱신 하나로
 * 동일하다. `gridChanged` 계열이 별도 타입인 것은 호스트가 `config.update` 라는 다른 일을
 * 하기 때문이다.
 */
function applyMeasureMode(viewer: Viewer, active: boolean): void {
  setChecked('toggle-measure', active);
  // 켤 때는 MEASURE 섹션을 펼친다 — 제목 표시줄 아이콘으로 켠 경우 섹션이 접혀 있으면 찍은
  // 측정 목록이 보이지 않는다. 끌 때는 접지 않는다: 사용자가 펼쳐둔 것을 빼앗지 않는다.
  if (active) {
    setSectionExpanded('measure', true);
  }
  // 켤 때의 애니메이션 정지와 재렌더는 `viewer.setMeasureMode` 안에서 일어난다.
  viewer.setMeasureMode(active);
  post({ type: 'measureModeState', active });
}

/**
 * 뷰어 패널을 통째로 보이거나 숨긴다 — 제목 표시줄 아이콘과 탭 복원의 **공통 경로**.
 *
 * 되살리는 경로를 웹뷰 **밖**(제목 표시줄)에 둔 이유: 웹뷰 안에 되살릴 버튼을 남기면 뷰포트를
 * 완전히 비울 수 없다. 그래서 숨김 상태에는 화면에 아무것도 남지 않는다.
 *
 * **내비게이션 큐브도 함께 숨는다** — 그 성질("화면에 아무것도 남지 않는다")은 조작기 하나가
 * 남아도 깨진다. 새 지속 상태는 만들지 않고 이미 저장되는 `panelHidden` 을 그대로 쓴다.
 *
 * `applyInspector`·`applyMeasureMode` 와 같은 이유로 호스트에 현재 상태를 알린다 — 호스트가
 * `session.panelVisible` 로만 상태를 알고, 어긋나면 다음 아이콘 클릭의 토글 방향이 뒤집힌다.
 */
function applyPanelVisible(visible: boolean): void {
  panel.hidden = !visible;
  navCubeBox.hidden = !visible;
  root.dataset.panel = visible ? 'visible' : 'hidden';
  post({ type: 'panelState', visible });
}

/**
 * Inspector 를 켜고 끈다 — 제목 표시줄 아이콘과 패널 체크박스의 **공통 경로**.
 *
 * 둘로 나뉘면 한쪽으로 켠 상태를 다른 쪽이 모른다. 특히 호스트는 `inspectorState` 로만
 * 현재 상태를 아는데, 그게 어긋나면 다음 아이콘 클릭의 토글 방향이 뒤집힌다.
 */
function applyInspector(viewer: Viewer, visible: boolean): void {
  const checkbox = requireElement<HTMLInputElement>('toggle-inspector');
  checkbox.checked = visible;
  // chunk 가 수 MB 라 켜는 데 시간이 걸린다. 그동안 중복 클릭을 막는다.
  checkbox.disabled = true;

  // Inspector 는 fps 카운터와 기즈모가 렌더 루프에 의존하므로, 켜진 동안은
  // 유휴 판정을 끄고 연속으로 그린다. 켜지 않으면 0 fps 로 보여 고장난 것처럼 된다.
  viewer.setContinuousRendering(visible);
  void viewer
    .setInspector(visible)
    .then(() => {
      root.dataset.inspector = visible ? 'on' : 'off';
      post({ type: 'inspectorState', visible });
    })
    .catch((error: unknown) => {
      root.dataset.inspector = 'off';
      checkbox.checked = false;
      viewer.setContinuousRendering(false);
      post({ type: 'inspectorFailed', message: describeError(error) });
      console.error('[3D Model Lens] Inspector failed', error);
    })
    .finally(() => {
      checkbox.disabled = false;
    });
}

function bindCheckbox(id: string, apply: (on: boolean) => void): void {
  const input = requireElement<HTMLInputElement>(id);
  apply(input.checked);
  input.addEventListener('change', () => apply(input.checked));
}

/**
 * 로드 실패를 빈 검은 화면으로 남기지 않는다 — 파일명과 원인을 표시한다.
 * 참고 레포의 "빈 화면" FAQ 가 정확히 이걸 안 해서 생긴 문제다.
 */
/** 부트 설정조차 읽지 못했을 때. `showError` 와 달리 `config` 를 건드리지 않는다. */
function showBootFailure(error: unknown): void {
  root.dataset.state = 'error';
  loading.hidden = true;
  panel.hidden = true;
  errorBox.hidden = false;
  const name = errorBox.querySelector<HTMLDivElement>('.name');
  const message = errorBox.querySelector<HTMLDivElement>('.message');
  if (name) {
    name.textContent = 'No model to show';
  }
  if (message) {
    message.textContent = describeError(error);
  }
}

function showError(error: unknown): void {
  root.dataset.state = 'error';
  loading.hidden = true;
  panel.hidden = true;
  errorBox.hidden = false;
  const name = errorBox.querySelector<HTMLDivElement>('.name');
  const message = errorBox.querySelector<HTMLDivElement>('.message');
  if (name) {
    name.textContent = `Cannot open ${config.fileName}`;
  }
  if (message) {
    message.textContent = describeError(error);
  }
  console.error('[3D Model Lens] Failed to load model', error);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element not found: #${id}`);
  }
  return element as T;
}
