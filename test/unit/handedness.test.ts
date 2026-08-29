import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { applyHandednessFix } from '../../src/webview/handedness';
import { registerModelLensLoaders } from '../../src/webview/loaders';

const DIR = join(import.meta.dirname, '..', 'fixtures');

/**
 * **같은 형상을 STL 과 GLB 로 실었을 때 월드 정점이 일치해야 한다.**
 *
 * 이것이 손잡이의 회귀 장치다. 치수 단정으로는 볼 수 없다 — **반사는 바운딩 박스를 보존**하고,
 * 다른 픽스처는 전부 원점 중심 직육면체라 자기 거울상과 정점 집합까지 같다. 그래서 비대칭
 * 픽스처(`chiral.*`)의 정점을 직접 비교한다.
 *
 * 로딩 관용구는 `extents.test.ts` 와 같다 — STL 은 동기 플러그인이라 `SceneLoader` 가 raw
 * 데이터를 거부하므로 플러그인의 `loadAssetContainer()` 를 직접 부른다.
 */
describe('손잡이 (NullEngine, 실제 로더)', () => {
  beforeAll(() => {
    registerModelLensLoaders();
  });

  it('chiral.stl 과 chiral.glb 의 월드 정점 집합이 일치한다', async () => {
    const stl = await worldVertices('chiral.stl');
    const glb = await worldVertices('chiral.glb');

    expect(stl.length, 'STL 정점을 읽지 못했다').toBeGreaterThan(0);
    expect(glb.length, 'GLB 정점을 읽지 못했다').toBeGreaterThan(0);
    expect(
      stl,
      `STL 이 GLB 와 다른 좌표에 실렸다 — 손잡이 보정이 빠졌으면 X 부호가 반대다.\n  STL: ${stl.join(' ')}\n  GLB: ${glb.join(' ')}`,
    ).toEqual(glb);
  });
});

/** 로드 후 손잡이 보정까지 적용한 뒤의 월드 정점. 중복 제거 + 정렬해 집합으로 비교한다. */
async function worldVertices(fixture: string): Promise<string[]> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const container = await loadFixture(scene, fixture);
    container.addAllToScene();

    const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    applyHandednessFix(meshes, fixture.endsWith('.stl') ? '.stl' : '.glb');

    const seen = new Set<string>();
    for (const mesh of meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) {
        continue;
      }
      mesh.computeWorldMatrix(true);
      const world = mesh.getWorldMatrix();
      for (let i = 0; i < positions.length; i += 3) {
        const point = Vector3.TransformCoordinates(
          new Vector3(positions[i], positions[i + 1], positions[i + 2]),
          world,
        );
        // 부동소수 잡음을 없애고 문자열로 비교한다 — 두 포맷의 저장 정밀도가 다르다.
        seen.add([point.x, point.y, point.z].map((v) => v.toFixed(4)).join(','));
      }
    }
    return [...seen].sort();
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

async function loadFixture(scene: Scene, fixture: string): Promise<AssetContainer> {
  const bytes = readFileSync(join(DIR, fixture));
  if (fixture.endsWith('.stl')) {
    const { STLFileLoader } = await import('@babylonjs/loaders/STL/stlFileLoader.js');
    return new STLFileLoader().loadAssetContainer(scene, bytes.toString('utf8'), '');
  }
  return LoadAssetContainerAsync(new Uint8Array(bytes), scene, {
    pluginExtension: fixture.slice(fixture.lastIndexOf('.')),
  });
}
