// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readBootConfig } from '../../src/bootConfig';

/**
 * 원본 확장의 `webviewHtml.test.ts` 자리를 대신하는 테스트.
 *
 * 그 테스트는 확장 호스트가 조립한 HTML 문자열에 설정이 제대로 박혔는지를 봤다. 이제 HTML 은
 * 정적이고 설정은 부트 시점에 주입되므로, 검사할 대상은 **주입된 값의 검증과 폴백**이다.
 */
function setInjected(config: unknown): void {
  (window as unknown as Record<string, unknown>).__MODEL_LENS_CONFIG__ = config;
}

function setSearch(search: string): void {
  window.history.replaceState(null, '', `/${search}`);
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__MODEL_LENS_CONFIG__;
  setSearch('');
});

describe('주입된 설정', () => {
  it('창이 넘긴 값을 그대로 쓴다', () => {
    setInjected({
      modelPath: '/models/bracket.stl',
      fileName: 'bracket.stl',
      pluginExtension: '.stl',
      background: 'dark',
      unitSetting: 'mm',
      decimals: 2,
      grid: false,
    });
    const config = readBootConfig();
    // Tauri 가 없는 테스트 환경에서는 변환기가 없으므로 경로가 그대로 URL 이 된다.
    expect(config.modelUri).toBe('/models/bracket.stl');
    expect(config.pluginExtension).toBe('.stl');
    expect(config.background).toBe('dark');
    expect(config.unitSetting).toBe('mm');
    expect(config.decimals).toBe(2);
    expect(config.grid).toBe(false);
  });

  it('설정 파일이 손으로 망가져도 폴백한다 — 값 검증은 부트에서 한 번 한다', () => {
    setInjected({
      modelPath: '/a.glb',
      fileName: 'a.glb',
      background: 'chartreuse',
      unitSetting: 'furlong',
      decimals: 999,
      grid: 'yes',
    });
    const config = readBootConfig();
    expect(config.background).toBe('theme');
    expect(config.unitSetting).toBe('auto');
    expect(config.decimals).toBe(10);
    expect(config.grid).toBe(true);
  });

  it('확장자는 URI 가 아니라 파일명에서 뽑는다 — asset URI 에는 쿼리가 붙는다', () => {
    setInjected({ modelPath: '/x.glb', fileName: 'x.glb' });
    expect(readBootConfig().pluginExtension).toBe('.glb');
  });

  it('모델 없이 주입되면 던진다 — 빈 창은 2of3 의 몫이고, 조용히 폴백하지 않는다', () => {
    setInjected({ fileName: 'nothing.glb' });
    expect(() => readBootConfig()).toThrow(/No model file/i);
  });
});

describe('URL 폴백 (개발 서버 · e2e)', () => {
  it('fixture 쿼리로 모델을 정한다', () => {
    setSearch('?fixture=cube.stl&unit=cm&decimals=1&grid=false');
    const config = readBootConfig();
    expect(config.modelUri).toBe('fixtures/cube.stl');
    expect(config.fileName).toBe('cube.stl');
    expect(config.pluginExtension).toBe('.stl');
    expect(config.unitSetting).toBe('cm');
    expect(config.decimals).toBe(1);
    expect(config.grid).toBe(false);
  });

  it('쿼리가 없으면 cube.glb 로 떨어진다', () => {
    const config = readBootConfig();
    expect(config.fileName).toBe('cube.glb');
    expect(config.grid).toBe(true);
    expect(config.decimals).toBe(3);
  });
});
