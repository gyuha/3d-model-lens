// engine.pure 가 아니라 engine.js 를 쓴다 — prefiltered 큐브 텍스처(.env) 로딩에 필요한
// engine.prefilteredCubeTexture 확장이 여기서 등록된다.
import '@babylonjs/core/Engines/engine.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { CubeTextureCreateFromPrefilteredData } from '@babylonjs/core/Materials/Textures/cubeTexture.pure.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { BackgroundMode } from '../background.js';
import type { SupportedExtension } from '../formats.js';
import { resolveUnit, type UnitSetting } from '../units.js';
import type { CameraState, Triple } from './cameraState.js';
import { createAnimationController, type AnimationController } from './animation.js';
import { Chrome, ensureMaterials } from './chrome.js';
import { CameraInput } from './cameraInput.js';
import { computeExtents, type Extents } from './geometry.js';
import { OrbitCamera } from './orbitCamera.js';
import { applyHandednessFix } from './handedness.js';
import { MeasurementTool } from './measurement.js';
import { RenderGate } from './renderGate.js';
import { registerModelLensLoaders } from './loaders.js';
import { setInspectorVisible } from './inspector.js';
import { enforceOfflineAssets } from './offline.js';

export interface ViewerConfig {
  modelUri: string;
  /** 확장의 media/ 디렉터리 URI — Babylon 의 에셋 요청을 여기로 돌린다 */
  assetBaseUri: string;
  environmentUri: string;
  fileName: string;
  pluginExtension: SupportedExtension;
  background: BackgroundMode;
  unitSetting: UnitSetting;
  decimals: number;
}

export interface Viewer {
  scene: Scene;
  chrome: Chrome;
  measure: MeasurementTool;
  animations: AnimationController;
  /**
   * 측정 모드를 바꾼다. 켜면 애니메이션을 멈춘다 — 메시가 움직이는 동안 찍은 두 점은
   * 서로 다른 시점의 위치라 길이가 의미를 잃는다. 끌 때 자동으로 재개하지는 않는다.
   */
  setMeasureMode: (active: boolean) => void;
  /** 렌더 가능한 메시 수 / 전체 — 빈 화면 회귀를 잡는 관측점. */
  readyMeshes: () => { ready: number; total: number };
  /** 무언가 바뀌었으니 다시 그려야 한다고 알린다. */
  markDirty: () => void;
  /** Inspector 처럼 연속 렌더링이 필요한 동안 켠다. */
  setContinuousRendering: (on: boolean) => void;
  /** 실제로 그린 프레임 수 — 유휴 렌더 중단을 검증하는 관측점. */
  renderCount: () => number;
  /** 유휴 상태인가 — 진단·검증용. */
  isIdle: () => boolean;
  /** 현재 카메라 상태 — 탭 전환 사이에 저장한다. */
  cameraState: () => CameraState;
  /** 시선·화면축. 회전이 어디로 갔는지 보는 관측점이며 회전을 유발하지 않는다. */
  cameraAxes: () => { forward: Triple; up: Triple; right: Triple };
  /** 내비게이션 큐브가 읽는 카메라 자세. 큐브는 이 값 하나로 전부 그려진다. */
  cameraOrientation: () => Quaternion;
  /**
   * 보간이 끝나면 도달할 자세 — 보간 중이 아니면 `cameraOrientation()` 과 같다.
   * 큐브의 **화살표**가 여기에 90° 를 더한다(목적지가 상대값이므로 보간 중인 자세를 읽으면
   * 남은 각도가 버려진다 — `OrbitCamera.destinationOrientationValue` 의 실측 주석).
   */
  cameraDestinationOrientation: () => Quaternion;
  /** 자세를 [[정규 자세]] 로 부드럽게 옮긴다 — 내비게이션 큐브의 면·꼭짓점 클릭이 쓴다. */
  animateCameraTo: (orientation: Quaternion) => void;
  extents: Extents;
  meshes: AbstractMesh[];
  resetView: () => void;
  /** 월드 좌표를 캔버스의 CSS 픽셀 좌표로 투영한다. */
  projectToScreen: (point: { x: number; y: number; z: number }) => {
    x: number;
    y: number;
    visible: boolean;
  };
  setInspector: (visible: boolean) => Promise<void>;
  dispose: () => void;
}

registerModelLensLoaders();

export async function createViewer(
  canvas: HTMLCanvasElement,
  labelHost: HTMLElement,
  config: ViewerConfig,
  /** 탭 전환에서 복원된 카메라. 있으면 자동 프레이밍을 건너뛴다 — 사용자가 맞춰 둔 각도를 덮어쓰면 안 된다. */
  restoredCamera: CameraState | null,
  onProgress: (ratio: number | undefined) => void,
): Promise<Viewer> {
  enforceOfflineAssets(config.assetBaseUri);

  // WebGL2 로 고정한다 — WebGPU 는 웹뷰에서 지원이 불안정하고 CSP/워커 요구가 더 크다.
  const engine = new Engine(canvas, true, { alpha: true, stencil: true }, true);
  if (engine.webGLVersion < 2) {
    console.warn('[3D Model Lens] WebGL2 is unavailable; falling back to WebGL1. Rendering may be limited.');
  }

  const scene = new Scene(engine);
  // 캔버스를 투명하게 두고 CSS 의 --ml-bg 가 비쳐 보이게 한다.
  // 이러면 테마 전환이 JS 없이 자동으로 따라온다.
  scene.clearColor = new Color4(0, 0, 0, 0);

  // IBL. glTF 의 PBR 은 환경 맵 없이는 금속 재질이 검게 뜬다.
  // Babylon 의 createDefaultEnvironment() 는 CDN 을 때리므로 쓸 수 없다 (ADR 260822-115455b).
  scene.environmentTexture = CubeTextureCreateFromPrefilteredData(config.environmentUri, scene);
  // IBL 만으로는 형태 인지가 약해서 보조 광원을 하나 둔다.
  const fill = new HemisphericLight('modelLens.fill', new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;

  const container = await LoadAssetContainerAsync(config.modelUri, scene, {
    // 웹뷰 URI 에는 쿼리스트링이 붙어 확장자 스니핑이 어긋날 수 있으므로 명시적으로 넘긴다.
    pluginExtension: config.pluginExtension,
    onProgress: (event) => onProgress(event.lengthComputable ? event.loaded / event.total : undefined),
  });
  container.addAllToScene();

  const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  if (meshes.length === 0) {
    throw new Error('The model has no renderable mesh.');
  }
  // 치수·프레이밍보다 **먼저** 부른다 — 둘 다 월드 좌표를 본다.
  applyHandednessFix(meshes, config.pluginExtension);
  ensureMaterials(scene, meshes);

  const extents = computeExtents(scene, meshes);
  const { orbit, input } = createCamera(scene, canvas, extents, restoredCamera);
  const chrome = new Chrome(scene, extents, meshes);
  const measure = new MeasurementTool(
    scene,
    canvas,
    labelHost,
    resolveUnit(config.pluginExtension, config.unitSetting),
    config.decimals,
  );

  const animations = createAnimationController(container.animationGroups);

  // 유휴 상태에서는 프레임을 그리지 않는다. 렌더 루프 자체는 멈추지 않는다 —
  // 그 이유는 renderGate.ts 주석 참조.
  const gate = new RenderGate();
  let renderCount = 0;
  scene.onAfterRenderObservable.add(() => {
    renderCount++;
  });

  // dirty 신호 (1) — 캔버스의 입력 이벤트.
  //
  // **이게 wake 소스여야 한다.** 카메라의 `onViewMatrixChangedObservable` 만으로는 교착에
  // 빠진다: ArcRotateCamera 는 `scene.render()` 안의 `_checkInputs()` 에서 입력을 처리하므로,
  // 그리지 않으면 입력을 읽지 않고 → 뷰 매트릭스가 안 바뀌고 → dirty 가 안 서고 → 영원히
  // 그리지 않는다. 실제로 e2e 가 이 교착을 잡아냈다.
  //
  // `pointermove` 는 버튼이 눌린 동안만 본다 — 단순 호버로 계속 그리면 유휴가 무의미해진다.
  let pointerDown = false;
  const wake = (): void => gate.markDirty();
  canvas.addEventListener('pointerdown', () => {
    pointerDown = true;
    wake();
  });
  canvas.addEventListener('pointerup', () => {
    pointerDown = false;
    wake();
  });
  canvas.addEventListener('pointercancel', () => {
    pointerDown = false;
    wake();
  });
  canvas.addEventListener('pointermove', () => {
    if (pointerDown) {
      wake();
    }
  });
  canvas.addEventListener('wheel', wake, { passive: true });
  canvas.addEventListener('keydown', wake);

  // dirty 신호 (2) — 렌더 도중에 카메라가 바뀌는 경우. 관성 감쇠가 여기로 이어진다.
  // 옵저버 안에서 getViewMatrix() 를 부르지 않는다 — Babylon 문서가 재진입 위험을 경고한다.
  orbit.camera.onViewMatrixChangedObservable.add(() => gate.markDirty());
  orbit.camera.onProjectionMatrixChangedObservable.add(() => gate.markDirty());

  // continuous 를 원하는 소스가 둘이다. 렌더 루프가 매 프레임 게이트를 갱신하므로
  // 여기서 OR 로 합치지 않으면 애니메이션이 Inspector 의 설정을 덮어쓴다.
  let inspectorContinuous = false;

  engine.runRenderLoop(() => {
    // `getWaitingItemsCount()` 로는 부족하다 — 그건 `_pendingData`(파일·텍스처 로딩)만 세고
    // **셰이더 컴파일은 세지 않는다**. 머티리얼이 준비되지 않은 메시는 `Mesh.render()` 가
    // 아무것도 그리지 않고 빠져나가므로, 그 상태로 유휴에 들어가면 빈 화면에서 얼어붙는다.
    // `scene.isReady()` 는 머티리얼·렌더타깃까지 확인하고, 준비되지 않은 머티리얼을 만나도
    // 멈추지 않고 전부 순회해 병렬 컴파일을 시작시킨다.
    gate.setSceneReady(scene.isReady());
    // 재생 중인 애니메이션은 `scene.render()` 안에서만 진행된다 — 그리지 않으면 얼어붙는다.
    gate.setContinuous(inspectorContinuous || animations.isPlaying);
    // 관성 꼬리와 눌려 있는 방향키를 한 프레임 진행한다. 둘 중 하나라도 움직이면 계속 그린다 —
    // 이게 없으면 손을 뗀 뒤의 감쇠와 키를 누르고 있는 동안의 회전이 첫 프레임에서 멈춘다.
    // (pan 속도를 radius 에 비례시키는 보정은 cameraInput.ts 가 매 이벤트마다 계산한다.)
    // **둘을 항상 다 부른다 — `||` 로 묶으면 단축 평가가 키 입력을 삼킨다.** 자세 보간이
    // 도는 동안 `orbit.tick()` 이 `true` 라서 `tickKeys()` 가 아예 호출되지 않았고, 그 300ms
    // 동안 Alt(줌)·Ctrl(팬) 방향키가 조용히 무시됐다(실측: 큐브 면 클릭 80ms 뒤 Alt+방향키를
    // 60ms 눌러도 거리 배율이 정확히 1.0000). 휠·우드래그는 이벤트에서 바로 적용되므로 같은
    // 구멍이 없다 — 키만 프레임 기반이라 이 자리를 지난다.
    const animating = orbit.tick();
    const keys = input.tickKeys();
    if (animating || keys) {
      gate.markDirty();
    }
    if (gate.shouldRender()) {
      scene.render();
    }
  });

  const onResize = (): void => {
    engine.resize();
    gate.markDirty();
  };
  window.addEventListener('resize', onResize);

  return {
    scene,
    chrome,
    measure,
    animations,
    setMeasureMode: (active) => {
      measure.setActive(active);
      if (active) {
        animations.pause();
      }
      gate.markDirty();
    },
    readyMeshes: () => ({
      ready: meshes.filter((mesh) => mesh.isReady(true)).length,
      total: meshes.length,
    }),
    extents,
    meshes,
    resetView: () => {
      orbit.frame(extents);
      gate.markDirty();
    },
    markDirty: () => gate.markDirty(),
    setContinuousRendering: (on) => {
      inspectorContinuous = on;
    },
    renderCount: () => renderCount,
    isIdle: () => gate.isIdle,
    cameraState: () => orbit.state(),
    cameraAxes: () => ({
      forward: [orbit.forward.x, orbit.forward.y, orbit.forward.z],
      up: [orbit.up.x, orbit.up.y, orbit.up.z],
      right: [orbit.right.x, orbit.right.y, orbit.right.z],
    }),
    cameraOrientation: () => orbit.orientationValue,
    cameraDestinationOrientation: () => orbit.destinationOrientationValue,
    // 보간을 진행시키는 것은 렌더 루프의 `orbit.tick()` 이고 그것이 프레임마다 dirty 를
    // 세운다 — 여기서 따로 markDirty 하지 않아도 유휴에서 깨어난다.
    animateCameraTo: (orientation) => orbit.animateTo(orientation),
    projectToScreen: (point) => projectToScreen(scene, canvas, point),
    setInspector: (visible) => setInspectorVisible(scene, visible),
    dispose: () => {
      input.dispose();
      window.removeEventListener('resize', onResize);
      scene.dispose();
      engine.dispose();
    },
  };
}

/**
 * 월드 좌표 → 캔버스 CSS 픽셀. 뷰포트를 CSS 픽셀로 잡는 이유는 measurement.ts 와 같다
 * (devicePixelRatio 가 적용된 버퍼 크기를 쓰면 고해상도 화면에서 어긋난다).
 */
function projectToScreen(
  scene: Scene,
  canvas: HTMLCanvasElement,
  point: { x: number; y: number; z: number },
): { x: number; y: number; visible: boolean } {
  const rect = canvas.getBoundingClientRect();
  const projected = Vector3.Project(
    new Vector3(point.x, point.y, point.z),
    Matrix.Identity(),
    scene.getTransformMatrix(),
    new Viewport(0, 0, rect.width, rect.height),
  );
  return {
    x: projected.x,
    y: projected.y,
    visible: projected.z >= 0 && projected.z <= 1,
  };
}

function createCamera(
  scene: Scene,
  canvas: HTMLCanvasElement,
  extents: Extents,
  restored: CameraState | null,
): { orbit: OrbitCamera; input: CameraInput } {
  const orbit = new OrbitCamera(scene);
  orbit.applyLimits(extents);
  if (restored) {
    orbit.restore(restored);
  } else {
    orbit.frame(extents);
  }
  scene.activeCamera = orbit.camera;
  // 포인터·키보드를 직접 짠다 — `ArcRotateCamera*Input` 은 alpha/beta 누산기에 값을 넣으므로
  // 쿼터니언 자세에 쓸 수 없다. 자세한 근거는 ADR 260826-232902.
  const input = new CameraInput(orbit, canvas);
  return { orbit, input };
}
