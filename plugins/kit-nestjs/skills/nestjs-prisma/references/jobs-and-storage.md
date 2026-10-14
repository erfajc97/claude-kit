# Jobs, storage and third-party adapters (A9, A10, A13, AN11, AN12)

## 1. BullMQ

Queue names and payload types live in one place; producers and processors import them.

```ts
// core/queue/queues.ts
export const QUEUES = { notifications: 'notifications', imports: 'imports' } as const;

export interface JobPayloads {
  'order-paid': { orderId: string; requestId: string };
  'import-file': { importId: string; requestId: string };
}
export type JobName = keyof JobPayloads;
```

```ts
// core/queue/redis-options.ts — lazy, bounded connections
export function redisOptions(url: string, role: 'producer' | 'worker'): RedisOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    lazyConnect: true, // never connect at import time
    maxRetriesPerRequest: role === 'worker' ? null : 3, // BullMQ workers require null
    retryStrategy: (attempt) => (attempt > 20 ? null : Math.min(attempt * 500, 5_000)), // bounded, then give up
  };
}
```

```ts
// core/queue/queue-producer.service.ts
@Injectable()
export class QueueProducer {
  constructor(@InjectQueue(QUEUES.notifications) private readonly notifications: Queue) {}

  /** Deterministic jobId: enqueueing the same fact twice is a no-op. */
  async add<N extends JobName>(name: N, payload: JobPayloads[N], jobId: string): Promise<void> {
    await this.notifications.add(name, payload, {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    });
  }
}
```

```ts
// modules/orders/jobs/order-paid.processor.ts — registered ONLY in worker.module.ts
@Processor(QUEUES.notifications)
export class OrderPaidProcessor extends WorkerHost {
  constructor(private readonly orders: OrdersService, private readonly failures: JobFailureReporter) {
    super();
  }

  async process(job: Job<JobPayloads['order-paid']>): Promise<void> {
    await this.orders.sendReceipt(job.data.orderId); // idempotent: checks receiptSentAt first
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) this.failures.report(job, error); // only the final failure
  }
}
```

- `worker.ts` boots `WorkerModule` (processors + the services they need) as its own
  process; the API process only produces.
- The request answers `202` with a status resource the client can poll (with a stop
  condition) for anything that may take more than a few seconds.
- Scheduled work (cron) also enqueues with a deterministic `jobId` per period
  (`reminders:2026-01-31`).

## 2. `StorageService` (S3-compatible)

```ts
// core/storage/storage.service.ts
const ALLOWED: Readonly<Record<UploadKind, readonly string[]>> = {
  images: ['image/jpeg', 'image/png', 'image/webp'], // never SVG
  documents: ['application/pdf'],
};
const MAX_BYTES: Readonly<Record<UploadKind, number>> = { images: 5 * 1024 * 1024, documents: 20 * 1024 * 1024 };

@Injectable()
export class StorageService {
  private client?: S3Client; // created on first use

  constructor(private readonly config: AppConfigService) {}

  async createUploadPost(input: { owner: string; kind: UploadKind; mime: string; size: number }): Promise<UploadPost> {
    if (!ALLOWED[input.kind].includes(input.mime)) throw new AppHttpException('UNSUPPORTED_MEDIA_TYPE');
    if (input.size > MAX_BYTES[input.kind]) throw new AppHttpException('PAYLOAD_TOO_LARGE');
    const key = `${input.owner}/${input.kind}/${randomUUID()}`; // the server builds the key
    const { url, fields } = await createPresignedPost(this.s3(), {
      Bucket: this.config.get('S3_BUCKET'),
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_BYTES[input.kind]],
        ['eq', '$Content-Type', input.mime],
      ],
      Fields: { 'Content-Type': input.mime },
      Expires: 300,
    });
    return { key, url, fields };
  }

  async createDownloadUrl(input: { owner: string; key: string; fileName: string; ttlSeconds?: number }): Promise<string> {
    this.assertOwned(input.owner, input.key);
    const ttl = Math.min(input.ttlSeconds ?? 300, 300);
    return getSignedUrl(
      this.s3(),
      new GetObjectCommand({
        Bucket: this.config.get('S3_BUCKET'),
        Key: input.key,
        ResponseContentDisposition: `attachment; filename="${safeFileName(input.fileName)}"`,
      }),
      { expiresIn: ttl },
    );
  }

  /** After the client uploads: the real type comes from the bytes, not the claimed MIME. */
  async verifyUploaded(input: { owner: string; key: string; kind: UploadKind }): Promise<void> {
    this.assertOwned(input.owner, input.key);
    const head = await this.readPrefix(input.key, 16);
    if (!ALLOWED[input.kind].includes(sniffMime(head))) {
      await this.delete(input);
      throw new AppHttpException('UNSUPPORTED_MEDIA_TYPE');
    }
  }

  private assertOwned(owner: string, key: string): void {
    if (!key.startsWith(`${owner}/`)) throw new AppHttpException('NOT_FOUND'); // foreign key = not found
  }

  private s3(): S3Client {
    this.client ??= new S3Client({
      region: this.config.get('S3_REGION'),
      endpoint: this.config.get('S3_ENDPOINT'),
      forcePathStyle: true,
      requestHandler: { requestTimeout: this.config.get('HTTP_TIMEOUT_MS') },
    });
    return this.client;
  }
}
```

A client that sends back a file URL or key is trusted only after `assertOwned` and a
lookup that the file belongs to that resource; the server re-derives the URL.

## 3. Third-party adapters with timeouts

```ts
// modules/geocoding/geocoding.port.ts
export interface GeocodingPort {
  search(query: string): Promise<GeoResult[]>;
}
export const GEOCODING = Symbol('GEOCODING');
```

```ts
// modules/geocoding/providers/http-geocoding.adapter.ts — the only file that talks to the vendor
@Injectable()
export class HttpGeocodingAdapter implements GeocodingPort {
  constructor(private readonly config: AppConfigService) {}

  async search(query: string): Promise<GeoResult[]> {
    const url = new URL('/search', this.config.get('GEOCODING_URL')); // fixed host from config, never from the user
    url.searchParams.set('q', query);
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(this.config.get('HTTP_TIMEOUT_MS')) });
    } catch {
      throw new AppHttpException('GEOCODING_UNAVAILABLE'); // timeout or network: mapped, not leaked
    }
    if (!response.ok) throw new AppHttpException('GEOCODING_UNAVAILABLE');
    return geoResultsSchema.parse(await response.json()); // validate what comes back
  }
}
```

```ts
// geocoding.module.ts
providers: [{ provide: GEOCODING, useClass: HttpGeocodingAdapter }],
// tests: { provide: GEOCODING, useValue: fakeGeocoding } — never patch fetch or internals
```

For clients that take no `AbortSignal` (some pool or Redis calls), bound the wait:

```ts
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

A timeout or 5xx from a payment or other irreversible operation is UNKNOWN, not failed:
never refund, cancel or mark failed without asking the provider again (see `addon-money`
when enabled).
