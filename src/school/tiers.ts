// School tiers (docs/GDD.md §9): grid size, corridor shape, which rooms appear and how many staff of each
// archetype. Pure data, owner: school.
import type { Archetype, MissionId, RoomKind, TierId } from './types';

export type SpineShape = 'straight' | 'L' | 'T';

export interface TierDef {
  id: TierId;
  /** Display name pattern: the generator invents the place name; this is the school type. */
  kind: 'Middle' | 'High' | 'Academy' | 'Summer School';
  cols: number;
  rows: number;
  spines: readonly SpineShape[];
  /** Target corridor cells after branching (min, max). */
  corridorCells: readonly [number, number];
  /** Optional rooms: 2–4 of these per school (cafeteria/gym/office are added by missions when needed). */
  extras: readonly RoomKind[];
  extraCount: readonly [number, number];
  staff: Readonly<Partial<Record<Archetype, number>>>;
  /** Fraction of corridor length that is dim (Summer School's lights are half off). */
  dim: number;
  /** Polished (noisy) floors everywhere. */
  polished: boolean;
}

export const TIERS: Readonly<Record<TierId, TierDef>> = {
  1: {
    id: 1,
    kind: 'Middle',
    cols: 10,
    rows: 7,
    spines: ['straight', 'L'],
    corridorCells: [14, 18],
    extras: ['library', 'art', 'band'],
    extraCount: [1, 2],
    staff: { patroller: 2, sentry: 2 },
    dim: 0,
    polished: false,
  },
  2: {
    id: 2,
    kind: 'High',
    cols: 12,
    rows: 8,
    spines: ['straight', 'L', 'T'],
    corridorCells: [20, 26],
    extras: ['library', 'art', 'band', 'lab', 'courtyard'],
    extraCount: [2, 3],
    staff: { patroller: 2, sentry: 2, sweeper: 2, investigator: 1, snitch: 1 },
    dim: 0.1,
    polished: false,
  },
  3: {
    id: 3,
    kind: 'High',
    cols: 12,
    rows: 8,
    spines: ['L', 'T'],
    corridorCells: [22, 28],
    extras: ['library', 'art', 'band', 'lab', 'courtyard'],
    extraCount: [2, 4],
    staff: { patroller: 2, sentry: 2, sweeper: 2, investigator: 1, wanderer: 1, snitch: 1 },
    dim: 0.1,
    polished: false,
  },
  4: {
    id: 4,
    kind: 'Academy',
    cols: 13,
    rows: 9,
    spines: ['T', 'L'],
    corridorCells: [26, 32],
    extras: ['library', 'lab', 'band', 'courtyard'],
    extraCount: [3, 4],
    staff: { patroller: 3, sentry: 2, sweeper: 3, investigator: 2, wanderer: 1 },
    dim: 0.05,
    polished: true,
  },
  5: {
    id: 5,
    kind: 'Summer School',
    cols: 12,
    rows: 8,
    spines: ['straight', 'L', 'T'],
    corridorCells: [20, 26],
    extras: ['library', 'art', 'lab'],
    extraCount: [1, 3],
    staff: { patroller: 1, sentry: 1, wanderer: 2, listener: 1 },
    dim: 0.5,
    polished: false,
  },
};

/** The room the mission's goal sits in (null: the goal is in a corridor). */
export const MISSION_ROOM: Readonly<Record<MissionId, RoomKind | null>> = {
  phone: 'office',
  vending: 'gym', // the machine stands in the corridor by the gym door
  pizza: 'cafeteria',
  locker: null,
  gym: 'gym',
  principal: 'principal',
};

/** Bell timer per mission (seconds). */
export const BELL_SECONDS: Readonly<Record<MissionId, number>> = {
  phone: 180,
  vending: 180,
  pizza: 150,
  locker: 180,
  gym: 180,
  principal: 240,
};

/** Room footprint in cells (w × h before rotation). */
export const ROOM_SIZE: Readonly<Record<RoomKind, readonly [number, number]>> = {
  classroom: [1, 1],
  office: [2, 1],
  principal: [1, 1],
  library: [2, 1],
  cafeteria: [2, 2],
  gym: [2, 2],
  bathroom: [1, 1],
  art: [1, 1],
  band: [1, 1],
  lab: [1, 1],
  courtyard: [2, 2],
};
