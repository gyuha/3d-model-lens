import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_MODES,
  backgroundColorFor,
  isBackgroundMode,
  type BackgroundMode,
} from '../../src/background';

describe('BACKGROUND_MODES', () => {
  it('세 가지 모드를 이 순서로 노출한다 — 설정 enum 과 패널 드롭다운이 같은 순서를 쓴다', () => {
    expect(BACKGROUND_MODES).toEqual(['theme', 'light', 'dark']);
  });
});

describe('isBackgroundMode', () => {
  it('세 모드를 통과시킨다', () => {
    for (const mode of BACKGROUND_MODES) {
      expect(isBackgroundMode(mode), mode).toBe(true);
    }
  });

  it('그 밖의 값은 전부 거부한다 — 설정 파일에 손으로 아무 문자열이나 넣을 수 있다', () => {
    for (const bad of ['', 'Theme', 'auto', '#ffffff', null, undefined, 0, {}, ['light']]) {
      expect(isBackgroundMode(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('backgroundColorFor', () => {
  it('theme 은 색을 정하지 않는다 — CSS 의 --vscode-editor-background 를 그대로 두라는 뜻이다', () => {
    expect(backgroundColorFor('theme')).toBeNull();
  });

  /**
   * 순백이다. 밝은 회색이 아니다 — 기본 머티리얼이 이미 0.78 회색이라 배경을 회색으로
   * 낮출수록 모델과 가까워진다. 측정표는 ADR `260822-195326` 에 있다.
   */
  it('light 는 순백이다', () => {
    expect(backgroundColorFor('light')).toBe('#ffffff');
  });

  it('dark 는 VS Code Dark Modern 의 editor.background 와 같다', () => {
    expect(backgroundColorFor('dark')).toBe('#1f1f1f');
  });

  it('모든 모드에 대해 정의되어 있다 — 새 모드를 추가하면 여기서 걸린다', () => {
    for (const mode of BACKGROUND_MODES) {
      const color = backgroundColorFor(mode);
      expect(color === null || /^#[0-9a-f]{6}$/.test(color), mode).toBe(true);
    }
  });
});

describe('BackgroundMode 타입', () => {
  it('BACKGROUND_MODES 의 원소가 곧 타입이다', () => {
    const mode: BackgroundMode = 'light';
    expect(BACKGROUND_MODES).toContain(mode);
  });
});
