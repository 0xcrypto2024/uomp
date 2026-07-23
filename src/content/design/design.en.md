---
title: 'UOMP Implementation Design'
description: 'Architecture and implementation notes for the uomp-mvp reference implementation: components, deployment modes, SDK, remote access, store abstraction'
---

# UOMP Implementation Design

This document explains how the UOMP **reference implementation** [`uomp-mvp`](https://github.com/0xaicrypto/uomp-core) turns the [protocol specification](/en/spec/) into runnable code.

---

## 1. Implementation Overview

`uomp-mvp` is a TypeScript monorepo. Each package maps to a Spec role:

| Package / App | Role | Responsibility |
|---------------|------|----------------|
| `packages/core` | Shared | Types, constants, utilities |
| `packages/store` | Memory Store | Pluggable storage backends (SQLite / Encrypted Object S3 / IPFS) |
| `packages/token` | — | EdDSA JWT issuance and verification |
| `packages/auth` | Auth Service | Session create/grant/close/revoke |
| `packages/guard` | Memory Guard | Token validation, scope filtering, audit logging |
| `packages/identity` | Identity Verification | Wallet auth (MetaMask / Argent X / Braavos) + seed phrase |
| `packages/sdk` | Agent SDK | `UompClient`, dual-build for Node.js + browser |
| `packages/cli` | User UI | User CLI: data import, authorization, session/store/gateway management |
| `apps/server` | — | Combined Auth + Guard HTTP service (`127.0.0.1:9374`) |
| `apps/gateway` | — | Self-hosted Gateway: mTLS + token forwarding + Cloudflare Tunnel |
| `apps/relay` | Cloud Relay | Stateless public Relay (design phase): pubkey verification + ciphertext forwarding |

---

## 2. Architecture & Deployment Modes

UOMP supports three deployment modes, ordered by user burden (low to high):

### 2.1 Local Mode (Agent + Guard on same machine)

Default, zero-config. Agent connects directly to Memory Guard at `http://127.0.0.1:9374`.

```
┌──────────┐   HTTP   ┌──────────────┐   ┌──────────────┐
│  Agent   │ ───────► │ Memory Guard │──►│ Memory Store │
└──────────┘          └──────────────┘   └──────────────┘
```

```bash
pnpm --filter @uomp/server start
pnpm cli authorize ./my-agent --no-server
source /tmp/uomp.env && node index.js
```

> `pnpm cli agent run ./my-agent` bundles auth + guard + agent launch — dev shortcut only.

### 2.2 Remote Mode (Agent external, via Gateway)

Agent runs on cloud (Digital Ocean / VPS / container), connects back through Gateway.

```
┌──────────────┐   mTLS + Token   ┌──────────────┐   HTTP   ┌──────────────┐
│ Remote Agent │ ────────────────► │   Gateway    │ ───────► │ Memory Guard │
└──────────────┘                  └──────────────┘          └──────────────┘
```

One command with Cloudflare Tunnel (no public IP needed):

```bash
uomp gateway start
# ═══ Public Gateway URL ═══
#   https://xxx.trycloudflare.com
```

### 2.3 Browser Mode (wallet auth + S3 direct + Cloud Relay)

Web Apps use `@uomp/sdk/browser`. **Reads require zero server dependencies** (S3 direct + in-browser decryption). Writes go through Cloud Relay.

```
Browser App ──read──► S3 (ciphertext) ──► in-browser decrypt
            ──write─► Cloud Relay ──► Guard ──► Store
```

No local install required. SDK auto-detects Gateway availability; falls back to S3 direct read when offline.

---

## 3. SDK

`packages/sdk` provides the `UompClient` class — **same API for Node.js Agents and browser Web Apps**.

### 3.1 Node.js Mode

```ts
import { UompClient } from '@uomp/sdk';

const uomp = UompClient.fromEnv(); // reads UOM_TOKEN + UOMP_BASE_URL

await uomp.memory.getByTag('portfolio:holdings');
await uomp.aggregate.sum('portfolio:holdings', 'value.market_value');
await uomp.payload.upload(report);
await uomp.session.finalize(); // deletion proof + close
await uomp.auth.createSession({ agentId, requestedScopes });

console.log(uomp.tokenInfo.scopes);
console.log(uomp.tokenInfo.expiresAt);
```

Transport handles: `http://` → direct, `https://` → mTLS auto-load, retry + backoff + timeout, `UompError`.

### 3.2 Browser Mode

```ts
import { BrowserSDK } from '@uomp/sdk/browser';

const uomp = await BrowserSDK.fromWallet();

// Read: auto-fallback (Gateway online → Gateway; offline → S3 direct + decrypt)
const holdings = await uomp.memory.getByTag('portfolio:holdings');

// Write: Cloud Relay
await uomp.memory.set('AAPL', newData);

if (!uomp.isGatewayOnline) { /* read-only mode */ }
```

Built-in **StoreRouter**: Gateway online routes through Gateway; offline falls back to S3 direct with client-side verification.

### 3.3 Wallet Authentication

Sdk derives encryption keys from wallet signatures:

| Wallet | Platform | SDK Call |
|--------|----------|----------|
| MetaMask | Browser | `BrowserSDK.fromWallet()` |
| Argent X | Browser (Starknet) | `BrowserSDK.fromWallet()` |
| Braavos | Browser (Starknet) | `BrowserSDK.fromWallet()` |
| Argent Mobile | iOS/Android | WalletConnect |

```ts
const id = await uomp.identity.fromWallet('starknet');
// → Argent X popup → sign → HKDF derives masterKey
// → Same wallet + same message → same key → same data on any device
```

Seed phrase (12-word BIP-39) retained as fallback for non-wallet scenarios.

### 3.4 Sub-client Quick Reference

| Sub-client | Key Methods |
|------------|-------------|
| `uomp.memory` | `get(key)`, `getByTag(tag)`, `getByKeys(keys)`, `listTags()`, `has(key)`, `set(key, item)`, `delete(key)` |
| `uomp.aggregate` | `sum(tag, field)`, `avg()`, `count()`, `min()`, `max()` |
| `uomp.payload` | `upload(data)`, `download(id)`, `info(id)` |
| `uomp.session` | `submitDeletionProof()`, `finalize()`, `close()`, `trackAccess(key)` |
| `uomp.audit` | `query({ sessionId, limit })`, `getLastAccess()` |
| `uomp.auth` | `createSession()`, `grant()`, `revoke()`, `validate()` |
| `uomp.identity` | `fromWallet(chain)`, `fromSeedPhrase(phrase)` |

---

## 4. Remote Access

### 4.1 User Gateway

`apps/gateway` is the user's self-hosted Memory Guard entry point:

```bash
uomp gateway start               # Gateway + Cloudflare Tunnel
uomp gateway start --no-tunnel   # Gateway only
uomp gateway start --browser     # CORS enabled for browser apps
```

Responsibilities: mTLS termination, token validation (audience + signature + expiry), memory/audit forwarding, payload cache.

### 4.2 Cloud Relay

Cloud Relay is a stateless public version of Gateway. UOMP runs a default instance (`relay.uomp.org`); open-source code allows anyone to self-host.

| | User Gateway | Cloud Relay |
|------|------------|------------|
| Deployed | User local | Public cloud (always online) |
| Sees plaintext | ✅ | ❌ (encrypted in Guard before storage) |
| User burden | Install + run | Zero install |
| Use case | High-sensitivity data | General use, Webapp developers |

Relay stores no data and reads no plaintext — it only validates tokens and forwards ciphertext.

### 4.3 Store Abstraction

Memory Store is abstracted behind the `IMemoryStore` interface:

```
Guard → IMemoryStore ─┬─ SQLiteStore (local, default)
                       ├─ EncryptedObjectStore (S3/R2, multi-device)
                       └─ IPFSStore (decentralized)
```

- **SQLite**: `~/.uomp/memory.db`, default, zero-config
- **Encrypted Object**: each Memory Item independently AES-256-GCM encrypted, stored on S3-compatible object storage. Multi-device via shared encrypted data
- **IPFS**: content-addressed, decentralized (future)

Encryption occurs inside the Guard process; cloud backends store only ciphertext. Keys derived from wallet signatures via HKDF.

Full design doc: [`docs/store-abstraction-design.md`](https://github.com/0xaicrypto/uomp-core/tree/main/docs/store-abstraction-design.md).

---

## 5. Auth & Authorization

### 5.1 Agent Manifest (uom.json)

Agents declare `requested_scopes`, `data_retention_policy`, `external_data_sources` in `uom.json`. The CLI parses these in `packages/cli/src/utils/manifest.ts`.

### 5.2 Session Lifecycle

```
[created] ──grant──► [active] ──close/timeout/revoke/deletion-proof──► [closed/expired/revoked]
```

`AuthService.grantSession()` issues Capability Tokens with optional `allowedFields`, `aggregationOnly`, `taskBound` constraints.

### 5.3 JWT Implementation

- Algorithm: `EdDSA` (curve `Ed25519`), using `jose`
- Internal payload camelCase, JWT claims snake_case
- Claims: `session_id`, `agent_id`, `scopes`, `limits`, `profile`, `audience`, `allowed_fields`, `aggregation_only`, `task_bound`

### 5.4 Guard Enforcement

`MemoryGuard.validateRequest()` checks in order: signature → expiry → denylist → scope → sensitivity. `aggregation_only` tokens are rejected on non-aggregation paths. High-sensitivity items require explicit key authorization.

---

## 6. Stock Analyst Example

`examples/stock-analyst/` is the full acceptance example:

1. `uomp import` holdings CSV + risk profile
2. `uomp discover` / `uomp connect` verify the Agent
3. `uomp authorize` issues the Token
4. Agent reads data → fetches quotes → analyzes (P&L, Sharpe, Beta, RSI, scenarios)
5. Generates bilingual reports (JSON + Markdown + HTML)
6. `uomp sessions` / `uomp audit` for auditing
7. `uomp revoke` to revoke

Full steps: [`examples/stock-analyst/README.md`](https://github.com/0xaicrypto/uomp-core/tree/main/examples/stock-analyst/README.md).

---

## 7. Local Config Files

```
~/.uomp/
├── config.json           # Service port, store backend config
├── user.json             # User identity (wallet address, masterKey hash)
├── memory.db             # Memory Store (SQLite)
├── auth.db               # Sessions and denylist
├── audit.db              # Audit logs
├── remote-profile.json   # Gateway config (endpoint, allowlist)
├── .secrets/             # Ed25519 keypair
└── .gateway-certs/       # Gateway mTLS certs (CA + server + client)
```

---

## 8. MVP Limitations & Future Extensions

| Capability | Status | Notes |
|------------|--------|-------|
| Agent read | ✅ | Authorized by tag/key/field |
| Agent write | ❌ | Guard returns `503 WRITE_NOT_AVAILABLE` |
| Remote Gateway | ✅ | mTLS + Cloudflare Tunnel + browser CORS |
| Aggregation | ✅ | sum/avg/count/min/max, paired with `aggregation_only` |
| Deletion proof | ✅ | Agent submits signed proof, session auto-closes |
| Field filtering | ✅ | Token specifies `allowed_fields`, Guard filters |
| Browser SDK | ✅ | Wallet auth + S3 direct read + Cloud Relay write |
| Store abstraction | ⚠️ Designed | SQLite / S3 / IPFS pluggable, Phase 2 implementation pending |
| Cloud Relay | ⚠️ Designed | Public Gateway implementation, Phase 3.5 pending |
| Wallet auth | ⚠️ Designed | MetaMask / Argent X / Braavos, Phase 2 implementation pending |
| Identity verification | ⚠️ | DID/GPG framework present, verification to be strengthened |

---

## 9. Related Links

- [Protocol Specification](/en/spec/)
- [Reference Implementation](https://github.com/0xaicrypto/uomp-core)
- [SDK Design Document](https://github.com/0xaicrypto/uomp-core/tree/main/docs/sdk-design.en.md)
- [Store Abstraction Design](https://github.com/0xaicrypto/uomp-core/tree/main/docs/store-abstraction-design.md)
- [Stock Analyst Example](https://github.com/0xaicrypto/uomp-core/tree/main/examples/stock-analyst)
