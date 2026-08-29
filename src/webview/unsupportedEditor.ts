/**
 * Babylon Inspector 가 동적으로 불러오는 노드/GUI 에디터 5종의 자리를 대신하는 스텁.
 *
 * `@babylonjs/inspector` 는 `@babylonjs/node-editor`, `node-geometry-editor`,
 * `node-particle-editor`, `node-render-graph-editor`, `gui-editor` 를 동적 import 한다
 * (Inspector 의 "노드 에디터로 열기" 같은 동작). 이 확장은 **읽기 전용 모델 뷰어**이므로
 * 노드 머티리얼·파티클·GUI 편집은 범위 밖이다.
 *
 * 그래서 esbuild 의 `alias` 로 다섯 패키지를 이 스텁으로 치환한다. 얻는 것:
 * - VSIX 에서 약 10 MB 제거 (에디터 chunk 5개)
 * - 그 에디터들이 끌고 오던 외부 URL 제거 (use.typekit.net · shadertoy.com ·
 *   unpkg.com/manifold-3d · npmjs.com 등) — 웹뷰 CSP 에 막혀 어차피 동작하지 않는다
 *
 * 사용자가 Inspector 에서 그 버튼을 누르면 조용한 실패 대신 아래 메시지가 뜬다.
 */
const MESSAGE =
  '3D Model Lens is a read-only model viewer — node/GUI editors are not supported.';

function unsupported(): never {
  throw new Error(MESSAGE);
}

// 에디터 패키지들이 노출하는 진입점 이름. 어느 것을 호출해도 같은 메시지로 실패한다.
export const NodeEditor = { Show: unsupported };
export const NodeGeometryEditor = { Show: unsupported };
export const NodeParticleEditor = { Show: unsupported };
export const NodeRenderGraphEditor = { Show: unsupported };
export const GUIEditor = { Show: unsupported };

export default { NodeEditor, NodeGeometryEditor, NodeParticleEditor, NodeRenderGraphEditor, GUIEditor };
