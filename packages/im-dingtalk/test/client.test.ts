import { describe, expect, it } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkDwClientLike,
  type DingTalkStreamEventHandler,
  createDingTalkOpenApiCardClient,
  createDingTalkSessionReplyTextClient,
  createDingTalkStreamClient,
  renderDingTalkApprovalCard,
} from "../src/index.js";

const CARD = renderDingTalkApprovalCard({
  schemaVersion: "approval-card.v1",
  kind: "command_execution",
  approvalId: "approval-must-not-be-sent",
  summary: "Run pnpm test",
  target: { riskLevel: "high" },
  actions: [{ kind: "allow_once", wirePayload: "v1:ABCDEFGHIJKLMNOP" }],
  status: "pending",
  createdAt: new Date(0),
});

describe("DingTalk Stream client wrapper (JAC-90 P1 fix)", () => {
  it("adapts DWClient registration, lifecycle, and callback ack into the adapter surface", async () => {
    const calls: unknown[] = [];
    let robotHandler: DingTalkStreamEventHandler | undefined;
    const dwClient: DingTalkDwClientLike = {
      registerCallbackListener(topic, handler) {
        calls.push({ method: "register", topic });
        if (topic === DINGTALK_TOPIC_ROBOT) {
          robotHandler = handler;
        }
        return this;
      },
      async connect() {
        calls.push({ method: "connect" });
      },
      disconnect() {
        calls.push({ method: "disconnect" });
      },
      socketCallBackResponse(messageId, result) {
        calls.push({ method: "ack", messageId, result });
      },
    };

    const client = createDingTalkStreamClient(
      {
        clientId: "ding_test_client_id",
        clientSecret: "present_value",
        ua: "codex-im-test",
      },
      { createClient: () => dwClient },
    );

    client.registerCallbackListener(DINGTALK_TOPIC_ROBOT, () => {});
    client.registerCallbackListener(DINGTALK_TOPIC_CARD, () => {});
    await client.connect();
    await client.ackCallback?.("stream_msg_ack_001");
    await client.disconnect();

    expect(robotHandler).toBeDefined();
    expect(calls).toEqual([
      { method: "register", topic: DINGTALK_TOPIC_ROBOT },
      { method: "register", topic: DINGTALK_TOPIC_CARD },
      { method: "connect" },
      { method: "ack", messageId: "stream_msg_ack_001", result: { status: "SUCCESS" } },
      { method: "disconnect" },
    ]);
  });

  it("sends text through a session reply URL without exposing credentials", async () => {
    const calls: unknown[] = [];
    const client = createDingTalkSessionReplyTextClient({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ errcode: 0, messageId: "ding_reply_msg_001" }), {
          status: 200,
        });
      },
    });

    await expect(
      client.sendText({
        sessionWebhook: "https://dingtalk.example.test/session-reply",
        text: "Codex is working...",
      }),
    ).resolves.toEqual({ messageId: "ding_reply_msg_001" });

    expect(calls).toEqual([
      {
        url: "https://dingtalk.example.test/session-reply",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            msgtype: "text",
            text: { content: "Codex is working..." },
          }),
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain("clientSecret");
  });
});

describe("DingTalk OpenAPI card client", () => {
  it("gets a token, creates group cards, and updates by outTrackId", async () => {
    const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const client = createDingTalkOpenApiCardClient(
      {
        clientId: "ding_test_client_id",
        clientSecret: "ding_test_secret",
        robotCode: "ding_test_robot",
        cardTemplateId: "ding_test_template",
        callbackRouteKey: "codex_im",
        baseUrl: "https://dingtalk.example.test",
      },
      {
        now: () => 0,
        randomId: () => "fixed",
        fetch: async (url, init) => {
          calls.push({ url: String(url), init });
          if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
            return jsonResponse({ accessToken: "token_for_test", expireIn: 7200 });
          }
          if (String(url).endsWith("/v1.0/card/instances/createAndDeliver")) {
            return jsonResponse({ success: true, result: { outTrackId: "codex-im-fixed" } });
          }
          return jsonResponse({ success: true, result: true });
        },
      },
    );

    const sent = await client.sendCard({
      target: { platform: "dingtalk", chatId: "cid_card_group" },
      card: CARD,
    });
    await client.updateCard({
      messageRef: {
        target: { platform: "dingtalk", chatId: "cid_card_group" },
        messageId: sent.messageId,
      },
      card: { ...CARD, body: [{ type: "markdown", text: "**Status:** resolved" }], actions: [] },
    });

    expect(sent).toEqual({ messageId: "codex-im-fixed" });
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ["https://dingtalk.example.test/v1.0/oauth2/accessToken", "POST"],
      ["https://dingtalk.example.test/v1.0/card/instances/createAndDeliver", "POST"],
      ["https://dingtalk.example.test/v1.0/card/instances", "PUT"],
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      callbackType: "STREAM",
      callbackRouteKey: "codex_im",
      cardTemplateId: "ding_test_template",
      outTrackId: "codex-im-fixed",
      openSpaceId: "dtv1.card//IM_GROUP.cid_card_group",
      imGroupOpenDeliverModel: { robotCode: "ding_test_robot" },
      cardData: {
        cardParamMap: {
          title: "Codex approval",
          action_1_value: "v1:ABCDEFGHIJKLMNOP",
        },
      },
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      outTrackId: "codex-im-fixed",
      cardUpdateOptions: {
        updateCardDataByKey: true,
        updatePrivateDataByKey: true,
      },
    });
    expect(String(calls[1]?.init?.headers)).not.toContain("ding_test_secret");
  });

  it("maps non-cid targets to IM_ROBOT open spaces for private card delivery", async () => {
    const bodies: unknown[] = [];
    const client = createDingTalkOpenApiCardClient(
      {
        clientId: "ding_test_client_id",
        clientSecret: "ding_test_secret",
        robotCode: "ding_test_robot",
        cardTemplateId: "ding_test_template",
        baseUrl: "https://dingtalk.example.test",
      },
      {
        randomId: () => "private",
        fetch: async (url, init) => {
          if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
            return jsonResponse({ accessToken: "token_for_test", expireIn: 7200 });
          }
          bodies.push(JSON.parse(String(init?.body)));
          return jsonResponse({ success: true, result: { outTrackId: "codex-im-private" } });
        },
      },
    );

    await client.sendCard({
      target: { platform: "dingtalk", chatId: "staff_test_private" },
      card: CARD,
    });

    expect(bodies[0]).toMatchObject({
      openSpaceId: "dtv1.card//IM_ROBOT.staff_test_private",
      imRobotOpenDeliverModel: { robotCode: "ding_test_robot", spaceType: "IM_ROBOT" },
    });
  });

  it("surfaces sanitized OpenAPI failures without token or secret bytes", async () => {
    const client = createDingTalkOpenApiCardClient(
      {
        clientId: "ding_test_client_id",
        clientSecret: "secret-must-not-leak",
        robotCode: "ding_test_robot",
        cardTemplateId: "ding_test_template",
        baseUrl: "https://dingtalk.example.test",
      },
      {
        fetch: async (url) => {
          if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
            return jsonResponse({ accessToken: "token-must-not-leak", expireIn: 7200 });
          }
          return jsonResponse({ code: 403 }, { status: 403 });
        },
      },
    );

    let error: unknown;
    try {
      await client.sendCard({
        target: { platform: "dingtalk", chatId: "cid_card_group" },
        card: CARD,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "DingTalk OpenAPI createAndDeliver failed with HTTP 403; check Card.Instance.Write permission, card template access, and delivery target",
    );
    expect((error as Error).message).not.toContain("secret-must-not-leak");
    expect((error as Error).message).not.toContain("token-must-not-leak");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}
