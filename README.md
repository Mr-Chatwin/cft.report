# 📊 CFTC 持仓报告

> **Commitments of Traders (COT) 报告可视化面板 + AI 分析**

利用 CFTC 官方公开 API，对杠杆基金 (TFF) 和管理资金 (Disaggregated) 两类交易者的持仓数据进行处理，生成专业级分析报告。

**在线演示：** [https://mr-chatwin.github.io/cft.report/](https://mr-chatwin.github.io/cft.report/)

---

## ✨ 功能

- **三个视图：** `Table`（详细持仓表）、`Report`（情绪仪表盘+品种卡片）、`Analysis`（AI 深度分析）
- **Z-Score 仓位评估：** 基于 3 年历史窗口计算持仓偏离度，可视化柱状条
- **拥挤度检测：** 自动识别极端/拥挤交易（净持仓 z ≥ 2.75 或 ≤ -2.75）
- **资金流向分类：** 多头建仓、空头回补、多头挤压、空头施压等 8 种 Flow State
- **价格背离标记：** 资金方向与价格走势相反时黄色高亮
- **AI 深度分析：** 调用 DeepSeek API 生成八大板块专业分析报告
- **历史报告浏览：** 左侧栏按日期选择，保留所有历史数据
- **暗/亮主题：** 跟随系统自动切换
- **响应式布局：** 桌面端侧边栏 + 移动端滑入菜单

---

## 🏗 架构

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────┐
│  CFTC Socrata   │────▶│   GitHub Actions   │────▶│  gh-pages    │
│  公开 API       │     │  update-data.mjs   │     │  静态站点    │
└─────────────────┘     │                    │     └──────────────┘
                        │  • 拉取 CFTC 数据   │          │
┌─────────────────┐     │  • 计算 Z-Score     │     ┌──────────────┐
│  Yahoo Finance  │────▶│  • 分类资金流向      │     │  Telegram    │
│  价格 API       │     │  • 调用 AI 分析      │     │  推送通知    │
└─────────────────┘     │  • 推送 Telegram    │     └──────────────┘
                        └───────────────────┘
```

### 前端

纯静态 HTML/CSS/JS，无框架依赖。托管在 **GitHub Pages**（`gh-pages` 分支），零服务器成本。

### 数据流水线

**GitHub Actions** 每周六定时执行：

1. 从 CFTC Socrata API 拉取 TFF + Disaggregated 持仓数据
2. 从 Yahoo Finance 获取对应资产的同期价格
3. 计算 Z-Score（3 年滚动窗口，156 周）
4. 分类 Flow State 资金流向
5. 调用 DeepSeek API 生成 AI 分析报告
6. 保存 JSON 数据到 `data/` 目录并提交
7. 发送 Telegram 推送通知

---

## 🚀 快速部署

### 前置条件

- GitHub 账号
- DeepSeek API Key（或其他兼容 OpenAI 格式的模型）
- Telegram Bot Token（可选，如需推送通知）

### 步骤

#### 1. Fork 仓库

点击 [GitHub](https://github.com/Mr-Chatwin/cft.report) 右上角的 **Fork** 按钮。

#### 2. 启用 GitHub Pages

进入 Fork 仓库的 **Settings → Pages**，将 Source 设为 **Deploy from a branch**，Branch 选择 `gh-pages`，目录 `/ (root)`，Save。

完成后站点地址为：`https://<你的用户名>.github.io/cft.report/`

#### 3. 配置 Secrets（用于 AI 分析和 Telegram 推送）

进入 **Settings → Secrets and variables → Actions**，添加以下 Repository secrets：

| Secret | 说明 | 示例 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（必填） | `sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `DEEPSEEK_API_URL` | DeepSeek API 地址（可选，默认同上） | 留空使用默认 |
| `DEEPSEEK_MODEL` | AI 模型名（可选） | 留空使用默认 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（可选） | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `TELEGRAM_CHAT_ID` | Telegram 群组/频道 ID（可选） | `-1001234567890` |
| `TELEGRAM_THREAD_ID` | Telegram Topic ID（可选） | `24` |

#### 4. 手动触发首次运行

进入 **Actions → Update CFTC Report Data → Run workflow**，选择 `main` 分支后点击 **Run workflow**。

#### 5. 等待完成

大约 2-3 分钟后数据生成完毕，访问 `https://<你的用户名>.github.io/cft.report/` 即可查看报告。

---

## 📁 项目结构

```
├── index.html              # 主页面（前端全部代码）
├── data/                   # 生成的 JSON 报告数据
│   ├── index.json          # 日期索引
│   └── YYYY-MM-DD.json     # 单期报告数据
├── scripts/
│   └── update-data.mjs     # 数据生成脚本（GitHub Action 入口）
└── .github/workflows/
    └── update-data.yml     # GitHub Actions 工作流配置
```

### 主分支说明

| 分支 | 用途 |
|---|---|
| `gh-pages` | **部署分支** — 前端页面 + 数据 + 脚本，GitHub Pages 源 |
| `main` | **工作流分支** — GitHub Actions workflow 文件（触发调度） |

---

## 🛠 自定义

### 修改追踪的品种

编辑 `scripts/update-data.mjs` 中的 `TFF_CONTRACTS` 和 `DISAGG_CONTRACTS` 数组，修改或添加品种配置。

每个品种需指定：
- `name` — 显示名称
- `cftc` — CFTC API 中的合约名称（支持模糊匹配）
- `section` — 分组（股指、债券、利率、外汇/加密、能源、金属、农产品）
- `yf` — Yahoo Finance 交易代码（用于获取价格数据）

### 修改 AI 分析风格

编辑 `scripts/update-data.mjs` 中 `generateAnalysis` 函数的 prompt 模板。

### 修改推送频率

编辑 `.github/workflows/update-data.yml` 中的 cron 表达式。

---

## 📊 数据说明

- **数据来源：** [CFTC Socrata API](https://publicreporting.cftc.gov/)
  - 杠杆基金：`gpe5-46if`（Legacy TFF）
  - 管理资金：`72hh-3qpy`（Disaggregated）
- **更新频率：** 美国东部时间每周五 15:30 发布当周数据
- **Z-Score 窗口：** 156 周（约 3 年）
- **价格数据：** 报告日（周二）前后 5 个交易日的涨跌幅

---

## 🤝 贡献

欢迎提交 Issue 和 PR！如果有新的品种建议或分析维度优化，请先开 Issue 讨论。

---

## 📄 License

MIT
