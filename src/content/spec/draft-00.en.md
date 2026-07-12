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

<div class="diagram">
  <svg viewBox="0 0 720 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="UOMP architecture diagram">
    <defs>
      <marker id="arrowhead-spec-en" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" />
      </marker>
    </defs>
    <rect x="260" y="20" width="440" height="220" rx="12" fill="#12121a" stroke="#2a2a3a" stroke-width="2" />
    <text x="480" y="45" text-anchor="middle" fill="#a1a1aa" font-size="12" font-family="system-ui, sans-serif">User Host</text>

    <rect x="20" y="100" width="110" height="60" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="75" y="135" text-anchor="middle" fill="#e4e4e7" font-size="13" font-family="system-ui, sans-serif">Agent</text>

    <rect x="300" y="60" width="120" height="44" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="360" y="87" text-anchor="middle" fill="#e4e4e7" font-size="13" font-family="system-ui, sans-serif">User UI / CLI</text>

    <rect x="560" y="60" width="120" height="44" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="620" y="87" text-anchor="middle" fill="#e4e4e7" font-size="13" font-family="system-ui, sans-serif">Auth Service</text>

    <rect x="300" y="170" width="120" height="44" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="360" y="197" text-anchor="middle" fill="#e4e4e7" font-size="13" font-family="system-ui, sans-serif">Memory Guard</text>

    <rect x="560" y="170" width="120" height="44" rx="8" fill="#0a0a0f" stroke="#22d3ee" stroke-width="2" />
    <text x="620" y="197" text-anchor="middle" fill="#e4e4e7" font-size="13" font-family="system-ui, sans-serif">Memory Store</text>

    <line x1="420" y1="82" x2="560" y2="82" stroke="#22d3ee" stroke-width="2" marker-end="url(#arrowhead-spec-en)" />
    <text x="490" y="75" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">create / grant / revoke</text>

    <line x1="560" y1="104" x2="300" y2="170" stroke="#22d3ee" stroke-width="2" marker-end="url(#arrowhead-spec-en)" />
    <text x="470" y="155" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">Capability Token</text>

    <line x1="130" y1="130" x2="300" y2="192" stroke="#22d3ee" stroke-width="2" marker-end="url(#arrowhead-spec-en)" />
    <text x="210" y="185" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">HTTP + Authorization</text>

    <line x1="420" y1="192" x2="560" y2="192" stroke="#22d3ee" stroke-width="2" marker-end="url(#arrowhead-spec-en)" />
    <text x="490" y="215" text-anchor="middle" fill="#a1a1aa" font-size="10" font-family="system-ui, sans-serif">read / write (filtered)</text>
  </svg>
</div>

### 5.2 Flow

1. The Agent runs as an independent process and provides a `uom.json` declaring its identity and default requested memory scope.
2. The user discovers or connects to the Agent through the local UI/CLI, and the Auth Service creates a Session in the `created` state.
3. After the user confirms or adjusts the authorization scope, the Auth Service issues a Capability Token.
4. The Session enters the `active` state, and the Token is delivered to the Agent.
5. The Agent accesses Memory Guard via the HTTP API with the Token.
6. Memory Guard validates the Token, filters data by scope, returns results, and records audit logs.
7. When the Agent task completes, times out, or the user revokes, the Session closes and the Token becomes invalid.

The Agent and UI/CLI are separate processes. The UI/CLI runs on the user's machine where the Memory Store / Guard lives, and is responsible for identity verification, authorization decisions, and Token issuance. The Agent only uses the Token to access data.

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

## 12. Session

### 12.1 States

```
[created] --grant--> [active] --close/timeout/revoke--> [closed/expired/revoked]
```

### 12.2 Fields

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

### 12.3 Multi-Session Support

UOMP MUST support multiple independent Sessions existing simultaneously. Each Session has its own Token and lifecycle. Access from different Sessions MUST be audited independently.

### 12.4 Real-Time Revocation

After a Session is revoked, the corresponding Token MUST become invalid immediately. The Auth Service MUST add the Token to the persistent blacklist, and Memory Guard MUST check the blacklist on every request.

## 13. Local Profile

### 13.1 Requirements

- Memory Guard MUST listen on `127.0.0.1:9374` by default.
- Memory Guard MUST NOT bind to `0.0.0.0` or public interfaces by default.
- The Token's `profile` claim MUST be `"local"` under Local Profile.

### 13.2 Token Delivery

In the Local Profile, the Token is issued by the Auth Service / CLI on the user's machine and injected into the Agent process via environment variables:

```bash
export UOM_TOKEN="<capability-token>"
export UOMP_BASE_URL="http://127.0.0.1:9374"
uom-calendar-agent
```

- `UOM_TOKEN`: The Capability Token the Agent uses to access Guard.
- `UOMP_BASE_URL`: The Guard endpoint address, defaulting to `http://127.0.0.1:9374` in Local Profile.

The user UI (e.g. CLI) runs on the same host as the Memory Store / Guard, performs identity verification and authorization, issues the Token, and only then hands the Token to the Agent. The Agent itself does not participate in authorization decisions.

## 14. Remote Profile

### 14.1 Overview

Remote Profile allows Agents not running on the user's machine to access Memory Guard. UOMP defines security requirements but does not mandate a specific connection mode.

### 14.2 Security Requirements

Remote Profile implementations MUST satisfy:

1. Use TLS 1.3.
2. Use mTLS, with the remote Agent holding a client certificate issued by the user.
3. The Capability Token's `profile` claim is `"remote"`.
4. The Token includes an `audience` claim bound to the specific Memory Guard endpoint.
5. Token lifetime SHOULD not exceed 10 minutes.
6. The user MUST explicitly enable Remote Profile.

### 14.3 Connection Modes

Remote Profile supports but is not limited to the following modes:

- User self-hosted gateway
- Reverse tunnel
- P2P encrypted connection

Specific modes are chosen by the implementation; the protocol does not mandate them.

## 15. Agent Identity Verification

### 15.1 Overview

UOMP supports multiple Agent publisher identity verification mechanisms. Identity verification is performed by the **UI/CLI on the user's machine**; the Agent process itself does not perform identity verification and must not have access to user private keys or authorization decisions.

### 15.2 Supported Methods

| Method | Description |
|--------|-------------|
| DID | Decentralized identifier, e.g., `did:ethr`, `did:web`. |
| GPG | Publisher signs `uom.json` with a GPG key. |
| X.509 | Publisher signs with a CA-issued certificate. |
| Registry | Verification status provided by registries such as ERC8004. |

### 15.3 Verification Process

1. The UI/CLI on the user's machine reads the `identity` field in `uom.json`.
2. Select the verification method according to `verification_methods`.
3. Verify the signature or proof of `uom.json`.
4. Present the result to the user; only after user confirmation may a Session be created and a Token issued.

### 15.4 Trust Policy

- Users MAY configure a trust list: trusted DIDs, GPG Key IDs, CAs, Registries.
- Agents that fail identity verification MAY be allowed to run, but the authorization panel on the user's machine MUST prompt "unverified publisher".
- Enterprise deployments MAY mandate specific verification methods; Agents that fail verification MUST NOT receive a Token.

## 16. Agent Registry

### 16.1 Overview

UOMP core protocol does not define an Agent Registry. Protocol reference implementations MAY support existing registry standards such as ERC8004.

### 16.2 Registry Client

The MVP reference implementation SHOULD provide the following CLI commands:

```bash
uom registry search <keyword>
uom registry install <agent_id>
```

Registry clients MUST return Agent metadata and `uom.json` location but MUST NOT participate in authorization decisions.

### 16.3 Registry Independence

- Users MUST be able to install and run Agents without using a Registry.
- Authorization decisions MUST always be made locally by the user.

## 17. Audit and Logging

### 17.1 Audit Log Entry

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

### 17.2 Required Fields

Each audit log MUST contain:

- `timestamp`
- `session_id`
- `agent_id`
- `action`
- `key` or `tag`
- `allowed`
- `reason`

### 17.3 Storage

- Audit logs MUST be stored separately from the Memory Store.
- Audit log retention MUST be configurable, default 90 days.
- Audit logs SHOULD be encrypted to prevent Agent tampering.

### 17.4 Blockchain Extension

Future extensions MAY anchor authorization and access event summaries to a blockchain for immutable audit proof. The protocol itself does not mandate a specific chain.

## 18. Security Considerations

### 18.1 Token Security

- Capability Tokens MUST be signed by the Auth Service's private key.
- Tokens SHOULD use short lifetimes (default 30 minutes, 10 minutes for Remote Profile).
- Tokens MUST NOT be persisted to locations freely accessible by the Agent.

### 18.2 Memory Store Security

- Memory Store SHOULD be encrypted.
- High-sensitivity data SHOULD be additionally encrypted.

### 18.3 Communication Security

- Local Profile uses HTTP over localhost.
- Remote Profile MUST use TLS 1.3 + mTLS.
- SDKs MUST NOT log Tokens.

### 18.4 Agent Write Restrictions

- Agents MUST NOT write Memory during the MVP phase.
- After Milestone 2 introduces Staging writes, Agent writes MUST be confirmed by the user before taking effect.
- Agents MUST NOT write `sensitivity=high` Memory Items.

## 19. Privacy Considerations

- UOMP aims to minimize the scope of data accessed by Agents.
- Users SHOULD be able to view and revoke any active Session.
- Audit logs SHOULD help users understand what data Agents accessed.
- Memory Guard SHOULD avoid returning any data outside the authorized scope, including existence information.

## 20. Future Work

- Agent write Staging mechanism.
- Semantic retrieval (`query` endpoint).
- Write version history and rollback.
- Policy templates.
- Remote Profile reference implementation.
- Blockchain audit anchoring.

## 21. References

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
