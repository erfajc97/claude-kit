// In-memory mutant for the G3 mutation check: the file on disk is NEVER written.
// A Vite transform plugin swaps one snippet while Vitest loads the module, so a dev server
// or another agent never sees the mutant.
//
// Installed by `mutant.mjs` (or by hand) at <scope>/node_modules/.kit-mutant/ — inside
// node_modules, ignored by git and by dev servers — so the import below resolves to the
// scope's own Vitest config. For integration specs, import the integration config instead
// (`mutant.mjs --base vitest.integration.config.ts`).
import { mergeConfig } from 'vitest/config';
import baseExport from '../../vitest.config.ts';

const base =
  typeof baseExport === 'function'
    ? await baseExport({ command: 'serve', mode: 'test' })
    : baseExport;
const file = (process.env.MUTANT_FILE ?? '').replaceAll('\\', '/');
const from = process.env.MUTANT_FROM ?? '';
const to = process.env.MUTANT_TO ?? '';

const mutant = {
  name: 'kit-mutant',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    // Vite module ids use forward slashes on every OS; drop the query part.
    if (!file || !id.split('?')[0].replaceAll('\\', '/').endsWith(file)) return null;
    const parts = code.split(from);
    if (parts.length !== 2) {
      throw new Error(`[kit-mutant] snippet must occur exactly once in ${file}, found ${parts.length - 1}`);
    }
    console.error(`[kit-mutant] applied to ${file}`);
    return parts.join(to);
  },
};

const config = mergeConfig(base, { test: { coverage: { enabled: false } } });
config.plugins = [mutant, ...(config.plugins ?? [])];
export default config;
