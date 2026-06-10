import { SouthpayMCP } from "./mcp";

export { SouthpayMCP };

type Env = {
  SouthpayMCP: DurableObjectNamespace;
  SOUTHPAY_BASE_URL?: string;
};

function agentKeyFromRequest(request: Request): string | undefined {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === "" ? undefined : token;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("southpay-mcp", { status: 200 });
    }

    if (url.pathname.startsWith("/mcp")) {
      (ctx as ExecutionContext & { props: unknown }).props = {
        agentKey: agentKeyFromRequest(request),
      };
      return SouthpayMCP.serve("/mcp", { binding: "SouthpayMCP" }).fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
