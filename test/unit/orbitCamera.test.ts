import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Scene } from '@babylonjs/core/scene.js';
import { OrbitCamera } from '../../src/webview/orbitCamera';
import type { Extents } from '../../src/webview/geometry';

const EXTENTS: Extents = {
  min: new Vector3(-5, -10, -15),
  max: new Vector3(5, 10, 15),
};

const INPUT = 0.1; // rad — 5.73°
const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(2) + '°';
const angle = (a: Vector3, b: Vector3): number =>
  Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(a, b))));

/**
 * **화면 기준 회전의 불변식.**
 *
 * 정의: 좌우 입력 `θ` 는 **시선 방향을 `θ` 만큼 바꾸고 화면의 up 은 그대로 둔다.**
 *
 * `ArcRotateCamera` 는 이 불변식을 만족하지 못한다 — 좌우 회전이 월드 Y 축 기준이라
 * 카메라가 기울어질수록 입력이 시선을 못 움직이고 화면만 돈다.
 * 실측(입력 `5.73°`): `beta=90°` → 방향 `5.73°`/롤 `0.00°` · `beta=34°` → `3.23°`/`4.73°` ·
 * `beta=11.5°` → `1.14°`/`5.62°`. 관계식은 방향 ≈ `θ·sin β`, 롤 ≈ `θ·cos β` 이고
 * 교차점이 `beta = 45°` 다 — 그 아래부터 롤이 이긴다. (ADR `260826-232902`)
 *
 * **기울어진 자세에서 재는 것이 이 테스트의 전부다.** 수평 자세(`beta=90°`)에서는 두 방식이
 * 우연히 일치하므로, 그것만 재면 고치기 전에도 통과한다.
 */
describe('OrbitCamera — 화면 기준 회전 불변식', () => {
  // `frame()` 의 기본 시작 자세(고도만 기존 ArcRotateCamera 의 `beta = 72°` 와 같다 —
  // 방위각은 FRONT·RIGHT 의 중간이다)에서
  // **추가로** 얼마나 위로 기울이는지. 클수록 위에서 내려다본다.
  const TILTS = [
    { label: '기본 시작 자세', tilt: 0 },
    { label: '거기서 18° 더', tilt: 0.314 },
    { label: '거기서 56° 더', tilt: 0.977 },
    { label: '거기서 79° 더 (극점을 지난다)', tilt: 1.371 },
  ];

  for (const { label, tilt } of TILTS) {
    it(`${label} — 좌우 입력이 시선을 입력만큼 돌리고 화면 up 을 유지한다`, () => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      try {
        const orbit = new OrbitCamera(scene);
        orbit.applyLimits(EXTENTS);
        orbit.frame(EXTENTS);
        // 위에서 내려다보는 자세를 만든다 — 상하 회전은 이미 화면 기준이므로 이걸로 기울인다.
        orbit.rotate(0, tilt);

        const forwardBefore = orbit.forward.clone();
        const upBefore = orbit.up.clone();

        orbit.rotate(INPUT, 0);

        const turned = angle(forwardBefore, orbit.forward);
        const rolled = angle(upBefore, orbit.up);

        expect(
          turned,
          `시선이 입력만큼 돌지 않았다 — 입력 ${deg(INPUT)}, 실제 ${deg(turned)} (롤 ${deg(rolled)})`,
        ).toBeCloseTo(INPUT, 3);
        expect(
          rolled,
          `화면이 롤했다 — ${deg(rolled)} (시선 변화 ${deg(turned)}). 좌우 회전이 월드 축 기준이면 이렇게 된다`,
        ).toBeCloseTo(0, 3);
      } finally {
        scene.dispose();
        engine.dispose();
      }
    });
  }

  it('상하 입력도 화면 기준이다 — 시선이 입력만큼 돌고 화면 up 이 그 평면 안에 머문다', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
      const orbit = new OrbitCamera(scene);
      orbit.applyLimits(EXTENTS);
      orbit.frame(EXTENTS);

      const forwardBefore = orbit.forward.clone();
      const rightBefore = orbit.right.clone();

      orbit.rotate(0, INPUT);

      expect(angle(forwardBefore, orbit.forward)).toBeCloseTo(INPUT, 3);
      // 화면 수평축은 상하 회전의 축이므로 그대로여야 한다.
      expect(angle(rightBefore, orbit.right)).toBeCloseTo(0, 3);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});

/**
 * **`animateTo()` — 정규 자세로의 slerp 보간.**
 *
 * 내비게이션 큐브가 면·꼭짓점 클릭의 목적지로 쓴다. 여기서 재는 것은 넷이다: 목적 자세에
 * 정확히 도달하는가 · 중간 프레임이 두 끝점 사이 slerp 값인가 · `tick()` 의 반환이 진행 중
 * `true` / 완료 후 `false` 인가(렌더 게이트가 이걸로 깨고 잔다) · `stop()` 이 그 자리에서
 * 끊는가. 거기에 **애니메이션 중 관성 무시**를 더한다 — 둘이 섞이면 ADR `260826-232902` 의
 * 10배 증폭이 그대로 재현된다.
 *
 * **시계를 주입하는 이유.** 진행을 프레임 수가 아니라 경과 시간으로 해야 프레임 레이트와
 * 무관해지는데, 전역 시계를 부르면 테스트가 실제로 300ms 를 기다려야 한다.
 */
describe('OrbitCamera — animateTo() 자세 보간', () => {
  /** 위에서 내려다보는 자세. 실측값: `forward = [0, -1, 0]`, `up = [0, 0, 1]`. */
  const LOOK_DOWN = Quaternion.RotationYawPitchRoll(0, Math.PI / 2, 0);

  const orbitWithClock = (): {
    orbit: OrbitCamera;
    advance: (ms: number) => void;
    dispose: () => void;
  } => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    let clock = 0;
    const orbit = new OrbitCamera(scene, () => clock);
    orbit.applyLimits(EXTENTS);
    orbit.frame(EXTENTS);
    return {
      orbit,
      advance: (ms) => {
        clock += ms;
      },
      dispose: () => {
        scene.dispose();
        engine.dispose();
      },
    };
  };

  const orientationOf = (orbit: OrbitCamera): Quaternion =>
    new Quaternion(...orbit.state().orientation);

  /** 부호가 반대인 쿼터니언은 같은 회전이다 — slerp 가 최단 경로를 위해 끝점을 뒤집는다. */
  const sameRotation = (a: Quaternion, b: Quaternion): number => Math.abs(Quaternion.Dot(a, b));

  const fmt = (v: Vector3): string =>
    `[${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}]`;

  it('완료 시 목적 자세에 도달한다 — 절대 방향으로 단정한다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      orbit.animateTo(LOOK_DOWN);
      advance(300);
      orbit.tick();

      const forward = orbit.forward;
      expect(forward.x, `forward 가 -Y 가 아니다 — ${fmt(forward)}`).toBeCloseTo(0, 4);
      expect(forward.y, `forward 가 -Y 가 아니다 — ${fmt(forward)}`).toBeCloseTo(-1, 4);
      expect(forward.z, `forward 가 -Y 가 아니다 — ${fmt(forward)}`).toBeCloseTo(0, 4);
      expect(orbit.up.z, `up 이 +Z 가 아니다 — ${fmt(orbit.up)}`).toBeCloseTo(1, 4);
      expect(orientationOf(orbit).length()).toBeCloseTo(1, 6);
    } finally {
      dispose();
    }
  });

  it('중간 프레임이 두 끝점 사이 slerp 값과 일치하고 단위 쿼터니언이다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      const from = orientationOf(orbit);
      orbit.animateTo(LOOK_DOWN);
      advance(120); // t = 0.4
      orbit.tick();

      const expected = new Quaternion();
      Quaternion.SlerpToRef(from, LOOK_DOWN, 0.4, expected);
      const actual = orientationOf(orbit);

      expect(actual.length(), '중간 자세가 단위 쿼터니언이 아니다').toBeCloseTo(1, 6);
      expect(
        sameRotation(actual, expected),
        `t=0.4 의 자세가 slerp 값과 다르다 — forward ${fmt(orbit.forward)}`,
      ).toBeCloseTo(1, 6);
    } finally {
      dispose();
    }
  });

  it('진행 중에는 tick() 이 true, 완료 후에는 false 다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      orbit.animateTo(LOOK_DOWN);
      advance(100);
      expect(orbit.tick(), '진행 중인데 렌더 게이트가 잠든다').toBe(true);
      advance(100);
      expect(orbit.tick()).toBe(true);
      advance(100); // 300ms — 완료
      expect(orbit.tick(), '완료했는데 계속 그린다 — 유휴로 못 들어간다').toBe(false);
      advance(100);
      expect(orbit.tick()).toBe(false);
    } finally {
      dispose();
    }
  });

  it('stop() 은 애니메이션을 그 자리에서 끊는다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      orbit.animateTo(LOOK_DOWN);
      advance(150);
      orbit.tick();
      const halted = orbit.forward.clone();

      orbit.stop();
      advance(150); // 끊지 않았으면 여기서 목적지에 도달했을 시간
      expect(orbit.tick(), 'stop() 뒤에도 애니메이션이 살아 있다').toBe(false);

      expect(orbit.forward.x).toBeCloseTo(halted.x, 6);
      expect(orbit.forward.y).toBeCloseTo(halted.y, 6);
      expect(orbit.forward.z).toBeCloseTo(halted.z, 6);
      // 멈춘 자리가 중간이라는 것까지 단정한다 — 끝까지 갔으면 위 비교만으로는 못 잡는다.
      expect(halted.y, `중간에서 멈추지 않았다 — ${fmt(halted)}`).toBeGreaterThan(-0.9);
    } finally {
      dispose();
    }
  });

  /**
   * **자세를 건드리지 않는 조작은 진행 중인 보간을 폐기해서는 안 된다.**
   *
   * `stop()` 은 관성과 보간을 함께 끊는다 — 새 드래그가 자세를 가져갈 때 필요한 동작이다.
   * 그런데 `cameraInput` 의 휠 줌 · 우드래그 팬 · Alt/Ctrl + 방향키는 **자세를 건드리지 않으면서**
   * 관성 꼬리만 끊으려고 같은 함수를 불렀고, 그래서 큐브 클릭이 목적 자세에 도달하지 못했다
   * (실측 1000x700 · cube.glb: `TOP` 클릭 80ms 뒤 휠 1노치 → `forward` 가 목표 `[0,-1,0]` 에서
   * **40.63° 미달**, 200ms 뒤면 18.93° 미달 · `▶` 클릭 80ms 뒤 우드래그 팬 → 90° 중 **29.34°**
   * 만 회전 · Alt+방향키 줌 → **24.33°**). 두 요구를 한 함수가 겸할 수 없어서 나눈다.
   */
  it('stopInertia() 는 관성 꼬리만 끊고 진행 중인 보간은 살려 둔다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      orbit.animateTo(LOOK_DOWN);
      advance(150);
      orbit.tick();
      // 꼬리를 **보간이 도는 중에** 넣는다 — 줌·팬이 끊으려는 것이 이것이다.
      orbit.glide(0.5, 0.3);
      orbit.stopInertia();

      advance(150); // 300ms — 폐기하지 않았으면 여기서 목적지다
      expect(orbit.tick(), '보간이 끝나지 않았다').toBe(false);
      const forward = orbit.forward;
      expect(forward.x, `목적 자세에 도달하지 못했다 — ${fmt(forward)}`).toBeCloseTo(0, 4);
      expect(forward.y, `목적 자세에 도달하지 못했다 — ${fmt(forward)}`).toBeCloseTo(-1, 4);
      expect(forward.z, `목적 자세에 도달하지 못했다 — ${fmt(forward)}`).toBeCloseTo(0, 4);
    } finally {
      dispose();
    }
  });

  /**
   * **직접 회전은 언제나 보간을 이긴다.**
   *
   * 실제 경로에서는 보간이 먼저 끊긴다 — 드래그는 `pointerdown` 이, 방향키는 `keydown` 이
   * `stop()` 을 부른다. 남는 구멍이 하나 있다: **키를 이미 누른 채로 큐브를 클릭하면** 그
   * 프레임부터 `tickKeys()` 의 회전과 보간이 같은 자세를 동시에 끈다(렌더 루프가 둘을 다
   * 부르므로 — `viewer.ts` 의 단축 평가 주석). 자세를 두 소스가 끌면 어느 쪽도 정확히 따라가지
   * 못한다는 것이 ADR `260826-232902` 의 결론이므로, 직접 회전 쪽이 보간을 버린다.
   */
  it('rotate() 는 진행 중인 보간을 버린다 — 자세를 두 소스가 끌지 않는다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      orbit.animateTo(LOOK_DOWN);
      advance(150);
      orbit.tick();
      orbit.rotate(INPUT, 0);

      advance(150); // 버리지 않았으면 여기서 목적지에 도달했을 시간
      expect(orbit.tick(), 'rotate() 뒤에도 보간이 살아 있다').toBe(false);
      expect(
        sameRotation(orientationOf(orbit), LOOK_DOWN),
        `목적 자세로 끌려갔다 — forward ${fmt(orbit.forward)}`,
      ).toBeLessThan(0.999);
      // 목적 자세도 함께 사라진다 — 남으면 그 뒤의 화살표가 버린 자세에서 90° 를 더한다.
      expect(
        sameRotation(orbit.destinationOrientationValue, orientationOf(orbit)),
        '버린 보간의 목적 자세가 남아 있다',
      ).toBeCloseTo(1, 6);
    } finally {
      dispose();
    }
  });

  it('stopInertia() 는 관성 꼬리를 끊는다 — 그것이 이 함수가 하는 일이다', () => {
    const { orbit, dispose } = orbitWithClock();
    try {
      orbit.glide(0.5, 0.3);
      orbit.stopInertia();
      expect(orbit.tick(), '꼬리가 살아 있다 — 관성을 끊지 못했다').toBe(false);
    } finally {
      dispose();
    }
  });

  /**
   * **화살표는 "지금 자세"가 아니라 "가려던 자세"에서 90° 를 더해야 한다.**
   *
   * 화살표 클릭의 목적지는 상대값이므로(현재 자세 + 90°), 보간 중에 현재 자세를 읽으면 남은
   * 각도가 조용히 버려진다 — 실측(`FRONT` 정규 자세에서 `▶` 두 번, 180° 가 목표): 간격 0ms
   * **93.15°** · 60ms **111.24°** · 120ms **131.94°** · 200ms **153.84°** 이고, 네이티브
   * 더블클릭은 **90.00°**(두 번째 클릭이 통째로 삼켜진다)였다. 큐브가 이 게터를 읽으면 세
   * 경우 모두 정확히 180° 가 된다.
   */
  it('destinationOrientationValue 는 보간 중에도 목적 자세를 준다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      // 유휴에서는 현재 자세와 같다 — 화살표가 자세와 무관하게 같은 규칙을 쓸 수 있는 이유다.
      expect(
        sameRotation(orbit.destinationOrientationValue, orientationOf(orbit)),
        '유휴인데 현재 자세와 다르다',
      ).toBeCloseTo(1, 6);

      orbit.animateTo(LOOK_DOWN);
      advance(150);
      orbit.tick();
      expect(
        sameRotation(orbit.destinationOrientationValue, LOOK_DOWN),
        `보간 중인데 목적 자세가 아니다 — forward ${fmt(orbit.forward)}`,
      ).toBeCloseTo(1, 6);
      // **중간 자세와는 다르다**는 것까지 단정한다 — 게터가 현재 자세를 그대로 돌려주는
      // 구현이면 위 단정만으로는 잡히지 않는다(150ms 에 이미 목적지라면 재는 것이 없다).
      expect(
        sameRotation(orientationOf(orbit), LOOK_DOWN),
        '150ms 에 이미 목적 자세다 — 보간 중을 재지 못한다',
      ).toBeLessThan(0.999);

      advance(150);
      orbit.tick();
      expect(
        sameRotation(orbit.destinationOrientationValue, orientationOf(orbit)),
        '완료했는데 목적 자세가 현재 자세와 다르다',
      ).toBeCloseTo(1, 6);

      // `stop()` 이 보간을 끊으면 목적 자세도 함께 사라져야 한다 — 남아 있으면 그 뒤의
      // 화살표가 **사용자가 이미 버린 자세**에서 90° 를 더한다.
      orbit.animateTo(LOOK_DOWN);
      advance(150);
      orbit.tick();
      orbit.stop();
      expect(
        sameRotation(orbit.destinationOrientationValue, orientationOf(orbit)),
        '끊긴 보간의 목적 자세가 남아 있다',
      ).toBeCloseTo(1, 6);
    } finally {
      dispose();
    }
  });

  it('보간 중에는 관성을 무시한다 — 도중에 들어온 꼬리가 자세를 오염시키지 않는다', () => {
    const { orbit, advance, dispose } = orbitWithClock();
    try {
      const from = orientationOf(orbit);
      orbit.animateTo(LOOK_DOWN);
      // 꼬리를 **보간이 도는 중에** 넣는다. 시작 전에 넣으면 `animateTo()` 가 이미 버리므로
      // `tick()` 이 관성을 건너뛰는지를 재지 못한다 — 그 순서로는 관성을 섞어도 통과한다.
      orbit.glide(0.5, 0.3);
      advance(60);
      orbit.tick();
      advance(60);
      orbit.tick();
      advance(60); // t = 0.6
      orbit.tick();

      const expected = new Quaternion();
      Quaternion.SlerpToRef(from, LOOK_DOWN, 0.6, expected);
      expect(
        sameRotation(orientationOf(orbit), expected),
        `관성이 섞였다 — forward ${fmt(orbit.forward)}`,
      ).toBeCloseTo(1, 6);

      advance(120); // 완료
      expect(orbit.tick()).toBe(false);
      expect(orbit.tick(), '완료 뒤 관성 꼬리가 되살아난다').toBe(false);
      expect(orbit.forward.y, `목적 자세를 벗어났다 — ${fmt(orbit.forward)}`).toBeCloseTo(-1, 4);
    } finally {
      dispose();
    }
  });
});
