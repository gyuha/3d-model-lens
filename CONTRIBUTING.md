# 기여 안내

## 구조

```
index.html · empty.html   두 진입 문서 — 모델이 있는 창과 빈 창
src/
  webview/                뷰어 본체. VS Code 확장에서 이식했고 순수 브라우저 코드다
  style.css               색 토대(--ml-*)와 형태. OS 라이트/다크를 따른다
  bootConfig.ts           창이 열릴 때 받는 설정. Tauri 주입 또는 URL 쿼리(개발·e2e)
  host.ts                 앱 셸과 말하는 유일한 지점
src-tauri/
  src/lib.rs              창 · 메뉴 · 파일 진입 · 메시지
  src/settings.rs         설정 저장소 (JSON · 단위 기억 LRU · 최근 파일)
```

뷰어는 **호스트를 모른다.** 아는 것은 `host.ts` 의 메시지 두 방향뿐이고, 그래서 브라우저에서
그대로 띄워 e2e 로 검증할 수 있다.

## 검증 — 세 층

```sh
npm test           # 단위 (vitest) — 순수 로직과 부트 설정
npm run test:rust  # 설정 저장소 (cargo) — 단위 기억 LRU · 값 검증
npm run test:e2e   # 브라우저 e2e (playwright) — 실제 렌더 · 측정 · 카메라
npm run check:bundle   # 산출물에 금지 모듈이 없고 외부 호스트가 허용 목록과 일치하는지
npm run check:split    # Inspector 가 초기 번들에 섞이지 않았는지
```

**e2e 는 Tauri 가 아니라 브라우저에서 돈다.** 뷰어 로직의 대부분을 여기서 잡을 수 있지만,
메뉴 · 파일 대화상자 · asset 프로토콜 같은 **Tauri 경계는 잡지 못한다** — 그쪽은 앱을 띄워
직접 확인해야 한다. 실제로 그 틈에서 결함이 한 번 새어 나갔다(`.forge/done/` 의 기록 참조).

## Babylon 은 조용히 죽는다

이 프로젝트가 네 번 밟은 함정이다. side-effect import 가 빠지거나 기능이 비활성화돼도
**예외도 실패 반환도 없다.** 증상이 "그 기능이 애초에 없는 것"과 구별되지 않는다. 그래서

- 렌더를 건드리는 e2e 는 **콘솔 경고까지 함께 본다**(`collectConsoleProblems`).
- 디버그 빌드는 개발자 도구를 자동으로 연다 — 콘솔이 없으면 "빈 화면"과 "기능 없음"을
  구별할 수 없다.

자세한 사정은 `.forge/adr/260822-162443-babylon-fails-silently.md` 에 있다.

## 결정 기록

`.forge/adr/` 에 있다. 코드가 왜 그 모양인지 궁금하면 거기부터 본다 — 특히
내비게이션 큐브를 SVG 로 그린 이유, 카메라가 쿼터니언을 쓰는 이유, 색이 테마를 따르는 이유는
전부 되돌리기 어려운 결정이라 문서로 남겼다.

용어는 `.forge/CONTEXT.md` 에 있다. **치수**와 **측정**, **뷰어 세션**과 창처럼 서로 비슷해
보이지만 다른 것들을 구별해 쓴다.
