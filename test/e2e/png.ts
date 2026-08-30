import { inflateSync } from 'node:zlib';

/**
 * 스크린샷 PNG 에서 픽셀을 읽는다.
 *
 * **WebGL 캔버스에서 `gl.readPixels` 로 읽으면 안 된다.** 유휴 렌더 중단으로 프레임이 멈춘 뒤에는
 * 드로잉 버퍼가 보존되지 않아 `[0,0,0,0]` 이 나온다 — 화면에는 멀쩡히 보이는 모델인데도 그렇다
 * (이 저장소에서 실제로 한 번 속았다). 합성된 결과인 스크린샷을 읽는 것이 유일하게 믿을 수 있는
 * 관측 방법이다.
 *
 * Playwright 의 스크린샷은 8비트 무압축-인터레이스 PNG 라 디코딩이 짧다. 외부 의존성을 더하지
 * 않으려고 직접 푼다.
 */
export interface Bitmap {
  width: number;
  height: number;
  /** CSS 픽셀 좌표의 색. 디바이스 픽셀 비율은 호출자가 신경 쓰지 않아도 되도록 여기서 보정한다. */
  at: (x: number, y: number) => [number, number, number];
}

export function decodePng(buffer: Buffer, cssWidth?: number): Bitmap {
  let offset = 8; // 시그니처
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) {
        throw new Error(`8비트 PNG 만 읽는다 (bitDepth=${data[8]})`);
      }
      colorType = data[9];
      if (data[12] !== 0) {
        throw new Error('인터레이스 PNG 는 읽지 않는다');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) {
    throw new Error(`RGB/RGBA 만 읽는다 (colorType=${colorType})`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const out = pixels.subarray(row * stride, (row + 1) * stride);
    const prev = row === 0 ? undefined : pixels.subarray((row - 1) * stride, row * stride);
    unfilter(filter, line, out, prev, channels);
  }

  // 스크린샷은 디바이스 픽셀이라 CSS 좌표와 배율이 다를 수 있다.
  const scale = cssWidth ? width / cssWidth : 1;

  return {
    width,
    height,
    at: (x, y) => {
      const px = Math.round(x * scale);
      const py = Math.round(y * scale);
      const index = py * stride + px * channels;
      return [pixels[index], pixels[index + 1], pixels[index + 2]];
    },
  };
}

function unfilter(
  filter: number,
  line: Buffer,
  out: Buffer,
  prev: Buffer | undefined,
  bpp: number,
): void {
  for (let i = 0; i < line.length; i += 1) {
    const a = i >= bpp ? out[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    const x = line[i];
    switch (filter) {
      case 0:
        out[i] = x;
        break;
      case 1:
        out[i] = (x + a) & 0xff;
        break;
      case 2:
        out[i] = (x + b) & 0xff;
        break;
      case 3:
        out[i] = (x + ((a + b) >> 1)) & 0xff;
        break;
      case 4:
        out[i] = (x + paeth(a, b, c)) & 0xff;
        break;
      default:
        throw new Error(`알 수 없는 PNG 필터: ${filter}`);
    }
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** 두 색의 거리. 채널별 차의 절댓값 합 — 사람 눈의 색차가 아니라 "확실히 다른가"를 재는 용도다. */
export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
