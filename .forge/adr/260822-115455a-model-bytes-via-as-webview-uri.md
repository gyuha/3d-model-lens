---
author: gyuha
decided: 2026-08-22 11:54
amended: 2026-08-29 (데스크톱 포크에서 메커니즘이 Tauri asset 프로토콜 + 런타임 scope 로 바뀐다 — "바이트가 아니라 URL" 이라는 결론과 형제 파일 근거는 그대로다)
---
# 모델 바이트는 postMessage가 아니라 `asWebviewUri`로 전달한다

웹뷰에 모델 파일을 넘기는 방법은 두 가지다. (1) 확장 호스트가 `workspace.fs.readFile`로 읽어 `postMessage`로 바이트를 보내거나, (2) `webview.asWebviewUri(fileUri)`로 URL을 만들어 Babylon `SceneLoader`가 직접 fetch하게 하거나. **(2)를 택했다.** 이유는 형제 파일이다 — `.gltf`는 외부 `.bin`과 텍스처를 상대 경로로 참조하고, (1)에서는 이를 위해 요청/응답 프로토콜을 직접 구현해야 하는데 (2)에서는 상대 URL이 그냥 해결된다. 대용량 파일에서 메시지 채널 복사 비용도 없다.

## Consequences

- `localResourceRoots`를 에디터마다 동적으로 `[extensionUri, 워크스페이스 폴더(있으면), path.dirname(파일)]`로 설정해야 한다. 참고 레포가 이걸 안 해서 "워크스페이스 밖 파일을 열면 빈 화면"이라는 버그를 FAQ로 문서화해 놨다 — 우리는 처음부터 안 만든다.
- `../textures/`처럼 **상위 디렉터리**를 참조하는 모델은 여전히 실패할 수 있다. 이는 **의도된 한계**로 문서화하고 놔둔다. 파일 시스템 루트를 `localResourceRoots`로 열어주는 것이 더 나쁘다.
- CSP에 `connect-src ${webview.cspSource}`가 필수다. Babylon이 XHR로 모델과 `.bin`을 가져오기 때문에 이걸 빠뜨리면 로드가 조용히 실패한다.
- 웹뷰 URI에는 쿼리스트링이 붙어 Babylon의 확장자 스니핑이 어긋날 수 있다. 로드 시 원본 확장자를 `pluginExtension`으로 **명시적으로** 넘긴다.
