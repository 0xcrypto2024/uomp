# UOMP 股票分析 Agent：CLI / SDK / 数据源设计文档

> 目标：以股票分析 Agent 为牵引，把 UOMP 的 CLI 和 SDK 从“能用”打磨成“好懂、可控、可扩展”。
> 本设计同时面向两个角色：
> - **Agent User（投资者 / 终端用户）**：使用 CLI 发现 Agent、连接、授权、管理会话、查看审计。
> - **Agent Developer（Agent 开发者）**：使用 SDK 开发股票分析 Agent，调用 Memory Guard 读取用户数据。
>
> 关键边界：
> - **Agent User 的 CLI 不负责启动 Agent 进程**。用户只做发现、连接、授权；Agent 由用户自己或独立启动器运行，凭 Token 访问 Memory Guard。
> - **Phase 1 只考虑终端用户**，即用户会通过命令行手动复制环境变量或 source Token 文件来启动 Agent。

---

## 1. 设计目标

1. **用户敢用**：投资者能清楚知道 Agent 会读什么、读到多细、多久失效。
2. **开发者好写**：Agent 开发者几行代码就能接入 UOMP，不用理解 JWT、DID、Session 细节。
3. **用户与 Agent 解耦**：用户不因为“授权”就不得不运行一段外部代码；Agent 可以独立运行、独立分发。
4. **场景闭环**：从导入持仓、发现 Agent、连接、授权、Agent 独立运行、获取分析、撤销会话，全程可控。
5. **可扩展**：数据模型和 SDK 接口要能支持后续更多金融场景（基金、债券、加密资产）。

---

## 2. 角色与视角

### 2.1 Agent User（投资者）

- 不是开发者，不会写代码。
- 关心三件事：我的数据在哪、Agent 能看什么、怎么让它停下来。
- 使用 CLI 完成所有操作，但 **CLI 不帮用户启动 Agent**。
- 用户自己决定在哪里、以什么方式运行 Agent；CLI 只负责签发 Token 并安全交付。
- Phase 1 限定为终端用户：用户会把 Token 复制到自己启动 Agent 的终端里。

### 2.2 Agent Developer（Agent 作者）

- 会写 TypeScript/Python，想快速做一个股票分析 Agent。
- 关心：怎么声明权限、怎么读数据、怎么上报审计、怎么在本地跑通。
- 使用 SDK + `uom.json`。
- 需要一个开发者专用的 CLI 命令来本地调试和启动 Agent（例如 `uomp dev run` 或 `uomp agent run`）。

---

## 3. 数据模型（Memory Schema）

股票分析 Agent 需要的数据分为两类：**用户私有数据**（存在本地 Memory Store）和**公开/半公开数据**（可由 Agent 外部获取，也可存入本地）。

### 3.1 用户私有数据

| 数据项 | tag | sensitivity | 说明 |
|--------|-----|-------------|------|
| 当前持仓 | `portfolio:holdings` | high | 股票代码、数量、成本价、市值等 |
| 自选股/关注列表 | `portfolio:watchlist` | medium | 用户关注的标的，不含金额 |
| 风险偏好 | `profile:risk` | medium | 保守/稳健/激进，可承受回撤等 |
| 投资目标 | `profile:goal` | medium | 长期增值、分红、养老等 |
| 交易限制 | `profile:constraints` | medium | 不做空、不投某行业等 |
| 历史分析记录 | `analysis:history` | low | Agent 过去生成的报告摘要 |

### 3.2 公开/半公开数据

| 数据项 | tag | sensitivity | 说明 |
|--------|-----|-------------|------|
| 实时行情 | `market:quote` | low | 最新价、涨跌幅、成交量 |
| 历史 K 线 | `market:history` | low | 日线/周线/月线价格 |
| 公司基本面 | `market:fundamental` | low | PE、PB、ROE、营收等 |
| 宏观经济 | `market:macro` | low | 利率、CPI、GDP 等 |
| 新闻情绪 | `market:news` | low | 公开新闻、研报摘要 |

### 3.3 输出数据

| 数据项 | tag | sensitivity | 说明 |
|--------|-----|-------------|------|
| 分析报告 | `analysis:report` | low | Agent 生成的文本/HTML/Markdown 报告 |

> 注：按 UOMP 当前规范，`sensitivity=high` 的 Memory Item 不能通过 tag 泛化授权，需要用户显式确认或 key 级授权。`portfolio:holdings` 应标记为 high。

---

## 4. 数据源设计

股票分析 Agent 需要的数据分为“用户本地已有数据”和“Agent 运行时需要抓取的数据”。

### 4.1 用户本地数据来源

| 来源 | 数据 | 导入方式 | 说明 |
|------|------|----------|------|
| 用户手动输入 | 持仓、自选股、风险偏好等 | `uomp import --interactive` | 最简单，适合 demo |
| CSV/Excel/JSON 导入 | 持仓、交易记录、风险配置等 | `uomp import <file> --tag <tag>` | 通用私有数据导入 |
| 券商 API / 文件同步 | 实时持仓 | 后续扩展，MVP 不做 | 需要合规考虑 |

### 4.2 Agent 运行时抓取的数据源

Agent 不依赖本地 Memory Store 获取公开市场数据，可以自行调用公开 API。推荐数据源：

#### 美股

| 数据源 | 覆盖范围 | 认证 | 限制 | 备注 |
|--------|----------|------|------|------|
| Yahoo Finance API（unofficial） | 实时行情、历史 K 线 | 免费 | 不稳定，适合 demo | 可用 `yfinance` Python 库 |
| Alpha Vantage | 行情、基本面、技术指标 | API Key | 免费版 25 次/天 | 适合基本面分析 |
| Finnhub | 实时行情、新闻、基本面 | API Key | 免费版 60 次/分钟 | 功能较全 |
| Polygon.io | 美股行情、新闻 | API Key | 付费 | 高质量，生产推荐 |
| SEC EDGAR | 财报、公告 | 免费 | 原始数据 | 适合基本面深度分析 |

#### A股/港股

| 数据源 | 覆盖范围 | 认证 | 限制 | 备注 |
|--------|----------|------|------|------|
| Tushare | A股行情、基本面、宏观 | Token | 积分制 | 国内最常用 |
| AKShare | A股/港股/基金数据 | 免费 | 接口不稳定 | 纯免费，适合 demo |
| 东方财富 Choice / Wind | 全市场 | 付费 | 商业授权 | 生产级 |
| 新浪财经接口 | 实时行情 | 免费 | 不稳定 | 简单 demo 可用 |

#### 新闻与情绪

| 数据源 | 覆盖范围 | 认证 | 备注 |
|--------|----------|------|------|
| NewsAPI | 全球新闻 | API Key | 适合英文新闻 |
| Bing News API | 新闻搜索 | API Key | 微软生态 |
| 聚宽/宽客社区 | 中文研报 | 部分免费 | A股研报 |
| Twitter/X API | 情绪 | API Key | 需谨慎使用 |

#### 宏观经济

| 数据源 | 覆盖范围 | 认证 | 备注 |
|--------|----------|------|------|
| FRED（美联储） | 美国宏观数据 | 免费 | 全球经济指标 |
| World Bank Open Data | 全球宏观 | 免费 | 长期趋势分析 |
| 国家统计局 | 中国宏观 | 免费 | A股宏观分析 |

### 4.3 数据源使用原则

1. **用户私有数据必须走 Memory Guard**：持仓、风险偏好等只能由 Agent 通过 UOMP Token 读取。
2. **公开数据 Agent 可自行获取**：但在 `uom.json` 中声明会用到的外部数据源，让用户知情。
3. **避免 Agent 把私有数据传给外部 API**：Agent 不能把用户持仓列表作为参数发给第三方 LLM 或数据源。分析逻辑应尽量本地完成。
4. **LLM 调用默认本地或用户可控**：如果必须调用云端 LLM，应先对持仓做脱敏（如只传代码和权重，不传成本价）。

---

## 5. CLI 设计：Agent User 视角

CLI 是投资者的“授权管理器”，不是 Agent 启动器。设计要点：

- **只做发现、连接、授权、会话管理、审计**。
- 所有危险操作都有确认。
- 授权前必须展示“数据暴露摘要”。
- 会话状态一目了然。
- 错误信息告诉用户“为什么”和“怎么办”。

### 5.1 命令总览

#### Agent User 命令

| 命令 | 作用 |
|------|------|
| `uomp import <file>` | 导入持仓/自选股/风险偏好 |
| `uomp data` | 查看本地 Memory Store 中的数据 |
| `uomp discover <path-or-registry>` | 发现 Agent，显示清单信息 |
| `uomp connect <agent>` | 连接 Agent，验证身份，缓存清单，评估风险 |
| `uomp authorize <agent>` | 创建 Session 并签发 Token |
| `uomp sessions` | 查看活跃会话 |
| `uomp revoke <session-id>` | 撤销会话 |
| `uomp audit` | 查看访问审计日志 |
| `uomp config` | 配置默认风险偏好、数据源偏好 |
| `uomp dry-run <agent>` | 模拟授权，不读真实数据 |
| `uomp registry search <keyword>` | 从 Registry 搜索 Agent |

#### Agent Developer 命令

| 命令 | 作用 |
|------|------|
| `uomp agent init <name>` | 初始化一个 Agent 项目 |
| `uomp agent validate` | 验证 `uom.json` 和文件结构 |
| `uomp agent test` | 使用测试数据本地调试 Agent |
| `uomp agent run <agent>` | 开发者本地启动 Agent（用于测试） |
| `uomp agent publish` | 打包 Agent 供发布 |

> 注意：`uomp agent run` 属于开发者调试工具，不是给普通用户的命令。

### 5.2 核心流程 wireflow

#### 5.2.1 导入私有 Memory

`uomp import` 是一个通用命令，用来把用户本地数据导入 Memory Store。它不只针对持仓，也适用于自选股、风险偏好、任何用户愿意授权给 Agent 的私有数据。

#### 基本用法

```bash
# 导入持仓 CSV
$ uomp import holdings.csv --tag portfolio:holdings --sensitivity high

# 导入风险偏好 JSON
$ uomp import risk-profile.json --tag profile:risk --sensitivity medium

# 导入自选股（手动输入）
$ uomp import --tag portfolio:watchlist --sensitivity medium --interactive

# 指定 key 字段和格式
$ uomp import trades.xlsx --tag portfolio:transactions --sensitivity high --format xlsx --key-field id
```

#### 参数说明

| 参数 | 作用 | 示例 |
|------|------|------|
| `--tag` | 指定 Memory tag | `portfolio:holdings` |
| `--sensitivity` | 指定敏感度 | `high` / `medium` / `low` |
| `--key-field` | CSV/JSON 中哪一列作为 item key | `symbol`, `id` |
| `--format` | 文件格式，默认自动推断 | `csv`, `json`, `xlsx` |
| `--interactive` | 交互式输入，适合手动录入 | - |
| `--dry-run` | 预览会导入哪些数据，不写入 | - |
| `--replace` | 替换该 tag 下已有数据，默认追加 | - |

#### 持仓导入示例

```bash
$ uomp import holdings.csv --tag portfolio:holdings --sensitivity high
```

输出：

```text
已导入持仓数据:
  文件: holdings.csv
  标的数量: 8
  总市值: $124,500
  标签: portfolio:holdings
  敏感度: high
  存储位置: ~/.uomp/memory/
```

#### 风险偏好导入示例

```bash
$ uomp import risk.json --tag profile:risk --sensitivity medium
```

输出：

```text
已导入风险偏好:
  文件: risk.json
  记录数: 1
  标签: profile:risk
  敏感度: medium
```

#### 导入流程

```text
uomp import <file>
  -> 自动推断或用户指定 format
  -> 解析数据并映射为 Memory Item 列表
  -> 用户确认 tag / sensitivity / key-field
  -> 写入本地 Memory Store
  -> 返回导入摘要
```

#### 数据映射

`uomp import` 不要求用户数据严格符合 Memory Item 格式。CLI 会尝试自动映射常见字段，例如：

| 用户数据字段 | 映射到 Memory Item |
|-------------|-------------------|
| `symbol`, `股票代码`, `code` | `key` 或 `value.symbol` |
| `quantity`, `数量` | `value.quantity` |
| `cost`, `cost_basis`, `成本价` | `value.cost_basis` |
| `note`, `备注` | `value.notes` |

如果自动映射不满足，用户可以通过 `--map` 参数指定：

```bash
$ uomp import mydata.csv \
    --tag portfolio:holdings \
    --map key=symbol \
    --map "value.quantity=持仓数量" \
    --map "value.cost_basis=成本价"
```

#### 5.2.1a 导入数据格式规范

为了让 `uomp import` 既能处理股票场景，也能处理未来各种私有数据，需要定义一套通用的导入格式规范。

##### 通用原则

1. **每一行 / 每一个对象 = 一个 Memory Item**。
2. **CSV 必须包含表头**，编码为 UTF-8。
3. **JSON 支持两种形式**：
   - 单个对象：导入为 1 条 Memory Item。
   - 对象数组：每条导入为 1 条 Memory Item。
4. **字段名不区分大小写**，支持中英文别名。
5. **缺失值允许为空**，但 key 字段不能为空。
6. **日期统一为 ISO8601**，如 `2026-07-14` 或 `2026-07-14T10:00:00Z`。
7. **数值字段统一为数字类型**，货币符号和千分位逗号应被自动去除。

##### CSV 规范

- 分隔符：默认英文逗号 `,`，可识别中文逗号并提示。
- 字符串引号：支持双引号包裹含逗号的内容。
- 表头行：第一行必须是字段名。
- 空行：自动跳过。
- 编码：UTF-8；如遇 GBK/GB2312，尝试自动转换并提示。

##### JSON 规范

```json
{
  "key": "AAPL",
  "value": {
    "symbol": "AAPL",
    "quantity": 100,
    "cost_basis": 150.0
  },
  "tags": ["portfolio:holdings"],
  "sensitivity": "high",
  "source": "user",
  "description": "苹果持仓"
}
```

或数组：

```json
[
  { "key": "AAPL", "value": { ... } },
  { "key": "TSLA", "value": { ... } }
]
```

如果 JSON 中没有显式提供 `key`、`tags`、`sensitivity`，CLI 会尝试从 `--key-field`、`--tag`、`--sensitivity` 参数推断。

##### 自动字段映射表

CLI 内置常见字段别名映射：

| 含义 | 英文字段名 | 中文字段名 | 映射目标 |
|------|-----------|-----------|---------|
| 唯一标识 / 股票代码 | `key`, `symbol`, `code`, `ticker` | `代码`, `股票代码`, `Symbol` | `key` 或 `value.symbol` |
| 数量 | `quantity`, `shares`, `amount` | `数量`, `股数`, `持仓数量` | `value.quantity` |
| 成本价 | `cost`, `cost_basis`, `avg_cost` | `成本价`, `成本`, `平均成本` | `value.cost_basis` |
| 市值 | `market_value`, `value` | `市值`, `当前市值` | `value.market_value` |
| 当前价 | `price`, `current_price` | `当前价`, `现价` | `value.current_price` |
| 货币 | `currency` | `货币`, `币种` | `value.currency` |
| 买入日期 | `acquired_at`, `purchase_date` | `买入日期`, `购入日期` | `value.acquired_at` |
| 备注 | `notes`, `note`, `comment` | `备注`, `注释` | `value.notes` |
| 交易类型 | `type`, `transaction_type` | `类型`, `交易类型` | `value.type` |
| 交易价格 | `price`, `transaction_price` | `价格`, `成交价` | `value.price` |
| 手续费 | `fee`, `commission` | `手续费`, `佣金` | `value.fee` |
| 风险等级 | `risk_level`, `risk_profile` | `风险等级`, `风险偏好` | `value.risk_level` |
| 最大可承受回撤 | `max_drawdown` | `最大回撤` | `value.max_drawdown` |
| 投资期限 | `investment_horizon` | `投资期限` | `value.investment_horizon` |

##### 推荐数据格式示例

###### portfolio:holdings（持仓）

CSV：

```csv
symbol,quantity,cost_basis,market_value,currency,acquired_at,notes
AAPL,100,150.00,17500.00,USD,2024-01-15,长期持有
TSLA,50,200.00,9500.00,USD,2024-03-10,
NVDA,30,300.00,12000.00,USD,2024-06-01,科技股
```

JSON：

```json
[
  {
    "key": "AAPL",
    "value": {
      "symbol": "AAPL",
      "quantity": 100,
      "cost_basis": 150.0,
      "market_value": 17500.0,
      "currency": "USD",
      "acquired_at": "2024-01-15",
      "notes": "长期持有"
    }
  }
]
```

建议敏感度：**high**

###### portfolio:watchlist（自选股）

CSV：

```csv
symbol,notes
AAPL,关注财报
TSLA,电动车龙头
```

建议敏感度：**medium**

###### profile:risk（风险偏好）

JSON（单条记录）：

```json
{
  "key": "user-risk-profile",
  "value": {
    "risk_level": "moderate",
    "max_drawdown": 0.2,
    "investment_horizon": "5_years",
    "preferred_sectors": ["technology", "healthcare"],
    "avoid_sectors": ["tobacco", "gambling"],
    "notes": "稳健型投资者"
  }
}
```

建议敏感度：**medium**

###### portfolio:transactions（交易记录）

CSV：

```csv
id,symbol,type,quantity,price,fee,currency,executed_at,notes
1,AAPL,buy,100,150.00,5.00,USD,2024-01-15T10:00:00Z,首次买入
2,TSLA,sell,50,210.00,5.00,USD,2024-05-20T14:30:00Z,止盈
```

建议敏感度：**high**

##### 敏感度默认值

| 数据类型 | 默认敏感度 | 说明 |
|----------|-----------|------|
| `portfolio:holdings` | high | 含金额和成本 |
| `portfolio:transactions` | high | 含完整交易记录 |
| `portfolio:watchlist` | medium | 只含代码和备注 |
| `profile:risk` | medium | 用户偏好 |
| `profile:goal` | medium | 用户目标 |
| `profile:constraints` | medium | 投资约束 |
| `analysis:history` | low | 历史报告摘要 |

如果用户显式指定 `--sensitivity`，以用户输入为准。

##### 数据校验规则

导入时 CLI 必须进行以下校验：

1. **key 不能为空**：每条记录必须有 key 或由 `--key-field` 指定字段生成 key。
2. **key 唯一性**：同一 tag 下 key 不能重复。重复时提示用户选择：跳过 / 覆盖 / 全部覆盖。
3. **数值字段合法性**：`quantity`、`cost_basis`、`market_value` 等必须是数字。
4. **日期字段合法性**：`acquired_at`、`executed_at` 必须是合法日期。
5. **tag 和 sensitivity 必须存在**：如果无法推断，必须提示用户输入。

##### 错误信息示例

| 错误 | 输出 |
|------|------|
| 表头缺少 key 字段 | `无法识别唯一标识字段。请使用 --key-field 指定，例如：--key-field symbol` |
| 数值字段包含货币符号 | `第 3 行 cost_basis 包含 "$" 符号，已自动去除。建议原始数据使用纯数字。` |
| key 重复 | `发现重复 key "AAPL"。是否覆盖已有记录？[y/n/a]（a=全部覆盖）` |
| 日期格式错误 | `第 5 行 acquired_at "2024/01/15" 格式不识别，已尝试转换。建议统一使用 ISO8601 格式。` |

#### 5.2.2 发现 Agent

```bash
$ uomp discover ./examples/stock-analyst
```

或从 Registry：

```bash
$ uomp registry search stock
$ uomp discover registry://stock-analyst
```

输出：

```text
Agent: stock-analyst v0.1
发布者: example-org  [DID 已验证]
描述: 基于持仓和市场公开信息生成投资策略分析

外部数据源:
  - yahoo-finance
  - alpha-vantage

权限请求:
  [高敏感] portfolio:holdings   - 当前持仓
  [中敏感] portfolio:watchlist - 自选股
  [中敏感] profile:risk        - 风险偏好
  [低敏感] market:public       - 公开市场数据（Agent 将自行获取）

写入权限: 无
```

#### 5.2.3 连接 Agent

```bash
$ uomp connect ./examples/stock-analyst
```

输出：

```text
正在连接 Agent: stock-analyst v0.1

身份验证:
  发布者: example-org
  DID: did:ethr:0xabc123...
  Registry 验证: 已通过 (ERC-8004)
  本地签名验证: 通过
  包完整性校验 (sha256): 通过

风险摘要:
  高敏感数据请求: 1 个 (portfolio:holdings)
  中敏感数据请求: 2 个
  外部数据源: 2 个
  写入权限: 无
  综合风险: 中

Agent 清单和校验信息已缓存到:
  ~/.uomp/agents/stock-analyst/v0.1/

已连接，尚未授权。请运行:
  uomp authorize stock-analyst
```

“连接”在这个阶段要完成：

1. **读取并解析 `uom.json`**。
2. **验证发布者身份**：DID / GPG / X.509 / Registry 状态。
3. **包完整性校验**：计算目录或归档的 checksum，与 `uom.json` 中的 `package_checksum` 比对。
4. **缓存清单**：把 `uom.json`、公钥、checksum 存到 `~/.uomp/agents/<agent-id>/<version>/`，方便后续授权时快速校验。
5. **风险评分**：根据敏感 tag 数量、外部数据源数量、写入权限等给出一个简单风险等级（低/中/高）。
6. **不启动 Agent，也不签发 Token**。

#### 5.2.4 授权 Agent

```bash
$ uomp authorize ./examples/stock-analyst
```

输出：

```text
授权请求: stock-analyst v0.1
发布者: example-org  [DID 已验证]

权限请求:
  [高敏感] portfolio:holdings   - 当前持仓（8 条记录）
  [中敏感] portfolio:watchlist - 自选股（15 条）
  [中敏感] profile:risk        - 风险偏好
  [低敏感] market:public       - 公开市场数据（Agent 将自行获取）

写入权限: 无
默认会话时长: 10 分钟

本次将暴露:
  - 你的 8 条持仓记录（含成本价和市值）
  - 你的自选股列表
  - 你的风险偏好

[y] 确认授权  [n] 取消  [e] 编辑范围  [d] 模拟运行
```

用户选 `y` 后：

```text
已创建会话: sess_abc123
已签发 Capability Token（有效期至 10:30）

请把以下环境变量设置到你运行 Agent 的终端中：

  export UOM_TOKEN="eyJhbG..."
  export UOMP_BASE_URL="http://127.0.0.1:9374"

或者保存到文件:
  uomp authorize ./examples/stock-analyst --output ~/.uomp/tokens/sess_abc123.env

Agent 启动后可以通过 Memory Guard 访问已授权数据。
你可以随时运行 `uomp revoke sess_abc123` 撤销授权。
```

#### 5.2.5 数据暴露摘要的粒度（重要设计点）

目前授权前的摘要有两种可能的粒度：

**方案 A：tag 级摘要（较粗）**

```text
本次将暴露:
  - portfolio:holdings（8 条记录）
  - portfolio:watchlist（15 条）
  - profile:risk（1 条）
```

优点：简单，易于理解。
缺点：用户不知道 Agent 会读到持仓里的“成本价”还是只读到“股票代码”。

**方案 B：字段级摘要（较细）**

对于高敏感 tag（如 `portfolio:holdings`），进一步列出字段：

```text
本次将暴露:
  - portfolio:holdings（8 条记录）
      字段: symbol, quantity, cost_basis, market_value
      用途: 计算仓位权重和盈亏分析
      脱敏选项: 可隐藏 cost_basis 和 quantity，仅保留 symbol 和 weight
  - portfolio:watchlist（15 条）
      字段: symbol, notes
  - profile:risk（1 条）
      字段: risk_level, max_drawdown
```

优点：安全感更强，用户能精确控制。
缺点：要求 Agent 在 `uom.json` 里声明字段级 scope；CLI 输出更长。

**建议：**

- 中低敏感数据用 **tag 级摘要**。
- 高敏感数据用 **字段级摘要**，并提供脱敏选项。
- Agent 在 `uom.json` 中为每个高敏感 tag 提供 `fields` 和 `purpose` 说明：

```json
{
  "requested_scopes": {
    "read": {
      "tags": ["portfolio:holdings"],
      "fields": {
        "portfolio:holdings": ["symbol", "quantity", "cost_basis", "market_value"]
      },
      "purposes": {
        "portfolio:holdings": "计算仓位权重、行业分布和盈亏分析"
      }
    }
  }
}
```

这样既不会让用户淹没在细节里，又能对最关键的数据给出透明说明。

#### 5.2.6 编辑范围

用户选 `e` 后进入交互：

```text
选择本次要授权的数据:
  [x] portfolio:holdings   （当前持仓）
  [ ] portfolio:watchlist  （不授权）
  [x] profile:risk         （风险偏好）
  [x] market:public        （公开数据）

高敏感数据选项:
  [ ] 暴露成本价和具体股数
  [x] 仅暴露持仓代码和权重（脱敏模式）
```

#### 5.2.7 查看会话

```bash
$ uomp sessions
```

输出：

```text
活跃会话:
  sess_abc123  stock-analyst  剩余 7 分钟   状态: 活跃
               已授权: [portfolio:holdings, profile:risk]
               最后访问: 10:02:15  /memory/read
               Agent 地址: 127.0.0.1 (本机)

  sess_def456  news-agent     剩余 23 分钟  状态: 空闲
               已授权: [market:news]
               最后访问: 09:55:00

已关闭会话（最近 5 条）:
  sess_ghi789  stock-analyst  10:30 已过期
```

会话列表需要显示：

- session id
- agent 名和版本
- 剩余时间
- 状态（活跃 / 空闲 / 未启动）
- 已授权 tag / 字段
- 最后访问时间和访问的端点
- Agent 来源 IP（本机显示 `127.0.0.1`，远程显示实际 IP）

#### 5.2.8 撤销会话

```bash
$ uomp revoke sess_abc123
```

输出：

```text
已撤销会话 sess_abc123。
对应 Capability Token 已立即失效。
正在运行的 Agent 将在下一次访问 Memory Guard 时被拒绝。
```

#### 5.2.9 审计日志

```bash
$ uomp audit --agent stock-analyst --today
```

输出：

```text
2026-07-14 10:00:01  stock-analyst  READ  portfolio:holdings  8 items
2026-07-14 10:00:02  stock-analyst  READ  profile:risk        1 item
2026-07-14 10:00:03  stock-analyst  FETCH market:public       AAPL,TSLA,NVDA
2026-07-14 10:00:10  stock-analyst  SAVE  analysis:report     1 item
```

### 5.3 CLI 配置

```bash
$ uomp config set risk_profile conservative
$ uomp config set default_holdings_file ~/portfolio.csv
$ uomp config set data_source.market.primary yahoo
$ uomp config set data_source.market.cn tushare
```

配置保存在 `~/.uomp/config.json`，敏感度为 low，可被 Agent 读取以调整分析策略。

### 5.4 错误信息设计

| 场景 | 旧错误 | 新错误 |
|------|--------|--------|
| Token 未授权某 tag | `ACCESS_DENIED` | `Agent 请求读取 "portfolio:holdings"，但当前会话未授权。请让用户运行: uomp authorize <agent> --include portfolio:holdings` |
| Agent 请求写入 | `WRITE_NOT_AVAILABLE` | `当前 Agent 请求写入数据，但 UOMP MVP 禁止 Agent 写入。如需保存报告，请让 Agent 输出到本地文件。` |
| 会话已过期 | `TOKEN_EXPIRED` | `会话 sess_abc123 已过期（10:30）。请重新运行: uomp authorize <agent>` |
| 高敏感未确认 | `ACCESS_DENIED` | `"portfolio:holdings" 为高敏感数据，需要用户在授权时显式确认。请使用 --sensitive 参数或交互式授权。` |

---

## 6. Registry 与 Agent 发现设计

Phase 1 实现一个本地 Registry 索引（Local Registry Index），让用户可以通过 `uomp registry search` 发现 Agent，同时定义好基于 ERC-8004 的链上 Registry 接口，方便后续接入。

### 6.1 Agent 打包格式

一个可发布的 Agent 包应包含：

```text
stock-analyst-0.1.0/
  uom.json              # Agent 声明文件
  dist/                 # 编译后的可执行文件或脚本
  README.md             # 使用说明
  LICENSE               # 许可证
  signature.json        # 发布者签名
```

`uom.json` 中需要包含：

```json
{
  "uomp_version": "1.0",
  "agent": {
    "id": "stock-analyst",
    "version": "0.1.0",
    "name": "持仓分析助手",
    "publisher": "example-org"
  },
  "package": {
    "checksum": "sha256:abc...",
    "signature": "...",
    "source_url": "https://github.com/example-org/stock-analyst/releases/v0.1.0"
  },
  "requested_scopes": { ... },
  "external_data_sources": ["yahoo-finance", "alpha-vantage"],
  "identity": { ... }
}
```

### 6.2 ERC-8004 Registry 接口（建议）

沿用 ERC-8004 的思路，Registry 只负责记录 Agent 元数据和验证状态，不存储 Agent 代码本身。

```solidity
interface IAgentRegistry {
  function register(
    string calldata agentId,
    string calldata metadataURI,
    bytes32 packageChecksum,
    string calldata publisherDID
  ) external;

  function verify(string calldata agentId) external;

  function revoke(string calldata agentId) external;

  function isVerified(string calldata agentId) external view returns (bool);

  function getMetadataURI(string calldata agentId) external view returns (string memory);

  function getPackageChecksum(string calldata agentId) external view returns (bytes32);
}
```

### 6.3 发现流程

```text
用户: uomp registry search stock
CLI:
  1. 查询 Registry 或本地缓存索引
  2. 返回搜索结果列表
  3. 用户选择 stock-analyst
  4. CLI 从 metadataURI 下载 Agent 包
  5. CLI 校验 packageChecksum 和 signature
  6. CLI 调用 uomp connect 完成身份和完整性验证
  7. 用户运行 uomp authorize 进行授权
```

### 6.4 验证层级

| 层级 | 验证内容 | 信任程度 |
|------|----------|----------|
| L1 本地校验 | `uom.json` 格式、package checksum、signature | 基础 |
| L2 Registry 验证 | Registry 上 `isVerified=true` | 较高 |
| L3 用户信任 | 用户之前授权过同一发布者 | 最高 |

CLI 在连接时应明确显示当前 Agent 达到了哪一层验证。

### 6.5 本地 Registry 索引实现

Phase 1 不直接对接链上合约，而是用一个本地 JSON 文件作为 Registry 索引，让 `uomp registry search` 和 `uomp discover registry://<id>` 能跑起来。

#### 6.5.1 存储位置

```text
~/.uomp/registry/
  index.json            # 本地 Registry 索引
  cache/                # 已下载的 Agent 包缓存
    stock-analyst/
      v0.1.0/
        uom.json
        dist/
        README.md
        signature.json
```

#### 6.5.2 索引格式

`~/.uomp/registry/index.json`：

```json
{
  "version": "1.0",
  "updated_at": "2026-07-14T10:00:00Z",
  "agents": [
    {
      "id": "stock-analyst",
      "version": "0.1.0",
      "name": "持仓分析助手",
      "description": "基于持仓和市场公开信息生成投资策略分析",
      "publisher": "example-org",
      "publisher_did": "did:ethr:0xabc123...",
      "metadata_uri": "https://github.com/example-org/stock-analyst/releases/v0.1.0/metadata.json",
      "source_url": "https://github.com/example-org/stock-analyst/releases/v0.1.0/stock-analyst-0.1.0.tar.gz",
      "package_checksum": "sha256:abc...",
      "signature": "...",
      "verified": true,
      "tags": ["stock", "portfolio", "analysis"],
      "added_at": "2026-07-14T10:00:00Z"
    }
  ]
}
```

#### 6.5.3 索引来源

本地索引可以通过以下方式维护：

1. **手动添加**：用户把本地 Agent 路径加入索引。
2. **开发者添加**：Agent 作者提供索引条目，用户复制到 `~/.uomp/registry/index.json`。
3. **链上同步**：后续实现 `uomp registry sync`，从 ERC-8004 合约拉取已验证条目。
4. **社区维护**：提供一个默认的社区索引文件（类似 `registry.json`），用户可以选择订阅。

#### 6.5.4 CLI 命令

| 命令 | 作用 |
|------|------|
| `uomp registry search <keyword>` | 按关键词搜索本地索引 |
| `uomp registry list` | 列出所有已索引 Agent |
| `uomp registry add <path>` | 把本地 Agent 路径加入索引 |
| `uomp registry add-url <url>` | 从 URL 下载 Agent 包并加入索引 |
| `uomp registry remove <id>` | 从索引移除某 Agent |
| `uomp registry verify <id>` | 校验本地缓存的 Agent 包完整性 |
| `uomp registry sync` | 后续从链上 Registry 同步验证状态 |

#### 6.5.5 搜索示例

```bash
$ uomp registry search stock
```

输出：

```text
找到 2 个 Agent:

  stock-analyst v0.1.0
    持仓分析助手
    发布者: example-org  [已验证]
    tags: stock, portfolio, analysis

  stock-news v0.2.0
    股票新闻聚合
    发布者: another-org  [未验证]
    tags: stock, news

请运行 `uomp discover registry://<id>` 查看详情。
```

#### 6.5.6 发现流程（本地 Registry）

```text
用户: uomp registry search stock
CLI:
  1. 读取 ~/.uomp/registry/index.json
  2. 按关键词过滤返回列表
  3. 用户选择 stock-analyst
  4. 用户运行 uomp discover registry://stock-analyst
  5. CLI 检查本地缓存是否存在
     - 不存在: 从 source_url 下载并解压到 ~/.uomp/registry/cache/
     - 存在: 使用缓存
  6. CLI 校验 package_checksum 和 signature
  7. CLI 调用 uomp connect 完成身份和完整性验证
  8. 用户运行 uomp authorize 进行授权
```

#### 6.5.7 与链上 ERC-8004 的衔接

本地索引中的 `verified` 字段后续可以从 ERC-8004 合约读取：

```text
uomp registry sync --network mainnet --contract 0x...
```

同步后：

- 链上 `isVerified(agentId) == true` 的 Agent，本地 `verified` 标记为 true。
- 链上 `revoke` 的 Agent，本地同步移除或标记为 revoked。
- 新增条目可以按链上 `register` 事件自动拉取。

#### 6.5.8 安全考虑

1. **默认不信任任何索引条目**：即使 `verified=true`，`uomp connect` 时仍要重新校验签名和 checksum。
2. **来源可追溯**：每个条目必须包含 `source_url` 和 `publisher_did`，方便用户核查。
3. **社区索引可审核**：默认社区索引使用公开 GitHub 仓库，变更通过 PR 审核。

---

## 7. CLI 设计：Agent Developer 视角

开发者也需要 CLI 来调试、验证和发布 Agent。

### 7.1 初始化 Agent

```bash
$ uomp agent init stock-analyst --template typescript
```

生成目录结构：

```text
stock-analyst/
  uom.json
  src/
    index.ts
  package.json
  README.md
```

### 7.2 验证 Agent

```bash
$ uomp agent validate
```

检查项：

- `uom.json` 格式是否正确
- `requested_scopes` 是否合理
- 必填文件是否存在
- identity / proof 是否可验证
- 是否声明了外部数据源
- package checksum 是否可计算

输出示例：

```text
验证通过:
  Agent ID: stock-analyst
  版本: 0.1.0
  发布者: example-org
  权限请求: 4 个 tag（1 个 high, 2 个 medium, 1 个 low）
  外部数据源: yahoo-finance, alpha-vantage
  风险: 无写入权限，符合 MVP 规范
```

### 7.3 本地调试

```bash
$ uomp agent test
```

自动完成：

1. 使用测试数据填充本地 Memory Store
2. 签发一个测试 Token
3. 启动 Agent
4. 输出审计日志

### 7.4 开发者本地启动 Agent

```bash
$ uomp agent run ./examples/stock-analyst
```

开发者测试时使用，等价于：

```bash
$ uomp authorize ./examples/stock-analyst --output /tmp/uomp.env
$ source /tmp/uomp.env
$ node ./examples/stock-analyst/dist/index.js
```

> 这个命令只对开发者暴露，普通用户不需要也不应该使用。

---

## 8. SDK 设计：Agent User 视角

普通用户其实不需要 SDK，但“用户侧 SDK”可以指：

- CLI 内部调用的库（`@uomp/cli-core`）
- 未来 GUI 应用集成的 SDK（如 Electron/Tauri App）

这里先定义未来 GUI 会用到的**用户侧 SDK**：

```ts
import { UompClient } from '@uomp/client';

const client = new UompClient({ dataDir: '~/.uomp' });

// 导入持仓
await client.memory.import({
  file: '~/holdings.csv',
  tag: 'portfolio:holdings',
  sensitivity: 'high',
});

// 查看数据
const holdings = await client.memory.query({ tags: ['portfolio:holdings'] });

// 发现 Agent
const manifest = await client.discover('./examples/stock-analyst');

// 连接 Agent（验证身份 + 风险评分）
const connection = await client.connect('./examples/stock-analyst');

// 授权 Agent，返回 Token
const session = await client.authorize({
  agentPath: './examples/stock-analyst',
  includeSensitive: true,
  durationMinutes: 10,
});

// 监听会话事件
session.on('access', (event) => {
  console.log(`Agent 读取了 ${event.tag}`);
});

// 撤销
await session.revoke();
```

---

## 9. SDK 设计：Agent Developer 视角

这是本次设计的重点。Agent 开发者 SDK 要足够薄，让开发者专注于分析逻辑。

### 9.1 核心类

```ts
import { UompAgent } from '@uomp/sdk';

const agent = await UompAgent.fromEnv();

// 读取用户授权的数据
const holdings = await agent.memory.read({ tags: ['portfolio:holdings'] });
const risk = await agent.memory.read({ tags: ['profile:risk'] });

// 读取公开数据（SDK 提供基础封装，但调用外部 API）
const quotes = await agent.market.quotes(['AAPL', 'TSLA']);
const fundamentals = await agent.market.fundamentals(['AAPL']);

// 生成分析（开发者自己的逻辑）
const report = analyze({ holdings, risk, quotes, fundamentals });

// 保存报告到本地文件（不写入 Memory Store）
await agent.output.save('./output/report.md', report);

// 也可以把报告摘要写入 Memory Store（如果用户授权）
await agent.memory.write({
  tag: 'analysis:report',
  key: 'stock-analysis-20260714',
  value: { summary: report.summary },
});
```

### 9.2 SDK API 清单

#### `UompAgent`

| 方法 | 作用 |
|------|------|
| `fromEnv()` | 从 `UOM_TOKEN` / `UOMP_BASE_URL` 初始化 |
| `whoami()` | 返回当前 Agent 的 manifest 和已授权 scope |
| `memory.read(opts)` | 读取 Memory Guard 数据 |
| `memory.write(opts)` | 写入 Memory Store（需授权，MVP 建议禁用） |
| `memory.query(opts)` | 复杂查询 |
| `market.quotes(symbols)` | 获取行情（调用外部数据源） |
| `market.fundamentals(symbols)` | 获取基本面 |
| `market.news(symbols)` | 获取新闻 |
| `market.macro(indicators)` | 获取宏观数据 |
| `output.save(path, content)` | 保存报告到本地文件 |
| `audit.log(event)` | 上报自定义审计事件 |

#### `UompAgentConfig`

```ts
interface UompAgentConfig {
  token?: string;           // UOM_TOKEN
  baseUrl?: string;         // UOMP_BASE_URL
  manifestPath?: string;    // uom.json 路径
  dataSource?: {
    market?: 'yahoo' | 'alpha-vantage' | 'tushare' | 'akshare' | 'custom';
    apiKey?: string;
  };
}
```

### 9.3 错误处理

SDK 应抛出结构化错误，方便开发者区分：

```ts
try {
  await agent.memory.read({ tags: ['portfolio:holdings'] });
} catch (err) {
  if (err.code === 'SCOPE_DENIED') {
    console.log('请要求用户授权 portfolio:holdings');
  }
  if (err.code === 'TOKEN_EXPIRED') {
    console.log('会话已过期，请重新授权');
  }
}
```

### 9.4 数据脱敏辅助

SDK 可以提供辅助函数，帮助开发者避免把敏感数据传给外部 LLM：

```ts
import { redactHoldings } from '@uomp/sdk/utils';

const safe = redactHoldings(holdings, { keep: ['symbol', 'weight'] });
// safe = [{ symbol: 'AAPL', weight: 0.25 }, ...]
```

---

## 10. 股票分析 Agent 的完整用户旅程

```text
[投资者]
   |
   v
导入持仓 CSV  ---->  数据进入本地 Memory Store (portfolio:holdings, high)
   |
   v
uomp discover ./stock-analyst
   |
   v
uomp connect ./stock-analyst
   |
   v
  - 验证发布者身份 (DID / Registry)
  - 校验包完整性 (checksum + signature)
  - 风险评分
  - 缓存清单到 ~/.uomp/agents/
   |
   v
uomp authorize ./stock-analyst
   |
   v
CLI 展示字段级数据暴露摘要，用户确认 / 编辑范围 / 脱敏
   |
   v
CLI 创建 Session，签发 Token
   |
   v
CLI 输出环境变量或 Token 文件给用户
   |
   v
[用户在另一个终端中运行 Agent]
   |
   v
Agent 读取 UOM_TOKEN，访问 Memory Guard
   |
   v
SDK 读取 portfolio:holdings, profile:risk
   |
   v
SDK 调用 Yahoo Finance / Alpha Vantage 获取公开数据
   |
   v
Agent 本地生成分析报告
   |
   v
报告保存到 ./output/report.md
   |
   v
用户通过 uomp sessions / uomp audit 监控访问
   |
   v
会话超时 / 用户撤销 ----> Token 失效
```

---

## 11. 安全与隐私要点

1. **持仓默认高敏感**：`portfolio:holdings` 必须标记为 high，不能 tag 泛化授权。
2. **公开数据不敏感**：`market:*` 可设为 low，Agent 可自行获取。
3. **用户 CLI 不启动 Agent**：避免“授权即执行”的安全风险，Agent 必须由用户独立启动。
4. **Token 交付要安全**：默认输出到终端，由用户手动复制；也支持 `--output` 保存到用户指定文件。Phase 1 不考虑自动注入外部进程。
5. **字段级暴露摘要**：对高敏感 tag 展示具体字段和用途，让用户精确控制。
6. **连接时全面验证**：身份、签名、checksum、Registry 状态、风险评分。
7. **LLM 调用要脱敏**：如果 Agent 调用外部 LLM，应先去掉成本价、股数等敏感字段。
8. **报告本地保存**：分析结论默认写到用户本地文件，不写入 Memory Store，除非用户授权 `analysis:report`。
9. **会话短期**：股票分析通常 5-10 分钟足够，默认 Token 有效期不超过 10 分钟。
10. **审计完整**：每次 `memory.read`、每次外部 API 调用、每次报告生成都应记录。

---

## 12. 实现阶段

### Phase 1：MVP Demo（2-3 周）

- 股票 Agent 能读取 `portfolio:holdings` 和 `profile:risk`
- Agent 从 Yahoo Finance 获取行情
- 生成 Markdown 报告保存到本地
- CLI 支持 `uomp discover`、`uomp connect`、`uomp authorize`
- 连接时完成身份验证、checksum 校验、风险评分
- 授权前字段级数据暴露摘要
- Token 以环境变量形式交付给用户
- `uomp sessions` 显示最后访问时间和状态
- 本地 Registry 索引：`uomp registry search/list/add/discover registry://<id>`

### Phase 2：体验打磨（2-3 周）

- `uomp import` 通用数据导入优化（字段映射、格式识别、预览）
- `uomp dry-run` 模拟授权
- `uomp config` 用户配置
- SDK 的数据脱敏辅助函数
- 更友好的错误信息
- 开发者命令 `uomp agent run` / `uomp agent test`
- `uomp registry sync` 对接链上 ERC-8004 合约

### Phase 3：生产准备（后续）

- 支持券商 API / 文件同步
- 多数据源适配器（Tushare / Alpha Vantage / Polygon）
- 本地 LLM 支持（Ollama）
- GUI 应用

---

## 13. 待决策问题

1. **字段级摘要是否必须？**
   - 建议：高敏感 tag 必须展示字段和用途，中低敏感 tag 保持 tag 级摘要。
2. **Token 交付方式**
   - Phase 1 用终端打印 + `--output` 保存文件。自动注入外部进程放到后续。
3. **Registry 实现**
   - 已确定：Phase 1 实现本地 Registry 索引（`~/.uomp/registry/index.json`），沿用 ERC-8004 接口设计，后续通过 `uomp registry sync` 对接链上合约。
4. **报告是否允许 Agent 写回 Memory Store？**
   - 建议：MVP 禁止；报告保存到本地文件。后续可通过 `analysis:report` tag 授权写入。
5. **是否需要为 Agent 开发者提供 Python SDK？**
   - 建议：先做好 TypeScript SDK，Python SDK 后续跟进（金融圈 Python 开发者很多）。

---

## 14. 下一步行动

1. 确认字段级数据暴露摘要的格式（`uom.json` 中的 `fields` 和 `purposes`）。
2. 确认风险评分的具体规则（高敏感 tag 数量、外部数据源数量、写入权限的权重）。
3. 确认本地 Registry 索引的初始内容：是否提供一个默认的 `registry.json` 示例（包含 stock-analyst）？
4. 之后即可进入 Phase 1 实现：先改造 CLI 支持 discover/connect/authorize + 本地 Registry 索引，再搭股票 Agent demo。
