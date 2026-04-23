import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Mutex } from 'async-mutex';
import { setTimeout } from 'timers/promises';
import { ProcessPaymentDto } from './dto/process-payment.dto';
import {
  CONFLICT_MESSAGE,
  HTTP_CREATED,
  IDEMPOTENCY_TTL_MS,
  PROCESS_DELAY_MS,
} from './payment.constants';

export type PaymentOutcome = {
  statusCode: number;
  body: Record<string, unknown>;
  cacheHit: boolean;
};

type Stored = {
  fingerprint: string;
  statusCode: number;
  body: Record<string, unknown>;
  expiresAt: number;
};

@Injectable()
export class PaymentService implements OnModuleDestroy {
  private readonly logger = new Logger(PaymentService.name);
  private readonly store = new Map<string, Stored>();
  private readonly mutexByKey = new Map<string, Mutex>();
  private readonly ttlSweep = setInterval(() => this.sweepExpired(), 60_000);

  onModuleDestroy(): void {
    clearInterval(this.ttlSweep);
  }

  async processPayment(
    idempotencyKey: string,
    dto: ProcessPaymentDto,
  ): Promise<PaymentOutcome> {
    const fingerprint = this.fingerprint(dto);
    const mutex = this.mutexFor(idempotencyKey);

    return mutex.runExclusive(async () => {
      this.evictIfExpired(idempotencyKey);

      const existing = this.store.get(idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new ConflictException(CONFLICT_MESSAGE);
        }
        return {
          statusCode: existing.statusCode,
          body: existing.body,
          cacheHit: true,
        };
      }

      await setTimeout(PROCESS_DELAY_MS);
      const body = this.buildSuccessBody(dto);
      const stored: Stored = {
        fingerprint,
        statusCode: HTTP_CREATED,
        body,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      };
      this.store.set(idempotencyKey, stored);
      this.logger.log(
        `Charged idempotencyKey=${idempotencyKey} amount=${dto.amount} ${dto.currency}`,
      );

      return {
        statusCode: HTTP_CREATED,
        body,
        cacheHit: false,
      };
    });
  }

  private mutexFor(key: string): Mutex {
    let m = this.mutexByKey.get(key);
    if (!m) {
      m = new Mutex();
      this.mutexByKey.set(key, m);
    }
    return m;
  }

  private evictIfExpired(key: string): void {
    const row = this.store.get(key);
    if (row && Date.now() >= row.expiresAt) {
      this.store.delete(key);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, row] of this.store) {
      if (now >= row.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private fingerprint(dto: ProcessPaymentDto): string {
    return JSON.stringify({
      amount: dto.amount,
      currency: dto.currency,
    });
  }

  private buildSuccessBody(dto: ProcessPaymentDto): Record<string, unknown> {
    const message = `Charged ${dto.amount} ${dto.currency}`;
    return {
      message,
      amount: dto.amount,
      currency: dto.currency,
    };
  }
}
