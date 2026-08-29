import { isUnitSetting, type UnitSetting } from './units';

/**
 * 단위 기억이 필요로 하는 저장소의 최소 형태.
 *
 * 원본 확장에서는 `vscode.Memento` 중 쓰는 부분만 좁힌 것이었다. 여기서 실제 구현이 붙는 것은
 * 2of3(설정 저장소)이며, 이 인터페이스가 그 사이의 계약이자 테스트의 이음매다.
 */
export interface UnitStore {
  get(key: string): unknown;
  update(key: string, value: unknown): Promise<void>;
}

/**
 * 파일별 단위 선택을 기억한다.
 *
 * STL 은 포맷에 단위가 없어서 사용자가 매번 mm 을 다시 고르게 된다. 그 반복을 없애는 것이
 * 목적이고, 전역 설정 하나로 처리하면 glTF(m)와 STL(mm)을 번갈아 볼 때 서로 덮어써서 최악이 된다.
 * 그래서 **파일 URI 별로** 저장한다 (ADR 260822-115455c).
 */
export class UnitMemory {
  public constructor(private readonly store: UnitStore) {}

  /** 이 파일에 쓸 초기 단위. 우선순위: 저장된 선택 → 설정값 → `auto`. */
  public initialFor(uri: string, configured: UnitSetting): UnitSetting {
    const remembered = this.store.get(keyFor(uri));
    if (isUnitSetting(remembered)) {
      return remembered;
    }
    return isUnitSetting(configured) ? configured : 'auto';
  }

  public async remember(uri: string, unit: UnitSetting): Promise<void> {
    await this.store.update(keyFor(uri), unit);
  }
}

function keyFor(uri: string): string {
  return `modelLens.unit:${uri}`;
}
