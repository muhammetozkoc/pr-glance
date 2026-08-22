# pr-glance

`pr-glance` answers one question: is this pull request ready to merge?

```sh
npx github:muhammetozkoc/pr-glance https://github.com/owner/repo/pull/123
```

```text
WAITING  pacifio/atlas#183
Add a repository-wide Rust test command
Reason: workflow approval needed: CI
Merge: clean
Approved by: none
Changes requested by: none
Checks: 0 total, 0 pending, 0 failed
Workflows: 1 total
Changed files: 3
https://github.com/pacifio/atlas/pull/183
```

Use `--json` in scripts. The command exits with `0` when a PR is ready, `2` when it is waiting or blocked, and `1` when the request itself fails.

For local use:

```sh
git clone https://github.com/muhammetozkoc/pr-glance.git
cd pr-glance
npm link
pr-glance https://github.com/pacifio/atlas/pull/183
```

Public repositories work without authentication. Set `GITHUB_TOKEN` if you need a higher API rate limit or want to inspect a private repository your token can access.

```sh
GITHUB_TOKEN=github_pat_... pr-glance https://github.com/owner/private-repo/pull/123
```

The token is read from the environment and is only sent to `api.github.com`.

## Development

Requires Node.js 20 or newer.

```sh
npm test
npm run check
```
