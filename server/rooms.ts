import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createRace,
  exportRaceRuntime,
  restoreRaceRuntime,
  stepRace,
} from '../src/game/simulation.js';
import { EMPTY_INPUT, SKINS, TRAILS } from '../src/shared.js';
import type { InputState, TrackId } from '../src/shared.js';
import type { RoomStore, StoredRoom } from './store.js';

export const RECONNECT_GRACE_MS = 45_000;
export const SESSION_STALE_MS = 16_000;
export const INPUT_STALE_MS = 750;
const STEP_MS = 1000 / 60;
const ROOM_TICK_MS = 95;
const MAX_CATCHUP_STEPS = 15;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly fatal = false,
  ) {
    super(message);
  }
}

export interface Identity {
  name: string;
  skin: string;
  trail?: string;
}
export interface Membership {
  code: string;
  id: string;
  connectionId: string;
}
export interface Welcome {
  membership: Membership;
  token: string;
  stored: StoredRoom;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseIdentity(value: Record<string, unknown>): Identity {
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.trim().length > 20 ||
    /[\u0000-\u001f\u007f]/.test(value.name)
  )
    throw new ProtocolError('Bitte wähle einen Namen mit 1 bis 20 Zeichen.');
  if (typeof value.skin !== 'string' || !SKINS.some((skin) => skin.id === value.skin))
    throw new ProtocolError('Dieser Skin ist nicht verfügbar.');
  if (value.trail !== undefined &&
      (typeof value.trail !== 'string' || !TRAILS.some((trail) => trail.id === value.trail)))
    throw new ProtocolError('Dieser Trail ist nicht verfügbar.');
  return { name: value.name.trim(), skin: value.skin, trail: (value.trail as string | undefined) ?? 'none' };
}

export function parseCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z2-9]{6}$/.test(value.toUpperCase()))
    throw new ProtocolError('Der Raumcode muss sechs Zeichen haben.');
  return value.toUpperCase();
}

export function parseTrack(value: unknown): TrackId {
  if (value !== 'coast' && value !== 'canyon' && value !== 'midnight')
    throw new ProtocolError('Unbekannte Strecke.');
  return value;
}

export function parseInput(value: unknown): InputState {
  if (!isRecord(value) || !Object.keys(EMPTY_INPUT).every((key) => typeof value[key] === 'boolean'))
    throw new ProtocolError('Ungültige Steuerung.');
  return {
    throttle: value.throttle as boolean,
    brake: value.brake as boolean,
    left: value.left as boolean,
    right: value.right as boolean,
    drift: value.drift as boolean,
    item: value.item as boolean,
  };
}

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function matchesToken(hash: string, token: string): boolean {
  const candidate = Buffer.from(tokenHash(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export class RoomService {
  constructor(
    readonly store: RoomStore,
    private readonly now: () => number = Date.now,
  ) {}

  private async mutate(
    code: string,
    change: (room: StoredRoom, now: number) => boolean,
  ): Promise<StoredRoom> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const stored = await this.store.get(code);
      if (!stored)
        throw new ProtocolError('Der Raum existiert nicht mehr. Erstelle einen neuen Raum.', true);
      const revision = stored.revision;
      const now = this.now();
      if (!change(stored, now)) return stored;
      stored.revision = revision + 1;
      stored.updatedAt = now;
      if (await this.store.compareAndSet(code, revision, stored)) return stored;
    }
    throw new ProtocolError('Der Raum ist gerade beschäftigt. Bitte versuche es erneut.');
  }

  private authorize(stored: StoredRoom, membership: Membership): void {
    if (stored.sessions[membership.id]?.connectionId !== membership.connectionId)
      throw new ProtocolError(
        'Diese Sitzung wurde getrennt oder auf einem anderen Tab fortgesetzt.',
        true,
      );
  }

  private authorizeHost(stored: StoredRoom, membership: Membership): void {
    this.authorize(stored, membership);
    if (stored.room.hostId !== membership.id)
      throw new ProtocolError('Nur der Host kann das machen.');
  }

  async create(identity: Identity, trackId: TrackId, connectionId: string): Promise<Welcome> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = Array.from(
        { length: 6 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const stored: StoredRoom = {
        revision: 0,
        room: {
          code,
          hostId: id,
          trackId,
          racing: false,
          players: [{ id, ...identity, ready: true }],
        },
        sessions: {
          [id]: { tokenHash: tokenHash(token), connectionId, lastSeen: now, disconnectedAt: null },
        },
        race: null,
        lastTick: now,
        updatedAt: now,
      };
      if (await this.store.create(stored))
        return { membership: { code, id, connectionId }, token, stored };
    }
    throw new ProtocolError('Es konnte kein Raum erstellt werden. Bitte versuche es erneut.');
  }

  async join(code: string, identity: Identity, connectionId: string): Promise<Welcome> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const stored = await this.mutate(code, (stored, now) => {
      this.reap(stored, now);
      if (stored.room.racing)
        throw new ProtocolError('Das Rennen läuft bereits. Warte auf die nächste Runde.');
      if (stored.room.players.length >= 4)
        throw new ProtocolError('Der Raum ist voll. Maximal 4 Fahrer können mitspielen.');
      stored.room.players.push({ id, ...identity, ready: false });
      stored.sessions[id] = {
        tokenHash: tokenHash(token),
        connectionId,
        lastSeen: now,
        disconnectedAt: null,
      };
      if (!stored.room.hostId) {
        stored.room.hostId = id;
        stored.room.players.at(-1)!.ready = true;
      }
      return true;
    });
    return { membership: { code, id, connectionId }, token, stored };
  }

  async resume(code: string, id: string, token: string, connectionId: string): Promise<Welcome> {
    if (id.length > 80 || token.length > 100) throw new ProtocolError('Ungültige Sitzung.', true);
    const stored = await this.mutate(code, (stored, now) => {
      this.reap(stored, now);
      const session = stored.sessions[id];
      if (!session || !matchesToken(session.tokenHash, token))
        throw new ProtocolError('Die Sitzung ist abgelaufen. Tritt dem Raum erneut bei.', true);
      session.connectionId = connectionId;
      session.lastSeen = now;
      session.disconnectedAt = null;
      const racer = stored.race?.state.racers.find((racer) => racer.id === id);
      if (racer) racer.bot = false;
      return true;
    });
    return { membership: { code, id, connectionId }, token, stored };
  }

  async command(membership: Membership, message: Record<string, unknown>): Promise<StoredRoom> {
    return this.mutate(membership.code, (stored, now) => {
      this.authorize(stored, membership);
      const player = stored.room.players.find((player) => player.id === membership.id)!;
      switch (message.type) {
        case 'ready':
          if (typeof message.ready !== 'boolean')
            throw new ProtocolError('Ungültiger Bereitschaftsstatus.');
          if (stored.room.racing) throw new ProtocolError('Das Rennen läuft bereits.');
          player.ready = player.id === stored.room.hostId || message.ready;
          break;
        case 'track':
          this.authorizeHost(stored, membership);
          if (stored.room.racing)
            throw new ProtocolError('Die Strecke kann nur in der Lobby geändert werden.');
          stored.room.trackId = parseTrack(message.trackId);
          for (const player of stored.room.players) player.ready = player.id === stored.room.hostId;
          break;
        case 'start': {
          this.authorizeHost(stored, membership);
          if (stored.room.racing) throw new ProtocolError('Das Rennen läuft bereits.');
          this.reap(stored, now);
          if (
            !stored.room.players.every(
              (player) =>
                player.ready &&
                stored.sessions[player.id]?.connectionId &&
                now - stored.sessions[player.id].lastSeen <= SESSION_STALE_MS,
            )
          )
            throw new ProtocolError('Alle Fahrer müssen verbunden und bereit sein.');
          const state = createRace(stored.room.trackId, stored.room.players, true);
          stored.race = { state, runtime: exportRaceRuntime(state) };
          stored.room.racing = true;
          stored.lastTick = now;
          break;
        }
        case 'lobby':
          this.authorizeHost(stored, membership);
          stored.room.racing = false;
          stored.race = null;
          for (const player of stored.room.players) player.ready = player.id === stored.room.hostId;
          break;
        default:
          throw new ProtocolError('Unbekannte Nachricht.');
      }
      stored.sessions[membership.id].lastSeen = now;
      return true;
    });
  }

  async input(membership: Membership, message: Record<string, unknown>): Promise<boolean> {
    if (
      typeof message.raceId !== 'string' ||
      message.raceId.length > 80 ||
      !Number.isSafeInteger(message.seq) ||
      (message.seq as number) < 0
    )
      throw new ProtocolError('Ungültige Eingabesequenz.');
    return this.store.setInput(membership.code, membership.id, {
      connectionId: membership.connectionId,
      raceId: message.raceId,
      seq: message.seq as number,
      at: this.now(),
      input: parseInput(message.input),
    });
  }

  async touch(code: string, memberships: Membership[]): Promise<StoredRoom> {
    return this.mutate(code, (stored, now) => {
      let changed = this.reap(stored, now);
      for (const member of memberships) {
        const session = stored.sessions[member.id];
        if (session?.connectionId === member.connectionId) {
          session.lastSeen = now;
          changed = true;
        }
      }
      return changed;
    });
  }

  async disconnect(membership: Membership, leave = false): Promise<void> {
    try {
      await this.mutate(membership.code, (stored, now) => {
        const session = stored.sessions[membership.id];
        if (session?.connectionId !== membership.connectionId) return false;
        if (leave) this.removePlayer(stored, membership.id);
        else {
          session.connectionId = null;
          session.disconnectedAt = now;
        }
        return true;
      });
    } catch (error) {
      if (!(error instanceof ProtocolError && error.fatal)) throw error;
    }
  }

  private removePlayer(stored: StoredRoom, id: string): void {
    delete stored.sessions[id];
    stored.room.players = stored.room.players.filter((player) => player.id !== id);
    const racer = stored.race?.state.racers.find((racer) => racer.id === id);
    if (racer) racer.bot = true;
    if (stored.room.hostId === id) {
      const host =
        stored.room.players.find((player) => stored.sessions[player.id]?.connectionId) ??
        stored.room.players[0];
      stored.room.hostId = host?.id ?? '';
      if (host) host.ready = true;
    }
  }

  private reap(stored: StoredRoom, now: number): boolean {
    let changed = false;
    for (const [id, session] of Object.entries(stored.sessions)) {
      if (session.connectionId && now - session.lastSeen > SESSION_STALE_MS) {
        session.connectionId = null;
        session.disconnectedAt = session.lastSeen + SESSION_STALE_MS;
        changed = true;
      }
      if (session.disconnectedAt !== null && now - session.disconnectedAt > RECONNECT_GRACE_MS) {
        this.removePlayer(stored, id);
        changed = true;
      }
    }
    return changed;
  }

  async advance(code: string): Promise<StoredRoom> {
    // Most Function instances only need the latest snapshot. Avoid reading every
    // input hash and racing a CAS when another instance has just advanced it.
    const current = await this.store.get(code);
    if (!current)
      throw new ProtocolError('Der Raum existiert nicht mehr. Erstelle einen neuen Raum.', true);
    if (!current.room.racing || !current.race || current.race.state.phase === 'finished' ||
        this.now() - current.lastTick < ROOM_TICK_MS)
      return current;
    const inputs = await this.store.getInputs(code);
    return this.mutate(code, (stored, now) => {
      let changed = this.reap(stored, now);
      if (!stored.room.racing || !stored.race || stored.race.state.phase === 'finished')
        return changed;
      const elapsed = Math.max(0, now - stored.lastTick);
      const steps = Math.min(MAX_CATCHUP_STEPS, Math.floor((elapsed + 0.001) / STEP_MS));
      if (!steps) return changed;
      const { state, runtime } = stored.race;
      restoreRaceRuntime(state, runtime);
      const controls: Record<string, InputState> = {};
      for (const racer of state.racers) {
        const session = stored.sessions[racer.id];
        if (session) racer.bot = !session.connectionId;
        const value = inputs[racer.id];
        if (
          session?.connectionId &&
          value?.connectionId === session.connectionId &&
          value.raceId === state.id &&
          now - value.at < INPUT_STALE_MS
        )
          controls[racer.id] = value.input;
        else controls[racer.id] = EMPTY_INPUT;
      }
      let remaining = steps;
      while (remaining > 0) {
        const count = Math.min(remaining, 6);
        stepRace(state, controls, count / 60);
        remaining -= count;
      }
      stored.race.runtime = exportRaceRuntime(state);
      // Never simulate a minutes-long suspension or double-tick after an instance handoff.
      stored.lastTick =
        elapsed > MAX_CATCHUP_STEPS * STEP_MS ? now : stored.lastTick + steps * STEP_MS;
      return true;
    });
  }
}
