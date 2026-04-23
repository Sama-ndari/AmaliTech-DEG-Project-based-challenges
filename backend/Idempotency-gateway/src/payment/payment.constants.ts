export const PROCESS_DELAY_MS = 2000;

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const CONFLICT_MESSAGE =
  'Idempotency key already used for a different request body.' as const;

export const HTTP_CREATED = 201;
