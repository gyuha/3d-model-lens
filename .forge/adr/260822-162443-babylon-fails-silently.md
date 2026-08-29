---
author: gyuha
decided: 2026-08-22 16:24
---
# Babylon 9 는 기능이 죽어도 예외를 던지지 않는다 — 그래서 이 코드들이 있다

이 프로젝트에서 **같은 부류의 함정을 네 번 밟았다.** 공통점은 하나다: Babylon 의 기능이
동작하지 않는데 **예외도, 실패 반환도 없다.** 증상이 "그 기능이 애초에 없는 것"과 구별되지 않아,
매번 원인을 찾는 데 비용이 컸다.

| 증상 | 원인 | 대응 |
|---|---|---|
| glTF 의 PBR 이 검게 뜸 (IBL 미적용) | `engine.pure` 를 import 해 `engine.prefilteredCubeTexture` 확장이 등록되지 않음 | `@babylonjs/core/Engines/engine.js` (side-effect 포함)를 import |
| `scene.debugLayer.show()` 가 아무 일도 안 함 | `debugLayer` side-effect 미등록, `_getGlobalInspector()` 는 전역만 보고 CDN 폴백도 없음 | `scene.debugLayer` 를 우회하고 `ShowInspector()` 를 직접 호출 |
| `scene.pick()` 이 항상 빈 결과 (캔버스 전체에서 hit 0) | `Culling/ray` side-effect 미등록. `pick()` 이 `_WarnImport("Ray")` 만 찍고 빈 `PickingInfo` 를 돌려주는 스텁이었다 | `import '@babylonjs/core/Culling/ray.js'` |
| 유휴 렌더 중단 후 드래그가 화면을 되살리지 못함 (교착) | `ArcRotateCamera` 가 `scene.render()` **안의** `_checkInputs()` 에서 입력을 처리한다 — 그리지 않으면 입력을 읽지 않고, 그래서 dirty 가 서지 않고, 그래서 영원히 그리지 않는다 | 캔버스의 DOM 입력 이벤트를 wake 소스로 씀 |

앞의 셋은 **"side-effect import 를 빠뜨리면 조용히 무력화"**, 넷째는 **"렌더를 건너뛰면 렌더
안에서 일어나던 일이 조용히 멈춘다"** 다. 표면은 다르지만 원리는 같다.

## 결정

1. **아래 코드들은 지우면 안 된다.** 겉보기에 쓰이지 않는 import 와 우회로처럼 보이지만, 각각
   위 표의 함정을 막고 있다. 정리하려는 시도가 반복될 수 있으므로 여기에 못 박는다.
   - `src/webview/viewer.ts` 의 `import '@babylonjs/core/Engines/engine.js'`
   - `src/webview/measurement.ts` 의 `import '@babylonjs/core/Culling/ray.js'`
   - `src/webview/inspector.ts` 가 `scene.debugLayer` 대신 `ShowInspector()` 를 쓰는 것
   - `src/webview/viewer.ts` 의 캔버스 DOM 입력 리스너(`pointerdown`/`up`/`cancel`/`move`/`wheel`/`keydown`)
2. **Babylon 기능이 "동작은 하는데 효과가 없을" 때의 점검 순서**: (a) 콘솔의 `Logger.Warn` 을
   **먼저** 읽는다 — Babylon 은 대개 여기에 단서를 남긴다. (b) side-effect import 누락을 의심한다.
   (c) 그 동작이 우리가 건너뛰고 있는 호출 안에서 일어나는지 확인한다.
3. **e2e 는 콘솔 경고·에러를 함께 단정한다** (`collectConsoleProblems`). 조용한 무력화를 자동으로
   드러내는 유일한 장치다. 렌더링·입력 타이밍을 건드리는 테스트는 이것을 반드시 켠다.

## Consequences

- Babylon 을 업그레이드할 때 위 네 지점을 다시 확인해야 한다. `pure`/side-effect 분리는 Babylon 9
  에서 도입된 구조이므로 상위 버전에서 또 움직일 수 있다.
- **유닛 테스트로는 이 부류를 잡을 수 없다.** 넷째 사례에서 렌더 게이트 유닛 테스트 8개는 전부
  통과했다 — 게이트 로직은 옳았고 **배선이 틀렸다.** 실제 입력을 구동하는 e2e 만 잡아냈다.
