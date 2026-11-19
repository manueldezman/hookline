# Hookline

Hookline is the webhook delivery API described in the documentation.

The documentation is at https://manueldezman.github.io/hookline-docs.

This repository implements that API. It creates events, manages endpoints, records delivery attempts, signs each request with HMAC-SHA256, retries failures on the documented schedule, and serves the delivery log.

## Requirements

Node.js 22.13 or later. The database is SQLite through the built-in `node:sqlite` module, so there is nothing to compile and no server to install.

## Run the API

```bash
npm install
npm start
```

The API listens at `http://127.0.0.1:4242/v2`. The database is created at `data/hookline.db` on first start.

Two keys are seeded on first start. They are development keys, and they are printed in the server log.

| Mode | Key | Behaviour |
| --- | --- | --- |
| Test | `hl_test_dev` | Delivers to the CLI listener only |
| Live | `hl_live_dev` | Delivers to registered endpoints |

Change both keys in `.env` before you expose the server to a network.

## Send an event

```bash
curl http://127.0.0.1:4242/v2/events \
  -H "Authorization: Bearer hl_live_dev" \
  -H "Content-Type: application/json" \
  -d '{"type":"invoice.paid","payload":{"invoiceId":"inv_1042","amount":4900,"currency":"USD"}}'
```

The response is `202` with the event ID and a status of `queued`.

## Use the CLI

The CLI covers the quickstart flow. It reads `HOOKLINE_API_KEY` and `HOOKLINE_API_URL`.

```bash
export HOOKLINE_API_KEY=hl_test_dev

node bin/hookline.js whoami
node bin/hookline.js listen
node bin/hookline.js events send invoice.paid --payload '{"invoiceId":"inv_1042"}'
```

Run `listen` in one terminal and `events send` in another. The listener prints each test event as it arrives. Add `--forward-to http://localhost:3000/webhooks` to send each event to a local receiver.

The `login` command is not implemented, because it needs the Hookline dashboard. Set `HOOKLINE_API_KEY` instead.

## What is implemented

| Resource | Endpoints |
| --- | --- |
| Events | `POST /v2/events`, `GET /v2/events/{id}` |
| Endpoints | `GET /v2/endpoints`, `POST /v2/endpoints`, `PATCH /v2/endpoints/{id}`, `DELETE /v2/endpoints/{id}` |
| Deliveries | `GET /v2/deliveries`, `GET /v2/deliveries/{id}`, `POST /v2/deliveries/{id}/replay`, `POST /v2/deliveries/replay` |
| Account | `GET /v2/account` |

The behaviour follows the documentation.

- Bearer key authentication, with test and live modes.
- The documented error object, status codes, and codes such as `invalid_api_key`, `unknown_event_type`, and `endpoint_unreachable`.
- Cursor pagination with `limit` and `starting_after`, and the `List` shape with `has_more` and `next_cursor`.
- Idempotency keys on event creation, with a 24-hour key window.
- Endpoint verification with HTTPS, a public address check, and a `HEAD` request that must return `2xx`.
- `Hookline-Signature` over the timestamp, a period, and the raw body, with HMAC-SHA256.
- The six-attempt retry schedule over 24 hours, no redirect following, and automatic disable after seven days of failure.
- A thirty-day delivery log, single replay, and range replay.
- Per-plan request limits with `X-RateLimit-*` headers and `429` responses with `Retry-After`.
- `Hookline-Version` handling for `2026-03-01` and `2026-02-10`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4242` | Port the API listens on |
| `HOST` | `127.0.0.1` | Address the API binds to |
| `HOOKLINE_DATA_DIR` | `./data` | Directory for the SQLite file |
| `HOOKLINE_PLAN` | `free` | Plan for the account, one of `free`, `team`, `business` |
| `HOOKLINE_TEST_KEY` | `hl_test_dev` | Test key seeded on first start |
| `HOOKLINE_LIVE_KEY` | `hl_live_dev` | Live key seeded on first start |
| `HOOKLINE_ALLOW_PRIVATE_URLS` | `0` | Allow `http` and private addresses when an endpoint is created |
| `HOOKLINE_DELIVERY_TIMEOUT_MS` | `5000` | Delivery timeout |
| `HOOKLINE_TICK_MS` | `1000` | How often the worker looks for due deliveries |

Set `HOOKLINE_ALLOW_PRIVATE_URLS=1` only for local development. Set it to `0` in any shared environment.

## Test

```bash
npm test
```

The suite covers authentication, validation, idempotency, pagination, endpoint verification, signing, the retry schedule, replay, rate limits, and automatic disable.

## Known gaps

This is a single-process implementation for a demo, not a deployment.

- One account per database.
- The delivery worker runs inside the API process.
- SQLite and an in-memory rate limiter, so the API cannot scale past one process.
- No dashboard, so keys are seeded from the environment and secret rotation is not exposed over HTTP.
- No `/v1` routes.
- No Node.js or Python SDK packages. The CLI is the only client here.
