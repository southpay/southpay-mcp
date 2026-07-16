import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { errorMessage } from "../messages";
import type { SouthpayClient, ToolResult } from "../southpay";

export type MessageBuilder = (result: ToolResult) => string | undefined;

export interface ToolHost {
  readonly server: McpServer;
  client(): SouthpayClient | null;
  baseUrl(): string;
  sessionKey(): string | null;
  setSessionKey(key: string | null): void;
  coingeckoApiKey(): string | undefined;
}

export const NOT_CONNECTED: ToolResult = {
  error: "not_connected",
  detail: "Send your Southpay agent key as a Bearer token or call login.",
};

export function ok(result: ToolResult, buildMessage?: MessageBuilder) {
  const message = result.error ? errorMessage(result) : buildMessage?.(result);
  const structuredContent = message ? { message, ...result } : result;
  const text = message ?? JSON.stringify(structuredContent);

  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}
