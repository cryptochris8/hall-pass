// Invented school names (docs/GDD.md §9): place + school type + mascot. Never a real school. Pure.
import type { Rng } from '../../core/rng';
import { TIERS } from '../tiers';
import type { TierId } from '../types';

const PLACES = [
  'Maple', 'Westbrook', 'Lakeview', 'Pine Hollow', 'Cedar Ridge', 'Riverside', 'Fox Run', 'Briar Glen', 'Summit',
  'Oak Hill', 'Willow Creek', 'Harbor Point', 'Stonebridge', 'Elmwood', 'Copper Falls', 'Juniper Flats',
] as const;
const ACADEMIES = ["St. Rigid's", 'Ashgrove', 'Kingsmere', 'Blackwood'] as const;
const MASCOTS = ['Owls', 'Wildcats', 'Comets', 'Otters', 'Badgers', 'Falcons', 'Hornets', 'Lynx', 'Moose', 'Herons'] as const;

export function schoolName(tier: TierId, rng: Rng): { name: string; motto: string } {
  const kind = TIERS[tier].kind;
  const mascot = rng.pick(MASCOTS);
  if (kind === 'Academy') return { name: `${rng.pick(ACADEMIES)} Academy`, motto: `Home of the ${mascot}` };
  const place = rng.pick(PLACES);
  if (kind === 'Summer School') return { name: `${place} High Summer School`, motto: `Home of the ${mascot} (Summer Edition)` };
  return { name: `${place} ${kind}`, motto: `Home of the ${mascot}` };
}
