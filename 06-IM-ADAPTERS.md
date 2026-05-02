# IM Adapter 设计

## 1. 决策摘要

P0/P1 使用 native adapters，不把 Vercel Chat SDK 或 Koishi/Satori 放在核心。

```text
P0 Telegram: grammY / native Bot API
P1 Feishu/Lark: @larksuiteoapi/node-sdk
P1 DingTalk: dingtalk-stream-sdk-nodejs
P2 Satori/Koishi: 长尾中文平台兼容层
P2 Vercel Chat SDK: Slack/Discord/Teams/GitHub/Linear/WhatsApp 等平台
```

## 2. ChannelAdapter 抽象

```ts
export type PlatformName = "telegram" | "lark" | "dingtalk" | "satori" | "slack" | string;

export interface Target {
  platform: PlatformName;
  chatId: string;
  threadKey?: string;
  topicId?: string;
}

export interface Sender {
  platformUserId: string;
  username?: string;
  displayName?: string;
  raw?: unknown;
}

export interface ChannelCapabilities {
  canEditMessage: boolean;
  canStreamByEditing: boolean;
  supportsButtons: boolean;
  supportsCards: boolean;
  supportsMarkdown: boolean;
  supportsThreads: boolean;
  supportsFileUpload: boolean;
  supportsEphemeral: boolean;
  callbackPayloadLimitBytes?: number;
  maxTextLength?: number;
}
```

## 3. Telegram Adapter

### 推荐库

- grammY：P0 推荐。
- 或直接使用 Telegram Bot API。
- Vercel Chat SDK Telegram adapter 可在 P2 做对照，不作为 P0 依赖。

### 能力

- 私聊/群聊。
- inline keyboard。
- editMessageText。
- sendDocument。
- callback query。

### 注意事项

- 群聊中需要关闭 Telegram Bot Privacy Mode，或要求用户 mention bot。
- callback data 长度有限，approval payload 不要塞完整 JSON，只塞短 id，例如 `appr_123:allow_once`。
- 长文本要切分。

### 渲染策略

- streaming：维护一个 message ref，每 1-2 秒 edit。
- approval：inline keyboard。
- diff：摘要文本 + P1 文档附件。

## 4. Feishu/Lark Adapter

### 推荐库

`@larksuiteoapi/node-sdk`。

### 推荐连接方式

- P1 优先使用 WSClient / Channel 长连接，不要求 Mac mini 暴露公网 webhook。
- 如果企业环境更适合公网服务，可选 webhook，但不是默认。

### 能力

- message receive。
- reply / send message。
- interactive card。
- card action callback。
- markdown-like rich text。
- media upload。
- 高层 Channel 模块可用于 conversational bots。

### 渲染策略

- streaming：interactive card 状态区更新。
- approval：interactive card buttons。
- diff：卡片展示文件列表和摘要。
- Computer Use：卡片强调风险和 allow/deny。

### 配置要点

```toml
[adapters.lark]
enabled = true
app_id = "cli_xxx"
app_secret_env = "LARK_APP_SECRET"
domain = "feishu" # or "lark"
encrypt_key_env = "LARK_ENCRYPT_KEY"                 # optional env var name
verification_token_env = "LARK_VERIFICATION_TOKEN"   # optional env var name
allowed_chat_ids = ["oc_xxx"]
```

## 5. DingTalk Adapter

### 推荐库

`dingtalk-stream-sdk-nodejs`。

### 推荐连接方式

Stream 模式。

### 能力

- 机器人收消息。
- 事件推送。
- 卡片回调。
- 交互卡片。

### 注意事项

- 部分卡片打字机/流式效果需要“全量更新卡片内容”，不要假设平台支持 append-style streaming。
- 需要处理 Stream reconnect 和 ack。

### 渲染策略

- streaming：卡片全量更新，降低更新频率到 2-3 秒。
- approval：交互卡片按钮。
- fallback：文本 `/approve <id>`。

## 6. Satori/Koishi Adapter P2

### 适用场景

- 想快速覆盖 QQ、企业微信、微信公众平台、LINE、Matrix、更多中文 IM。
- 不追求每个平台最高保真卡片体验。
- 愿意部署 Koishi 作为中间层。

### 拓扑

```text
codex-im-bridge adapter-satori
  -> Satori HTTP API + WebSocket events
  -> Koishi server-satori
  -> Koishi platform adapters
  -> IM platforms
```

### 风险

- 统一协议中的很多字段是 optional。
- approval buttons/card 可能要降级成文本命令。
- 平台原生能力损失。

### 推荐定位

- P2 “覆盖更多平台”的兼容层。
- 不替代飞书/钉钉 native adapter。

## 7. Vercel Chat SDK Adapter P2

### 适用场景

- Slack、Discord、Teams、Google Chat、GitHub、Linear、WhatsApp Business Cloud。
- 希望一套 bot logic 在这些平台复用。

### 不适合作为核心的原因

- 它抽象的是 bot logic，不是 Codex App Server rich runtime。
- 飞书/钉钉不是重点平台。
- Telegram callback payload、history 等限制仍需特殊处理。

### 推荐定位

在 `adapter-chat-sdk` 中实现一个桥：

```text
Chat SDK event/thread/message
  -> ChannelAdapter InboundMessage/InboundAction
RichCard
  -> Chat SDK cards/buttons/post/edit
```

核心代码依然只依赖 `ChannelAdapter`。

## 8. Adapter 开发规范

每个 adapter 必须实现：

- `start/stop`
- `onMessage/onAction`
- `sendText/editText`
- `sendCard/updateCard`
- `capabilities`
- idempotency：重复事件去重
- ack：平台 callback 快速 ack，业务异步处理
- redaction：日志不包含 token/secrets

## 9. 平台能力降级规则

### supportsButtons=false

把 approval 渲染成：

```text
审批 ID: appr_123
/approve appr_123
/deny appr_123
/cancel appr_123
```

### canEditMessage=false

发送新状态消息，但每个 turn 最多每 10 秒一条，避免刷屏。

### supportsCards=false

使用 Markdown/plain text，保留核心字段。

## 10. IM 附件输入

P1 支持用户上传文件：

- 图片：作为 user input attachment 传给 Codex，若 App Server 支持对应 item。
- 文本/日志：下载到临时目录，prompt 中引用。
- 大文件：提示用户放到 project workspace 中再让 Codex 读取。
