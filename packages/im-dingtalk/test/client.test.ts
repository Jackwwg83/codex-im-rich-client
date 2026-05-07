import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DINGTALK_TOPIC_CARD,
  DINGTALK_TOPIC_ROBOT,
  type DingTalkAllEventHandler,
  type DingTalkDwClientLike,
  type DingTalkStreamEventHandler,
  createDingTalkOpenApiCardClient,
  createDingTalkRobotFileClient,
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
    let allEventHandler: DingTalkAllEventHandler | undefined;
    const dwClient: DingTalkDwClientLike = {
      registerCallbackListener(topic, handler) {
        calls.push({ method: "register", topic });
        if (topic === DINGTALK_TOPIC_ROBOT) {
          robotHandler = handler;
        }
        return this;
      },
      registerAllEventListener(handler) {
        calls.push({ method: "registerAllEvent" });
        allEventHandler = handler;
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
    client.registerAllEventListener?.(() => {});
    await client.connect();
    await client.ackCallback?.("stream_msg_ack_001");
    await client.disconnect();

    expect(robotHandler).toBeDefined();
    expect(allEventHandler).toBeDefined();
    expect(calls).toEqual([
      { method: "register", topic: DINGTALK_TOPIC_ROBOT },
      { method: "register", topic: DINGTALK_TOPIC_CARD },
      { method: "registerAllEvent" },
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

  it("uploads image bytes and sends them through the session reply URL", async () => {
    const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const client = createDingTalkSessionReplyTextClient({
      clientId: "ding_test_client_id",
      clientSecret: "ding_test_secret",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
          return jsonResponse({ accessToken: "token_for_media", expireIn: 7200 });
        }
        if (String(url).startsWith("https://oapi.dingtalk.com/media/upload")) {
          return jsonResponse({ errcode: 0, media_id: "@media_image_001" });
        }
        return jsonResponse({ errcode: 0, messageId: "ding_media_msg_001" });
      },
    });

    await expect(
      client.sendFile?.({
        sessionWebhook: "https://dingtalk.example.test/session-reply",
        file: {
          filename: "diagram.png",
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
        },
      }),
    ).resolves.toEqual({ messageId: "ding_media_msg_001" });

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ["https://api.dingtalk.com/v1.0/oauth2/accessToken", "POST"],
      ["https://oapi.dingtalk.com/media/upload?access_token=token_for_media&type=image", "POST"],
      ["https://dingtalk.example.test/session-reply", "POST"],
    ]);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      msgtype: "image",
      image: { media_id: "@media_image_001" },
    });
    expect(String(calls[1]?.init?.body)).not.toContain("ding_test_secret");
  });

  it("downloads robot message files through redacted downloadCode exchange", async () => {
    const attachmentDir = await mkdtemp(join(tmpdir(), "codex-im-dingtalk-client-test-"));
    const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const client = createDingTalkRobotFileClient({
      clientId: "ding_test_client_id",
      clientSecret: "ding_test_secret",
      robotCode: "ding_test_robot",
      attachmentDir,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
          return jsonResponse({ accessToken: "token_for_download", expireIn: 7200 });
        }
        if (String(url).endsWith("/v1.0/robot/messageFiles/download")) {
          return jsonResponse({ downloadUrl: "https://download.dingtalk.test/file" });
        }
        return new Response("hello from dingtalk file", { status: 200 });
      },
      now: () => 1778133000000,
      randomId: () => "fixed",
    });

    await expect(
      client.downloadMessageFile({
        downloadCode: "download_code_must_not_leak",
        filename: "../diagram.png",
        contentType: "image/png",
        kind: "image",
      }),
    ).resolves.toMatchObject({
      localPath: join(attachmentDir, "1778133000000-fixed-diagram.png"),
      sizeBytes: 24,
    });

    await expect(
      readFile(join(attachmentDir, "1778133000000-fixed-diagram.png"), "utf8"),
    ).resolves.toBe("hello from dingtalk file");
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ["https://api.dingtalk.com/v1.0/oauth2/accessToken", "POST"],
      ["https://api.dingtalk.com/v1.0/robot/messageFiles/download", "POST"],
      ["https://download.dingtalk.test/file", "GET"],
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      downloadCode: "download_code_must_not_leak",
      robotCode: "ding_test_robot",
    });
    expect(join(attachmentDir, "1778133000000-fixed-diagram.png")).not.toContain(
      "download_code_must_not_leak",
    );
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
      card: {
        ...CARD,
        status: "resolved",
        body: [{ type: "markdown", text: "**Status:** resolved" }],
        actions: [],
      },
    });

    expect(sent).toEqual({ messageId: "codex-im-fixed" });
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ["https://dingtalk.example.test/v1.0/oauth2/accessToken", "POST"],
      ["https://dingtalk.example.test/v1.0/card/instances/createAndDeliver", "POST"],
      ["https://dingtalk.example.test/v1.0/card/instances", "PUT"],
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      callbackType: "STREAM",
      userIdType: 1,
      callbackRouteKey: "codex_im",
      cardTemplateId: "ding_test_template",
      outTrackId: "codex-im-fixed",
      openSpaceId: "dtv1.card//IM_GROUP.cid_card_group",
      imGroupOpenDeliverModel: { robotCode: "ding_test_robot" },
      cardData: {
        cardParamMap: {
          title: "Codex approval",
          type: "command_execution",
          amount: "high",
          reason: "Run pnpm test",
          status: "待处理",
          content: expect.stringContaining("Run pnpm test"),
          flowStatus: "1",
          selectedIndex: "",
          action_1_value: "v1:ABCDEFGHIJKLMNOP",
          action_2_value: "",
          action_4_value: "",
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
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      cardData: {
        cardParamMap: {
          status: "已处理",
          flowStatus: "3",
        },
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
      userId: "staff_test_private",
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

  it("surfaces string OpenAPI error codes for DingTalk platform diagnostics", async () => {
    const client = createDingTalkOpenApiCardClient(
      {
        clientId: "ding_test_client_id",
        clientSecret: "secret-must-not-leak",
        robotCode: "ding_test_robot",
        cardTemplateId: "template-must-not-leak",
        baseUrl: "https://dingtalk.example.test",
      },
      {
        fetch: async (url) => {
          if (String(url).endsWith("/v1.0/oauth2/accessToken")) {
            return jsonResponse({ accessToken: "token-must-not-leak", expireIn: 7200 });
          }
          return jsonResponse(
            { code: "param.templateNotExist", message: "ignored" },
            { status: 400 },
          );
        },
      },
    );

    await expect(
      client.sendCard({
        target: { platform: "dingtalk", chatId: "cid_card_group" },
        card: CARD,
      }),
    ).rejects.toThrow(
      "DingTalk OpenAPI createAndDeliver failed with HTTP 400 code param.templateNotExist",
    );
  });

  it("fails closed when createAndDeliver reports failed delivery results", async () => {
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
          return jsonResponse({
            success: true,
            result: {
              outTrackId: "codex-im-delivery-failed",
              deliverResults: [
                {
                  success: false,
                  spaceType: "IM_ROBOT",
                  errorCode: "spaces.empty",
                  errorMsg: "message may contain private ids and must not be surfaced",
                },
              ],
            },
          });
        },
      },
    );

    await expect(
      client.sendCard({
        target: { platform: "dingtalk", chatId: "staff_test_private" },
        card: CARD,
      }),
    ).rejects.toThrow(
      "DingTalk OpenAPI createAndDeliver failed with deliverResult failure spaceType IM_ROBOT code spaces.empty",
    );
  });

  it("fails closed when OpenAPI returns success=false without HTTP failure", async () => {
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
          return jsonResponse({ success: false });
        },
      },
    );

    await expect(
      client.sendCard({
        target: { platform: "dingtalk", chatId: "staff_test_private" },
        card: CARD,
      }),
    ).rejects.toThrow("DingTalk OpenAPI createAndDeliver failed with success=false");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}
