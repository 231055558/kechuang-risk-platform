# 科创企业特有风险识别与管理平台

这是一个可在本地直接运行的科创企业风险研究平台。当前浏览器运行时统一采用 R01–R22 指标体系，并接入数字芯片设计、模拟芯片设计、化学制剂和芯片产业链补充样本四个数据库。

公开仓库不包含生产服务器地址、SSH 配置、私有仓库部署脚本、访问凭据、本机绝对路径或内部交接文档。

## 主要功能

- 94 家唯一企业，支持按四个同业组筛选和切换；
- R01–R22 全量指标字典、企业覆盖状态和最新观测；
- 主观测、补充事实、来源和正式报告覆盖下钻；
- 交易所问询、诉讼、限制清单和深搜事件统一展示；
- R01–R04 形成不进入总分的 NRI 叙事校验；R05–R22 先按 CRITIC 形成五个维度分，再按 CRITIC 汇总为企业可用基准分；
- 单项缺失不补零，也不阻断其余指标计算，权重在当前企业可用指标与维度内重新归一化；行业样本仅用于风险分位、客观权重和参考排名。

## 数据说明

当前统一快照包含 94 家唯一企业、4,321 条主观测、687 条补充事实、391 条深搜事件和 2,068 条企业×指标覆盖记录。数字芯片设计样本已补充 8,762 条财经新闻证据、天眼查人员/诉讼/处罚/风险/专利/供应商等许可派生数据、国家知识产权局 39 个申请人主体的精确检索口径和 5 条逐件核验法律状态事件，以及 EU Sanctions Map/FSD 对 37 家企业 115 个名称与别名的官方筛查结果；格科微 R21 已按境内核心经营主体补充2名主要人员、35条人员—公司关系及人员/企业风险聚合。付费原始结果仅保存在本地许可目录，不进入公开前端 JSON。重复股票代码按“具体行业库优先”的规则去重。

仓库同时保留团队授权公开的原始输入快照，位于 `data/raw/`，包括行业风险 SQLite 数据库、
数据说明和 7 家企业的 Excel、PDF、ZIP 材料。完整文件清单与校验方式见
`data/raw/README.md` 和 `data/raw/SHA256SUMS`。应用运行时读取 `src/data/industry/r01-r22-unified.json`，
不会直接修改原始文件。

本轮使用的最新公式、行业分类和 94 家企业总数据库也已归档：

- `data/methodology/`：风险分公式 DOCX、行业分类 XLSX 及 SHA-256 清单；
- `data/snapshots/`：R01–R22 总数据库公开快照、处理说明及 SHA-256 清单。

公开总库保留评分所需的派生事实、来源、覆盖和审计信息，但不包含天眼查付费 API 原始响应，
且已经移除工作站绝对路径。完整处理规则见 `data/snapshots/README.md`。

行业基准按最新分类表口径组织：数字芯片设计与模拟芯片设计合并为“芯片”64家基准，化学制剂25家；补充样本分别纳入半导体设备3家和集成电路制造2家。小于5家的基准组仍可给出方向性结果，但前端会明确提示样本较小。

项目不会在本地启动后自动采集新数据。更新企业资料时，请同时维护来源 URL、发布日期、采集日期、证据定位和支持强度。

## 环境要求

- Node.js 24.18.0
- npm 11.6.2

仓库包含 `.nvmrc`。使用 nvm 时可以先执行：

```bash
nvm use
```

## 快速开始

1. 安装依赖：

```bash
npm ci
```

2. 启动本地开发环境：

```bash
npm run dev
```

3. 浏览器访问：

```text
http://127.0.0.1:5173
```

`npm run dev` 会同时启动：

- Vite 前端开发服务器：`http://127.0.0.1:5173`
- 本地评分 API：`http://127.0.0.1:5001`

Vite 会把 `/api` 请求代理到本地评分 API，因此技术风险评分和技术基础量化可以在 localhost 环境直接使用。

可以通过环境变量调整端口：

```bash
PORT=4173 API_PORT=5002 npm run dev
```

## 本地生产构建

生成生产构建：

```bash
npm run build
```

启动包含静态前端和评分 API 的本地服务：

```bash
npm start
```

浏览器访问：

```text
http://127.0.0.1:5000
```

可以使用 `HOST`、`PORT`、`STATIC_ROOT` 和 `BASE_PATH` 调整本地服务参数。例如：

```bash
PORT=8080 npm start
```

## 常用命令

```bash
npm run dev       # 同时启动前端和本地评分 API
npm run dev:web   # 仅启动 Vite 前端
npm run dev:api   # 仅启动本地评分 API
npm test          # 运行自动化测试
npm run typecheck # TypeScript 类型检查
npm run lint      # ESLint 检查
npm run build     # 生成前端和本地 Node 服务构建
npm run verify:localhost # 验证前端与两个本地评分接口
npm run db:sync-narrative-runtime # 导入叙事来源清单并导出脱敏降级快照
npm run db:verify-narrative-runtime # 校验 7 家/8 范围/83 来源等运行约束
npm start         # 启动本地生产构建
```

## 目录结构

```text
src/
  components/
    dashboard/        业务页面和评分工作台
    layout/           侧栏、顶部命令栏和应用壳
    liquid/           液态玻璃组件封装
    ui/               基础 UI 组件
  data/
    company/          企业详情与事件样本
    companies.json    企业摘要
    realtime-signals.json
    risk-indicators.json
    indicator-taxonomy.json
  hooks/              本地状态和评分工作区
  lib/                数据治理、评分、导出和状态逻辑
  styles/             主题、壳层和页面样式
  types/              风险、证据、指标和事件类型
server/
  http-server.ts      本地静态服务与评分 API
  production-server.ts
scripts/
  dev.mjs             localhost 前端与 API 联合启动器
data/
  raw/                 团队授权公开的原始数据库与企业材料快照
tests/                数据、评分、交互和可访问性测试
```

## 本地数据与状态

- 统一运行数据位于 `src/data/industry/r01-r22-unified.json`。
- 原始输入快照位于 `data/raw/`，克隆仓库后即可获得，无需另行下载。
- 项目包含用于重建派生数据的 SQLite 文件，但运行时不依赖外部数据库服务。
- PostgreSQL 统一库、快照导入和权限配置见 `db/README.md`。叙事风险 API 优先读取 PostgreSQL，异常时降级到最近一次成功导入生成的脱敏 JSON 快照；原 94 家行业接口仍保持现有口径。
- 旧 KCI/KCR JSON 和组件保留用于历史审计与迁移参考，不再由浏览器入口加载。

从多个 R01–R22 SQLite 重建统一数据：

```bash
npm run import:industry-risk-unified -- \
  src/data/industry/r01-r22-unified.json \
  digital-chip "数字芯片设计" path/to/digital.sqlite \
  analog-chip "模拟芯片设计" path/to/analog.sqlite \
  pharma "化学制剂" path/to/pharma.sqlite \
  semiconductor-supplement "芯片产业链补充样本" path/to/supplement.sqlite
```

导入顺序同时是重复企业的优先级；更具体的行业库应放在补充样本之前。

## 数据更新原则

修改企业数据时建议保持以下约束：

1. 企业、证据、事件、指标之间的 ID 引用必须可以解析。
2. 只有具备定义、口径、阈值和来源的正式指标可以参与评分。
3. 背景材料和待核验证据不能进入评分覆盖率。
4. 推导型证据必须保留推导依据。
5. 同一指标只使用最新的已复核观测。
6. 数据快照日期和来源发布日期必须分开记录。

提交前运行：

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:localhost
```

GitHub Actions 会在推送和 Pull Request 时执行相同的质量检查。

## 使用边界

- 本项目用于研究展示、课程实践和前端开发参考。
- 页面中的风险结果是辅助研判，不替代人工尽调。
- 项目不会自动验证所有外部链接的持续有效性。
- 项目输出不构成监管认定、法律意见、证券投资建议或收益承诺。
- 公开来源内容的使用应遵守来源网站条款和适用法律。
- `data/raw/` 中含 iFinD 等第三方来源材料；团队授权其随本项目快照公开，但下载者仍须自行确认并遵守相应来源的许可、账户条款和再分发限制。

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui 与 Radix UI
- `liquid-glass-react`
- Lucide React
