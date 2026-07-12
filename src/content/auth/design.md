---
title: 'UOMP 认证与授权设计'
description: 'UOMP Agent 认证、Capability Token 与 Memory Guard 鉴权机制'
---

# UOMP 认证与授权设计

UOMP 的认证/授权分为三层：**Agent 声明 → 用户授权 → Token 鉴权**。Agent 本身不持有用户密码，而是通过一个短时会话令牌（Capability Token）访问被授权的数据。

---

## 1. Agent 声明请求范围（`uom.json`）

Agent 不自带权限，它必须在 `uom.json` 里声明自己想访问的范围：

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

字段说明：

- `tags`：按标签批量请求，例如 `preference`。
- `keys`：按具体 key 请求，例如 `preference.theme`。
- `deny_tags` / `deny_keys`：显式排除某些范围。
- `required_capabilities`：声明需要的能力类型。

---

## 2. 用户授权（CLI `uomp run`）

用户通过 CLI 决定是否以及授予哪些范围：

```bash
uomp run ./examples/calendar-agent
```

CLI 内部流程：

1. 读取并解析 `uom.json`。
2. 验证 Agent 身份（可选，见第 6 节）。
3. 交互式询问用户授权哪些 tag。
4. 创建 Session。
5. 授权 Session 并签发 JWT Capability Token。
6. 启动本地 Guard 服务。
7. 把 `UOM_TOKEN` 和 `UOMP_BASE_URL` 注入 Agent 进程的环境变量。

示例输出：

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

## 3. 会话与 Capability Token

AuthService 维护会话生命周期：

```
created → active → closed / expired / revoked
```

核心端点：

| 端点 | 作用 |
|------|------|
| `POST /v1/sessions` | 创建会话，记录 `requested_scopes` |
| `POST /v1/sessions/:id/grant` | 用户授权后签发 JWT |
| `POST /v1/sessions/:id/close` | 关闭会话 |
| `POST /v1/sessions/:id/revoke` | 撤销会话 |
| `POST /v1/tokens/validate` | 验证 token 是否有效 |

Token 是 **JWT EdDSA**，内容示例：

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

MVP 中 token 默认有效期 30 分钟。

---

## 4. Guard 验证与鉴权

Agent 每次请求 Guard 都必须携带：

```http
Authorization: Bearer <UOM_TOKEN>
```

Guard 的处理流程：

1. **校验 Token**：验证签名、检查过期时间、确认未被吊销。
2. **按作用域判断**：
   - `GET /v1/memory/:key` → `isKeyAllowed`
   - `GET /v1/memory?tag=xxx` → `isTagAllowed`
3. **鉴权规则**：
   - 如果 key/tag 在 `denyKeys` / `denyTags` 中 → **拒绝**。
   - 如果 key 在 `keys` 中 → **允许**。
   - 如果 item 的任意 tag 在 `tags` 中，且不在 `denyTags` 中 → **允许**。
   - `sensitivity: high` 的数据必须显式通过 `keys` 授权。
4. **写操作**：MVP 直接返回 `503 WRITE_NOT_AVAILABLE`。
5. **审计**：每次访问记录到 `audit_logs`。

---

## 5. Agent 怎么使用 Token

Agent 从环境变量读取 token，然后调用 Guard API：

```js
const token = process.env.UOM_TOKEN;
const baseUrl = process.env.UOMP_BASE_URL || 'http://127.0.0.1:9374';

const memory = new UserMemory({ token, baseUrl });
const theme = await memory.get('preference.theme');
const prefs = await memory.getByTag('preference');
```

SDK 会自动在每次请求带上 `Authorization: Bearer <token>`。

---

## 6. 身份验证（可选）

UOMP 支持两种可选的 Agent 身份验证方式：

- **DID**：`did:ethr` / `did:web`，通过 DID Resolver 验证文档是否存在。
- **GPG**：验证 Agent 公钥签名。

MVP 中身份验证**不强制**。如果 `uom.json` 没有 `identity` 字段，CLI 会打印黄色警告，但 Agent 仍可继续运行。这降低了示例和开发阶段的上手门槛。

---

## 7. 设计要点

| 层面 | 机制 |
|------|------|
| **认证** | Agent 通过 `UOM_TOKEN`（JWT）自证身份。 |
| **授权** | 用户通过 CLI 显式授权 tag/key，写入权限默认关闭。 |
| **最小权限** | Token 只包含被授权的 tags/keys，并支持 deny 列表。 |
| **短时效** | 默认 30 分钟，支持 revoke/close。 |
| **审计** | Guard 记录每次访问到 `audit_logs`。 |
| **本地优先** | 用户数据存在本地 SQLite，Token 由本地签发。 |
