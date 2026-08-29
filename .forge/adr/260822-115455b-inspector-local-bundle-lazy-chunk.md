---
author: gyuha
decided: 2026-08-22 11:54
---
# Inspector는 로컬 번들 필수 + 동적 `import()` chunk로 분리한다

Babylon의 `scene.debugLayer.show()`는 UMD 경로에서 `babylon.inspector.bundle.js`를 **CDN에서 동적으로 로드**하려 한다. VS Code 웹뷰의 CSP가 이를 차단하므로, Inspector는 선택이 아니라 **필수로 로컬에 번들되어 있어야** 한다 — `@babylonjs/inspector`를 ESM으로 import 해두면 `DebugLayer`가 이미 등록된 Inspector를 찾아 CDN 요청을 건너뛴다.

그런데 Inspector는 React와 GUI를 끌고 와 번들의 절반 이상을 차지한다. 그래서 단일 번들에 넣지 않고, **esbuild `format: 'esm'` + `splitting: true`** 로 빌드해 토글 시점에 `await import('@babylonjs/inspector')`로 별도 chunk를 로드한다. chunk의 상대 경로는 importing module의 URL(이미 웹뷰 URI) 기준으로 해결되므로 `<base>` 태그가 필요 없다.

이것이 웹뷰 빌드 형식 전체를 규정하는 결정이다 — ESM + code splitting은 Inspector 하나 때문에 선택된 것이며, 되돌리려면 빌드 설정과 로딩 부트스트랩을 다 바꿔야 한다.

## Consequences

- CSP는 nonce 대신 `script-src ${webview.cspSource}`를 쓴다. 동적 import chunk로의 CSP3 nonce 전파는 구현 편차가 있어 신뢰할 수 없다.
- `style-src`에 `'unsafe-inline'`이 필요하다 — Inspector가 스타일을 인라인 주입한다.
- Inspector 호출은 `{ embedMode: true, overlay: true, globalRoot: <우리 컨테이너> }`. `globalRoot`를 `document.body`로 두면 Inspector가 레이아웃을 가져가 우리 DOM 라벨 오버레이와 충돌한다.
- 같은 CDN 함정이 조명에도 있다. `scene.createDefaultEnvironment()`의 기본 환경 텍스처는 `assets.babylonjs.com`을 가리키므로 사용할 수 없고, prefiltered `.env` 파일을 레포에 번들해 `CubeTexture.CreateFromPrefilteredData`로 로드한다(VSIX +약 1 MB). glTF의 PBR은 IBL 없이는 금속 재질이 검게 뜬다.
- **"외부 네트워크 요청 0건"이 검증 가능한 불변식이다.** 검증 방법은 아래 개정을 따른다.

## 개정 — 2026-08-22 13:0x (`babylon-model-viewer-1of4` 실행 중 발견)

이 ADR 은 원래 불변식의 검증 방법을 "빌드 산출물에 `assets.babylonjs.com` 문자열이 없어야
한다"로 적었다. **그 검사는 Babylon 9 에서 만족시킬 수 없다.** `Tools._DefaultCdnUrl` 과
`Tools._DefaultAssetsUrl` 이 `Misc/tools.pure.js` 의 정적 필드이고 `Scene`·`Engine` 이 모두
`Tools` 에 의존하므로, Babylon 을 쓰는 순간 그 문자열은 번들에 들어온다. 즉 과도한 검사가
아니라 **잘못 인코딩된** 검사였다 — 문자열의 존재는 도달 가능성을 뜻하지 않는다.

**결정 자체는 그대로다** (Inspector 로컬 번들 필수 + 동적 import chunk). 바뀌는 것은 불변식을
어떻게 지키고 어떻게 검증하느냐다.

**지키는 방법 — 세 겹.**
1. 웹뷰 CSP `default-src 'none'` 이 모든 외부 요청을 **구조적으로** 차단한다. 이게 본체다.
2. `src/webview/offline.ts` 가 `Tools.AssetBaseUrl` 을 확장의 로컬 `media/` 로 돌리고
   KTX2 `URLConfig` 를 전부 null 로 만든다.
3. CDN 에서 디코더·에셋을 가져오는 glTF 확장을 **애초에 등록하지 않는다**
   (`src/webview/gltfExtensions.ts` — 42개 중 34개만 등록). 등록하지 않으면 Babylon 이
   "지원하지 않는 확장"으로 명확히 보고하므로, CSP 에 막혀 원인 모를 실패를 내는 것보다 낫다.

**검증하는 방법 — `npm run check:bundle`** (`scripts/check-bundle.mjs`).
1. CDN 의존 확장 8개의 모듈이 번들에 **없음**을 단정한다. 이건 우리가 통제할 수 있다.
2. 번들의 외부 URL 집합이 **근거가 달린 허용 목록과 정확히 일치**함을 단정한다. Babylon 업그레이드로
   새 외부 의존이 들어오면 빌드가 깨진다 — 원래 검사는 도메인 하나만 봐서 이걸 못 잡았다.
fail-closed 를 실측했다: 정상 exit 0 / 새 외부 URL exit 1 / 금지 모듈 exit 1 / 산출물 부재 exit 1.

**실측 증거.** 헤드리스 브라우저에서 실제 CSP 헤더를 붙여 네 픽스처를 열고
`performance.getEntriesByType('resource')` 의 외부 오리진 요청이 **0건**임을 확인했다.
문자열 grep 보다 강한 증거다.

실제로 도달 가능했던 유일한 경로는 `KHR_materials_fuzz` → `OpenPBRMaterial` →
`assets.babylonjs.com/core/blue_noise/blue_noise_rgb.png` 였고, 그 확장을 제외해 끊었다.
