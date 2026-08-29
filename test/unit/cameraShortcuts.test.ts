import { describe, expect, it } from 'vitest';
import {
  CAMERA_SHORTCUTS,
  shortcutForFace,
  shortcutForKey,
} from '../../src/webview/cameraShortcuts';
import { NAV_CUBE_REGIONS } from '../../src/webview/navCubeGeometry';

describe('카메라 단축키 표', () => {
  it('0~6 일곱 개를 빠짐없이 낸다', () => {
    expect(CAMERA_SHORTCUTS.map((s) => s.key)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });

  it('키가 중복되지 않는다 — 하나의 키가 두 곳으로 가면 안 된다', () => {
    const keys = CAMERA_SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('목적지도 중복되지 않는다', () => {
    const targets = CAMERA_SHORTCUTS.map((s) => s.target);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('요청받은 매핑 그대로다 — 1 TOP · 2 FRONT · 3 RIGHT · 4 BACK · 5 LEFT · 6 BOTTOM', () => {
    expect(shortcutForKey('1')?.target).toBe('TOP');
    expect(shortcutForKey('2')?.target).toBe('FRONT');
    expect(shortcutForKey('3')?.target).toBe('RIGHT');
    expect(shortcutForKey('4')?.target).toBe('BACK');
    expect(shortcutForKey('5')?.target).toBe('LEFT');
    expect(shortcutForKey('6')?.target).toBe('BOTTOM');
  });

  it('0 은 자세가 아니라 기본 위치다 — 법선을 갖지 않는다', () => {
    const home = shortcutForKey('0');
    expect(home?.target).toBe('HOME');
    expect(home?.normal).toBeNull();
  });

  /**
   * 이 단정이 이 파일의 핵심이다. 숫자키와 큐브 클릭은 **같은 자세**로 가야 하므로 두 경로가
   * 같은 법선을 봐야 한다. 값을 여기 베껴 적으면 언젠가 갈라지므로, 기하 정의에서 조회한
   * 결과와 일치하는지를 대신 단정한다.
   */
  it('법선은 내비게이션 큐브의 기하 정의에서 온다 — 베껴 적지 않았다', () => {
    for (const shortcut of CAMERA_SHORTCUTS) {
      if (shortcut.normal === null) {
        continue;
      }
      const region = NAV_CUBE_REGIONS.find(
        (r) => r.kind === 'face' && r.label === shortcut.target,
      );
      expect(region, `${shortcut.target} 면이 기하 정의에 없다`).toBeDefined();
      expect(shortcut.normal).toBe(region?.normal);
    }
  });

  it('7·8·9 는 비어 있다 — 꼭짓점과 모서리는 큐브 클릭으로만 간다', () => {
    expect(shortcutForKey('7')).toBeUndefined();
    expect(shortcutForKey('8')).toBeUndefined();
    expect(shortcutForKey('9')).toBeUndefined();
  });

  it('면 라벨로도 찾을 수 있다 — 큐브 툴팁이 이 경로를 쓴다', () => {
    expect(shortcutForFace('BOTTOM')?.key).toBe('6');
  });
});
