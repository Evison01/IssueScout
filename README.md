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

Requires **Node.js 22 or later**. GitHub search and browser bookmarks work without account setup.

```sh
git clone https://github.com/Evison01/IssueScout.git
cd IssueScout
npm ci
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

Guests save issues and progress in browser storage. Signed-in users save to PostgreSQL and can refresh their shortlist to pull changes from another device. **Import browser bookmarks** copies guest bookmarks into the account and preserves any progress already saved there. Guest and account bookmarks are stored separately. Progress changes are private to IssueScout.

## Project layout

```text
public/          Browser interface, styles, and local saved-issue tracker
server.js        Static server and GitHub search proxy
test/            API and server tests using Node's built-in test runner
```

## Phase two setup

GitHub sign-in uses a GitHub OAuth app. IssueScout requests public profile information and uses the GitHub account ID to identify each user. The GitHub access token is discarded after profile lookup. IssueScout sessions expire after seven days and can be ended by signing out.

1. In the IssueScout Vercel dashboard, connect a new PostgreSQL database through the [Vercel Marketplace](https://vercel.com/docs/postgres). Select a plan and connect the database to the project. Make its pooled connection URL available as `DATABASE_URL` in Production. The database role needs permission to create the IssueScout tables and indexes. The first successful sign-in initializes them automatically.
2. [Register a GitHub OAuth app](https://github.com/settings/applications/new). Use `https://issuescout-psi.vercel.app` as the homepage and `https://issuescout-psi.vercel.app/api/account?action=callback` as the authorization callback URL.
3. In Vercel, set `APP_ORIGIN=https://issuescout-psi.vercel.app`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` for Production. Enter the generated secret directly in Vercel.
4. Redeploy. Open the production URL, sign in, and save an issue. Sign in on a second browser with the same GitHub account to verify the shortlist syncs.

For local OAuth testing, use a separate OAuth app registered to `http://localhost:3000/api/account?action=callback` and put the values in a local `.env` based on `.env.example`. Use a separate development database.

## Vercel deployment

`vercel.json` serves `public/` and runs the search and account endpoints as Node.js functions. Optionally set `GITHUB_TOKEN` in Vercel to increase the GitHub search rate limit. Account sync is enabled when its four environment variables are present.

## Next phases

- Repository activity signals and richer issue details
- Contribution reminders and personalized discovery
