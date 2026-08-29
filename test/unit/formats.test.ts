import { describe, expect, it } from 'vitest';
import { isSupportedModelPath, pluginExtensionFor } from '../../src/formats';

describe('pluginExtensionFor', () => {
  it('지원 포맷의 확장자를 소문자로 반환한다', () => {
    expect(pluginExtensionFor('/m/cube.gltf')).toBe('.gltf');
    expect(pluginExtensionFor('/m/cube.glb')).toBe('.glb');
    expect(pluginExtensionFor('/m/cube.stl')).toBe('.stl');
  });

  it('대문자 확장자도 인식한다', () => {
    expect(pluginExtensionFor('/m/CUBE.GLB')).toBe('.glb');
  });

  it('경로에 점이 여러 개 있어도 마지막 확장자를 쓴다', () => {
    expect(pluginExtensionFor('/m/v1.2.final.stl')).toBe('.stl');
  });

  it('지원하지 않는 확장자는 거부한다 — 참고 레포가 지원하던 obj/ply는 범위 밖이다', () => {
    expect(() => pluginExtensionFor('/m/cube.obj')).toThrow(/Unsupported file type/);
    expect(() => pluginExtensionFor('/m/cube.ply')).toThrow(/Unsupported file type/);
    expect(() => pluginExtensionFor('/m/cube')).toThrow(/Unsupported file type/);
  });
});

describe('isSupportedModelPath', () => {
  it('지원 여부만 판정하고 던지지 않는다', () => {
    expect(isSupportedModelPath('/m/cube.glb')).toBe(true);
    expect(isSupportedModelPath('/m/cube.obj')).toBe(false);
  });
});
