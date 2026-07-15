---
title: 'UOMP 实现设计'
description: 'UOMP 参考实现 uomp-mvp 的架构与实现说明：组件职责、数据流与认证授权落地细节'
---

# UOMP 实现设计

本文档说明 UOMP 的**参考实现** [`uomp-mvp`](https://github.com/0xaicrypto/uomp-core) 如何将[协议规范](/spec/)落地为可运行的代码。它面向希望理解或扩展实现的人。

---

## 1. 实现概览

`uomp-mvp` 是一个 TypeScript monorepo，核心组件与 Spec 中的角色一一对应：

| 包 / 应用 | Spec 角色 | 职责 |
|-----------|-----------|------|
| `packages/core` | — | 共享类型、常量、工具函数 |
| `packages/store` | Memory Store | SQLite 持久化、tag/key 查询 |
| `packages/token` | — | EdDSA JWT 的签发与校验 |
| `packages/auth` | Auth Service | Session 创建/授权/关闭/撤销 |
| `packages/guard` | Memory Guard | Token 校验、Scope 过滤、审计日志 |
| `packages/identity` | Identity Verification | DID / GPG 验证入口 |
| `packages/sdk` | Agent SDK（示例级） | 当前为示例 Agent 提供的简单 HTTP 调用封装；面向 GUI 应用集成的完整 TypeScript SDK 见 [路线图](/roadmap/) Milestone 2 |
| `packages/cli` | User UI | 用户侧 CLI：`discover`/`connect`/`authorize`/`import`/`sessions`/`revoke`/`audit`/`registry`；开发者 shortcut `uomp agent run` |
| `apps/server` | — | Auth + Guard 组合 HTTP 服务 |
| `apps/gateway` | — | 远程授权 Gateway：mTLS 终结、远程 Token 校验、转发 Memory/audit 请求 |

---

## 2. 标准架构流程

在 UOMP 的标准模型中，**Agent 是独立进程**，uomp CLI 是**用户侧的授权代理**，运行在 Memory Store / Guard 所在机器。Auth Service 可以与 Memory Guard / Store 位于同一机器（本地默认），也可以由用户选择的可信远程服务提供：

<img src="/diagrams/design-standard-zh.svg" alt="UOMP 标准架构序列图" class="diagram" />

关键点：

- **Agent 与 CLI 是独立进程**，Agent 不依赖 CLI 启动。
- **身份验证、授权面板、Token 签发发生在 CLI（用户侧）或用户选择的 Auth Service。**
- **Auth Service 可以本地部署，也可以远程部署**；Token 最终通过 CLI 交付给 Agent。
- **Agent 只接收 Token 并使用它读取数据**，不参与授权决策。

### 2.1 本地开发便利模式

MVP 中的 `pnpm cli agent run ./examples/calendar-agent` 是为了降低上手门槛提供的快捷方式：

<img src="/diagrams/design-shortcut-zh.svg" alt="UOMP 本地开发 shortcut 序列图" class="diagram" />

这种模式把「授权代理」和「Agent 启动器」合并了，仅适用于本机开发测试，不是生产架构。标准用户流程中，CLI 只负责 `authorize` 并输出 Token，Agent 由用户独立启动。

### 2.2 远程模式（Remote Profile + Gateway）

当 Agent 运行在用户本地之外的机器/容器/云服务时，使用 `apps/gateway` 暴露 Memory Guard：

- Gateway 监听 HTTPS，要求客户端提供 mTLS 证书。
- 用户在 `~/.uomp/remote-profile.json` 中配置 Gateway endpoint 与客户端证书指纹 allowlist。
- Auth Service 签发的 Capability Token 使用 `profile: 'remote'`，`audience` 指向 Gateway endpoint（例如 `https://localhost:9443`）。
- Gateway 校验 Token 后，将 `/v1/memory/*` 和 `/v1/audit/*` 转发给本地 Memory Guard。

```text
┌─────────────┐   mTLS + Bearer Token   ┌──────────────┐   local HTTP   ┌──────────────┐
│ Remote Agent│ ───────────────────────►│ UOMP Gateway │ ──────────────►│ Memory Guard │
└─────────────┘                         └──────────────┘                └──────────────┘
```

快速验证命令：

```bash
# 1. 生成 CA / Gateway 服务端证书 / 客户端证书
./scripts/generate-gateway-certs.sh

# 2. 启动 Gateway
node apps/gateway/dist/index.js

# 3. 创建 remote session 并走通 end-to-end
./scripts/test-gateway-remote.sh
```

对应代码入口：

- `packages/cli/src/commands/authorize.ts`：标准授权流程
- `packages/cli/src/commands/run.ts`：本地开发 shortcut 的编排
- `packages/cli/src/utils/manifest.ts`：`loadManifest()` 与 `normalizeManifest()`
- `packages/auth/src/index.ts`：`AuthService`（`grantSession()` 已支持 `profile`/`audience`/`allowedFields`/`aggregationOnly`/`taskBound`）
- `packages/guard/src/index.ts`：`MemoryGuard`（新增 `/v1/audit`）
- `packages/token/src/index.ts`：`JWTTokenIssuer`
- `apps/gateway/src/index.ts`：Gateway mTLS 服务器与转发逻辑
- `scripts/generate-gateway-certs.sh` 与 `scripts/test-gateway-remote.sh`

### 2.3 CLI 命令结构

为清晰区分「普通用户」和「Agent 开发者」两套使用路径，CLI 命令分成两组：

**普通用户命令**

| 命令 | 作用 |
|------|------|
| `uomp import <file>` | 从 CSV/JSON 导入私有数据到 Memory Store |
| `uomp discover <agent>` | 发现 Agent，展示 `uom.json` 声明 |
| `uomp connect <agent>` | 验证 Agent 身份、校验 checksum、缓存 manifest |
| `uomp authorize <agent>` | 交互式/脚本化授权，输出 `UOM_TOKEN` |
| `uomp sessions` | 查看活跃会话 |
| `uomp revoke <session-id>` | 撤销会话 |
| `uomp audit` | 查看访问审计日志 |
| `uomp registry <sub>` | 本地 Registry 索引的增删查 |

**开发者命令**

| 命令 | 作用 |
|------|------|
| `uomp agent run <agent>` | 本地调试 shortcut：授权、启动 Guard、启动 Agent 一次完成 |

---

## 3. 认证与授权实现

### 3.1 Agent 声明

`uom.json` 中的 `requested_scopes` 使用 snake_case，但内部 `AgentManifest` 类型使用 camelCase。CLI 在 `packages/cli/src/utils/manifest.ts` 的 `loadManifest()` / `normalizeManifest()` 中完成转换：

```ts
// packages/cli/src/utils/manifest.ts
const raw = JSON.parse(content);
return normalizeManifest(raw);
```

### 3.2 会话创建与授权

`AuthService.createSession()` 将请求写入 SQLite `sessions` 表，状态为 `created`。

`AuthService.grantSession()`：

1. 检查 Session 状态为 `created`
2. 构造 `CapabilityTokenPayload`
3. 调用 `JWTTokenIssuer.issue()` 生成 JWT
4. 计算 token hash 并存入 `sessions.token_hash`
5. 更新 Session 状态为 `active`

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

对于远程模式，`grantSession()` 接受可选的 `{ profile, audience }` 参数；此时 `profile` 为 `'remote'`，`audience` 指向 Gateway endpoint（如 `https://localhost:9443`）。Token 的签名仍由本地 Auth Service 私钥完成，Gateway 仅持有公钥进行校验。

### 3.3 JWT 实现细节

`JWTTokenIssuer` 使用 `jose` 库：

- 算法：`EdDSA`（曲线 `Ed25519`）
- 私钥/公钥通过 `generateKeyPair('EdDSA', { crv: 'Ed25519' })` 生成
- 内部 payload 为 camelCase，JWT claims 为 snake_case
- 同时设置标准 JWT `iat` 和 `exp` claim
- Header 包含 `kid: 'uomp-auth-key-1'`

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

### 3.4 Guard 鉴权

`MemoryGuard.validateRequest()` 按顺序校验：

1. `Authorization` 头格式为 `Bearer <token>`
2. JWT 签名有效
3. Token 未过期
4. Session 未被吊销（通过 `token_blacklist` 表）

然后按请求类型分别调用：

- `GET /v1/memory/:key` → `isKeyAllowed()`
- `GET /v1/memory?tag=xxx` → `isTagAllowed()`，再对每个结果调用 `isKeyAllowed()`

`isKeyAllowed()` 的判定顺序：

1. 如果 key 在 `denyKeys` 中 → 拒绝
2. 如果 key 在 `keys` 中 → 允许
3. 如果 item 的 `sensitivity === 'high'` → 必须命中 `keys`，否则拒绝
4. 如果 item 的任意 tag 在 `tags` 中且不在 `denyTags` 中 → 允许
5. 否则拒绝

因此，高敏感数据（如 `portfolio:holdings`）**不能仅靠 tag 授权**。`uomp authorize` 在交互式或脚本式授权时，会自动把已选中高敏感 tag 下的所有 item key 加入 `scope.keys`，既满足 Guard 要求，又让用户在授权面板中只看到 tag 级别的摘要。

### 3.5 身份验证（可选）

身份验证由 **CLI 在用户本机** 执行，不在 Agent 进程内执行。`IdentityVerifier` 当前实现：

- **DID**：使用 `did-resolver` + `ethr-did-resolver` + `web-did-resolver`。MVP 仅验证 DID 文档可解析，不强求签名绑定。
- **GPG**：已引入 `openpgp`，但 `verifyGpg()` 目前是 placeholder，仅检查 `proof.proofValue` 是否存在。
- **无 identity**：返回 `valid=false`，CLI 在用户本机打印黄色警告，但仍可继续运行。

这是为了降低示例 Agent 的上手门槛；生产环境应在用户主机上强制身份验证，未通过验证的 Agent 不应获得 Token。

---

## 4. Memory Store 实现

`MemoryStore` 基于 `better-sqlite3`：

- `memory_items` 表存储 key、value（JSON 字符串）、tags（JSON 数组字符串）、sensitivity、source 等
- `getByTag()` 使用 SQLite JSON1 扩展：

```sql
SELECT * FROM memory_items
WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)
```

- `set()` 使用 `INSERT ... ON CONFLICT(key) DO UPDATE` 实现 upsert

---

## 5. 审计日志

`MemoryGuard` 在每次请求后写入 `audit_logs`：

- 请求成功或失败都会记录
- 包含 `session_id`、`agent_id`、`action`、`key`、`tags`、`allowed`、`reason`
- MVP 不限制读取次数，但 `limits` 字段已预留，未来可在此实现配额扣除

---

## 6. 股票分析示例

`examples/stock-analyst/` 是 Phase 1 的完整验收示例，覆盖从数据导入到审计撤销的全链路：

1. `uomp import ./examples/stock-analyst/sample-risk.json` 导入风险偏好（JSON 自描述记录）。
2. `uomp import ./examples/stock-analyst/sample-holdings.csv --tag portfolio:holdings --sensitivity high` 导入持仓 CSV。
3. `uomp discover ./examples/stock-analyst` 与 `uomp connect ./examples/stock-analyst` 验证 Agent。
4. `uomp authorize ./examples/stock-analyst` 交互式授权，CLI 展示字段级摘要。
5. 用户把输出的 `UOM_TOKEN` 交给 Agent 进程，独立运行 `node ./examples/stock-analyst/index.js`。
6. Agent 读取授权数据、拉取公开行情、生成本地 Markdown 报告。
7. `uomp sessions -a` 与 `uomp audit --limit 20` 查看访问记录。
8. `uomp revoke <session-id>` 撤销会话。

完整步骤见仓库内 [`examples/stock-analyst/README.md`](https://github.com/0xaicrypto/uomp-core/tree/main/examples/stock-analyst/README.md)。

---

## 7. 本地配置文件

CLI 初始化后生成：

- `~/.uomp/config.json` — 服务端口、数据目录
- `~/.uomp/uomp.sqlite` — Memory Store
- `~/.uomp/auth.sqlite` — Session 与黑名单
- `~/.uomp/audit.sqlite` — 审计日志
- `~/.uomp/.secrets/` — Ed25519 密钥对（MVP 每次运行重新生成，生产应持久化）

---

## 8. MVP 限制与未来扩展

| 能力 | MVP 状态 | 说明 |
|------|---------|------|
| Agent 读取 | ✅ 已实现 | 按 tag/key 授权 |
| Agent 写入 | ❌ 未开放 | Guard 返回 `503 WRITE_NOT_AVAILABLE` |
| Agent 删除 | ❌ 未开放 | 同上 |
| 远程 Profile（Gateway + mTLS） | ✅ 已实现 | `apps/gateway` 提供参考实现；Payload 端到端加密仍待实现 |
| 聚合查询（`/v1/memory/aggregate`） | ✅ 已实现 | 支持 sum/avg/count/min/max，配合 `aggregation_only` Token |
| 删除证明（`/v1/sessions/{id}/deletion-proof`） | ✅ 已实现 | Agent 提交签名证明，Session 自动关闭 |
| 审计查询（`/v1/audit`） | ✅ 已实现 | 支持按 session_id 过滤 |
| 字段过滤（`allowed_fields`） | ✅ 已实现 | Token 指定返回字段，Guard 过滤 |
| 身份验证 | ⚠️ 可选 | DID/GPG 框架存在，但验证强度较弱 |
| 查询限额 | ⚠️ 预留 | `limits` 已写入 Token，但未强制执行 |

---

## 9. 相关链接

- [协议规范](/spec/)
- [参考实现仓库](https://github.com/0xaicrypto/uomp-core)
- [日历示例 Agent](https://github.com/0xaicrypto/uomp-core/tree/main/examples/calendar-agent)
- [股票分析示例 Agent](https://github.com/0xaicrypto/uomp-core/tree/main/examples/stock-analyst)
