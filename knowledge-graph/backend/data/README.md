# 本地数据目录

生产数据库、付费原始响应、浏览器原始采集和备份不得提交到 Git。

完整重建时，将兼容的 R01-R22 SQLite 数据库放为 `risk_data.sqlite`，然后运行
`tools/run_fee_kbg_pilot.py`。只查看和修改演示图谱时，请使用 `../demo/` 中的寒武纪或
芯驰科技脱敏快照。
