import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { EMPTY_INPUT, LAPS, TRACKS } from '../src/shared';
import type { InputState, Player } from '../src/shared';
import {
  createRace,
  exportRaceRuntime,
  KART_HALF_LENGTH,
  KART_HALF_WIDTH,
  nearestTrackPoint,
  restoreRaceRuntime,
  sampleTrack,
  stepRace,
  trackLength,
  trackSamples,
} from '../src/game/simulation';

const human: Player = { id: 'human', name: 'Driver', skin: 'lime', ready: true };
const throttle: InputState = { ...EMPTY_INPUT, throttle: true };
const advance = (
  state: ReturnType<typeof createRace>,
  seconds: number,
  inputs: Record<string, InputState> = {},
) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepRace(state, inputs, 1 / 60);
};

test('all three tracks are closed and sample by real distance', () => {
  for (const track of TRACKS) {
    const length = trackLength(track.id);
    assert.ok(length > 600 && length < 1800);
    assert.ok(trackSamples(track.id).length > 500);
    const start = sampleTrack(track.id, 0),
      end = sampleTrack(track.id, length),
      before = sampleTrack(track.id, -0.1);
    assert.deepEqual(start, end);
    assert.ok(Math.hypot(start.x - before.x, start.z - before.z) < 0.11);
    const sample = sampleTrack(track.id, 120);
    const projected = nearestTrackPoint(track.id, sample.x, sample.z);
    assert.ok(Math.abs(projected.progress - 120) < 0.01);
    assert.ok(projected.distance < 0.001);
  }
});

function collisionPair(bot = false) {
  const state = createRace('coast', [human, { ...human, id: 'second', bot }], false);
  state.phase = 'racing';
  state.countdown = 0;
  state.pickups = [];
  return state;
}

function place(
  state: ReturnType<typeof createRace>,
  index: number,
  forward: number,
  lateral = 0,
  speed = 0,
  headingOffset = 0,
  originProgress = 40,
) {
  const road = sampleTrack(state.trackId, originProgress),
    racer = state.racers[index];
  racer.x = road.x + Math.sin(road.heading) * forward + Math.cos(road.heading) * lateral;
  racer.z = road.z + Math.cos(road.heading) * forward - Math.sin(road.heading) * lateral;
  racer.heading = road.heading + headingOffset;
  racer.speed = speed;
  racer.progress = originProgress + forward;
}

test('rear-end contacts separate karts and transfer a bounded forward impulse', () => {
  const state = collisionPair();
  place(state, 0, 0, 0, 25);
  place(state, 1, 3.3, 0, 8);
  stepRace(state, {}, 1 / 60);
  const [rear, front] = state.racers;
  assert.ok(Math.hypot(rear.x - front.x, rear.z - front.z) >= KART_HALF_LENGTH * 2);
  assert.ok(rear.speed < 24 && rear.speed > 0);
  assert.ok(front.speed > 8 && front.speed < 25);
  assert.ok((rear.impact ?? 0) > 0.3 && (front.impact ?? 0) <= 1);
});

test('head-on contact bounces gently without intersecting or launching either kart', () => {
  const state = collisionPair();
  place(state, 0, 0, 0, 20);
  place(state, 1, 3.2, 0, 20, Math.PI);
  stepRace(state, {}, 1 / 60);
  const [a, b] = state.racers;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= KART_HALF_LENGTH * 2);
  assert.ok(a.speed < 5 && a.speed >= -12);
  assert.ok(b.speed < 5 && b.speed >= -12);
  assert.ok((a.impact ?? 0) > 0.9 && (b.impact ?? 0) > 0.9);
});

test('side contacts separate the kart footprints without manufacturing forward race progress', () => {
  const state = collisionPair();
  place(state, 0, -0.05, 0, 0, 0, 0);
  place(state, 1, -0.05, 2.4, 0, 0, 0);
  const before = state.racers.map((r) => r.progress);
  stepRace(state, {}, 1 / 60);
  const [a, b] = state.racers;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= KART_HALF_WIDTH * 2);
  assert.ok(state.racers.every((r, index) => Math.abs(r.progress - before[index]) < 1e-8));
  assert.ok(state.racers.every((r) => r.lap === 1 && !r.finished));
  assert.ok(state.racers.every((r) => Math.abs(r.speed) < 0.001));
});

test('AI keeps collision displacement for several frames and then returns smoothly', () => {
  const state = collisionPair(true);
  place(state, 0, 0, 1.2);
  place(state, 1, 0, 2.7);
  stepRace(state, {}, 1 / 60);
  const bot = state.racers[1];
  const displaced = nearestTrackPoint('coast', bot.x, bot.z).lateral;
  assert.ok(displaced > 3);
  const impact = bot.impact ?? 0;
  place(state, 0, 100, -4);
  stepRace(state, {}, 1 / 60);
  const next = nearestTrackPoint('coast', bot.x, bot.z).lateral;
  assert.ok(
    next > 3 && Math.abs(next - displaced) < 0.2,
    'AI must not snap back onto its racing line',
  );
  advance(state, 1);
  assert.ok(nearestTrackPoint('coast', bot.x, bot.z).lateral < displaced - 0.5);
  assert.ok((bot.impact ?? 0) < impact);
});

test('shield reduces collision movement and feedback without being consumed', () => {
  const normal = collisionPair(),
    shielded = collisionPair();
  for (const state of [normal, shielded]) {
    place(state, 0, 0, 0, 25);
    place(state, 1, 3.3, 0, 8);
  }
  shielded.racers[1].shield = 6;
  stepRace(normal, {}, 1 / 60);
  stepRace(shielded, {}, 1 / 60);
  assert.ok(shielded.racers[1].speed < normal.racers[1].speed);
  assert.ok(shielded.racers[1].impact! < normal.racers[1].impact!);
  assert.ok(shielded.racers[1].shield > 5.9);
});

test('countdown and finished racers are excluded from physical contacts', () => {
  const countdown = collisionPair();
  countdown.phase = 'countdown';
  countdown.countdown = 2;
  place(countdown, 0, 0);
  place(countdown, 1, 0);
  const x = countdown.racers[0].x,
    z = countdown.racers[0].z;
  stepRace(countdown, {}, 1 / 60);
  assert.equal(countdown.racers[0].x, x);
  assert.equal(countdown.racers[0].z, z);
  assert.equal(countdown.racers[0].impact, 0);
  const finished = collisionPair();
  place(finished, 0, 0, 0, 10);
  place(finished, 1, 0);
  finished.racers[1].finished = true;
  finished.racers[1].finishTime = 90;
  const parked = { x: finished.racers[1].x, z: finished.racers[1].z };
  stepRace(finished, {}, 1 / 60);
  assert.ok(finished.racers[0].speed > 9.8);
  assert.equal(finished.racers[0].impact, 0);
  assert.equal(finished.racers[1].x, parked.x);
  assert.equal(finished.racers[1].z, parked.z);
});

test('guardrail collisions keep the kart on the course and create a decaying impact', () => {
  const state = createRace('coast', [human], false);
  state.phase = 'racing';
  state.countdown = 0;
  state.pickups = [];
  place(state, 0, 0, 11.45, 20, Math.PI / 2);
  stepRace(state, {}, 1 / 60);
  const racer = state.racers[0];
  assert.ok(nearestTrackPoint('coast', racer.x, racer.z).distance <= 11.52);
  assert.ok((racer.impact ?? 0) > 0.5);
  assert.ok(racer.speed < 15);
  const impact = racer.impact!;
  place(state, 0, 0);
  advance(state, 0.5);
  assert.ok(racer.impact! < impact * 0.1);
});

test('wheel steering feedback remains normalized and eases back on release', () => {
  const state = createRace('coast', [human], false);
  state.phase = 'racing';
  state.countdown = 0;
  stepRace(state, { human: { ...EMPTY_INPUT, left: true } }, 0.1);
  const turn = state.racers[0].steering!;
  assert.ok(turn > 0.5 && turn <= 1);
  stepRace(state, {}, 0.1);
  assert.ok(state.racers[0].steering! < turn && state.racers[0].steering! >= 0);
});

for (const reversing of [false, true]) {
  test(`left/right controls steer toward the requested screen side ${reversing ? 'in reverse' : 'going forward'} at every track orientation`, () => {
    for (const track of TRACKS) {
      for (const fraction of [0, 0.33, 0.66]) {
        for (const control of ['left', 'right'] as const) {
          const state = createRace(track.id, [human], false);
          state.phase = 'racing';
          state.countdown = 0;
          state.pickups = [];
          const racer = state.racers[0];
          const start = sampleTrack(track.id, trackLength(track.id) * fraction);
          racer.x = start.x;
          racer.z = start.z;
          racer.heading = start.heading;
          racer.progress = start.progress;
          racer.speed = reversing ? -7 : 12;
          const forward = new Vector3(Math.sin(start.heading), 0, Math.cos(start.heading));
          // Match the chase view: behind the +Z-facing kart, looking along its forward axis.
          const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 500);
          camera.position.set(start.x - forward.x * 12, 7.2, start.z - forward.z * 12);
          camera.lookAt(start.x + forward.x * 8, 1.15, start.z + forward.z * 8);
          camera.updateMatrixWorld(true);
          const screenX = (x: number, z: number) => new Vector3(x, 0.6, z).project(camera).x;
          const before = screenX(start.x, start.z);
          advance(state, 0.25, { human: { ...EMPTY_INPUT, [control]: true } });
          const requestedSide = control === 'left' ? -1 : 1;
          const context = `${track.id}, progress ${fraction}, ${control}, reverse ${reversing}`;
          const screenMovement = screenX(racer.x, racer.z) - before;
          assert.ok(
            screenMovement * requestedSide > 0.003,
            `Kart must move toward requested screen side: ${context}`,
          );
          const forwardDistance = (racer.x - start.x) * forward.x + (racer.z - start.z) * forward.z;
          assert.ok(
            forwardDistance * (reversing ? -1 : 1) > 1,
            `Drive direction must remain correct: ${context}`,
          );
          const noseX = screenX(
            start.x + Math.sin(racer.heading) * 2,
            start.z + Math.cos(racer.heading) * 2,
          );
          const originalNoseX = screenX(start.x + forward.x * 2, start.z + forward.z * 2);
          assert.ok(
            (noseX - originalNoseX) * requestedSide * (reversing ? -1 : 1) > 0.003,
            `Body yaw must reverse when backing up: ${context}`,
          );
          const wheelYaw = start.heading + racer.steering! * 0.42;
          const wheelX = screenX(
            start.x + Math.sin(wheelYaw) * 2,
            start.z + Math.cos(wheelYaw) * 2,
          );
          assert.ok(
            (wheelX - originalNoseX) * requestedSide > 0.003,
            `Front-wheel steering must point toward the selected screen side: ${context}`,
          );
        }
      }
    }
  });
}

test('countdown holds all cars, then throttle moves the player forward', () => {
  const state = createRace('coast', [human]);
  assert.equal(state.racers.length, 6);
  const initial = { ...state.racers[0] };
  advance(state, 2, { human: throttle });
  assert.equal(state.phase, 'countdown');
  assert.equal(state.racers[0].x, initial.x);
  assert.equal(state.racers[0].z, initial.z);
  assert.equal(state.elapsed, 0);
  advance(state, 3, { human: throttle });
  assert.equal(state.phase, 'racing');
  assert.ok(state.racers[0].progress > initial.progress + 15);
  assert.ok(state.racers[0].speed > 15);
  assert.equal(state.racers[0].lap, 1);
});

test('bots cross ordered gates, complete three laps on every map, and finish in ranked order', () => {
  for (const track of TRACKS) {
    const state = createRace(track.id, [], true);
    advance(state, 225);
    assert.equal(state.phase, 'finished', track.id);
    assert.ok(
      state.racers.every((r) => r.finished && r.lap === LAPS && r.finishTime !== null),
      track.id,
    );
    assert.ok(
      state.racers.every((r) => Math.abs(r.progress - LAPS * trackLength(track.id)) < 0.001),
      track.id,
    );
    const sorted = [...state.racers].sort((a, b) => a.position - b.position);
    assert.deepEqual(
      sorted.map((r) => r.position),
      [1, 2, 3, 4, 5, 6],
    );
    assert.ok(
      sorted.every((r, i) => i === 0 || r.finishTime! >= sorted[i - 1].finishTime!),
      track.id,
    );
  }
});

test('driving backwards across the start does not award laps', () => {
  const state = createRace('coast', [human], false);
  advance(state, 3);
  const racer = state.racers[0];
  // Put the kart just beyond the finish line; the ordered start gate was never crossed.
  const point = sampleTrack('coast', 2);
  racer.x = point.x;
  racer.z = point.z;
  racer.heading = point.heading;
  racer.progress = 2;
  advance(state, 1.5, { human: { ...EMPTY_INPUT, brake: true } });
  assert.ok(racer.progress < 0);
  assert.equal(racer.lap, 1);
  assert.equal(racer.finished, false);
});

test('bad deltas do nothing and long background-tab deltas are bounded', () => {
  const state = createRace('midnight', [human], false);
  const original = JSON.stringify(state);
  for (const dt of [NaN, Infinity, -1, 0]) stepRace(state, { human: throttle }, dt);
  assert.equal(JSON.stringify(state), original);
  stepRace(state, { human: throttle }, 60);
  assert.ok(state.countdown > 2.89 && state.countdown < 2.91);
});

test('item use is edge-triggered and shield blocks one pulse', () => {
  const second = { ...human, id: 'second' };
  const state = createRace('coast', [human, second], false);
  advance(state, 3);
  const [a, b] = state.racers;
  a.item = 'pulse';
  b.shield = 6;
  stepRace(state, { human: { ...EMPTY_INPUT, item: true } }, 1 / 60);
  assert.equal(a.item, null);
  assert.equal(b.shield, 0);
  assert.equal(b.stun, 0);
  a.item = 'boost';
  stepRace(state, { human: { ...EMPTY_INPUT, item: true } }, 1 / 60);
  assert.equal(a.item, 'boost');
  stepRace(state, {}, 1 / 60);
  stepRace(state, { human: { ...EMPTY_INPUT, item: true } }, 1 / 60);
  assert.equal(a.item, null);
  assert.ok(a.boost > 2);
});

test('identical starting players and inputs produce identical simulation state', () => {
  const a = createRace('midnight', [human]),
    b = createRace('midnight', [human]);
  advance(a, 12, { human: throttle });
  advance(b, 12, { human: throttle });
  assert.notEqual(a.id, b.id);
  assert.deepEqual({ ...a, id: '' }, { ...b, id: '' });
});

test('JSON snapshots resume held items, drift, collision motion and random sequence exactly', () => {
  const original = collisionPair(true);
  place(original, 0, 0, 1.2, 18);
  place(original, 1, 0, 2.7, 14);
  original.racers[0].item = 'boost';
  const held = { human: { ...throttle, left: true, drift: true, item: true } };
  advance(original, 0.25, held);
  // Picking up another item while Space remains held must not use it after a server handoff.
  original.racers[0].item = 'shield';
  const resumed = JSON.parse(JSON.stringify(original)) as ReturnType<typeof createRace>;
  const runtime = JSON.parse(JSON.stringify(exportRaceRuntime(original)));
  restoreRaceRuntime(resumed, runtime);
  assert.deepEqual(exportRaceRuntime(resumed), exportRaceRuntime(original));
  runtime.racers.human.knockX = 99;
  assert.notEqual(
    exportRaceRuntime(resumed).racers.human.knockX,
    99,
    'Restored data must be copied',
  );
  advance(original, 0.1, held);
  advance(resumed, 0.1, held);
  assert.equal(resumed.racers[0].item, 'shield');
  advance(original, 2, { human: throttle });
  advance(resumed, 2, { human: throttle });
  assert.deepEqual(resumed, original);
  assert.deepEqual(exportRaceRuntime(resumed), exportRaceRuntime(original));
});

test('invalid persisted runtime is rejected without replacing the live checkpoint state', () => {
  const state = createRace('coast', [human]);
  const before = exportRaceRuntime(state);
  const malformed = exportRaceRuntime(state);
  malformed.racers.human.nextGate = Infinity;
  assert.throws(() => restoreRaceRuntime(state, malformed), /Invalid simulation runtime/);
  assert.deepEqual(exportRaceRuntime(state), before);
});

test('a stopped human cannot keep a multiplayer race open forever', () => {
  const state = createRace('coast', [human], false);
  // The race elapsed time is public so host snapshots can restore it.
  advance(state, 3);
  state.elapsed = 239.98;
  advance(state, 0.1);
  assert.equal(state.phase, 'finished');
  assert.equal(state.racers[0].finished, true);
  assert.equal(
    state.racers[0].finishTime,
    null,
    'timeout is a DNF rather than a valid three-lap time',
  );
  assert.equal(state.racers[0].lap, 1);
});
