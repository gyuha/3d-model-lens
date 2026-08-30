import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import {
  EDGE_TRIANGLE_LIMIT,
  ShadingAids,
  edgesAreAffordable,
} from '../../src/webview/shading';
import { ensureMaterials } from '../../src/webview/chrome';
import { registerModelLensLoaders } from '../../src/webview/loaders';

const DIR = join(import.meta.dirname, '..', 'fixtures');

/**
 * **표시 보조는 끄면 켜기 전과 정확히 같아야 한다.**
 *
 * 이것이 이 모듈의 핵심 회귀 장치다. 조명 보조는 `scene.environmentIntensity` 와
 * `imageProcessingConfiguration` 의 노출·대비를 바꾸는데 **둘 다 씬 전역**이라, 되돌리지 않으면
 * 토글을 꺼도 화면이 달라진 채 남는다 — 그리고 그건 "설정을 껐는데 원래대로 안 온다"는
 * 형태로만 드러나서 눈으로는 알아채기 어렵다.
 */
describe('표시 보조 (NullEngine, 실제 로더)', () => {
  beforeAll(() => {
    registerModelLensLoaders();
  });

  it('세 보조를 각각 켰다 끄면 씬이 원래 상태로 돌아온다', async () => {
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });
    const before = snapshot(scene, meshes);

    for (const apply of [
      (on: boolean) => aids.setLighting(on),
      (on: boolean) => aids.setEdges(on),
      (on: boolean) => aids.setNormalColors(on),
    ]) {
      apply(true);
      expect(snapshot(scene, meshes), '켰는데 씬이 그대로다 — 보조가 아무 일도 하지 않았다').not.toEqual(
        before,
      );
      apply(false);
      expect(snapshot(scene, meshes), '껐는데 원래 상태로 돌아오지 않았다').toEqual(before);
    }
  });

  it('셋을 동시에 켰다 모두 끄면 씬이 원래 상태로 돌아온다', async () => {
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });
    const before = snapshot(scene, meshes);

    aids.setLighting(true);
    aids.setEdges(true);
    aids.setNormalColors(true);
    expect(snapshot(scene, meshes)).not.toEqual(before);

    aids.setNormalColors(false);
    aids.setEdges(false);
    aids.setLighting(false);
    expect(snapshot(scene, meshes), '셋을 겹쳐 켰다 끄면 잔여물이 남는다').toEqual(before);
  });

  it('조명 보조는 축마다 색이 다른 반구광을 얹는다 — 색이 같으면 방향이 안 갈린다', async () => {
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });
    aids.setLighting(true);

    const hemis = scene.lights.filter((l) => 'groundColor' in l);
    expect(hemis.length, '축 광원이 얹히지 않았다').toBeGreaterThanOrEqual(3);

    // 하늘색·바닥색 쌍이 전부 달라야 면 방향이 색으로 갈린다. 하나라도 겹치면 그 축은 무의미하다.
    const pairs = hemis.map(
      (l) => `${l.diffuse.toHexString()}/${(l as { groundColor: Color3 }).groundColor.toHexString()}`,
    );
    expect(new Set(pairs).size, `색쌍이 겹친다: ${pairs.join(' ')}`).toBe(pairs.length);
  });

  it('cube.stl 의 크리스 모서리는 12개다 — 와이어프레임(36)이 되면 실패한다', async () => {
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });

    // 정육면체의 실제 모서리 수. Babylon 은 선 하나를 정점 4개로 저장한다.
    // 웰딩하지 않은 STL 에서도 이 값이 나온다는 것이 ADR `260830-123628` 의 실측이다.
    const edgeCount = (): number => {
      const renderer = meshes[0].edgesRenderer as unknown as { _linesPositions?: number[] } | null;
      return (renderer?._linesPositions?.length ?? 0) / 3 / 4;
    };

    aids.setEdges(true);
    expect(edgeCount(), '모서리 수가 12가 아니다 — 36이면 크리스 판정이 실패해 와이어프레임이 된 것이다').toBe(12);

    // 껐다 켜도 같아야 한다 — 재생성 경로가 첫 생성과 어긋나면 여기서 갈린다.
    aids.setEdges(false);
    aids.setEdges(true);
    expect(edgeCount()).toBe(12);
  });

  it('법선 컬러링을 끄면 원래 재질 인스턴스가 그대로 돌아온다', async () => {
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });
    const original = meshes.map((m) => m.material);

    aids.setNormalColors(true);
    expect(meshes.map((m) => m.material), '재질이 갈리지 않았다').not.toEqual(original);

    aids.setNormalColors(false);
    // uniqueId 비교가 아니라 **인스턴스 동일성**을 본다 — 같은 값의 새 재질로 바꿔치기하면
    // 화면은 같아 보여도 원본이 유실된 것이다.
    expect(meshes.map((m) => m.material)).toEqual(original);
  });

  it('조명 보조를 지원하지 않는 모델에서는 켜도 아무 일이 없다', async () => {
    // 금속 재질에는 "확산 표면이 고르게 비치면 평평하다"는 전제가 성립하지 않는다 — 반구광을
    // 얹어도 화면이 안 변하고 환경광만 낮아져 **더 어둡고 여전히 평평**해진다 (실측: glTF 기본
    // 재질이 `metallic: 1`). 그래서 우리가 재질을 쥔 STL 에서만 연다.
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill, lightingSupported: false });
    const before = snapshot(scene, meshes);

    expect(aids.lightingSupported).toBe(false);
    aids.setLighting(true);
    expect(snapshot(scene, meshes), '지원하지 않는데도 씬을 건드렸다').toEqual(before);
  });

  it('삼각형이 상한을 넘으면 모서리 보조를 열어 주지 않는다', async () => {
    // 실측(NullEngine): 25,600 → 81ms · 102,400 → 327ms · 409,600 → 1,461ms. 생성이 메인
    // 스레드에서 동기로 돌기 때문에, 1초를 넘는 지점(약 285,000)에서 끊는다.
    expect(edgesAreAffordable(EDGE_TRIANGLE_LIMIT)).toBe(true);
    expect(edgesAreAffordable(EDGE_TRIANGLE_LIMIT + 1)).toBe(false);

    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });
    expect(aids.edgesSupported, 'cube.stl(삼각형 12개)이 상한에 걸렸다').toBe(true);
  });

  it('같은 값을 두 번 켜도 광원이 중복 생성되지 않는다', async () => {
    const { scene, meshes, fill } = await loadCube();
    const aids = new ShadingAids(scene, meshes, { fill });
    const before = scene.lights.length;

    aids.setLighting(true);
    const once = scene.lights.length;
    aids.setLighting(true);
    expect(scene.lights.length, '중복 호출마다 광원이 쌓인다').toBe(once);

    aids.setLighting(false);
    expect(scene.lights.length).toBe(before);
  });
});

/**
 * **정점 웰딩은 답이 아니다.** 모서리가 이상해 보일 때 `forceSharedVertices()` 가 그럴듯한
 * 해결책처럼 보이지만, 실측으로 웰딩 없이도 크리스가 정확히 나오고(cube.stl → 모서리 12개)
 * 웰딩하면 법선이 평균돼 각진 면이 매끈해지기만 한다 (ADR `260830-123628`).
 *
 * 단어가 아니라 **호출**을 막는다 — 단어를 막으면 "쓰지 말라"고 적어 둔 주석까지 막힌다.
 */
describe('웰딩 금지', () => {
  it('src/ 어디에서도 forceSharedVertices 를 호출하지 않는다', () => {
    const offenders = sourceFiles('src').filter((file) =>
      readFileSync(file, 'utf8').includes('.forceSharedVertices('),
    );
    expect(offenders, `웰딩 호출이 들어왔다: ${offenders.join(', ')}`).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

/**
 * 씬의 관측 가능한 상태를 전부 문자열로 굳힌다.
 *
 * 개별 속성을 하나씩 단정하지 않고 통째로 비교하는 이유: **되돌리기를 빠뜨린 속성**을 잡는 것이
 * 목적인데, 하나씩 단정하면 "내가 되돌리기를 잊은 그 속성"은 애초에 테스트에도 안 적힌다.
 */
function snapshot(scene: Scene, meshes: AbstractMesh[]): string {
  const ip = scene.imageProcessingConfiguration;
  return JSON.stringify({
    lights: scene.lights
      .map(
        (l) =>
          `${l.name}|${l.intensity}|${l.diffuse.toHexString()}|${describeGround(
            l as unknown as { groundColor?: Color3 },
          )}`,
      )
      .sort(),
    environmentIntensity: scene.environmentIntensity,
    exposure: ip.exposure,
    contrast: ip.contrast,
    imageProcessingEnabled: ip.isEnabled,
    meshes: meshes.map(
      (m) =>
        `${m.name}|${m.material?.uniqueId ?? 'none'}|${m.edgesRenderer ? 'edges' : '-'}` +
        // 모서리 보조가 표면을 뒤로 미는 폴리곤 오프셋. 되돌리기를 빠뜨리면 모서리를 껐는데도
        // 모델이 그리드와 깊이 싸움을 계속한다.
        `|${m.material?.zOffset ?? '-'}/${m.material?.zOffsetUnits ?? '-'}`,
    ),
  });
}

function describeGround(light: { groundColor?: Color3 }): string {
  return light.groundColor ? light.groundColor.toHexString() : '-';
}

/**
 * 실제 씬을 그대로 흉내 낸다 — 모델 + 기본 재질 + `viewer.ts` 가 두는 보조 광원.
 * 보조 광원을 빼면 조명 보조가 축 2개짜리로 돌아가는데, 그건 실제로는 일어나지 않는 상황이다.
 */
async function loadCube(): Promise<{ scene: Scene; meshes: AbstractMesh[]; fill: HemisphericLight }> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const bytes = readFileSync(join(DIR, 'cube.stl'));
  const { STLFileLoader } = await import('@babylonjs/loaders/STL/stlFileLoader.js');
  const container = new STLFileLoader().loadAssetContainer(scene, bytes.toString('utf8'), '');
  container.addAllToScene();
  const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  ensureMaterials(scene, meshes);
  const fill = new HemisphericLight('modelLens.fill', new Vector3(0, 1, 0), scene);
  fill.intensity = 0.5;
  return { scene, meshes, fill };
}
