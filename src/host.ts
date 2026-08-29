import type { WebviewToHost } from './messages.js';

/**
 * 뷰어가 앱 셸과 말하는 유일한 지점.
 *
 * 원본 확장에서는 이 자리가 `acquireVsCodeApi()` 였다. 여기서는 두 구현이 붙는다.
 *   - Tauri 창 안 — `emit` 으로 Rust 에 보내고, Rust 가 보낸 것은 `window.postMessage` 로
 *     중계된다(`initializeHostBridge`). 중계하는 이유는 뷰어 코드가 이미
 *     `window.addEventListener('message')` 로 호스트 메시지를 받고 있어서, 그 경로를
 *     건드리지 않는 것이 가장 적은 변경이기 때문이다.
 *   - 브라우저(개발 서버 · e2e) — `uat:tohost` CustomEvent 로 흘린다. 원본 UAT 하니스가
 *     쓰던 계약과 같으므로 e2e 헬퍼(`collectHostMessages`)가 그대로 붙는다.
 *
 * `getState`/`setState` 에 해당하는 것은 **없다**. 창이 파괴되지 않으므로 복원할 대상이
 * 없기 때문이다 (ADR 260829-143640a).
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 파일 경로를 뷰어가 fetch 할 수 있는 asset URL 로 바꾼다.
 *
 * 형식이 플랫폼마다 다르므로(`asset://localhost/...` vs `http://asset.localhost/...`)
 * 직접 조립하지 않고 Tauri 가 주입한 변환기를 쓴다. `@tauri-apps/api` 를 정적으로 끌어오지
 * 않는 이유는 이 함수가 브라우저(개발 서버 · e2e)에서도 호출되기 때문이다 — 그쪽에서는
 * 경로가 곧 URL 이다.
 */
export function toAssetUrl(filePath: string): string {
  const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
    | { convertFileSrc?: (path: string, protocol: string) => string }
    | undefined;
  return internals?.convertFileSrc?.(filePath, 'asset') ?? filePath;
}

let emitToHost: ((message: WebviewToHost) => void) | undefined;

export function post(message: WebviewToHost): void {
  if (emitToHost) {
    emitToHost(message);
    return;
  }
  window.dispatchEvent(new CustomEvent('uat:tohost', { detail: message }));
}

/**
 * Tauri 환경에서만 실제 채널을 연다. 실패해도 뷰어는 계속 뜬다 — 셸과 말하지 못할 뿐
 * 모델을 보는 일은 그대로 되는 편이, 창이 통째로 비는 것보다 낫다.
 */
export async function initializeHostBridge(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    const { emit, listen } = await import('@tauri-apps/api/event');
    emitToHost = (message) => void emit('viewer-to-host', message);
    // 시간 제한을 둔다 — IPC 가 조용히 응답하지 않을 때 `listen` 은 거부되지 않고 영원히
    // 매달린다. 그 경우 "채널 없이 사는 것"이 "영원히 기다리는 것"보다 낫다.
    await Promise.race([
      listen('host-to-viewer', (event) => {
        window.postMessage(event.payload, '*');
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('IPC 응답 없음 (5s)')), 5000),
      ),
    ]);
  } catch (error) {
    console.warn('호스트 브리지를 열지 못했습니다 — 뷰어는 계속 동작합니다.', error);
  }
}
