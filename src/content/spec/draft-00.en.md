---
title: 'UOMP-Draft-00'
description: 'User-Owned Memory Protocol Specification Draft'
---

# User-Owned Memory Protocol (UOMP)

**Version**: Draft-00  
**Status**: Draft  
**Published**: 2026-07-12  
**Goal**: Public RFC draft for community review

---

## 1. Abstract

The User-Owned Memory Protocol (UOMP) defines a user-sovereign authorization protocol that allows users to temporarily grant AI Agents access to their personal memory data (preferences, settings, identity attributes, etc.). Authorization takes effect on a per-session basis, scoped by Tag or Key, and is revoked immediately when the session ends or is revoked. UOMP runs locally by default and defines an extension mechanism for remote Agents.

## 2. Status of This Memo

This document is the UOMP protocol draft (Draft-00). It describes the protocol design intent, data formats, HTTP API, and security requirements. It is intended to evolve into a formal standard through public discussion. The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

## 3. Introduction

### 3.1 Motivation

When AI Agents provide services to users, they typically require access to personal data. Existing solutions often require users to upload data to the Agent provider's server, leading to:

- Users losing direct control over their data.
- Agents potentially retaining user data indefinitely.
- Users having difficulty auditing what Agents have accessed.

UOMP's design goals are:

- **Users always own their memory data**.
- **Every access requires temporary authorization**.
- **Authorization scope is minimized**.
- **Authorization expires immediately after the session ends**.
- **All access is auditable**.

### 3.2 Design Principles

- **Local-first**: In the default deployment model, Memory Guard runs on the local machine and only listens on `127.0.0.1`.
- **Capability-based authorization**: Uses short-lived Capability Tokens to express authorization scope.
- **Tag/Key scoping**: Authorization can be granted by tag or exact key.
- **Session-bound**: Tokens are bound to a specific Session and expire when the Session ends.
- **Transport-agnostic core**: The core protocol is based on HTTP but can be extended to other transports.

## 4. Terminology

| Term | Definition |
|------|------------|
| **Memory** | User personal memory data, including preferences, settings, identity attributes, etc. |
| **Memory Item** | A single memory record containing key, value, tags, sensitivity, and other metadata. |
| **Memory Store** | User-side persistent storage for Memory Items. |
| **Memory Guard** | Access proxy layer that validates authorization, filters data, and records audit logs. |
| **Auth Service** | Session management component responsible for creating/closing Sessions and issuing/validating Capability Tokens. |
| **Session** | A single Agent task cycle with a unique `session_id`. |
| **Capability Token** | Session-level authorization credential specifying the Agent's accessible tag/key scope. |
| **Agent** | A program that accesses user memory through UOMP, running locally or remotely. |
| **uom.json** | Agent manifest file describing the Agent's identity and default requested memory scope. |
| **Local Profile** | Local deployment model where Memory Guard listens on `127.0.0.1`. |
| **Remote Profile** | Remote deployment model where Memory Guard is exposed via TLS + mTLS. |

## 5. Protocol Overview

### 5.1 Architecture

<img src="/diagrams/spec-architecture-en.svg" alt="UOMP architecture diagram" class="diagram" />

### 5.2 Flow

1. The Agent runs as an independent process and provides a `uom.json` declaring its identity and default requested memory scope.
2. The user discovers or connects to the Agent through the local UI/CLI, and the Auth Service creates a Session in the `created` state. The Auth Service may run on the same machine as the Memory Guard / Store or may be provided by a trusted service chosen by the user.
3. After the user confirms or adjusts the authorization scope, the Auth Service issues a Capability Token.
4. The Session enters the `active` state, and the Token is delivered to the Agent.
5. The Agent accesses Memory Guard via the HTTP API with the Token.
6. Memory Guard validates the Token, filters data by scope, returns results, and records audit logs.
7. When the Agent task completes, times out, or the user revokes, the Session closes and the Token becomes invalid.

The Agent and UI/CLI are separate processes. The UI/CLI runs on the user's machine where the Memory Store / Guard lives, and is responsible for identity verification, authorization decisions, and Token delivery. The Agent only uses the Token to access data and never touches the user's private keys.

### 5.3 Profiles

UOMP defines two deployment profiles:

| Profile | Default Port | Transport | Authentication |
|---------|--------------|-----------|----------------|
| Local Profile | `127.0.0.1:9374` | HTTP | Capability Token |
| Remote Profile | User-configured | HTTPS | Capability Token + mTLS |

Local Profile is the default and RECOMMENDED configuration. Remote Profile MUST be explicitly enabled.

## 6. Agent Manifest: `uom.json`

### 6.1 Location

The Agent MUST provide a `uom.json` in the same directory as the executable or in the package root.

### 6.2 Format

```json
{
  "uomp_version": "1.0",
  "agent": {
    "id": "calendar_agent",
    "name": "Calendar Assistant",
    "version": "1.2.0",
    "description": "Helps manage your schedule",
    "publisher": "example-org"
  },
  "requested_scopes": {
    "read": {
      "tags": ["preference", "identity:public"],
      "keys": [],
      "description": "Read user preferences and public identity info"
    },
    "write": {
      "tags": ["preference"],
      "keys": [],
      "description": "Write schedule-related preferences"
    }
  },
  "required_capabilities": ["memory.read"],
  "optional_capabilities": ["memory.query"],
  "requires_remote": false,
  "identity": {
    "did": "did:ethr:0xabc123...",
    "verification_methods": ["did", "gpg", "x509"],
    "proof": {
      "type": "Ed25519Signature2020",
      "created": "2026-07-12T10:00:00Z",
      "proofValue": "..."
    }
  }
}
```

### 6.3 Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uomp_version` | string | MUST | Protocol version, currently `"1.0"`. |
| `agent.id` | string | MUST | Unique Agent identifier. |
| `agent.name` | string | MUST | Human-readable name. |
| `agent.version` | string | MUST | Semantic version. |
| `agent.description` | string | OPTIONAL | Function description. |
| `agent.publisher` | string | OPTIONAL | Publisher name. |
| `requested_scopes` | object | MUST | Default requested memory scope. |
| `required_capabilities` | string[] | OPTIONAL | List of required capabilities. |
| `optional_capabilities` | string[] | OPTIONAL | List of optional capabilities. |
| `requires_remote` | boolean | OPTIONAL | Whether remote connection is required, default `false`. |
| `identity` | object | OPTIONAL | Publisher identity verification information. |

### 6.4 Scope Object

The Scope Object is used in `requested_scopes.read` and `requested_scopes.write`:

```json
{
  "tags": ["preference"],
  "keys": ["user.display_name"],
  "deny_tags": ["financial"],
  "deny_keys": ["user.password"],
  "description": "Why this scope is needed"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tags` | string[] | MUST | List of tags requested for authorization. |
| `keys` | string[] | MUST | List of specific keys requested for authorization. |
| `deny_tags` | string[] | OPTIONAL | Explicitly denied tags. |
| `deny_keys` | string[] | OPTIONAL | Explicitly denied keys. |
| `description` | string | RECOMMENDED | Purpose description for the authorization panel. |

## 7. Capability Token

### 7.1 Format

The Capability Token uses JWT format and is signed by the Auth Service's private key.

```json
{
  "version": "1.0",
  "session_id": "sess_abc123",
  "agent_id": "calendar_agent",
  "issued_at": "2026-07-12T10:00:00Z",
  "expires_at": "2026-07-12T10:30:00Z",
  "scopes": {
    "read": {
      "tags": ["preference"],
      "keys": ["user.display_name"],
      "deny_tags": ["financial"],
      "deny_keys": []
    },
    "write": {
      "tags": [],
      "keys": [],
      "deny_tags": ["identity"],
      "deny_keys": []
    }
  },
  "limits": {
    "max_read_queries": 50,
    "max_write_queries": 10
  },
  "profile": "local",
  "audience": "http://127.0.0.1:9374",
  "allowed_endpoints": ["127.0.0.1"]
}
```

### 7.2 Claims

The UOMP Capability Token JWT payload uses the following custom claims (snake_case). The Auth Service MUST also set the standard JWT claims `iat` (issued at) and `exp` (expiration time); the Memory Guard MUST accept and validate both `exp` and `expires_at`.

| Claim | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | MUST | Token format version. |
| `session_id` | string | MUST | Bound Session. |
| `agent_id` | string | MUST | Agent identifier. |
| `issued_at` | ISO8601 | MUST | Issue time, consistent with standard `iat`. |
| `expires_at` | ISO8601 | MUST | Expiration time, consistent with standard `exp`. |
| `scopes` | object | MUST | Read/write authorization scope. |
| `limits` | object | OPTIONAL | Query count limits. Written but not enforced in MVP. |
| `profile` | string | OPTIONAL | `local` or `remote`, default `local`. |
| `audience` | string | OPTIONAL | Memory Guard endpoint bound to the Token. REQUIRED for Remote Profile. |
| `allowed_endpoints` | string[] | OPTIONAL | Network location whitelist for Token use. |

The JWT Header SHOULD include `alg` and `kid` to support key rotation and verification.

### 7.3 Validity

Upon receiving a Token, the Auth Service and Memory Guard MUST perform the following validations:

1. Token signature is valid.
2. Current time is before `expires_at` / standard `exp` claim.
3. The Session bound to the Token has not been closed or revoked (in the MVP this is implemented via a blacklist table; production implementations SHOULD explicitly query Session status).
4. Token is not in the blacklist.
5. `profile` matches the current deployment profile.
6. `audience` matches the current Memory Guard endpoint (REQUIRED for Remote Profile).

If any validation fails, Memory Guard MUST reject the request and return an error.

## 8. HTTP API

### 8.1 Base URL

- Local Profile: `http://127.0.0.1:9374`
- Remote Profile: User-configured HTTPS URL

### 8.2 Versioning

API paths include the major version:

```
/v1/sessions
/v1/memory/:key
```

### 8.3 Authentication

All Agent requests MUST include the Token in the HTTP header:

```http
Authorization: Bearer <capability-token>
```

### 8.4 Error Format

All error responses MUST use a unified format:

```json
{
  "error": {
    "code": "ACCESS_DENIED",
    "message": "Key is not within granted scope",
    "session_id": "sess_abc123"
  }
}
```

Common error codes:

| Error Code | Description |
|------------|-------------|
| `INVALID_TOKEN` | Invalid Token signature or format. |
| `TOKEN_EXPIRED` | Token has expired. |
| `SESSION_REVOKED` | Session has been revoked. |
| `ACCESS_DENIED` | Request exceeds authorized scope. |
| `QUOTA_EXCEEDED` | Query quota exhausted. |
| `WRITE_NOT_AVAILABLE` | Write interface not enabled in MVP. |
| `STORE_UNAVAILABLE` | Memory Store unavailable. |

## 9. Auth Service API

### 9.1 Create Session

```http
POST /v1/sessions
Content-Type: application/json
```

Request:

```json
{
  "agent_id": "calendar_agent",
  "agent_name": "Calendar Assistant",
  "requested_scopes": {
    "read": {
      "tags": ["preference", "identity:public"],
      "keys": []
    }
  },
  "duration_minutes": 30
}
```

Response:

```json
{
  "session_id": "sess_abc123",
  "status": "created",
  "agent_id": "calendar_agent",
  "requested_scopes": { ... },
  "expires_at": "2026-07-12T10:30:00Z"
}
```

### 9.2 Grant Session

```http
POST /v1/sessions/:id/grant
Content-Type: application/json
```

Request:

```json
{
  "granted_scopes": {
    "read": {
      "tags": ["preference"],
      "keys": ["user.display_name"]
    }
  }
}
```

Response:

```json
{
  "token": "<jwt-capability-token>",
  "token_type": "Bearer",
  "expires_at": "2026-07-12T10:30:00Z"
}
```

### 9.3 Close Session

```http
POST /v1/sessions/:id/close
```

Response:

```json
{
  "session_id": "sess_abc123",
  "status": "closed"
}
```

### 9.4 Revoke Session

```http
POST /v1/sessions/:id/revoke
```

Revoke MUST immediately invalidate the corresponding Token and add it to the persistent blacklist.

### 9.5 Validate Token

```http
POST /v1/tokens/validate
Content-Type: application/json
```

Request:

```json
{
  "token": "<jwt-capability-token>"
}
```

Response:

```json
{
  "valid": true,
  "session_id": "sess_abc123",
  "expires_at": "2026-07-12T10:30:00Z"
}
```

## 10. Memory Guard API

### 10.1 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/memory/:key` | Read by key |
| GET | `/v1/memory?tag=:tag` | Read by tag |
| POST | `/v1/memory/query` | Semantic query (not in MVP) |
| PUT | `/v1/memory/:key` | Write or update (MVP returns `WRITE_NOT_AVAILABLE`) |
| DELETE | `/v1/memory/:key` | Delete (MVP returns `WRITE_NOT_AVAILABLE`) |

### 10.2 Read by Key

```http
GET /v1/memory/preference.theme
Authorization: Bearer <token>
```

Response:

```json
{
  "key": "preference.theme",
  "value": "dark",
  "tags": ["preference", "ui"],
  "sensitivity": "low",
  "source": "user",
  "updated_at": "2026-07-12T10:00:00Z"
}
```

### 10.3 Read by Tag

```http
GET /v1/memory?tag=preference
Authorization: Bearer <token>
```

Response:

```json
{
  "items": [
    {
      "key": "preference.theme",
      "value": "dark",
      "tags": ["preference", "ui"],
      "sensitivity": "low"
    }
  ]
}
```

### 10.4 Access Control

Memory Guard MUST determine access permissions in the following order:

1. Token signature is valid.
2. Token has not expired (validate both the standard `exp` claim and `expires_at`).
3. The Session bound to the Token has not been closed or revoked (MVP uses a blacklist table).
4. Token is not in the blacklist.
5. Query quota has not been exhausted (reserved in MVP, not enforced).
6. Target Key or Tag is within the authorized scope for the action.
7. Target Key or Tag is not explicitly denied (`deny_keys` / `deny_tags` take precedence over allow lists).
8. `sensitivity=high` Memory Items cannot be accessed via tag authorization and MUST match `keys`.

For `GET /v1/memory?tag=:tag`, Guard MUST first validate that the tag itself is allowed; each returned Memory Item MUST then be filtered again using key-level rules (applying deny, keys, and sensitivity rules).

If any check fails, MUST return `ACCESS_DENIED` and record an audit log.

## 11. Memory Item

### 11.1 Format

```json
{
  "key": "preference.theme",
  "value": "dark",
  "tags": ["preference", "ui"],
  "sensitivity": "low",
  "source": "user",
  "created_at": "2026-07-01T10:00:00Z",
  "updated_at": "2026-07-12T10:00:00Z",
  "description": "User interface theme preference"
}
```

### 11.2 Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | MUST | Unique identifier, dot-separated namespace recommended. |
| `value` | any | MUST | Memory value. |
| `tags` | string[] | MUST | Tag list. |
| `sensitivity` | enum | MUST | `low`, `medium`, or `high`. |
| `source` | string | MUST | `user` or `agent`. |
| `created_at` | ISO8601 | MUST | Creation time. |
| `updated_at` | ISO8601 | MUST | Update time. |
| `description` | string | OPTIONAL | Human-readable description. |

### 11.3 Sensitivity Rules

- `sensitivity=high` Memory Items cannot be accessed via tag authorization.
- Agents MUST NOT write any Memory Items during the MVP phase.
- After Milestone 2 introduces Staging writes, Agent writes to high-sensitivity items MUST still be rejected.

## 12. Memory Import Format

### 12.1 Overview

UOMP defines not only how Agents access Memory, but also how users populate the Memory Store from external data sources. A standard import format allows data from CSV, JSON, database exports, and other sources to be mapped unambiguously to Memory Items.

### 12.2 Design Goals

- **Generality**: Not tied to any specific application domain.
- **Simplicity**: Ordinary users can import using CSV or JSON directly.
- **Extensibility**: Implementations may define field aliases and mapping rules.
- **Security**: The tag and sensitivity of imported data must be explicit.

### 12.3 Supported Input Formats

- **CSV**: UTF-8 encoded, first row is a header, comma-separated.
- **JSON**: A single object or an array of objects.

### 12.4 CSV Format Requirements

1. The file MUST be UTF-8 encoded.
2. The first row MUST be a header row.
3. The delimiter SHOULD be a comma; implementations MAY support other delimiters.
4. Field values containing the delimiter MUST be wrapped in double quotes.
5. Empty lines SHOULD be ignored.
6. Numeric fields SHOULD NOT contain currency symbols or thousand separators; implementations MAY clean them automatically.
7. Date fields SHOULD be ISO8601; implementations MAY recognize common formats and convert them.

### 12.5 JSON Format Requirements

1. The root node MAY be a single object or an array of objects.
2. Each object MAY contain:
   - `key` (string)
   - `value` (object)
   - `tags` (string or string array)
   - `sensitivity` (`low` | `medium` | `high`)
   - `source` (string)
   - `description` (string)
   - `created_at` / `updated_at` (ISO8601)

If `value` is omitted, all non-reserved top-level fields are treated as `value.*`.

### 12.6 Reserved Fields

The following top-level fields have protocol meaning and are NOT part of `value`:

- `key`
- `tags`
- `sensitivity`
- `source`
- `description`
- `created_at`
- `updated_at`

All other top-level fields belong to `value`.

### 12.7 Field Mapping

Implementations SHOULD support canonical field aliases:

| Memory Item Field | Canonical Aliases |
|-------------------|-------------------|
| `key` | `key`, `id`, `item_id`, `record_id` |
| `tags` | `tags`, `tag` |
| `sensitivity` | `sensitivity`, `level` |
| `source` | `source`, `origin` |
| `description` | `description`, `desc` |
| `created_at` | `created_at`, `created` |
| `updated_at` | `updated_at`, `updated` |

Implementations MAY support locale-specific aliases (e.g., Chinese names) and user-defined mappings via `--map` or equivalent configuration.

### 12.8 Sensitivity

Imported data MUST have an explicit sensitivity. If the input does not specify sensitivity, the import tool MUST either:

1. Require the user to specify it via CLI/GUI, or
2. Refuse the import.

Implementations MAY provide application-specific default sensitivity based on tag, but such defaults MUST be clearly communicated to the user.

### 12.9 Validation

Before writing to the Memory Store, the import tool MUST validate:

1. `key` is present and non-empty for every record.
2. `key` is unique within the target tag (unless `--replace` is specified).
3. `sensitivity` is one of `low`, `medium`, `high`.
4. `tags` is non-empty.
5. `created_at` and `updated_at`, if present, are valid ISO8601 timestamps.

### 12.10 Examples

#### CSV Example

```csv
key,tags,sensitivity,value.title,value.content
note-1,notes,low,Shopping list,Buy milk
contact-1,contacts,medium,Alice,alice@example.com
```

#### JSON Example

```json
[
  {
    "key": "note-1",
    "tags": ["notes"],
    "sensitivity": "low",
    "value": {
      "title": "Shopping list",
      "content": "Buy milk"
    }
  },
  {
    "key": "contact-1",
    "tags": ["contacts"],
    "sensitivity": "medium",
    "value": {
      "name": "Alice",
      "email": "alice@example.com"
    }
  }
]
```

## 13. Session

### 13.1 States

```
[created] --grant--> [active] --close/timeout/revoke--> [closed/expired/revoked]
```

### 13.2 Fields

```json
{
  "session_id": "sess_abc123",
  "agent_id": "calendar_agent",
  "status": "active",
  "created_at": "2026-07-12T10:00:00Z",
  "expires_at": "2026-07-12T10:30:00Z",
  "closed_at": null,
  "granted_scopes": { ... },
  "token_hash": "sha256:..."
}
```

### 13.3 Multi-Session Support

UOMP MUST support multiple independent Sessions existing simultaneously. Each Session has its own Token and lifecycle. Access from different Sessions MUST be audited independently.

### 13.4 Real-Time Revocation

After a Session is revoked, the corresponding Token MUST become invalid immediately. The Auth Service MUST add the Token to the persistent blacklist, and Memory Guard MUST check the blacklist on every request.

## 14. Local Profile

### 14.1 Requirements

- Memory Guard MUST listen on `127.0.0.1:9374` by default.
- Memory Guard MUST NOT bind to `0.0.0.0` or public interfaces by default.
- The Token's `profile` claim MUST be `"local"` under Local Profile.

### 14.2 Token Delivery

In the Local Profile, the Token is issued by the Auth Service / CLI on the user's machine and injected into the Agent process via environment variables:

```bash
export UOM_TOKEN="<capability-token>"
export UOMP_BASE_URL="http://127.0.0.1:9374"
uom-calendar-agent
```

- `UOM_TOKEN`: The Capability Token the Agent uses to access Guard.
- `UOMP_BASE_URL`: The Guard endpoint address, defaulting to `http://127.0.0.1:9374` in Local Profile.

The user UI (e.g. CLI) runs on the same host as the Memory Store / Guard, performs identity verification and authorization, issues the Token, and only then hands the Token to the Agent. The Agent itself does not participate in authorization decisions.

## 15. Remote Profile

### 15.1 Overview

Remote Profile allows Agents not running on the user's machine to access user memory. To protect the local Memory Guard, UOMP introduces the **UOMP Gateway** as the controlled entry point: the Memory Guard MUST NOT be directly exposed to the public internet, and all remote access MUST go through a user-deployed or user-trusted Gateway.

### 15.2 Security Requirements

Remote Profile implementations MUST satisfy:

1. Gateway and remote Agent MUST use **TLS 1.3**.
2. Gateway SHOULD use **mTLS**, with the remote Agent holding a client certificate issued by the user or Registry.
3. Capability Tokens issued by the local Auth Service:
   - `profile` claim MUST be `"remote"`;
   - `audience` claim MUST be bound to the Gateway endpoint, not to local `127.0.0.1`;
   - `allowed_endpoints` claim SHOULD restrict allowed Gateway network locations.
4. Gateway MUST validate Token signature, lifetime, `audience`, Session revocation status, and request path.
5. Token lifetime SHOULD not exceed 10 minutes; Agents that need long-running access SHOULD use refresh tokens (see 15.5).
6. The user MUST explicitly enable Remote Profile and confirm the Gateway configuration.
7. Communication between Gateway and local Memory Guard SHOULD use mTLS or a local Unix socket.

### 15.3 Deployment Models

Remote Profile defaults to **user self-hosted Gateway**:

- Users run Gateway on their own VPS, NAS, cloud server, or home server;
- Users MAY expose Gateway via reverse tunnel (e.g., Cloudflare Tunnel, ngrok) without a public IP;
- A third-party MAY offer managed Gateway services, but open-source core implementations MUST retain self-hosting as the default and trust root.

### 15.4 UOMP Gateway

Gateway acts as a proxy for Memory Guard with the following responsibilities:

| Responsibility | Description |
|----------------|-------------|
| TLS/mTLS termination | Verify the transport-layer identity of the remote Agent |
| Token validation | Validate Capability Token signature, scope, lifetime, revocation status |
| Request forwarding | Forward validated requests to the local Memory Guard |
| Quota enforcement | Enforce request limits according to Token `limits` |
| Audit logging | Record `gateway_access` events |
| Payload caching | Temporarily store encrypted Agent output (optional) |

Gateway HTTP API SHOULD at least include:

```http
GET  /v1/health
POST /v1/sessions/{session_id}/refresh
GET  /v1/memory/{key}
GET  /v1/memory?tag={tag}
POST /v1/payload/upload
GET  /v1/payload/{payload_id}
```

All requests MUST carry:

```http
Authorization: Bearer <gateway-token>
X-UOMP-Agent-Id: <agent_id>
```

> **Implementation reference**: `uomp-mvp` provides a default mTLS Gateway reference implementation in `apps/gateway`, plus `scripts/generate-gateway-certs.sh` and `scripts/test-gateway-remote.sh` for local validation.

### 15.5 Token Refresh

Remote Agents may need to refresh Tokens due to long-running tasks or SaaS restarts:

1. During initial authorization, the Auth Service issues both a short-lived `access_token` and a `refresh_token`:
   - The refresh_token can only be used to obtain a new access_token, not to read Memory;
   - The refresh_token's `scopes` claim MUST be empty or contain only `refresh`;
   - Lifetime is configurable, default 7 days.
2. Before the access_token expires, the Agent calls the Gateway:
   ```http
   POST /v1/sessions/{session_id}/refresh
   Authorization: Bearer <refresh_token>
   ```
3. Gateway validates the refresh_token and Session status, then requests a new access_token from the local Auth Service and returns it.
4. When the user revokes the Session, the refresh_token MUST become invalid simultaneously.

### 15.6 Payload Delivery

Agent-generated reports and analysis results MUST NOT remain as plaintext on remote servers. Remote Profile requires:

1. **End-to-end encryption**: The Agent encrypts the Payload using the public key provided in the Remote Profile (RECOMMENDED: ECDH-X25519 + AES-256-GCM).
2. **Payload Envelope**: Uploaded Payloads MUST use the following format:
   ```json
   {
     "payload_id": "pay_xxx",
     "session_id": "sess_xxx",
     "agent_id": "stock-analyst",
     "timestamp": "2026-07-14T10:15:00Z",
     "encryption": {
       "algorithm": "ECDH-X25519-AES256GCM",
       "sender_public_key": "...",
       "nonce": "..."
     },
     "ciphertext": "base64...",
     "format": "text/markdown",
     "size": 2048,
     "hash": "sha256:..."
   }
   ```
3. **Relay modes** for encrypted Payload:
   - `gateway-cache`: Agent POSTs to Gateway; user pulls from Gateway;
   - `presigned-url`: Gateway gives Agent a one-time upload URL; Agent uploads and returns the reference;
   - `ipfs-cid`: Ciphertext on IPFS; CID + hash anchored on-chain.

The user's local private key SHOULD be protected by a keystore or system keychain.

### 15.7 Migration to DIDComm

UOMP plans to migrate from mTLS HTTPS to **DIDComm v2** for authorization negotiation and Token delivery in the long term. In MVP, mTLS HTTPS is the default channel, and DIDComm is an optional extension.

Migration strategy:

1. Phase 1: Agents declare an mTLS endpoint; DIDComm is optional.
2. Phase 2: Agents declare both mTLS and DIDComm service endpoints; user clients prefer DIDComm.
3. Phase 3: New Agents MAY support only DIDComm; legacy Agents continue to work through an mTLS adapter.

Reserved DIDComm message types:

- `uomp/authorize-request`
- `uomp/authorize-response`
- `uomp/payload-ready`
- `uomp/session-revoked`

## 16. Agent Identity Verification

### 16.1 Overview

UOMP supports multiple Agent publisher identity verification mechanisms. Identity verification is performed by the **UI/CLI on the user's machine**; the Agent process itself does not perform identity verification and must not have access to user private keys or authorization decisions.

### 16.2 Supported Methods

| Method | Description |
|--------|-------------|
| DID | Decentralized identifier, e.g., `did:ethr`, `did:web`. |
| GPG | Publisher signs `uom.json` with a GPG key. |
| X.509 | Publisher signs with a CA-issued certificate. |
| Registry | Verification status provided by registries such as ERC8004. |

### 16.3 Verification Process

1. The UI/CLI on the user's machine reads the `identity` field in `uom.json`.
2. Select the verification method according to `verification_methods`.
3. Verify the signature or proof of `uom.json`.
4. Present the result to the user; only after user confirmation may a Session be created and a Token issued.

### 16.4 Trust Policy

- Users MAY configure a trust list: trusted DIDs, GPG Key IDs, CAs, Registries.
- Agents that fail identity verification MAY be allowed to run, but the authorization panel on the user's machine MUST prompt "unverified publisher".
- Enterprise deployments MAY mandate specific verification methods; Agents that fail verification MUST NOT receive a Token.

## 17. Agent Registry

### 17.1 Overview

UOMP core protocol does not define an Agent Registry. Protocol reference implementations MAY support existing registry standards such as ERC8004.

### 17.2 Registry Client

The MVP reference implementation SHOULD provide the following CLI commands:

```bash
uom registry search <keyword>
uom registry install <agent_id>
```

Registry clients MUST return Agent metadata and `uom.json` location but MUST NOT participate in authorization decisions.

### 17.3 Registry Independence

- Users MUST be able to install and run Agents without using a Registry.
- Authorization decisions MUST always be made locally by the user.

## 18. Audit and Logging

### 18.1 Audit Log Entry

```json
{
  "id": "log_xxx",
  "timestamp": "2026-07-12T10:05:00Z",
  "session_id": "sess_abc123",
  "agent_id": "calendar_agent",
  "action": "read",
  "key": "preference.theme",
  "tags": ["preference", "ui"],
  "allowed": true,
  "reason": "scope matched",
  "request_size": 0,
  "response_size": 12,
  "query_count_remaining": 49
}
```

### 18.2 Required Fields

Each audit log MUST contain:

- `timestamp`
- `session_id`
- `agent_id`
- `action`
- `key` or `tag`
- `allowed`
- `reason`

### 18.3 Storage

- Audit logs MUST be stored separately from the Memory Store.
- Audit log retention MUST be configurable, default 90 days.
- Audit logs SHOULD be encrypted to prevent Agent tampering.

### 18.4 Blockchain Extension

UOMP MAY anchor summaries of key audit events to a blockchain for immutable audit proof. The protocol itself does not mandate a specific chain, but Starknet is RECOMMENDED as the default (low cost, high-frequency events), with EVM-compatible chains as an option.

#### 18.4.1 Event Types

```solidity
event SessionGranted(
  bytes32 indexed sessionHash,
  bytes32 indexed agentHash,
  uint256 expiresAt
);

event SessionRevoked(
  bytes32 indexed sessionHash,
  bytes32 indexed agentHash
);

event GatewayAccess(
  bytes32 indexed sessionHash,
  bytes32 indexed agentHash,
  bytes32 endpointHash,
  bool allowed
);

event PayloadAnchored(
  bytes32 indexed payloadHash,
  bytes32 indexed sessionHash,
  bytes32 agentHash
);
```

Hash computation:

- `sessionHash` = `keccak256(session_id || agent_id || granted_tags_json)`
- `agentHash` = `keccak256(agent_id)`
- `endpointHash` = `keccak256(request_path)`
- `payloadHash` = `sha256(ciphertext)`

On-chain events MUST NOT contain specific Memory keys/values or Payload plaintext.

#### 18.4.2 Batching Strategy

- **Authorization events** (`SessionGranted`, `SessionRevoked`): low volume and high criticality, SHOULD be anchored near real-time.
- **Access events** (`GatewayAccess`): high volume, SHOULD be batched. Gateway aggregates events into a Merkle tree every N minutes or every M events, anchors the `merkleRoot` on-chain, and keeps the full log locally for later verification.
- **Payload anchoring**: each Payload SHOULD have its hash anchored individually after generation.

```
Local events ──► Batch aggregation ──► Merkle root ──► On-chain event
                          │
                          └── Full log retained at Gateway for audit verification
```

## 19. Security Considerations

### 19.1 Token Security

- Capability Tokens MUST be signed by the Auth Service's private key.
- Tokens SHOULD use short lifetimes (default 30 minutes, 10 minutes for Remote Profile).
- Tokens MUST NOT be persisted to locations freely accessible by the Agent.

### 19.2 Memory Store Security

- Memory Store SHOULD be encrypted.
- High-sensitivity data SHOULD be additionally encrypted.

### 19.3 Communication Security

- Local Profile uses HTTP over localhost.
- Remote Profile MUST use TLS 1.3 + mTLS.
- SDKs MUST NOT log Tokens.

### 19.4 Agent Write Restrictions

- Agents MUST NOT write Memory during the MVP phase.
- After Milestone 2 introduces Staging writes, Agent writes MUST be confirmed by the user before taking effect.
- Agents MUST NOT write `sensitivity=high` Memory Items.

## 20. Privacy Considerations

- UOMP aims to minimize the scope of data accessed by Agents.
- Users SHOULD be able to view and revoke any active Session.
- Audit logs SHOULD help users understand what data Agents accessed.
- Memory Guard SHOULD avoid returning any data outside the authorized scope, including existence information.

## 21. Future Work

- Agent write staging.
- Semantic retrieval (`query` endpoint).
- Write version history and rollback.
- Policy templates.
- DIDComm v2 authorization channel.
- Decentralized Payload Relay (IPFS, etc.).

## 22. References

- [RFC 2119] Key words for use in RFCs to Indicate Requirement Levels
- [RFC 7519] JSON Web Token (JWT)
- [RFC 8446] The Transport Layer Security (TLS) Protocol Version 1.3
- [ERC8004] Agent Registry on Blockchain

---

## Appendix A: Minimal Interaction Example

```bash
# 1. Discover an Agent (via ERC8004 Registry or locally)
uom registry search calendar

# 2. Install Agent
uom registry install calendar_agent

# 3. Create Session on the user side
curl -X POST http://127.0.0.1:9374/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "calendar_agent",
    "agent_name": "Calendar Assistant",
    "requested_scopes": {
      "read": { "tags": ["preference"], "keys": [] }
    },
    "duration_minutes": 30
  }'

# 4. User grants authorization
curl -X POST http://127.0.0.1:9374/v1/sessions/sess_abc123/grant \
  -H "Content-Type: application/json" \
  -d '{
    "granted_scopes": {
      "read": { "tags": ["preference"], "keys": [] }
    }
  }'

# 5. Run Agent with Token
export UOM_TOKEN="<token>"
uom-calendar-agent

# 6. Agent reads memory internally
# const memory = new UserMemory({ token: process.env.UOM_TOKEN });
# const theme = await memory.get<string>('preference.theme');

# 7. Close Session
curl -X POST http://127.0.0.1:9374/v1/sessions/sess_abc123/close
```

---

## Appendix B: Complete `uom.json` Example

```json
{
  "uomp_version": "1.0",
  "agent": {
    "id": "calendar_agent",
    "name": "Calendar Assistant",
    "version": "1.2.0",
    "description": "Helps manage your schedule and todos",
    "publisher": "example-org"
  },
  "requested_scopes": {
    "read": {
      "tags": ["preference", "identity:public"],
      "keys": [],
      "description": "Read user preferences and public identity info for personalized schedule suggestions"
    },
    "write": {
      "tags": ["preference"],
      "keys": [],
      "description": "Write schedule-related preferences"
    }
  },
  "required_capabilities": ["memory.read"],
  "optional_capabilities": ["memory.query"],
  "requires_remote": false,
  "identity": {
    "did": "did:ethr:0xabc123...",
    "verification_methods": ["did", "gpg"],
    "proof": {
      "type": "Ed25519Signature2020",
      "created": "2026-07-12T10:00:00Z",
      "proofValue": "..."
    }
  }
}
```
