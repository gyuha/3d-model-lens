// 알려진 치수의 테스트 픽스처를 생성한다.
// 파트 3/4의 치수·측정 테스트가 이 값들을 기대값으로 사용하므로,
// 크기를 바꾸면 test/fixtures/FIXTURES.md 도 함께 갱신해야 한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
mkdirSync(OUT, { recursive: true });

/** 원점 중심 직육면체의 정점 8개와 삼각형 인덱스 36개. */
function box(sizeX, sizeY, sizeZ) {
  const [x, y, z] = [sizeX / 2, sizeY / 2, sizeZ / 2];
  const positions = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  // 감김 방향은 바깥에서 볼 때 반시계(CCW)여야 한다 — glTF 의 front-face 규약이다.
  // 하나라도 뒤집히면 back-face culling 에 잘려서 "상자 내부가 보이는" 렌더가 된다.
  // `test/unit/fixtures.test.ts` 가 모든 삼각형의 법선이 바깥을 향하는지 검사한다.
  const indices = [
    0, 3, 2, 0, 2, 1, // -Z
    4, 5, 6, 4, 6, 7, // +Z
    0, 4, 7, 0, 7, 3, // -X
    1, 2, 6, 1, 6, 5, // +X
    0, 1, 5, 0, 5, 4, // -Y
    3, 7, 6, 3, 6, 2, // +Y
  ];
  return { positions, indices, min: [-x, -y, -z], max: [x, y, z] };
}

/**
 * 손잡이(chirality)를 드러내는 비대칭 사면체 — 원점에서 각 축으로 길이가 다른 팔 셋.
 *
 * **원점 중심 직육면체로는 거울상을 검출할 수 없다.** 반사는 바운딩 박스를 바꾸지 않고,
 * 대칭 형상은 자기 거울상과 정점 집합까지 동일하다. 그래서 이 형상은 세 가지를 동시에 만족한다.
 * - 팔 길이가 3 / 2 / 1 로 모두 달라 **축 맞바꿈**이 드러난다
 * - 원점 중심이 아니라 **부호 오류**가 드러난다
 * - 자기 거울상과 정점 집합이 달라 **반사**가 드러난다
 */
function tetra() {
  const positions = [
    [0, 0, 0], // O
    [3, 0, 0], // +X 팔
    [0, 2, 0], // +Y 팔
    [0, 0, 1], // +Z 팔
  ];
  // 감김은 box() 와 같은 규약 — 바깥에서 볼 때 반시계(CCW).
  const indices = [
    0, 2, 1, // z=0 면 (법선 -Z)
    0, 1, 3, // y=0 면 (법선 -Y)
    0, 3, 2, // x=0 면 (법선 -X)
    1, 2, 3, // 기울어진 면
  ];
  return { positions, indices, min: [0, 0, 0], max: [3, 2, 1] };
}

function binaryFor({ positions, indices }) {
  const pos = Buffer.alloc(positions.length * 3 * 4);
  positions.flat().forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.alloc(indices.length * 2);
  indices.forEach((v, i) => idx.writeUInt16LE(v, i * 2));
  return { pos, idx, buffer: Buffer.concat([pos, idx]) };
}

function gltfJson(geo, bin, bufferSpec, name = 'FixtureBox') {
  return {
    asset: { version: '2.0', generator: '3d-model-lens fixture generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [bufferSpec],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: bin.pos.length, target: 34962 },
      { buffer: 0, byteOffset: bin.pos.length, byteLength: bin.idx.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: geo.positions.length,
        type: 'VEC3',
        min: geo.min,
        max: geo.max,
      },
      { bufferView: 1, componentType: 5123, count: geo.indices.length, type: 'SCALAR' }, // UNSIGNED_SHORT
    ],
  };
}

// --- cube.gltf (+ 외부 cube.bin) — 형제 파일 해결을 실제로 검증하기 위해 임베디드로 만들지 않는다.
{
  const geo = box(2, 3, 4);
  const bin = binaryFor(geo);
  const json = gltfJson(geo, bin, { uri: 'cube.bin', byteLength: bin.buffer.length });
  writeFileSync(join(OUT, 'cube.bin'), bin.buffer);
  writeFileSync(join(OUT, 'cube.gltf'), JSON.stringify(json, null, 2) + '\n');
}

/** JSON + BIN 두 청크를 담은 GLB 컨테이너로 묶어 쓴다. */
function writeGlb(name, json, binBuffer) {
  const pad = (buf, filler) => {
    const rem = buf.length % 4;
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, filler)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20); // 공백으로 패딩
  const binChunk = pad(binBuffer, 0x00);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const chunk = (data, type) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, data]);
  };
  writeFileSync(join(OUT, name), Buffer.concat([header, chunk(jsonChunk, 'JSON'), chunk(binChunk, 'BIN\0')]));
}

// --- cube.glb (바이너리 컨테이너)
{
  const geo = box(5, 6, 7);
  const bin = binaryFor(geo);
  writeGlb('cube.glb', gltfJson(geo, bin, { byteLength: bin.buffer.length }), bin.buffer);
}

// --- animated.glb — 애니메이션 그룹 2개. 재생/정지와 "전체 vs 개별" 선택 검증용.
//
// 노드 두 개가 같은 큐브 메시를 참조하고 각각 다른 translation 애니메이션을 갖는다.
// 그룹이 하나면 "전체"와 "개별"이 구분되지 않아 선택 UI 를 검증할 수 없다.
{
  const geo = box(2, 2, 2);
  const bin = binaryFor(geo);

  const floats = (values) => {
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    return buf;
  };
  const times = floats([0, 1]);
  const rise = floats([-2, 0, 0, -2, 3, 0]);
  const slide = floats([2, 0, 0, 5, 0, 0]);
  const buffer = Buffer.concat([bin.buffer, times, rise, slide]);

  // bufferView 오프셋은 4의 배수여야 한다 — 위 세 블록이 모두 float 이라 자연히 맞는다.
  const timesAt = bin.buffer.length;
  const riseAt = timesAt + times.length;
  const slideAt = riseAt + rise.length;

  const animation = (name, node, output) => ({
    name,
    samplers: [{ input: 2, output, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node, path: 'translation' } }],
  });

  writeGlb(
    'animated.glb',
    {
      asset: { version: '2.0', generator: '3d-model-lens fixture generator' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { mesh: 0, name: 'Riser', translation: [-2, 0, 0] },
        { mesh: 0, name: 'Slider', translation: [2, 0, 0] },
      ],
      meshes: [{ name: 'FixtureBox', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: buffer.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: bin.pos.length, target: 34962 },
        { buffer: 0, byteOffset: bin.pos.length, byteLength: bin.idx.length, target: 34963 },
        { buffer: 0, byteOffset: timesAt, byteLength: times.length },
        { buffer: 0, byteOffset: riseAt, byteLength: rise.length },
        { buffer: 0, byteOffset: slideAt, byteLength: slide.length },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: geo.positions.length,
          type: 'VEC3',
          min: geo.min,
          max: geo.max,
        },
        { bufferView: 1, componentType: 5123, count: geo.indices.length, type: 'SCALAR' },
        // 샘플러 input 은 min/max 가 필수다 — 없으면 glTF 검증기가 거부한다.
        { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
        { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' },
      ],
      animations: [animation('rise', 0, 3), animation('slide', 1, 4)],
    },
    buffer,
  );
}

function asciiStl(geo, name) {
  const lines = [`solid ${name}`];
  for (let i = 0; i < geo.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => geo.positions[geo.indices[i + k]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    const nn = n.map((k) => k / len);
    lines.push(`  facet normal ${nn.map((k) => k.toExponential(6)).join(' ')}`);
    lines.push('    outer loop');
    for (const p of [a, b, c]) {
      lines.push(`      vertex ${p.map((k) => k.toExponential(6)).join(' ')}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${name}`, '');
  return lines.join('\n');
}

// --- cube.stl (ASCII)
writeFileSync(join(OUT, 'cube.stl'), asciiStl(box(10, 20, 30), 'fixture_cube'));

// --- chiral.stl + chiral.glb — 같은 숫자 좌표를 두 포맷으로. 손잡이 회귀 장치.
//
// 이 쌍의 존재 이유: 두 로더의 좌표 처리가 어긋나면 **같은 형상이 서로 거울상으로 실린다.**
// 치수 단정은 그것을 볼 수 없다(반사는 바운딩 박스를 보존한다). 그래서 정점 집합을 직접 비교한다.
{
  const geo = tetra();
  const bin = binaryFor(geo);
  writeFileSync(join(OUT, 'chiral.stl'), asciiStl(geo, 'fixture_chiral'));
  writeGlb('chiral.glb', gltfJson(geo, bin, { byteLength: bin.buffer.length }, 'FixtureChiral'), bin.buffer);
}

// --- cube_large.stl — cube.stl 의 100배. 마커·그리드·카메라가 스케일에 비례하는지 검증용.
{
  const geo = box(1000, 2000, 3000);
  writeFileSync(join(OUT, 'cube_large.stl'), asciiStl(geo, 'fixture_cube_large'));
}

// --- broken.glb — 0바이트. 에러 UI 검증용.
writeFileSync(join(OUT, 'broken.glb'), Buffer.alloc(0));

console.log('픽스처 생성 완료:', OUT);
