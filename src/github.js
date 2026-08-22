const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const FAILING_STATUS_STATES = new Set(["error", "failure"]);

export function parsePullRequestUrl(input) {
  let url;

  try {
    url = new URL(input);
  } catch {
    throw new Error("Expected a full GitHub pull request URL.");
  }

  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("The URL must point to github.com.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const number = Number(parts[3]);

  if (parts.length < 4 || parts[2] !== "pull" || !Number.isInteger(number) || number < 1) {
    throw new Error("Expected a URL like https://github.com/owner/repo/pull/123.");
  }

  return { owner: parts[0], repo: parts[1], number };
}

function requestHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-glance",
  };

  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson(path, { token, fetchImpl }) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: requestHeaders(token),
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body.message) message = body.message;
    } catch {
      // Keep the HTTP status when GitHub does not return JSON.
    }
    throw new Error(`GitHub API: ${message}`);
  }

  return response.json();
}

function latestReviewsByUser(reviews) {
  const latest = new Map();

  for (const review of reviews) {
    if (!review.user?.login || review.state === "PENDING") continue;
    latest.set(review.user.login, review.state);
  }

  return [...latest.entries()].map(([login, state]) => ({ login, state }));
}

function summarizeChecks(checkRuns, commitStatuses, workflowRuns) {
  const checks = {
    total: checkRuns.length,
    pending: checkRuns.filter((check) => check.status !== "completed").map((check) => check.name),
    failed: checkRuns
      .filter(
        (check) =>
          check.status === "completed" &&
          check.conclusion !== "action_required" &&
          !PASSING_CONCLUSIONS.has(check.conclusion),
      )
      .map((check) => check.name),
  };

  const statuses = {
    total: commitStatuses.length,
    pending: commitStatuses.filter((status) => status.state === "pending").map((status) => status.context),
    failed: commitStatuses
      .filter((status) => FAILING_STATUS_STATES.has(status.state))
      .map((status) => status.context),
  };

  const workflows = {
    total: workflowRuns.length,
    pending: workflowRuns.filter((run) => run.status !== "completed").map((run) => run.name),
    actionRequired: workflowRuns
      .filter((run) => run.conclusion === "action_required")
      .map((run) => run.name),
    failed: workflowRuns
      .filter(
        (run) =>
          run.status === "completed" &&
          run.conclusion !== "action_required" &&
          !PASSING_CONCLUSIONS.has(run.conclusion),
      )
      .map((run) => run.name),
  };

  return { checks, statuses, workflows };
}

export function getVerdict(report) {
  if (report.merged) return { status: "merged", reasons: [] };
  if (report.state !== "open") return { status: "closed", reasons: [] };

  const blocked = [];
  const waiting = [];

  if (report.draft) waiting.push("pull request is still a draft");
  if (report.mergeable === null) waiting.push("GitHub is still calculating mergeability");
  if (report.mergeable === false || report.mergeableState === "dirty") {
    blocked.push("branch has merge conflicts");
  }
  if (report.mergeableState === "behind") waiting.push("branch is behind the base branch");
  if (report.mergeableState === "blocked") waiting.push("repository requirements are not met yet");

  if (report.reviews.changesRequested.length) {
    blocked.push(`changes requested by ${report.reviews.changesRequested.join(", ")}`);
  }

  const failed = [
    ...report.checks.failed,
    ...report.statuses.failed,
    ...report.workflows.failed,
  ];
  if (failed.length) blocked.push(`failed: ${[...new Set(failed)].join(", ")}`);

  const pending = [
    ...report.checks.pending,
    ...report.statuses.pending,
    ...report.workflows.pending,
  ];
  if (pending.length) waiting.push(`still running: ${[...new Set(pending)].join(", ")}`);

  if (report.workflows.actionRequired.length) {
    waiting.push(`workflow approval needed: ${report.workflows.actionRequired.join(", ")}`);
  }

  if (blocked.length) return { status: "blocked", reasons: blocked };
  if (waiting.length) return { status: "waiting", reasons: waiting };
  return { status: "ready", reasons: [] };
}

export async function inspectPullRequest(
  input,
  { token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {},
) {
  const { owner, repo, number } = parsePullRequestUrl(input);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const pull = await getJson(`${base}/pulls/${number}`, { token, fetchImpl });
  const sha = pull.head.sha;

  const [reviews, checkResponse, statusResponse, workflowResponse] = await Promise.all([
    getJson(`${base}/pulls/${number}/reviews?per_page=100`, { token, fetchImpl }),
    getJson(`${base}/commits/${sha}/check-runs?per_page=100`, { token, fetchImpl }),
    getJson(`${base}/commits/${sha}/status?per_page=100`, { token, fetchImpl }),
    getJson(`${base}/actions/runs?head_sha=${sha}&per_page=100`, { token, fetchImpl }),
  ]);

  const reviewSummary = latestReviewsByUser(reviews);
  const summaries = summarizeChecks(
    checkResponse.check_runs ?? [],
    statusResponse.statuses ?? [],
    workflowResponse.workflow_runs ?? [],
  );

  const report = {
    repository: `${owner}/${repo}`,
    number,
    title: pull.title,
    url: pull.html_url,
    author: pull.user?.login ?? "unknown",
    draft: Boolean(pull.draft),
    state: pull.state,
    merged: Boolean(pull.merged),
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state,
    changedFiles: pull.changed_files,
    reviews: {
      approved: reviewSummary.filter((review) => review.state === "APPROVED").map((review) => review.login),
      changesRequested: reviewSummary
        .filter((review) => review.state === "CHANGES_REQUESTED")
        .map((review) => review.login),
    },
    ...summaries,
  };

  return { ...report, verdict: getVerdict(report) };
}

function line(label, values, empty = "none") {
  return `${label}: ${values.length ? values.join(", ") : empty}`;
}

export function formatReport(report) {
  const verdict = report.verdict ?? getVerdict(report);
  const totalChecks = report.checks.total + report.statuses.total;
  const pendingChecks = report.checks.pending.length + report.statuses.pending.length;
  const failedChecks = report.checks.failed.length + report.statuses.failed.length;
  const lines = [
    `${verdict.status.toUpperCase()}  ${report.repository}#${report.number}`,
    report.title,
  ];

  for (const reason of verdict.reasons) lines.push(`Reason: ${reason}`);

  lines.push(
    `Merge: ${report.mergeable === false ? "conflicts" : report.mergeable === null ? "calculating" : "clean"}`,
    line("Approved by", report.reviews.approved),
    line("Changes requested by", report.reviews.changesRequested),
    `Checks: ${totalChecks} total, ${pendingChecks} pending, ${failedChecks} failed`,
    `Workflows: ${report.workflows.total} total`,
    `Changed files: ${report.changedFiles}`,
    report.url,
  );

  return lines.join("\n");
}

export function exitCodeFor(report) {
  return (report.verdict ?? getVerdict(report)).status === "ready" ? 0 : 2;
}
