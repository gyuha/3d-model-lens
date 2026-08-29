/**
 * 뷰어 배경 모드 — 모델이 놓인 바탕의 색을 결정하는 세 값.
 *
 * `theme` 은 VS Code 편집기 배경색을 따라가고, 나머지 둘은 그것과 무관하게 고정한다.
 * 모델의 색이 아니라 바탕의 색이며, 사람 단위로 정해지는 값이다 — 그래서 파일별이 아니라
 * 전역 설정에 저장한다 (단위와 반대 판단이다. ADR `260822-115455c` 와 대비).
 */

export const BACKGROUND_MODES = ['theme', 'light', 'dark'] as const;

export type BackgroundMode = (typeof BACKGROUND_MODES)[number];

export function isBackgroundMode(value: unknown): value is BackgroundMode {
  return typeof value === 'string' && (BACKGROUND_MODES as readonly string[]).includes(value);
}

/**
 * 이 모드가 강제하는 배경색. `null` 이면 색을 정하지 않는다는 뜻이고, 그때는 CSS 의
 * `--ml-bg` 가 그대로 보인다 — 그것이 앱 테마(OS 라이트/다크)를 따른다.
 *
 * **`light` 는 순백이다 — 밝은 회색이 아니다.** "3D 뷰어는 순백보다 밝은 회색"이라는 통념은
 * 이 프로젝트에서 틀렸다. 기본 머티리얼(`chrome.ts` 의 `baseColor(0.78,0.78,0.8)`)이 이미 밝은
 * 회색이라 배경을 낮출수록 모델과 가까워진다. 고치려 들기 전에 ADR `260822-195326` 의 측정표를
 * 읽고, 다시 재라.
 *
 * 두 값 모두 VS Code Light / Dark Modern 의 `editor.background` 와 같다 — 그래서 라이트 테마
 * 사용자에게는 `theme` 와 `light` 가 같은 결과가 되어 혼란이 없다.
 */
export function backgroundColorFor(mode: BackgroundMode): string | null {
  switch (mode) {
    case 'light':
      return '#ffffff';
    case 'dark':
      return '#1f1f1f';
    case 'theme':
      return null;
  }
}
