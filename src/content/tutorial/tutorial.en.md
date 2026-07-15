---
title: 'UOMP SDK/CLI Tutorial'
description: 'Complete guide from zero to deployed'
---

# UOMP SDK/CLI Tutorial

A complete walkthrough: install CLI, import data, authorize Agents, write Agents with the SDK, deploy remote mode, and connect to cloud services.

## Prerequisites

- Node.js >= 20
- pnpm 9 (`corepack enable` or `npm install -g pnpm@9`)
- Clone [uomp-core](https://github.com/0xaicrypto/uomp-core)

## 1. Install & Initialize

```bash
pnpm install
pnpm build
pnpm cli init
```

`pnpm cli init` creates Memory Store, Auth DB, Audit DB, and Ed25519 key pair under `~/.uomp`.

## 2. Import Data

```bash
pnpm cli import ./examples/stock-analyst/sample-risk.json --replace

pnpm cli import ./examples/stock-analyst/sample-holdings.csv \
  --tag portfolio:holdings \
  --sensitivity high \
  --replace
```

## 3. Start Auth + Guard

In **Terminal 1**:

```bash
pnpm --filter @uomp/server start
```

Service listens on `http://127.0.0.1:9374`.

## 4. Discover & Authorize

```bash
pnpm cli discover ./examples/stock-analyst
pnpm cli connect ./examples/stock-analyst
pnpm cli authorize ./examples/stock-analyst \
  --scope portfolio:holdings profile:risk \
  --output /tmp/uomp.env \
  --no-server
```

## 5. Write an Agent with the SDK

```ts
import { UompClient } from '@uomp/sdk';

// One line — auto-reads UOM_TOKEN + UOMP_BASE_URL from env
const uomp = UompClient.fromEnv();

const holdings = await uomp.memory.getByTag('portfolio:holdings');
const risk = await uomp.memory.getByTag('profile:risk');

const total = await uomp.aggregate.sum(
  'portfolio:holdings',
  'value.market_value'
);

const payloadId = await uomp.payload.upload(report);
await uomp.session.submitDeletionProof();
const logs = await uomp.audit.query({ limit: 10 });
```

## 6. Run the Agent

```bash
source /tmp/uomp.env
node ./examples/stock-analyst/index.js
```

## 7. Remote Gateway Mode

One command, no public IP needed:

```bash
uomp gateway start
# ═══ Public Gateway URL ═══
#   https://xxx.trycloudflare.com
```

## 8. Use the DO Cloud Agent

```bash
# Browser
https://uomp-stock-analyst-mvblm.ondigitalocean.app

# API
curl -X POST https://uomp-stock-analyst-mvblm.ondigitalocean.app/analyze \
  -H 'Content-Type: application/json' \
  -d '{"token":"your_token","gateway_url":"your_gateway"}'
```

## 9. Sessions & Audit

```bash
pnpm cli sessions -a
pnpm cli audit --limit 20
pnpm cli revoke <session-id>
```

## SDK Quick Reference

| Client | Method | Description |
|--------|--------|-------------|
| `uomp.memory` | `get(key)` | Read single item by key |
| `uomp.memory` | `getByTag(tag)` | Read all items by tag |
| `uomp.aggregate` | `sum/avg/count/min/max` | Aggregate without raw data |
| `uomp.payload` | `upload(data)` | Upload payload to Gateway |
| `uomp.session` | `submitDeletionProof()` | Submit deletion proof |
| `uomp.audit` | `query({limit})` | Query audit logs |

## CLI Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm cli init` | Initialize data directory |
| `pnpm cli import <file>` | Import CSV/JSON data |
| `pnpm cli authorize <agent>` | Authorize and issue Token |
| `pnpm cli sessions -a` | View all sessions |
| `pnpm cli audit --limit 20` | View audit logs |
| `pnpm cli revoke <id>` | Revoke a session |
| `uomp gateway start` | Start Gateway + Cloudflare Tunnel |
