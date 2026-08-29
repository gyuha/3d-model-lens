import { defineConfig, type PluginOption } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 개발 서버 · e2e 가 함께 쓰는 포트. 원본 UAT 하니스가 쓰던 값이라 e2e 스펙이 그대로 붙는다. */
const PORT = 39177;

const stub = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

/**
 * 개발·미리보기 서버에도 앱과 **같은 CSP** 를 응답 헤더로 붙인다.
 *
 * 원본 확장에서는 UAT 하니스(`scripts/uat-serve.mjs`)가 이 일을 했다. 목적은 하나다 —
 * 외부 요청이 실제로 차단되는지를 브라우저에서 확인할 수 있어야 한다. 값을 여기 적지 않고
 * `tauri.conf.json` 에서 읽는 이유는, 두 곳이 어긋나면 e2e 가 앱과 다른 정책을 검증하게 되기
 * 때문이다.
 */
function cspHeader(): PluginOption {
  const conf = JSON.parse(
    readFileSync(fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
  ) as { app: { security: { csp: string } } };
  const csp = conf.app.security.csp;
  const attach = (server: { middlewares: { use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }): void => {
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', csp);
      next();
    });
  };
  return {
    name: 'model-lens-csp-header',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  // Tauri 는 이 산출물을 그대로 싣는다. 상대 경로여야 asset 프로토콜에서 해결된다.
  base: './',
  plugins: [cspHeader()],
  // 127.0.0.1 로 못 박는다 — macOS 에서 localhost 는 ::1 로 먼저 풀려 e2e 의 127.0.0.1 접근이 빗나간다.
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
  preview: { host: '127.0.0.1', port: PORT, strictPort: true },
  resolve: {
    /*
     * 원본 esbuild 설정의 alias 스텁을 옮긴 것 (ADR 260829-143640b).
     *
     * 노드/GUI 에디터 5종은 읽기 전용 뷰어에서 범위 밖이고, 이들을 들이면 약 10 MB 와 다수의
     * 외부 CDN URL 이 함께 딸려 온다. `@babylonjs/loaders/dynamic.js` 는 Inspector 의
     * quickCreateToolsService 가 로더 6종 + glTF 확장 42개를 전부 등록해 우리 선별 등록을
     * 런타임에 무효화하므로 no-op 으로 바꾼다.
     *
     * **정규식으로 정확히 일치시킨다** — Vite 의 문자열 alias 는 접두사 매칭이라
     * `@babylonjs/node-editor` 가 하위 경로까지 삼켜 버린다. esbuild 의 alias 는 패키지 이름
     * 정확 매칭이었으므로 여기서도 그 의미를 지킨다.
     */
    alias: [
      { find: /^@babylonjs\/loaders\/dynamic\.js$/, replacement: stub('./src/webview/noopLoaderRegistration.ts') },
      { find: /^@babylonjs\/node-editor$/, replacement: stub('./src/webview/unsupportedEditor.ts') },
      { find: /^@babylonjs\/node-geometry-editor$/, replacement: stub('./src/webview/unsupportedEditor.ts') },
      { find: /^@babylonjs\/node-particle-editor$/, replacement: stub('./src/webview/unsupportedEditor.ts') },
      { find: /^@babylonjs\/node-render-graph-editor$/, replacement: stub('./src/webview/unsupportedEditor.ts') },
      { find: /^@babylonjs\/gui-editor$/, replacement: stub('./src/webview/unsupportedEditor.ts') },
    ],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // 산출물 검사(check:bundle)가 소스맵의 원본 문자열까지 훑지 않도록 끈다.
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    // 빈 창은 별도 문서다 — 모델이 없는 창은 뷰어를 아예 만들지 않으므로 Babylon 을
    // 내려받을 이유가 없고, main.ts 의 동기 부트 경로를 분기로 더럽히지도 않는다.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        empty: fileURLToPath(new URL('./empty.html', import.meta.url)),
      },
    },
    /*
     * Inspector chunk 에 이름을 붙이려고 `rollupOptions.output.manualChunks` 를 넣어 봤으나
     * **되돌렸다**. 함수형 manualChunks 는 Vite 의 기본 분할 전략을 통째로 대체해서,
     * Inspector chunk 가 3.37 MB -> 5.15 MB 로 커지고 진입점이 잘게 쪼개졌다. 이름을 얻는
     * 대가로 분할 품질을 잃는 거래다. 분리 자체는 동적 `import()` 가 이미 해내므로,
     * 검증은 이름이 아니라 **내용**으로 한다 (scripts/check-inspector-split.mjs).
     */
  },
});
