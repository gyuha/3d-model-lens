import { describe, expect, it } from 'vitest';
import { distance, midpoint, snapToNearestVertex, type Point3, type Triangle } from '../../src/measure';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });

describe('distance', () => {
  it('축에 평행한 거리를 낸다', () => {
    expect(distance(p(0, 0, 0), p(10, 0, 0))).toBe(10);
    expect(distance(p(-5, 0, 0), p(5, 0, 0))).toBe(10);
  });

  it('3-4-5 삼각형을 맞춘다', () => {
    expect(distance(p(0, 0, 0), p(3, 4, 0))).toBe(5);
  });

  it('공간 대각선을 맞춘다 — cube.stl(10×20×30)의 기대값', () => {
    expect(distance(p(-5, -10, -15), p(5, 10, 15))).toBeCloseTo(Math.hypot(10, 20, 30), 10);
  });

  it('대칭이다', () => {
    const [a, b] = [p(1, 2, 3), p(-4, 5, -6)];
    expect(distance(a, b)).toBe(distance(b, a));
  });

  it('같은 점이면 0 이다', () => {
    expect(distance(p(1, 2, 3), p(1, 2, 3))).toBe(0);
  });
});

describe('snapToNearestVertex', () => {
  const triangle: Triangle = [p(0, 0, 0), p(10, 0, 0), p(0, 10, 0)];

  it('세 정점 중 가장 가까운 것을 낸다', () => {
    expect(snapToNearestVertex(p(1, 1, 0), triangle)).toEqual(p(0, 0, 0));
    expect(snapToNearestVertex(p(9, 1, 0), triangle)).toEqual(p(10, 0, 0));
    expect(snapToNearestVertex(p(1, 9, 0), triangle)).toEqual(p(0, 10, 0));
  });

  it('정점 위를 정확히 찍으면 그 정점을 낸다', () => {
    expect(snapToNearestVertex(p(10, 0, 0), triangle)).toEqual(p(10, 0, 0));
  });

  it('동일 거리 동점이면 앞선 정점을 택한다 — 클릭마다 결과가 흔들리지 않게', () => {
    // (5,0,0) 은 (0,0,0) 과 (10,0,0) 에서 같은 거리다.
    expect(snapToNearestVertex(p(5, 0, 0), triangle)).toEqual(p(0, 0, 0));
  });

  it('삼각형 평면에서 벗어난 점도 처리한다 — 피킹 점은 늘 표면 위지만 오차가 있다', () => {
    expect(snapToNearestVertex(p(9.9, 0.1, 0.5), triangle)).toEqual(p(10, 0, 0));
  });
});

describe('midpoint', () => {
  it('두 점의 중점을 낸다 — 거리 라벨을 놓을 자리다', () => {
    expect(midpoint(p(0, 0, 0), p(10, 20, 30))).toEqual(p(5, 10, 15));
    expect(midpoint(p(-5, -10, -15), p(5, 10, 15))).toEqual(p(0, 0, 0));
  });
});
