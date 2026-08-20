# R01–R22 行业风险数据底座

状态：**R01–R22 是唯一运行时指标主契约；94家统一数据已接入**

## 数据边界

应用运行时读取 `src/data/industry/r01-r22-unified.json`，当前包含：

- 94家唯一企业；
- 22项指标定义；
- 4,321条主观测；
- 687条补充事实；
- 391条深搜事件；
- 2,068条企业×指标覆盖记录。

数据来自数字芯片设计、模拟芯片设计、化学制剂和芯片产业链补充数据库；重复股票代码按
更具体行业库优先的规则去重。R01–R04形成NRI叙事校验，R05–R22进入两级CRITIC计算。

## 数据与行业基准分离

企业所属源数据库用于记录数据血缘，评分基准按最新行业分类表重新组织：数字与模拟芯片
合并为64家“芯片”基准，化学制剂25家，半导体设备3家，集成电路制造2家。行业数据只
提供风险分位、客观权重和排名参考；前端主视图始终是当前企业。

## 仓库归档

- `data/raw/`：此前授权发布的原始输入和37家阶段快照；
- `data/methodology/`：最新风险分公式和行业分类表；
- `data/snapshots/`：94家R01–R22总数据库公开快照；
- `src/data/industry/r01-r22-unified.json`：浏览器与本地API直接消费的派生合同。

公开总库保留结构化事实、来源、覆盖和审计信息，但清空付费API原始响应，并将工作站路径
改为可移植定位符。应用不会在运行时修改SQLite。

## 重建

```bash
npm run import:industry-risk-unified -- \
  output.json peerGroupId label input.sqlite [...]

npm run sanitize:master-sqlite -- \
  /path/to/private-master.sqlite \
  data/snapshots/public-master.sqlite
```

导入和评分都保持未知值为NA；任何新增代理、方向、权重或行业映射都必须更新方法版本并
留下来源和限制说明。
