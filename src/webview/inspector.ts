import type { Scene } from '@babylonjs/core/scene.js';

interface InspectorHandle {
  dispose(): Promise<void>;
}

let handle: InspectorHandle | undefined;
let loading = false;

export function isInspectorVisible(): boolean {
  return handle !== undefined;
}

/**
 * Inspector 를 켜고 끈다.
 *
 * `@babylonjs/inspector` 는 React + FluentUI 를 끌고 와 번들의 대부분을 차지하므로
 * **동적 `import()` 로 별도 chunk 에 격리**한다. 토글하지 않으면 로드도 파싱도 되지 않는다.
 * 이것이 웹뷰 빌드를 `format: 'esm'` + `splitting: true` 로 잡은 이유다
 * (ADR 260822-115455b).
 *
 * Inspector 는 반드시 로컬에 번들되어 있어야 한다. Babylon 9 의 `_getGlobalInspector()` 는
 * `INSPECTOR` / `BABYLON.Inspector` 전역만 보고 **CDN 폴백이 없으므로**, 번들되어 있지
 * 않으면 조용히 실패한다. 우리는 `scene.debugLayer` 대신 Babylon 9 의 `ShowInspector()` 를
 * 직접 쓰므로 전역 탐색 경로를 아예 타지 않는다.
 */
export async function setInspectorVisible(scene: Scene, visible: boolean): Promise<void> {
  if (!visible) {
    const current = handle;
    handle = undefined;
    await current?.dispose();
    return;
  }
  if (handle || loading) {
    return;
  }

  loading = true;
  try {
    const [{ ShowInspector }, { GLTFValidation }] = await Promise.all([
      import('@babylonjs/inspector'),
      // Inspector 가 glTF 검증기를 끌고 온다. 기본 URL 이 cdn.babylonjs.com 이므로
      // 켜지는 순간 외부 요청을 시도한다 — 여기서 끊는다.
      import('@babylonjs/loaders/glTF/glTFValidation.js'),
    ]);
    GLTFValidation.Configuration = { url: '' };

    handle = ShowInspector(scene, {
      // 'inline' 은 캔버스를 Inspector 컨테이너로 재호스팅해 우리 DOM 오버레이(파트 4/4)와
      // 레이아웃을 다툰다. 'overlay' 는 캔버스 위에 겹쳐 그리므로 캔버스를 건드리지 않는다.
      layoutMode: 'overlay',
      autoResizeEngine: true,
    });
  } finally {
    loading = false;
  }
}
