// 픽 레이의 side-effect import. **이게 없으면 `scene.pick()` 은 빈 PickingInfo 를 돌려주는
// 스텁이다** — 예외도 던지지 않고 그냥 "아무것도 안 맞았다"고 답한다 (scene.pure.js 의
// `pick()` 은 `_WarnImport("Ray")` 경고만 찍는다). Babylon 9 의 pure/side-effect 분리에서
// 반복되는 함정이고, 이 프로젝트에서만 세 번째다(engine.prefilteredCubeTexture · debugLayer · ray).
import '@babylonjs/core/Culling/ray.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import type { Camera } from '@babylonjs/core/Cameras/camera.js';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.js';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { distance, midpoint, snapToNearestVertex, type Point3, type Triangle } from '../measure.js';
import { formatLength, type ResolvedUnit } from '../units.js';

/** 이 픽셀 수 이상 움직였으면 탭이 아니라 궤도 회전으로 본다. 손떨림·트랙패드를 감안한 값. */
const TAP_THRESHOLD_PX = 6;

export interface Measurement {
  id: number;
  a: Point3;
  b: Point3;
  length: number;
}

/**
 * 측정 도구 — 표면의 두 점을 찍어 거리를 만든다.
 *
 * 설계상 못 박은 것들:
 * - **`POINTERDOWN`/`POINTERUP` + 자체 이동 임계값으로 탭을 판정한다.** 원래 계획은 Babylon 의
 *   `POINTERTAP` 에 맡기려 했지만 측정 도구에서는 쓸 수 없다. 이유 둘 다 실측으로 확인했다.
 *   (1) 카메라 입력(`ArcRotateCameraPointersInput`)이 `POINTERDOUBLETAP` 을 포함한 마스크로
 *       등록돼 있어서, Babylon 이 더블클릭 여부를 기다리며 TAP 을 `Scene.DoubleClickDelay`
 *       (기본 300ms) 만큼 **지연**시킨다. 우리 옵저버 마스크만 좁혀도 없앨 수 없다.
 *   (2) 더 나쁜 것: **인접한 두 코너를 빠르게 찍으면 더블클릭으로 흡수되어 측정이 아예 생기지
 *       않는다.** 그런데 그게 측정의 가장 흔한 동작이다.
 *   임계값 방식은 즉시 반응하고 더블클릭 흡수도 없다. 궤도 회전은 그대로 살아 있다 —
 *   임계값을 넘는 이동은 탭으로 보지 않기 때문이다.
 * - **선·마커는 `renderingGroupId = 1`.** Babylon 이 렌더링 그룹 사이에 깊이 버퍼를 지우므로
 *   모델을 관통해서도 측정이 보인다.
 * - **마커와 거리 라벨은 3D 가 아니라 HTML DOM 오버레이.** `@babylonjs/gui` 를 끌어들이지
 *   않고(Inspector 를 lazy chunk 로 뺀 효과를 지킨다), 테마 변수를 그대로 쓴다.
 *
 *   마커는 한때 씬 안의 구체였고 크기를 바운딩 박스 대각선에 비례시켰다 — **월드 공간**에서
 *   고정 크기를 쓰면 작은 모델에서 안 보이고 큰 모델을 삼키기 때문이다. 그러나 그 방식은
 *   원근을 그대로 받아, 줌하면 커지고 먼 점은 작아진다. 측정 마커는 "무엇을 찍었는지"를
 *   가리키는 조준점이므로 그 흔들림이 그대로 손해다. **화면 공간**으로 옮기면 모델 크기와
 *   카메라 거리 양쪽에서 자유로워진다 — 원래 걱정하던 문제가 애초에 생기지 않는다.
 *
 *   대가는 선(`LinesMesh`)만 3D 에 남아 표현이 섞인다는 것이다. 선은 두 점을 잇는 것이라
 *   **원근을 받는 편이 옳고**(깊이가 다른 두 점 사이가 기울어 보여야 한다), 마커는 그렇지
 *   않다 — 그래서 이 혼합은 타협이 아니라 각자의 성격을 따른 결과다.
 */
export class MeasurementTool {
  private readonly measurements: Measurement[] = [];
  private readonly visuals = new Map<
    number,
    { line: LinesMesh; markers: MarkerOverlay[]; label: HTMLElement }
  >();
  private pending: Point3 | undefined;
  private pointerDownAt: { x: number; y: number } | undefined;
  private pendingMarker: MarkerOverlay | undefined;
  private nextId = 1;
  private active = false;
  private snap = true;
  private selectedId: number | undefined;

  private readonly material: StandardMaterial;
  private readonly selectedMaterial: StandardMaterial;

  public onChange: () => void = () => {};

  public constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly labelHost: HTMLElement,
    private unit: ResolvedUnit,
    private decimals: number,
  ) {
    this.material = new StandardMaterial('modelLens.measure', scene);
    this.material.emissiveColor = new Color3(1, 0.55, 0.1);
    this.material.disableLighting = true;

    this.selectedMaterial = new StandardMaterial('modelLens.measure.selected', scene);
    this.selectedMaterial.emissiveColor = new Color3(0.25, 0.8, 1);
    this.selectedMaterial.disableLighting = true;

    scene.onPointerObservable.add((info) => {
      if (!this.active) {
        return;
      }
      if (info.type === PointerEventTypes.POINTERDOWN) {
        this.pointerDownAt = { x: scene.pointerX, y: scene.pointerY };
        return;
      }
      // POINTERUP
      const down = this.pointerDownAt;
      this.pointerDownAt = undefined;
      if (!down) {
        return;
      }
      const moved = Math.hypot(scene.pointerX - down.x, scene.pointerY - down.y);
      if (moved > TAP_THRESHOLD_PX) {
        return; // 궤도 회전이었다 — 측정 점을 만들지 않는다.
      }
      this.handleTap(info.pickInfo);
    }, PointerEventTypes.POINTERDOWN | PointerEventTypes.POINTERUP);
    scene.onAfterRenderObservable.add(() => this.positionOverlays());
  }

  public get list(): readonly Measurement[] {
    return this.measurements;
  }

  public get selected(): number | undefined {
    return this.selectedId;
  }

  /** 저장·복원에 쓰는 인덱스. id 는 런타임 값이라 세션을 넘어가지 못한다. */
  public get selectedIndex(): number | null {
    const index = this.measurements.findIndex((m) => m.id === this.selectedId);
    return index === -1 ? null : index;
  }

  /** 좌표만 뽑는다 — 길이는 복원 시 다시 계산한다. */
  public snapshot(): { a: Point3; b: Point3 }[] {
    return this.measurements.map((m) => ({ a: { ...m.a }, b: { ...m.b } }));
  }

  /** 저장된 좌표에서 측정을 되살린다. 기존 측정은 모두 지운다. */
  public restore(entries: readonly { a: Point3; b: Point3 }[], selectedIndex: number | null): void {
    this.clear();
    for (const entry of entries) {
      const measurement: Measurement = {
        id: this.nextId++,
        a: entry.a,
        b: entry.b,
        length: distance(entry.a, entry.b),
      };
      this.measurements.push(measurement);
      this.createVisual(measurement);
    }
    const target = selectedIndex === null ? undefined : this.measurements[selectedIndex]?.id;
    // select() 가 onChange 를 부르므로 여기서 따로 부르지 않는다.
    this.select(target);
  }

  public get isActive(): boolean {
    return this.active;
  }

  public setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.discardPending();
    }
    this.onChange();
  }

  public setSnap(snap: boolean): void {
    this.snap = snap;
  }

  /** 단위가 바뀌면 이미 만든 측정의 라벨도 함께 갱신한다. */
  public setUnit(unit: ResolvedUnit, decimals: number): void {
    this.unit = unit;
    this.decimals = decimals;
    for (const measurement of this.measurements) {
      const visual = this.visuals.get(measurement.id);
      if (visual) {
        visual.label.textContent = this.labelFor(measurement);
      }
    }
  }

  public select(id: number | undefined): void {
    this.selectedId = id;
    for (const [measurementId, visual] of this.visuals) {
      const material = measurementId === id ? this.selectedMaterial : this.material;
      visual.line.color = material.emissiveColor;
      for (const marker of visual.markers) {
        marker.element.classList.toggle('selected', measurementId === id);
      }
      visual.label.classList.toggle('selected', measurementId === id);
    }
    this.onChange();
  }

  public remove(id: number): void {
    const index = this.measurements.findIndex((m) => m.id === id);
    if (index === -1) {
      return;
    }
    this.measurements.splice(index, 1);
    this.disposeVisual(id);
    if (this.selectedId === id) {
      this.selectedId = undefined;
    }
    this.onChange();
  }

  public clear(): void {
    for (const measurement of [...this.measurements]) {
      this.disposeVisual(measurement.id);
    }
    this.measurements.length = 0;
    this.selectedId = undefined;
    this.discardPending();
    this.onChange();
  }

  /**
   * 이 화면 좌표를 찍으면 어느 점이 될지 **조회만** 한다 (측정을 만들지 않는다).
   *
   * 자동 렌더 테스트가 "이 정점을 찍으려면 어느 픽셀인가"를 알아내는 데 쓴다. 카메라 방향을
   * 가정하지 않고 클릭 대상을 정할 수 있어야 테스트가 결정적이 된다. 읽기 전용이며 도구 내부와
   * 정확히 같은 경로(`resolvePoint`)를 쓰므로, 테스트가 상호작용을 우회하지 않는다.
   */
  public probeAt(x: number, y: number): Point3 | undefined {
    return this.resolvePoint(this.scene.pick(x, y));
  }

  public labelFor(measurement: Measurement): string {
    return formatLength(measurement.length, this.unit, this.decimals);
  }

  private handleTap(pick: PickingInfo | null): void {
    const point = this.resolvePoint(pick);
    if (!point) {
      return;
    }
    if (!this.pending) {
      this.pending = point;
      this.pendingMarker = this.createMarker(point);
      return;
    }
    const measurement: Measurement = {
      id: this.nextId++,
      a: this.pending,
      b: point,
      length: distance(this.pending, point),
    };
    this.discardPending();
    this.measurements.push(measurement);
    this.createVisual(measurement);
    this.onChange();
  }

  /** 피킹 결과를 측정 점으로 바꾼다. 정점 스냅이 켜져 있으면 찍은 삼각형의 정점으로 붙인다. */
  private resolvePoint(pick: PickingInfo | null): Point3 | undefined {
    if (!pick?.hit || !pick.pickedPoint) {
      return undefined;
    }
    const exact = toPoint(pick.pickedPoint);
    if (!this.snap) {
      return exact;
    }
    const triangle = triangleFromPick(pick);
    return triangle ? snapToNearestVertex(exact, triangle) : exact;
  }

  private createVisual(measurement: Measurement): void {
    const line = CreateLines(
      `modelLens.measure.line.${measurement.id}`,
      { points: [toVector(measurement.a), toVector(measurement.b)] },
      this.scene,
    );
    line.color = this.material.emissiveColor;
    line.isPickable = false;
    line.renderingGroupId = 1;

    const markers = [measurement.a, measurement.b].map((point) => this.createMarker(point));

    const label = document.createElement('span');
    label.className = 'measure-label';
    label.textContent = this.labelFor(measurement);
    this.labelHost.appendChild(label);

    this.visuals.set(measurement.id, { line, markers, label });
  }

  /**
   * 마커 하나. 위치는 매 프레임 `positionOverlays()` 가 투영해 넣는다.
   *
   * 형태는 원을 유지한다 — 패널 chrome 의 "모서리 반경은 전부 0" 규칙(ADR 260826-094348)은
   * 각진 실루엣이 브랜드이기 때문인데, 이것은 chrome 이 아니라 **씬 위의 조준점**이고 씬 안의
   * 구체였을 때부터 원이었다. 표현 방식을 바꾸면서 외형까지 바꿀 이유는 없다.
   */
  private createMarker(point: Point3): MarkerOverlay {
    const element = document.createElement('span');
    element.className = 'measure-marker';
    this.labelHost.appendChild(element);
    return { element, point };
  }

  private discardPending(): void {
    this.pending = undefined;
    this.pendingMarker?.element.remove();
    this.pendingMarker = undefined;
  }

  private disposeVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) {
      return;
    }
    visual.line.dispose();
    for (const marker of visual.markers) {
      marker.element.remove();
    }
    visual.label.remove();
    this.visuals.delete(id);
  }

  /**
   * 라벨을 선의 중점 위로 옮긴다.
   *
   * 뷰포트를 **CSS 픽셀**로 잡는다 — `engine.getRenderWidth()` 는 devicePixelRatio 가 적용된
   * 버퍼 크기여서 고해상도 화면에서 라벨이 어긋난다.
   */
  private positionOverlays(): void {
    const camera: Camera | null = this.scene.activeCamera;
    if (!camera) {
      return;
    }
    if (this.visuals.size === 0 && !this.pendingMarker) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const viewport = new Viewport(0, 0, rect.width, rect.height);
    const transform = this.scene.getTransformMatrix();

    /** 월드 점 하나를 화면으로 옮긴다. 카메라 뒤라면 그 요소를 숨긴다. */
    const place = (element: HTMLElement, point: Point3): void => {
      const projected = Vector3.Project(toVector(point), Matrix.Identity(), transform, viewport);
      // z 가 [0,1] 밖이면 카메라 뒤쪽이다.
      const behind = projected.z < 0 || projected.z > 1;
      element.style.display = behind ? 'none' : '';
      if (!behind) {
        element.style.transform = `translate(-50%, -50%) translate(${projected.x}px, ${projected.y}px)`;
      }
    };

    for (const measurement of this.measurements) {
      const visual = this.visuals.get(measurement.id);
      if (!visual) {
        continue;
      }
      place(visual.label, midpoint(measurement.a, measurement.b));
      for (const marker of visual.markers) {
        place(marker.element, marker.point);
      }
    }

    // 첫 점만 찍힌 상태의 마커도 같은 경로로 따라온다.
    if (this.pendingMarker) {
      place(this.pendingMarker.element, this.pendingMarker.point);
    }
  }
}

/** 화면에 떠 있는 마커 하나 — 그 요소와, 그것이 가리키는 월드 좌표. */
interface MarkerOverlay {
  element: HTMLElement;
  point: Point3;
}

function toPoint(vector: Vector3): Point3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function toVector(point: Point3): Vector3 {
  return new Vector3(point.x, point.y, point.z);
}

/** 피킹된 면의 세 정점을 월드 좌표로 돌려준다. 정점 스냅의 후보다. */
function triangleFromPick(pick: PickingInfo): Triangle | undefined {
  const mesh = pick.pickedMesh;
  if (!mesh || pick.faceId < 0) {
    return undefined;
  }
  const indices = mesh.getIndices();
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!indices || !positions) {
    return undefined;
  }
  const world = mesh.getWorldMatrix();
  const corners: Point3[] = [];
  for (let corner = 0; corner < 3; corner++) {
    const vertexIndex = indices[pick.faceId * 3 + corner];
    if (vertexIndex === undefined) {
      return undefined;
    }
    const local = new Vector3(
      positions[vertexIndex * 3],
      positions[vertexIndex * 3 + 1],
      positions[vertexIndex * 3 + 2],
    );
    corners.push(toPoint(Vector3.TransformCoordinates(local, world)));
  }
  return [corners[0], corners[1], corners[2]];
}
