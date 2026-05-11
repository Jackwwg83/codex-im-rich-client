# 数据模型设计

## 1. 存储原则

- SQLite + WAL。
- 所有外部事件使用 platform + message_id 去重。
- 所有 approval 必须可审计。
- raw payload 可按采样或 debug 配置保存，默认保存必要字段。

## 2. 表结构草案

### users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, platform_user_id)
);
```

### chats

```sql
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_chat_id TEXT NOT NULL,
  title TEXT,
  type TEXT,
  is_allowed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, platform_chat_id)
);
```

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### thread_bindings

```sql
CREATE TABLE thread_bindings (
  id TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  topic_id TEXT,
  project_id TEXT NOT NULL,
  codex_thread_id TEXT,
  default_model TEXT,
  active_turn_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(target_key)
);
```

`target_key` 格式：

```text
telegram:<chat_id>:<topic_id?>
lark:<chat_id>:<thread_id?>
dingtalk:<conversation_id>
```

### turns

```sql
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  codex_thread_id TEXT NOT NULL,
  codex_turn_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  user_prompt TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  summary TEXT,
  raw_json TEXT,
  UNIQUE(codex_turn_id)
);
```

### approvals

```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  app_server_request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  target_key TEXT NOT NULL,
  codex_thread_id TEXT,
  codex_turn_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  requested_by_user_id TEXT,
  decided_by_user_id TEXT,
  decision TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  raw_json TEXT
);
```

### outbound_messages

```sql
CREATE TABLE outbound_messages (
  id TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_message_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  codex_thread_id TEXT,
  codex_turn_id TEXT,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### inbound_dedup

```sql
CREATE TABLE inbound_dedup (
  platform TEXT NOT NULL,
  platform_message_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(platform, platform_message_id)
);
```

### event_log

```sql
CREATE TABLE event_log (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_key TEXT,
  codex_thread_id TEXT,
  codex_turn_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
```

### audit_log

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_key TEXT,
  project_id TEXT,
  codex_thread_id TEXT,
  codex_turn_id TEXT,
  approval_id TEXT,
  result TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

## 3. 状态枚举

### TurnStatus

```text
queued
running
waiting_for_approval
completed
failed
interrupted
stale
```

### ApprovalStatus

```text
pending
allowed_once
allowed_session
denied
cancelled
expired
stale
```

### RiskLevel

```text
low
medium
high
critical
```

## 4. 索引

```sql
CREATE INDEX idx_turns_thread ON turns(codex_thread_id);
CREATE INDEX idx_turns_target ON turns(target_key);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_target ON approvals(target_key);
CREATE INDEX idx_event_log_thread ON event_log(codex_thread_id, codex_turn_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
```

## 5. 迁移策略

- 使用 `drizzle-kit`、`kysely` migration 或自写 SQL migrations。
- migrations 文件进入 git。
- daemon 启动时自动执行 pending migrations，但生产可配置 `auto_migrate=false`。

## 6. 数据保留

默认：

```toml
[retention]
event_log_days = 14
audit_log_days = 180
raw_payload_days = 7
command_output_days = 14
```

## 7. 备份

- 每天复制 SQLite 到 `~/.codex-im-bridge/backups/state-YYYYMMDD.db`。
- 最多保留 30 份。
- 不备份 bot token；secret 来自环境变量/keychain。
