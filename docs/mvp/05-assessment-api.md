# KCR V3 评分 API

状态：**寒武纪快照查询与通用重新评分接口已接入本地及生产服务**

## 接口

查询寒武纪团队工作簿复算快照：

```bash
curl http://127.0.0.1:5001/api/v1/kcr/companies/cambricon/assessment
```

提交完整的 KCR V3 输入重新评分：

```bash
curl -X POST \
  -H 'content-type: application/json' \
  --data-binary @src/data/mvp/cambricon-scoring-input-v3.json \
  http://127.0.0.1:5001/api/v1/kcr/assessments/score
```

两个接口都返回 `assessment` 与 `provenance`。前者是评分引擎输出，后者明确区分：

- 方法与寒武纪输入来自团队工作簿；
- 方法目前是待团队确认的候选版；
- 70% 人工复核线、P0/P1 映射、证据准入分类和四位小数属于工程默认。

## 安全与错误边界

- 查询接口只允许 `GET`，评分接口只允许 `POST`。
- 请求体默认不得超过 1 MiB，空白、损坏或超限 JSON 均被拒绝。
- 评分仍由 V3 引擎完整校验，不接受伪造指标、权重或证据引用。
- 预期的 4xx 错误可供前端展示；内部异常统一转为不泄露细节的 500 响应。
- 所有响应使用 `no-store`，API 错误不会落入 SPA 页面。
