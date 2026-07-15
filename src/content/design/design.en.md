---
title: 'UOMP Implementation Design'
description: 'Architecture and implementation notes for the uomp-mvp reference implementation: component responsibilities, data flow, and auth details'
---

# UOMP Implementation Design

This document explains how the UOMP **reference implementation** [`uomp-mvp`](https://github.com/0xaicrypto/uomp-core) turns the [protocol specification](/en/spec/) into runnable code. It is intended for people who want to understand or extend the implementation.

---

## 1. Implementation Overview

`uomp-mvp` is a TypeScript monorepo. Each package maps to a role in the Spec:

| Package / App | Spec Role | Responsibility |
|---------------|-----------|----------------|
| `packages/core` | — | Shared types, constants, utilities |
| `packages/store` | Memory Store | SQLite persistence, tag/key queries |
| `packages/token` | — | EdDSA JWT issuance and verification |
| `packages/auth` | Auth Service | Session create/grant/close/revoke |
| `packages/guard` | Memory Guard | Token validation, scope filtering, audit logging |
| `packages/identity` | Identity Verification | DID / GPG verification entry point |
| `packages/sdk` | Agent SDK (example-level) | A simple HTTP client wrapper for example Agents; full TypeScript SDK for GUI app integration is planned in [Roadmap](/en/roadmap/) Milestone 2 |
| `packages/cli` | User UI | User CLI: `discover`/`connect`/`authorize`/`import`/`sessions`/`revoke`/`audit`/`registry`; developer shortcut `uomp agent run` |
| `apps/server` | — | Combined Auth + Guard HTTP service |
| `apps/gateway` | — | Remote Authorization Gateway: mTLS termination, remote token validation, forwarding memory/audit requests |

---

## 2. Standard Architecture Flow

In UOMP's standard model, the **Agent is an independent process**, and the uomp CLI is the **user-side authorization proxy** running on the machine where the Memory Store / Guard lives. The Auth Service may run on the same machine as the Memory Guard / Store (local default) or may be provided by a trusted remote service chosen by the user:

<img src="/diagrams/design-standard-en.svg" alt="UOMP standard architecture sequence diagram" class="diagram" />

Key points:

- **Agent and CLI are separate processes**; the Agent does not depend on the CLI to start.
- **Identity verification, authorization prompt, and Token issuance happen in the CLI (on the user's side) or in the user's chosen Auth Service.**
- **The Auth Service can be deployed locally or remotely**; the Token is ultimately delivered to the Agent through the CLI.
- **The Agent only receives the Token and uses it to read data**; it does not participate in authorization decisions.

### 2.1 Local Development Convenience Mode

The MVP's `pnpm cli agent run ./examples/calendar-agent` is a shortcut to lower the barrier to entry:

<img src="/diagrams/design-shortcut-en.svg" alt="UOMP local development shortcut sequence diagram" class="diagram" />

This mode merges the "authorization proxy" and "Agent launcher" roles and is only suitable for local development and testing, not production architecture. In the standard user flow, the CLI only runs `authorize` and prints the Token; the Agent is started independently by the user.

### 2.2 Remote Mode (Remote Profile + Gateway)

When the Agent runs outside the user's local machine/container/cloud service, use `apps/gateway` to expose the Memory Guard:

- The Gateway listens on HTTPS and requires a client mTLS certificate.
- The user configures the Gateway endpoint and client-certificate fingerprint allowlist in `~/.uomp/remote-profile.json`.
- The Capability Token issued by the Auth Service uses `profile: 'remote'` and its `audience` points to the Gateway endpoint (e.g. `https://localhost:9443`).
- After validating the Token, the Gateway forwards `/v1/memory/*` and `/v1/audit/*` to the local Memory Guard.

```text
┌─────────────┐   mTLS + Bearer Token   ┌──────────────┐   local HTTP   ┌──────────────┐
│ Remote Agent│ ───────────────────────►│ UOMP Gateway │ ──────────────►│ Memory Guard │
└─────────────┘                         └──────────────┘                └──────────────┘
```

Quick validation commands:

```bash
# 1. Generate CA / Gateway server cert / client cert
./scripts/generate-gateway-certs.sh

# 2. Start the Gateway
node apps/gateway/dist/index.js

# 3. Create a remote session and run the end-to-end smoke test
./scripts/test-gateway-remote.sh
```

Key code entry points:

- `packages/cli/src/commands/authorize.ts`: standard authorization flow
- `packages/cli/src/commands/run.ts`: local development shortcut orchestration
- `packages/cli/src/utils/manifest.ts`: `loadManifest()` and `normalizeManifest()`
- `packages/auth/src/index.ts`: `AuthService` (`grantSession()` now supports `profile`/`audience`/`allowedFields`/`aggregationOnly`/`taskBound`)
- `packages/guard/src/index.ts`: `MemoryGuard` (new `/v1/audit` query endpoint)
- `packages/token/src/index.ts`: `JWTTokenIssuer`
- `apps/gateway/src/index.ts`: Gateway mTLS server and forwarding logic
- `scripts/generate-gateway-certs.sh` and `scripts/test-gateway-remote.sh`

### 2.3 CLI Command Structure

To clearly separate the "end user" and "Agent developer" paths, CLI commands are split into two groups:

**End-user commands**

| Command | Purpose |
|---------|---------|
| `uomp import <file>` | Import private data from CSV/JSON into the Memory Store |
| `uomp discover <agent>` | Discover an Agent and display its `uom.json` manifest |
| `uomp connect <agent>` | Verify identity, checksum, and cache the manifest |
| `uomp authorize <agent>` | Interactively or scriptably authorize and output `UOM_TOKEN` |
| `uomp sessions` | List active sessions |
| `uomp revoke <session-id>` | Revoke a session |
| `uomp audit` | View access audit logs |
| `uomp registry <sub>` | Manage the local Registry index |

**Developer commands**

| Command | Purpose |
|---------|---------|
| `uomp agent run <agent>` | Local debug shortcut: authorize, start Guard, and launch the Agent in one command |

---

## 3. Authentication & Authorization Implementation

### 3.1 Agent Declaration

`uom.json` uses `snake_case` for `requested_scopes`, while the internal `AgentManifest` type uses `camelCase`. The CLI converts between them in `packages/cli/src/utils/manifest.ts` via `loadManifest()` / `normalizeManifest()`:

```ts
// packages/cli/src/utils/manifest.ts
const raw = JSON.parse(content);
return normalizeManifest(raw);
```

### 3.2 Session Creation & Granting

`AuthService.createSession()` writes the request into the SQLite `sessions` table with status `created`.

`AuthService.grantSession()`:

1. Checks the Session status is `created`
2. Constructs the `CapabilityTokenPayload`
3. Calls `JWTTokenIssuer.issue()` to generate the JWT
4. Computes a token hash and stores it in `sessions.token_hash`
5. Updates the Session status to `active`

```ts
const payload: CapabilityTokenPayload = {
  version: '1.0',
  sessionId,
  agentId: row.agent_id,
  issuedAt: new Date().toISOString(),
  expiresAt: expiresAt.toISOString(),
  scopes: grantedScopes,
  profile: 'local',
  audience: 'http://127.0.0.1:9374',
  limits: { maxReadQueries: 100, maxWriteQueries: 0 },
};
```

For remote mode, `grantSession()` accepts optional `{ profile, audience }` parameters; in that case `profile` is `'remote'` and `audience` points to the Gateway endpoint (e.g. `https://localhost:9443`). The Token is still signed by the local Auth Service private key; the Gateway only holds the public key for verification.

### 3.3 JWT Implementation Details

`JWTTokenIssuer` uses the `jose` library:

- Algorithm: `EdDSA` (curve `Ed25519`)
- Keys generated via `generateKeyPair('EdDSA', { crv: 'Ed25519' })`
- Internal payload is camelCase; JWT claims are snake_case
- Standard JWT `iat` and `exp` claims are also set
- Header includes `kid: 'uomp-auth-key-1'`

```ts
private payloadToJWT(payload) {
  return {
    version: payload.version,
    session_id: payload.sessionId,
    agent_id: payload.agentId,
    issued_at: payload.issuedAt,
    expires_at: payload.expiresAt,
    scopes: payload.scopes,
    limits: payload.limits,
    profile: payload.profile,
    audience: payload.audience,
  allowed_endpoints: payload.allowedEndpoints,
  allowed_fields: payload.allowedFields,
  aggregation_only: payload.aggregationOnly ?? false,
  task_bound: payload.taskBound ?? false,
};
}
```

### 3.4 Guard Enforcement

`MemoryGuard.validateRequest()` validates in order:

1. `Authorization` header is `Bearer <token>`
2. JWT signature is valid
3. Token is not expired
4. Session is not revoked (via `token_blacklist` table)

Then it dispatches by request type:

- `GET /v1/memory/:key` → `isKeyAllowed()`
- `GET /v1/memory?tag=xxx` → `isTagAllowed()`, then `isKeyAllowed()` for each result

`isKeyAllowed()` decision order:

1. If key is in `denyKeys` → deny
2. If key is in `keys` → allow
3. If item `sensitivity === 'high'` → must match `keys`, else deny
4. If any item tag is in `tags` and not in `denyTags` → allow
5. Otherwise deny

Therefore, high-sensitivity data (e.g., `portfolio:holdings`) **cannot be authorized by tag alone**. During interactive or scripted authorization, `uomp authorize` automatically adds the keys of all items under the selected high-sensitivity tag to `scope.keys`. This satisfies Guard's requirement while still presenting the user with a tag-level summary in the authorization panel.

### 3.5 Identity Verification (Optional)

Identity verification is performed by the **CLI on the user's machine**, not inside the Agent process. `IdentityVerifier` current implementation:

- **DID**: uses `did-resolver`, `ethr-did-resolver`, and `web-did-resolver`. In MVP it only checks that the DID document is resolvable; signature binding is not enforced.
- **GPG**: `openpgp` is imported, but `verifyGpg()` is currently a placeholder that only checks whether `proof.proofValue` exists.
- **No identity**: returns `valid=false`; the CLI on the user's machine prints a yellow warning but still allows execution.

This lowers the barrier for example Agents; production deployments should enforce identity verification on the user's host, and Agents that fail verification must not receive a Token.

---

## 4. Memory Store Implementation

`MemoryStore` is based on `better-sqlite3`:

- `memory_items` stores key, value (JSON string), tags (JSON array string), sensitivity, source, etc.
- `getByTag()` uses the SQLite JSON1 extension:

```sql
SELECT * FROM memory_items
WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)
```

- `set()` uses `INSERT ... ON CONFLICT(key) DO UPDATE` for upsert

---

## 5. Audit Logging

`MemoryGuard` writes to `audit_logs` after every request:

- Both successful and failed requests are logged
- Includes `session_id`, `agent_id`, `action`, `key`, `tags`, `allowed`, `reason`
- MVP does not enforce read quotas, but the `limits` field is already reserved for future quota deduction

---

## 6. Stock Analyst Example

`examples/stock-analyst/` is the Phase 1 end-to-end acceptance example, covering the full flow from data import to audit and revocation:

1. `uomp import ./examples/stock-analyst/sample-risk.json` imports the risk profile (self-describing JSON record).
2. `uomp import ./examples/stock-analyst/sample-holdings.csv --tag portfolio:holdings --sensitivity high` imports the holdings CSV.
3. `uomp discover ./examples/stock-analyst` and `uomp connect ./examples/stock-analyst` verify the Agent.
4. `uomp authorize ./examples/stock-analyst` authorizes interactively, showing a field-level summary.
5. The user passes the printed `UOM_TOKEN` to the Agent process and runs `node ./examples/stock-analyst/index.js` independently.
6. The Agent reads authorized data, fetches public market quotes, and generates a local Markdown report.
7. `uomp sessions -a` and `uomp audit --limit 20` review access records.
8. `uomp revoke <session-id>` revokes the session.

Full steps are in the repository at [`examples/stock-analyst/README.md`](https://github.com/0xaicrypto/uomp-core/tree/main/examples/stock-analyst/README.md).

---

## 7. SDK

`packages/sdk` provides the `UompClient` class — one-line init, full UOMP capability:

```ts
import { UompClient } from '@uomp/sdk';

const uomp = UompClient.fromEnv(); // auto-reads UOM_TOKEN + UOMP_BASE_URL

await uomp.memory.getByTag('portfolio:holdings');
await uomp.aggregate.sum('portfolio:holdings', 'value.market_value');
await uomp.payload.upload(report);
await uomp.session.submitDeletionProof();
await uomp.audit.query({ limit: 20 });
```

Transport layer handles:
- `http://` → direct to Memory Guard
- `https://` → Gateway mTLS (auto-loads `~/.uomp/.gateway-certs/`)
- Retry + backoff + timeout
- Structured errors (`UompError`)

Backward compatible: `UserMemory` class retained. Full API reference: [`docs/sdk-design.en.md`](https://github.com/0xaicrypto/uomp-core/tree/main/docs/sdk-design.en.md).

---

## 8. Local Configuration Files

After `uomp init`, the following are generated in `~/.uomp`:

- `config.json` — service port, data directory
- `uomp.sqlite` — Memory Store
- `auth.sqlite` — Sessions and blacklist
- `audit.sqlite` — Audit logs
- `.secrets/` — Ed25519 key pair (MVP regenerates on each run; production should persist)

---

## 9. MVP Limitations & Future Extensions

| Capability | MVP Status | Notes |
|------------|------------|-------|
| Agent read | ✅ Implemented | Authorized by tag/key |
| Agent write | ❌ Not open | Guard returns `503 WRITE_NOT_AVAILABLE` |
| Agent delete | ❌ Not open | Same as write |
| Remote Profile (Gateway + mTLS) | ✅ Implemented | Reference implementation in `apps/gateway`; Payload E2E encryption still future work |
| Aggregation query (`/v1/memory/aggregate`) | ✅ Implemented | sum/avg/count/min/max, paired with `aggregation_only` Token |
| Deletion proof (`/v1/sessions/{id}/deletion-proof`) | ✅ Implemented | Agent submits signed proof, Session auto-closes |
| Audit query (`/v1/audit`) | ✅ Implemented | Filterable by session_id |
| Field filtering (`allowed_fields`) | ✅ Implemented | Token specifies return fields, Guard filters |
| Identity verification | ⚠️ Optional | DID/GPG framework present, but verification is weak |
| Query quotas | ⚠️ Reserved | `limits` written into token, but not enforced |

---

## 10. Related Links

- [Protocol Specification](/en/spec/)
- [Reference Implementation Repository](https://github.com/0xaicrypto/uomp-core)
- [Calendar Example Agent](https://github.com/0xaicrypto/uomp-core/tree/main/examples/calendar-agent)
- [Stock Analyst Example Agent](https://github.com/0xaicrypto/uomp-core/tree/main/examples/stock-analyst)
