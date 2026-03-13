import type { SpecialistResult, TradeDecision, UserRequest, UserResponsePayload } from "../types.js";

export function buildSpecialistResponse(
  request: UserRequest,
  specialist: SpecialistResult,
): UserResponsePayload {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    message: specialist.message,
    blocks: [
      {
        type: "markdown",
        title: specialist.role,
        content: specialist.message,
        toolCalls: specialist.toolCalls,
      },
    ],
    actions: [],
  };
}

export function buildTradePreviewResponse(
  request: UserRequest,
  preview: TradeDecision,
): UserResponsePayload {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    message: preview.rationale,
    blocks: [
      {
        type: "json",
        title: "trade_preview",
        content: preview,
      },
    ],
    actions: [],
  };
}

export function buildIdleResponse(request: UserRequest): UserResponsePayload {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    message:
      "stock-claw is running. Ask for stock research, portfolio review, paper trade support, or system ops such as MCP/LLM configuration.",
    blocks: [],
    actions: [],
  };
}
