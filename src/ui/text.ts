// Player-facing words for missions, difficulties and schools (docs/GDD.md §7, §9). Tone rules apply (GDD §0).
import type { Difficulty, MissionId, TierId } from '../school/types';

export const MISSION_NAME: Readonly<Record<MissionId, string>> = {
  phone: 'PHONE JAIL',
  vending: 'VENDING RUN',
  pizza: 'PIZZA DAY',
  locker: 'LOCKER DROP',
  gym: 'GYM BAG',
  principal: "PRINCIPAL'S OFFICE",
};

/** The goal, as the HUD and the mission card state it. */
export const GOAL_LINE: Readonly<Record<MissionId, string>> = {
  phone: 'Get your confiscated phone out of the front-office drawer',
  vending: 'Buy chips from the machine by the gym',
  pizza: 'Be first in line at the cafeteria when the lunch bell rings',
  locker: "Slip a birthday card into your friend's locker",
  gym: 'Get your gym clothes from your locker by the gym',
  principal: "Get back the three phones: principal's office, front office, a classroom",
};

/** The twist, as a tip on the mission card. */
export const TWIST: Readonly<Record<MissionId, string>> = {
  phone: 'The secretary sits right next to the drawer. Wait for her coffee walk.',
  vending: 'The machine is loud and takes 6 seconds. Pick your moment, and stand still.',
  pizza: "Get there too early and the lunch staff shoo you off. Hide nearby and go on the lunch bell.",
  locker: "Your friend's locker is across school, in a busy hall. Bonus for never being seen.",
  gym: 'Your locker is in the gym hallway, right under a camera. Time its sweep.',
  principal: 'Three phones, three rooms. Hargrove hears everything, and he gets faster every time he spots you.',
};

export const DIFFICULTY_NAME: Readonly<Record<Difficulty, string>> = { freshman: 'FRESHMAN', junior: 'JUNIOR', senior: 'SENIOR' };

export const DIFFICULTY_NOTE: Readonly<Record<Difficulty, string>> = {
  freshman: 'Two hall passes · slower staff · score ×0.8',
  junior: 'One hall pass · score ×1.0',
  senior: 'No hall pass · sharp-eyed staff · score ×1.3',
};

export const TIER_NAME: Readonly<Record<TierId, string>> = {
  1: 'Middle school',
  2: 'High school',
  3: 'High school (Spirit Week)',
  4: 'Strict academy',
  5: 'Summer school',
};

export const TIER_NOTE: Readonly<Record<TierId, string>> = {
  1: 'One floor, a few staff, no cameras',
  2: 'Adds cameras and Preston the snitch',
  3: 'Bigger halls, more staff',
  4: 'Cameras everywhere, two investigators, noisy polished floors',
  5: 'Half the lights off, a custodian everywhere',
};

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
