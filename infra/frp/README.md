# FRP 公网映射

阿里云服务器继续使用 1Panel 已有的 frps 0.64.0，不部署项目代码或数据库：

```text
frps 控制端口 120.26.144.127:7000
  ├─ 120.26.144.127:7878 -> Mac mini 127.0.0.1:5050（后端）
  └─ 120.26.144.127:7879 -> Mac mini 127.0.0.1:5432（PostgreSQL）
```

Mac mini 的真实配置位于 `/opt/homebrew/etc/frp/frpc.toml`，认证 token 单独
保存在 `~/.config/frp/kechuang-token`，权限必须为 `600`。项目中的
`frpc.macmini.toml.example` 不包含 token。

## 服务检查

```bash
frpc verify -c /opt/homebrew/etc/frp/frpc.toml
brew services list
tail -f /opt/homebrew/var/log/frpc.log
```

公网检查：

```bash
curl http://120.26.144.127:7878/
pg_isready -h 120.26.144.127 -p 7879
```

后端目前没有应用登录，7878 对安全组允许的来源完全开放。PostgreSQL 使用
SCRAM-SHA-256 验证，但 7879 仍应只允许协作者固定 IP，不建议向
`0.0.0.0/0` 长期开放。为每位协作者创建独立的最小权限登录角色，不共享
数据库超级用户或后端运行角色。
