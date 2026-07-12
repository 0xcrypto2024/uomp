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
| `packages/cli` | User UI | Interactive authorization, Agent launcher |
| `apps/server` | — | Combined Auth + Guard HTTP service |

---

## 2. Standard Architecture Flow

In UOMP's standard model, the **Agent is an independent process**, and the uomp CLI is the **user-side authorization proxy** running on the machine where the Memory Store / Guard lives:

<div class="diagram">
  <svg viewBox="0 0 800 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="UOMP standard architecture sequence diagram">
    <defs>
      <marker id="seq-arrow-en" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" />
      </marker>
      <marker id="seq-return-en" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#a1a1aa" />
      </marker>
    </defs>

    <rect x="30" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="90" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Agent</text>
    <line x1="90" y1="56" x2="90" y2="340" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="190" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="250" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">uomp CLI</text>
    <line x1="250" y1="56" x2="250" y2="340" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="350" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="410" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Auth Service</text>
    <line x1="410" y1="56" x2="410" y2="340" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="510" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="570" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Memory Guard</text>
    <line x1="570" y1="56" x2="570" y2="340" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="670" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="730" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Memory Store</text>
    <line x1="730" y1="56" x2="730" y2="340" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <line x1="90" y1="80" x2="250" y2="80" stroke="#22d3ee" stroke-width="2" marker-end="url(#seq-arrow-en)" />
    <text x="170" y="75" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">1. uom.json</text>

    <path d="M 250 110 L 270 110 L 270 130 L 250 130" fill="none" stroke="#22d3ee" stroke-width="2" marker-end="url(#seq-arrow-en)" />
    <text x="265" y="105" text-anchor="start" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">2. verify + authorize</text>

    <line x1="250" y1="160" x2="410" y2="160" stroke="#22d3ee" stroke-width="2" marker-end="url(#seq-arrow-en)" />
    <text x="330" y="155" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">3. create & grant</text>

    <line x1="410" y1="200" x2="250" y2="200" stroke="#a1a1aa" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#seq-return-en)" />
    <text x="330" y="195" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">UOM_TOKEN</text>

    <line x1="250" y1="240" x2="90" y2="240" stroke="#22d3ee" stroke-width="2" marker-end="url(#seq-arrow-en)" />
    <text x="170" y="235" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">4. deliver Token</text>

    <line x1="90" y1="280" x2="570" y2="280" stroke="#22d3ee" stroke-width="2" marker-end="url(#seq-arrow-en)" />
    <text x="330" y="275" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">5. HTTP + Authorization</text>

    <line x1="570" y1="320" x2="730" y2="320" stroke="#22d3ee" stroke-width="2" marker-end="url(#seq-arrow-en)" />
    <text x="650" y="315" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">6. read by scope</text>

    <line x1="730" y1="350" x2="90" y2="350" stroke="#a1a1aa" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#seq-return-en)" />
    <text x="410" y="345" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">return filtered data</text>
  </svg>
</div>

Key points:

- **Agent and CLI are separate processes**; the Agent does not depend on the CLI to start.
- **Identity verification, authorization prompt, and Token issuance all happen in the CLI (on the user's side, where Memory lives).**
- **The Agent only receives the Token and uses it to read data**; it does not participate in authorization decisions.

### 2.1 Local Development Convenience Mode

The MVP's `pnpm cli run ./examples/calendar-agent` is a shortcut to lower the barrier to entry:

<div class="diagram">
  <svg viewBox="0 0 600 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="UOMP local development shortcut sequence diagram">
    <defs>
      <marker id="shortcut-arrow-en" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" />
      </marker>
      <marker id="shortcut-return-en" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#a1a1aa" />
      </marker>
    </defs>

    <rect x="30" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="90" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">uomp CLI</text>
    <line x1="90" y1="56" x2="90" y2="290" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="190" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="250" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Auth Service</text>
    <line x1="250" y1="56" x2="250" y2="290" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="350" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="410" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Memory Guard</text>
    <line x1="410" y1="56" x2="410" y2="290" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <rect x="510" y="20" width="120" height="36" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="570" y="43" text-anchor="middle" fill="#e4e4e7" font-size="12" font-family="system-ui, sans-serif">Agent (child)</text>
    <line x1="570" y1="56" x2="570" y2="290" stroke="#2a2a3a" stroke-width="2" stroke-dasharray="4 4" />

    <path d="M 90 80 L 110 80 L 110 100 L 90 100" fill="none" stroke="#22d3ee" stroke-width="2" marker-end="url(#shortcut-arrow-en)" />
    <text x="115" y="95" text-anchor="start" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">Read uom.json</text>

    <line x1="90" y1="140" x2="250" y2="140" stroke="#22d3ee" stroke-width="2" marker-end="url(#shortcut-arrow-en)" />
    <text x="170" y="135" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">create & grant</text>

    <line x1="250" y1="180" x2="90" y2="180" stroke="#a1a1aa" stroke-width="2" stroke-dasharray="4 4" marker-end="url(#shortcut-return-en)" />
    <text x="170" y="175" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">UOM_TOKEN</text>

    <line x1="90" y1="220" x2="410" y2="220" stroke="#22d3ee" stroke-width="2" marker-end="url(#shortcut-arrow-en)" />
    <text x="250" y="215" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">Start local Guard</text>

    <line x1="90" y1="260" x2="570" y2="260" stroke="#22d3ee" stroke-width="2" marker-end="url(#shortcut-arrow-en)" />
    <text x="330" y="255" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">Spawn child + inject Token</text>
  </svg>
</div>

This mode merges the "authorization proxy" and "Agent launcher" roles and is only suitable for local development and testing, not production architecture.

Key code entry points:

- `packages/cli/src/commands/run.ts`: orchestrates the local development mode
- `packages/auth/src/index.ts`: `AuthService`
- `packages/guard/src/index.ts`: `MemoryGuard`
- `packages/token/src/index.ts`: `JWTTokenIssuer`

---

## 3. Authentication & Authorization Implementation

### 3.1 Agent Declaration

`uom.json` uses `snake_case` for `requested_scopes`, while the internal `AgentManifest` type uses `camelCase`. The CLI converts between them in `loadManifest()` via `normalizeManifest()`:

```ts
// packages/cli/src/commands/run.ts
const raw = JSON.parse(content);
return this.normalizeManifest(raw);
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

## 6. Local Configuration Files

After `uomp init`, the following are generated in `~/.uomp`:

- `config.json` — service port, data directory
- `uomp.sqlite` — Memory Store
- `auth.sqlite` — Sessions and blacklist
- `audit.sqlite` — Audit logs
- `.secrets/` — Ed25519 key pair (MVP regenerates on each run; production should persist)

---

## 7. MVP Limitations & Future Extensions

| Capability | MVP Status | Notes |
|------------|------------|-------|
| Agent read | ✅ Implemented | Authorized by tag/key |
| Agent write | ❌ Not open | Guard returns `503 WRITE_NOT_AVAILABLE` |
| Agent delete | ❌ Not open | Same as write |
| Remote Profile | ⚠️ Partially reserved | `profile: 'remote'`, `audience`, `allowed_endpoints` defined, but TLS/mTLS not implemented |
| Identity verification | ⚠️ Optional | DID/GPG framework present, but verification is weak |
| Query quotas | ⚠️ Reserved | `limits` written into token, but not enforced |

---

## 8. Related Links

- [Protocol Specification](/en/spec/)
- [Reference Implementation Repository](https://github.com/0xaicrypto/uomp-core)
- [Example Agent](https://github.com/0xaicrypto/uomp-core/tree/main/examples/calendar-agent)
