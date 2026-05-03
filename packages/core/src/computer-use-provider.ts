import type { DynamicToolCallParams, DynamicToolCallResponse } from "@codex-im/protocol";
import type { AuditEmitter } from "./audit.js";

export type ComputerUseProviderRequest = {
  readonly params: DynamicToolCallParams;
  readonly app: string;
};

export interface ComputerUseProvider {
  execute(request: ComputerUseProviderRequest): Promise<DynamicToolCallResponse>;
}

export type ComputerUseProviderAudit = Pick<AuditEmitter, "emit">;

export class UnsupportedComputerUseProvider implements ComputerUseProvider {
  readonly #audit: ComputerUseProviderAudit | undefined;

  constructor(opts: { readonly audit?: ComputerUseProviderAudit } = {}) {
    this.#audit = opts.audit;
  }

  async execute(request: ComputerUseProviderRequest): Promise<DynamicToolCallResponse> {
    this.#audit?.emit({
      kind: "computer_use.provider_unavailable",
      metadata: {
        app: request.app,
        callId: request.params.callId,
        namespace: request.params.namespace,
        tool: request.params.tool,
      },
    });
    return { contentItems: [], success: false };
  }
}

export class FakeComputerUseProvider implements ComputerUseProvider {
  readonly #response: DynamicToolCallResponse;
  readonly #calls: ComputerUseProviderRequest[] = [];

  constructor(response: DynamicToolCallResponse = { contentItems: [], success: true }) {
    this.#response = response;
  }

  async execute(request: ComputerUseProviderRequest): Promise<DynamicToolCallResponse> {
    this.#calls.push(request);
    return this.#response;
  }

  calls(): readonly ComputerUseProviderRequest[] {
    return [...this.#calls];
  }
}
