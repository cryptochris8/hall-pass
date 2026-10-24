// Print a seed's SchoolPlan as an ASCII floor plan (docs/ARCHITECTURE.md tree).
//   npm run plan -- --seed 42 --tier 2 --mission phone
// Loads the TypeScript sources through Vite's SSR loader, so no build step is needed.
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const seed = Number(opt('seed', '1')) >>> 0;
const tier = Number(opt('tier', '1'));
const mission = opt('mission', 'phone');

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const gen = await server.ssrLoadModule('/src/school/gen/index.ts');
  const ascii = await server.ssrLoadModule('/src/school/ascii.ts');
  const plan = gen.generateSchool({ seed, tier, mission });
  console.log(ascii.planAscii(plan));
} finally {
  await server.close();
}
