/** Centralized model name mapping: Amp CLI model → provider API model.
 *  Amp's proxy may use aliased model names that differ from the provider's API.
 *  This module resolves the correct model name and provides the serialized body. */

/** Suffix patterns stripped when forwarding to the real provider API. */
const STRIP_SUFFIXES = ["-api-preview"] as const;

/** Resolve the model name the provider API expects.
 *  Returns the original if no mapping applies. */
export function resolveModel(ampModel: string): string {
  for (const suffix of STRIP_SUFFIXES) {
    if (ampModel.endsWith(suffix)) return ampModel.slice(0, -suffix.length);
  }
  return ampModel;
}

/** Return body string with provider model name substituted.
 *  Shallow-copies parsed to avoid mutating the shared ParsedBody.parsed reference. */
export function rewriteBodyModel(parsed: Record<string, unknown>, providerModel: string): string {
  return JSON.stringify({ ...parsed, model: providerModel });
}
