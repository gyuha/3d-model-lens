---
author: gyuha
decided: 2026-08-26 09:43
---
# 뷰어 패널 타이포는 테마 폰트를 쓰고, 굵기 대비는 700/400 이다 — DESIGN.md 의 300 을 따르지 않는다

`DESIGN.md`(BMW M 디자인 시스템)의 타이포 서명은 **display 700 / body 300(Light)** 의 대비이며,
문서는 이를 "the editorial signature" 라 부르고 *"Don't bold body type. Body stays at 300 —
bumping to 400 or 500 makes the page feel marketing-bombastic"* 라고 못 박는다. 대체 폰트로는
**Inter variable(700/300)** 을 지정한다.

**이 확장의 뷰어 패널에서는 셋 다 따르지 않는다.** 폰트를 번들하지 않고
`var(--vscode-font-family)` 를 그대로 쓰며, 굵기는 **700 / 400** 을 쓴다. 대비의 짐은 굵기가 아니라
**크기 · 대문자 + 1.4px 트래킹 · 색(`--vscode-editorWidget-foreground` vs `--vscode-descriptionForeground`) ·
`tabular-nums`** 넷이 진다.

## 근거 — 11px 에서 300 은 대비를 만들지 못한다

Chromium 152 / macOS, VS Code 웹뷰의 기본 폰트 스택
(`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)에서 문자열 `"Vertex snap 120.500"` 을
`font-size: 11px` 로 렌더해 폭을 쟀다.

| font-weight | 렌더 폭 | 300 대비 |
|---|---|---|
| 300 | 106.031px | — |
| 400 | 107.406px | **+1.3%** |
| 500 | 110.000px | +3.7% |
| 700 | 115.234px | **+8.7%** |

네 굵기 모두 서로 다르게 렌더된다 — 즉 300 이 400 으로 폴백되는 문제가 아니다. 문제는 **300 과
400 의 차이가 1.3% 로 육안 식별 불가**라는 것이다. 실질적인 굵기 대비를 만드는 것은 오직 700 이며,
300 을 고르면 **대비는 얻지 못한 채 11px 다크 배경에서 획만 가늘어진다.** DESIGN.md 가 300 을 지정한
자리는 16px 마케팅 본문(`typography.body-md`)이지 11px UI 칩이 아니다.

폰트 번들(Inter)을 기각한 이유는 별개다: 11px 에서 Inter 와 SF Pro / Segoe UI 를 구별할 수 없는데,
vsix 는 커지고(현재 2.43 MB) CSP 에 `font-src` 를 열어야 하며 VS Code UI 관례에서도 벗어난다.
**비용은 확실하고 이득은 육안으로 확인 불가**다. 브랜드 신호는 이미 형태(각진 실루엣 · 대문자
트래킹 · M 스트라이프)가 지고 있다.

이 표를 여기 박아 두는 이유는 되돌리기가 어려워서가 아니라 — 굵기값은 언제든 바꿀 수 있다 —
**다음 사람이 DESIGN.md 를 읽고 "300 이어야 하는데" 라며 고치려 들 것이기 때문이다.**
ADR `260822-195326` 의 순백 배경 표와 같은 이유이며, 같은 요구를 한다: **고치려면 먼저 다시 재라.**

## Consequences

- **측정 범위는 macOS 스택이다.** Windows 의 Segoe UI Light(300)는 재지 못했다 — Segoe UI 는 Light
  컷이 별도로 있어 300 이 더 뚜렷할 수 있다. 다만 결론은 바뀌지 않는다: 가늘수록 11px 가독성은
  나빠진다. Windows 에서 재보고 싶다면 위와 같은 방식으로 재고, 결과를 이 표에 덧붙여라.
- **DESIGN.md 의 나머지 형태 규칙은 그대로 따른다** — `rounded.none`(0px) 기본, 대문자 라벨의
  1.5px 급 트래킹, M 트라이컬러의 브랜드 전용 사용. 이 ADR 이 이탈하는 것은 **폰트 패밀리와
  굵기값 두 가지뿐**이다.
