import type { Team } from '@quickkicks/shared';

/** Home kit colours for drawing jerseys and team pills. Display only; nothing scores off this. */
export interface Kit {
  /** Shirt body. */
  body: string;
  /** Sleeves and collar, chosen to contrast with the body. */
  trim: string;
  /** Shirt number and pill text, readable on the body colour. */
  ink: string;
}

const KITS: Record<string, Kit> = {
  arsenal: { body: '#db0007', trim: '#ffffff', ink: '#ffffff' },
  'aston villa': { body: '#670e36', trim: '#95bfe5', ink: '#ffffff' },
  bournemouth: { body: '#da291c', trim: '#111111', ink: '#ffffff' },
  brentford: { body: '#e30613', trim: '#ffffff', ink: '#ffffff' },
  brighton: { body: '#0057b8', trim: '#ffffff', ink: '#ffffff' },
  burnley: { body: '#6c1d45', trim: '#99d6ea', ink: '#ffffff' },
  chelsea: { body: '#034694', trim: '#6ea8ff', ink: '#ffffff' },
  'crystal palace': { body: '#1b458f', trim: '#c4122e', ink: '#ffffff' },
  everton: { body: '#003399', trim: '#ffffff', ink: '#ffffff' },
  fulham: { body: '#f5f5f5', trim: '#111111', ink: '#111111' },
  leeds: { body: '#f5f5f5', trim: '#1d428a', ink: '#1d428a' },
  liverpool: { body: '#c8102e', trim: '#ff9aa8', ink: '#ffffff' },
  'manchester city': { body: '#6cabdd', trim: '#1c2c5b', ink: '#1c2c5b' },
  'manchester united': { body: '#da291c', trim: '#111111', ink: '#ffffff' },
  newcastle: { body: '#241f20', trim: '#ffffff', ink: '#ffffff' },
  'nottingham forest': { body: '#dd0000', trim: '#ffffff', ink: '#ffffff' },
  sunderland: { body: '#eb172b', trim: '#ffffff', ink: '#ffffff' },
  tottenham: { body: '#f5f5f5', trim: '#132257', ink: '#132257' },
  'west ham': { body: '#7a263a', trim: '#1bb1e7', ink: '#ffffff' },
  wolves: { body: '#fdb913', trim: '#231f20', ink: '#231f20' },
};

const ALIASES: Record<string, string> = {
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  spurs: 'tottenham',
  'tottenham hotspur': 'tottenham',
  'newcastle united': 'newcastle',
  'west ham united': 'west ham',
  'wolverhampton wanderers': 'wolves',
  'brighton & hove albion': 'brighton',
  'brighton and hove albion': 'brighton',
  'leeds united': 'leeds',
  'afc bournemouth': 'bournemouth',
  "nott'm forest": 'nottingham forest',
};

function normalise(name: string): string {
  const key = name.toLowerCase().replace(/\s+fc$/, '').trim();
  return ALIASES[key] ?? key;
}

/** Stable fallback for a team we have no kit for, so a new club never renders colourless. */
function generatedKit(name: string): Kit {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { body: `hsl(${hue} 65% 42%)`, trim: `hsl(${hue} 70% 75%)`, ink: '#ffffff' };
}

export function kitFor(team: Pick<Team, 'name'> | undefined): Kit {
  if (!team) return { body: '#1f3d63', trim: '#4da6ff', ink: '#ffffff' };
  return KITS[normalise(team.name)] ?? generatedKit(team.name);
}
