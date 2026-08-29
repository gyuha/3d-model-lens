import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'fixtures');

/** FIXTURES.md 에 기록된 기대 치수. 파트 3/4 의 단정이 이 값을 쓴다. */
const EXPECTED = {
  'cube.gltf': [2, 3, 4],
  'cube.glb': [5, 6, 7],
  'cube.stl': [10, 20, 30],
} as const;

describe('픽스처 무결성', () => {
  it('cube.gltf 의 POSITION accessor min/max 가 기대 치수와 일치한다', () => {
    const gltf = JSON.parse(readFileSync(join(DIR, 'cube.gltf'), 'utf8'));
    const acc = gltf.accessors[0];
    const extents = acc.max.map((m: number, i: number) => m - acc.min[i]);
    expect(extents).toEqual([...EXPECTED['cube.gltf']]);
  });

  it('cube.gltf 는 외부 buffer 를 참조한다 — 형제 파일 해결을 실제로 검증하기 위해', () => {
    const gltf = JSON.parse(readFileSync(join(DIR, 'cube.gltf'), 'utf8'));
    expect(gltf.buffers[0].uri).toBe('cube.bin');
    expect(readFileSync(join(DIR, 'cube.bin')).length).toBe(gltf.buffers[0].byteLength);
  });

  it('cube.glb 는 유효한 GLB 컨테이너이고 치수가 기대와 일치한다', () => {
    const buf = readFileSync(join(DIR, 'cube.glb'));
    expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(buf.readUInt32LE(4)).toBe(2);
    expect(buf.readUInt32LE(8)).toBe(buf.length); // 헤더의 총 길이가 실제 파일 크기와 같아야 한다

    const jsonLen = buf.readUInt32LE(12);
    expect(buf.subarray(16, 20).toString('ascii')).toBe('JSON');
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    expect(gltf.buffers[0].uri).toBeUndefined(); // GLB 는 BIN 청크를 쓰므로 uri 가 없어야 한다

    const binHeader = 20 + jsonLen;
    expect(buf.subarray(binHeader + 4, binHeader + 8).toString('ascii')).toBe('BIN\0');

    const acc = gltf.accessors[0];
    const extents = acc.max.map((m: number, i: number) => m - acc.min[i]);
    expect(extents).toEqual([...EXPECTED['cube.glb']]);
  });

  it('cube.stl 은 삼각형 12개짜리 ASCII STL 이고 정점 범위가 기대 치수와 일치한다', () => {
    const stl = readFileSync(join(DIR, 'cube.stl'), 'utf8');
    expect(stl.match(/facet normal/g)?.length).toBe(12);

    const verts = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((m) =>
      [m[1], m[2], m[3]].map(Number),
    );
    expect(verts.length).toBe(36);
    const extents = [0, 1, 2].map((axis) => {
      const values = verts.map((v) => v[axis]);
      return Math.max(...values) - Math.min(...values);
    });
    expect(extents).toEqual([...EXPECTED['cube.stl']]);
  });

  it('cube.stl 의 모든 삼각형 법선이 바깥을 향한다 — 감김 방향이 뒤집히면 면이 culling 되어 사라진다', () => {
    const stl = readFileSync(join(DIR, 'cube.stl'), 'utf8');
    const verts = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((m) =>
      [m[1], m[2], m[3]].map(Number),
    );

    const inward: number[] = [];
    for (let t = 0; t < verts.length; t += 3) {
      const [a, b, c] = [verts[t], verts[t + 1], verts[t + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      // 픽스처는 원점 중심이므로, 삼각형 무게중심 방향과 법선의 내적이 양수여야 바깥을 향한다.
      const centroid = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3);
      const dot = n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2];
      if (dot <= 0) {
        inward.push(t / 3);
      }
    }
    expect(inward, `안쪽을 향하는 삼각형 인덱스: ${inward.join(', ')}`).toEqual([]);
  });

  it('chiral.stl / chiral.glb 는 같은 정점 좌표를 담는다 — 손잡이 회귀 장치의 전제', () => {
    const stl = readFileSync(join(DIR, 'chiral.stl'), 'utf8');
    const stlVerts = new Set(
      [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((m) =>
        [m[1], m[2], m[3]].map(Number).join(','),
      ),
    );

    const glb = readFileSync(join(DIR, 'chiral.glb'));
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
    const acc = json.accessors[0];
    const binStart = 20 + jsonLength + 8;
    const glbVerts = new Set<string>();
    for (let i = 0; i < acc.count; i++) {
      const at = binStart + i * 12;
      glbVerts.add(
        [0, 4, 8].map((o) => glb.readFloatLE(at + o)).join(','),
      );
    }

    // 두 파일이 같은 숫자를 담고 있어야, 로드 후 좌표가 다르다면 그건 로더 처리 차이다.
    expect([...glbVerts].sort()).toEqual([...stlVerts].sort());
    expect(acc.max.map((m: number, i: number) => m - acc.min[i])).toEqual([3, 2, 1]);
  });

  it('chiral.stl 의 모든 삼각형 법선이 바깥을 향한다 — 이 픽스처는 원점 중심이 아니므로 입체 무게중심을 기준으로 본다', () => {
    const stl = readFileSync(join(DIR, 'chiral.stl'), 'utf8');
    const verts = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((m) =>
      [m[1], m[2], m[3]].map(Number),
    );
    const unique = [...new Set(verts.map((v) => v.join(',')))].map((k) => k.split(',').map(Number));
    const solid = [0, 1, 2].map((i) => unique.reduce((a, v) => a + v[i], 0) / unique.length);

    const inward: number[] = [];
    for (let t = 0; t < verts.length; t += 3) {
      const [a, b, c] = [verts[t], verts[t + 1], verts[t + 2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const face = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3);
      const dot = [0, 1, 2].reduce((sum, i) => sum + n[i] * (face[i] - solid[i]), 0);
      if (dot <= 0) {
        inward.push(t / 3);
      }
    }
    expect(inward, `안쪽을 향하는 삼각형 인덱스: ${inward.join(', ')}`).toEqual([]);
  });

  it('broken.glb 는 0바이트다 — 에러 UI 검증용', () => {
    expect(readFileSync(join(DIR, 'broken.glb')).length).toBe(0);
  });
});
