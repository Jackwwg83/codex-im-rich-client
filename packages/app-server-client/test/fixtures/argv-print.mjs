#!/usr/bin/env node
// Test fixture: prints process.argv as a single JSON line on stdout, then exits.
// Used to verify StdioTransport.configOverrides translation.
process.stdout.write(`${JSON.stringify({ argv: process.argv.slice(2) })}\n`);
process.exit(0);
