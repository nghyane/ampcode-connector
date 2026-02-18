/** Temporary localhost HTTP server to receive OAuth callbacks. */

import { logger } from "../utils/logger.ts";

export interface CallbackResult {
  code: string;
  state: string;
}

const DEFAULT_TIMEOUT = 120_000;

export async function waitForCallback(
  preferredPort: number,
  callbackPath: string,
  expectedState: string,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let server: ReturnType<typeof Bun.serve> | null = null;
    let timeoutId: Timer | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (server) {
        server.stop(true);
        server = null;
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`OAuth callback timed out after ${timeout}ms`));
    }, timeout);

    try {
      server = Bun.serve({
        port: preferredPort,
        hostname: "localhost",
        fetch(req) {
          const url = new URL(req.url);
          if (url.pathname !== callbackPath) return new Response("Not found", { status: 404 });

          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const error = url.searchParams.get("error");
          const errorDescription = url.searchParams.get("error_description");

          if (error) {
            cleanup();
            reject(new Error(`OAuth error: ${error} - ${errorDescription ?? "unknown"}`));
            return htmlPage("Authentication Failed", `Error: ${error}. ${errorDescription ?? ""}`);
          }

          if (!code || !state) {
            cleanup();
            reject(new Error("Missing code or state in OAuth callback"));
            return htmlPage("Authentication Failed", "Missing authorization code.");
          }

          if (state !== expectedState) {
            cleanup();
            reject(new Error("State mismatch in OAuth callback (possible CSRF)"));
            return htmlPage("Authentication Failed", "State validation failed.");
          }

          cleanup();
          resolve({ code, state });
          return htmlPage("Authentication Successful", "You can close this window and return to the terminal.");
        },
      });

      logger.debug("Callback server started", { provider: `port:${preferredPort}` });
    } catch (err) {
      cleanup();
      reject(new Error(`Failed to start callback server on port ${preferredPort}: ${err}`));
    }
  });
}

function htmlPage(title: string, message: string): Response {
  const body = `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new Response(body, { headers: { "Content-Type": "text/html" } });
}
