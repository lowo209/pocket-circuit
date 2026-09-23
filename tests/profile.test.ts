import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import {
  buySkin,
  buyTrail,
  buyDriver,
  buyTire,
  levelFor,
  loadProfile,
  newProfile,
  rewardRace,
  saveProfile,
} from '../src/profile';
import type { RaceState } from '../src/shared';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
beforeEach(() =>
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  }),
);
after(() => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function finishedRace(id = 'completed-race', finishTime: number | null = 95): RaceState {
  return {
    id,
    trackId: 'coast',
    phase: 'finished',
    countdown: 0,
    elapsed: finishTime ?? 240,
    pickups: [],
    racers: [
      {
        id: 'local',
        name: 'Rookie',
        skin: 'lime',
        bot: false,
        x: 0,
        z: 0,
        heading: 0,
        speed: 0,
        progress: 3000,
        lap: 3,
        position: 1,
        finished: true,
        finishTime,
        item: null,
        boost: 0,
        shield: 0,
        magnet: 0,
        stun: 0,
        driftCharge: 0,
        drifting: false,
        coins: 4,
      },
    ],
  };
}

test('a completed race rewards once, including after saving and reloading', () => {
  const initial = newProfile(),
    race = finishedRace();
  const result = rewardRace(initial, race, 'local');
  assert.ok(result);
  assert.ok(result.coins > 0 && result.xp > 0);
  assert.equal(result.profile.coins, initial.coins + result.coins);
  assert.equal(result.profile.xp, initial.xp + result.xp);
  assert.equal(result.profile.races, 1);
  assert.equal(result.profile.wins, 1);
  assert.equal(initial.races, 0, 'reward calculation must not mutate the old profile');
  assert.equal(saveProfile(result.profile), true);
  const restored = loadProfile();
  assert.deepEqual(restored, result.profile);
  assert.equal(rewardRace(restored, race, 'local'), null);
});

test('unfinished racers and unknown participants cannot earn rewards', () => {
  const race = finishedRace();
  race.racers[0].finished = false;
  assert.equal(rewardRace(newProfile(), race, 'local'), null);
  race.racers[0].finished = true;
  assert.equal(rewardRace(newProfile(), race, 'someone-else'), null);
});

test('placements and collected coins affect rewards, while only better times replace the record', () => {
  const initial = newProfile();
  const first = rewardRace(initial, finishedRace('first', 95), 'local')!;
  const lastRace = finishedRace('last', 103);
  lastRace.racers[0].position = 6;
  lastRace.racers[0].coins = 0;
  const last = rewardRace(first.profile, lastRace, 'local')!;
  assert.ok(first.coins > last.coins);
  assert.ok(first.xp > last.xp);
  assert.equal(last.profile.wins, 1);
  assert.equal(last.profile.bestTimes.coast, 95);
  const faster = rewardRace(last.profile, finishedRace('faster', 88), 'local')!;
  assert.equal(faster.profile.bestTimes.coast, 88);
  const untimed = rewardRace(faster.profile, finishedRace('untimed', null), 'local')!;
  assert.equal(untimed.profile.bestTimes.coast, 88);
});

test('race earnings buy a skin once and preserve equipment across reloads', () => {
  const earned = rewardRace(newProfile(), finishedRace(), 'local')!;
  const bought = buySkin(earned.profile, 'coral');
  assert.ok(bought);
  assert.equal(bought.coins, earned.profile.coins - 180);
  assert.deepEqual(bought.owned, ['lime', 'coral']);
  assert.equal(bought.equipped, 'coral');
  assert.equal(saveProfile(bought), true);
  const restored = loadProfile();
  assert.deepEqual(restored, bought);
  assert.equal(buySkin(restored, 'coral'), null);
  assert.equal(restored.coins, bought.coins);
});

test('both money and level are required for a purchase', () => {
  const richRookie = { ...newProfile(), coins: 1000 };
  assert.equal(buySkin(richRookie, 'blue'), null);
  const levelTwo = { ...richRookie, xp: 250 };
  assert.equal(levelFor(levelTwo.xp), 2);
  assert.ok(buySkin(levelTwo, 'blue'));
  assert.equal(buySkin({ ...levelTwo, coins: 299 }, 'blue'), null);
  assert.equal(buySkin(levelTwo, 'missing-skin'), null);
  assert.equal(richRookie.coins, 1000);
  assert.deepEqual(richRookie.owned, ['lime']);
});

test('driver and tire purchases persist and old profiles receive safe defaults', () => {
  const rich = { ...newProfile(), coins: 1000, xp: 250 };
  const driver = buyDriver(rich, 'volt');
  assert.ok(driver);
  const tires = buyTire(driver, 'aqua');
  assert.ok(tires);
  assert.equal(tires.equippedDriver, 'volt');
  assert.equal(tires.equippedTire, 'aqua');
  assert.equal(tires.coins, 260);
  assert.equal(buyDriver(tires, 'volt'), null);
  assert.equal(buyTire(tires, 'invalid'), null);
  saveProfile(tires);
  assert.deepEqual(loadProfile(), tires);
  const old = { ...newProfile() } as Record<string, unknown>;
  delete old.ownedDrivers; delete old.equippedDriver;
  delete old.ownedTires; delete old.equippedTire;
  localStorage.setItem('pocket-circuit.profile.v1', JSON.stringify(old));
  const migrated = loadProfile();
  assert.deepEqual(migrated.ownedDrivers, ['rookie']);
  assert.deepEqual(migrated.ownedTires, ['standard']);
});

test('bought trails persist and migrate older profiles without losing skins', () => {
  const starter = { ...newProfile(), coins: 500 };
  const bought = buyTrail(starter, 'neon');
  assert.ok(bought);
  assert.equal(bought.coins, 300);
  assert.deepEqual(bought.ownedTrails, ['none', 'neon']);
  assert.equal(bought.equippedTrail, 'neon');
  assert.equal(buyTrail(bought, 'neon'), null);
  assert.equal(buyTrail(starter, 'ember'), null);
  assert.equal(saveProfile(bought), true);
  assert.deepEqual(loadProfile(), bought);
  localStorage.setItem('pocket-circuit.profile.v1', JSON.stringify({ ...starter,
    ownedTrails: undefined, equippedTrail: undefined }));
  const migrated = loadProfile();
  assert.deepEqual(migrated.ownedTrails, ['none']);
  assert.equal(migrated.equippedTrail, 'none');
  assert.deepEqual(migrated.owned, ['lime']);
});

test('corrupt or unavailable browser storage recovers without crashing', () => {
  localStorage.setItem('pocket-circuit.profile.v1', '{broken json');
  assert.deepEqual(loadProfile(), newProfile());
  localStorage.setItem(
    'pocket-circuit.profile.v1',
    JSON.stringify({
      name: 'A very very very very long name',
      xp: -5,
      coins: 12.9,
      owned: ['unknown'],
      equipped: 'gold',
      races: 'oops',
      wins: -1,
      bestTimes: { coast: -2, canyon: 90.5, nowhere: 100 },
      completed: [false, 'old-race'],
    }),
  );
  const repaired = loadProfile();
  assert.equal(repaired.name.length, 18);
  assert.equal(repaired.xp, 0);
  assert.equal(repaired.coins, 12);
  assert.deepEqual(repaired.owned, ['lime']);
  assert.equal(repaired.equipped, 'lime');
  assert.deepEqual(repaired.bestTimes, { canyon: 90.5 });
  assert.deepEqual(repaired.completed, ['old-race']);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage disabled');
    },
  });
  assert.deepEqual(loadProfile(), newProfile());
  assert.equal(saveProfile(newProfile()), false);
});
