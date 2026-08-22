#!/usr/bin/env node

import { formatReport, inspectPullRequest } from "./github.js";

const [url, ...rest] = process.argv.slice(2);

if (!url || rest.length) {
  console.error("Usage: pr-glance <github-pull-request-url>");
  process.exitCode = 1;
} else {
  try {
    const report = await inspectPullRequest(url);
    console.log(formatReport(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
