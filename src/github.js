const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

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

export async function inspectPullRequest(
  input,
  { token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {},
) {
  const { owner, repo, number } = parsePullRequestUrl(input);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const pull = await getJson(`${base}/pulls/${number}`, { token, fetchImpl });

  const [reviews, checks] = await Promise.all([
    getJson(`${base}/pulls/${number}/reviews?per_page=100`, { token, fetchImpl }),
    getJson(`${base}/commits/${pull.head.sha}/check-runs?per_page=100`, {
      token,
      fetchImpl,
    }),
  ]);

  const reviewSummary = latestReviewsByUser(reviews);
  const checkRuns = checks.check_runs ?? [];

  return {
    repository: `${owner}/${repo}`,
    number,
    title: pull.title,
    url: pull.html_url,
    author: pull.user?.login ?? "unknown",
    draft: Boolean(pull.draft),
    state: pull.state,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state,
    changedFiles: pull.changed_files,
    reviews: {
      approved: reviewSummary.filter((review) => review.state === "APPROVED").map((review) => review.login),
      changesRequested: reviewSummary
        .filter((review) => review.state === "CHANGES_REQUESTED")
        .map((review) => review.login),
    },
    checks: {
      total: checkRuns.length,
      pending: checkRuns.filter((check) => check.status !== "completed").length,
      failed: checkRuns
        .filter((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion))
        .map((check) => check.name),
    },
  };
}

export function formatReport(report) {
  const mergeable = report.mergeable === null ? "GitHub is still calculating" : report.mergeable ? "yes" : "no";
  const approved = report.reviews.approved.length ? report.reviews.approved.join(", ") : "none";
  const changes = report.reviews.changesRequested.length
    ? report.reviews.changesRequested.join(", ")
    : "none";
  const failed = report.checks.failed.length ? report.checks.failed.join(", ") : "none";

  return [
    `${report.repository}#${report.number}: ${report.title}`,
    `Author: ${report.author}`,
    `State: ${report.state}${report.draft ? " (draft)" : ""}`,
    `Mergeable: ${mergeable} (${report.mergeableState})`,
    `Changed files: ${report.changedFiles}`,
    `Approved by: ${approved}`,
    `Changes requested by: ${changes}`,
    `Checks: ${report.checks.total} total, ${report.checks.pending} pending`,
    `Failed checks: ${failed}`,
    report.url,
  ].join("\n");
}
