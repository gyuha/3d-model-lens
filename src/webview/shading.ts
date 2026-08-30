import '@babylonjs/core/Rendering/edgesRenderer.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * **표시 보조** — 모델의 형태를 읽기 쉽게 만드는 것이 유일한 목적인 표시 설정 (CONTEXT.md).
 * 사진처럼 그럴듯하게 보이는 것이 목표가 아니라 **면의 방향을 구별 가능하게** 만드는 것이
 * 기준이며, 그래서 사실적이지 않아도 된다. 셋 다 기본은 꺼짐이고, 켜도 형상·치수·측정값은
 * 변하지 않는다.
 *
 * **끄면 켜기 전과 정확히 같아야 한다는 것이 이 클래스의 계약이다.** 특히 조명 보조가 건드리는
 * `scene.environmentIntensity` 와 `imageProcessingConfiguration` 의 노출·대비는 **씬 전역**이라,
 * 되돌리기를 하나라도 빠뜨리면 토글을 꺼도 화면이 달라진 채 남는다. `shading.test.ts` 가 씬 상태를
 * 통째로 스냅샷해 비교하는 이유가 그것이다 — 속성을 하나씩 단정하면 "되돌리기를 잊은 그 속성"은
 * 애초에 테스트에도 안 적힌다.
 *
 * 조명 값의 근거는 ADR `260830-123628` 이다. 요약하면 **방향광 키 라이트로는 안 된다** — 실측에서
 * 위아래는 갈렸지만 정면과 측면이 끝내 같은 톤이었다. 반구광은 반대쪽 반구도 `groundColor` 로
 * 비추므로 검게 죽는 면이 없고, 축마다 하나씩 두면 면의 방향이 곧 색이 된다.
 */
export class ShadingAids {
  private readonly axisLights: HemisphericLight[] = [];
  private readonly originalMaterials = new Map<AbstractMesh, Material | null>();
  private readonly depthBias = new Map<Material, { zOffset: number; zOffsetUnits: number }>();
  private savedScene: SceneLightingState | undefined;
  private savedFill: FillLightState | undefined;
  private normalMaterial: ShaderMaterial | undefined;
  private lightingOn = false;
  private edgesOn = false;
  private normalColorsOn = false;

  /**
   * `fill` 은 `viewer.ts` 가 만든 보조 광원을 **명시적으로** 넘겨받는 자리다. 이름으로 씬에서
   * 찾지 않는다 — 그러면 `viewer.ts` 가 이름을 바꾸는 순간 3축이 조용히 2축으로 퇴화하고
   * **아무 테스트도 실패하지 않는다.** 넘기지 않으면 축 광원만 얹는다.
   */
  constructor(
    private readonly scene: Scene,
    private readonly meshes: AbstractMesh[],
    private readonly options: {
      fill?: HemisphericLight;
      markDirty?: () => void;
      /** 조명 보조가 이 모델에 의미가 있는가 — 근거는 `lightingSupported` 주석. */
      lightingSupported?: boolean;
    } = {},
  ) {}

  /**
   * 조명 보조를 이 모델에 쓸 수 있는가.
   *
   * **금속 재질에는 전제가 성립하지 않는다.** 이 보조는 "확산 표면이 사방에서 고르게 비치면
   * 평평해 보인다"를 고치는 것인데, 금속은 확산 반사가 0이라 반구광을 아무리 얹어도 화면이
   * 변하지 않는다. 그 상태에서 환경광만 낮추면 **더 어둡고 여전히 평평한** 결과가 된다 —
   * 실측: glTF 기본 재질이 `metallic: 1` 이라 정확히 그렇게 됐다.
   *
   * 그래서 우리가 재질을 쥐고 있는 STL(폴백 재질 `metallic: 0`)에서만 연다.
   */
  get lightingSupported(): boolean {
    return this.options.lightingSupported ?? true;
  }

  setLighting(on: boolean): void {
    if (on === this.lightingOn || (on && !this.lightingSupported)) {
      return;
    }
    this.lightingOn = on;
    if (on) {
      this.applyLighting();
    } else {
      this.restoreLighting();
    }
    this.options.markDirty?.();
  }

  /**
   * 이 모델에 모서리 보조를 쓸 수 있는가. 삼각형이 너무 많으면 생성이 메인 스레드를 오래 잡아
   * 멈춘 것처럼 보이므로 아예 열어 주지 않는다 — 근거는 `EDGE_TRIANGLE_LIMIT` 의 실측표다.
   */
  get edgesSupported(): boolean {
    return edgesAreAffordable(this.triangleCount());
  }

  setEdges(on: boolean): void {
    if (on === this.edgesOn || (on && !this.edgesSupported)) {
      return;
    }
    this.edgesOn = on;
    for (const mesh of this.meshes) {
      if (on) {
        // **웰딩하지 않는다.** STL 은 정점을 공유하지 않지만(`cube.stl` = 정점 36 / 고유 좌표 8)
        // 실측으로 크리스 12개가 정확히 나온다 — `forceSharedVertices()` 로 웰딩하면 법선이
        // 평균돼 각진 면이 매끈해지기만 한다 (ADR `260830-123628`).
        mesh.edgesWidth = EDGE_WIDTH;
        mesh.edgesColor = EDGE_COLOR.clone();
        mesh.enableEdgesRendering(EDGE_EPSILON);
      } else {
        mesh.disableEdgesRendering();
      }
    }
    this.syncDepthBias();
    this.options.markDirty?.();
  }

  setNormalColors(on: boolean): void {
    if (on === this.normalColorsOn) {
      return;
    }
    this.normalColorsOn = on;
    if (on) {
      const material = this.ensureNormalMaterial();
      for (const mesh of this.meshes) {
        this.originalMaterials.set(mesh, mesh.material);
        mesh.material = material;
      }
    } else {
      for (const mesh of this.meshes) {
        if (this.originalMaterials.has(mesh)) {
          mesh.material = this.originalMaterials.get(mesh) ?? null;
        }
      }
      this.originalMaterials.clear();
    }
    // 재질이 갈렸으므로 깊이 바이어스를 새 재질에 다시 얹는다 — 안 하면 법선 컬러링을 켠 순간
    // 모서리 선이 다시 점선으로 끊긴다.
    this.syncDepthBias();
    this.options.markDirty?.();
  }

  dispose(): void {
    this.setNormalColors(false);
    this.setEdges(false);
    this.setLighting(false);
    this.normalMaterial?.dispose();
    this.normalMaterial = undefined;
  }

  /**
   * 모서리 선은 두 면이 공유하는 모서리 **위에** 놓이므로, 표면과 깊이가 같아 픽셀마다 승부가
   * 갈린다 — 실제로 선이 점선처럼 끊겨 보였다. 표면을 조금 뒤로 밀어 선이 이기게 한다.
   *
   * 한 곳에 모아 둔 이유: 법선 컬러링이 재질을 통째로 갈아 끼우므로, 바이어스를 얹은 재질과
   * 지금 붙어 있는 재질이 어긋날 수 있다. 상태가 바뀔 때마다 여기서 다시 맞춘다.
   */
  private syncDepthBias(): void {
    for (const [material, saved] of this.depthBias) {
      material.zOffset = saved.zOffset;
      material.zOffsetUnits = saved.zOffsetUnits;
    }
    this.depthBias.clear();
    if (!this.edgesOn) {
      return;
    }
    for (const mesh of this.meshes) {
      const material = mesh.material;
      if (!material || this.depthBias.has(material)) {
        continue;
      }
      this.depthBias.set(material, {
        zOffset: material.zOffset,
        zOffsetUnits: material.zOffsetUnits,
      });
      material.zOffset = DEPTH_BIAS;
      material.zOffsetUnits = DEPTH_BIAS_UNITS;
    }
  }

  private triangleCount(): number {
    let total = 0;
    for (const mesh of this.meshes) {
      total += (mesh.getIndices()?.length ?? 0) / 3;
    }
    return total;
  }

  private applyLighting(): void {
    const ip = this.scene.imageProcessingConfiguration;
    this.savedScene = {
      environmentIntensity: this.scene.environmentIntensity,
      exposure: ip.exposure,
      contrast: ip.contrast,
      imageProcessingEnabled: ip.isEnabled,
    };
    // 노출을 낮추는 것이 핵심이다. 기본 재질의 `baseColor` 가 밝아, 여유 없이 빛만 더하면
    // 전부 흰색으로 클리핑돼 **대비가 오히려 사라진다** (ADR 의 첫 시도가 그렇게 실패했다).
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    ip.exposure = EXPOSURE;
    ip.contrast = CONTRAST;

    const fill = this.options.fill;
    if (fill) {
      this.savedFill = {
        light: fill,
        intensity: fill.intensity,
        diffuse: fill.diffuse.clone(),
        groundColor: fill.groundColor.clone(),
      };
      fill.intensity = FILL.intensity;
      fill.diffuse = FILL.sky.clone();
      fill.groundColor = FILL.ground.clone();
    }

    for (const spec of AXIS_LIGHTS) {
      const light = new HemisphericLight(spec.name, spec.direction.clone(), this.scene);
      light.intensity = spec.intensity;
      light.diffuse = spec.sky.clone();
      light.groundColor = spec.ground.clone();
      this.axisLights.push(light);
    }
  }

  private restoreLighting(): void {
    for (const light of this.axisLights.splice(0)) {
      light.dispose();
    }
    if (this.savedFill) {
      const { light, intensity, diffuse, groundColor } = this.savedFill;
      light.intensity = intensity;
      light.diffuse = diffuse;
      light.groundColor = groundColor;
      this.savedFill = undefined;
    }
    if (this.savedScene) {
      const ip = this.scene.imageProcessingConfiguration;
      this.scene.environmentIntensity = this.savedScene.environmentIntensity;
      ip.exposure = this.savedScene.exposure;
      ip.contrast = this.savedScene.contrast;
      ip.isEnabled = this.savedScene.imageProcessingEnabled;
      this.savedScene = undefined;
    }
  }

  /**
   * 법선을 색으로 직접 칠하는 조명 없는 재질.
   *
   * 정점 색을 구워 넣는 대신 셰이더를 쓴다 — 정점 색은 지오메트리를 건드리므로 큰 메시에서
   * 버퍼가 통째로 늘고, 끌 때 지우는 것까지 책임져야 한다. 재질만 갈아 끼우면 되돌리기가
   * 참조 하나를 되돌려 놓는 것으로 끝난다.
   *
   * **법선 속성을 읽지 않고 화면 도함수로 면 법선을 직접 구한다.** 처음엔 `attribute vec3 normal`
   * 을 읽었는데, glTF 는 법선 생략을 허용하고(사양상 렌더러가 평면 법선을 계산해야 한다) 실제로
   * 이 저장소의 glTF 픽스처는 `속성=[position]` 뿐이었다. 바인딩할 것이 없으니 `(0,0,0)` 이
   * 들어와 `normalize` 가 NaN 이 되고 **모델이 통째로 검게** 나왔다. 도함수로 구하면 법선 속성이
   * 있든 없든 동작하고, 게다가 이 보조가 원하는 것은 정점 법선이 아니라 **면 방향**이라 더 맞다.
   */
  private ensureNormalMaterial(): ShaderMaterial {
    if (this.normalMaterial) {
      return this.normalMaterial;
    }
    Effect.ShadersStore[`${SHADER}VertexShader`] = NORMAL_VERTEX_SHADER;
    Effect.ShadersStore[`${SHADER}FragmentShader`] = NORMAL_FRAGMENT_SHADER;
    const material = new ShaderMaterial(
      'modelLens.normalColors',
      this.scene,
      SHADER,
      {
        attributes: ['position'],
        uniforms: ['world', 'worldViewProjection', 'cameraPosition'],
      },
    );
    // 기본 재질과 같은 이유로 뒷면도 그린다 — STL 은 감김이 어긋난 파일이 흔하다.
    material.backFaceCulling = false;
    this.normalMaterial = material;
    return material;
  }
}

interface SceneLightingState {
  environmentIntensity: number;
  exposure: number;
  contrast: number;
  imageProcessingEnabled: boolean;
}

interface FillLightState {
  light: HemisphericLight;
  intensity: number;
  diffuse: Color3;
  groundColor: Color3;
}

/**
 * 모서리 보조를 열어 줄 삼각형 수의 상한.
 *
 * 생성은 **메인 스레드에서 동기로** 돌기 때문에, 오래 걸리면 앱이 멈춘 것처럼 보인다.
 *
 * 이 저장소에서 다시 쟀다 — 원본 확장(VS Code 웹뷰 = Chromium)과 **렌더러가 다르기 때문**이다.
 * WebKit 이 같은 일을 약 2.5배 빨리 한다(Playwright WebKit, `/tmp` 에 구운 UV 구):
 *
 * | 삼각형 | 이 저장소 (WebKit) | 원본 (Chromium) |
 * |---|---|---|
 * | `25,600` | `35ms` | `81ms` |
 * | `102,400` | `129ms` | `327ms` |
 * | `409,600` | `546ms` | `1,461ms` |
 *
 * 삼각형당 약 `1.33µs` 로 선형이고, 1초를 넘는 지점이 약 `750,000` 이라 그 조금 아래에서 끊는다.
 * **지어낸 값이 아니라 위 표에서 나온 값이다** — 값을 옮길 일이 생기면 표를 다시 재고 옮겨야
 * 한다. 렌더러가 바뀌면(예: 다른 플랫폼의 WebView) 그때도 다시 재야 한다.
 */
export const EDGE_TRIANGLE_LIMIT = 700_000;

export function edgesAreAffordable(triangles: number): boolean {
  return triangles <= EDGE_TRIANGLE_LIMIT;
}

/** 인접 면의 법선이 이보다 덜 나란하면 모서리로 본다. `0.95` 는 약 18° 다. */
const EDGE_EPSILON = 0.95;
const EDGE_WIDTH = 4;
const EDGE_COLOR = new Color4(0.09, 0.09, 0.11, 1);
/** 표면을 뒤로 미는 폴리곤 오프셋. 선이 깊이 싸움에서 이기게 하는 값이다. */
const DEPTH_BIAS = 4;
const DEPTH_BIAS_UNITS = 8;

const ENVIRONMENT_INTENSITY = 0.15;
const EXPOSURE = 0.75;
const CONTRAST = 1.4;

/** 넘겨받은 보조 광원을 조명 보조가 켜져 있는 동안만 이 값으로 바꿔 쓴다. */
const FILL = {
  intensity: 0.9,
  sky: new Color3(1.0, 0.97, 0.9),
  ground: new Color3(0.22, 0.26, 0.38),
};

/**
 * 축마다 반구광 하나. **하늘색과 바닥색을 반대 계열로** 주는 것이 요점이다 — 그래야 `+X` 를 향한
 * 면과 `-X` 를 향한 면이 색으로 갈린다. 방향광 3개로는 반대편 면이 검게 죽고, 6개로 늘리면
 * 재질의 `maxSimultaneousLights` 기본값 4를 넘긴다 (ADR `260830-123628`).
 */
const AXIS_LIGHTS = [
  {
    name: 'modelLens.axisX',
    direction: new Vector3(1, 0, 0),
    intensity: 0.5,
    sky: new Color3(1.0, 0.62, 0.45),
    ground: new Color3(0.4, 0.68, 1.0),
  },
  {
    name: 'modelLens.axisZ',
    direction: new Vector3(0, 0, 1),
    intensity: 0.4,
    sky: new Color3(0.55, 1.0, 0.7),
    ground: new Color3(0.8, 0.55, 1.0),
  },
];

const SHADER = 'modelLensNormal';

const NORMAL_VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPositionW;
void main(void) {
  vPositionW = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const NORMAL_FRAGMENT_SHADER = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec3 cameraPosition;
varying vec3 vPositionW;
void main(void) {
  vec3 faceNormal = normalize(cross(dFdx(vPositionW), dFdy(vPositionW)));
  // **부호는 감김이 아니라 시선으로 정한다.** \`gl_FrontFacing\` 을 쓰면 행렬식이 음수인 모델
  // (STL 손잡이 보정이 X 를 뒤집는다)에서 화면 감김이 반대라 색이 통째로 보색이 된다 — 실제로
  // glTF 가 STL 과 정반대 색으로 나왔다. 보이는 면은 카메라를 향한다는 규칙이 감김과 무관하다.
  if (dot(faceNormal, cameraPosition - vPositionW) < 0.0) {
    faceNormal = -faceNormal;
  }
  gl_FragColor = vec4(faceNormal * 0.5 + 0.5, 1.0);
}
`;
