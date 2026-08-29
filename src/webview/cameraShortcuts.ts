import { NAV_CUBE_REGIONS, type NavCubeFaceLabel, type Vec3 } from './navCubeGeometry.js';

/**
 * 숫자키 ↔ 카메라 목적지의 **단일 출처**.
 *
 * 이 표를 키 핸들러 · [[내비게이션 큐브]] 툴팁 · [[메뉴 명령]] · [[뷰어 패널]] 이 모두 읽는다.
 * 같은 매핑을 네 곳에 적으면 어긋날 자리가 네 곳이 되므로, 적는 곳은 여기 하나다.
 *
 * **법선은 다시 적지 않는다.** `NAV_CUBE_REGIONS` 가 이미 면 라벨과 바깥 법선을 들고 있고
 * (`TOP=+Y` · `FRONT=+Z` · `RIGHT=+X` — `navCubeGeometry.ts` 의 실측표), 큐브 클릭과 숫자키가
 * **같은 자세**로 가야 하므로 두 경로가 같은 값을 봐야 한다. 여기서 베껴 오면 언젠가 갈라진다.
 *
 * `7`·`8`·`9` 는 비워 둔다 — 꼭짓점 8개와 모서리 12개는 큐브 클릭으로만 간다.
 */

/** 목적지. 면 6개는 [[정규 자세]] 로 보간하고, `HOME` 은 홈 버튼과 같이 즉시 되돌린다. */
export type ShortcutTarget = NavCubeFaceLabel | 'HOME';

export interface CameraShortcut {
  /** `KeyboardEvent.key` 값. 숫자열과 텐키가 같은 값을 주므로 둘 다 이 하나로 잡힌다. */
  key: string;
  target: ShortcutTarget;
  /** 화면에 내보일 이름. 툴팁·메뉴·패널이 같은 문구를 쓴다. */
  title: string;
  /** 면의 바깥 법선. `HOME` 은 자세가 아니라 `resetView()` 이므로 없다. */
  normal: Vec3 | null;
}

const FACE_KEYS: readonly (readonly [string, NavCubeFaceLabel])[] = [
  ['1', 'TOP'],
  ['2', 'FRONT'],
  ['3', 'RIGHT'],
  ['4', 'BACK'],
  ['5', 'LEFT'],
  ['6', 'BOTTOM'],
];

/** 면 라벨에 해당하는 영역의 바깥 법선. 없으면 기하 정의와 이 표가 어긋난 것이다. */
function normalFor(label: NavCubeFaceLabel): Vec3 {
  const region = NAV_CUBE_REGIONS.find((r) => r.kind === 'face' && r.label === label);
  if (!region) {
    throw new Error(`내비게이션 큐브에 '${label}' 면이 없습니다 — 기하 정의와 단축키 표가 어긋났습니다.`);
  }
  return region.normal;
}

export const CAMERA_SHORTCUTS: readonly CameraShortcut[] = [
  { key: '0', target: 'HOME', title: '기본 위치', normal: null },
  ...FACE_KEYS.map(([key, label]) => ({
    key,
    target: label as ShortcutTarget,
    title: label,
    normal: normalFor(label),
  })),
];

/** 누른 키에 해당하는 단축키. 없으면 `undefined` — 호출부가 그냥 흘려보낸다. */
export function shortcutForKey(key: string): CameraShortcut | undefined {
  return CAMERA_SHORTCUTS.find((shortcut) => shortcut.key === key);
}

/** 큐브 영역 id(`'+Y'` 등)에 붙일 툴팁 문구. 해당 키가 없으면 `undefined`. */
export function shortcutForFace(label: NavCubeFaceLabel): CameraShortcut | undefined {
  return CAMERA_SHORTCUTS.find((shortcut) => shortcut.target === label);
}

/** 목적지 이름(`'TOP'`·`'HOME'` …)으로 찾는다. [[메뉴 명령]] 이 이 경로를 쓴다. */
export function shortcutForTarget(target: string): CameraShortcut | undefined {
  return CAMERA_SHORTCUTS.find((shortcut) => shortcut.target === target);
}
