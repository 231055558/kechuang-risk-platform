# PostgreSQL 数据库

项目主要使用三个 PostgreSQL schema：

- `risk_data`：由统一 SQLite 总库完整导入的版本化数据；
- `platform`：快照导入记录、每日更新批次和人工复核队列。
- `narrative_risk`：7 家叙事风险样本、两个评估范围、指标、来源元数据和私有归档索引。

原 94 家行业接口仍读取既有统一 JSON。新增叙事风险接口优先读取 PostgreSQL；连接失败时
读取 `src/data/industry/narrative-risk-runtime.json` 脱敏快照，两种模式使用同一响应类型。

## 本机数据库

Mac mini 使用 Homebrew PostgreSQL 18，数据库名为 `kechuang_risk`。本机 Unix socket
使用操作系统身份认证，TCP 回环连接使用 SCRAM 密码认证；PostgreSQL 不监听外部网卡。

复制 `.env.example` 中的非敏感本地配置，或者直接使用默认值：

```bash
PGDATABASE=kechuang_risk PGHOST=/tmp npm run db:import-snapshot
```

首次导入会创建 `risk_data`。导入过程在单一事务中完成，并逐表校验 SQLite 与 PostgreSQL
行数、外键和视图。验证已导入的数据：

```bash
npm run db:verify-snapshot
```

如需导入更新后的统一 SQLite，必须显式使用 `--replace`：

```bash
npm run db:import-snapshot -- path/to/master.sqlite --replace
```

该操作不会删除旧数据；旧 `risk_data` 会改名为带时间和导入批次号的
`risk_backup_*` schema。确认新版稳定后再单独清理备份。

## 权限角色

初始化无登录权限组角色：

```bash
psql -v ON_ERROR_STOP=1 -d kechuang_risk -f db/bootstrap/roles.sql
```

- `kechuang_api`：只读 `risk_data` 和快照导入状态；
- `kechuang_ingest`：继承只读权限，可新增或修订数据，但不能删除表中记录或修改结构。

正式部署时再创建带登录能力的服务角色，并将其加入对应权限组。密码只放在本机密钥或
`.env`，不得提交到仓库。每次快照替换后，导入器会自动把已有权限组授权给新版 schema。

## 数据边界

SQLite 和 PostgreSQL 使用相同的 35 张基础表、3 个视图和完整行数。SQLite 继续作为
只读发布快照和灾难恢复输入；PostgreSQL 是后续 API、采集任务和人工复核的统一主库。

## 叙事风险运行库

浏览器采集先写入 Git 忽略的 `private/narrative-risk/`，再由清单导入器事务化写库；浏览器
脚本不得直接修改正式指标。第三方全文和官方原文件只保存在私有归档，数据库与公开快照
仅保存元数据、SHA-256 和不超过 240 字的短摘录。

```bash
npm run db:sync-narrative-runtime
npm run db:verify-narrative-runtime
```

可用 `NARRATIVE_RISK_FORCE_SNAPSHOT=1` 强制 API 使用快照，以验证断库降级。代理指标统一
设置 `is_score_eligible=false`，正式缺失值保持 `NULL`。
