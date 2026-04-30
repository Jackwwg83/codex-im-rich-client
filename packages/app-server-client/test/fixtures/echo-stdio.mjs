#!/usr/bin/env node
// Test fixture: a tiny "JSON-RPC echo" server used by StdioTransport tests.
// Reads JSONL on stdin, for each {id, method, ...} line emits
// {id, result: { echoed: method }} on stdout. Writes a single boot
// notice to stderr so the stderr-routing test has something to consume.

import readline from "node:readline";

process.stderr.write("echo-stdio booted\n");

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const m = JSON.parse(line);
    if (m && typeof m === "object" && "id" in m && typeof m.method === "string") {
      process.stdout.write(`${JSON.stringify({ id: m.id, result: { echoed: m.method } })}\n`);
      return;
    }
    // For other shapes (notifications, etc.), echo them back verbatim.
    process.stdout.write(`${line}\n`);
  } catch (err) {
    process.stderr.write(`echo-stdio parse error: ${err.message}\n`);
  }
});

rl.on("close", () => {
  process.exit(0);
});
