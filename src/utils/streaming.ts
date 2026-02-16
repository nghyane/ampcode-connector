/** SSE (Server-Sent Events) stream parsing, encoding, and transformation. */

export interface Chunk {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

export function parse(raw: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;

    const chunk: Partial<Chunk> = {};
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        chunk.event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const value = line.slice(5).trimStart();
        chunk.data = chunk.data ? `${chunk.data}\n${value}` : value;
      } else if (line.startsWith("id:")) {
        chunk.id = line.slice(3).trim();
      } else if (line.startsWith("retry:")) {
        const val = parseInt(line.slice(6).trim(), 10);
        if (!isNaN(val)) chunk.retry = val;
      }
    }

    if (chunk.data !== undefined) chunks.push(chunk as Chunk);
  }

  return chunks;
}

export function encode(chunk: Chunk): string {
  let result = "";
  if (chunk.event) result += `event: ${chunk.event}\n`;
  if (chunk.id) result += `id: ${chunk.id}\n`;
  if (chunk.retry !== undefined) result += `retry: ${chunk.retry}\n`;

  for (const line of chunk.data.split("\n")) {
    result += `data: ${line}\n`;
  }

  result += "\n";
  return result;
}

export function transform(
  source: ReadableStream<Uint8Array>,
  fn: (data: string) => string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(raw, controller) {
      buffer += decoder.decode(raw, { stream: true });

      const boundary = buffer.lastIndexOf("\n\n");
      if (boundary === -1) return;

      const complete = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);

      for (const chunk of parse(complete)) {
        chunk.data = fn(chunk.data);
        if (chunk.data) controller.enqueue(encoder.encode(encode(chunk)));
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        for (const chunk of parse(buffer)) {
          chunk.data = fn(chunk.data);
          if (chunk.data) controller.enqueue(encoder.encode(encode(chunk)));
        }
      }
      buffer = "";
    },
  });

  return source.pipeThrough(stream);
}

export function headers(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
}

const forwardedHeaders = [
  "x-request-id",
  "request-id",
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-tokens-limit",
  "anthropic-ratelimit-tokens-remaining",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
] as const;

export function proxy(upstream: Response, rewrite?: (data: string) => string): Response {
  if (!upstream.body) {
    return new Response("No response body", { status: 502 });
  }

  const body = rewrite ? transform(upstream.body, rewrite) : upstream.body;

  const h: Record<string, string> = { ...headers() };
  for (const name of forwardedHeaders) {
    const value = upstream.headers.get(name);
    if (value) h[name] = value;
  }

  return new Response(body, { status: upstream.status, headers: h });
}
