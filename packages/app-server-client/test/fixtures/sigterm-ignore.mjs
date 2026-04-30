#!/usr/bin/env node
// Test fixture: ignores SIGTERM, runs forever. Used to verify SIGKILL grace.
process.on("SIGTERM", () => {
  // Deliberately swallow.
});
process.on("SIGINT", () => {
  // Deliberately swallow.
});
process.stderr.write("sigterm-ignore booted\n");
// Keep the process alive forever.
setInterval(() => {}, 1_000_000);
