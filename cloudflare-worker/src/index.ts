import OAuthProvider from "@cloudflare/workers-oauth-provider";

import { SouthpayMCP } from "./mcp";
import { oauthDefaultHandler, type OAuthEnv } from "./oauth-handler";

export { SouthpayMCP };

type Env = OAuthEnv & {
  SouthpayMCP: DurableObjectNamespace;
};

const mcpHandler = SouthpayMCP.serve("/mcp", { binding: "SouthpayMCP" });

// The provider issues this worker's own tokens to MCP clients (with metadata
// discovery and dynamic client registration, which clients like claude.ai
// require) and puts the grant's props on ctx.props for API requests. The
// browser-facing half of the flow lives in oauth-handler.ts.
const provider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: { fetch: (request, env, ctx) => mcpHandler.fetch(request, env as Env, ctx) },
  defaultHandler: { fetch: (request, env) => oauthDefaultHandler(request, env as Env) },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

function agentKeyFromRequest(request: Request): string | undefined {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return /^spa_(?:live|test)_/.test(token) ? token : undefined;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);

    // A raw agent key as the Bearer token skips OAuth entirely: the key is
    // validated by Southpay on every API call, exactly as before.
    const agentKey = agentKeyFromRequest(request);
    if (agentKey && url.pathname.startsWith("/mcp")) {
      (ctx as ExecutionContext & { props: unknown }).props = { agentKey };
      return mcpHandler.fetch(request, env, ctx);
    }

    return provider.fetch(request, env, ctx);
  },
};
