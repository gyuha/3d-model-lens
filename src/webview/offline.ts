import { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2.js';
import { Tools } from '@babylonjs/core/Misc/tools.js';

/**
 * 외부 에셋/디코더를 가져오는 Babylon 의 기본 설정을 무력화한다.
 *
 * 웹뷰 CSP(`default-src 'none'`)가 이미 모든 외부 요청을 구조적으로 차단하므로 이건
 * 이중 방어다. 목적은 요청을 막는 것 자체보다 **의도를 코드에 명시**하는 것이다 —
 * 이 확장은 어떤 경우에도 네트워크에서 코드나 에셋을 가져오지 않는다.
 *
 * `@babylonjs/core` 는 `Tools._DefaultCdnUrl` / `_DefaultAssetsUrl` 을 정적 필드로 갖고 있어
 * 그 **문자열 자체를 번들에서 제거할 수는 없다**. 제거 가능한 것은 우리가 등록하는 glTF
 * 확장이고(`gltfExtensions.ts`), 남은 경로는 여기서 끊거나 로컬로 돌린다.
 * 번들에 남는 문자열은 `scripts/check-bundle.mjs` 의 허용 목록이 감시한다.
 */
export function enforceOfflineAssets(assetBaseUrl: string): void {
  // `Tools.GetAssetUrl()` 은 assets.babylonjs.com/core 를 AssetBaseUrl 로 치환한다.
  // 확장 안의 media/ 로 돌려놓으면 어떤 에셋 요청도 외부로 나가지 않는다
  // (해당 파일이 없으면 로컬에서 404 로 끝난다 — 외부 요청보다 낫다).
  Tools.AssetBaseUrl = assetBaseUrl;

  // KTX2/Basis 트랜스코더 — cdn.babylonjs.com. `KHR_texture_basisu` 를 등록하지 않으므로
  // glTF 경로로는 도달하지 않지만, `.ktx2` 텍스처를 직접 참조하는 경우를 대비해 끊어 둔다.
  const urlConfig = KhronosTextureContainer2.URLConfig as Record<string, unknown>;
  for (const key of Object.keys(urlConfig)) {
    urlConfig[key] = null;
  }
}
