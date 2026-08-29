---
author: gyuha
decided: 2026-08-29 14:36
---
# 검증된 esbuild 설정을 버리고 Vite 로 간다

프론트엔드 번들러를 **Vite** 로 한다. 원본의 `esbuild.mjs` 설정은 이식하지 않는다.

## 맥락

원본의 `esbuild.mjs` 는 단순한 번들러 설정이 아니라 ADR `260822-115455b` 의 실행체다. 세 가지를
동시에 보장한다.

1. ESM + code splitting — Babylon Inspector 가 `await import()` 로 별도 chunk 에 떨어져,
   모델만 볼 때는 다운로드도 파싱도 되지 않는다.
2. `alias` 로 노드/GUI 에디터 5종과 `@babylonjs/loaders/dynamic.js` 를 스텁으로 치환 —
   약 10 MB 와 다수의 외부 CDN URL 이 함께 사라진다.
3. `check:bundle` 로 산출물에 외부 참조가 0건임을 검사 — 오프라인 보장의 실질적 근거다.

이 셋은 **이미 검증된 상태**이고, Tauri 는 번들러에 무관심하므로(`frontendDist` 경로만 알면 된다)
그대로 가져다 쓰는 것이 가장 싼 길이었다.

## 결정

그럼에도 Vite 를 택한다. 근거는 표준성이다 — Tauri 공식 템플릿과 문서가 Vite 를 전제하고,
`index.html` 을 정적 자산으로 다루는 방식(이 앱은 `webviewHtml.ts` 를 해체해 그리로 간다)이
Vite 의 기본 모델과 맞아떨어진다. 앞으로 이 저장소를 만질 사람이 마주칠 설정이 관례적인 편이 낫다.

## 결과

비용은 **검증 자산의 소멸**이다. 위 세 가지 보장은 Rollup 위에서 처음부터 다시 확인해야 한다.
그래서 이것들을 믿음이 아니라 **완료 조건의 실측 항목**으로 옮긴다.

- Inspector 가 초기 번들에 포함되지 않고 별도 chunk 로 떨어지는지 — 산출물 크기로 확인한다.
- alias 스텁 6종이 Rollup 의 `resolve.alias` 에서 동일하게 동작하는지.
- `check:bundle` 을 새 산출물 경로에 맞춰 살려두고, 외부 참조 0건을 계속 검사하는지.

이 중 하나라도 실패하면 esbuild 설정으로 되돌리는 것이 정당한 대응이다. 그 경우를 대비해
원본 `esbuild.mjs` 는 참조 가능한 상태로 남겨둔다.
