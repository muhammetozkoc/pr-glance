#!/usr/bin/env node

import { exitCodeFor, formatReport, inspectPullRequest } from "./github.js";

const HELP = `Usage: pr-glance [--json] <github-pull-request-url>

Options:
  --json    Print machine-readable JSON
  --help    Show this help`;

const args = process.argv.slice(2);
const json = args.includes("--json");
const help = args.includes("--help") || args.includes("-h");
const positional = args.filter((arg) => !arg.startsWith("-"));
const unknown = args.filter((arg) => arg.startsWith("-") && !["--json", "--help", "-h"].includes(arg));

if (help) {
  console.log(HELP);
} else if (unknown.length || positional.length !== 1) {
  if (unknown.length) console.error(`Unknown option: ${unknown[0]}`);
  console.error(HELP);
  process.exitCode = 1;
} else {
  try {
    const report = await inspectPullRequest(positional[0]);
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exitCode = exitCodeFor(report);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
