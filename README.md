# 科创企业特有风险识别与管理平台

这是一个可在本地直接运行的科创企业风险研究前端示例。项目保留企业样本、公开来源快照、风险指标、证据治理、事件流转和量化工作台，用于展示如何把公开信息组织为可追溯的风险研究界面。

公开仓库不包含生产服务器地址、SSH 配置、私有仓库部署脚本、访问凭据、本机绝对路径或内部交接文档。

## 主要功能

- 风险研判：展示六类风险、证据覆盖、近期事件和辅助结论。
- 实时情报：按时间查看企业公开信息，并将风险信号转为事件。
- 事件处理：查看事件清单、风险传导和企业处置。
- 企业研究：查看企业档案、指标观测、生命周期和证据档案。
- 对比分析：在共同口径下比较两家企业。
- 投资约束与建议：展示投资约束，保留建议工作区。
- 评分工作台：支持技术风险自动评分和其他风险的人工观测、证据绑定与复核。
- 报告导出：支持风险摘要、事件和指标相关导出。
- KCR V3 MVP 闭环：寒武纪黄金样例支持五维基线、证据下钻、径向图谱、受限情景、红旗处置任务与完整审计报告。

## 数据说明

仓库内包含 6 家科创企业的公开信息研究样本：

- DeepSeek
- 宇树科技
- 地平线
- 寒武纪
- 第四范式
- 速腾聚创

数据来自企业官网、交易所披露、论文、公开技术文档等公开来源。它们是带截止日期的研究快照，不是实时抓取结果，也不代表对企业的监管认定或投资结论。

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
tests/                数据、评分、交互和可访问性测试
```

## 本地数据与状态

- 企业研究数据位于 `src/data/`。
- 评分观测保存在浏览器 `localStorage`。
- 导航、事件状态和演示交互保存在浏览器 `sessionStorage`。
- 更换浏览器或设备不会自动同步这些状态。
- 项目不包含数据库、用户账户、权限系统或跨设备同步服务。

如需恢复初始数据，可以使用页面顶部的“恢复初始状态”操作，或清除当前站点的浏览器存储。

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

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui 与 Radix UI
- `liquid-glass-react`
- Lucide React
