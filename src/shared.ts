export type TrackId = 'coast' | 'canyon' | 'midnight';
export type ItemKind = 'boost' | 'shield' | 'pulse';
export type Phase = 'countdown' | 'racing' | 'finished';
export const TRACK_WEATHER: Record<TrackId, string> = {
  coast: 'Goldene Stunde',
  canyon: 'Staubiger Wind',
  midnight: 'Regen bei Nacht',
};
export interface Track {
  id: TrackId;
  name: string;
  subtitle: string;
  difficulty: string;
  color: string;
  sky: string;
  ground: string;
  road: string;
  width: number;
  points: [number, number][];
}
export const TRACKS: Track[] = [
  {
    id: 'coast',
    name: 'Sunset Bay',
    subtitle: 'Palmen. Meer. Vollgas.',
    difficulty: 'EINSTEIGER',
    color: '#bdf04e',
    sky: '#c7e4e3',
    ground: '#e5cfa8',
    road: '#646b72',
    width: 15,
    points: [
      [0, 0],
      [0, 100],
      [55, 155],
      [140, 145],
      [175, 75],
      [135, 15],
      [175, -65],
      [110, -130],
      [25, -100],
      [-35, -50],
    ],
  },
  {
    id: 'canyon',
    name: 'Dust Valley',
    subtitle: 'Heiße Kurven im roten Canyon.',
    difficulty: 'FORTGESCHRITTEN',
    color: '#ffb575',
    sky: '#ecd3bc',
    ground: '#b96e46',
    road: '#735749',
    width: 14,
    points: [
      [0, 0],
      [0, 105],
      [65, 130],
      [110, 60],
      [65, 0],
      [125, -55],
      [180, -20],
      [220, -85],
      [155, -150],
      [60, -135],
      [-40, -70],
    ],
  },
  {
    id: 'midnight',
    name: 'Neon Harbor',
    subtitle: 'Nachts gehört die Stadt dir.',
    difficulty: 'EXPERTE',
    color: '#ad9bff',
    sky: '#11192f',
    ground: '#1b2944',
    road: '#344158',
    width: 13,
    points: [
      [0, 0],
      [0, 120],
      [70, 170],
      [145, 120],
      [110, 40],
      [190, -20],
      [140, -110],
      [50, -130],
      [20, -60],
      [-50, -90],
      [-85, -20],
    ],
  },
];
export interface Skin {
  id: string;
  name: string;
  color: string;
  accent: string;
  price: number;
  level: number;
  label: string;
}
export const SKINS: Skin[] = [
  {
    id: 'lime',
    name: 'Lime Original',
    color: '#bdf04e',
    accent: '#293932',
    price: 0,
    level: 1,
    label: 'ORIGINAL',
  },
  {
    id: 'coral',
    name: 'Coral Club',
    color: '#ff775c',
    accent: '#ffe1bd',
    price: 180,
    level: 1,
    label: 'CLASSIC',
  },
  {
    id: 'blue',
    name: 'Blue Hour',
    color: '#5abaf2',
    accent: '#f0f7fa',
    price: 300,
    level: 2,
    label: 'CLASSIC',
  },
  {
    id: 'violet',
    name: 'After Hours',
    color: '#b09afc',
    accent: '#3a295e',
    price: 450,
    level: 3,
    label: 'RARE',
  },
  {
    id: 'gold',
    name: 'Gold Rush',
    color: '#ffcf58',
    accent: '#fff1ba',
    price: 650,
    level: 4,
    label: 'RARE',
  },
  {
    id: 'phantom',
    name: 'Phantom',
    color: '#353b48',
    accent: '#d6fd67',
    price: 900,
    level: 5,
    label: 'LEGEND',
  },
];
export interface Player {
  id: string;
  name: string;
  skin: string;
  ready: boolean;
  bot?: boolean;
}
export interface InputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  item: boolean;
}
export const EMPTY_INPUT: InputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  drift: false,
  item: false,
};
export interface Racer {
  id: string;
  name: string;
  skin: string;
  bot: boolean;
  x: number;
  z: number;
  heading: number;
  speed: number;
  progress: number;
  lap: number;
  position: number;
  finished: boolean;
  finishTime: number | null;
  item: ItemKind | null;
  boost: number;
  shield: number;
  stun: number;
  driftCharge: number;
  drifting: boolean;
  coins: number;
  /** Short collision impulse for visual suspension, sparks and camera feedback. */
  impact?: number;
  /** Smoothed front-wheel steering in [-1, 1]. */
  steering?: number;
}
export interface RaceState {
  id: string;
  trackId: TrackId;
  phase: Phase;
  countdown: number;
  elapsed: number;
  racers: Racer[];
  pickups: { id: number; progress: number; availableAt: number; kind: 'item' | 'coin' }[];
}
export interface TrackSample {
  x: number;
  z: number;
  heading: number;
  progress: number;
}
export interface RoomState {
  code: string;
  hostId: string;
  trackId: TrackId;
  players: Player[];
  racing: boolean;
}
export const LAPS = 3;
export function getTrack(id: TrackId) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
export function getSkin(id: string) {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
