// Inspector 가 초기 번들에 섞이지 않았는지 검사한다 (`npm run check:split`).
//
// 원본 확장의 esbuild 설정은 chunk 이름을 보존해서 산출물 목록만 봐도 판정이 됐지만,
// Rollup 은 동적 import chunk 의 이름을 진입 모듈 파일명에서 따오므로 `index-<hash>.js` 가
// 된다. 이름을 강제하는 길(`manualChunks`)은 분할 품질을 망가뜨려 되돌렸다 —
// 그래서 판정을 **이름이 아니라 내용**으로 한다 (ADR 260829-143640b).
//
// 지표는 FluentUI / griffel 이다. Inspector 는 React + FluentUI 로 만들어졌고 뷰어 본체는
// 그 어느 것도 쓰지 않으므로, 초기 chunk 에서 이 문자열이 보이면 곧 "Inspector 가 딸려 왔다"는 뜻이다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
const INSPECTOR_MARKERS = /griffel|FluentProvider|makeStyles/;

const html = read(join(DIST, 'index.html'), 'dist/index.html 이 없습니다 — 먼저 `npm run build`.');
const entries = [...html.matchAll(/<script[^>]+src="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const initial = [...new Set([...entries, ...preloads])];

if (initial.length === 0) {
  fail('index.html 이 참조하는 진입 스크립트를 찾지 못했습니다 — 검사가 무의미합니다.');
}

const problems = [];

// 1) 초기에 로드되는 파일들의 총량.
let initialBytes = 0;
for (const rel of initial) {
  initialBytes += statSync(join(DIST, rel)).size;
}
if (initialBytes > MAX_ENTRY_BYTES) {
  problems.push(
    `초기 로드가 ${mb(initialBytes)} 로 상한 ${mb(MAX_ENTRY_BYTES)} 를 넘었습니다 — ` +
      `Inspector 나 그에 준하는 무거운 의존이 초기 경로로 들어왔는지 보세요.`,
  );
}

// 2) 초기 파일에 Inspector 지표가 있으면 분리가 깨진 것이다.
const contaminated = initial.filter((rel) => INSPECTOR_MARKERS.test(readFileSync(join(DIST, rel), 'utf8')));
if (contaminated.length > 0) {
  problems.push(
    `초기 chunk 에 Inspector(FluentUI/griffel)가 섞였습니다: ${contaminated.join(', ')}\n` +
      `    → 동적 import 경계가 깨졌습니다. inspector.ts 의 \`await import()\` 를 확인하세요.`,
  );
}

// 3) Inspector 는 어딘가 별도 chunk 로 **존재해야** 한다 — 아예 없으면 alias 스텁이
//    과하게 잘라낸 것이고, 그러면 Inspector 기능 자체가 죽는다.
const all = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'));
const holders = all.filter((f) => INSPECTOR_MARKERS.test(readFileSync(join(DIST, 'assets', f), 'utf8')));
if (holders.length === 0) {
  problems.push('Inspector 를 담은 chunk 가 하나도 없습니다 — Inspector 가 통째로 빠졌습니다.');
}

if (problems.length > 0) {
  fail(problems.join('\n  '));
}

console.log(
  `Inspector 분리 검사 통과 — 초기 로드 ${initial.length}개 ${mb(initialBytes)} (Inspector 지표 0건), ` +
    `Inspector chunk ${holders.length}개 (최대 ${mb(Math.max(...holders.map((f) => statSync(join(DIST, 'assets', f)).size)))}).`,
);

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}
function read(path, message) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    fail(message);
  }
}
function fail(message) {
  console.error(`Inspector 분리 검사 실패:\n  ${message}`);
  process.exit(1);
}
