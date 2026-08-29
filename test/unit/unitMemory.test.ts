import { describe, expect, it } from 'vitest';
import { UnitMemory, type UnitStore } from '../../src/unitMemory';

function fakeStore(initial: Record<string, unknown> = {}): UnitStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: (key) => data[key],
    update: (key, value) => {
      data[key] = value;
      return Promise.resolve();
    },
  };
}

describe('UnitMemory', () => {
  it('저장한 단위를 같은 파일에서 되돌려 준다', async () => {
    const memory = new UnitMemory(fakeStore());
    await memory.remember('file:///m/cube.stl', 'mm');
    expect(memory.initialFor('file:///m/cube.stl', 'auto')).toBe('mm');
  });

  it('파일마다 따로 기억한다 — glTF(m)와 STL(mm)을 번갈아 봐도 서로 덮지 않는다', async () => {
    const memory = new UnitMemory(fakeStore());
    await memory.remember('file:///m/cube.stl', 'mm');
    await memory.remember('file:///m/cube.glb', 'm');
    expect(memory.initialFor('file:///m/cube.stl', 'auto')).toBe('mm');
    expect(memory.initialFor('file:///m/cube.glb', 'auto')).toBe('m');
    expect(memory.initialFor('file:///m/other.stl', 'auto')).toBe('auto');
  });

  it('저장된 값이 없으면 설정값으로 떨어진다', () => {
    const memory = new UnitMemory(fakeStore());
    expect(memory.initialFor('file:///m/cube.stl', 'cm')).toBe('cm');
  });

  it('저장된 값이 설정값을 이긴다 — 파일별 선택이 더 구체적이다', async () => {
    const memory = new UnitMemory(fakeStore());
    await memory.remember('file:///m/cube.stl', 'mm');
    expect(memory.initialFor('file:///m/cube.stl', 'cm')).toBe('mm');
  });

  it('저장소나 설정에 쓰레기 값이 있어도 auto 로 안전하게 떨어진다', () => {
    const memory = new UnitMemory(
      fakeStore({ 'modelLens.unit:file:///m/cube.stl': 'furlong' }),
    );
    expect(memory.initialFor('file:///m/cube.stl', 'auto')).toBe('auto');
    expect(memory.initialFor('file:///m/cube.stl', 42 as never)).toBe('auto');
  });

  it('키에 파일 URI 를 그대로 넣어 다른 확장의 상태와 섞이지 않는다', async () => {
    const store = fakeStore();
    await new UnitMemory(store).remember('file:///m/cube.stl', 'in');
    expect(Object.keys(store.data)).toEqual(['modelLens.unit:file:///m/cube.stl']);
  });
});
