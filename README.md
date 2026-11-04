# IssueScout

Find your next open-source contribution. Search live public GitHub issues, save promising opportunities, and track your progress.

## Phase one

- Live GitHub issue search with keywords and `repo:owner/name` syntax
- Language and label filters, including **good first issue** and **help wanted**
- Sort by activity, creation date, or discussion; paginate through results
- Save issues and track **Saved → In progress → PR opened → Completed**
- Responsive interface, keyboard focus styles, loading, empty, retry, and rate-limit states
- Node.js API proxy that keeps optional GitHub credentials on the server

## Run locally

Requires **Node.js 22 or later**. No third-party packages or installation needed.

```sh
git clone https://github.com/Evison01/IssueScout.git
cd IssueScout
npm start
```

Open **http://localhost:3000**. For automatic server restarts, run `npm run dev`.

Optionally copy `.env.example` to `.env` and set `GITHUB_TOKEN` to increase GitHub API limits. Public issue search works without a token. Never paste a token into frontend files or commit `.env`.

```sh
npm test
npm run check
```

## How it works

The browser calls `GET /api/issues?q=accessibility&language=TypeScript&label=good+first+issue&sort=updated&page=1`. The Node server queries GitHub's [issue search API](https://docs.github.com/en/rest/search#search-issues-and-pull-requests), limits page sizes, and returns normalized issue data. Search is restricted to open issues in repositories that are not archived. GitHub search exposes at most 1,000 results per query; refine your filters for more focused results.

Saved issues and their progress live in this browser's local storage. They do not sync across devices; clearing browser data removes them. Issue snapshots refresh only when rediscovered through search. Progress is a personal tracker and does not modify GitHub issues. An updated issue is an activity signal, not a guarantee of maintainer responsiveness.

## Project layout

```text
public/          Browser interface, styles, and local saved-issue tracker
server.js        Static server and GitHub search proxy
test/            API and server tests using Node's built-in test runner
```

## Next phases

- GitHub OAuth and synced bookmarks
- PostgreSQL persistence and user accounts
- Repository activity signals and richer issue details
- Contribution reminders and personalized discovery

Phase one intentionally has no account system, database, automated recommendations, or production hosting. The server binds to localhost for development. Public deployment will need appropriate hosting, request throttling, and secret configuration.
