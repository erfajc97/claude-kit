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
import { extractImports, globMatch, resolveImport } from '../arch-check.mjs';

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
    assert.doesNotMatch(r.stdout, /No structure spec for stack `fastapi`/);
  });

  it('a stack without a spec runs only the common checks, and the report says so', () => {
    const repo = makeRepo({ kit: { scopes: { api: { stack: 'django', path: 'api', mode: 'enforce' } } } });
    write(repo, 'api/app/core/db.py', 'from app.features.orders import repository\n');
    const r = check(repo);
    assert.ok(hasRule(r.counted, 'A1'));
    assert.match(r.stdout, /No structure spec for stack `django`/);
  });

  it('Python: relative dots resolve, so a sibling feature repository is caught', () => {
    const repo = makeRepo({ kit: { scopes: { api: { stack: 'fastapi', path: 'api', mode: 'enforce' } } } });
    write(repo, 'api/app/features/orders/service.py', 'from ..billing.repository import find\nfrom .repository import save\n');
    const rows = check(repo).counted.filter((row) => row.includes('another unit'));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /\.\.billing\.repository/);
  });

  it('a project spec can allow a project file convention at a module root (extend), only for its rule and unit', () => {
    const extend = {
      block: 'project-doors',
      appliesTo: { kind: 'api', stacks: ['nestjs'] },
      extend: [{ rule: 'AN1', unit: 'src/modules/*', allowFiles: ['^[a-z0-9-]+-db\\.ts$'] }],
    };
    const repo = makeRepo();
    write(repo, '.claude/kit-structure/project-doors.structure.json', JSON.stringify(extend));
    write(repo, 'apps/api/src/modules/orders/orders-db.ts', 'export const door = 1;\n');
    assert.ok(!hasRule(check(repo).counted, 'AN1'));
    write(repo, 'apps/api/src/modules/orders/orders.utils.ts', 'export const x = 1;\n');
    assert.ok(hasRule(check(repo).counted, 'AN1'));
  });

  it('stack specs apply only to their stack: NestJS layout is not checked on FastAPI', () => {
    const repo = makeRepo({ kit: { scopes: { api: { stack: 'fastapi', path: 'api', mode: 'enforce' } } } });
    write(repo, 'api/src/modules/orders/orders.utils.ts', 'export default 1;\n');
    assert.ok(!hasRule(check(repo).counted, 'AN1'));
  });
});

describe('FastAPI scope (AF1, AF2, AF5, AF8) and src-layout Python imports', () => {
  // The uv default layout: the package lives in src/<package>/ and imports are absolute.
  const FASTAPI = { scopes: { api: { kind: 'api', stack: 'fastapi', path: 'apps/api', mode: 'enforce' } } };
  const rows = (r, rule) => r.counted.filter((row) => row.split('|')[2].trim() === rule);

  it('absolute imports resolve inside src/<package>/; a package import stays a package', () => {
    assert.equal(resolveImport('src/shop/core/db.py', 'shop.features.orders.models', true), 'src/shop/features/orders/models');
    assert.equal(resolveImport('app/core/db.py', 'app.features.orders', true), 'app/features/orders');
    assert.equal(resolveImport('src/shop/core/db.py', 'sqlalchemy.orm', true), 'sqlalchemy/orm');
    assert.equal(resolveImport('src/shop/features/a/domain/rules.py', '..service', true), 'src/shop/features/a/service');
  });

  it('a clean feature passes, with its mirrored tests', () => {
    const repo = makeRepo({ kit: FASTAPI });
    write(repo, 'apps/api/src/shop/features/orders/__init__.py', '');
    write(repo, 'apps/api/src/shop/features/orders/router.py', 'from fastapi import APIRouter\nfrom shop.features.orders import service\n');
    write(repo, 'apps/api/src/shop/features/orders/repository.py', 'from sqlalchemy import select\nfrom shop.features.orders.models import Order\n');
    write(repo, 'apps/api/src/shop/features/orders/domain/__init__.py', '');
    write(repo, 'apps/api/src/shop/features/orders/domain/pricing.py', 'from decimal import Decimal\n');
    write(repo, 'apps/api/tests/unit/features/orders/test_pricing.py', 'from shop.features.orders.domain.pricing import Decimal\n');
    write(repo, 'apps/api/tests/integration/core/db/test_session.py', 'from shop.features.orders.models import Order\n');
    const r = check(repo);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /AF1 A feature root holds only layer modules and the named subpackages ✔/);
  });

  it('a stray module or folder at a feature root fails AF1; the mirrored tests folder does not', () => {
    const repo = makeRepo({ kit: FASTAPI });
    write(repo, 'apps/api/src/shop/features/orders/ranking.py', 'RANK = 1\n');
    write(repo, 'apps/api/src/shop/features/orders/utils/__init__.py', '');
    write(repo, 'apps/api/tests/unit/features/orders/test_ranking.py', 'def test_rank() -> None: ...\n');
    const af1 = rows(check(repo), 'AF1');
    assert.equal(af1.length, 2);
    assert.match(af1.join('\n'), /`ranking\.py` is not allowed/);
    assert.match(af1.join('\n'), /folder `utils\/` is not a layer/);
  });

  it('a repository importing FastAPI and an impure or upward domain import fail AF1', () => {
    const repo = makeRepo({ kit: FASTAPI });
    write(repo, 'apps/api/src/shop/features/orders/repository.py', 'from fastapi import HTTPException\n');
    write(repo, 'apps/api/src/shop/features/orders/domain/rules.py', 'from sqlalchemy import select\nfrom ..service import place\nfrom shop.features.orders.schemas import OrderCreate\n');
    const af1 = rows(check(repo), 'AF1');
    assert.equal(af1.length, 4, af1.join('\n'));
    assert.ok(af1.some((row) => row.includes('repository.py:1')));
    for (const line of [1, 2, 3]) assert.ok(af1.some((row) => row.includes(`rules.py:${line}`)), `rules.py:${line}`);
  });

  it('absolute src-layout imports are caught across features and from core (A1)', () => {
    const repo = makeRepo({ kit: FASTAPI });
    write(repo, 'apps/api/src/shop/features/billing/service.py', 'from shop.features.orders.repository import find_order\n');
    write(repo, 'apps/api/src/shop/core/db/base.py', 'from shop.features.orders.models import Order\n');
    const a1 = rows(check(repo), 'A1');
    assert.equal(a1.length, 2, a1.join('\n'));
    assert.ok(a1.some((row) => row.includes('billing/service.py:1') && row.includes('another unit')));
    assert.ok(a1.some((row) => row.includes('core/db/base.py:1')));
  });

  it('raw SQL fails AF2 in the app, not in migrations; raw HTTPException fails AF5 outside core/errors', () => {
    const repo = makeRepo({ kit: FASTAPI });
    write(repo, 'apps/api/src/shop/features/orders/repository.py', 'from sqlalchemy import select, text\n');
    write(repo, 'apps/api/src/shop/features/orders/service.py', 'async def f(s):\n    await s.execute(f"select {1}")\n    raise HTTPException(status_code=404)\n');
    write(repo, 'apps/api/migrations/versions/0001_initial.py', 'op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")\n');
    write(repo, 'apps/api/src/shop/core/errors/handlers.py', 'raise HTTPException(status_code=500)\n');
    const r = check(repo);
    const af2 = rows(r, 'AF2');
    assert.equal(af2.length, 2, af2.join('\n'));
    assert.ok(af2.every((row) => !row.includes('migrations/')));
    const af5 = rows(r, 'AF5');
    assert.equal(af5.length, 1);
    assert.match(af5[0], /service\.py:3/);
  });

  it('a blocking HTTP client fails AF8 (HIGH); time.sleep is a MEDIUM candidate', () => {
    const repo = makeRepo({ kit: FASTAPI });
    write(repo, 'apps/api/src/shop/features/orders/providers/client.py', 'import requests\nimport time\ntime.sleep(1)\n');
    const af8 = rows(check(repo), 'AF8');
    assert.equal(af8.length, 2);
    assert.ok(af8.some((row) => row.startsWith('| HIGH') && row.includes('client.py:1')));
    assert.ok(af8.some((row) => row.startsWith('| MEDIUM') && row.includes('client.py:3')));
  });

  it('the FastAPI spec does not apply to a NestJS scope', () => {
    const repo = makeRepo();
    write(repo, 'apps/api/src/modules/orders/orders.service.ts', "import { find } from './orders.repository';\nexport const raise = 'raise HTTPException(';\n");
    assert.ok(!hasRule(check(repo).counted, 'AF5'));
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
