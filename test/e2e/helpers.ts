import { expect, type Page, type Request } from '@playwright/test';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 뷰어가 로드를 끝낼 때까지 기다린다. `error` 면 그대로 돌려주므로 호출부가 판단한다.
 *
 * `tab` 을 주면 로드 후 그 탭을 연다. 패널은 Measure 탭이 열린 채로 시작하므로 Display /
 * Debug 안의 컨트롤을 만지는 테스트는 이것을 줘야 한다 — 닫힌 탭 안의 요소는 클릭할 수 없다.
 */
export async function waitForViewer(
  page: Page,
  options: { tab?: PanelTab } = {},
): Promise<'ready' | 'error'> {
  const state = await page
    .locator('#root[data-state]')
    .getAttribute('data-state', { timeout: 60_000 });
  if (state === 'error') {
    return 'error';
  }
  if (options.tab) {
    await openTab(page, options.tab);
  }
  return 'ready';
}

/** 뷰어 패널의 탭. 애니메이션은 탭이 아니라 고정 행이므로 여기 없다. */
export const PANEL_TABS = ['measure', 'display', 'debug'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * 이 탭이 열려 있음을 단정한다.
 *
 * `getAttribute` 로 한 번 읽지 않는 이유: 탭은 호스트 메시지(`setMeasureMode`)로도 바뀌는데
 * 그 처리는 비동기다. 한 번 읽으면 메시지가 처리되기 전에 읽어 **간헐적으로** 실패한다.
 * `expect().toHaveAttribute` 는 조건이 맞을 때까지 재시도한다.
 */
export async function expectActiveTab(page: Page, name: PanelTab): Promise<void> {
  await expect(page.locator(`#tab-${name}`)).toHaveAttribute('aria-selected', 'true');
  for (const other of PANEL_TABS.filter((tab) => tab !== name)) {
    await expect(page.locator(`#tab-${other}`)).toHaveAttribute('aria-selected', 'false');
  }
}

/**
 * 탭 하나를 연다.
 *
 * 아코디언 시절의 `expandAllSections` 를 대신한다 — 탭은 한 번에 하나만 열리므로 "전부 펼치기"
 * 라는 것이 없다. 그래서 컨트롤을 만지는 테스트는 그 컨트롤이 사는 탭을 **직접 말해야** 한다
 * (`waitForViewer(page, { tab: 'display' })`).
 */
export async function openTab(page: Page, name: PanelTab): Promise<void> {
  await page.locator(`#tab-${name}`).click();
}

export async function extents(page: Page): Promise<[number, number, number]> {
  const raw = await page.locator('#root').getAttribute('data-extents');
  return JSON.parse(raw ?? '[]') as [number, number, number];
}

/**
 * 캔버스를 훑어 "정점 → 그 정점으로 스냅되는 대표 픽셀" 맵을 만든다.
 *
 * 카메라 방향을 가정하지 않기 위한 장치다. 각 정점의 대표 픽셀은 **모델의 화면 중심에 가장
 * 가까운** 것으로 고른다 — 실루엣 경계를 피해 면 안쪽을 찍게 하려는 것이다(경계를 찍으면
 * 광선이 모델을 비켜 갈 수 있다).
 */
export async function vertexTargets(
  page: Page,
  step = 4,
): Promise<{ vertex: Point3; screen: { x: number; y: number } }[]> {
  return page.evaluate((gridStep: number) => {
    const seam = (window as unknown as { __modelLens: { probeAt: (x: number, y: number) => Point3 | undefined } })
      .__modelLens;
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();

    const hits: { x: number; y: number; v: Point3 }[] = [];
    for (let y = gridStep; y < rect.height; y += gridStep) {
      for (let x = gridStep; x < rect.width; x += gridStep) {
        const v = seam.probeAt(x, y);
        if (v) {
          hits.push({ x, y, v });
        }
      }
    }
    if (hits.length === 0) {
      return [];
    }
    const cx = hits.reduce((a, h) => a + h.x, 0) / hits.length;
    const cy = hits.reduce((a, h) => a + h.y, 0) / hits.length;

    const best = new Map<string, { d: number; x: number; y: number; v: Point3 }>();
    for (const h of hits) {
      const key = `${Math.round(h.v.x)},${Math.round(h.v.y)},${Math.round(h.v.z)}`;
      const d = Math.hypot(h.x - cx, h.y - cy);
      const prev = best.get(key);
      if (!prev || d < prev.d) {
        best.set(key, { d, x: h.x, y: h.y, v: h.v });
      }
    }
    return [...best.values()].map((b) => ({ vertex: b.v, screen: { x: b.x, y: b.y } }));
  }, step);
}

/** 축에 평행하고 길이가 `gap` 인 정점 쌍을 찾는다. */
export function axisPair(
  targets: { vertex: Point3; screen: { x: number; y: number } }[],
  axis: 'x' | 'y' | 'z',
  gap: number,
): [(typeof targets)[number], (typeof targets)[number]] | undefined {
  const others = (['x', 'y', 'z'] as const).filter((k) => k !== axis);
  for (const a of targets) {
    for (const b of targets) {
      const delta = {
        x: Math.abs(a.vertex.x - b.vertex.x),
        y: Math.abs(a.vertex.y - b.vertex.y),
        z: Math.abs(a.vertex.z - b.vertex.z),
      };
      if (Math.abs(delta[axis] - gap) < 0.01 && others.every((k) => delta[k] < 0.01)) {
        return [a, b];
      }
    }
  }
  return undefined;
}

/**
 * 축에 평행한 모서리 하나를 **실제 클릭으로** 측정한다.
 *
 * 치수 표시를 없앤 뒤(ADR 260905-222900) 단위와 자릿수가 화면에 드러나는 곳은 **측정 라벨뿐**
 * 이다. 그래서 그 두 설정을 검증하는 테스트들이 이 경로를 지난다 — 예전에는 `#dim-x` 를 읽으면
 * 됐지만 그 요소가 더는 없다.
 *
 * 측정 모드를 켜면 Measure 탭이 열리므로(applyMeasureMode), 호출 뒤 다른 탭을 만지려면 다시
 * 열어야 한다.
 */
export async function measureEdge(page: Page, axis: 'x' | 'y' | 'z', gap: number): Promise<void> {
  await sendHostMessage(page, { type: 'setMeasureMode', active: true });
  await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

  const targets = await vertexTargets(page);
  const pair = axisPair(targets, axis, gap);
  expect(pair, `${axis} 축으로 ${gap} 떨어진 정점 쌍을 찾지 못했다`).toBeTruthy();
  const box = await page.locator('#canvas').boundingBox();
  expect(box).not.toBeNull();
  if (!pair || !box) {
    return;
  }
  for (const target of pair) {
    await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
    await page.waitForTimeout(80);
  }
  await expect(page.locator('#measure-list .row')).toHaveCount(1);
}

/**
 * 웹뷰가 호스트로 보낸 메시지를 모으기 시작한다.
 *
 * UAT 셰임의 `postMessage` 는 `uat:tohost` CustomEvent 로 흘린다(`scripts/uat-serve.mjs`).
 * 실제 확장에서는 이 자리에 `webview.onDidReceiveMessage` 가 있다 — 즉 이 헬퍼가 보는 것은
 * **호스트가 실제로 받게 될 메시지**다.
 */
export async function collectHostMessages(page: Page): Promise<() => Promise<unknown[]>> {
  await page.evaluate(() => {
    const sink: unknown[] = [];
    (window as unknown as { __hostMessages: unknown[] }).__hostMessages = sink;
    window.addEventListener('uat:tohost', (event) => sink.push((event as CustomEvent).detail));
  });
  return () =>
    page.evaluate(() => (window as unknown as { __hostMessages: unknown[] }).__hostMessages);
}

/** 확장 호스트가 보내는 것과 동일한 메시지. */
export async function sendHostMessage(page: Page, message: unknown): Promise<void> {
  await page.evaluate((m) => window.postMessage(m, '*'), message);
}

export async function renderCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __modelLens: { renderCount: () => number } }).__modelLens.renderCount(),
  );
}

/**
 * 렌더 가능한 상태인 메시 수 / 전체 메시 수.
 *
 * 빈 화면 회귀의 **근본 원인을 직접 본다**: 머티리얼의 셰이더가 준비되지 않은 메시는
 * `Mesh.render()` 가 아무것도 그리지 않고 빠져나간다. 유휴에 들어간 시점에 이 둘이 다르면
 * 사용자는 빈 캔버스를 보고 있다는 뜻이다.
 */
export async function readyMeshes(page: Page): Promise<{ ready: number; total: number }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __modelLens: { readyMeshes: () => { ready: number; total: number } };
        }
      ).__modelLens.readyMeshes(),
  );
}

/** 3성분 벡터. */
export type Vec3 = [number, number, number];

/**
 * 카메라의 **시선·화면축**. 회전이 어디로 갔는지 보는 관측점이며 회전을 유발하지 않는다.
 *
 * `alpha`/`beta` 를 읽지 않는 이유: 카메라가 자유 자세(쿼터니언)라 그런 값이 없다.
 * 대신 벡터로 재면 카메라 모델과 무관하게 "얼마나 돌았나"를 물을 수 있다 (ADR `260826-232902`).
 */
export async function cameraAxes(
  page: Page,
): Promise<{ forward: Vec3; up: Vec3; right: Vec3 }> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __modelLens: { cameraAxes: () => { forward: Vec3; up: Vec3; right: Vec3 } };
        }
      ).__modelLens.cameraAxes(),
  );
}

/** 저장·복원되는 카메라 상태 — 자세(쿼터니언 `[x, y, z, w]`) · 거리 · 타깃. */
export interface CameraSnapshot {
  orientation: [number, number, number, number];
  radius: number;
  target: Vec3;
}

/**
 * 카메라의 **자세·거리·타깃**. `cameraAxes` 가 못 보는 것(거리와 타깃)까지 읽어야 홈 버튼처럼
 * 셋을 한꺼번에 되돌리는 조작을 판정할 수 있다. 같은 이유로 읽기만 한다 — 회전을 유발하는 API 는
 * `__modelLens` 에 없다(`main.ts` 의 `exposeTestSeam`).
 */
export async function cameraState(page: Page): Promise<CameraSnapshot> {
  return page.evaluate(
    () =>
      (window as unknown as { __modelLens: { camera: () => CameraSnapshot } }).__modelLens.camera(),
  );
}

/** 두 단위벡터 사이 각(라디안). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** `a → b` 변화를 기준축에 투영한 부호 — 어느 쪽으로 돌았는지. */
export function turnSign(a: Vec3, b: Vec3, axis: Vec3): number {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
}

export async function isIdle(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __modelLens: { isIdle: () => boolean } }).__modelLens.isIdle(),
  );
}

/** 렌더가 멈출 때까지 기다린다. 멈추지 않으면 false. */
export async function waitForIdle(page: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isIdle(page)) {
      return true;
    }
    await page.waitForTimeout(150);
  }
  return false;
}

/**
 * swiftshader(소프트웨어 래스터라이저)가 찍는 **성능 경고**만 걸러낸다.
 *
 * `--use-angle=swiftshader` 환경에서 십수 초간 연속 렌더링하면 ANGLE 이
 * "GPU stall due to ReadPixels" 를 찍는다. 이것은 **테스트 환경의 산물이며 제품 문제가 아니다** —
 * 좌우 회전만 13초 돌려도 같은 경고 4건이 나오는 것으로 확인했고(좌우는 `alpha` 한계가 원래부터
 * `null` 이라 이 프로젝트의 어떤 변경과도 무관하다), 실제 VS Code 웹뷰는 하드웨어 GL 을 쓴다.
 *
 * 조건을 `GL Driver Message` + `Performance` 로 좁게 잡는 것이 중요하다 — 이 함수의 본래 목적은
 * Babylon 이 조용히 무력화될 때 찍는 `Logger.Warn` 을 잡는 것이고, 그것을 가려서는 안 된다.
 */
function isDriverNoise(text: string): boolean {
  return text.includes('GL Driver Message') && text.includes('Performance');
}

/**
 * 콘솔의 경고·에러를 모은다.
 *
 * Babylon 9 는 side-effect import 가 빠지면 **예외 없이 조용히 무력화되고 `Logger.Warn` 만 찍는다**
 * (파트 4/4 에서 `scene.pick` 이 그렇게 빈 결과를 돌려주며 시간을 잡아먹었다). 그래서 렌더링을
 * 건드리는 테스트는 콘솔을 함께 본다.
 */
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if ((message.type() === 'warning' || message.type() === 'error') && !isDriverNoise(message.text())) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** 같은 오리진이 아닌 요청만 모은다 — "외부 네트워크 의존 0건" 불변식의 증거. */
export function collectExternalRequests(page: Page, origin: string): string[] {
  const external: string[] = [];
  page.on('request', (request: Request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      external.push(url);
    }
  });
  return external;
}
