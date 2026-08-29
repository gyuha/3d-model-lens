import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { extentSizes, niceStep, type Extents } from './geometry.js';

/** 모델을 둘러싸는 보조 표시 — 그리드. 크기는 바운딩 박스에 비례한다. */
export class Chrome {
  private readonly grid: Mesh;
  private readonly meshes: AbstractMesh[];
  private wireframeOn = false;

  public constructor(scene: Scene, extents: Extents, meshes: AbstractMesh[]) {
    this.meshes = meshes;
    this.grid = buildGrid(scene, extents);
  }

  public setGridVisible(visible: boolean): void {
    this.grid.setEnabled(visible);
  }

  /**
   * 와이어프레임은 취향 기능이 아니라 정점 스냅(파트 4/4)의 전제 조건이다 —
   * 어디에 정점이 있는지 보여야 코너에 스냅할 수 있다.
   */
  public setWireframe(on: boolean): void {
    this.wireframeOn = on;
    for (const mesh of this.meshes) {
      if (mesh.material) {
        mesh.material.wireframe = on;
      }
    }
  }

  public get wireframe(): boolean {
    return this.wireframeOn;
  }
}

function buildGrid(scene: Scene, extents: Extents): Mesh {
  const [sizeX, , sizeZ] = extentSizes(extents);
  const footprint = Math.max(sizeX, sizeZ, Number.EPSILON);
  const step = niceStep(footprint / 8);
  const halfSpan = Math.ceil((footprint * 0.9) / step) * step;
  const y = extents.min.y;
  const center = {
    x: (extents.min.x + extents.max.x) / 2,
    z: (extents.min.z + extents.max.z) / 2,
  };

  const lines: Vector3[][] = [];
  for (let offset = -halfSpan; offset <= halfSpan + step / 2; offset += step) {
    lines.push([
      new Vector3(center.x + offset, y, center.z - halfSpan),
      new Vector3(center.x + offset, y, center.z + halfSpan),
    ]);
    lines.push([
      new Vector3(center.x - halfSpan, y, center.z + offset),
      new Vector3(center.x + halfSpan, y, center.z + offset),
    ]);
  }

  const grid = CreateLineSystem('modelLens.grid', { lines }, scene);
  grid.color = new Color3(0.45, 0.45, 0.45);
  grid.isPickable = false;
  return grid;
}

/**
 * 머티리얼이 없는 메시에 기본 머티리얼을 붙인다.
 *
 * 두 가지 이유로 필요하다.
 * (1) STL 로더는 머티리얼을 만들지 않고, 머티리얼이 없으면 `setWireframe` 이 그 메시에 아무
 *     효과도 내지 못한다. 패널 토글은 제거됐지만 능력은 남아 있다 (ADR 260822-233935).
 * (2) PBR 을 쓴다 — StandardMaterial 은 환경 맵(IBL)을 쓰지 않아 STL 이 glTF 보다 훨씬
 *     어둡게 보인다. 같은 IBL 로 켜야 포맷 간 외형이 일관된다.
 */
export function ensureMaterials(scene: Scene, meshes: AbstractMesh[]): void {
  let fallback: PBRMetallicRoughnessMaterial | undefined;
  for (const mesh of meshes) {
    if (mesh.material) {
      continue;
    }
    if (!fallback) {
      fallback = new PBRMetallicRoughnessMaterial('modelLens.defaultMaterial', scene);
      fallback.baseColor = new Color3(0.78, 0.78, 0.8);
      fallback.metallic = 0;
      fallback.roughness = 0.55;
      // STL 은 감김 방향이 어긋난 파일이 흔하므로 뒷면도 그린다 — 구멍이 뚫려 보이지 않게.
      fallback.backFaceCulling = false;
    }
    mesh.material = fallback;
  }
}
