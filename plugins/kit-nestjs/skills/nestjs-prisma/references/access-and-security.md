# Bootstrap, configuration, access and logs (A8, A12, A14, A15, AN10)

## 1. One bootstrap for production and tests

`main.ts` and the integration harness call the same function, so tests exercise the exact
production pipeline.

```ts
// core/http/configure-app.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

const BODY_LIMIT = '1mb'; // uploads go straight to storage via presigned POST (A13)

export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS')); // fixed hop count: X-Forwarded-For cannot be spoofed past it
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.enableCors({
    origin: config.get('CORS_ORIGINS'), // allowlist from env, never '*' with credentials
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
}
```

```ts
// main.ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
configureApp(app);
await app.listen(app.get(AppConfigService).get('PORT'));
```

Every custom header a front-end sends is listed in `allowedHeaders`, with a test.

## 2. Environment schema, fail-closed

```ts
// core/config/env.schema.ts
import { z } from 'zod';

const NON_PRODUCTION = ['development', 'test'];

export const envSchema = z
  .object({
    NODE_ENV: z.string(), // no default: anything that is not development/test gets production checks
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    CORS_ORIGINS: z
      .string()
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
      .pipe(z.array(z.url()).min(1)),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  })
  .superRefine((env, ctx) => {
    if (NON_PRODUCTION.includes(env.NODE_ENV)) return;
    if (env.JWT_ACCESS_SECRET.startsWith('dev-only-')) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'development secret in production' });
    }
  });

export type Env = z.output<typeof envSchema>;

/** Throws with the KEYS that failed, never their values. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment: ${keys.join(', ')}`);
  }
  return result.data;
}
```

```ts
// core/config/config.module.ts
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: parseEnv })],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}

// core/config/app-config.service.ts
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}
  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }
}
```

Every new variable: schema + `.env.example` (placeholder) + env docs, in one change. Grep
`process\.env\.` outside `core/config` must return nothing (seed and scripts aside).

## 3. Access markers, default-deny

```ts
// core/auth/decorators/route-access.ts
export const IS_PUBLIC = 'access:public';
export const REQUIRED_PERMISSION = 'access:permission';
export const ROUTE_ACCESS_MARKERS = [IS_PUBLIC, REQUIRED_PERMISSION] as const;

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);
```

```ts
// core/auth/guards/access.guard.ts
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AppRequest>();
    request.user = await this.tokens.authenticate(request); // throws AppHttpException('AUTH_UNAUTHENTICATED')

    const permission = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION, targets);
    if (!permission) throw new AppHttpException('AUTH_FORBIDDEN'); // no marker → denied
    if (!can(request.user.role, permission)) throw new AppHttpException('AUTH_FORBIDDEN');
    return true;
  }
}
```

Register globally, in order: `{ provide: APP_GUARD, useClass: ThrottlerGuard }`, then
`{ provide: APP_GUARD, useClass: AccessGuard }`.

Route-marker test (fails the build before a user meets a 403):

```ts
// core/auth/route-markers.ts
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, Reflector } from '@nestjs/core';

export function routeMarkerCounts(controllers: readonly Type<unknown>[], reflector = new Reflector()) {
  const scanner = new MetadataScanner();
  return controllers.flatMap((controller) => {
    const proto = controller.prototype as Record<string, unknown>;
    return scanner.getAllMethodNames(proto)
      .filter((name) => typeof proto[name] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined)
      .map((name) => ({
        route: `${controller.name}.${name}`,
        markers: ROUTE_ACCESS_MARKERS.filter(
          (key) => reflector.getAllAndOverride(key, [proto[name] as () => unknown, controller]) !== undefined,
        ).length,
      }));
  });
}
```

```ts
// test/integration/route-markers.int-spec.ts — every controller the app really mounts
it('every route declares exactly one access marker', async () => {
  const app = await createTestApp();
  const controllers = [...app.get(ModulesContainer).values()].flatMap((m) => [...m.controllers.values()].map((w) => w.metatype as Type<unknown>));
  const counts = routeMarkerCounts(controllers);
  expect(counts.filter((c) => c.markers !== 1)).toEqual([]);
  expect(counts.length).toBeGreaterThan(0); // sanity: the scan found routes
});
```

Ownership lives in the query (`where: { id, ownerId: user.id }`); a miss is
`AppHttpException('…_NOT_FOUND')` — 404 for "missing" and "not yours" alike.

## 4. Throttling

```ts
ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }] }),
```

```ts
@Public()
@Throttle({ default: { ttl: 60_000, limit: 5 } }) // auth, OTP, password reset, public forms, paid third parties
@Post('login')
login(@Body() dto: LoginDto) { … }
```

Behind a proxy, the throttler keys on the real client IP (`trust proxy` with a fixed hop
count, or the CDN's client-IP header when the project trusts that CDN).

## 5. Request id and structured logs

```ts
// core/http/request-id.ts
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestIdMiddleware(req: AppRequest, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
```

```ts
// core/observability/logger.options.ts (nestjs-pino)
LoggerModule.forRoot({
  pinoHttp: {
    genReqId: (req) => (req as AppRequest).id,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.token', '*.refreshToken'],
      censor: '[redacted]',
    },
    serializers: { req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }) },
  },
}),
```

Jobs receive the request id in their payload and log it. `console.log` does not exist in
`src/`.

## 6. Per-endpoint security checklist

| Question | Where it shows |
|---|---|
| Who? | exactly one access marker; ownership in the `where`; 404 for foreign ids |
| How often? | `@Throttle` on auth/OTP/public/cost routes; idempotency key on money moves |
| How much? | DTO caps, array caps, pagination ceiling, upload limits |
| What comes in? | strict DTO class; no `{ ...dto }` into Prisma; no `*Unsafe` raw SQL; `JSON.parse` in try/catch + validated; no regex from user text; user URLs only from an allowlist |
| What goes out? | `select` allowlist; no stack traces; no PII in logs; private responses `no-store` |
| Fails closed? | missing secret stops boot; webhooks verify signatures; GET never writes |
