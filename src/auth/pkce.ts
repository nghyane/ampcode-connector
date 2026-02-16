/** PKCE (Proof Key for Code Exchange) — S256 challenge for all OAuth flows. */

import { toBase64url } from "../utils/encoding.ts";

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(96);
  crypto.getRandomValues(verifierBytes);
  const verifier = toBase64url(verifierBytes);

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = toBase64url(new Uint8Array(hashBuffer));

  return { verifier, challenge };
}

export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
