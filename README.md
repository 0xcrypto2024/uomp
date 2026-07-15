# UOMP Website

<p align="center">
  <a href="https://www.uomp.org/">官网</a> •
  <a href="https://www.uomp.org/spec/">规范</a> •
  <a href="https://www.uomp.org/design/">实现设计</a> •
  <a href="https://www.uomp.org/roadmap/">路线图</a> •
  <a href="https://www.uomp.org/en/">English</a>
</p>

<p align="center">
  <a href="https://www.uomp.org/spec/"><img src="https://img.shields.io/badge/spec-Draft--00-6B7280" alt="Spec" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/0xaicrypto/uomp-core"><img src="https://img.shields.io/badge/reference%20implementation-uomp--core-0A0A0A" alt="Reference Implementation" /></a>
</p>

这是 [UOMP（User-Owned Memory Protocol）](https://www.uomp.org/) 的官方网站仓库，包含协议规范、实现设计、路线图和展示页面。

UOMP 是一种用户主权型授权协议：用户的记忆数据保留在本地，AI Agent 只能通过短时会话（Session）和最小化范围（Capability Token）临时访问数据，会话结束或撤销后立即失效。

---

## UOMP Website

<p align="center">
  <a href="https://www.uomp.org/">Home</a> •
  <a href="https://www.uomp.org/en/spec/">Spec</a> •
  <a href="https://www.uomp.org/en/design/">Implementation</a> •
  <a href="https://www.uomp.org/en/roadmap/">Roadmap</a> •
  <a href="https://www.uomp.org/">中文</a>
</p>

This is the official website repository for the [User-Owned Memory Protocol (UOMP)](https://www.uomp.org/). It hosts the protocol specification, implementation design, roadmap, and landing pages.

UOMP is a user-sovereign authorization protocol: your memory data stays on your device, and AI Agents can only access it temporarily through short-lived sessions and scoped Capability Tokens. Access ends when the session ends or is revoked.

---

## 仓库内容 / Repository Contents

```text
uomp/
├── src/
│   ├── content/
│   │   ├── spec/           # UOMP 协议规范（中英双语）
│   │   │   ├── draft-00.md
│   │   │   └── draft-00.en.md
│   │   ├── design/         # 实现设计文档（中英双语）
│   │   │   ├── design.md
│   │   │   └── design.en.md
│   ├── pages/              # Astro 页面（含首页、示例、设计、路线图、规范）
│   ├── layouts/            # 页面布局
│   └── styles/             # 样式文件
├── public/                 # 静态资源（SVG 图表、演示视频等）
├── outreach/               # 社区推广材料
├── LICENSE                 # Apache-2.0
└── README.md               # 本文件
```

---

## 技术栈 / Tech Stack

- [Astro](https://astro.build/) - 静态站点生成器
- TypeScript
- 部署在 GitHub Pages，域名 `https://www.uomp.org`

---

## 本地开发 / Local Development

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建静态站点
pnpm build

# 预览构建结果
pnpm preview
```

本地开发服务器默认运行在 `http://localhost:4321/`。

---

## 部署 / Deployment

推送到 `main` 分支后，GitHub Actions 会自动构建并部署到 GitHub Pages。

---

## 关联仓库 / Related Repositories

| 仓库 | 说明 |
|------|------|
| [0xaicrypto/uomp-core](https://github.com/0xaicrypto/uomp-core) | UOMP 参考实现（TypeScript CLI + SDK + HTTP 服务），含 [CLI/SDK 设计文档](https://github.com/0xaicrypto/uomp-core/tree/main/docs) 与 [远程授权设计文档](https://github.com/0xaicrypto/uomp-core/tree/main/docs) |
| [0xaicrypto/uomp](https://github.com/0xaicrypto/uomp) | 本仓库：官方网站与协议规范 |

---

## 参与贡献 / Contributing

- 协议讨论：[GitHub Discussions](https://github.com/0xaicrypto/uomp/discussions)
- 参考实现 Issues：[uomp-core Issues](https://github.com/0xaicrypto/uomp-core/issues)
- 网站 Issues：[uomp Issues](https://github.com/0xaicrypto/uomp/issues)

## 许可证 / License

[Apache-2.0](./LICENSE)
