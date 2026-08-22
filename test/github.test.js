import assert from "node:assert/strict";
import test from "node:test";

import { formatReport, inspectPullRequest, parsePullRequestUrl } from "../src/github.js";

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

test("fetches and summarizes pull request data", async () => {
  const responses = new Map([
    [
      "/repos/acme/widget/pulls/7",
      {
        title: "Keep the cache warm",
        html_url: "https://github.com/acme/widget/pull/7",
        user: { login: "ada" },
        draft: false,
        state: "open",
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
    [
      "/repos/acme/widget/commits/abc123/check-runs?per_page=100",
      {
        check_runs: [
          { name: "test", status: "completed", conclusion: "success" },
          { name: "lint", status: "in_progress", conclusion: null },
        ],
      },
    ],
  ]);

  const fetchImpl = async (input) => {
    const url = new URL(input);
    const body = responses.get(`${url.pathname}${url.search}`);
    return new Response(JSON.stringify(body), {
      status: body === undefined ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  };

  const report = await inspectPullRequest("https://github.com/acme/widget/pull/7", {
    fetchImpl,
  });

  assert.deepEqual(report.reviews.approved, ["linus"]);
  assert.deepEqual(report.reviews.changesRequested, []);
  assert.equal(report.checks.pending, 1);
  assert.match(formatReport(report), /Mergeable: yes \(clean\)/);
});
