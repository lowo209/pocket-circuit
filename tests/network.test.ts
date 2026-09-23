import assert from 'node:assert/strict';
import test from 'node:test';
import { Multiplayer } from '../src/network';
import { createRace } from '../src/game/simulation';
import { EMPTY_INPUT, type RaceState, type RoomState } from '../src/shared';

class Socket {
  readyState = 0;
  bufferedAmount = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: any[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ v: 2, ...(data as object) }) });
  }
}
const lobby = (): RoomState => ({
  code: 'ABC234',
  hostId: 'host',
  trackId: 'coast',
  racing: false,
  players: [
    { id: 'host', name: 'Host', skin: 'lime', ready: true },
    { id: 'guest', name: 'Guest', skin: 'coral', ready: true },
  ],
});
function harness(t: any) {
  const sockets: Socket[] = [],
    rooms: (RoomState | null)[] = [],
    races: RaceState[] = [],
    errors: string[] = [],
    statuses: string[] = [];
  const network = new Multiplayer(
    {
      onRoom: (r) => rooms.push(r),
      onRace: (r) => races.push(r),
      onError: (e) => errors.push(e),
      onStatus: (s) => statuses.push(s),
      onDisconnect: () => {},
    },
    {
      endpoint: 'ws://test/api/ws',
      socketFactory: () => {
        const s = new Socket();
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    },
  );
  t.after(() => network.dispose());
  async function connect() {
    const pending = network.join('ABC234', { name: 'Guest', skin: 'coral' });
    const s = sockets.at(-1)!;
    s.open();
    s.receive({ type: 'welcome', id: 'guest', token: 'a-private-session-token', room: lobby() });
    await pending;
    return s;
  }
  return { network, sockets, rooms, races, errors, statuses, connect };
}

test('client uses same protocol and sends controls, never authoritative positions', async (t) => {
  const h = harness(t),
    s = await h.connect();
  assert.equal(s.sent[0].type, 'join');
  assert.equal(s.sent[0].v, 2);
  const room = { ...lobby(), racing: true };
  s.receive({ type: 'room', room });
  const state = createRace('coast', room.players);
  s.receive({ type: 'race', state });
  h.network.sendInput({ ...EMPTY_INPUT, throttle: true });
  assert.equal(s.sent.at(-1).type, 'input');
  assert.equal(s.sent.at(-1).raceId, state.id);
  assert.equal(s.sent.at(-1).seq, 1);
  assert.equal(s.sent.at(-1).state, undefined);
  assert.equal(s.sent.at(-1).id, undefined);
  s.bufferedAmount = 128 * 1024;
  const count = s.sent.length;
  h.network.sendInput(EMPTY_INPUT);
  assert.equal(s.sent.length, count);
});

test('invalid snapshots and stale race packets cannot corrupt renderer state', async (t) => {
  const h = harness(t),
    s = await h.connect();
  s.receive({ type: 'room', room: { ...lobby(), racing: true } });
  const state = createRace('coast', lobby().players);
  const broken = structuredClone(state);
  broken.racers[0].steering = 4;
  s.receive({ type: 'race', state: broken });
  assert.equal(h.races.length, 0);
  s.receive({ type: 'race', state });
  s.receive({ type: 'race', state: { ...state, id: 'old' } });
  assert.equal(h.races.length, 1);
  s.receive({ type: 'room', room: lobby() });
  s.receive({ type: 'race', state });
  assert.equal(h.races.length, 1);
  s.receive({ type: 'room', room: { ...lobby(), racing: true } });
  s.receive({ type: 'race', state: createRace('coast', lobby().players) });
  assert.equal(h.races.length, 2);
});

test('connection rotation resumes the same player with secret token and current room', async (t) => {
  const h = harness(t),
    s = await h.connect();
  s.close();
  assert.equal(h.statuses.at(-1), 'reconnecting');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const next = h.sockets.at(-1)!;
  assert.notEqual(next, s);
  next.open();
  assert.deepEqual(next.sent[0], {
    v: 2,
    type: 'resume',
    code: 'ABC234',
    id: 'guest',
    token: 'a-private-session-token',
  });
  next.receive({ type: 'welcome', id: 'guest', token: 'a-private-session-token', room: lobby() });
  assert.equal(h.network.localId, 'guest');
  assert.equal(h.statuses.at(-1), 'connected');
  s.receive({ type: 'error', fatal: true, message: 'stale socket' });
  assert.deepEqual(h.errors, []);
});

test('setup and join failures are surfaced to the user without hiding the server reason', async (t) => {
  const h = harness(t);
  const pending = h.network.host({ name: 'Host', skin: 'lime' }, 'coast');
  const assertion = assert.rejects(pending, /REDIS_URL/);
  h.sockets[0].open();
  h.sockets[0].receive({
    type: 'error',
    fatal: true,
    message: 'REDIS_URL fehlt im Vercel-Projekt.',
  });
  await assertion;
  assert.equal(h.statuses.at(-1), 'offline');
});

test('host transfer updates lobby permissions without reconnecting', async (t) => {
  const h = harness(t),
    s = await h.connect();
  assert.equal(h.network.isHost, false);
  s.receive({ type: 'room', room: { ...lobby(), hostId: 'guest', players: [lobby().players[1]] } });
  assert.equal(h.network.isHost, true);
  h.network.startRace();
  assert.deepEqual(s.sent.at(-1), { v: 2, type: 'start' });
});
