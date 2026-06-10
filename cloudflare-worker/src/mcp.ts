import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

import { INSTRUCTIONS } from "./instructions";
import { DEFAULT_BASE_URL, SouthpayClient } from "./southpay";
import { registerAccountTools } from "./tools/account";
import { registerPaymentTools } from "./tools/payments";
import { registerPayoutTools } from "./tools/payouts";
import { registerResearchTools } from "./tools/research";
import { registerSessionTools } from "./tools/session";
import { registerTokenTools } from "./tools/tokens";
import type { ToolHost } from "./tools/runtime";

type Env = {
  SOUTHPAY_BASE_URL?: string;
};

type State = {
  apiKey: string | null;
};

type Props = {
  agentKey?: string;
};

export class SouthpayMCP extends McpAgent<Env, State, Props> implements ToolHost {
  server = new McpServer(
    { name: "southpay-mcp", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  initialState: State = { apiKey: null };

  baseUrl(): string {
    return (this.env.SOUTHPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  sessionKey(): string | null {
    return this.state.apiKey;
  }

  setSessionKey(key: string | null): void {
    this.setState({ apiKey: key });
  }

  client(): SouthpayClient | null {
    const key = this.state.apiKey ?? this.props?.agentKey ?? null;
    if (!key) return null;

    return new SouthpayClient(key, this.baseUrl());
  }

  async init() {
    registerSessionTools(this);
    registerAccountTools(this);
    registerPaymentTools(this);
    registerTokenTools(this);
    registerPayoutTools(this);
    registerResearchTools(this);
  }
}
