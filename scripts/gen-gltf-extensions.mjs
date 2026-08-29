// src/webview/gltfExtensions.ts 를 생성한다 (`npm run gen:gltf-extensions`).
//
// Babylon 의 registerBuiltInGLTFExtensions() 는 glTF 확장을 전부 등록하는데, 그중 일부가
// 외부 CDN에서 디코더/에셋을 가져와 웹뷰 CSP 에 막힌다. 그래서 선별 목록을 쓴다.
// Babylon 버전을 올릴 때 이 스크립트를 다시 돌려 새 확장을 반영할 것.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(
  ROOT,
  'node_modules/@babylonjs/loaders/glTF/2.0/Extensions/dynamic.js',
);
const TARGET = join(ROOT, 'src/webview/gltfExtensions.ts');

/** 제외 이유는 두 갈래다. (1) 외부 CDN 의존 (2) 순수 JS 지만 뷰어와 무관하고 무겁다. */
const EXCLUDED = {
  EXT_lights_area: 'assets.babylonjs.com 에서 areaLightsLTC.bin 을 가져온다',
  EXT_meshopt_compression: 'unpkg.com 에서 fflate 를 가져온다',
  KHR_draco_mesh_compression: '외부 Draco 디코더를 가져온다',
  KHR_texture_basisu: 'cdn.babylonjs.com 에서 babylon.ktx2Decoder.js 를 가져온다',
  KHR_materials_fuzz:
    'OpenPBRMaterial 의 노이즈 텍스처를 assets.babylonjs.com 에서 가져온다 — 실제로 도달 가능한 유일한 CDN 경로였다',
  KHR_interactivity: '플로우 그래프 실행 엔진 — 뷰어는 상호작용 그래프를 실행하지 않는다',
  MSFT_audio_emitter: '오디오 — 뷰어에 소리가 없다',
  KHR_gaussian_splatting: 'Gaussian Splat — 지원 범위 밖 (ADR 260822-115455)',
};

const source = readFileSync(SOURCE, 'utf8');

// 클래스명이 확장명과 같다고 가정하면 안 된다 — 예: KHR_lights_punctual 의 클래스는 KHR_lights 다.
// 그래서 원문에서 실제 식별자와 모듈 경로를 그대로 파싱한다.
const BLOCK =
  /registerGLTFExtension\("([^"]+)", (true|false), async \(loader\) => \{\s*const \{ (\w+) \} = await import\("\.\/([^"]+)\.js"\);\s*return new \3\(loader\);\s*\}\);/g;

const all = [...source.matchAll(BLOCK)].map((m) => ({
  name: m[1],
  isGltf: m[2] === 'true',
  className: m[3],
  module: m[4],
}));

// 등록 호출 총 개수와 파싱 개수가 다르면 우리가 모르는 형태가 섞인 것이므로 조용히 넘기지 않는다.
// `unregisterGLTFExtension("` 가 부분 문자열로 걸리므로 앞 경계를 확인한다.
const declared = [...source.matchAll(/(?<![a-zA-Z])registerGLTFExtension\("/g)].length;
if (all.length !== declared) {
  throw new Error(
    `확장 등록 ${declared}개 중 ${all.length}개만 해석했습니다 — Babylon 의 dynamic.js 구조가 바뀐 것 같습니다: ${SOURCE}`,
  );
}

const kept = all.filter((e) => !(e.name in EXCLUDED));
const dropped = all.filter((e) => e.name in EXCLUDED);
const missing = Object.keys(EXCLUDED).filter((n) => !all.some((e) => e.name === n));
if (missing.length > 0) {
  console.warn(`경고: 제외 목록에 있으나 Babylon 에 더 이상 없는 확장 — ${missing.join(', ')}`);
}

const body = kept
  .map(
    (e) => `  registerGLTFExtension('${e.name}', ${e.isGltf}, async (loader) => {
    const { ${e.className} } = await import('@babylonjs/loaders/glTF/2.0/Extensions/${e.module}.js');
    return new ${e.className}(loader);
  });`,
  )
  .join('\n');

const excludedDoc = dropped.map((e) => ` * - \`${e.name}\` — ${EXCLUDED[e.name]}`).join('\n');

writeFileSync(
  TARGET,
  `import { registerGLTFExtension } from '@babylonjs/loaders/glTF/2.0/glTFLoaderExtensionRegistry.js';

/**
 * glTF 2.0 확장을 **선별해서** 등록한다.
 *
 * Babylon 의 \`registerBuiltInGLTFExtensions()\` 는 ${all.length}개를 전부 등록하는데, 그중 일부가
 * 외부 CDN에서 디코더나 에셋을 가져온다. 웹뷰 CSP 가 그 요청을 차단하므로 해당 확장을 쓴
 * 모델은 "원인을 알 수 없이" 실패한다. 등록하지 않으면 Babylon 이 "지원하지 않는 확장"으로
 * 명확히 보고하므로, 조용한 실패보다 낫다. (ADR 260822-115455b)
 *
 * 제외한 ${dropped.length}개:
${excludedDoc}
 *
 * 이 파일은 \`scripts/gen-gltf-extensions.mjs\` 로 생성한다 — Babylon 을 올릴 때 재생성할 것.
 */
export function registerModelLensGLTFExtensions(): void {
${body}
}
`,
);

console.log(`gltfExtensions.ts 생성 — 유지 ${kept.length} / 제외 ${dropped.length}`);
