import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Scene } from '@babylonjs/core/scene.js';
import { computeExtents, extentSizes } from '../../src/webview/geometry';
import { registerModelLensLoaders } from '../../src/webview/loaders';

const DIR = join(import.meta.dirname, '..', 'fixtures');

/**
 * 브라우저 없이 **실제 Babylon 로더**를 돌려 치수를 단정한다 (NullEngine).
 *
 * 두 픽스처를 서로 다른 경로로 로드하는데, 이유가 있다.
 * - `cube.glb` — glTF 는 비동기 플러그인이라 `loadFile` 을 갖고 있어 `LoadAssetContainerAsync`
 *   가 ArrayBufferView 를 그대로 받는다.
 * - `cube.stl` — STL 은 동기 플러그인이라 `loadFile` 이 없어서 SceneLoader 가 raw 데이터를
 *   거부한다("Plugin does not support loading ArrayBufferView"). Node 에는 `FileReader` 도
 *   `XMLHttpRequest` 도 없어 URL/File 경로도 쓸 수 없다. 그래서 플러그인의
 *   `loadAssetContainer()` 를 직접 부른다 — 실제 STL 파서와 좌표 처리를 그대로 검증한다.
 *
 * `cube.gltf`(외부 `cube.bin` 참조)는 Node 에서 형제 파일 해결이 되지 않아 여기서 다루지 않는다.
 * 그 경로는 브라우저 UAT 가 덮는다(외부 .bin fetch 확인 + extents [2,3,4]).
 */
describe('computeExtents (NullEngine, 실제 로더)', () => {
  beforeAll(() => {
    registerModelLensLoaders();
  });

  it.each([
    { fixture: 'cube.glb', expected: [5, 6, 7] },
    { fixture: 'cube.stl', expected: [10, 20, 30] },
  ])('$fixture 의 치수가 FIXTURES.md 기대값과 일치한다', async ({ fixture, expected }) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const container = await loadFixture(scene, fixture);
      container.addAllToScene();

      const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
      expect(meshes.length, '렌더할 메시가 없습니다').toBeGreaterThan(0);

      const sizes = extentSizes(computeExtents(scene, meshes));
      for (const [axis, size] of sizes.entries()) {
        expect(size, `축 ${'XYZ'[axis]}`).toBeCloseTo(expected[axis], 5);
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it('메시가 없으면 빈 치수를 낸다 — 센티넬 값이 새어 나오지 않게', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      expect(extentSizes(computeExtents(scene, []))).toEqual([0, 0, 0]);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

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
