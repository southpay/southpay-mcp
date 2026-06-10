import { z } from "zod";

import { loginMessage } from "../messages";
import { SouthpayClient, SouthpayError } from "../southpay";
import { ok, type ToolHost } from "./runtime";

export function registerSessionTools(host: ToolHost) {
  host.server.registerTool(
    "login",
    {
      description:
        "Connect this session to a Southpay store by pasting an agent API key. " +
        "Pass your scoped agent credential (it starts with spa_live_ or spa_test_). " +
        "The key is held for this session only and is not written to disk, then used " +
        "for every other tool. Returns the connected store, mode, and scopes. For a " +
        "live key prefer the Bearer token instead, since a key pasted here passes " +
        "through the model context.",
      inputSchema: {
        api_key: z.string().describe("The Southpay agent credential to use for this session."),
      },
    },
    async ({ api_key }) => {
      const key = api_key.trim();
      if (!key.startsWith("spa_live_") && !key.startsWith("spa_test_")) {
        return ok({
          error: "invalid_key",
          detail: "Expected a key starting with spa_live_ or spa_test_.",
        });
      }

      try {
        const account = await new SouthpayClient(key, host.baseUrl()).getAccount();
        host.setSessionKey(key);
        return ok({ logged_in: true, account }, loginMessage);
      } catch (err) {
        if (err instanceof SouthpayError) {
          return ok({ error: "login_failed", status: err.status, detail: err.body });
        }
        return ok({ error: "login_failed", detail: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  host.server.registerTool(
    "logout",
    {
      description: "Forget the agent key pasted for this session.",
      inputSchema: {},
    },
    async () => {
      const existed = host.sessionKey() !== null;
      host.setSessionKey(null);
      return ok({ logged_out: existed });
    },
  );
}
