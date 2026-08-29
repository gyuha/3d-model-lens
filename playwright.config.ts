import { defineConfig } from '@playwright/test';

const PORT = 39177;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './test/e2e',
  // 3D 로딩과 Inspector chunk 로드는 소프트웨어 렌더링에서 느리다.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    // 실패 시 원인을 알 수 있는 아티팩트를 남긴다.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      // 헤드리스에서 WebGL2 를 쓰려면 소프트웨어 래스터라이저를 명시해야 한다.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-lcd-text',
      ],
    },
  },
  webServer: {
    // 빌드 산출물을 그대로 서빙한다 — alias 스텁과 Inspector chunk 분리가 실제로 반영된
    // 번들을 검사해야 의미가 있다 (ADR 260829-143640b).
    command: 'npm run preview',
    url: `${BASE_URL}/?fixture=cube.glb`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
