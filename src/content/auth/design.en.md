---
title: 'UOMP Authentication & Authorization Design'
description: 'UOMP Agent authentication, Capability Token, and Memory Guard authorization'
---

# UOMP Authentication & Authorization Design

UOMP authentication and authorization is split into three layers: **Agent Declaration → User Authorization → Token Enforcement**. Agents never hold user credentials; they access authorized data through a short-lived session token (Capability Token).

---

## 1. Agent Declares Requested Scopes (`uom.json`)

An Agent has no inherent permissions. It must declare what it wants to access in `uom.json`:

```json
{
  "uomp_version": "1.0",
  "agent": {
    "id": "calendar_agent",
    "name": "Calendar Assistant"
  },
  "requested_scopes": {
    "read": {
      "tags": ["preference"],
      "keys": [],
      "deny_tags": ["private"],
      "deny_keys": []
    },
    "write": {
      "tags": [],
      "keys": [],
      "deny_tags": [],
      "deny_keys": []
    }
  },
  "required_capabilities": ["memory.read"]
}
```

Field descriptions:

- `tags`: request access by tag, e.g. `preference`.
- `keys`: request access by specific key, e.g. `preference.theme`.
- `deny_tags` / `deny_keys`: explicitly exclude scopes.
- `required_capabilities`: declare required capability types.

---

## 2. User Authorization (CLI `uomp run`)

The user decides whether and how much to grant via CLI:

```bash
uomp run ./examples/calendar-agent
```

CLI flow:

1. Read and parse `uom.json`.
2. Verify Agent identity (optional, see Section 6).
3. Interactively ask the user which tags to authorize.
4. Create a session.
5. Grant the session and issue a JWT Capability Token.
6. Start the local Guard service.
7. Inject `UOM_TOKEN` and `UOMP_BASE_URL` into the Agent process environment.

Example output:

```
Agent "Calendar Assistant" requests access to:
Description: A simple calendar assistant that reads user preferences
? Select tags to authorize for reading:
❯◉ preference

Session granted: sess_xxxxxxxx
Token expires at: 2026-07-12T17:26:21.174Z
UOMP server listening on http://127.0.0.1:9374
Starting agent: ./examples/calendar-agent/index.js
```

---

## 3. Session & Capability Token

AuthService maintains the session lifecycle:

```
created → active → closed / expired / revoked
```

Core endpoints:

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/sessions` | Create a session, record `requested_scopes` |
| `POST /v1/sessions/:id/grant` | Issue a JWT after user grants scopes |
| `POST /v1/sessions/:id/close` | Close a session |
| `POST /v1/sessions/:id/revoke` | Revoke a session |
| `POST /v1/tokens/validate` | Validate whether a token is still valid |

The token is a **JWT EdDSA** token. Example payload:

```ts
{
  version: '1.0',
  sessionId: 'sess_xxx',
  agentId: 'calendar-agent',
  issuedAt: '...',
  expiresAt: '...',
  scopes: {
    read: {
      tags: ['preference'],
      keys: [],
      denyTags: ['private'],
      denyKeys: []
    },
    write: {
      tags: [], keys: [], denyTags: [], denyKeys: []
    }
  },
  profile: 'local',
  audience: 'http://127.0.0.1:9374',
  limits: {
    maxReadQueries: 100,
    maxWriteQueries: 0
  }
}
```

In the MVP, tokens expire after 30 minutes by default.

---

## 4. Guard Validation & Enforcement

Every request to Guard must include:

```http
Authorization: Bearer <UOM_TOKEN>
```

Guard processing:

1. **Validate token**: verify signature, check expiry, ensure not revoked.
2. **Scope check**:
   - `GET /v1/memory/:key` → `isKeyAllowed`
   - `GET /v1/memory?tag=xxx` → `isTagAllowed`
3. **Enforcement rules**:
   - If key/tag is in `denyKeys` / `denyTags` → **deny**.
   - If key is in `keys` → **allow**.
   - If any item tag is in `tags` and not in `denyTags` → **allow**.
   - `sensitivity: high` items require explicit `keys` authorization.
4. **Writes**: MVP returns `503 WRITE_NOT_AVAILABLE`.
5. **Audit**: every access is logged to `audit_logs`.

---

## 5. How Agents Use the Token

Agents read the token from environment variables and call Guard APIs:

```js
const token = process.env.UOM_TOKEN;
const baseUrl = process.env.UOMP_BASE_URL || 'http://127.0.0.1:9374';

const memory = new UserMemory({ token, baseUrl });
const theme = await memory.get('preference.theme');
const prefs = await memory.getByTag('preference');
```

The SDK automatically adds `Authorization: Bearer <token>` to every request.

---

## 6. Identity Verification (Optional)

UOMP supports two optional Agent identity verification methods:

- **DID**: `did:ethr` / `did:web`, verified via a DID Resolver.
- **GPG**: verified via Agent public key signature.

Identity verification is **not mandatory** in the MVP. If `uom.json` has no `identity` field, the CLI prints a yellow warning but the Agent can still run. This lowers the barrier for examples and development.

---

## 7. Design Summary

| Layer | Mechanism |
|-------|-----------|
| **Authentication** | Agent proves itself via `UOM_TOKEN` (JWT). |
| **Authorization** | User explicitly authorizes tags/keys through CLI; writes are disabled by default. |
| **Least privilege** | Token contains only authorized tags/keys and supports deny lists. |
| **Short-lived** | Default 30 minutes; supports revoke/close. |
| **Audit** | Guard logs every access to `audit_logs`. |
| **Local-first** | User data lives in local SQLite; tokens are issued locally. |
