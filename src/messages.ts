import type { BackgroundMode } from './background';
import type { UnitSetting } from './units';

/** 확장 호스트 ↔ 웹뷰 메시지. 양쪽이 같은 정의를 쓴다. */

export type HostToWebview =
  | { type: 'setInspector'; visible: boolean }
  | { type: 'setMeasureMode'; active: boolean }
  /** 뷰어 패널을 통째로 보이거나 숨긴다 — 되살리는 경로는 제목 표시줄 아이콘이다. */
  | { type: 'setPanelVisible'; visible: boolean }
  /** 설정이 바뀌었다 — 열려 있는 모든 뷰어에 전파된다. */
  | { type: 'setBackground'; background: BackgroundMode }
  /** 그리드 설정이 바뀌었다 — 열려 있는 모든 뷰어에 전파된다. */
  | { type: 'setGrid'; grid: boolean }
  /** 소수 자릿수가 바뀌었다 — 열려 있는 모든 뷰어에 전파된다. */
  | { type: 'setDecimals'; decimals: number }
  /**
   * 카메라를 정해진 목적지로 옮긴다 — 숫자키와 같은 이동을 메뉴에서도 할 수 있게 한다.
   * 자세(쿼터니언)가 아니라 **목적지 이름**을 보낸다: 법선을 메시지에 실으면 호스트와 뷰어가
   * 각자 표를 갖게 되고, 두 진입점이 다른 자세로 갈 수 있다.
   */
  | { type: 'setCameraPose'; target: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'inspectorState'; visible: boolean }
  | { type: 'inspectorFailed'; message: string }
  | { type: 'measureModeState'; active: boolean }
  /** 뷰어 패널의 현재 표시 여부 — 어긋나면 다음 아이콘 클릭의 토글 방향이 뒤집힌다. */
  | { type: 'panelState'; visible: boolean }
  /** 사용자가 뷰어 패널 드롭다운에서 단위를 바꿨다 — 호스트가 파일별로 기억한다. */
  | { type: 'unitChanged'; unit: UnitSetting }
  /** 사용자가 뷰어 패널 드롭다운에서 배경을 바꿨다 — 호스트가 전역 설정에 저장한다. */
  | { type: 'backgroundChanged'; background: BackgroundMode }
  /** 사용자가 뷰어 패널에서 그리드 표시를 토글했다 — 호스트가 전역 설정에 저장한다. */
  | { type: 'gridChanged'; grid: boolean }
  /** 사용자가 소수 자릿수를 바꿨다 — 호스트가 전역 설정에 저장한다. */
  | { type: 'decimalsChanged'; decimals: number }
  /** 사용자가 "시작 시 Inspector" 를 토글했다 — 다음에 여는 창부터 적용된다. */
  | { type: 'inspectorOnStartChanged'; value: boolean }
  /** 빈 창에서 파일 열기를 요청했다 — 호스트가 대화상자를 띄운다. */
  | { type: 'openRequested' };
