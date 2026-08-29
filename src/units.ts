import type { SupportedExtension } from './formats';

/** 사용자가 고를 수 있는 단위. */
export const UNITS = ['mm', 'cm', 'm', 'in'] as const;

export type Unit = (typeof UNITS)[number];

/** 설정/드롭다운 값. `auto` 는 포맷에서 유추한다. */
export type UnitSetting = Unit | 'auto';

/** 표시에 쓰이는 최종 단위. `none` 은 "단위를 모른다"는 뜻이며 라벨을 붙이지 않는다. */
export type ResolvedUnit = Unit | 'none';

export const UNIT_SETTINGS: readonly UnitSetting[] = ['auto', ...UNITS];

/**
 * 표시할 단위를 결정한다.
 *
 * `auto` 의 근거:
 * - glTF / GLB — 스펙이 선형 거리를 **미터**로 정의한다. 정직하게 `m` 이라 말할 수 있다.
 * - STL — 포맷에 단위 필드가 **없다**. CAD 관행상 mm 인 경우가 많지만 보장이 없으므로
 *   라벨을 붙이지 않는다. 사용자가 알면 드롭다운에서 지정한다.
 *
 * 사용자 지정값은 "모델 좌표 1 = 이 단위 1"을 뜻한다. 기하 변환은 하지 않고 라벨만 바뀐다.
 * (ADR 260822-115455c)
 */
export function resolveUnit(format: SupportedExtension, setting: UnitSetting): ResolvedUnit {
  if (isUnit(setting)) {
    return setting;
  }
  // 손으로 고친 settings.json 의 알 수 없는 값도 auto 로 취급한다.
  return format === '.stl' ? 'none' : 'm';
}

/** 길이를 표시 문자열로 만든다. 단위가 `none` 이면 가짜 라벨 없이 숫자만 낸다. */
export function formatLength(value: number, unit: ResolvedUnit, decimals: number): string {
  if (!Number.isFinite(value)) {
    // 숫자처럼 보이는 거짓말보다 "모른다"가 낫다.
    return '—';
  }
  const text = value.toFixed(clampDecimals(decimals));
  return unit === 'none' ? text : `${text} ${unit}`;
}

export function isUnit(value: unknown): value is Unit {
  return UNITS.some((unit) => unit === value);
}

export function isUnitSetting(value: unknown): value is UnitSetting {
  return value === 'auto' || isUnit(value);
}

function clampDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) {
    return 3;
  }
  return Math.min(10, Math.max(0, Math.trunc(decimals)));
}
