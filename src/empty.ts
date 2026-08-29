import { initializeHostBridge, post } from './host.js';

/**
 * [[빈 창]] 의 스크립트.
 *
 * 하는 일은 하나다 — `Open…` 을 누르면 호스트에 알린다. 드롭은 여기서 듣지 않는다:
 * 웹 DOM 의 drop 이벤트는 보안상 파일 **경로**를 주지 않으므로, 창에 떨어진 파일은 Tauri 의
 * 창 이벤트로 Rust 가 직접 받는다. 즉 창 전체가 드롭 타깃이고 이 페이지는 관여하지 않는다.
 */
void initializeHostBridge();

document.getElementById('empty-open')?.addEventListener('click', () => {
  post({ type: 'openRequested' });
});
