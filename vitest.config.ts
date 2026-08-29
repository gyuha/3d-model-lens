import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 유닛 테스트만 잡는다 — e2e 는 Playwright 가 따로 돌린다.
    include: ['test/unit/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src-tauri/**', 'test/e2e/**'],
  },
});
