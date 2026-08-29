/**
 * `@babylonjs/loaders/dynamic.js` 의 자리를 대신하는 no-op 스텁.
 *
 * `@babylonjs/inspector` 의 quickCreateToolsService 가 이 모듈을 **정적으로** import 해
 * `registerBuiltInLoaders()` 를 호출한다 — 로더 6종(BVH · FBX · glTF · OBJ · SPLAT · STL)과
 * glTF 확장 42개를 전부 등록하는 함수다. 그대로 두면 Inspector 를 켜는 순간
 * `gltfExtensions.ts` 의 선별 등록이 **런타임에 무효화**되고, Draco / KTX2 / meshopt 처럼
 * 외부 CDN 디코더를 요구하는 경로가 되살아난다.
 *
 * 우리는 이미 `loaders.ts` 에서 필요한 로더(glTF · STL)와 확장(34개)만 등록한다. 따라서
 * 이 호출은 아무것도 하지 않아야 맞다.
 *
 * 대가: Inspector 의 "quick create" 도구가 임의 포맷 에셋을 불러오지 못한다. 이 확장은
 * 세 포맷의 읽기 전용 뷰어이므로 범위 밖이다. (ADR 260822-115455, 260822-115455b)
 */
export function registerBuiltInLoaders(): void {
  // 의도적으로 비어 있다 — 위 주석 참조.
}
