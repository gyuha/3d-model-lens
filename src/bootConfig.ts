import { isBackgroundMode, type BackgroundMode } from './background.js';
import { extensionOf, pluginExtensionFor, type SupportedExtension } from './formats.js';
import { readGridSetting } from './grid.js';
import { toAssetUrl } from './host.js';
import { readShadingAids, type ShadingAidState } from './shading.js';
import { isUnitSetting, type UnitSetting } from './units.js';

/**
 * 창이 열릴 때 뷰어가 받는 값들. 원본 확장에서는 확장 호스트가 HTML 의 `data-config`
 * 속성으로 주입했고, 여기서는 Tauri 가 창 생성 시 전역으로 주입한다.
 */
export interface BootConfig {
  modelUri: string;
  assetBaseUri: string;
  environmentUri: string;
  fileName: string;
  pluginExtension: SupportedExtension;
  background: BackgroundMode;
  unitSetting: UnitSetting;
  decimals: number;
  grid: boolean;
  /** 모델을 열 때 Inspector 를 함께 열지 — 다음에 여는 창부터 적용되는 전역 설정. */
  inspectorOnStart: boolean;
  /** 표시 보조 셋의 초기 상태. 전부 기본 꺼짐이다. */
  shadingAids: ShadingAidState;
}

/**
 * Tauri 가 창 생성 시 주입하는 형태. `modelUri` 가 아니라 **`modelPath`(파일시스템 경로)** 를
 * 받는다 — asset URL 형식은 플랫폼마다 다르므로 변환을 프론트에서 한다.
 */
export interface InjectedConfig extends Partial<Omit<BootConfig, 'modelUri'>> {
  modelPath?: string | null;
}

declare global {
  interface Window {
    __MODEL_LENS_CONFIG__?: InjectedConfig;
  }
}

/**
 * 부트 설정을 읽는다.
 *
 * Tauri 창에서는 전역이 이미 주입돼 있다. 개발 서버와 e2e 에서는 그 전역이 없으므로
 * **URL 쿼리로 떨어진다** — `?fixture=cube.glb&unit=mm&decimals=2` 형태이며, 이는 원본
 * UAT 하니스(`scripts/uat-serve.mjs`)가 쓰던 계약과 같다. 덕분에 e2e 스펙이 그대로 붙는다.
 */
export function readBootConfig(): BootConfig {
  const injected = window.__MODEL_LENS_CONFIG__;
  if (injected) {
    // 주입이 있는데 모델이 없다면 그것은 빈 창이고, 빈 창 UI 는 아직 없다(2of3). 조용히
    // 개발용 폴백으로 새는 대신 분명히 실패한다.
    if (!injected.modelPath) {
      throw new Error('No model file was given to this window.');
    }
    return normalize({ ...injected, modelUri: toAssetUrl(injected.modelPath) });
  }

  const params = new URLSearchParams(location.search);
  const fixture = params.get('fixture') ?? 'cube.glb';
  return normalize({
    modelUri: `fixtures/${fixture}`,
    assetBaseUri: 'media',
    environmentUri: 'media/environment.env',
    fileName: fixture,
    pluginExtension: pluginExtensionFor(fixture),
    background: params.get('background') ?? undefined,
    unitSetting: params.get('unit') ?? undefined,
    decimals: params.get('decimals') === null ? undefined : Number(params.get('decimals')),
    grid: params.get('grid') === null ? undefined : params.get('grid') !== 'false',
    // 표시 보조도 쿼리로 켤 수 있다 — "설정이 켜진 채로 연 창"을 e2e 가 재현하는 유일한 길이다.
    shadingAids: {
      axisLighting: params.get('axisLighting') === 'true',
      edges: params.get('edges') === 'true',
      normalColors: params.get('normalColors') === 'true',
    },
  } as Partial<BootConfig>);
}

/** 어느 경로로 들어왔든 값을 검증한다 — 주입된 전역도 손으로 고친 설정 파일에서 온다. */
function normalize(raw: Partial<BootConfig>): BootConfig {
  const modelUri = raw.modelUri ?? '';
  if (!modelUri) {
    throw new Error('Viewer config is missing a model URI.');
  }
  const fileName = raw.fileName ?? modelUri;
  return {
    modelUri,
    assetBaseUri: raw.assetBaseUri ?? 'media',
    environmentUri: raw.environmentUri ?? 'media/environment.env',
    fileName,
    // 확장자 추론은 URI 가 아니라 파일명에서 한다 — asset URI 에는 쿼리가 붙는다.
    pluginExtension: raw.pluginExtension ?? pluginExtensionFor(fileName || modelUri),
    background: isBackgroundMode(raw.background) ? raw.background : 'theme',
    unitSetting: isUnitSetting(raw.unitSetting) ? raw.unitSetting : 'auto',
    decimals: clampDecimals(raw.decimals),
    grid: readGridSetting(raw.grid),
    inspectorOnStart: raw.inspectorOnStart === true,
    // 손으로 고친 설정에서 와도 불리언이 아니면 꺼짐으로 떨어뜨린다 (`readShadingAids`).
    shadingAids: readShadingAids(
      (key) => (raw.shadingAids as Record<string, unknown> | undefined)?.[key],
    ),
  };
}

function clampDecimals(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 3;
  }
  return Math.min(10, Math.max(0, Math.trunc(value)));
}

/** 확장자 검사만 필요한 곳(드롭 거부 등)을 위해 다시 내보낸다. */
export { extensionOf };
