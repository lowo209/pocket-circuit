import { SKINS, TRAILS } from './shared';
import type { RaceState, TrackId } from './shared';
export interface Profile {
  name: string;
  xp: number;
  coins: number;
  owned: string[];
  equipped: string;
  ownedTrails: string[];
  equippedTrail: string;
  races: number;
  wins: number;
  bestTimes: Partial<Record<TrackId, number>>;
  completed: string[];
}
const KEY = 'pocket-circuit.profile.v1';
export const newProfile = (): Profile => ({
  name: 'Rookie',
  xp: 0,
  coins: 120,
  owned: ['lime'],
  equipped: 'lime',
  ownedTrails: ['none'],
  equippedTrail: 'none',
  races: 0,
  wins: 0,
  bestTimes: {},
  completed: [],
});
export const levelFor = (xp: number) => 1 + Math.floor(xp / 250);
export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!p || typeof p !== 'object') return newProfile();
    const n = (v: unknown, d = 0) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d;
    const owned = Array.isArray(p.owned)
      ? p.owned.filter((s: unknown) => SKINS.some((k) => k.id === s))
      : ['lime'];
    if (!owned.includes('lime')) owned.push('lime');
    const ownedTrails = Array.isArray(p.ownedTrails)
      ? p.ownedTrails.filter((id: unknown) => TRAILS.some((trail) => trail.id === id))
      : ['none'];
    if (!ownedTrails.includes('none')) ownedTrails.push('none');
    return {
      name: typeof p.name === 'string' ? p.name.slice(0, 18) : 'Rookie',
      xp: n(p.xp),
      coins: n(p.coins, 120),
      owned,
      equipped: owned.includes(p.equipped) ? p.equipped : 'lime',
      ownedTrails,
      equippedTrail: ownedTrails.includes(p.equippedTrail) ? p.equippedTrail : 'none',
      races: n(p.races),
      wins: n(p.wins),
      bestTimes: Object.fromEntries(
        Object.entries(p.bestTimes ?? {}).filter(
          ([k, v]) =>
            ['coast', 'canyon', 'midnight'].includes(k) &&
            typeof v === 'number' &&
            Number.isFinite(v) &&
            v > 0,
        ),
      ),
      completed: Array.isArray(p.completed)
        ? p.completed.filter((s: unknown) => typeof s === 'string').slice(-50)
        : [],
    };
  } catch {
    return newProfile();
  }
}
export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
export function rewardRace(
  p: Profile,
  race: RaceState,
  localId: string,
): { profile: Profile; coins: number; xp: number } | null {
  const me = race.racers.find((r) => r.id === localId);
  if (!me?.finished || p.completed.includes(race.id)) return null;
  const coins = 40 + (7 - me.position) * 12 + me.coins * 3;
  const xp = 70 + (7 - me.position) * 20;
  const best = p.bestTimes[race.trackId];
  return {
    coins,
    xp,
    profile: {
      ...p,
      coins: p.coins + coins,
      xp: p.xp + xp,
      races: p.races + 1,
      wins: p.wins + (me.position === 1 ? 1 : 0),
      completed: [...p.completed, race.id].slice(-50),
      bestTimes: {
        ...p.bestTimes,
        [race.trackId]: me.finishTime && (!best || me.finishTime < best) ? me.finishTime : best,
      },
    },
  };
}
export function buySkin(p: Profile, id: string): Profile | null {
  const skin = SKINS.find((s) => s.id === id);
  if (!skin || p.owned.includes(id) || p.coins < skin.price || levelFor(p.xp) < skin.level)
    return null;
  return { ...p, coins: p.coins - skin.price, owned: [...p.owned, id], equipped: id };
}
export function buyTrail(p: Profile, id: string): Profile | null {
  const trail = TRAILS.find((candidate) => candidate.id === id);
  if (!trail || p.ownedTrails.includes(id) || p.coins < trail.price || levelFor(p.xp) < trail.level)
    return null;
  return {
    ...p,
    coins: p.coins - trail.price,
    ownedTrails: [...p.ownedTrails, id],
    equippedTrail: id,
  };
}
export function formatTime(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  return `${m}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}.${Math.floor((seconds % 1) * 100)
    .toString()
    .padStart(2, '0')}`;
}
