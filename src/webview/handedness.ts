import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { SupportedExtension } from '../formats.js';

/**
 * STL 로 실린 메시의 **손잡이(chirality)를 바로잡는다.**
 *
 * 왜 필요한가. 우리는 `STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true` 로 두어 파일 좌표를
 * 그대로 쓴다 (`loaders.ts` 참조 — 그러지 않으면 파일이 `Z=30` 이라 말하는데 패널이 `Y=30` 이라
 * 표시한다). 그런데 씬은 좌수(`useRightHandedSystem` 기본 `false`)이고 STL 은 우수다.
 * **우수 좌표를 변환 없이 좌수 씬에 실으면 모델이 좌우 거울상으로 렌더된다.**
 */
export function applyHandednessFix(
  meshes: AbstractMesh[],
  extension: SupportedExtension,
): void {
  if (extension !== '.stl') {
    // glTF/GLB 는 로더가 `__root__` 에 변환을 걸어 이미 보정한다 — 실측한 순변환은
    // `rotation=[0,1,0,0]`(Y 180°) + `scale=[1,1,-1]` 이 합쳐진 `diag(-1, 1, 1)` 이다.
    return;
  }

  // **이 반사를 지우지 마라.** 지우면 STL 이 좌우 거울상으로 돌아오고, **치수 단정은 그것을
  // 보지 못한다** — 반사는 바운딩 박스를 보존하기 때문이다. 회귀 장치는
  // `test/unit/handedness.test.ts` 의 "chiral.stl 과 chiral.glb 의 월드 정점 집합이 일치한다"
  // 하나뿐이다. 축을 X 로 고른 이유: 이러면 STL 이 glTF 로더가 만드는 것과 **정확히 같은**
  // 월드 좌표에 놓여, 렌더 규약을 따지지 않고 두 포맷을 직접 비교해 검증할 수 있다.
  // 상하축(Z-up CAD STL 이 옆으로 눕는 것)은 별개 문제이며 여기서 다루지 않는다 — STL 포맷에
  // 상하축 정보가 없어 자동 판정은 추측이 된다 (ADR `260822-115455c` 의 단위 판단과 같은 이유).
  for (const mesh of meshes) {
    mesh.scaling.x *= -1;
    mesh.computeWorldMatrix(true);
  }
}
