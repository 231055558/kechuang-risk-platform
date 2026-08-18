# 行业风险评分方法版本

状态：**MVP 横截面方法可运行；完整 IRAWC 等待 2019–2024 历史锚点**

## `IRAWC-MVP-2026.08-v1`

当前方法使用会议确认的公式：

```text
riskScore = 100 × (0.5 × industryRisk + 0.5 × companyRiskPercentile)
```

- `industryRisk` 暂按会议约定显式使用 `0.5`，接口会返回 `placeholder`，页面不得把它描述成模型结论；
- `companyRiskPercentile` 使用同业横截面的 `PERCENTRANK.INC` 口径，遇到并列取平均秩；
- 只对毛同学标为可评分且已有统一原始指标的 R07、R13、R14、R16、R18 计算；
- 熵权与 CRITIC 同时输出为两套“部分候选基线”，不宣布任何一套是 R05–R22 官方总分；
- 缺失值不补零、不插值。

## `IRAWC-FULL-2026.08-v1`

完整方法保留为可调用但默认不激活的后端能力：

```text
a = Q05(history)
m = Q50(history)
b = Q95(history)
Ask = clamp((m - a) / (b - a), 0, 1)
score = 100 × clamp(Ask + 0.4 × (relativeRiskPercentile - 0.5), 0, 1)
```

分位数采用 Type 7 插值。历史样本少于 3 条或 `Q95 = Q05` 时返回
`insufficient-history`，不回退到臆造分数。待补齐 2019–2024 同口径历史数据后，再把完整方法切为生产默认。

## 方向与限制

当前五项试验指标的风险方向均来自指标定义：研发投入强度、营收增速、现金流短债覆盖率越低风险越高；
无形资产占比增幅、海外营收占比越高暴露越大。R07 仍需与 R08 里程碑联合判断，R18 仍需与 R19
制裁命中联合判断，因此页面必须同时展示限制说明和原始来源。
