/** Encode bytes to base64url (no padding). */
export function toBase64url(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString("base64url");
}

/** Decode base64url string to bytes. Handles both base64url and standard base64. */
export function fromBase64url(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64url"));
}
