import assert from 'node:assert/strict';
import WebSocket from 'ws';

// Usage: BASE_URL=https://your-deployment.vercel.app node tests/live-multiplayer.mjs
// Uses only the public game protocol. Never requires or reads Redis credentials.
if (!process.env.BASE_URL) throw new Error('Set BASE_URL to the v2 deployment to test.');
const base = new URL(process.env.BASE_URL);
const endpoint = new URL('/api/ws', base);
endpoint.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
const idle = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  drift: false,
  item: false,
};
const peers = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const socket = new WebSocket(endpoint, { origin: base.origin, handshakeTimeout: 12_000 });
  const peer = {
    socket,
    messages: [],
    sequence: 0,
    raceId: null,
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 2, ...message }));
    },
    input(input) {
      peer.send({
        type: 'input',
        raceId: peer.raceId,
        seq: peer.sequence++,
        input: { ...idle, ...input },
      });
    },
    async wait(predicate, timeout = 12_000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const failure = peer.messages.find((message) => message.type === 'error');
        if (failure) throw new Error(failure.message);
        const result = [...peer.messages].reverse().find(predicate);
        if (result) return result;
        await delay(20);
      }
      throw new Error(`No expected message within ${timeout}ms (socket=${socket.readyState}).`);
    },
  };
  peers.push(peer);
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.v !== 2) throw new Error('Deployment is not running multiplayer protocol v2.');
    peer.messages.push(message);
    if (peer.messages.length > 600) peer.messages.shift();
    if (message.type === 'race') peer.raceId = message.state.id;
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) =>
      reject(new Error(`WebSocket upgrade returned HTTP ${response.statusCode}.`)),
    );
  });
  socket.on('error', () => {});
  return peer;
}

async function drive(duration, clients) {
  const until = Date.now() + duration;
  while (Date.now() < until) {
    for (const [peer, input] of clients) peer.input(input);
    await delay(70);
  }
}

try {
  const host = await connect();
  const guest = await connect();
  host.send({ type: 'create', name: 'Server Test Host', skin: 'lime', trackId: 'coast' });
  const hosted = await host.wait((message) => message.type === 'welcome');
  guest.send({ type: 'join', code: hosted.room.code, name: 'Server Test Guest', skin: 'coral' });
  const joined = await guest.wait((message) => message.type === 'welcome');
  assert.notEqual(hosted.id, joined.id);
  assert.notEqual(hosted.token, joined.token);
  guest.send({ type: 'ready', ready: true });
  await host.wait(
    (message) =>
      message.type === 'room' &&
      message.room.players.length === 2 &&
      message.room.players.every((player) => player.ready),
  );
  host.send({ type: 'start' });
  const initial = await guest.wait(
    (message) => message.type === 'race' && message.state.phase === 'racing',
  );
  await host.wait(
    (message) =>
      message.type === 'race' &&
      message.state.id === initial.state.id &&
      message.state.phase === 'racing',
  );
  const guestStart = initial.state.racers.find((racer) => racer.id === joined.id);
  await drive(1400, [
    [host, { throttle: true }],
    [guest, { throttle: true }],
  ]);
  const moving = await guest.wait(
    (message) =>
      message.type === 'race' &&
      message.state.racers.some(
        (racer) =>
          racer.id === joined.id && racer.speed > 5 && racer.progress > guestStart.progress + 2,
      ),
  );
  const hostMoving = await host.wait(
    (message) =>
      message.type === 'race' &&
      message.state.racers.some((racer) => racer.id === hosted.id && racer.speed > 5),
  );
  assert.equal(moving.state.id, hostMoving.state.id);
  await drive(450, [
    [host, { throttle: true }],
    [guest, { throttle: true, right: true }],
  ]);
  await guest.wait(
    (message) =>
      message.type === 'race' &&
      message.state.racers.some((racer) => racer.id === joined.id && racer.steering > 0.1),
  );
  host.send({ type: 'leave' });
  host.socket.close();
  await guest.wait(
    (message) =>
      message.type === 'room' &&
      message.room.hostId === joined.id &&
      message.room.players.length === 1,
  );
  await guest.wait(
    (message) =>
      message.type === 'race' &&
      message.state.id === initial.state.id &&
      message.state.racers.some((racer) => racer.id === hosted.id && racer.bot),
  );
  guest.socket.terminate();
  const resumed = await connect();
  resumed.send({ type: 'resume', code: joined.room.code, id: joined.id, token: joined.token });
  const restored = await resumed.wait((message) => message.type === 'welcome');
  assert.equal(restored.id, joined.id);
  await resumed.wait((message) => message.type === 'race' && message.state.id === initial.state.id);
  await drive(350, [[resumed, { throttle: true }]]);
  await resumed.wait(
    (message) => message.type === 'race' && message.state.elapsed > moving.state.elapsed,
  );
  resumed.send({ type: 'leave' });
  await delay(250);
  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: endpoint.origin + endpoint.pathname,
        checks: [
          'create/join',
          'readiness',
          'server countdown',
          'host and guest input',
          'guest steering',
          'same authoritative race',
          'host transfer after immediate close',
          'race survives host leave',
          'token resume on new socket',
          'continued simulation',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  for (const peer of peers) {
    if (peer.socket.readyState === WebSocket.OPEN) peer.send({ type: 'leave' });
  }
  await delay(80);
  for (const peer of peers) peer.socket.terminate();
}
