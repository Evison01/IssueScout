import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
export function searchParameters(params) {
  const query = (params.get('q') || '').trim().slice(0, 200);
  const language = (params.get('language') || '').replace(/[^a-zA-Z0-9+#. -]/g, '').slice(0, 40);
  const label = (params.get('label') || '').replace(/["\\\r\n]/g, '').slice(0, 60);
  const sort = ['updated', 'created', 'comments'].includes(params.get('sort')) ? params.get('sort') : 'updated';
  const page = Math.min(50, Math.max(1, Number.parseInt(params.get('page'), 10) || 1));
  return new URLSearchParams({ q: [query, 'is:issue', 'is:open', 'archived:false', language && `language:"${language}"`, label && `label:"${label}"`].filter(Boolean).join(' '), sort, order: 'desc', per_page: '20', page: String(page) });
}
export function createApp({ fetcher = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/issues') {
        const response = await fetcher(`https://api.github.com/search/issues?${searchParameters(url.searchParams)}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'IssueScout', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) {
          const error = response.status === 403 || response.status === 429 ? 'GitHub rate limit reached. Wait a minute and retry, or configure GITHUB_TOKEN on the server.' : response.status === 401 ? 'The server’s GitHub token is invalid. Update or remove GITHUB_TOKEN.' : response.status === 422 ? 'GitHub could not understand this search. Try simpler keywords.' : 'GitHub is unavailable. Please try again.';
          return json(response.status === 401 ? 502 : response.status, { error });
        }
        const data = await response.json();
        return json(200, { total: data.total_count, incomplete: data.incomplete_results, items: data.items.filter(i => !i.pull_request).map(i => ({ id: i.id, title: i.title, url: i.html_url, repository: i.repository_url.split('/repos/')[1], number: i.number, body: (i.body || '').slice(0, 400), labels: i.labels.map(l => l.name), comments: i.comments, updated: i.updated_at })) });
      }
      const asset = assets.get(url.pathname);
      if (!asset) return json(404, { error: 'Not found.' });
      const body = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(body);
    } catch (error) { json(502, { error: error.name === 'TimeoutError' ? 'GitHub took too long. Please retry.' : 'Unable to load issues. Check your connection and retry.' }); }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '127.0.0.1', () => console.log(`IssueScout → http://localhost:${port}`));
}
