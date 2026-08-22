# pr-glance

`pr-glance` gives you a quick, readable status report for a public GitHub pull request. It shows the merge state, latest reviews, changed files, and check runs without opening several tabs.

```sh
npx pr-glance https://github.com/owner/repo/pull/123
```

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
