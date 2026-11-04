import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, searchParameters } from '../server.js';

async function withServer(options, callback) {
  const server = createApp(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('search encodes multiword labels, excludes pull requests, and clamps pagination', () => {
  const params = searchParameters(new URLSearchParams({ q: 'accessibility', label: 'good first issue', language: 'C++', page: '999', sort: 'invalid' }));
  assert.equal(params.get('page'), '50');
  assert.equal(params.get('sort'), 'updated');
  assert.match(params.get('q'), /is:issue is:open archived:false language:"C\+\+" label:"good first issue"/);
});
test('serves the app, refuses unknown paths and non-GET requests', async () => {
  await withServer({}, async base => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /IssueScout/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  });
});
test('normalizes GitHub results and keeps token server-side', async () => {
  await withServer({ token: 'test-only', fetcher: async (url, options) => {
    assert.equal(new URL(url).hostname, 'api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    return Response.json({ total_count: 1, incomplete_results: false, items: [{ id: 1, title: '<script>alert(1)</script>', html_url: 'https://github.com/a/b/issues/1', repository_url: 'https://api.github.com/repos/a/b', number: 1, labels: [{ name: 'good first issue' }], comments: 0, body: 'Example', updated_at: '2026-11-04T00:00:00Z' }] });
  } }, async base => {
    const response = await fetch(`${base}/api/issues`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.items[0].repository, 'a/b');
    assert.deepEqual(data.items[0].labels, ['good first issue']);
    assert.equal(JSON.stringify(data).includes('test-only'), false);
  });
});
test('rate-limit errors show actionable messages', async () => {
  await withServer({ fetcher: async () => Response.json({}, { status: 403 }) }, async base => {
    const response = await fetch(`${base}/api/issues`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /rate limit/);
  });
});
test('network failures return recoverable errors', async () => {
  await withServer({ fetcher: async () => { throw new Error('private upstream details'); } }, async base => {
    const response = await fetch(`${base}/api/issues`);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private upstream details/);
  });
});
