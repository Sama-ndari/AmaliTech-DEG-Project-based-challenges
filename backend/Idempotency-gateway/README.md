# Idempotency Gateway

NestJS service that processes `POST /process-payment` **at most once** per `Idempotency-Key` + body pair, with safe retries and concurrent-request handling.

## Architecture

```mermaid
sequenceDiagram
  participant C as Client
  participant API as Nest API
  participant M as Per-Key Mutex
  participant S as In-Memory Store

  C->>API: POST /process-payment (Idempotency-Key, body)
  API->>M: acquire(key)
  M-->>API: held (serializes same key)

  alt New key or TTL expired
    API->>S: lookup(key) miss
    API->>API: delay 2s (simulate charge)
    API->>S: save status + body + expiry
    API-->>C: 201 + JSON (no X-Cache-Hit)
  else Same key + same body (cached)
    API->>S: lookup hit
    API-->>C: same status + body + X-Cache-Hit: true
  else Same key + different body
    API-->>C: 409 Conflict + message
  end

  Note over M: Request B waits on mutex while A processes; then reads same stored result.
```

## Setup

```bash
cd backend/Idempotency-gateway
npm ci
npm start
```

- **API:** `http://localhost:3000` (override with `PORT`)
- **Swagger:** `http://localhost:3000/docs`

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/process-payment` | Idempotent payment simulation |

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Idempotency-Key` | Yes | Client-supplied unique key for this logical operation |
| `Content-Type` | Yes (for JSON) | `application/json` |

### Request body

| Field | Type | Rules |
|-------|------|--------|
| `amount` | integer | ≥ 1 |
| `currency` | string | Exactly 3 letters (stored uppercased, e.g. `GHS`) |

### Success (first process)

- **Status:** `201 Created`
- **Body:** `{ "message": "Charged <amount> <currency>", "amount", "currency" }`
- **Processing:** server waits **2 seconds** once per key+body (until TTL expires).

### Retry / duplicate (same key + same body)

- **Status & body:** identical to the first successful response
- **Header:** `X-Cache-Hit: true`
- **No** extra 2s processing delay

### Same key, different body

- **Status:** `409 Conflict`
- **Message:** `Idempotency key already used for a different request body.`

### Examples (curl)

First charge:

```bash
curl -sS -D - -X POST http://localhost:3000/process-payment \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-1' \
  --data '{"amount":100,"currency":"GHS"}'
```

Duplicate (instant replay, note header):

```bash
curl -sS -D - -X POST http://localhost:3000/process-payment \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-1' \
  --data '{"amount":100,"currency":"GHS"}'
```

Conflict:

```bash
curl -sS -D - -X POST http://localhost:3000/process-payment \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-1' \
  --data '{"amount":500,"currency":"GHS"}'
```

Missing key:

```bash
curl -sS -D - -X POST http://localhost:3000/process-payment \
  -H 'Content-Type: application/json' \
  --data '{"amount":100,"currency":"GHS"}'
```

## Design decisions

- **Per-key `async-mutex`:** All requests for the same idempotency key run exclusively. That implements the **in-flight** rule: a second identical request waits for the first, then reads the stored outcome—no double delay, no spurious 409.
- **Fingerprint:** Canonical JSON of `{ amount, currency }` so “same payment” is deterministic.
- **In-memory `Map`:** Enough for the exercise; swap for Redis/Postgres in production.
- **`201 Created`:** Single chosen success code so retries replay the exact status.
- **Validation:** Rejects bad input early (`400`) before idempotency logic.

## Developer’s choice: TTL on idempotency records

Each stored outcome gets an **expiry** (default **24 hours**). After expiry, the key slot is removed (lazy eviction on access + periodic sweep). **Why:** real processors cannot keep unbounded in-memory keys; regulators and risk teams also expect **bounded retention** so keys can eventually be reused safely after a defined window. Tune `IDEMPOTENCY_TTL_MS` in `src/payment/payment.constants.ts`.
