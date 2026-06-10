import { accountMessage } from "../messages";
import { asData } from "../southpay";
import { NOT_CONNECTED, ok, type ToolHost } from "./runtime";

export function registerAccountTools(host: ToolHost) {
  host.server.registerTool(
    "get_account",
    {
      description:
        "Identity of the store and agent this credential is connected to (whoami). " +
        "Returns the store id/name and KYC status, whether this is live or test mode, " +
        "the agent credential's name/principal/scopes/token prefix, the authorization " +
        "provider in effect (and whether mandates are required), and how many payment " +
        "assets the store accepts. Use this to answer questions like 'what store am I " +
        "connected to?', 'what can I do?' (scopes), or 'am I in live or test mode?'.",
      inputSchema: {},
    },
    async () => {
      const client = host.client();
      if (!client) return ok(NOT_CONNECTED);

      return ok(await asData(() => client.getAccount()), accountMessage);
    },
  );
}
