import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { InMemoryRoomStore, RedisRoomStore } from './store.js';
import type { RoomStore, StoredRoom } from './store.js';
import {
  isRecord,
  parseCode,
  parseIdentity,
  parseTrack,
  ProtocolError,
  RoomService,
} from './rooms.js';
import type { Membership, Welcome } from './rooms.js';

export interface MultiplayerOptions {
  redisUrl?: string;
  store?: RoomStore;
  allowInMemory?: boolean;
  path?: string;
  /** Production deployments are same-origin by default. */
  allowedOrigins?: string[];
  /** Shorter rotation is useful in integration tests. */
  rotateAfterMs?: number;
}

interface Client {
  socket: WebSocket;
  connectionId: string;
  membership?: Membership;
  createdAt: number;
  lastSeen: number;
  lastRoom: string;
  lastRaceRevision: number;
  lastError: number;
  failures: number;
  rateAt: number;
  tokens: number;
  controlTokens: number;
  pending: number;
  leaveRequested: boolean;
  queue: Promise<void>;
  ipHash: string;
}

function send(client: Client, message: Record<string, unknown>): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  if (client.socket.bufferedAmount > 256 * 1024) {
    client.socket.close(1013, 'Connection too slow; reconnect');
    return;
  }
  client.socket.send(JSON.stringify({ ...message, v: 2 }));
}

function protocolError(client: Client, error: unknown, requestId?: string): void {
  const known = error instanceof ProtocolError;
  send(client, {
    type: 'error',
    requestId,
    message: known
      ? error.message
      : 'Der Multiplayer-Speicher antwortet gerade nicht. Die Verbindung wird erneut versucht.',
    fatal: known && error.fatal,
  });
  if (known && error.fatal) client.socket.close(1008, 'Session unavailable');
}

function publish(client: Client, stored: StoredRoom, force = false): void {
  if (stored.sessions[client.membership!.id]?.connectionId !== client.connectionId) {
    protocolError(
      client,
      new ProtocolError(
        'Deine Sitzung wurde getrennt oder in einem anderen Tab fortgesetzt.',
        true,
      ),
    );
    return;
  }
  const room = JSON.stringify(stored.room);
  if (force || room !== client.lastRoom) {
    send(client, { type: 'room', room: stored.room });
    client.lastRoom = room;
  }
  if (stored.race && (force || stored.revision !== client.lastRaceRevision)) {
    send(client, { type: 'race', state: stored.race.state });
    client.lastRaceRevision = stored.revision;
  }
}

function originAllowed(request: IncomingMessage, options: MultiplayerOptions): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    if (options.allowedOrigins?.includes(origin)) return true;
    const host = process.env.VERCEL
      ? (request.headers['x-forwarded-host'] ?? request.headers.host)
      : request.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Attach to Vercel's native Node server or Vite's development HTTP server. */
export function attachMultiplayerServer(server: EventEmitter, options: MultiplayerOptions = {}) {
  if (options.store instanceof InMemoryRoomStore && process.env.VERCEL)
    throw new Error('An in-memory multiplayer store is not allowed on Vercel. Set REDIS_URL.');
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  const store: RoomStore | undefined =
    options.store ??
    (redisUrl
      ? new RedisRoomStore(redisUrl)
      : options.allowInMemory && !process.env.VERCEL
        ? new InMemoryRoomStore()
        : undefined);
  const service = store ? new RoomService(store) : undefined;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const clients = new Set<Client>();
  const path = options.path ?? '/api/ws';
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeatAt = 0;
  let touchingAt = 0;
  let pumping = false;
  let closing = false;

  const welcome = async (client: Client, result: Welcome, requestId?: string, resumed = false) => {
    client.membership = result.membership;
    // A Redis operation can finish after the browser has already closed its socket.
    // New members never received a token, so release their slot instead of reserving it.
    if (client.socket.readyState !== WebSocket.OPEN) {
      await service!.disconnect(result.membership, !resumed || client.leaveRequested);
      client.membership = undefined;
      return;
    }
    client.lastRoom = JSON.stringify(result.stored.room);
    send(client, {
      type: 'welcome',
      requestId,
      id: result.membership.id,
      token: result.token,
      room: result.stored.room,
    });
    if (result.stored.race) {
      send(client, { type: 'race', state: result.stored.race.state });
      client.lastRaceRevision = result.stored.revision;
    }
  };

  const handle = async (client: Client, data: unknown) => {
    if (!service || !store) return;
    if (!isRecord(data) || data.v !== 2 || typeof data.type !== 'string')
      throw new ProtocolError('Ungültiges Multiplayer-Protokoll. Bitte lade die Seite neu.');
    const requestId =
      typeof data.requestId === 'string' && data.requestId.length <= 80
        ? data.requestId
        : undefined;
    const now = Date.now();
    const elapsed = Math.max(0, now - client.rateAt) / 1000;
    client.tokens = Math.min(90, client.tokens + elapsed * 60);
    client.controlTokens = Math.min(12, client.controlTokens + elapsed * 3);
    client.rateAt = now;
    if (--client.tokens < 0 || (data.type !== 'input' && --client.controlTokens < 0))
      throw new ProtocolError('Zu viele Nachrichten. Bitte warte kurz.', true);
    if (data.type === 'ping') {
      send(client, { type: 'pong', requestId, time: Date.now() });
      return;
    }
    if (data.type === 'create' || data.type === 'join' || data.type === 'resume') {
      if (client.membership) throw new ProtocolError('Du bist bereits in einem Raum.');
      if (!(await store.consumeRateLimit(client.ipHash, 24, 60_000)))
        throw new ProtocolError('Zu viele Verbindungsversuche. Bitte warte eine Minute.', true);
      if (data.type === 'create')
        await welcome(
          client,
          await service.create(
            parseIdentity(data),
            data.trackId === undefined ? 'coast' : parseTrack(data.trackId),
            client.connectionId,
          ),
          requestId,
        );
      else if (data.type === 'join')
        await welcome(
          client,
          await service.join(parseCode(data.code), parseIdentity(data), client.connectionId),
          requestId,
        );
      else {
        if (typeof data.id !== 'string' || typeof data.token !== 'string')
          throw new ProtocolError('Ungültige Sitzung.', true);
        await welcome(
          client,
          await service.resume(parseCode(data.code), data.id, data.token, client.connectionId),
          requestId,
          true,
        );
      }
      return;
    }
    if (!client.membership)
      throw new ProtocolError('Bitte erstelle zuerst einen Raum oder tritt einem bei.');
    if (data.type === 'input') await service.input(client.membership, data);
    else if (data.type === 'leave') {
      await service.disconnect(client.membership, true);
      client.membership = undefined;
      client.socket.close(1000, 'Left room');
    } else publish(client, await service.command(client.membership, data), true);
  };

  const pump = async () => {
    if (pumping || closing || !service) return;
    pumping = true;
    try {
      const now = Date.now();
      const heartbeat = now - heartbeatAt > 5000;
      const touch = now - touchingAt > 4000;
      if (heartbeat) heartbeatAt = now;
      if (touch) touchingAt = now;
      const rooms = new Map<string, Client[]>();
      for (const client of clients) {
        if (client.socket.readyState !== WebSocket.OPEN) continue;
        if (
          now - client.lastSeen > 16_000 ||
          (!client.membership && now - client.createdAt > 10_000)
        ) {
          client.socket.terminate();
          continue;
        }
        if (now - client.createdAt > (options.rotateAfterMs ?? 240_000)) {
          client.socket.close(1012, 'Server renewal; resume session');
          continue;
        }
        if (heartbeat) client.socket.ping();
        if (!client.membership) continue;
        const list = rooms.get(client.membership.code) ?? [];
        list.push(client);
        rooms.set(client.membership.code, list);
      }
      await Promise.all(
        [...rooms].map(async ([code, members]) => {
          try {
            if (touch)
              await service.touch(
                code,
                members.map((member) => member.membership!),
              );
            const stored = await service.advance(code);
            for (const member of members) {
              if (!member.membership) continue;
              member.failures = 0;
              publish(member, stored);
            }
          } catch (error) {
            for (const member of members) {
              member.failures++;
              if (now - member.lastError > 5000) {
                member.lastError = now;
                protocolError(member, error);
              }
              if (member.failures > 4) member.socket.close(1013, 'Store unavailable; retry');
            }
          }
        }),
      );
    } finally {
      pumping = false;
    }
  };

  wss.on('connection', (socket, request) => {
    if (!service) {
      socket.send(
        JSON.stringify({
          v: 2,
          type: 'error',
          fatal: true,
          message:
            'Multiplayer ist noch nicht eingerichtet. Verbinde in Vercel eine Redis-Datenbank und setze REDIS_URL. Danach neu deployen.',
        }),
      );
      socket.close(1011, 'REDIS_URL is required');
      return;
    }
    if (clients.size >= 256) {
      socket.close(1013, 'Server busy; retry');
      return;
    }
    const rawIp = process.env.VERCEL
      ? String(request.headers['x-forwarded-for'] ?? '').split(',')[0]
      : (request.socket.remoteAddress ?? 'local');
    const client: Client = {
      socket,
      connectionId: randomUUID(),
      createdAt: Date.now(),
      lastSeen: Date.now(),
      lastRoom: '',
      lastRaceRevision: -1,
      lastError: 0,
      failures: 0,
      rateAt: Date.now(),
      tokens: 90,
      controlTokens: 12,
      pending: 0,
      leaveRequested: false,
      queue: Promise.resolve(),
      ipHash: createHash('sha256').update(rawIp).digest('hex').slice(0, 24),
    };
    clients.add(client);
    socket.on('pong', () => {
      client.lastSeen = Date.now();
    });
    socket.on('error', () => socket.close());
    socket.on('message', (raw, isBinary) => {
      client.lastSeen = Date.now();
      const length = Array.isArray(raw)
        ? raw.reduce((sum, part) => sum + part.byteLength, 0)
        : raw.byteLength;
      if (isBinary || length > 4096 || client.pending > 90) {
        socket.close(1008, 'Invalid or excessive payload');
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        protocolError(client, new ProtocolError('Ungültige Nachricht.', true));
        return;
      }
      const requestId =
        isRecord(message) && typeof message.requestId === 'string' && message.requestId.length <= 80
          ? message.requestId
          : undefined;
      if (isRecord(message) && message.v === 2 && message.type === 'leave')
        client.leaveRequested = true;
      client.pending++;
      client.queue = client.queue
        .then(async () => {
          if (
            socket.readyState === WebSocket.OPEN ||
            (client.membership && isRecord(message) && message.type === 'leave')
          )
            await handle(client, message);
        })
        .catch((error: unknown) => protocolError(client, error, requestId))
        .finally(() => {
          client.pending--;
        });
    });
    socket.on('close', () => {
      clients.delete(client);
      const membership = client.membership;
      // A close frame often immediately follows "leave". Finish received commands
      // before releasing the lease, so an explicit leave still transfers the host.
      if (membership && !closing)
        void client.queue
          .then(() => service.disconnect(membership, client.leaveRequested))
          .catch(() => {});
      if (!clients.size && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
    if (!timer) {
      timer = setInterval(() => {
        void pump();
      }, 1000 / 15);
      timer.unref();
    }
  });

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split('?')[0] !== path) return;
    if (closing || !originAllowed(request, options)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request);
    });
  };
  server.on('upgrade', upgrade);

  return {
    wss,
    service,
    async close(): Promise<void> {
      closing = true;
      if (timer) clearInterval(timer);
      server.removeListener('upgrade', upgrade);
      for (const client of clients) client.socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      if (!options.store) await store?.close();
    },
  };
}
