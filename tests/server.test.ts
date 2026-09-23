import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { TestContext } from 'node:test';
import WebSocket from 'ws';
import { EMPTY_INPUT } from '../src/shared';
import { attachMultiplayerServer } from '../server/multiplayer';
import { InMemoryRoomStore, RedisRoomStore } from '../server/store';
import type { RoomStore, StoredRoom } from '../server/store';
import { INPUT_STALE_MS, RECONNECT_GRACE_MS, RoomService } from '../server/rooms';

function harness() {
  let clock = 1_000_000;
  const store = new InMemoryRoomStore(() => clock);
  return {
    store,
    first: new RoomService(store, () => clock),
    second: new RoomService(store, () => clock),
    tick: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

const hostIdentity = { name: 'Host', skin: 'lime' };
const guestIdentity = { name: 'Guest', skin: 'coral' };

test('room CAS limits simultaneous cross-instance joins to four humans', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host-connection');
  const attempts = await Promise.allSettled(
    Array.from({ length: 7 }, (_, index) =>
      h.second.join(
        host.membership.code,
        { ...guestIdentity, name: `Guest ${index}` },
        `connection-${index}`,
      ),
    ),
  );
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 3);
  const stored = await h.store.get(host.membership.code);
  assert.equal(stored?.room.players.length, 4);
  assert.equal(Object.keys(stored!.sessions).length, 4);
});

test('only host starts/changes map; changing track clears guest readiness', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host');
  const guest = await h.second.join(host.membership.code, guestIdentity, 'guest');
  await assert.rejects(
    h.second.command(guest.membership, { type: 'track', trackId: 'midnight' }),
    /Host/,
  );
  await assert.rejects(h.second.command(guest.membership, { type: 'start' }), /Host/);
  await assert.rejects(h.first.command(host.membership, { type: 'start' }), /bereit/);
  await h.second.command(guest.membership, { type: 'ready', ready: true });
  const changed = await h.first.command(host.membership, { type: 'track', trackId: 'canyon' });
  assert.equal(
    changed.room.players.find((player) => player.id === guest.membership.id)?.ready,
    false,
  );
  await h.second.command(guest.membership, { type: 'ready', ready: true });
  const started = await h.first.command(host.membership, { type: 'start' });
  assert.equal(started.race?.state.racers.length, 6);
  assert.equal(started.race?.state.trackId, 'canyon');
  assert.notEqual(started.race?.state.id, undefined);
  assert.equal(started.race?.runtime.version, 1);
});

test('equipped trail appears in room and authoritative race snapshots', async () => {
  const h = harness();
  const host = await h.first.create({ ...hostIdentity, trail: 'neon' }, 'coast', 'host');
  assert.equal(host.stored.room.players[0].trail, 'neon');
  const race = await h.first.command(host.membership, { type: 'start' });
  assert.equal(race.race?.state.racers.find((racer) => racer.id === host.membership.id)?.trail, 'neon');
});

test('simultaneous instances cannot advance the same race twice', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host');
  await h.first.command(host.membership, { type: 'start' });
  h.tick(100);
  await Promise.all([
    h.first.advance(host.membership.code),
    h.second.advance(host.membership.code),
  ]);
  const state = (await h.store.get(host.membership.code))!.race!.state;
  assert.ok(Math.abs(state.countdown - 2.9) < 1e-6);
  h.tick(60_000);
  const resumed = await h.second.advance(host.membership.code);
  assert.ok(resumed.race!.state.countdown >= 2.65 - 1e-6, 'long suspension has bounded catch-up');
});

test('idle race ticks reuse the latest room without rereading player inputs', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host');
  await h.first.command(host.membership, { type: 'start' });
  const original = h.store.getInputs.bind(h.store);
  let reads = 0;
  h.store.getInputs = async (code) => { reads++; return original(code); };
  await h.first.advance(host.membership.code);
  h.tick(100);
  await h.first.advance(host.membership.code);
  await h.second.advance(host.membership.code);
  assert.equal(reads, 1);
});

test('inputs are bound to connection/race; forged positions and stale sequence cannot take authority', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host');
  const started = await h.first.command(host.membership, { type: 'start' });
  const raceId = started.race!.state.id;
  assert.equal(
    await h.first.input(host.membership, { raceId: 'wrong', seq: 1, input: EMPTY_INPUT }),
    false,
  );
  await assert.rejects(
    h.first.input(host.membership, { raceId, seq: 1, input: { ...EMPTY_INPUT, throttle: 999 } }),
    /Steuerung/,
  );
  assert.equal(
    await h.first.input(host.membership, {
      raceId,
      seq: 2,
      input: { ...EMPTY_INPUT, throttle: true },
      x: 999999,
      id: 'other',
    }),
    true,
  );
  assert.equal(await h.first.input(host.membership, { raceId, seq: 1, input: EMPTY_INPUT }), false);
  assert.equal(
    await h.first.input(
      { ...host.membership, connectionId: 'forged' },
      { raceId, seq: 3, input: EMPTY_INPUT },
    ),
    false,
  );
  const values = await h.store.getInputs(host.membership.code);
  assert.equal(values[host.membership.id].input.throttle, true);
  assert.equal(Object.keys(values).length, 1);
  assert.equal('x' in values[host.membership.id], false);
  await assert.rejects(
    h.first.command(host.membership, { type: 'race', state: { elapsed: 999 } }),
    /Unbekannte/,
  );
});

test('resume needs secret token, replaces old socket lease and preserves authoritative race', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'midnight', 'old');
  const state = await h.first.command(host.membership, { type: 'start' });
  assert.notEqual(host.token, host.membership.id);
  assert.equal(JSON.stringify(host.stored.room).includes(host.token), false);
  assert.equal(host.stored.sessions[host.membership.id].tokenHash.includes(host.token), false);
  await assert.rejects(
    h.second.resume(host.membership.code, host.membership.id, 'invalid', 'attacker'),
    /abgelaufen/,
  );
  await h.first.disconnect(host.membership);
  const resumed = await h.second.resume(
    host.membership.code,
    host.membership.id,
    host.token,
    'new',
  );
  assert.equal(resumed.stored.race?.state.id, state.race?.state.id);
  assert.equal(resumed.membership.id, host.membership.id);
  assert.equal(
    resumed.stored.race?.state.racers.find((racer) => racer.id === host.membership.id)?.bot,
    false,
  );
  await assert.rejects(h.first.command(host.membership, { type: 'lobby' }), /Sitzung/);
  await h.first.disconnect(host.membership);
  assert.equal(
    (await h.store.get(host.membership.code))?.sessions[host.membership.id].connectionId,
    'new',
  );
});

test('host departure transfers lobby ownership while server keeps race and converts missing racer to AI', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host');
  const guest = await h.second.join(host.membership.code, guestIdentity, 'guest');
  await h.second.command(guest.membership, { type: 'ready', ready: true });
  const started = await h.first.command(host.membership, { type: 'start' });
  await h.first.disconnect(host.membership, true);
  h.tick(100);
  const updated = await h.second.advance(host.membership.code);
  assert.equal(updated.room.hostId, guest.membership.id);
  assert.equal(updated.room.racing, true);
  assert.equal(updated.race?.state.id, started.race?.state.id);
  assert.equal(
    updated.race?.state.racers.find((racer) => racer.id === host.membership.id)?.bot,
    true,
  );
  assert.ok(updated.race!.state.countdown < started.race!.state.countdown);
  const lobby = await h.second.command(guest.membership, { type: 'lobby' });
  assert.equal(lobby.room.racing, false);
});

test('reconnect grace expires, stale controls release, and idle rooms expire', async () => {
  const h = harness();
  const host = await h.first.create(hostIdentity, 'coast', 'host');
  const started = await h.first.command(host.membership, { type: 'start' });
  const stored = (await h.store.get(host.membership.code))!;
  stored.race!.state.phase = 'racing';
  stored.race!.state.countdown = 0;
  stored.revision++;
  await h.store.compareAndSet(host.membership.code, stored.revision - 1, stored);
  await h.first.input(host.membership, {
    raceId: started.race!.state.id,
    seq: 0,
    input: { ...EMPTY_INPUT, throttle: true },
  });
  h.tick(INPUT_STALE_MS + 1);
  const advanced = await h.first.advance(host.membership.code);
  assert.equal(
    advanced.race!.state.racers.find((racer) => racer.id === host.membership.id)!.speed,
    0,
  );
  await h.first.disconnect(host.membership);
  h.tick(RECONNECT_GRACE_MS + 1);
  await h.first.advance(host.membership.code);
  await assert.rejects(
    h.second.resume(host.membership.code, host.membership.id, host.token, 'late'),
    /abgelaufen/,
  );
  h.tick(3_600_001);
  assert.equal(await h.store.get(host.membership.code), null);
});

async function launch(store?: RoomStore) {
  const server = createServer();
  const backend = attachMultiplayerServer(server, { store });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${address.port}/api/ws`,
    backend,
    async close() {
      await backend.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface Envelope {
  type: string;
  [key: string]: any;
}
async function client(url: string) {
  const socket = new WebSocket(url);
  const messages: Envelope[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as Envelope));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    messages,
    send(message: Record<string, unknown>) {
      socket.send(JSON.stringify({ v: 2, ...message }));
    },
    async wait(predicate: (message: Envelope) => boolean, milliseconds = 6000): Promise<Envelope> {
      const deadline = Date.now() + milliseconds;
      while (Date.now() < deadline) {
        const message = messages.find(predicate);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      throw new Error(
        `Timed out waiting for socket message. Received: ${JSON.stringify(messages.map((message) => ({ type: message.type, message: message.message })))}`,
      );
    },
  };
}

async function crossInstanceSockets(t: TestContext, firstStore: RoomStore, secondStore: RoomStore) {
  const a = await launch(firstStore);
  const b = await launch(secondStore);
  t.after(async () => {
    await a.close();
    await b.close();
    await firstStore.close();
    if (secondStore !== firstStore) await secondStore.close();
  });
  const host = await client(a.url);
  const guest = await client(b.url);
  t.after(() => {
    host.socket.terminate();
    guest.socket.terminate();
  });
  host.send({ type: 'create', ...hostIdentity });
  const hostWelcome = await host.wait((message) => message.type === 'welcome');
  guest.send({ type: 'join', code: hostWelcome.room.code, ...guestIdentity });
  const guestWelcome = await guest.wait((message) => message.type === 'welcome');
  await host.wait((message) => message.type === 'room' && message.room.players.length === 2);
  guest.send({ type: 'ready', ready: true });
  await host.wait(
    (message) =>
      message.type === 'room' &&
      message.room.players.some((player: any) => player.id === guestWelcome.id && player.ready),
  );
  host.send({ type: 'start' });
  const race = await guest.wait((message) => message.type === 'race');
  assert.equal(race.state.racers.filter((racer: any) => !racer.bot).length, 2);
  await host.wait((message) => message.type === 'race' && message.state.id === race.state.id);
  assert.equal(JSON.stringify(guest.messages).includes(hostWelcome.token), false);
  host.send({ type: 'leave' });
  host.socket.close();
  await guest.wait((message) => message.type === 'room' && message.room.hostId === guestWelcome.id);
  const stillRacing = await guest.wait(
    (message) =>
      message.type === 'race' &&
      message.state.racers.some((racer: any) => racer.id === hostWelcome.id && racer.bot),
  );
  assert.equal(stillRacing.state.id, race.state.id);
  guest.socket.terminate();
  const resumed = await client(a.url);
  t.after(() => resumed.socket.terminate());
  resumed.send({
    type: 'resume',
    code: guestWelcome.room.code,
    id: guestWelcome.id,
    token: guestWelcome.token,
  });
  const welcome = await resumed.wait((message) => message.type === 'welcome');
  assert.equal(welcome.id, guestWelcome.id);
  const resumedRace = await resumed.wait((message) => message.type === 'race');
  assert.equal(resumedRace.state.id, race.state.id);
}

test('real WebSockets on separate server instances share rooms, simulation and reconnect leases', async (t) => {
  const store = new InMemoryRoomStore();
  await crossInstanceSockets(t, store, store);
});

test('closing a socket while Redis completes a join releases the undelivered player slot', async (t) => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  class DelayedStore extends InMemoryRoomStore {
    override async compareAndSet(code: string, revision: number, room: StoredRoom) {
      if (room.room.players.length === 2) {
        entered();
        await proceed;
      }
      return super.compareAndSet(code, revision, room);
    }
  }
  const store = new DelayedStore();
  const service = new RoomService(store);
  const host = await service.create(hostIdentity, 'coast', 'host');
  const app = await launch(store);
  t.after(async () => {
    release();
    await app.close();
  });
  const guest = await client(app.url);
  t.after(() => guest.socket.terminate());
  guest.send({ type: 'join', code: host.membership.code, ...guestIdentity });
  await waiting;
  const closed = new Promise<void>((resolve) => guest.socket.once('close', () => resolve()));
  guest.socket.terminate();
  await closed;
  // Allow the server's close event to run before its pending Redis mutation returns.
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const stored = (await store.get(host.membership.code))!;
    if (stored.revision >= 2 && stored.room.players.length === 1) {
      assert.equal(Object.keys(stored.sessions).length, 1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail('Closed socket left an undelivered guest in the room');
});

test('a complete server restart preserves race state and allows token resume on a new instance', async (t) => {
  const store = new InMemoryRoomStore();
  const first = await launch(store);
  const host = await client(first.url);
  host.send({ type: 'create', ...hostIdentity });
  const welcome = await host.wait((message) => message.type === 'welcome');
  host.send({ type: 'start' });
  const race = await host.wait(
    (message) => message.type === 'race' && message.state.countdown < 2.9,
  );
  await first.close();
  const replacement = await launch(store);
  t.after(() => replacement.close());
  const resumed = await client(replacement.url);
  t.after(() => resumed.socket.terminate());
  resumed.send({ type: 'resume', code: welcome.room.code, id: welcome.id, token: welcome.token });
  await resumed.wait((message) => message.type === 'welcome');
  const restored = await resumed.wait((message) => message.type === 'race');
  assert.equal(restored.state.id, race.state.id);
  assert.ok(restored.state.countdown <= race.state.countdown);
  const advanced = await resumed.wait(
    (message) => message.type === 'race' && message.state.countdown < restored.state.countdown,
  );
  assert.equal(advanced.state.id, race.state.id);
});

test(
  'Redis integration: independent Redis clients share authority across two HTTP servers',
  { skip: !process.env.TEST_REDIS_URL },
  async (t) => {
    const prefix = `pocket-circuit:test:${Date.now()}`;
    await crossInstanceSockets(
      t,
      new RedisRoomStore(process.env.TEST_REDIS_URL!, prefix),
      new RedisRoomStore(process.env.TEST_REDIS_URL!, prefix),
    );
  },
);

test(
  'missing Redis in production gives an explicit setup message after websocket upgrade',
  { skip: !!process.env.REDIS_URL },
  async (t) => {
    const app = await launch();
    t.after(() => app.close());
    const connection = await client(app.url);
    t.after(() => connection.socket.terminate());
    const error = await connection.wait((message) => message.type === 'error');
    assert.equal(error.fatal, true);
    assert.match(error.message, /REDIS_URL/);
  },
);
