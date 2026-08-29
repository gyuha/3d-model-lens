import { expect, test, type Page } from '@playwright/test';
import {
  axisPair,
  angleBetween,
  cameraAxes,
  cameraState,
  collectConsoleProblems,
  turnSign,
  collectExternalRequests,
  collectHostMessages,
  extents,
  isIdle,
  PANEL_SECTIONS,
  readyMeshes,
  renderCount,
  sendHostMessage,
  toggleSection,
  vertexTargets,
  waitForIdle,
  waitForViewer,
} from './helpers';

const ORIGIN = 'http://127.0.0.1:39177';

/** FIXTURES.md 의 기대 치수. 이 값이 이 스위트의 단일 기준이다. */
const FIXTURES = [
  { file: 'cube.gltf', extents: [2, 3, 4] as const, note: '외부 cube.bin 참조 — 형제 파일 해결' },
  { file: 'cube.glb', extents: [5, 6, 7] as const, note: 'GLB 바이너리 컨테이너' },
  { file: 'cube.stl', extents: [10, 20, 30] as const, note: 'ASCII STL, 파일 좌표 유지' },
  { file: 'cube_large.stl', extents: [1000, 2000, 3000] as const, note: 'cube.stl 의 100배' },
];

test.describe('WebGL2 엔진', () => {
  test('소프트웨어 렌더링 환경에서 WebGL2 로 초기화되고 모델이 로드된다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const webglVersion = await page.evaluate(
      () => (document.createElement('canvas').getContext('webgl2') ? 2 : 1),
    );
    expect(webglVersion, 'WebGL2 를 쓸 수 없으면 PBR/IBL 이 제대로 나오지 않는다').toBe(2);

    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
    expect(Number(await page.locator('#root').getAttribute('data-mesh-count'))).toBeGreaterThan(0);
  });
});

test.describe('외부 네트워크 의존 0건', () => {
  test('모델 로드 중 외부 오리진 요청이 없다', async ({ page }) => {
    const external = collectExternalRequests(page, ORIGIN);
    await page.goto('/?fixture=cube.gltf');
    expect(await waitForViewer(page)).toBe('ready');
    expect(external, `외부 요청: ${external.join(', ')}`).toEqual([]);
  });

  test('Inspector 를 켜도 외부 오리진 요청이 없다 — CSP 가 차단하고 로컬 chunk 만 쓴다', async ({
    page,
  }) => {
    const external = collectExternalRequests(page, ORIGIN);
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setInspector', visible: true });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    // Inspector UI 가 실제로 마운트됐는지 확인 (FluentUI 노드)
    await expect(page.locator('[class*="fui-"]').first()).toBeVisible();

    expect(external, `외부 요청: ${external.join(', ')}`).toEqual([]);
  });

  test('CSP 가 응답 헤더로도 강제된다', async ({ page }) => {
    const response = await page.goto('/?fixture=cube.glb');
    const csp = response?.headers()['content-security-policy'] ?? '';
    for (const directive of [
      "default-src 'none'",
      'script-src',
      'connect-src',
      'img-src',
      'style-src',
      'worker-src',
    ]) {
      expect(csp, `CSP 에 ${directive} 가 없다`).toContain(directive);
    }
  });
});

test.describe('치수', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.file} 의 치수가 FIXTURES.md 기대값과 일치한다 (${fixture.note})`, async ({
      page,
    }) => {
      await page.goto(`/?fixture=${fixture.file}`);
      expect(await waitForViewer(page)).toBe('ready');

      const measured = await extents(page);
      for (const axis of [0, 1, 2]) {
        expect(measured[axis], `축 ${'XYZ'[axis]}`).toBeCloseTo(fixture.extents[axis], 4);
      }
    });
  }

  test('단위 auto 는 glTF 를 미터로, STL 은 라벨 없이 표시한다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb&unit=auto');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-unit', 'm');
    await expect(page.locator('#dim-x')).toHaveText('5.000 m');

    await page.goto('/?fixture=cube.stl&unit=auto');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-unit', 'none');
    await expect(page.locator('#dim-x')).toHaveText('10.000');
  });
});

test.describe('측정', () => {
  test('정점 스냅으로 찍은 모서리 길이가 기대값과 일치한다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    const targets = await vertexTargets(page);
    expect(targets.length, '정점을 하나도 찾지 못했다 — 픽이 동작하지 않는다').toBeGreaterThan(3);

    const canvas = page.locator('#canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    for (const [axis, expected] of [
      ['x', 10],
      ['y', 20],
      ['z', 30],
    ] as const) {
      const pair = axisPair(targets, axis, expected);
      expect(pair, `${axis} 축으로 ${expected} 떨어진 정점 쌍을 찾지 못했다`).toBeTruthy();
      if (!pair || !box) {
        continue;
      }
      // 실제 마우스 클릭 — 상호작용을 우회하지 않는다.
      for (const target of pair) {
        await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
        await page.waitForTimeout(80);
      }
      await expect(page.locator('#measure-list .row .pick').last()).toHaveText(
        `${expected.toFixed(3)} mm`,
      );
    }

    await expect(page.locator('#measure-list .row')).toHaveCount(3);
  });

  test('드래그는 측정을 만들지 않는다 — 궤도 회전이 살아 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(cx + i * 10, cy + i * 4);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page.locator('#root')).toHaveAttribute('data-measure-count', '0');
    await expect(page.locator('#measure-list .row')).toHaveCount(0);
  });

  test('삭제와 전체 삭제가 목록·라벨을 함께 정리한다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    const targets = await vertexTargets(page);
    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }

    for (const [axis, gap] of [
      ['x', 10],
      ['z', 30],
    ] as const) {
      const pair = axisPair(targets, axis, gap);
      if (!pair) {
        continue;
      }
      for (const target of pair) {
        await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
        await page.waitForTimeout(80);
      }
    }
    await expect(page.locator('#measure-list .row')).toHaveCount(2);
    await expect(page.locator('.measure-label')).toHaveCount(2);

    await page.locator('#measure-list .row button.remove').first().click();
    await expect(page.locator('#measure-list .row')).toHaveCount(1);
    await expect(page.locator('.measure-label')).toHaveCount(1);

    await page.locator('#measure-clear').click();
    await expect(page.locator('#measure-list .row')).toHaveCount(0);
    await expect(page.locator('.measure-label')).toHaveCount(0);
  });

  test('단위를 바꾸면 이미 만든 측정의 라벨도 갱신된다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    const targets = await vertexTargets(page);
    const pair = axisPair(targets, 'x', 10);
    const box = await page.locator('#canvas').boundingBox();
    expect(pair).toBeTruthy();
    expect(box).not.toBeNull();
    if (!pair || !box) {
      return;
    }
    for (const target of pair) {
      await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
      await page.waitForTimeout(80);
    }
    await expect(page.locator('.measure-label').first()).toHaveText('10.000 mm');

    await page.locator('#unit').selectOption('cm');
    await expect(page.locator('.measure-label').first()).toHaveText('10.000 cm');
  });

  test('Inspector 를 켠 상태에서도 측정할 수 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl&unit=mm');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setInspector', visible: true });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    const targets = await vertexTargets(page);
    const pair = axisPair(targets, 'z', 30);
    const box = await page.locator('#canvas').boundingBox();
    expect(pair, 'Inspector 가 캔버스를 가려 정점을 찾지 못했다').toBeTruthy();
    expect(box).not.toBeNull();
    if (!pair || !box) {
      return;
    }
    for (const target of pair) {
      await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
      await page.waitForTimeout(80);
    }
    await expect(page.locator('#measure-list .row .pick').last()).toHaveText('30.000 mm');
  });
});

test.describe('에러 처리', () => {
  test('깨진 파일은 빈 화면이 아니라 파일명과 원인을 표시한다', async ({ page }) => {
    await page.goto('/?fixture=broken.glb');
    expect(await waitForViewer(page)).toBe('error');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error .name')).toContainText('broken.glb');
    const message = await page.locator('#error .message').textContent();
    expect((message ?? '').trim().length, '원인 메시지가 비어 있다').toBeGreaterThan(0);
    await expect(page.locator('#panel')).toBeHidden();
  });
});

test.describe('유휴 렌더 중단', () => {
  test('유휴 상태에서는 렌더 횟수가 늘지 않는다', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');

    expect(await waitForIdle(page), '렌더가 멈추지 않았다 — 유휴 판정이 동작하지 않는다').toBe(true);

    const before = await renderCount(page);
    await page.waitForTimeout(1500);
    const after = await renderCount(page);

    expect(after, `유휴 1.5초 동안 ${after - before} 프레임을 더 그렸다`).toBe(before);
    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });

  test('카메라를 조작하면 렌더가 다시 시작된다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);

    const idleCount = await renderCount(page);

    const box = await page.locator('#canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + i * 12, cy + i * 5);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    expect(await renderCount(page), '카메라를 돌렸는데 다시 그리지 않았다').toBeGreaterThan(idleCount);

    // 다시 멈춰야 한다 — 관성 감쇠가 끝나면 유휴로 돌아간다
    expect(await waitForIdle(page), '조작 후 다시 멈추지 않았다').toBe(true);
  });

  test('표시 토글도 다시 그리게 만든다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);
    const idleCount = await renderCount(page);

    await page.locator('#toggle-grid').click();
    await page.waitForTimeout(300);

    expect(await renderCount(page), '그리드를 껐는데 화면이 갱신되지 않았다').toBeGreaterThan(
      idleCount,
    );
  });

  test('Inspector 를 켜면 연속 렌더링한다 — fps 카운터와 기즈모가 렌더 루프에 의존한다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);

    await sendHostMessage(page, { type: 'setInspector', visible: true });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');

    expect(await isIdle(page), 'Inspector 가 켜졌는데 유휴로 판정됐다').toBe(false);
    const before = await renderCount(page);
    await page.waitForTimeout(1000);
    expect(await renderCount(page), 'Inspector 가 켜졌는데 그리지 않는다').toBeGreaterThan(before);

    // 끄면 다시 멈춘다
    await sendHostMessage(page, { type: 'setInspector', visible: false });
    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'off');
    expect(await waitForIdle(page), 'Inspector 를 껐는데 계속 그린다').toBe(true);
  });
});

test.describe('유휴 진입 — 빈 화면 회귀', () => {
  test('입력 없이 유휴에 들어가도 모든 메시가 렌더 가능한 상태다', async ({ page }) => {
    // 사용자가 캔버스를 한 번도 건드리지 않는 상황. 게이트가 셰이더 컴파일이 끝나기 전에
    // 유휴로 잠기면 화면은 비어 있는데 뷰어는 "다 됐다"고 믿는다.
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page)).toBe(true);

    const { ready, total } = await readyMeshes(page);
    expect(total).toBeGreaterThan(0);
    expect(ready, '유휴인데 렌더되지 않는 메시가 남아 있다 — 빈 화면이다').toBe(total);
  });
});

test.describe('애니메이션', () => {
  test('애니메이션이 있으면 입력 없이도 계속 그린다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'playing');

    const before = await renderCount(page);
    await page.waitForTimeout(600);
    const after = await renderCount(page);

    expect(after, '재생 중인데 렌더가 멈췄다 — 애니메이션이 얼어붙는다').toBeGreaterThan(before);
    expect(await isIdle(page)).toBe(false);
  });

  test('일시정지하면 유휴로 들어간다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await page.locator('#animation-toggle').click();

    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'paused');
    expect(await waitForIdle(page)).toBe(true);
  });

  test('측정 모드를 켜면 애니메이션이 멈춘다 — 움직이는 메시에서는 측정이 의미를 잃는다', async ({
    page,
  }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'playing');

    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'paused');
  });

  test('전체 재생에서 개별 그룹으로 좁힐 수 있다', async ({ page }) => {
    await page.goto('/?fixture=animated.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const select = page.locator('#animation-select');
    await expect(select).toHaveValue('all');
    // '전체' 다음에 파일의 그룹이 순서대로 온다.
    await expect(select.locator('option')).toHaveText(['All', 'rise', 'slide']);

    await select.selectOption('1');

    await expect(select).toHaveValue('1');
    // 개별 그룹도 재생 중이므로 계속 그려야 한다.
    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'playing');
  });

  test('애니메이션이 없는 파일에서는 섹션을 숨긴다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#root')).toHaveAttribute('data-animation', 'none');
    await expect(page.locator('#animation-row')).toBeHidden();
  });
});

test.describe('Inspector 패널 토글', () => {
  // 끄는 것은 여기서 시험하지 않는다. Inspector 사이드바가 오른쪽 패널을 완전히 덮어
  // 체크박스를 다시 클릭할 수 없기 때문이다 — 받아들인 한계이며, 끄는 경로는 제목 표시줄
  // 아이콘(아래 테스트의 setInspector 메시지)이다.
  test('패널 체크박스로 Inspector 를 켤 수 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const checkbox = page.locator('#toggle-inspector');
    await expect(checkbox).not.toBeChecked();

    await checkbox.check();

    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    await expect(page.locator('[class*="fui-"]').first()).toBeVisible();
  });

  test('제목 표시줄 경로로 켜도 체크박스가 따라온다 — 두 진입점이 어긋나면 토글 방향이 뒤집힌다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setInspector', visible: true });

    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'on');
    await expect(page.locator('#toggle-inspector')).toBeChecked();

    await sendHostMessage(page, { type: 'setInspector', visible: false });

    await expect(page.locator('#root')).toHaveAttribute('data-inspector', 'off');
    await expect(page.locator('#toggle-inspector')).not.toBeChecked();
  });
});

test.describe('배경 모드', () => {
  /** 브라우저가 돌려주는 `rgb(r, g, b)` 를 헥사로 정규화한다. */
  async function bodyBackground(page: Page): Promise<string> {
    return page.evaluate(() => {
      const rgb = getComputedStyle(document.body).backgroundColor;
      const m = rgb.match(/\d+/g);
      return m
        ? '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
        : rgb;
    });
  }

  /*
   * `theme` 은 **앱 테마(OS 라이트/다크)** 를 따라가고, light/dark 는 그것과 무관하게 고정한다.
   * 그래서 테마와 모드를 **엇갈리게** 줘야 둘이 구분된다.
   *
   * 원본 확장에서는 UAT 하니스가 `?theme=` 쿼리로 VS Code 변수를 주입해 이 축을 만들었다.
   * 이제 그 자리는 `prefers-color-scheme` 이므로 브라우저의 색 구성표를 직접 흉내 낸다 —
   * 하니스가 흉내 내던 것을 실제 미디어 질의로 재는 것이라 검증이 오히려 가까워졌다.
   * (ADR 260826-094348 개정)
   */
  const CASES = [
    { background: 'theme', scheme: 'dark', expected: '#1f1f1f', note: '앱 테마를 따라 어둡게' },
    { background: 'theme', scheme: 'light', expected: '#ffffff', note: '앱 테마를 따라 밝게' },
    { background: 'light', scheme: 'dark', expected: '#ffffff', note: '어두운 테마에서도 순백' },
    { background: 'dark', scheme: 'light', expected: '#1f1f1f', note: '밝은 테마에서도 어둡게' },
  ] as const;

  for (const c of CASES) {
    test(`background=${c.background} + ${c.scheme} 색 구성표 → ${c.expected} (${c.note})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: c.scheme });
      await page.goto(`/?fixture=cube.glb&background=${c.background}`);
      expect(await waitForViewer(page)).toBe('ready');
      expect(await bodyBackground(page)).toBe(c.expected);
    });
  }
});

test.describe('배경 드롭다운', () => {
  test('세 모드를 순서대로 내고 현재 값이 선택되어 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb&background=dark&theme=light');
    expect(await waitForViewer(page)).toBe('ready');

    const select = page.locator('#background-select');
    await expect(select.locator('option')).toHaveText(['Theme', 'Light', 'Dark']);
    await expect(select).toHaveValue('dark');
  });

  test('드롭다운을 바꾸면 배경이 즉시 바뀌고 호스트에 알린다 — 호스트가 전역 설정에 저장한다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&background=theme&theme=dark');
    expect(await waitForViewer(page)).toBe('ready');
    const messages = await collectHostMessages(page);

    await page.locator('#background-select').selectOption('light');

    await expect(page.locator('#root')).toHaveAttribute('data-background', 'light');
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe('rgb(255, 255, 255)');
    expect(await messages()).toContainEqual({ type: 'backgroundChanged', background: 'light' });
  });
  test('호스트가 설정 변경을 알리면 배경과 드롭다운이 함께 따라온다 — 나란히 열린 다른 탭이 이 경로로 갱신된다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&background=theme&theme=dark');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#background-select')).toHaveValue('theme');

    await sendHostMessage(page, { type: 'setBackground', background: 'light' });

    await expect(page.locator('#root')).toHaveAttribute('data-background', 'light');
    await expect(page.locator('#background-select')).toHaveValue('light');
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe('rgb(255, 255, 255)');
  });
});

test.describe('표시 설정 — 소수 자릿수', () => {
  test('설정값이 초기 자릿수를 정한다 — 초기값의 출처가 전역 설정이다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb&decimals=1');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#decimals')).toHaveValue('1');
    await expect(page.locator('#dim-x')).toHaveText('5.0 m');
  });

  test('자릿수를 바꾸면 치수가 즉시 따라오고 호스트에 알린다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb&decimals=3');
    expect(await waitForViewer(page)).toBe('ready');
    const messages = await collectHostMessages(page);

    await page.locator('#decimals').fill('0');
    await page.locator('#decimals').dispatchEvent('change');

    await expect(page.locator('#dim-x')).toHaveText('5 m');
    expect(await messages()).toContainEqual({ type: 'decimalsChanged', decimals: 0 });
  });

  test('범위를 벗어난 값은 0–10 으로 잘린다 — 손으로 아무 값이나 넣을 수 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await page.locator('#decimals').fill('99');
    await page.locator('#decimals').dispatchEvent('change');
    await expect(page.locator('#decimals')).toHaveValue('10');
  });

  test('호스트가 자릿수 변경을 알리면 입력과 치수가 함께 따라온다 — 나란히 열린 다른 창이 이 경로로 갱신된다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&decimals=3');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setDecimals', decimals: 1 });

    await expect(page.locator('#decimals')).toHaveValue('1');
    await expect(page.locator('#dim-y')).toHaveText('6.0 m');
  });
});

test.describe('그리드 설정', () => {
  test('설정이 꺼져 있으면 체크박스도 꺼진 채 시작한다 — 초기값의 출처가 전역 설정이다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb&grid=false');
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#toggle-grid')).not.toBeChecked();
  });

  test('체크박스를 끄면 호스트에 알린다 — 호스트가 전역 설정에 저장한다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#toggle-grid')).toBeChecked();
    const messages = await collectHostMessages(page);

    await page.locator('#toggle-grid').click();

    expect(await messages()).toContainEqual({ type: 'gridChanged', grid: false });
  });

  test('호스트가 설정 변경을 알리면 체크박스가 따라오고 유휴였어도 다시 그린다 — 나란히 열린 다른 탭이 이 경로로 갱신된다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    expect(await waitForIdle(page), '유휴로 들어가지 않았다').toBe(true);
    const idleCount = await renderCount(page);

    await sendHostMessage(page, { type: 'setGrid', grid: false });

    await expect(page.locator('#toggle-grid')).not.toBeChecked();
    await page.waitForTimeout(300);
    expect(
      await renderCount(page),
      '호스트가 그리드를 껐는데 화면이 갱신되지 않았다 — markDirty 누락',
    ).toBeGreaterThan(idleCount);
  });
});

test.describe('측정 모드 패널 토글', () => {
  test('패널 체크박스로 측정 모드를 켤 수 있고 호스트에 알린다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    await expect(page.locator('#toggle-measure')).not.toBeChecked();
    const messages = await collectHostMessages(page);

    await page.locator('#toggle-measure').check();

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    expect(await messages()).toContainEqual({ type: 'measureModeState', active: true });
  });

  test('제목 표시줄 경로로 켜도 체크박스가 따라온다 — 두 진입점이 어긋나면 토글 방향이 뒤집힌다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setMeasureMode', active: true });

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');
    await expect(page.locator('#toggle-measure')).toBeChecked();

    await sendHostMessage(page, { type: 'setMeasureMode', active: false });

    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'off');
    await expect(page.locator('#toggle-measure')).not.toBeChecked();
  });

});

test.describe('연속 수직 회전', () => {
  // 카메라가 자유 자세(쿼터니언)라 `alpha`/`beta` 가 없다. 그래서 **시선 벡터**로 잰다 —
  // 카메라 모델과 무관하게 "얼마나 돌았나"를 물을 수 있다 (ADR `260826-232902`).
  //
  // 이 테스트가 지키는 보장은 `v0.1.1` 에서 온 것이다: **위/아래로 계속 드래그해도 멈추지
  // 않는다.** 쿼터니언 자세에서는 극점이 특별하지 않으므로 자동으로 성립하지만, 테스트를 지우면
  // 그 보장이 문서에서 사라진다.
  const CYCLES = 8;
  const STUCK = 0.01; // rad — 한 사이클에 이보다 덜 움직이면 벽에 붙은 것이다

  async function orbit(page: Page, direction: 'up' | 'down' | 'sideways'): Promise<void> {
    const box = await page.locator('#canvas').boundingBox();
    expect(box, '캔버스를 찾지 못했다').not.toBeNull();
    if (!box) {
      return;
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = direction === 'sideways' ? -box.width * 0.45 : 0;
    const dy = direction === 'up' ? -box.height * 0.45 : direction === 'down' ? box.height * 0.45 : 0;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(cx + (dx * i) / 10, cy + (dy * i) / 10);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);
  }

  for (const direction of ['up', 'down'] as const) {
    test(`${direction === 'up' ? '위' : '아래'}로 계속 드래그해도 멈추지 않는다`, async ({ page }) => {
      const problems = collectConsoleProblems(page);
      await page.goto('/?fixture=cube.glb');
      expect(await waitForViewer(page)).toBe('ready');

      const steps: number[] = [];
      let upDotWorldY = 1;
      let previous = (await cameraAxes(page)).forward;
      for (let i = 0; i < CYCLES; i++) {
        await orbit(page, direction);
        const axes = await cameraAxes(page);
        steps.push(angleBetween(previous, axes.forward));
        previous = axes.forward;
        upDotWorldY = Math.min(upDotWorldY, axes.up[1]);
      }

      const trail = steps.map((r) => ((r * 180) / Math.PI).toFixed(1)).join(' · ');
      expect(
        steps.filter((step) => step < STUCK).length,
        `어느 사이클에서 회전이 멈췄다 — 사이클별 시선 변화(deg): ${trail}`,
      ).toBe(0);
      // 극점을 실제로 지났으면 화면의 up 이 월드 아래를 향하는 순간이 있다.
      expect(upDotWorldY, `극점을 통과하지 못했다 — 사이클별 시선 변화(deg): ${trail}`).toBeLessThan(0);

      expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
    });
  }

  test('뒤집힌 구간에서도 좌우 회전이 살아 있다', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // 화면의 up 이 월드 아래를 향할 때까지 위로 돌린다.
    let axes = await cameraAxes(page);
    for (let i = 0; i < CYCLES && axes.up[1] >= 0; i++) {
      await orbit(page, 'up');
      axes = await cameraAxes(page);
    }
    expect(axes.up[1], '뒤집힌 구간에 들어가지 못했다').toBeLessThan(0);

    const before = axes.forward;
    await orbit(page, 'sideways');
    const after = (await cameraAxes(page)).forward;
    expect(
      angleBetween(before, after),
      '뒤집힌 구간에서 좌우 드래그가 먹지 않았다',
    ).toBeGreaterThan(STUCK);

    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });
});

test.describe('숫자키 카메라 단축키', () => {
  /**
   * 기대 시선은 **면의 바깥 법선의 반대**다 (`navCubeGeometry.ts` 의 실측표: `TOP=+Y` ·
   * `FRONT=+Z` · `RIGHT=+X`). 같은 값을 큐브 면 클릭 테스트도 쓰므로, 두 진입점이 갈라지면
   * 여기서 잡힌다.
   */
  const KEYS = [
    { key: '1', face: 'TOP', forward: [0, -1, 0] },
    { key: '2', face: 'FRONT', forward: [0, 0, -1] },
    { key: '3', face: 'RIGHT', forward: [-1, 0, 0] },
    { key: '4', face: 'BACK', forward: [0, 0, 1] },
    { key: '5', face: 'LEFT', forward: [1, 0, 0] },
    { key: '6', face: 'BOTTOM', forward: [0, 1, 0] },
  ] as const;

  for (const c of KEYS) {
    test(`${c.key} 를 누르면 ${c.face} 정규 자세로 간다`, async ({ page }) => {
      const problems = collectConsoleProblems(page);
      await page.goto('/?fixture=cube.glb');
      expect(await waitForViewer(page)).toBe('ready');

      await page.keyboard.press(c.key);

      // **`waitForIdle` 을 쓰지 않는다.** 키 입력은 마우스 클릭과 달리 렌더 루프를 깨우기 전에
      // 폴링이 먼저 돌아, 보간이 시작되지도 않은 상태를 "유휴"로 읽는다(실측: 키 직후 시선이
      // 초기값 그대로인데 idle 이 true 였고, 3초 뒤에는 목표에 정확히 도달해 있었다).
      // 그래서 상태가 아니라 **목표에 수렴하는 것** 자체를 기다린다.
      await expect
        .poll(
          async () => {
            const forward = (await cameraAxes(page)).forward;
            return Math.max(...c.forward.map((want, axis) => Math.abs(forward[axis] - want)));
          },
          { timeout: 20_000, message: `${c.face} 정규 자세에 수렴하지 않았다` },
        )
        .toBeLessThan(0.01);
      expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
    });
  }

  test('0 은 홈 버튼과 같다 — 회전·줌·팬을 준 뒤에도 첫 자세·거리·타깃으로 돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    const first = await cameraState(page);

    // 세 가지를 모두 흐트러뜨린다 — 자세만 되돌리는 것으로는 통과할 수 없게.
    const box = (await page.locator('#canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40);
    await page.mouse.up();
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(200);
    expect(await cameraState(page)).not.toEqual(first);

    await page.keyboard.press('0');
    await page.waitForTimeout(200);

    const back = await cameraState(page);
    expectAxis(back.orientation, first.orientation, 'orientation');
    expect(Math.abs(back.radius - first.radius)).toBeLessThan(0.01);
    expectAxis(back.target, first.target, 'target');
  });

  test('입력칸에 포커스가 있으면 숫자키는 값이 되고 카메라는 그대로다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    const before = await cameraAxes(page);

    await page.locator('#decimals').focus();
    await page.locator('#decimals').fill('');
    await page.keyboard.press('3');

    await expect(page.locator('#decimals')).toHaveValue('3');
    expectAxis((await cameraAxes(page)).forward, before.forward, 'forward');
  });

  test('수정키가 섞이면 무시한다 — OS 단축키를 빼앗지 않는다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    const before = await cameraAxes(page);

    await page.keyboard.press('Meta+1');
    await page.keyboard.press('Control+2');
    await page.waitForTimeout(200);

    expectAxis((await cameraAxes(page)).forward, before.forward, 'forward');
  });

  test('큐브의 면과 홈 버튼에 단축키가 툴팁으로 적혀 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // 라벨이 아니라 **클릭 대상 path** 에 붙어야 마우스를 올렸을 때 보인다.
    const top = page.locator('#nav-cube path[data-region="+Y"] title');
    await expect(top).toHaveText('TOP (1)');
    await expect(page.locator('#nav-cube-home title')).toHaveText('Reset view (0)');
  });

  test('패널의 SHORTCUTS 섹션이 일곱 항목을 낸다 — 표에서 생성된다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#shortcut-list dt')).toHaveText(['0', '1', '2', '3', '4', '5', '6']);
    await expect(page.locator('#shortcut-list dd').first()).toHaveText('기본 위치');
    await expect(page.locator('#shortcut-list dd').nth(1)).toHaveText('TOP');
  });
});

test.describe('패널 섹션 아코디언', () => {
  test('처음 열면 네 섹션이 접혀 있고, 헤더를 클릭하면 그 섹션만 펼쳐진다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    // 접힘 상태 자체가 검사 대상이므로 헬퍼의 자동 펼치기를 끈다.
    expect(await waitForViewer(page, { expandSections: false })).toBe('ready');

    for (const name of PANEL_SECTIONS) {
      await expect(page.locator(`#${name}-header`)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator(`#${name}-body`)).toBeHidden();
    }
    // 치수와 단위는 섹션이 아니므로 늘 보인다 — 접어서 숨길 수 있으면 안 된다.
    await expect(page.locator('#dim-x')).toBeVisible();
    await expect(page.locator('#unit')).toBeVisible();

    await toggleSection(page, 'display');
    await expect(page.locator('#display-header')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#toggle-grid')).toBeVisible();
    // 다른 섹션은 그대로 접혀 있다 — 하나만 열리는 배타 아코디언이 아니다.
    await expect(page.locator('#measure-body')).toBeHidden();
    await expect(page.locator('#debug-body')).toBeHidden();

    await toggleSection(page, 'display');
    await expect(page.locator('#display-header')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#toggle-grid')).toBeHidden();
  });

  test('측정 모드를 켜면 MEASURE 가 자동으로 펼쳐진다 — 끌 때는 접지 않는다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page, { expandSections: false })).toBe('ready');
    await expect(page.locator('#measure-body')).toBeHidden();

    // 제목 표시줄 아이콘 경로. 이 경로로 켰을 때 섹션이 접혀 있으면 측정 목록이 보이지 않는다.
    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#measure-header')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#measure-list')).toBeVisible();

    await sendHostMessage(page, { type: 'setMeasureMode', active: false });
    await expect(page.locator('#measure-header')).toHaveAttribute('aria-expanded', 'true');
  });

});

test.describe('패널 숨기기', () => {
  test('호스트가 숨기면 패널이 사라지고, 되살리면 접힘 상태를 유지한 채 돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page, { expandSections: false })).toBe('ready');
    const messages = await collectHostMessages(page);

    await toggleSection(page, 'display');
    await sendHostMessage(page, { type: 'setPanelVisible', visible: false });
    await expect(page.locator('#panel')).toBeHidden();
    await expect(page.locator('#root')).toHaveAttribute('data-panel', 'hidden');
    // 호스트에 알리지 않으면 다음 아이콘 클릭의 토글 방향이 뒤집힌다.
    expect(await messages()).toContainEqual({ type: 'panelState', visible: false });

    await sendHostMessage(page, { type: 'setPanelVisible', visible: true });
    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#display-header')).toHaveAttribute('aria-expanded', 'true');
  });

});

test.describe('회전 방향 규약 (절대 방향)', () => {
  // **`방향키 회전 방향` 은 "키와 드래그가 서로 같은가"만 보므로 전역 부호 반전을 통과시킨다.**
  // 실제로 v0.3.0 이 두 축 모두 반대로 나갔고 그 테스트는 초록이었다. 그래서 절대 방향을 여기서
  // 못 박는다. 기준은 v0.2.1 의 실측값이다:
  //   오른쪽 드래그 → 카메라가 화면 **왼쪽**으로 (`·right = -1.889`)
  //   아래로 드래그 → 카메라가 화면 **위**로   (`·up    = +1.987`)
  // 카메라 위치 = target - forward·radius 이므로, 위치 변화의 부호는 forward 변화의 **반대**다.
  const CASES = [
    {
      label: '오른쪽으로 드래그하면 카메라가 화면 왼쪽으로 돈다',
      drag: { dx: 1, dy: 0 },
      axis: 'right' as const,
      // 위치가 -right 로 가야 하므로 forward 변화는 +right 여야 한다.
      expectPositive: true,
    },
    {
      label: '아래로 드래그하면 카메라가 화면 위로 돈다',
      drag: { dx: 0, dy: 1 },
      axis: 'up' as const,
      // 위치가 +up 으로 가야 하므로 forward 변화는 -up 이어야 한다.
      expectPositive: false,
    },
  ];

  for (const { label, drag, axis, expectPositive } of CASES) {
    test(label, async ({ page }) => {
      const problems = collectConsoleProblems(page);
      await page.goto('/?fixture=cube.glb');
      expect(await waitForViewer(page)).toBe('ready');

      const box = (await page.locator('#canvas').boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const span = Math.min(box.width, box.height) * 0.08;

      const before = await cameraAxes(page);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 5; i++) {
        await page.mouse.move(cx + (drag.dx * span * i) / 5, cy + (drag.dy * span * i) / 5);
      }
      await page.mouse.up();
      expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);
      const after = await cameraAxes(page);

      const projected = turnSign(before.forward, after.forward, before[axis]);
      expect(Math.abs(projected), '드래그가 카메라를 움직이지 않았다').toBeGreaterThan(0.005);
      expect(
        projected > 0,
        `방향이 v0.2.1 기준과 반대다 — 투영값 ${projected.toFixed(4)} (기대 부호: ${expectPositive ? '+' : '-'})`,
      ).toBe(expectPositive);

      expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
    });
  }
});

test.describe('방향키 회전 방향', () => {
  // 어느 쪽이 "옳은" 방향인지 박아 넣지 않는다 — **마우스와 같은 방향인지**만 단정한다.
  // 그래서 카메라 모델을 바꿔도 그대로 유효한 회귀 장치다.
  //
  // 자유 자세에는 `alpha`/`beta` 가 없으므로 부호를 **시선 변화를 화면축에 투영해서** 얻는다.
  const SMALL = 0.005;

  const CASES = [
    { key: 'ArrowRight', axis: 'right' as const, drag: { dx: 1, dy: 0 }, label: '오른쪽' },
    { key: 'ArrowDown', axis: 'up' as const, drag: { dx: 0, dy: 1 }, label: '아래' },
  ];

  for (const { key, axis, drag, label } of CASES) {
    test(`${label} 방향키와 ${label} 드래그가 같은 방향으로 돈다`, async ({ page }) => {
      const problems = collectConsoleProblems(page);

      const keySign = await measure(page, axis, async () => {
        await page.locator('#canvas').focus();
        await page.keyboard.down(key);
        await page.waitForTimeout(120);
        await page.keyboard.up(key);
      });

      const dragSign = await measure(page, axis, async () => {
        const box = await page.locator('#canvas').boundingBox();
        if (!box) {
          return;
        }
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const span = Math.min(box.width, box.height) * 0.08;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        for (let i = 1; i <= 5; i++) {
          await page.mouse.move(cx + (drag.dx * span * i) / 5, cy + (drag.dy * span * i) / 5);
        }
        await page.mouse.up();
      });

      for (const [what, value] of [
        ['키', keySign],
        ['드래그', dragSign],
      ] as const) {
        expect(
          Math.abs(value),
          `${label} ${what}가 카메라를 움직이지 않았다`,
        ).toBeGreaterThan(SMALL);
      }
      expect(
        Math.sign(keySign),
        `${label} 키와 ${label} 드래그가 반대로 돈다 — 키 ${keySign.toFixed(4)} / 드래그 ${dragSign.toFixed(4)}`,
      ).toBe(Math.sign(dragSign));

      expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
    });
  }

  /** 매번 새로 로드해 같은 초기 자세에서 잰다. 부호는 시선 변화를 기준 화면축에 투영한 값. */
  async function measure(
    page: Page,
    axis: 'right' | 'up',
    act: () => Promise<void>,
  ): Promise<number> {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    const before = await cameraAxes(page);
    await act();
    expect(await waitForIdle(page), '조작 후 멈추지 않았다').toBe(true);
    const after = await cameraAxes(page);
    return turnSign(before.forward, after.forward, before[axis]);
  }
});

/**
 * 면 폴리곤을 클릭한다. 영역 id 는 월드 축이다 — `TOP = +Y` (plan 의 라벨 ↔ 월드 축 표).
 *
 * `locator.click()` 은 바운딩 박스의 중심을 찍는데, **직교 투영에서 정사각 면의 상은 항상
 * 평행사변형**이므로 그 중심은 면 안이 보장된다(원근이면 보장되지 않는다). 그리고 그 점은
 * 라벨이 놓인 자리이므로, 이 클릭이 통과한다는 것은 라벨(`pointer-events: none`)이 클릭을
 * 가로채지 않는다는 증거도 된다 — Playwright 가 "이 요소가 이벤트를 받는가"를 함께 본다.
 *
 * 라벨 중심을 포인터로 찍는 방식은 쓰지 않는다: 실측으로, 시작 자세에서 TOP 면은 세로로
 * 강하게 눌려 있어(고도 18°) 글자 상자의 중심이 면 밖으로 나간다 — 클릭이 캔버스로 새고
 * 카메라가 움직이지 않았다.
 *
 * **인접한 면을 연속으로 클릭하지 마라 — 테스트가 타임아웃 전체를 태운다.**
 *
 * 면을 정면으로 보는 [[정규 자세]] 에 도달하면 인접한 4면의 `dot(법선, forward)` 가 정확히 0 이
 * 되어 `CULL_EPSILON` 에 걸리고 `d = ""` 가 된다. 넓이 0 인 `path` 는 **영영 클릭 가능해지지
 * 않으므로** `locator.click()` 이 안정·가시 상태를 기다리다 타임아웃(90초)까지 간다.
 *
 * 실측: `+Z`(FRONT) 클릭 후 `+X`(RIGHT) 클릭 → `d = ""` 이고 클릭은 타임아웃. 같은 면 재클릭
 * (`+Z` → `+Z`)은 20ms 에 성공하므로 "보간 중 클릭"이 막힌 것은 아니다. 아래 500ms 대기가
 * 우연히 이 함정을 덜 자주 만나게 해 주고 있을 뿐이며, **화살표 4개(part 2/2)가 들어오기 전까지
 * 큐브만으로 FRONT → RIGHT 같은 90° 이동은 애초에 불가능하다.**
 */
async function clickCubeFace(page: Page, region: string): Promise<void> {
  await page.locator(`#nav-cube path[data-region="${region}"]`).click();
  // **클릭 직후에는 유휴를 물어도 안 된다.** dirty 를 세우는 것은 렌더 루프의 `orbit.tick()`
  // 이므로 클릭이 반환된 순간에는 아직 한 프레임도 그리지 않았고 `isIdle` 이 여전히 true 다 —
  // 실측으로 `waitForIdle` 이 즉시 통과해 **시작 자세를 읽었다**. 보간 300ms 를 넘겨 기다린다.
  await page.waitForTimeout(500);
}

/**
 * 절대 좌표로 단정한다 — "서로 같은가"만 보면 축이 통째로 뒤집혀도 통과한다.
 *
 * `name` 은 실패 메시지에만 쓴다. `forward` 와 `up` 을 같은 규약으로 재기 때문이다.
 */
function expectAxis(actual: readonly number[], expected: readonly number[], name: string): void {
  const shown = actual.map((n) => n.toFixed(3)).join(', ');
  for (const [axis, want] of expected.entries()) {
    expect(Math.abs(actual[axis] - want), `${name} = [${shown}]`).toBeLessThan(0.01);
  }
}

test.describe('내비게이션 큐브', () => {
  test('큐브가 좌상단에 뜨고 클릭 가능한 영역이 14개다 — 면 6 + 꼭짓점 8', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const cube = page.locator('#nav-cube');
    await expect(cube).toBeVisible();

    const cubeBox = (await cube.boundingBox())!;
    const canvasBox = (await page.locator('#canvas').boundingBox())!;
    const panelBox = (await page.locator('#panel').boundingBox())!;
    // 좌상단 — `top: 0.75rem; left: 0.75rem`. 패널의 `right: 0.75rem` 과 대칭이므로
    // 좌우가 뒤집히면 패널과의 비교에서 잡힌다.
    expect(cubeBox.x - canvasBox.x, '왼쪽 모서리에 붙어 있지 않다').toBeLessThan(40);
    expect(cubeBox.y - canvasBox.y, '위쪽 모서리에 붙어 있지 않다').toBeLessThan(40);
    expect(panelBox.x, '패널이 큐브보다 왼쪽에 있다 — 좌우가 뒤집혔다').toBeGreaterThan(cubeBox.x);

    // 26면을 전부 그리되 클릭은 면·꼭짓점만 받는다 — 90px 큐브에서 모서리는 히트 타깃이
    // 너무 작다(폭 ~8px). 후면 제거된 영역은 노드를 지우지 않고 `d` 를 비우므로 개수가 고정이다.
    //
    // **`.region` 으로 좁히는 것은 상자 안에 화살표 `path` 4개가 함께 있기 때문이다** —
    // `#nav-cube path` 는 30개다. 화살표는 `화살표 4방향 (절대 방향)` 이 따로 센다.
    await expect(page.locator('#nav-cube path.region')).toHaveCount(26);
    // 아무것도 그려지지 않았다면 여기서 잡힌다. **정확한 값을 박지 않는다** — 형제 테스트
    // `첫 로드는 RIGHT·TOP·FRONT 를 본다` 가 프레이밍 각도를 조정할 여지를 명시적으로 남겼고,
    // 그려지는 개수는 **그 각도에 극단적으로 민감하다**: 실측으로 기본 자세(`yaw = -135°`)는
    // 12개(면 3 · 모서리 5 · 꼭짓점 4)인데 1° 만 틀어도 13개가 된다. 45° 에서만 모서리
    // `-X+Z`·`+X-Z` 의 `dot(법선, forward)` 가 정확히 0 이라 둘이 함께 `CULL_EPSILON` 에
    // 걸리기 때문이다. 범위는 자세 193,320개를 훑어 잰 값이며(개수는 9 · 12 · 13 뿐, 9 는
    // 면 정면 자세) 유닛 테스트가 쓰는 경계와 같다(`navCubeGeometry.test.ts`).
    // 화살표는 후면 제거 대상이 아니라 항상 `d` 가 차 있으므로 여기서도 `.region` 으로 좁힌다.
    const drawn = await page.locator('#nav-cube path.region[d]:not([d=""])').count();
    expect(drawn, `그려진 영역 ${drawn}개 — 9–13 밖이다`).toBeGreaterThanOrEqual(9);
    expect(drawn, `그려진 영역 ${drawn}개 — 9–13 밖이다`).toBeLessThanOrEqual(13);
    await expect(page.locator('#nav-cube path.clickable')).toHaveCount(14);
  });

  test('TOP 면을 클릭하면 위에서 내려다보는 자세로 간다', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Y');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    // 월드 `+Y` 를 내려다보므로 시선은 `-Y` 다 (plan.md 의 라벨 ↔ 월드 축 표).
    expectAxis((await cameraAxes(page)).forward, [0, -1, 0], 'forward');
    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });

  test('캔버스를 드래그하면 큐브가 같이 돈다 — 라벨 배치가 바뀐다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const topLabel = page.locator('#nav-cube text[data-face="TOP"]');
    const before = await topLabel.getAttribute('transform');
    expect(before, 'TOP 라벨에 배치 행렬이 없다').not.toBeNull();

    // 수평 드래그는 화면 수직축 회전이므로 TOP 은 계속 보인다 — 사라져서 바뀌는 것이 아니라
    // **배치가** 바뀌는 것을 본다.
    const box = (await page.locator('#canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const span = Math.min(box.width, box.height) * 0.08;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + (span * i) / 5, cy);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);

    expect(await topLabel.getAttribute('transform'), '큐브가 카메라를 따라오지 않았다').not.toBe(
      before,
    );
  });

  test('Toggle Viewer Panel 로 패널과 함께 사라지고 함께 돌아온다', async ({ page }) => {
    await page.goto('/?fixture=cube.stl');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setPanelVisible', visible: false });
    await expect(page.locator('#panel')).toBeHidden();
    // 숨김 상태에서는 뷰포트에 아무것도 남지 않아야 한다 — 큐브만 남으면 그 성질이 깨진다.
    await expect(page.locator('#nav-cube')).toBeHidden();

    await sendHostMessage(page, { type: 'setPanelVisible', visible: true });
    await expect(page.locator('#panel')).toBeVisible();
    await expect(page.locator('#nav-cube')).toBeVisible();
  });

  test('측정 모드에서 큐브를 두 번 클릭해도 측정이 생기지 않는다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await sendHostMessage(page, { type: 'setMeasureMode', active: true });
    await expect(page.locator('#root')).toHaveAttribute('data-measure', 'on');

    // 두 번 클릭한다 — 측정은 두 점으로 하나가 되므로, 한 번만 눌러서는 "새지 않았다"를
    // 증명하지 못한다. 첫 클릭 뒤 TOP 은 정면으로 오므로 두 번째도 같은 라벨을 겨냥할 수 있다.
    await clickCubeFace(page, '+Y');
    expect(await waitForIdle(page), '첫 클릭의 보간이 끝나지 않았다').toBe(true);
    await clickCubeFace(page, '+Y');
    expect(await waitForIdle(page), '두 번째 클릭 후 멈추지 않았다').toBe(true);

    await expect(page.locator('#root')).toHaveAttribute('data-measure-count', '0');
    await expect(page.locator('#labels .measure-label')).toHaveCount(0);
    // 클릭이 큐브에 **먹혔다는** 증거까지 함께 요구한다. 이것이 없으면 클릭이 캔버스로 새어
    // 나갔더라도 (큐브가 뜬 좌상단에는 모델이 없으므로) 측정이 안 생겨서 초록이 된다.
    expectAxis((await cameraAxes(page)).forward, [0, -1, 0], 'forward');
  });

  test('큐브 상자의 빈 공간을 드래그하면 캔버스가 그대로 궤도 회전을 받는다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // 90px 상자 안이지만 팔각 실루엣 밖인 좌상단 모서리. 실측으로 이 점의 `elementFromPoint` 는
    // `#canvas` 다 — svg 가 `pointer-events: none` 이고 클릭 대상 `path` 만 `auto` 이기 때문이다.
    const box = (await page.locator('#nav-cube').boundingBox())!;
    const x = box.x + 3;
    const y = box.y + 3;

    const before = await cameraAxes(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(x + i * 4, y);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);
    const after = await cameraAxes(page);

    // 부호까지 절대 기준으로 단정한다 — `회전 방향 규약 (절대 방향)` 과 같은 규약이다:
    // 오른쪽으로 드래그하면 시선 변화가 화면 오른쪽(+right)으로 간다.
    const projected = turnSign(before.forward, after.forward, before.right);
    expect(
      projected,
      `투영값 ${projected.toFixed(4)} — 빈 공간이 캔버스로 내려가지 않았거나 방향이 뒤집혔다`,
    ).toBeGreaterThan(0.005);
  });

  test('큐브를 클릭한 뒤에도 방향키가 카메라를 돌린다 — 포커스가 캔버스로 돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // 큐브는 설정 표면이 아니라 **카메라 조작기**다. "큐브로 TOP 을 보고 방향키로 미세 조정"
    // 이 기본 흐름이므로, 클릭이 포커스를 앗아가면 그 흐름이 조용히 끊긴다. SVG `path` 는
    // focusable 이 아니라 클릭이 `#canvas`(tabindex=0)의 포커스를 `<body>` 로 흘려보내고,
    // `keydown` 은 **캔버스에** 달려 있어(`cameraInput.ts`) 더는 도달하지 않는다.
    //
    // 실측(고치기 전): 큐브 `+Y` 클릭 후 `document.activeElement` = `BODY`, ArrowRight 200ms 의
    // 시선 변화량 **0.0000** (캔버스를 다시 클릭하면 1.83). 기존 `방향키 회전 방향` 은 늘
    // 캔버스를 먼저 클릭하므로 이 조합을 보지 못한다.
    await clickCubeFace(page, '+Y');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);
    expect(
      await page.evaluate(() => document.activeElement?.id ?? ''),
      '큐브 클릭이 캔버스의 포커스를 앗아갔다',
    ).toBe('canvas');

    // 포커스만 보고 끝내지 않는다 — 키가 실제로 카메라를 움직이는지까지 잰다. 포커스가 맞아도
    // 리스너가 빠지면 그것을 잡아야 한다.
    const before = await cameraAxes(page);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowRight');
    expect(await waitForIdle(page), '방향키 후 멈추지 않았다').toBe(true);
    const after = await cameraAxes(page);

    // 부호까지 절대 기준으로 단정한다 — 오른쪽 키는 시선을 화면 오른쪽(`+right`)으로 보낸다
    // (`회전 방향 규약 (절대 방향)` 과 같은 규약). TOP 자세에서 실측 `+0.9738`.
    const projected = turnSign(before.forward, after.forward, before.right);
    expect(
      projected,
      `투영값 ${projected.toFixed(4)} — 큐브 클릭 뒤 방향키가 죽었거나 방향이 뒤집혔다`,
    ).toBeGreaterThan(0.005);
  });
});

/**
 * **큐브 클릭이 어느 방향을 보게 하는가 — 절대 좌표로.**
 *
 * 회고 `260828` 의 교훈 1: *"조작 방향은 절대 기준으로 테스트한다 — '서로 같은가'만으로는
 * 부족하다."* "클릭한 면이 정면으로 온다" 같은 **상대 규약만 쓰면 14개 자세가 통째로 뒤집혀도
 * 초록으로 통과한다** — v0.3.0 의 두 축 전역 반전이 실제로 그렇게 통과했다.
 *
 * 기준은 월드 축이다 (plan.md 의 라벨 ↔ 월드 축 표): `TOP = +Y` · `FRONT = +Z` · `RIGHT = +X`.
 * 어떤 면을 정면으로 보면 시선은 그 법선의 **반대**이므로 `FRONT` 클릭은 `forward = [0, 0, -1]`
 * 이어야 한다. 영역 id 도 같은 축 표기다(`clickCubeFace`).
 */
test.describe('큐브 클릭 방향 규약 (절대 방향)', () => {
  test('첫 로드는 RIGHT·TOP·FRONT 를 본다 — forward 세 성분이 모두 음수다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // 시선이 `-X`·`-Y`·`-Z` 쪽이면 카메라는 `+X`(RIGHT)·`+Y`(TOP)·`+Z`(FRONT) 쪽에 있다.
    // 실측: `yaw = -3π/4`, `pitch = π/2 - π/2.5` → `forward = [-0.672, -0.309, -0.672]`.
    // 정확한 값을 박지 않는 것은 프레이밍 각도를 조금 조정할 여지를 남기려는 것이고, 대신
    // **`-0.1` 로 잘라 성분이 0 에 붙는 경우를 배제한다** — 0 에 붙으면 그 면은 실루엣에
    // 걸려 사실상 보이지 않으므로 "세 면을 본다"가 거짓이 된다.
    const { forward } = await cameraAxes(page);
    const shown = forward.map((n) => n.toFixed(3)).join(', ');
    for (const [axis, face] of (['RIGHT', 'TOP', 'FRONT'] as const).entries()) {
      expect(forward[axis], `forward = [${shown}] — ${face} 를 보지 않는다`).toBeLessThan(-0.1);
    }
  });

  test('FRONT 를 클릭하면 앞에서 본다 — forward = [0, 0, -1]', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    const axes = await cameraAxes(page);
    expectAxis(axes.forward, [0, 0, -1], 'forward');
    // 롤 0 — 비축퇴 면의 규약은 "화면 up 이 월드 `+Y` 에 가장 가깝다"이고, `+Z` 를 정면으로
    // 보는 자세에서 그 최댓값은 정확히 `+Y` 다.
    expectAxis(axes.up, [0, 1, 0], 'up');
    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });

  test('RIGHT 를 클릭하면 오른쪽에서 본다 — forward = [-1, 0, 0]', async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+X');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    const axes = await cameraAxes(page);
    expectAxis(axes.forward, [-1, 0, 0], 'forward');
    expectAxis(axes.up, [0, 1, 0], 'up');
    expect(problems, `콘솔 경고: ${problems.join(' | ')}`).toEqual([]);
  });

  test('TOP 을 클릭하면 위에서 내려다보고 FRONT 가 화면 아래로 온다 — 축퇴 규약', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Y');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    // 법선이 `±Y` 와 나란해 "up 이 `+Y` 에 가장 가깝다"가 정의되지 않는 자리다. 규약을
    // **못 박아 두었으므로 그 값 자체를 단정한다** — `up = -Z` 이면 `FRONT` 가 화면 아래로 온다
    // (`navCubePose.ts` 의 축퇴 주석). up 을 재지 않으면 화면이 어느 쪽으로 돌아앉든 통과한다.
    const axes = await cameraAxes(page);
    expectAxis(axes.forward, [0, -1, 0], 'forward');
    expectAxis(axes.up, [0, 0, -1], 'up');
  });

  test('롤이 섞인 자세에서 면을 클릭하면 시야가 수평으로 복귀한다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // 비스듬한 드래그는 화면 수직축·수평축 회전을 **함께** 걸어 롤을 만든다. 시작 자세의 롤은
    // 정확히 0 이고(실측 `right · +Y = -0.0000`), 한 축만 끌어도 0 으로 남으므로 대각선이어야
    // 한다. 왼쪽아래(`↙`)로 끄는 것은 실측 결과다 — 이 방향이면 회전 뒤에도 `FRONT` 면이
    // 넉넉히(법선 투영 0.58) 앞을 향해 클릭 대상으로 남는다.
    const box = (await page.locator('#canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const span = Math.min(box.width, box.height) * 0.08;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx - (span * i) / 5, cy + (span * i) / 5);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);

    // **롤이 실제로 생겼는지 먼저 단정한다.** 롤이 0 인 채로 클릭하면 이 테스트는 아무것도
    // 지키지 않는다. 롤의 정의는 "화면 수평축이 월드에서 기울어졌다" = `right · +Y ≠ 0` 이며,
    // 실측값은 `-0.46` 이다(관성 꼬리 포함).
    const rolled = await cameraAxes(page);
    const rolledShown = rolled.right.map((n) => n.toFixed(3)).join(', ');
    expect(
      Math.abs(rolled.right[1]),
      `right = [${rolledShown}] — 대각 드래그가 롤을 만들지 못했다`,
    ).toBeGreaterThan(0.2);

    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    // 축퇴 규약을 가진 `TOP`/`BOTTOM` 은 일부러 `up = ∓Z` 로 못 박혀 있어 이 단정의 대상이
    // 아니다. 나머지 네 면은 전부 `up = +Y` 로 복귀한다.
    const level = await cameraAxes(page);
    const levelShown = level.up.map((n) => n.toFixed(3)).join(', ');
    expectAxis(level.forward, [0, 0, -1], 'forward');
    expect(level.up[1], `up = [${levelShown}] — 시야가 수평으로 돌아오지 않았다`).toBeGreaterThan(
      0.99,
    );
  });
});

/**
 * 화살표를 클릭한다. 화살표 `path` 는 **후면 제거 대상이 아니므로** 어떤 자세에서도 넓이가
 * 있고, 면 `path` 를 연속 클릭할 때의 타임아웃 함정(`clickCubeFace` 주석)이 없다.
 *
 * `locator.click()` 은 바운딩 박스 중심을 찍는다. 이등변삼각형이 축 방향을 향하므로 그 중심은
 * 항상 대칭축 위, 즉 삼각형 안이다(실측: 오른쪽 화살표의 bbox 중심 `x` 에서 반폭이 4.5px 남는다).
 */
async function clickCubeArrow(page: Page, arrow: string): Promise<void> {
  await page.locator(`#nav-cube-arrow-${arrow}`).click();
  // `clickCubeFace` 와 같은 이유 — 클릭이 반환된 순간에는 아직 한 프레임도 그리지 않아
  // `isIdle` 이 true 다. 보간 300ms 를 넘겨 기다린다.
  await page.waitForTimeout(500);
}

/**
 * **4방향 화살표 — 화면 기준 90° 회전을 절대 방향으로 못 박는다.**
 *
 * 회고 `260828` 의 교훈 3: 조작 방향은 절대 기준으로 단정해야 한다. *"화살표끼리 서로
 * 반대인가"* 만 보면 네 방향이 통째로 뒤집혀도 초록이 되고, v0.3.0 의 두 축 전역 반전이
 * 실제로 그렇게 통과했다.
 *
 * 기준은 드래그 규약(ADR `260826-232902`)이다 — **오른쪽 드래그는 시선을 화면 오른쪽
 * (`+right`)으로, 아래 드래그는 화면 아래(`-up`)로 보낸다.** 화살표는 `OrbitCamera.rotate()` 의
 * 축 규약을 그대로 post-multiply 하므로 같은 부호가 나온다. 유닛 테스트
 * (`navCubePose.test.ts`)가 쿼터니언 수준에서 같은 값을 재고, 여기서는 **실제 DOM 클릭**이
 * 그 자세까지 도달하는지를 본다.
 *
 * **직교 성분도 함께 단정한다** — 부호만 보면 `▶` 와 `▼` 가 서로 맞바뀌어도 통과한다.
 * 시작 자세에서 실측한 값은 정확히 `±1.0000` 과 `0.0000` 이다(90° 회전이므로 `Δforward` 가
 * 정확히 그 축 위에 놓인다).
 */
test.describe('화살표 4방향 (절대 방향)', () => {
  for (const { arrow, glyph, dRight, dUp } of [
    { arrow: 'right', glyph: '▶', dRight: 1, dUp: 0 },
    { arrow: 'left', glyph: '◀', dRight: -1, dUp: 0 },
    { arrow: 'down', glyph: '▼', dRight: 0, dUp: -1 },
    { arrow: 'up', glyph: '▲', dRight: 0, dUp: 1 },
  ] as const) {
    test(`${glyph} 를 누르면 시선이 [right ${dRight}, up ${dUp}] 쪽으로 90° 돈다`, async ({
      page,
    }) => {
      await page.goto('/?fixture=cube.glb');
      expect(await waitForViewer(page)).toBe('ready');

      const before = await cameraAxes(page);
      await clickCubeArrow(page, arrow);
      expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);
      const after = await cameraAxes(page);

      const alongRight = turnSign(before.forward, after.forward, before.right);
      const alongUp = turnSign(before.forward, after.forward, before.up);
      const shown = `Δforward·right = ${alongRight.toFixed(4)} · Δforward·up = ${alongUp.toFixed(4)}`;
      // 실측 `±1.0000`. 0.5 로 자르는 것은 90° 미달(축이 섞였다)까지 걸러 내려는 것이다.
      for (const [value, want, axis] of [
        [alongRight, dRight, 'right'],
        [alongUp, dUp, 'up'],
      ] as const) {
        if (want === 0) {
          expect(Math.abs(value), `${shown} — ${axis} 성분이 남았다 (축이 뒤바뀌었다)`).toBeLessThan(
            0.1,
          );
        } else {
          expect(value * want, `${shown} — ${axis} 방향이 뒤집혔거나 90° 를 못 돌았다`).toBeGreaterThan(
            0.5,
          );
        }
      }
    });
  }

  /**
   * **정규 자세에서 화살표를 누르면 이웃 면의 정규 자세에 정확히 도달한다 (롤 0 유지).**
   *
   * plan 의 완료 기준 (e) 는 출발 자세를 `TOP` 으로 적었지만 **`TOP` 에서는 성립하지 않는다** —
   * 축퇴 규약이 `TOP` 의 화면 up 을 월드 `-Z` 로 못 박았고(ADR `260826-232902`) 화면 수직축
   * 회전이 그 up 을 보존하므로, `RIGHT`(정규 up = 월드 `+Y`)에는 90° 롤이 남은 채 도달한다
   * (실측 `forward = [-1, 0, 0]` · `up = [0, 0, -1]` · `up · +Y = 0`). part 1/2 가 DoD (e) 를
   * `FRONT` 로 좁힌 것과 **같은 이유이며 같은 두 면(`TOP`/`BOTTOM`)이 원인**이다.
   *
   * 그래서 축퇴가 아닌 `FRONT` 에서 잰다 — 거기서는 네 화살표 전부가 정확히 도달한다
   * (유닛 테스트가 넷을 다 단정하고, 여기서는 왕복을 본다). `FRONT → ▶ → RIGHT → ◀ → FRONT`
   * 왕복인 이유: 화살표는 후면 제거되지 않으므로 면 `path` 와 달리 연속 클릭이 안전하고,
   * 왕복이면 두 부호가 서로를 되돌린다는 것까지 함께 잡힌다.
   */
  test('FRONT 에서 ▶ 는 RIGHT 정규 자세로, 거기서 ◀ 는 FRONT 로 정확히 되돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), 'FRONT 보간이 끝나지 않았다').toBe(true);
    expectAxis((await cameraAxes(page)).forward, [0, 0, -1], 'FRONT forward');

    await clickCubeArrow(page, 'right');
    expect(await waitForIdle(page), '▶ 보간이 끝나지 않았다').toBe(true);
    const right = await cameraAxes(page);
    // `RIGHT` 정규 자세 — `+X` 면을 정면으로 보므로 시선은 `-X`, 그리고 **롤 0** 이라 up 은 `+Y` 다.
    expectAxis(right.forward, [-1, 0, 0], 'RIGHT forward');
    expectAxis(right.up, [0, 1, 0], 'RIGHT up');

    await clickCubeArrow(page, 'left');
    expect(await waitForIdle(page), '◀ 보간이 끝나지 않았다').toBe(true);
    const back = await cameraAxes(page);
    expectAxis(back.forward, [0, 0, -1], '되돌아온 forward');
    expectAxis(back.up, [0, 1, 0], '되돌아온 up');
  });

  /**
   * **보간 중에 같은 화살표를 다시 눌러도 90° 가 누적된다.**
   *
   * 화살표의 목적지는 절대값이 아니라 **상대값**(현재 자세 + 90°)이므로, 보간 중인 자세에서
   * 계산하면 아직 남은 각도가 조용히 버려진다. 실측(고치기 전, `FRONT` 에서 `▶` 두 번, 180° 가
   * 목표): 간격 0ms **93.15°** · 60ms **111.24°** · 120ms **131.94°** · 200ms **153.84°** ·
   * 280ms 178.59° 이고, **네이티브 더블클릭은 90.00°** 로 두 번째 클릭이 통째로 삼켜졌다
   * (그 시점의 목적 자세가 첫 클릭의 목적 자세와 거의 같아 no-op 이 된다). 180° 를 보려면
   * 화살표를 두 번 누르는 것이 **유일한 방법**이므로 정상 사용 경로다.
   *
   * `clickCubeArrow` 를 쓰지 않는다 — 그 헬퍼는 매 클릭 뒤 500ms 를 기다려 보간을 끝내므로
   * 이 구간을 구조적으로 볼 수 없다(그래서 기존 e2e 가 전부 초록이었다).
   */
  test('▶ 를 더블클릭하면 BACK 까지 180° 를 돈다 — 보간 중 클릭이 삼켜지지 않는다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), 'FRONT 보간이 끝나지 않았다').toBe(true);
    expectAxis((await cameraAxes(page)).forward, [0, 0, -1], 'FRONT forward');

    await page.locator('#nav-cube-arrow-right').dblclick();
    // **여기서 곧바로 유휴를 물으면 안 된다** — `clickCubeFace` 가 기록한 함정이다: dirty 를
    // 세우는 것은 렌더 루프의 `orbit.tick()` 이라 클릭이 반환된 순간에는 아직 한 프레임도
    // 그리지 않았고 `isIdle` 이 여전히 true 다(실측으로 `waitForIdle` 이 즉시 통과해 **클릭
    // 전 자세**를 읽었다 — `forward = [0, 0, -1]`). 두 번째 클릭의 보간까지 넘겨 기다린다.
    await page.waitForTimeout(500);
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    // **절대 방향으로 단정한다** — 180° 를 각도로만 재면 어느 쪽으로 돌았는지 알 수 없다.
    // `FRONT` 에서 오른쪽으로 두 번 돌면 `BACK`(시선 `+Z`)이고 롤은 0 그대로다.
    const back = await cameraAxes(page);
    expectAxis(back.forward, [0, 0, 1], 'BACK forward');
    expectAxis(back.up, [0, 1, 0], 'BACK up');
  });

  test('▶ 직후 ◀ 를 누르면 원래 자세로 정확히 되돌아온다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), 'FRONT 보간이 끝나지 않았다').toBe(true);

    // 보간(300ms)의 한복판에서 반대 화살표를 누른다. 실측(고치기 전): 원래 자세에서
    // **61.44° 어긋난** 곳에 남았다 — 되돌리려던 회전이 절반만 취소된다.
    await page.locator('#nav-cube-arrow-right').click();
    await page.waitForTimeout(80);
    await page.locator('#nav-cube-arrow-left').click();
    // 위와 같은 이유로 유휴를 곧바로 묻지 않는다 (`clickCubeFace` 의 함정).
    await page.waitForTimeout(500);
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

    const back = await cameraAxes(page);
    expectAxis(back.forward, [0, 0, -1], '되돌아온 forward');
    expectAxis(back.up, [0, 1, 0], '되돌아온 up');
  });

  test('화살표 4개가 큐브 바깥 상·하·좌·우에 있다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const boxes = await Promise.all(
      ['up', 'down', 'left', 'right'].map(async (arrow) => ({
        arrow,
        box: (await page.locator(`#nav-cube-arrow-${arrow}`).boundingBox())!,
      })),
    );
    for (const { arrow, box } of boxes) {
      expect(box, `${arrow} 화살표가 없다`).not.toBeNull();
    }

    // 상자 중심에서 벗어난 방향을 **절대 좌표로** 단정한다 — 넷이 서로 다른 자리에 있다는
    // 것만 보면 상·하·좌·우가 통째로 회전해도 통과한다. 큐브 폴리곤은 상자 중앙 90px 에
    // 그려지므로(외접반지름에 맞춘 투영) 화살표 상자는 그 밖에 있어야 한다.
    const cubeBox = (await page.locator('#nav-cube').boundingBox())!;
    const cx = cubeBox.x + cubeBox.width / 2;
    const cy = cubeBox.y + cubeBox.height / 2;
    const at = (arrow: string): { x: number; y: number } => {
      const { box } = boxes.find((b) => b.arrow === arrow)!;
      return { x: box.x + box.width / 2 - cx, y: box.y + box.height / 2 - cy };
    };
    // 큐브 폴리곤의 최대 반지름은 45px 다 — 화살표 중심은 그보다 밖에 있어야 "바깥"이다.
    for (const [arrow, axis, sign] of [
      ['up', 'y', -1],
      ['down', 'y', 1],
      ['left', 'x', -1],
      ['right', 'x', 1],
    ] as const) {
      const offset = at(arrow);
      const shown = `중심에서 [${offset.x.toFixed(1)}, ${offset.y.toFixed(1)}]`;
      expect(offset[axis] * sign, `${arrow} 화살표가 반대쪽에 있다 — ${shown}`).toBeGreaterThan(45);
      const other = axis === 'x' ? 'y' : 'x';
      expect(Math.abs(offset[other]), `${arrow} 화살표가 변 중앙에 없다 — ${shown}`).toBeLessThan(2);
    }
  });

  /**
   * **화살표를 누른 뒤에도 방향키가 살아 있어야 한다.**
   *
   * part 1/2 가 실측으로 잡은 결함이 화살표에도 그대로 재발할 수 있다 — SVG `path` 는
   * focusable 이 아니므로 클릭이 `#canvas`(tabindex=0)의 포커스를 `<body>` 로 흘려보내고,
   * `keydown` 을 **캔버스에서** 듣는 `cameraInput` 이 이벤트를 못 받는다(실측: 큐브 클릭 후
   * ArrowRight 200ms 의 시선 변화 **0.0000** vs 캔버스 클릭 후 **1.65**).
   *
   * 화살표는 큐브 클릭과 **같은 `animateTo` 콜백**을 지나므로 `main.ts` 의 `canvas.focus()` 를
   * 공짜로 물려받는다. 그 공짜가 실제로 성립하는지를 여기서 단정한다 — 화살표가 다른 경로를
   * 타게 되는 순간 이 테스트가 잡는다.
   */
  test('화살표를 누른 뒤에도 방향키가 카메라를 돌린다 — 포커스가 캔버스로 돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeArrow(page, 'right');
    expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);
    expect(
      await page.evaluate(() => document.activeElement?.id ?? ''),
      '화살표 클릭이 캔버스의 포커스를 앗아갔다',
    ).toBe('canvas');

    // 포커스만 보고 끝내지 않는다 — 키가 실제로 카메라를 움직이는지까지, 부호까지 잰다.
    const before = await cameraAxes(page);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowRight');
    expect(await waitForIdle(page), '방향키 후 멈추지 않았다').toBe(true);
    const after = await cameraAxes(page);

    const projected = turnSign(before.forward, after.forward, before.right);
    expect(
      projected,
      `투영값 ${projected.toFixed(4)} — 화살표 클릭 뒤 방향키가 죽었거나 방향이 뒤집혔다`,
    ).toBeGreaterThan(0.005);
  });
});

/**
 * **자세를 건드리지 않는 조작은 진행 중인 보간을 폐기해서는 안 된다.**
 *
 * 휠 줌 · 우드래그 팬 · Alt+방향키 줌은 이전 관성을 정리하려고 `orbit.stop()` 을 불렀고, 그
 * 함수가 자세 보간까지 버렸다 — 클릭한 면에 **도달하지 못한 임의의 자세에서 그대로 굳는다.**
 * 실측(고치기 전, 1000x700 · cube.glb): `TOP` 클릭 80ms 뒤 휠 1노치 → 목표 `[0,-1,0]` 에서
 * **40.63° 미달**(200ms 뒤면 18.93°) · 우드래그 팬 → 90° 중 **29.34°** · Alt+방향키 줌 →
 * **24.33°**. "큐브로 면을 보고 곧바로 스크롤로 확대"는 300ms 안에 일어나는 정상 흐름이므로
 * 상시 재현됐다. 고친 방향은 `stop()`(자세를 가져가는 조작)과 `stopInertia()`(줌·팬)의 분리다.
 *
 * `clickCubeFace` 를 쓰지 않는다 — 그 헬퍼는 클릭 뒤 500ms 를 기다려 보간을 끝내므로 **보간
 * 중에 다른 입력을 넣는** 이 구간을 볼 수 없다(part 2/2 시점의 e2e 81개 중 이 구간을 보는
 * 것이 0건이었다).
 */
test.describe('보간 중 다른 조작 (자세를 건드리지 않는 입력)', () => {
  for (const { label, evidence, disturb } of [
    {
      label: '휠 줌',
      evidence: 'radius',
      disturb: async (page: Page, cx: number, cy: number): Promise<void> => {
        await page.mouse.move(cx, cy);
        await page.mouse.wheel(0, 100);
      },
    },
    {
      label: '우드래그 팬',
      evidence: 'target',
      disturb: async (page: Page, cx: number, cy: number): Promise<void> => {
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'right' });
        for (let i = 1; i <= 4; i++) {
          await page.mouse.move(cx + i * 8, cy);
        }
        await page.mouse.up({ button: 'right' });
      },
    },
    {
      label: 'Alt + 방향키 줌',
      evidence: 'radius',
      disturb: async (page: Page, cx: number, cy: number): Promise<void> => {
        // 포커스는 큐브 클릭이 이미 캔버스로 되돌려 놓았다(`main.ts` 의 `canvas.focus()`).
        await page.mouse.move(cx, cy);
        await page.keyboard.down('Alt');
        await page.keyboard.down('ArrowUp');
        await page.waitForTimeout(60);
        await page.keyboard.up('ArrowUp');
        await page.keyboard.up('Alt');
      },
    },
  ] as const) {
    test(`TOP 을 클릭한 직후 ${label} 을 넣어도 정규 자세에 도달한다`, async ({ page }) => {
      await page.goto('/?fixture=cube.glb');
      expect(await waitForViewer(page)).toBe('ready');

      const box = (await page.locator('#canvas').boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const before = await cameraState(page);

      await page.locator('#nav-cube path[data-region="+Y"]').click();
      // 300ms 보간의 한복판 — 여기서 방해가 들어와야 이 테스트가 무언가를 잰다.
      await page.waitForTimeout(80);
      await disturb(page, cx, cy);
      expect(await waitForIdle(page), '보간이 끝나지 않았다').toBe(true);

      // **방해가 실제로 먹혔음을 먼저 단정한다.** 입력이 조용히 무시되면(예: 휠 핸들러가
      // 사라지면) 자세는 당연히 도달하고 이 테스트는 아무것도 재지 않는다.
      const after = await cameraState(page);
      if (evidence === 'radius') {
        const ratio = after.radius / before.radius;
        expect(
          Math.abs(ratio - 1),
          `거리 배율 ${ratio.toFixed(4)} — ${label} 이 먹히지 않았다`,
        ).toBeGreaterThan(0.005);
      } else {
        const moved = Math.hypot(...after.target.map((v, i) => v - before.target[i]));
        expect(
          moved,
          `타깃이 ${moved.toFixed(4)} 만 움직였다 — ${label} 이 먹히지 않았다`,
        ).toBeGreaterThan(before.radius * 0.005);
      }

      // `TOP` 정규 자세 — 축퇴 규약이 화면 up 을 월드 `-Z` 로 못 박는다(`navCubePose.ts`).
      const axes = await cameraAxes(page);
      expectAxis(axes.forward, [0, -1, 0], `${label} 뒤 forward`);
      expectAxis(axes.up, [0, 0, -1], `${label} 뒤 up`);
    });
  }
});

/**
 * **홈 버튼 — 회전·줌·팬을 한 번에 첫 상태로 되돌린다.**
 *
 * 기대값을 상수로 박지 않고 **첫 로드 직후에 읽은 값**과 비교한다. `resetView()` 는
 * `orbit.frame(extents)` 하나이고 그것이 첫 로드와 **같은 코드 경로**이기 때문이다
 * (`viewer.ts` 의 `createCamera`: 복원값이 없으면 `frame()`). 덕분에 프레이밍 각도(`-3π/4`·18°)나
 * 거리 배율(1.6)을 나중에 조정해도 이 테스트는 계속 옳다.
 *
 * `clickCubeFace`·`clickCubeArrow` 와 달리 **보간을 기다리지 않는다** — `frame()` 은 `stop()` 으로
 * 진행 중인 애니메이션과 관성을 끊고 자세·거리·타깃을 즉시 쓴다. 클릭이 반환된 시점에 이미 최종
 * 값이므로 여기서는 대기가 아무것도 사 주지 않는다.
 */
test.describe('홈 버튼', () => {
  /**
   * 회전(좌드래그) · 줌(휠) · 팬(우드래그)을 차례로 준다. 버튼 매핑은 `cameraInput.ts` 의 규약이다.
   *
   * 셋을 한 번에 주는 이유: `resetView()` 가 셋 중 둘만 되돌려도 걸려야 한다. 실측 변화량은
   * 자세 **0.9420 rad** · 거리 **×1.0600** · 타깃 **0.7955**(반지름 16.78 의 4.74%)다.
   */
  async function disturbCamera(page: Page): Promise<void> {
    const box = (await page.locator('#canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + i * 12, cy + i * 6);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '회전 드래그 후 멈추지 않았다').toBe(true);

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 300);
    expect(await waitForIdle(page), '휠 줌 후 멈추지 않았다').toBe(true);

    // 오른쪽 버튼 = 팬. `contextmenu` 는 캔버스에서 막혀 있다(`cameraInput.ts`).
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + i * 16, cy - i * 8);
    }
    await page.mouse.up({ button: 'right' });
    expect(await waitForIdle(page), '팬 드래그 후 멈추지 않았다').toBe(true);
  }

  test('회전·줌·팬을 준 뒤 누르면 첫 로드 직후의 자세·거리·타깃으로 정확히 돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');
    const first = await cameraState(page);

    await disturbCamera(page);
    const moved = await cameraState(page);

    // **셋이 실제로 바뀌었음을 먼저 단정한다.** 이것이 없으면 조작이 조용히 먹히지 않게 된
    // 뒤에도(예: 버튼 매핑이 바뀌어 우드래그가 팬이 아니게 되면) "돌아왔다"가 초록으로 통과한다.
    // 임계값은 실측값(0.9420 / 1.0600 / 4.74%)의 절반 이하로 잡아 여유를 둔다.
    const dot = Math.abs(first.orientation.reduce((sum, v, i) => sum + v * moved.orientation[i], 0));
    const turned = 2 * Math.acos(Math.min(1, dot));
    expect(turned, `자세가 ${turned.toFixed(4)} rad 만 바뀌었다 — 회전이 먹히지 않았다`).toBeGreaterThan(0.5);
    const zoomRatio = moved.radius / first.radius;
    expect(
      Math.abs(zoomRatio - 1),
      `거리 배율 ${zoomRatio.toFixed(4)} — 줌이 먹히지 않았다`,
    ).toBeGreaterThan(0.03);
    const panned = Math.hypot(...moved.target.map((v, i) => v - first.target[i]));
    expect(
      panned,
      `타깃이 ${panned.toFixed(4)} 만 움직였다 — 팬이 먹히지 않았다`,
    ).toBeGreaterThan(first.radius * 0.02);

    await page.locator('#nav-cube-home').click();

    const back = await cameraState(page);
    const shown = `자세 [${back.orientation.map((n) => n.toFixed(6)).join(', ')}] · 거리 ${back.radius} · 타깃 [${back.target.join(', ')}]`;
    // 성분별로 잰다 — 회전각만 보면 롤이 남은 자세를 통과시킨다. 같은 코드 경로가 같은 입력으로
    // 다시 계산하므로 실제로는 **비트 단위로 같고**, 1e-6 은 그 여유다(plan 의 완료 기준).
    for (const [axis, want] of first.orientation.entries()) {
      expect(Math.abs(back.orientation[axis] - want), `${shown} — 자세가 첫 값과 다르다`).toBeLessThan(1e-6);
    }
    expect(Math.abs(back.radius - first.radius), `${shown} — 거리가 첫 값과 다르다`).toBeLessThan(1e-6);
    for (const [axis, want] of first.target.entries()) {
      expect(Math.abs(back.target[axis] - want), `${shown} — 타깃이 첫 값과 다르다`).toBeLessThan(1e-6);
    }
  });

  /**
   * **아이콘 실루엣 안쪽이 빈틈없이 채워지고, 그 안 어디를 찍어도 홈 버튼이 받아야 한다.**
   *
   * 안쪽 모서리 꺾은선을 실루엣과 **같은 `path`** 에 두면 SVG 가 채움 계산에서 그 열린
   * 서브패스를 암묵적으로 닫고, 감김 방향이 육각형과 반대라 `fill-rule: nonzero` 가 그
   * 삼각형을 0 으로 상쇄한다. 실측(고치기 전): `isPointInFill(115, 111.67)` = **false**,
   * 같은 지점의 `elementFromPoint` = **`CANVAS#canvas`** (`pointer-events` 의 기본값이
   * `visiblePainted` 이므로 구멍은 클릭도 흘려보낸다), 렌더 픽셀은 다크에서 **31**(배경
   * `#1f1f1f` 그대로) vs 채움 **109**. 육각형 259.8px² 중 **43.3px²(17%)** 가 뚫려 큐브가
   * 아니라 뚜껑 열린 상자로 읽혔고, 그 17% 를 클릭하면 뷰가 리셋되지 않고 클릭이 캔버스로
   * 새어 측정 모드에서는 픽으로 내려갔다.
   *
   * 육각형 기하를 bbox 에서 유도해 훑는다 — 상수를 박으면 `HOME_RADIUS` 를 바꿀 때 조용히
   * 빗나간다. 경계의 안티에일리어싱을 피해 안쪽 90% 만 본다.
   */
  test('홈 아이콘의 실루엣 안쪽이 빈틈없이 채워지고 전부 클릭을 받는다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const bad = await page.evaluate(() => {
      const el = document.getElementById('nav-cube-home') as unknown as SVGGeometryElement;
      const svg = (el as unknown as SVGElement).ownerSVGElement!;
      const svgBox = svg.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      // 등각 육각형: 반폭 `w` · 위아래 꼭짓점 `r` · 옆면 높이 `h = r/2` (`navCube.ts`).
      const w = box.width / 2;
      const r = box.height / 2;
      const h = r / 2;
      // viewBox 한 변과 CSS 폭이 같으므로(둘 다 134) 사용자 단위 = 상자 안의 px 다.
      const ux = box.x - svgBox.x + w;
      const uy = box.y - svgBox.y + r;
      const misses: { dx: number; dy: number; filled: boolean; hit: string }[] = [];
      for (let dx = -w; dx <= w; dx += 1) {
        const limit = r - (Math.abs(dx) * (r - h)) / w;
        for (let dy = -limit; dy <= limit; dy += 1) {
          if (Math.abs(dx) > w * 0.9 || Math.abs(dy) > limit * 0.9) {
            continue;
          }
          const filled = el.isPointInFill(new DOMPoint(ux + dx, uy + dy));
          const target = document.elementFromPoint(box.x + w + dx, box.y + r + dy);
          const hit = target ? `${target.tagName}#${target.id}` : 'none';
          if (!filled || target?.id !== 'nav-cube-home') {
            misses.push({ dx: Number(dx.toFixed(1)), dy: Number(dy.toFixed(1)), filled, hit });
          }
        }
      }
      return misses.slice(0, 8);
    });

    expect(bad, `실루엣 안쪽에 채워지지 않거나 클릭을 못 받는 점이 있다 — ${JSON.stringify(bad)}`).toEqual([]);
  });

  test('홈 버튼이 큐브 오른쪽 아래에 있다 — 화살표와 겹치지 않는다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const home = (await page.locator('#nav-cube-home').boundingBox())!;
    const box = (await page.locator('#nav-cube').boundingBox())!;
    const offset = {
      x: home.x + home.width / 2 - (box.x + box.width / 2),
      y: home.y + home.height / 2 - (box.y + box.height / 2),
    };
    const shown = `중심에서 [${offset.x.toFixed(1)}, ${offset.y.toFixed(1)}]`;

    // **절대 좌표로 단정한다** — "화살표 4개와 다른 자리에 있다"만 보면 네 모서리 중 어디로
    // 가도 통과한다. 오른쪽 아래는 `+x`·`+y`(SVG 는 y 가 아래로 양)다.
    // 두 성분이 모두 45 를 넘어야 큐브 폴리곤(최대 반지름 45px) 밖이고, 45 를 넘으면 변 중앙의
    // 화살표 띠(|수직 성분| ≤ 9)와도 자동으로 떨어진다. 실측 오프셋은 `[48, 48]` 이다.
    expect(offset.x, `홈 버튼이 오른쪽이 아니다 — ${shown}`).toBeGreaterThan(45);
    expect(offset.y, `홈 버튼이 아래가 아니다 — ${shown}`).toBeGreaterThan(45);
    // 상자 안에 있어야 클릭할 수 있다 — 넘치면 `overflow: visible` 로 보이기는 하지만 잘린다.
    expect(home.x + home.width, `홈 버튼이 상자 오른쪽으로 넘쳤다`).toBeLessThanOrEqual(box.x + box.width);
    expect(home.y + home.height, `홈 버튼이 상자 아래로 넘쳤다`).toBeLessThanOrEqual(box.y + box.height);
  });

  /**
   * **홈 버튼을 누른 뒤에도 방향키가 살아 있어야 한다.**
   *
   * part 1/2 가 실측으로 잡은 함정이 새 조작기마다 재발한다 — SVG `path` 는 focusable 이 아니므로
   * 클릭이 `#canvas`(tabindex=0)의 포커스를 `<body>` 로 흘려보내고, `keydown` 을 **캔버스에서**
   * 듣는 `cameraInput` 이 이벤트를 못 받는다(실측: 큐브 클릭 후 ArrowRight 200ms 의 시선 변화
   * **0.0000** vs 캔버스 클릭 후 **1.65**). 화살표는 면 클릭과 같은 콜백을 지나 `canvas.focus()`
   * 를 물려받았지만 **홈 버튼은 `resetView` 라는 다른 콜백**이므로 공짜가 아니다.
   */
  test('홈 버튼을 누른 뒤에도 방향키가 카메라를 돌린다 — 포커스가 캔버스로 돌아온다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await page.locator('#nav-cube-home').click();
    expect(
      await page.evaluate(() => document.activeElement?.id ?? ''),
      '홈 버튼 클릭이 캔버스의 포커스를 앗아갔다',
    ).toBe('canvas');

    // 포커스만 보고 끝내지 않는다 — 키가 실제로 카메라를 움직이는지까지, 부호까지 잰다.
    const before = await cameraAxes(page);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowRight');
    expect(await waitForIdle(page), '방향키 후 멈추지 않았다').toBe(true);
    const after = await cameraAxes(page);

    // 오른쪽 키는 시선을 화면 오른쪽(`+right`)으로 보낸다 (`회전 방향 규약 (절대 방향)`).
    const projected = turnSign(before.forward, after.forward, before.right);
    expect(
      projected,
      `투영값 ${projected.toFixed(4)} — 홈 버튼 클릭 뒤 방향키가 죽었거나 방향이 뒤집혔다`,
    ).toBeGreaterThan(0.005);
  });
});

/**
 * 삼각대의 원점 · 세 선의 끝점 · 세 문자의 자리를 **SVG 사용자 단위**로 읽는다. `#nav-cube` 의
 * viewBox 한 변과 CSS 폭이 같으므로(둘 다 134) 이 값은 그대로 상자 안의 px 다.
 *
 * 세 선이 원점을 공유하는지도 함께 잡힌다 — 하나라도 다른 자리에서 뻗으면 `origin` 이 축마다
 * 달라지므로 아래 테스트들이 그 차이를 본다.
 */
async function triadGeometry(page: Page): Promise<{
  origins: Record<string, [number, number]>;
  tips: Record<string, [number, number]>;
  labels: Record<string, [number, number]>;
}> {
  return page.evaluate(() => {
    const num = (el: Element, name: string): number => Number(el.getAttribute(name));
    const origins: Record<string, [number, number]> = {};
    const tips: Record<string, [number, number]> = {};
    const labels: Record<string, [number, number]> = {};
    for (const axis of ['x', 'y', 'z']) {
      const line = document.querySelector(`#nav-cube-triad-${axis}`)!;
      const text = document.querySelector(
        `#nav-cube-triad text[data-axis="${axis.toUpperCase()}"]`,
      )!;
      origins[axis] = [num(line, 'x1'), num(line, 'y1')];
      tips[axis] = [num(line, 'x2'), num(line, 'y2')];
      labels[axis] = [num(text, 'x'), num(text, 'y')];
    }
    return { origins, tips, labels };
  });
}

/**
 * **RGB 축 삼각대 — 큐브 왼쪽 아래.**
 *
 * 색은 이 조작기 하나만 `var(--vscode-*)` 를 벗어난다. 그 예외가 정당한 근거의 절반이
 * **`X`/`Y`/`Z` 문자를 함께 찍어 색맹 전달을 확보한다**는 것이므로(ADR `260828-204140` ·
 * `260826-094348`), 문자의 존재는 장식이 아니라 **결정의 전제**다 — 그래서 여기서 단정한다.
 *
 * 삼각대는 **클릭 대상이 아니다.** 그 위를 드래그하면 아래 캔버스가 궤도 회전을 받아야 한다.
 */
test.describe('축 삼각대 (RGB)', () => {
  test('선 3개와 X/Y/Z 문자 3개가 있고, 색이 선과 문자에 같이 붙는다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await expect(page.locator('#nav-cube-triad line')).toHaveCount(3);
    await expect(page.locator('#nav-cube-triad text')).toHaveCount(3);
    expect(
      await page.locator('#nav-cube-triad text').allTextContents(),
      '문자를 빼면 유채색 예외의 근거 절반이 사라진다 (ADR 260828-204140)',
    ).toEqual(['X', 'Y', 'Z']);

    // **채널의 최댓값으로 단정한다** — hex 를 박으면 밝기 조정마다 테스트가 깨지지만, "X 는
    // 빨강 · Y 는 초록 · Z 는 파랑"은 업계 관례이고 바뀌면 그것이 결함이다. 선과 문자가 같은
    // 색이어야 한다는 것도 함께 요구한다: 어긋나면 색맹 사용자에게 문자가 다른 축을 가리킨다.
    for (const [axis, channel] of [
      ['x', 0],
      ['y', 1],
      ['z', 2],
    ] as const) {
      const stroke = await page.locator(`#nav-cube-triad-${axis}`).getAttribute('stroke');
      const fill = await page
        .locator(`#nav-cube-triad text[data-axis="${axis.toUpperCase()}"]`)
        .getAttribute('fill');
      expect(stroke, `${axis} 선에 색이 없다`).toMatch(/^#[0-9a-f]{6}$/);
      expect(fill, `${axis} 문자의 색이 선과 다르다 — ${fill} vs ${stroke}`).toBe(stroke);
      const rgb = [1, 3, 5].map((at) => Number.parseInt(stroke!.slice(at, at + 2), 16));
      const brightest = rgb.indexOf(Math.max(...rgb));
      expect(brightest, `${axis} 축의 색이 ${stroke} — 채널 ${channel} 이 가장 밝아야 한다`).toBe(
        channel,
      );
    }
  });

  test('FRONT 정규 자세에서 +X 는 화면 왼쪽 · +Y 는 위 · +Z 는 점으로 눌린다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // **절대 방향으로 단정한다** — "세 선이 서로 다르다"만 보면 삼각대가 통째로 뒤집혀도
    // 통과한다(회고 `260828` 의 교훈 3). 유닛 테스트가 `projectDirection` 을 쿼터니언 수준에서
    // 같은 값으로 못 박고, 여기서는 **어느 선·어느 문자에 어느 축이 붙었는지**를 본다 — 배선이
    // 뒤바뀌면 유닛은 전부 초록인 채로 화면만 거짓말을 한다.
    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), 'FRONT 보간이 끝나지 않았다').toBe(true);
    expectAxis((await cameraAxes(page)).forward, [0, 0, -1], 'FRONT forward');

    const { origins, tips, labels } = await triadGeometry(page);
    const shown = JSON.stringify({ origins, tips, labels });
    // `FRONT` 를 정면으로 보면 화면 오른쪽이 월드 `-X` 이므로 `+X` 는 왼쪽으로 뻗는다.
    for (const [axis, dx, dy] of [
      ['x', -1, 0],
      ['y', 0, -1],
      ['z', 0, 0],
    ] as const) {
      for (const [at, want, name] of [
        [0, dx, 'x'],
        [1, dy, 'y'],
      ] as const) {
        const line = tips[axis][at] - origins[axis][at];
        const label = labels[axis][at] - origins[axis][at];
        if (want === 0) {
          expect(Math.abs(line), `${axis} 선의 ${name} 성분이 남았다 — ${shown}`).toBeLessThan(0.5);
          expect(Math.abs(label), `${axis} 문자의 ${name} 성분이 남았다 — ${shown}`).toBeLessThan(0.5);
        } else {
          // 선보다 문자가 더 멀리 있어야 한다 — 문자가 선 끝에 찍히는 것이 요구다.
          expect(line * want, `${axis} 선이 반대쪽이다 — ${shown}`).toBeGreaterThan(5);
          expect(label * want, `${axis} 문자가 선 끝이 아니다 — ${shown}`).toBeGreaterThan(line * want);
        }
      }
    }
  });

  /**
   * **문자 뒤에 바탕색 헤일로가 깔려야 한다 — 시선과 나란한 축의 문자가 원점으로 붕괴한다.**
   *
   * 투영 길이가 0 인 축은 문자가 삼각대 원점에 놓이고 **나머지 두 축 선이 정확히 그 점에서
   * 출발한다** — 실측(`FRONT` 정규 자세): Z 문자 `(21, 113)` = 원점, X 선 `(21,113)→(8,113)`,
   * Y 선 `(21,113)→(21,100)`. 헤일로가 없으면 `stroke-width: 1.5` 인 두 선이 `3.42 x 7px`
   * 글리프의 가운데와 위를 가로질러 파란 얼룩으로만 보인다(4배 확대 스크린샷으로 확인).
   * 붕괴하는 축은 자세에 따라 바뀌므로(FRONT/BACK→Z · RIGHT/LEFT→X · TOP/BOTTOM→Y)
   * **큐브 면 클릭이 만드는 6개 자세 전부**에서 세 축 중 하나가 이 상태가 된다 — 이 기능의
   * 가장 흔한 정착 상태다.
   *
   * 위 테스트가 문자의 **존재**만 세는 것으로는 부족하다: RGB 예외의 근거 절반이 "색맹 전달을
   * X/Y/Z 문자로 확보한다"이므로(ADR `260828-204140`), 문자가 읽히지 않으면 근거가 무너진다.
   */
  test('FRONT 정규 자세에서 세 문자에 바탕색 헤일로가 깔린다 — 원점으로 붕괴한 문자도 읽힌다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    await clickCubeFace(page, '+Z');
    expect(await waitForIdle(page), 'FRONT 보간이 끝나지 않았다').toBe(true);

    // **붕괴가 실제로 일어나는 자세인지 먼저 확인한다** — 아니면 이 테스트는 헤일로의 존재만
    // 재고 정작 문제의 자세를 비껴간다.
    const { origins, labels } = await triadGeometry(page);
    const collapsed = Math.hypot(labels.z[0] - origins.z[0], labels.z[1] - origins.z[1]);
    expect(
      collapsed,
      `Z 문자가 원점에서 ${collapsed.toFixed(2)}px 떨어져 있다 — 붕괴 자세가 아니다`,
    ).toBeLessThan(0.01);

    const halo = await page.evaluate(() => {
      const line = getComputedStyle(document.querySelector('#nav-cube-triad-x')!);
      const backdrop = getComputedStyle(document.body).backgroundColor;
      return ['X', 'Y', 'Z'].map((axis) => {
        const style = getComputedStyle(
          document.querySelector(`#nav-cube-triad text[data-axis="${axis}"]`)!,
        );
        return {
          axis,
          paintOrder: style.paintOrder,
          strokeWidth: Number.parseFloat(style.strokeWidth),
          stroke: style.stroke,
          lineWidth: Number.parseFloat(line.strokeWidth),
          backdrop,
        };
      });
    });

    for (const h of halo) {
      const shown = JSON.stringify(h);
      // 채움보다 **먼저** 칠해야 헤일로가 글자 아래로 간다 — 기본 순서면 획이 글자 위에 덮여
      // 글자가 굵어질 뿐이고 선은 그대로 글리프를 가로지른다.
      expect(h.paintOrder, `${h.axis} 문자의 paint-order 가 stroke 먼저가 아니다 — ${shown}`).toMatch(
        /^stroke/,
      );
      // 축 선보다 두꺼워야 선이 글리프 경계에서 끊긴다.
      expect(h.strokeWidth, `${h.axis} 헤일로가 축 선보다 얇다 — ${shown}`).toBeGreaterThan(
        h.lineWidth,
      );
      // 헤일로는 **바탕을 다시 칠하는 것**이므로 body 배경과 같은 색이어야 한다.
      expect(h.stroke, `${h.axis} 헤일로 색이 바탕과 다르다 — ${shown}`).toBe(h.backdrop);
    }
  });

  test('배경을 고정해도 헤일로가 그 색을 따른다 — 어두운 테마 + 순백 배경', async ({ page }) => {
    // 배경 모드는 테마와 무관하게 바탕색을 고정한다(ADR `260822-195326`). 헤일로가
    // `--vscode-editor-background` 를 그대로 쓰면 흰 바탕 위에 어두운 얼룩이 남는다.
    await page.goto('/?fixture=cube.glb&background=light&theme=dark');
    expect(await waitForViewer(page)).toBe('ready');

    const shown = await page.evaluate(() => ({
      stroke: getComputedStyle(document.querySelector('#nav-cube-triad text[data-axis="Z"]')!).stroke,
      backdrop: getComputedStyle(document.body).backgroundColor,
    }));
    expect(shown.backdrop, '배경 고정이 먹히지 않았다').toBe('rgb(255, 255, 255)');
    expect(
      shown.stroke,
      `헤일로가 ${shown.stroke} — 순백 바탕에 어두운 얼룩이 남는다`,
    ).toBe(shown.backdrop);
  });

  test('카메라를 돌리면 세 선의 화면 좌표가 바뀐다', async ({ page }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    const before = await triadGeometry(page);

    // 대각선 드래그다 — 수평만 끌면 화면 수직축 회전이라 세 축의 화면 y 가 그대로 남는다
    // (회전이 카메라 up 을 보존하므로 `dot(축, up)` 이 안 바뀐다). 두 성분을 다 보려면 기울여야 한다.
    const box = (await page.locator('#canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + i * 12, cy + i * 6);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);

    const after = await triadGeometry(page);
    for (const axis of ['x', 'y', 'z']) {
      const moved = Math.hypot(
        after.tips[axis][0] - before.tips[axis][0],
        after.tips[axis][1] - before.tips[axis][1],
      );
      expect(
        moved,
        `${axis} 선 끝이 ${moved.toFixed(3)}px 만 움직였다 — 삼각대가 카메라를 따라오지 않는다`,
      ).toBeGreaterThan(1);
      // 원점은 고정이다 — 삼각대는 제자리에서 돌기만 한다.
      expect(after.origins[axis], `${axis} 선의 원점이 움직였다`).toEqual(before.origins[axis]);
    }
  });

  test('삼각대 위에서 드래그하면 캔버스가 그대로 궤도 회전을 받는다 — 클릭을 가로채지 않는다', async ({
    page,
  }) => {
    await page.goto('/?fixture=cube.glb');
    expect(await waitForViewer(page)).toBe('ready');

    // `line` 의 바운딩 박스 중심은 선분의 **중점**이므로 항상 선 위다. 화살표·홈 버튼과 달리
    // 삼각대는 `pointer-events: none` 이라 이 점의 `elementFromPoint` 가 캔버스여야 한다.
    const line = (await page.locator('#nav-cube-triad-x').boundingBox())!;
    const x = line.x + line.width / 2;
    const y = line.y + line.height / 2;
    expect(
      await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id ?? '', [x, y]),
      '삼각대가 클릭을 가져갔다 — pointer-events: none 이 아니다',
    ).toBe('canvas');

    const before = await cameraAxes(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(x + i * 4, y);
    }
    await page.mouse.up();
    expect(await waitForIdle(page), '드래그 후 멈추지 않았다').toBe(true);
    const after = await cameraAxes(page);

    // 부호까지 절대 기준으로 단정한다 — 오른쪽으로 끌면 시선이 화면 오른쪽(`+right`)으로 간다
    // (ADR `260826-232902`). `큐브 상자의 빈 공간을 드래그하면...` 과 같은 규약이다.
    const projected = turnSign(before.forward, after.forward, before.right);
    expect(
      projected,
      `투영값 ${projected.toFixed(4)} — 삼각대가 드래그를 먹었거나 방향이 뒤집혔다`,
    ).toBeGreaterThan(0.005);
  });
});
