# 科创锐鉴开发合同

修改前端、API、评分或数据导入前，必须先阅读：

- `docs/contracts/investor-risk-workstation-v1.md`
- `docs/contracts/industry-risk-api-v1.md`
- `docs/contracts/industry-risk-storage-v1.md`
- `docs/contracts/risk-graph-api-v1.md`
- `docs/adr/0001-investor-product-boundary.md`

每次改动必须同时检查：

1. 前端字段是否仍由 `IndustryRiskAssessmentApiResponse` 提供；
2. 后端响应是否通过 `src/lib/industry-risk-api.ts` 的运行时校验；
3. 数据缺失是否保持 `null + missingReason`，禁止补零；
4. 原值、风险分、同业风险分位和排名是否使用了正确语义；
5. 新闻是否仍仅用于资讯展示，禁止混入财报叙事评分；
6. 投资者 DTO 和页面是否没有责任人、截止日期、任务状态、待处理等企业处置字段；
7. 图谱是否遵守独立的接入合同，禁止前端自行生成因果或传播关系。

若需求与上述合同冲突，先更新 ADR、合同、类型、运行时校验和测试，再改页面。
