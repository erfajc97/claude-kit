// node --test plugins/kit/scripts/__tests__/arch-check.test.mjs
//
// `/kit:audit quick` is the only audit a `lite` project runs: if it misses a broken layer
// boundary, nothing else will; if it blocks old code in a `report` scope or code in an
// `off` scope, people stop running it. Each case builds a real git repo in the temp dir
// with the REAL structure specs of the kit (never a copy of them).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractImports, globMatch } from '../arch-check.mjs';

const CHECK = join(dirname(fileURLToPath(import.meta.url)), '..', 'arch-check.mjs');
const repos = [];
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

const KIT = {
  scopes: {
    api: { kind: 'api', stack: 'nestjs', path: 'apps/api', mode: 'enforce' },
    web: { kind: 'web', stack: 'astro', path: 'apps/web', mode: 'enforce' },
    admin: { kind: 'web', stack: 'astro', path: 'apps/admin', mode: 'report' },
    mobile: { kind: 'mobile', stack: 'expo', path: 'apps/mobile', mode: 'enforce' },
  },
  addons: [],
};

function write(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** A repo whose base commit holds `files`; `kit` null = no kit.json. */
function makeRepo({ kit = KIT, files = {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'kit-arch-'));
  repos.push(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  if (kit) write(repo, '.claude/kit.json', JSON.stringify(kit));
  write(repo, 'README.md', 'base\n');
  for (const [path, text] of Object.entries(files)) write(repo, path, text);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

function check(repo, ...args) {
  const r = spawnSync(process.execPath, [CHECK, ...args], { cwd: repo, encoding: 'utf8' });
  const counted = section(r.stdout, '### Findings', '### Pre-existing');
  const previous = section(r.stdout, '### Pre-existing', '### Notes|VERDICT');
  return { ...r, counted, previous };
}

/** Table rows of one report section (header and separator removed, "none" row removed). */
function section(text, start, end) {
  const from = text.indexOf(start);
  if (from === -1) return [];
  const rest = text.slice(from + start.length);
  const stop = rest.search(new RegExp(`^(${end})`, 'm'));
  return rest
    .slice(0, stop === -1 ? undefined : stop)
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Sev') && !l.includes('| none |'));
}

const hasRule = (rows, rule) => rows.some((r) => r.split('|')[2].trim() === rule);

after(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

describe('globs and imports', () => {
  it('matches the glob forms the specs use', () => {
    assert.ok(globMatch('**/core/**', 'src/core/config/env.ts'));
    assert.ok(globMatch('**/core/**', 'core/a.py'));
    assert.ok(!globMatch('**/core/**', 'src/modules/core-ish/a.ts'));
    assert.ok(globMatch('src/app/features/*/components/**/*.tsx', 'src/app/features/a/components/X.tsx'));
    assert.ok(globMatch('src/app/features/*/components/**/*.tsx', 'src/app/features/a/components/deep/X.tsx'));
    assert.ok(!globMatch('src/app/features/*/components/**/*.tsx', 'src/app/features/a/hooks/useX.ts'));
    assert.ok(globMatch('**/*.{test,spec}.*', 'src/a/b.spec.ts'));
    assert.ok(globMatch('app/**/{components,hooks}/**', 'app/(tabs)/components/Card.tsx'));
    assert.ok(globMatch('**/.env', '.env'));
  });

  it('reads ES, CommonJS, dynamic and Python imports with their lines', () => {
    const ts = "import a from './a';\nimport {\n  b,\n} from '../b';\nexport * from './c';\nconst d = require('d');\nawait import('./e');\n";
    assert.deepEqual(extractImports('x.ts', ts).map((i) => [i.specifier, i.line]), [
      ['./a', 1], ['../b', 2], ['./c', 5], ['d', 6], ['./e', 7],
    ]);
    const py = 'from ..features.orders import service\nimport os, json\n';
    assert.deepEqual(extractImports('x.py', py).map((i) => i.specifier), ['..features.orders', 'os', 'json']);
  });
});

describe('verdict and exit code', () => {
  it('a clean change passes with exit 0', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/Orders.tsx', 'export default function Orders() { return null; }\n');
    write(repo, 'apps/web/src/app/features/orders/hooks/useOrders.ts', 'export default function useOrders() { return []; }\n');
    const r = check(repo);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^## arch-check — web/m);
    assert.match(r.stdout, /^VERDICT: PASS$/m);
    assert.match(r.stdout, /W1 A feature root holds ONE entity-named root.* ✔/);
  });

  it('nothing changed: PASS', () => {
    const r = check(makeRepo());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /VERDICT: PASS/);
  });

  it('outside a git repository: exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-arch-nogit-'));
    repos.push(dir);
    const r = spawnSync(process.execPath, [CHECK], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not inside a git repository/);
  });
});

describe('web feature layout (W1, W2, W4, W7)', () => {
  it('a second root component in a feature fails W1', () => {
    const repo = makeRepo({ files: { 'apps/web/src/app/features/orders/Orders.tsx': 'export default function Orders() {}\n' } });
    write(repo, 'apps/web/src/app/features/orders/OrdersTable.tsx', 'export default function OrdersTable() {}\n');
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.ok(hasRule(r.counted, 'W1'));
    assert.match(r.stdout, /2 root files matching/);
    assert.match(r.stdout, /VERDICT: FAIL \(0 BLOCKER, \d+ HIGH\)/);
  });

  it('a stray file or folder at the feature root fails W1', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/utils.ts', 'export const x = 1;\n');
    write(repo, 'apps/web/src/app/features/orders/queries/useX.ts', 'export const y = 1;\n');
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /`utils\.ts` is not allowed at the root/);
    assert.match(r.stdout, /folder `queries\/` is not a layer/);
  });

  it('an import from another feature fails W1, an import inside the feature does not', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/hooks/useOrders.ts', "import { a } from '../helpers/a';\nimport { b } from '../../billing/helpers/b';\nexport default () => [a, b];\n");
    const r = check(repo);
    assert.equal(r.status, 1);
    const cross = r.counted.filter((row) => row.includes('another unit'));
    assert.equal(cross.length, 1);
    assert.match(cross[0], /billing/);
  });

  it('an `@/` alias import from another feature fails W1 too', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/hooks/useOrders.ts', "import { b } from '@/app/features/billing/helpers/b';\nexport default () => b;\n");
    const cross = check(repo).counted.filter((row) => row.includes('another unit'));
    assert.equal(cross.length, 1);
  });

  it('an effect in a component fails W2; the one-line hydration gate is allowed', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/components/Row.tsx', 'export function Row() {\n  useEffect(() => { load(); }, []);\n}\n');
    write(repo, 'apps/web/src/app/features/orders/components/Gate.tsx', 'export function Gate() {\n  useEffect(() => {\n    setHydrated(true);\n  }, []);\n}\n');
    const r = check(repo);
    const w2 = r.counted.filter((row) => row.split('|')[2].trim() === 'W2');
    assert.equal(w2.length, 1);
    assert.match(w2[0], /Row\.tsx:2/);
  });

  it('useMutation outside mutations/ and a raw <button> fail W4 and W7', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/hooks/useSave.ts', 'export const useSave = () => useMutation({});\n');
    write(repo, 'apps/web/src/app/features/orders/Orders.tsx', 'export default () => <button onClick={x}>ok</button>;\n');
    const r = check(repo);
    assert.ok(hasRule(r.counted, 'W4'));
    assert.ok(hasRule(r.counted, 'W7'));
  });
});

describe('api layers (A1, A8, AN1, AN12) and Python imports', () => {
  it('core importing a module, a controller importing a repository, a stray module file', () => {
    const repo = makeRepo();
    write(repo, 'apps/api/src/core/auth/guard.ts', "import { UsersService } from '../../modules/users/users.service';\n");
    write(repo, 'apps/api/src/modules/orders/orders.controller.ts', "import { OrdersRepository } from './orders.repository';\n");
    write(repo, 'apps/api/src/modules/orders/orders.utils.ts', 'export const x = 1;\n');
    write(repo, 'apps/api/src/modules/orders/orders.service.ts', "import { S3Client } from '@aws-sdk/client-s3';\n");
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /core\/ never imports a domain module/);
    assert.match(r.stdout, /A controller\/router never imports a repository/);
    assert.ok(hasRule(r.counted, 'AN1'));
    assert.ok(hasRule(r.counted, 'AN12'));
  });

  it('reads the environment only in the config module (A8)', () => {
    const repo = makeRepo();
    write(repo, 'apps/api/src/modules/orders/orders.service.ts', 'const url = process.env.DATABASE_URL;\n');
    write(repo, 'apps/api/src/core/config/env.ts', 'export const env = process.env;\n');
    const r = check(repo);
    const a8 = r.counted.filter((row) => row.split('|')[2].trim() === 'A8');
    assert.equal(a8.length, 1);
    assert.match(a8[0], /orders\.service\.ts:1/);
  });

  it('Python: a core package importing a feature fails A1', () => {
    const repo = makeRepo({ kit: { scopes: { api: { stack: 'fastapi', path: 'api', mode: 'enforce' } } } });
    write(repo, 'api/app/core/db.py', 'from app.features.orders import repository\n');
    const r = check(repo);
    assert.ok(hasRule(r.counted, 'A1'));
    assert.match(r.stdout, /No structure spec for stack `fastapi`/);
  });

  it('Python: relative dots resolve, so a sibling feature repository is caught', () => {
    const repo = makeRepo({ kit: { scopes: { api: { stack: 'fastapi', path: 'api', mode: 'enforce' } } } });
    write(repo, 'api/app/features/orders/service.py', 'from ..billing.repository import find\nfrom .repository import save\n');
    const rows = check(repo).counted.filter((row) => row.includes('another unit'));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /\.\.billing\.repository/);
  });

  it('stack specs apply only to their stack: NestJS layout is not checked on FastAPI', () => {
    const repo = makeRepo({ kit: { scopes: { api: { stack: 'fastapi', path: 'api', mode: 'enforce' } } } });
    write(repo, 'api/src/modules/orders/orders.utils.ts', 'export default 1;\n');
    assert.ok(!hasRule(check(repo).counted, 'AN1'));
  });
});

describe('modes: new code counts, old code is pre-existing, off is skipped', () => {
  const legacy = 'export function Row() {\n  useEffect(() => { load(); }, []);\n  return null;\n}\n';

  it('enforce: an old violation in a modified file is pre-existing; PASS', () => {
    const repo = makeRepo({ files: { 'apps/web/src/app/features/orders/components/Row.tsx': legacy } });
    write(repo, 'apps/web/src/app/features/orders/components/Row.tsx', legacy.replace('return null;', 'return <span />;'));
    const r = check(repo);
    assert.equal(r.status, 0, r.stdout);
    assert.ok(hasRule(r.previous, 'W2'));
    assert.equal(r.counted.length, 0);
  });

  it('report: a NEW violation still counts (new code follows the rules)', () => {
    const kit = { scopes: { web: { stack: 'astro', path: 'apps/web', mode: 'report' } } };
    const repo = makeRepo({ kit });
    write(repo, 'apps/web/src/app/features/orders/components/Row.tsx', legacy);
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^## arch-check — web \(report\)/m);
  });

  it('--all census: enforce counts everything, report goes to pre-existing', () => {
    const files = { 'apps/web/src/app/features/orders/components/Row.tsx': legacy };
    const enforced = check(makeRepo({ files }), '--all');
    assert.equal(enforced.status, 1);
    const kit = { scopes: { web: { stack: 'astro', path: 'apps/web', mode: 'report' } } };
    const reported = check(makeRepo({ kit, files }), '--all');
    assert.equal(reported.status, 0, reported.stdout);
    assert.ok(hasRule(reported.previous, 'W2'));
  });

  it('two scopes of kind web each get the web specs, each with its own mode', () => {
    const files = { 'apps/admin/src/app/features/users/components/Row.tsx': legacy };
    const repo = makeRepo({ files });
    write(repo, 'apps/admin/src/app/features/users/components/Row.tsx', legacy.replace('return null;', 'return 1;'));
    write(repo, 'apps/admin/src/app/features/users/utils.ts', 'export default 1;\n');
    const r = check(repo);
    assert.match(r.stdout, /^## arch-check — admin \(report\)/m);
    assert.ok(hasRule(r.previous, 'W2'), 'old admin code is pre-existing');
    assert.ok(r.counted.some((row) => row.includes('utils.ts') && row.includes('| W1 |')), 'a new admin file counts');
  });

  it('off: the scope is skipped and the report says so', () => {
    const kit = { scopes: { web: { stack: 'astro', path: 'apps/web', mode: 'off' } } };
    const repo = makeRepo({ kit });
    write(repo, 'apps/web/src/app/features/orders/components/Row.tsx', legacy);
    const r = check(repo);
    assert.equal(r.status, 0);
    assert.equal(r.counted.length + r.previous.length, 0);
    assert.match(r.stdout, /Scope `web` is `off`: skipped\./);
  });

  it('explicit paths limit the check to those paths', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/components/Row.tsx', legacy);
    write(repo, 'apps/api/src/modules/orders/orders.utils.ts', 'export const x = 1;\n');
    const r = check(repo, '--', 'apps/api');
    assert.ok(hasRule(r.counted, 'AN1'));
    assert.ok(!hasRule(r.counted, 'W2'));
  });
});

describe('general checks (G4, G9, G17) also outside any scope', () => {
  it('a tracked .env and a provider key are BLOCKERs', () => {
    const repo = makeRepo();
    write(repo, '.env', 'DATABASE_URL=postgres://x\n');
    write(repo, 'tools/deploy.mjs', `const key = '${'sk_' + 'live_' + 'a1B2c3D4e5F6g7H8'}';\n`);
    git(repo, ['add', '-f', '.env']);
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL \(2 BLOCKER/);
  });

  it('a placeholder value is not a secret', () => {
    const repo = makeRepo();
    write(repo, 'tools/config.mjs', "const apiKey = '<your-api-key-here>';\n");
    assert.equal(check(repo).status, 0);
  });

  it('commented-out code and a bidi control fail; prose comments do not', () => {
    const repo = makeRepo();
    const bidi = String.fromCodePoint(0x202e);
    write(repo, 'packages/x/a.ts', `// return the first item\n// const old = compute(x);\nexport const label = 'a${bidi}b';\n`);
    const r = check(repo);
    const g4 = r.counted.filter((row) => row.includes('No commented-out code'));
    assert.equal(g4.length, 1);
    assert.match(g4[0], /a\.ts:2/);
    assert.ok(hasRule(r.counted, 'G17'));
  });

  it('an unused named export is a MEDIUM candidate and does not fail', () => {
    const repo = makeRepo();
    write(repo, 'packages/x/a.ts', 'export const usedOne = 1;\nexport const lonely = 2;\n');
    write(repo, 'packages/x/b.ts', "import { usedOne } from './a';\nexport default usedOne;\n");
    const r = check(repo);
    assert.equal(r.status, 0, r.stdout);
    const rows = r.counted.filter((row) => row.includes('no importer'));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /^\| MEDIUM \| G4 .*lonely/);
  });

  it('without kit.json only the general checks run, with a note', () => {
    const repo = makeRepo({ kit: null });
    write(repo, 'src/app/features/a/components/Row.tsx', 'useEffect(() => {}, []);\n');
    const r = check(repo);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /No `\.claude\/kit\.json`/);
  });
});

describe('mobile Expo routes (ME1, M1)', () => {
  it('logic in a route file and a component under the router root fail ME1', () => {
    const repo = makeRepo({ files: { 'apps/mobile/app/_layout.tsx': 'export default function Layout() {}\n' } });
    write(repo, 'apps/mobile/app/orders.tsx', 'export default function Screen() { const [a] = useState(0); }\n');
    write(repo, 'apps/mobile/app/components/Card.tsx', 'export default function Card() {}\n');
    write(repo, 'apps/mobile/src/features/orders/components/Row.tsx', 'export function Row() { Alert.alert("x"); }\n');
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.equal(r.counted.filter((row) => row.split('|')[2].trim() === 'ME1').length, 2);
    assert.ok(hasRule(r.counted, 'M1'));
  });

  it('the src/app router-root checks stay off when the router root is app/', () => {
    const repo = makeRepo({ files: { 'apps/mobile/app/_layout.tsx': 'export default function Layout() {}\n' } });
    write(repo, 'apps/mobile/src/app/helpers/format.ts', 'export default (x) => x;\n');
    assert.equal(check(repo).status, 0);
  });
});

describe('addon specs apply only when the addon is enabled', () => {
  const sdk = "import * as Sentry from '@sentry/react';\nexport default Sentry;\n";

  it('observability on: an SDK import outside adapters fails OB1', () => {
    const repo = makeRepo({ kit: { ...KIT, addons: ['observability'] } });
    write(repo, 'apps/web/src/app/features/orders/helpers/report.ts', sdk);
    write(repo, 'apps/web/src/app/observability/adapters/sentry.ts', sdk);
    const r = check(repo);
    const ob = r.counted.filter((row) => row.split('|')[2].trim() === 'OB1');
    assert.equal(ob.length, 1);
    assert.match(ob[0], /helpers\/report\.ts/);
  });

  it('observability off: no OB1 check at all', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/app/features/orders/helpers/report.ts', sdk);
    assert.doesNotMatch(check(repo).stdout, /OB1/);
  });
});
