# Errors and DTOs (A3, A7, AN2, AN3, G12)

## 1. The error catalog

One catalog, shared by the API and every client (a workspace package such as
`packages/errors`, or `src/core/errors/codes.ts` when there is no front-end in the repo).
Keys are what the code throws; `code` is the stable slug clients match and i18n copy is
keyed by.

```ts
// errors/codes.ts
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, code: 'common.validation_failed' },
  AUTH_UNAUTHENTICATED: { status: 401, code: 'auth.unauthenticated' },
  AUTH_FORBIDDEN: { status: 403, code: 'auth.forbidden' },
  NOT_FOUND: { status: 404, code: 'common.not_found' },
  CONFLICT: { status: 409, code: 'common.conflict' },
  PAYLOAD_TOO_LARGE: { status: 413, code: 'common.payload_too_large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, code: 'common.unsupported_media_type' },
  RATE_LIMITED: { status: 429, code: 'common.rate_limited' },
  INTERNAL_ERROR: { status: 500, code: 'common.internal_error' },
  SERVICE_UNAVAILABLE: { status: 503, code: 'common.service_unavailable' },
  // Domain codes: one per business outcome a client must handle.
  ORDER_NOT_FOUND: { status: 404, code: 'orders.not_found' },
  ORDER_ALREADY_PAID: { status: 409, code: 'orders.already_paid' },
} as const satisfies Record<string, { status: number; code: string }>;

export type ErrorCodeKey = keyof typeof ERROR_CODES;
export type ErrorCodeSlug = (typeof ERROR_CODES)[ErrorCodeKey]['code'];

export interface ErrorPayload {
  statusCode: number;
  code: ErrorCodeSlug;
  message: string; // localized copy for humans; clients never branch on it
  details?: Record<string, unknown>; // ids, field names, limits — never free text
  requestId: string;
}
```

Order of work for a new code: catalog entry → copy `errors.<slug>` in EVERY locale →
test asserting the code → implementation. A parity test keeps copy complete:

```ts
it('every error code has copy in every locale', () => {
  for (const { code } of Object.values(ERROR_CODES)) {
    for (const locale of LOCALES) expect(messages[locale].errors?.[code], `${locale}:${code}`).toBeTypeOf('string');
  }
});
```

## 2. `AppHttpException`

```ts
// core/errors/app-http.exception.ts
import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCodeKey, type ErrorCodeSlug } from '<catalog>';

/** The only way the API reports a business error: throw new AppHttpException('KEY', details?). */
export class AppHttpException extends HttpException {
  readonly key: ErrorCodeKey;
  readonly code: ErrorCodeSlug;
  readonly details?: Record<string, unknown>;

  constructor(key: ErrorCodeKey, details?: Record<string, unknown>) {
    const { status, code } = ERROR_CODES[key];
    super({ statusCode: status, code, message: code, details }, status);
    this.name = 'AppHttpException';
    this.key = key;
    this.code = code;
    this.details = details;
  }
}
```

Lint bans the framework exceptions in app code (spec files may build them to prove the
filter maps them):

```js
// eslint.config.js (API)
'no-restricted-syntax': ['error',
  { selector: "NewExpression[callee.name=/^(BadRequest|NotFound|Forbidden|Unauthorized|Conflict)Exception$/]",
    message: 'Throw AppHttpException(KEY) from the error catalog (AN3).' },
  { selector: "NewExpression[callee.name='PrismaClient']",
    message: 'Inject PrismaService; never instantiate PrismaClient in app code (AN4).' },
  { selector: 'MemberExpression[property.name=/^\\$(queryRaw|executeRaw)Unsafe$/]',
    message: 'Use the tagged $queryRaw/$executeRaw templates (AN6).' },
],
```

## 3. One global filter

A pure mapping function (unit-testable and mutation-testable) plus a thin filter.

```ts
// core/errors/app-exception.filter.ts
const KEY_BY_STATUS: Readonly<Record<number, ErrorCodeKey>> = {
  400: 'VALIDATION_FAILED', 401: 'AUTH_UNAUTHENTICATED', 403: 'AUTH_FORBIDDEN',
  404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED', 503: 'SERVICE_UNAVAILABLE',
};

/** Prisma known errors that are outcomes, not crashes. P2034 (deadlock) stays a logged 500. */
const KEY_BY_PRISMA_CODE: Readonly<Record<string, ErrorCodeKey>> = {
  P2000: 'VALIDATION_FAILED', // value longer than its column: DTO cap and column drifted
  P2002: 'CONFLICT', // unique violation the service check could not see (a race)
  P2025: 'NOT_FOUND', // record to update/delete does not exist
  P2028: 'SERVICE_UNAVAILABLE', // transaction maxWait/timeout: overload, retryable
};

/** body-parser throws plain errors tagged with `type`. */
const KEY_BY_BODY_PARSER_TYPE: Readonly<Record<string, ErrorCodeKey>> = {
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'entity.parse.failed': 'VALIDATION_FAILED',
};

export function mapException(exception: unknown): { key: ErrorCodeKey; details?: Record<string, unknown> } {
  if (exception instanceof AppHttpException) return { key: exception.key, details: exception.details };
  if (exception instanceof ZodValidationException) {
    return { key: 'VALIDATION_FAILED', details: { fields: issuePaths(exception) } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return { key: KEY_BY_STATUS[status] ?? (status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR') };
  }
  // Detect Prisma errors by shape (name + code): works inside interactive transactions and in
  // tests without the generated runtime.
  const tagged = (typeof exception === 'object' && exception !== null ? exception : {}) as {
    name?: unknown; code?: unknown; type?: unknown;
  };
  if (tagged.name === 'PrismaClientKnownRequestError' && typeof tagged.code === 'string') {
    const key = KEY_BY_PRISMA_CODE[tagged.code];
    if (key) return { key };
  }
  if (typeof tagged.type === 'string') {
    const key = KEY_BY_BODY_PARSER_TYPE[tagged.type];
    if (key) return { key };
  }
  return { key: 'INTERNAL_ERROR' };
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  constructor(private readonly reporter: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();
    const { key, details } = mapException(exception);
    const { status, code } = ERROR_CODES[key];

    if (status >= 500) {
      // Log once, with the request id and the path WITHOUT its query string (tokens, e-mails).
      this.logger.error({ err: safeErrorForLog(exception), requestId: request.id, path: withoutQuery(request.url) }, 'unhandled_exception');
      this.reporter.capture(exception);
    }

    const body: ErrorPayload = {
      statusCode: status,
      code,
      message: translate(request.locale, `errors.${code}`),
      ...(details === undefined ? {} : { details }),
      requestId: request.id,
    };
    response.status(status).json(body);
  }
}
```

Register it once: `{ provide: APP_FILTER, useClass: AppExceptionFilter }` in `AppModule`.
`issuePaths` returns field paths and issue codes only — never the rejected values.

## 4. DTOs with nestjs-zod (default)

Limits live in ONE module shared by the API DTOs, the front-end forms and (by name) the
Prisma column sizes:

```ts
// shared/limits.ts
export const LIMITS = {
  name: 120,
  email: 254,
  notes: 2000,
  search: 100,
  orderItems: 50,
  pageSize: 100,
} as const;
```

Reusable fields keep twin doors identical (G12):

```ts
// shared/fields.ts
export const emailField = z.string().trim().toLowerCase().max(LIMITS.email).pipe(z.email());
export const nameField = z.string().trim().min(1).max(LIMITS.name);
/** Money travels as a decimal string: never a JS number (A6). */
export const amountField = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const idField = z.uuid();
```

```ts
// modules/orders/dto/create-order.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const orderItemSchema = z
  .object({ productId: idField, quantity: z.number().int().min(1).max(999) })
  .strict();

export const createOrderSchema = z
  .object({
    customerName: nameField,
    email: emailField,
    notes: z.string().trim().max(LIMITS.notes).optional(),
    items: z.array(orderItemSchema).min(1).max(LIMITS.orderItems),
  })
  .strict(); // unknown keys → 400

export class CreateOrderDto extends createZodDto(createOrderSchema) {}
```

- Body schemas never use `z.coerce`: `"1"` is not `1`, `"false"` is not `false` (A3).
- Query schemas coerce, with bounds:

```ts
export const listOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(LIMITS.pageSize).default(20),
    sort: z.enum(['createdAt', 'total']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    q: z.string().trim().max(LIMITS.search).optional(),
  })
  .strict();
export class ListOrdersQueryDto extends createZodDto(listOrdersQuerySchema) {}
```

- Global pipe: `{ provide: APP_PIPE, useClass: ZodValidationPipe }`.
- Response DTOs are allowlists too: `export class OrderResponseDto extends createZodDto(orderResponseSchema) {}`
  and, when the project serializes through them, `ZodSerializerInterceptor` +
  `@ZodSerializerDto(OrderResponseDto)` on the handler.
- PATCH schemas: `createOrderSchema.partial().strict()` — then the SERVICE validates the
  merged state (see `prisma.md` §6).

## 5. DTOs with class-validator (projects that already use it)

```ts
// main.ts / configureApp
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
// transformOptions.enableImplicitConversion stays OFF: body booleans/numbers are not converted.
```

```ts
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class OrderItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

export class CreateOrderDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(LIMITS.name) customerName!: string;
  @Transform(lower) @IsEmail() @MaxLength(LIMITS.email) email!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(LIMITS.orderItems)
  @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
```

- The controller imports the DTO as a VALUE (`import { CreateOrderDto } from './dto/create-order.dto.js'`);
  `import type` erases it and the pipe validates nothing.
- `@Type(() => Number)` only on query DTOs.

## 6. DTO tests

```ts
const base = { customerName: 'Ada', email: 'ada@example.com', items: [{ productId: UUID_1, quantity: 1 }] };

it('accepts the base body (every "rejects" case below changes ONE field of it)', () => {
  expect(createOrderSchema.safeParse(base).success).toBe(true);
});

it.each([
  ['customerName', 'x'.repeat(LIMITS.name), true], // last passing value
  ['customerName', 'x'.repeat(LIMITS.name + 1), false], // first failing value
  ['customerName', '   ', false], // min measured after trim
  ['items', Array.from({ length: LIMITS.orderItems }, () => base.items[0]), true],
  ['items', Array.from({ length: LIMITS.orderItems + 1 }, () => base.items[0]), false],
])('%s boundary', (field, value, ok) => {
  expect(createOrderSchema.safeParse({ ...base, [field]: value }).success).toBe(ok);
});

it('rejects unknown keys and does not coerce body numbers', () => {
  expect(createOrderSchema.safeParse({ ...base, total: '10.00' }).success).toBe(false);
  expect(orderItemSchema.safeParse({ productId: UUID_1, quantity: '1' }).success).toBe(false);
});

it('every door that takes a customer e-mail uses the same field (G12)', () => {
  // Partial (PATCH) schemas wrap the field: compare `schema.shape.email.unwrap()` there.
  for (const schema of [createOrderSchema, guestCheckoutSchema, inviteCustomerSchema]) {
    expect(schema.shape.email).toBe(emailField);
  }
});
```

Through HTTP (integration), the same cases assert the envelope:
`expect(res.status).toBe(400); expect(res.body).toMatchObject({ code: 'common.validation_failed' });`
