# 原始输入快照

本目录保存团队在 2026-08-18 确认可随项目仓库发布的原始输入，用于让新成员在克隆后获得
与当前开发环境一致的数据基础。

## 内容

- `科创板芯片企业风险指标数据库.sqlite`：毛同学提供的 R01–R22 行业样本主数据库；
- `科创板芯片企业风险指标数据库_数据说明.md`：数据库口径和表结构说明；
- `企业信息/`：7 家企业共 84 份学生材料，包括 75 个 Excel、8 份 PDF 和 1 个 ZIP。

以上共 86 个原始文件，约 44 MB。它们按原样提交，不在导入过程中覆盖或回写。

## 完整性校验

在仓库根目录运行：

```bash
cd data/raw
sha256sum --check SHA256SUMS
```

更新原始快照时应替换对应文件，并重新生成 `SHA256SUMS`；不要直接编辑二进制文件来修正
派生结果。

## 重建应用数据

应用运行时读取 `src/data/industry/` 下的派生 JSON，不需要启动 SQLite 服务。从仓库根目录运行：

```bash
npm run import:industry-risk -- \
  data/raw/科创板芯片企业风险指标数据库.sqlite \
  src/data/industry/semiconductor-risk-pilot.json

npm run import:enterprise-evidence -- \
  data/raw/企业信息 \
  src/data/industry/enterprise-evidence-catalog.json
```

## 来源与使用边界

本目录包含 iFinD、企业披露、交易所与其他第三方来源材料。团队授权其作为本次项目快照随
仓库发布，但这不替代第三方许可。使用、展示或再次分发前，请自行核对来源网站条款、账户
许可、著作权和适用法律；项目输出不构成监管认定或投资建议。
