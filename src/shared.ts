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
    subtitle: 'Leuchtturm, Strandpromenade & weite Kurven.',
    difficulty: 'EINSTEIGER',
    color: '#bdf04e',
    sky: '#c7e4e3',
    ground: '#e5cfa8',
    road: '#646b72',
    width: 15,
    points: [
      [0, 0],
      [0, 90],
      [35, 155],
      [105, 178],
      [163, 146],
      [152, 93],
      [202, 54],
      [233, -10],
      [200, -86],
      [144, -130],
      [87, -111],
      [30, -158],
      [-44, -137],
      [-65, -94],
      [-35, -60],
      [0, -45],
    ],
  },
  {
    id: 'canyon',
    name: 'Dust Valley',
    subtitle: 'Serpentinen, Minentunnel & roter Fels.',
    difficulty: 'FORTGESCHRITTEN',
    color: '#ffb575',
    sky: '#ecd3bc',
    ground: '#b96e46',
    road: '#735749',
    width: 14,
    points: [
      [0, 0],
      [0, 100],
      [40, 150],
      [95, 140],
      [108, 90],
      [70, 42],
      [92, 5],
      [160, 20],
      [198, 75],
      [242, 64],
      [270, 5],
      [235, -52],
      [150, -56],
      [140, -96],
      [171, -119],
      [190, -145],
      [173, -172],
      [150, -188],
      [65, -174],
      [36, -119],
      [-20, -132],
      [-60, -114],
      [-76, -78],
      [-55, -45],
      [-20, -36],
    ],
  },
  {
    id: 'midnight',
    name: 'Neon Harbor',
    subtitle: 'Containerhafen, Lichttunnel & Schikanen.',
    difficulty: 'EXPERTE',
    color: '#ad9bff',
    sky: '#11192f',
    ground: '#1b2944',
    road: '#344158',
    width: 13,
    points: [
      [0, 0],
      [0, 75],
      [25, 115],
      [75, 115],
      [100, 150],
      [155, 150],
      [176, 105],
      [154, 78],
      [153, 55],
      [185, 28],
      [242, 28],
      [265, -12],
      [239, -62],
      [175, -62],
      [149, -99],
      [179, -139],
      [157, -178],
      [90, -178],
      [63, -137],
      [17, -137],
      [-20, -139],
      [-57, -119],
      [-70, -82],
      [-48, -49],
      [-19, -35],
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
