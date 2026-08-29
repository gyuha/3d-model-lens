// 빌드 산출물이 외부 네트워크에 의존하지 않는지 검사한다 (`npm run check:bundle`).
//
// 원래 계획의 DoD 는 "번들에 assets.babylonjs.com 문자열이 0건"이었으나 Babylon 9 에서는
// 달성 불가하다 — `Tools._DefaultCdnUrl` / `_DefaultAssetsUrl` 이 `Tools` 의 정적 필드이고
// `Scene`·`Engine` 이 모두 `Tools` 에 의존한다. 문자열의 존재는 도달 가능성을 뜻하지 않는다.
// (ADR 260822-115455b 개정 참조)
//
// 런타임 불변식("외부 요청 0건")은 세 겹으로 지킨다.
//   (1) 웹뷰 CSP `default-src 'none'` — 구조적 차단. 본체.
//   (2) `src/webview/offline.ts` — AssetBaseUrl 로컬 치환 + KTX2 URLConfig null.
//   (3) CDN 의존 glTF 확장 미등록(`gltfExtensions.ts`) + 노드/GUI 에디터 스텁 치환(esbuild alias).
//
// 이 스크립트는 그 위에서 **정적 드리프트 가드**를 담당한다.
//   A. 금지 모듈이 번들에 없음 — 우리가 통제 가능한 부분.
//   B. 번들이 참조하는 **외부 호스트 집합**이 허용 목록과 정확히 일치 — 새 외부 서비스 의존이
//      들어오면 빌드가 깨진다.
//
// 입도를 URL 이 아니라 **호스트**로 잡은 이유: Babylon Inspector 는 기능마다 자기 에셋 URL 을
// 갖는 개발 도구여서 URL 을 열거하면 47개가 되고 업그레이드마다 흔들린다. 반면 진짜 위험 신호는
// "이미 검토한 호스트의 새 경로"가 아니라 **"새 외부 서비스"** 다. 새 경로는 이미 (1)(2)가 덮는다.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** 등록/번들하지 않기로 한 모듈 — 번들에 아예 없어야 한다. */
const FORBIDDEN_MODULES = [
  // CDN 의존 또는 범위 밖 glTF 확장 (gltfExtensions.ts)
  'EXT_lights_area',
  'EXT_meshopt_compression',
  'KHR_draco_mesh_compression',
  'KHR_texture_basisu',
  'KHR_interactivity',
  'MSFT_audio_emitter',
  'KHR_gaussian_splatting',
  'KHR_materials_fuzz',
  // 읽기 전용 뷰어에서 범위 밖인 노드/GUI 에디터 (esbuild alias 로 스텁 치환)
  'babylon.nodeEditor',
  'babylon.nodeGeometryEditor',
  'babylon.nodeParticleEditor',
  'babylon.nodeRenderGraphEditor',
  'babylon.guiEditor',
];

/**
 * 번들이 참조해도 되는 외부 호스트. 각 항목은 분류와 근거를 갖는다.
 *   link            — UI 텍스트/에러 메시지 안의 href. 네트워크 요청이 아니다.
 *   asset-rewritten — 런타임에 로컬로 치환된다 (offline.ts 의 Tools.AssetBaseUrl).
 *   asset-blocked   — 우리가 쓰지 않는 기능의 에셋. 웹뷰 CSP 가 차단하므로 요청이 나가지 않는다.
 *   namespace       — XML 네임스페이스 식별자. URL 처럼 보이지만 절대 fetch 되지 않는다.
 */
const ALLOWED_HOSTS = {
  'http://www.w3.org': ['namespace', 'SVG/XML 네임스페이스 식별자.'],
  'https://doc.babylonjs.com': ['link', 'Babylon 문서 링크.'],
  'https://forum.babylonjs.com': ['link', 'Babylon 포럼 링크.'],
  'https://github.com': ['link', '이슈/레포 링크 (Babylon, griffel).'],
  'https://react.dev': ['link', 'React 에러 코드 해설 링크.'],
  'https://www.npmjs.com': ['link', 'npm 패키지 링크 (경고 메시지).'],
  'https://aka.ms': ['link', 'FluentUI(griffel) 경고 문서 링크.'],
  'https://academysoftwarefoundation.github.io': [
    'link',
    'OpenEXR / ACES 색공간 스펙 참조 — EXR 로더와 색공간 코드의 주석·문자열.',
  ],
  'https://www.babylonjs.com': [
    'asset-blocked',
    'Inspector UI 의 로고 이미지 + 링크. CSP img-src 가 차단해 Inspector 안에서 이미지 하나가 비어 보인다 — 수용한 외형 손실, 기능 손실 없음.',
  ],
  'https://fabricweb.azureedge.net': [
    'asset-blocked',
    'FluentUI 색상 피커의 투명도 격자 이미지. 위와 같다.',
  ],
  'https://cdn.jsdelivr.net': [
    'asset-blocked',
    'Inspector 의 GIF 녹화 기능이 쓰는 gif.js. 뷰어 기능이 아니고 CSP 가 차단한다.',
  ],
  'https://snippet.babylonjs.com': [
    'asset-blocked',
    'Inspector 의 스니펫 저장/불러오기. 뷰어 기능이 아니고 CSP 가 차단한다.',
  ],
  'https://unpkg.com': [
    'asset-blocked',
    'EXR 로더의 fflate. glTF/GLB/STL 경로에 .exr 텍스처는 나타날 수 없다.',
  ],
  'https://cdn.babylonjs.com': [
    'asset-blocked',
    'Tools._DefaultCdnUrl 정적 필드 · KTX2 트랜스코더 · glTF 검증기. offline.ts / inspector.ts 가 각각 끊고, LoadScript 계열을 호출하지 않는다.',
  ],
  'https://assets.babylonjs.com': [
    'asset-rewritten',
    'Tools._DefaultAssetsUrl. `/core/` 경로는 offline.ts 의 AssetBaseUrl 이 확장의 로컬 media/ 로 치환한다. 그 밖의 경로(fonts · textures · particles)는 우리가 쓰지 않는 Inspector 기능의 에셋이고 CSP 가 차단한다.',
  ],
};

let files;
try {
  files = collect(DIST);
} catch (error) {
  fail(`산출물 디렉터리를 읽을 수 없습니다: ${DIST} — 먼저 \`npm run build\` 를 실행하세요. (${error.message})`);
}
if (files.length === 0) {
  fail(`검사할 산출물이 없습니다: ${DIST} — 먼저 \`npm run build\` 를 실행하세요.`);
}

const problems = [];

// A. 금지 모듈.
//
// 판정은 **chunk 파일명**으로만 한다. 본문 문자열 검색은 오탐을 낸다 — 예컨대
// `NodeMaterial.EditorURL` 은 `.../nodeEditor/babylon.nodeEditor.js` 라는 **정적 설정
// 문자열**을 갖고 있어서, 모듈이 번들에 없어도 본문 검색에는 걸린다.
// 여기 금지한 모듈은 모두 동적 import 대상이므로 번들되면 반드시 자기 이름의 chunk 가 생긴다.
for (const name of FORBIDDEN_MODULES) {
  const hits = files.filter((f) => f.path.includes(name));
  if (hits.length > 0) {
    problems.push(
      `금지 모듈이 번들에 있습니다: ${name}\n    → ${hits
        .slice(0, 3)
        .map((h) => h.path)
        .join(', ')}${hits.length > 3 ? ` (외 ${hits.length - 3}개)` : ''}`,
    );
  }
}

// B. 외부 호스트 드리프트
const hosts = new Map();
for (const file of files) {
  for (const match of file.text.matchAll(/https?:\/\/[a-zA-Z0-9._-]+/g)) {
    const host = match[0];
    if (!hosts.has(host)) {
      hosts.set(host, file.path);
    }
  }
}
const unexpected = [...hosts.entries()].filter(([host]) => !(host in ALLOWED_HOSTS)).sort();
if (unexpected.length > 0) {
  problems.push(
    `허용 목록에 없는 외부 호스트가 번들에 있습니다 — 새 외부 서비스 의존인지 확인하고, 분류와 근거를 적어 허용 목록에 넣거나 의존을 제거하세요:\n${unexpected
      .map(([host, where]) => `    - ${host}   (예: ${where})`)
      .join('\n')}`,
  );
}
const stale = Object.keys(ALLOWED_HOSTS).filter((host) => !hosts.has(host));

if (problems.length > 0) {
  fail(problems.join('\n  '));
}

const byKind = {};
for (const host of hosts.keys()) {
  const kind = ALLOWED_HOSTS[host][0];
  byKind[kind] = (byKind[kind] ?? 0) + 1;
}
console.log(
  `번들 검사 통과 — 파일 ${files.length}개, 외부 호스트 ${hosts.size}개 모두 허용 목록에 있음 ` +
    `(${Object.entries(byKind)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')}).`,
);
if (stale.length > 0) {
  console.log(
    `참고: 허용 목록에 있으나 번들에 더 이상 없는 호스트 ${stale.length}개 — 정리 가능: ${stale.join(', ')}`,
  );
}

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collect(full));
    } else if (entry.name.endsWith('.js')) {
      out.push({ path: full.slice(ROOT.length + 1), text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

function fail(message) {
  console.error(`번들 검사 실패:\n  ${message}`);
  process.exit(1);
}
