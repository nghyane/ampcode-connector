/**
 * Debug script: sends a mock oracle (OpenAI /responses) request to the local proxy
 * and prints raw status, headers, and body to diagnose "Out of Credits" errors.
 *
 * Usage: bun run scripts/debug-oracle.ts [port]
 */

const port = process.argv[2] ?? "7860";
const url = `http://localhost:${port}/api/provider/openai/v1/responses`;

const body = {
  model: "gpt-5.2",
  stream: false,
  input: [{ role: "user", content: "Say hello in one word." }],
};

console.log(`\n>>> POST ${url}`);
console.log(`>>> Body: ${JSON.stringify(body, null, 2)}\n`);

const start = Date.now();
const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(body),
});
const elapsed = Date.now() - start;

console.log(`<<< Status: ${response.status} ${response.statusText}`);
console.log(`<<< Duration: ${elapsed}ms`);
console.log(`<<< Headers:`);
for (const [key, value] of response.headers.entries()) {
  console.log(`<<<   ${key}: ${value}`);
}

const text = await response.text();
console.log(`\n<<< Body (${text.length} bytes):`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
