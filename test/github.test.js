import assert from "node:assert/strict";
import test from "node:test";

import {
  exitCodeFor,
  formatReport,
  getVerdict,
  inspectPullRequest,
  parsePullRequestUrl,
} from "../src/github.js";

test("parses a GitHub pull request URL", () => {
  assert.deepEqual(parsePullRequestUrl("https://github.com/pacifio/atlas/pull/183"), {
    owner: "pacifio",
    repo: "atlas",
    number: 183,
  });
});

test("rejects unrelated URLs", () => {
  assert.throws(
    () => parsePullRequestUrl("https://example.com/pacifio/atlas/pull/183"),
    /github\.com/,
  );
});

function fakeFetch(responses) {
  return async (input) => {
    const url = new URL(input);
    const body = responses.get(`${url.pathname}${url.search}`);
    return new Response(JSON.stringify(body ?? { message: "Not Found" }), {
      status: body === undefined ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function apiResponses({ workflowRuns = [], checkRuns = [], statuses = [] } = {}) {
  return new Map([
    [
      "/repos/acme/widget/pulls/7",
      {
        title: "Keep the cache warm",
        html_url: "https://github.com/acme/widget/pull/7",
        user: { login: "ada" },
        draft: false,
        state: "open",
        merged: false,
        mergeable: true,
        mergeable_state: "clean",
        changed_files: 2,
        head: { sha: "abc123" },
      },
    ],
    [
      "/repos/acme/widget/pulls/7/reviews?per_page=100",
      [
        { user: { login: "linus" }, state: "CHANGES_REQUESTED" },
        { user: { login: "linus" }, state: "APPROVED" },
      ],
    ],
    ["/repos/acme/widget/commits/abc123/check-runs?per_page=100", { check_runs: checkRuns }],
    ["/repos/acme/widget/commits/abc123/status?per_page=100", { statuses }],
    ["/repos/acme/widget/actions/runs?head_sha=abc123&per_page=100", { workflow_runs: workflowRuns }],
  ]);
}

test("marks a clean pull request as ready", async () => {
  const report = await inspectPullRequest("https://github.com/acme/widget/pull/7", {
    fetchImpl: fakeFetch(apiResponses()),
  });

  assert.equal(report.verdict.status, "ready");
  assert.deepEqual(report.reviews.approved, ["linus"]);
  assert.equal(exitCodeFor(report), 0);
  assert.match(formatReport(report), /^READY  acme\/widget#7/);
});

test("shows workflows that need maintainer approval", async () => {
  const report = await inspectPullRequest("https://github.com/acme/widget/pull/7", {
    fetchImpl: fakeFetch(
      apiResponses({
        workflowRuns: [{ name: "CI", status: "completed", conclusion: "action_required" }],
      }),
    ),
  });

  assert.equal(report.verdict.status, "waiting");
  assert.deepEqual(report.workflows.actionRequired, ["CI"]);
  assert.match(formatReport(report), /workflow approval needed: CI/);
  assert.equal(exitCodeFor(report), 2);
});

test("marks failed checks as blocked", () => {
  const report = {
    state: "open",
    merged: false,
    draft: false,
    mergeable: true,
    mergeableState: "unstable",
    reviews: { approved: [], changesRequested: [] },
    checks: { total: 1, pending: [], failed: ["test"] },
    statuses: { total: 0, pending: [], failed: [] },
    workflows: { total: 0, pending: [], actionRequired: [], failed: [] },
  };

  assert.deepEqual(getVerdict(report), { status: "blocked", reasons: ["failed: test"] });
});
