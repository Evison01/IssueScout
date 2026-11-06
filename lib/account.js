import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const statuses = ['Saved', 'In progress', 'PR opened', 'Completed'];
const sessionAge = 7 * 86400;
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('base64url');
const callbackPath = '/api/account?action=callback';
let pool;
let schemaReady;

function configuration() {
  const { APP_ORIGIN, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, DATABASE_URL } = process.env;
  if (!APP_ORIGIN || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !DATABASE_URL) return;
  const origin = new URL(APP_ORIGIN);
  if (origin.origin !== APP_ORIGIN || (origin.protocol !== 'https:' && origin.hostname !== 'localhost')) {
    throw new Error('Invalid APP_ORIGIN');
  }
  return { origin: origin.origin, secure: origin.protocol === 'https:', clientId: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET, databaseUrl: DATABASE_URL };
}

async function database(config) {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000, statement_timeout: 5000 });
    pool.on('error', error => console.error('IssueScout idle database connection failed', error.code));
  }
  schemaReady ??= initializeSchema().catch(error => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
  return pool;
}

async function initializeSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(180901251)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS issuescout_users (
        github_id bigint PRIMARY KEY,
        login text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issuescout_sessions (
        token_hash text PRIMARY KEY,
        github_id bigint NOT NULL REFERENCES issuescout_users(github_id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS issuescout_session_expiry ON issuescout_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS issuescout_bookmarks (
        github_id bigint NOT NULL REFERENCES issuescout_users(github_id) ON DELETE CASCADE,
        issue_id bigint NOT NULL,
        issue jsonb NOT NULL,
        status text NOT NULL CHECK (status IN ('Saved', 'In progress', 'PR opened', 'Completed')),
        PRIMARY KEY (github_id, issue_id)
      );
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function cookie(name, value, maxAge, config) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
}

function readCookie(req, name) {
  const prefix = name + '=';
  return req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(prefix))?.slice(prefix.length);
}

function redirect(res, url) {
  res.writeHead(303, { Location: url });
  res.end();
}

async function githubJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('GitHub authentication request failed');
  return response.json();
}

async function signIn(req, res, url, config) {
  const callback = config.origin + callbackPath;
  if (url.searchParams.get('action') === 'login') {
    if (req.headers.host !== new URL(config.origin).host) {
      return redirect(res, config.origin + '/api/account?action=login');
    }
    const state = random();
    const verifier = random();
    res.setHeader('Set-Cookie', cookie('isc_oauth', state + '.' + verifier, 600, config));
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: callback, state,
      code_challenge: hash(verifier), code_challenge_method: 'S256', prompt: 'select_account', scope: '' });
    return redirect(res, `https://github.com/login/oauth/authorize?${params}`);
  }

  const [state, verifier] = (readCookie(req, 'isc_oauth') || '').split('.');
  res.setHeader('Set-Cookie', cookie('isc_oauth', '', 0, config));
  const code = url.searchParams.get('code');
  if (!state || !verifier || state !== url.searchParams.get('state') || !code) {
    return redirect(res, '/?signin=failed');
  }

  try {
    const credentials = await githubJson('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        code, code_verifier: verifier, redirect_uri: callback })
    });
    if (!credentials.access_token) throw new Error('No GitHub access token returned');
    const profile = await githubJson('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${credentials.access_token}`, Accept: 'application/vnd.github+json',
        'User-Agent': 'IssueScout' }
    });
    if (!validId(profile.id) || typeof profile.login !== 'string') throw new Error('Invalid GitHub profile');

    const db = await database(config);
    await db.query(`INSERT INTO issuescout_users (github_id, login) VALUES ($1, $2)
      ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login`, [profile.id, profile.login]);
    await db.query('DELETE FROM issuescout_sessions WHERE expires_at <= now()');
    const previousSession = readCookie(req, 'isc_session');
    if (previousSession) await db.query('DELETE FROM issuescout_sessions WHERE token_hash = $1', [hash(previousSession)]);
    const session = random();
    await db.query('INSERT INTO issuescout_sessions VALUES ($1, $2, $3)',
      [hash(session), profile.id, new Date(Date.now() + sessionAge * 1000)]);
    res.setHeader('Set-Cookie', [cookie('isc_oauth', '', 0, config), cookie('isc_session', session, sessionAge, config)]);
    return redirect(res, '/');
  } catch (error) {
    console.error('IssueScout sign-in failed', error.code || error.name);
    return redirect(res, '/?signin=failed');
  }
}

const validId = id => Number.isSafeInteger(id) && id > 0;

function normalize(issue) {
  if (!issue || !validId(issue.id) || typeof issue.title !== 'string' || typeof issue.url !== 'string' ||
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(issue.url)) return;
  const [, owner, repo, , number] = new URL(issue.url).pathname.split('/');
  return {
    id: issue.id, title: issue.title.slice(0, 300), url: issue.url, repository: owner + '/' + repo,
    number: Number(number), body: typeof issue.body === 'string' ? issue.body.slice(0, 400) : '',
    labels: Array.isArray(issue.labels) ? issue.labels.filter(label => typeof label === 'string').slice(0, 12).map(label => label.slice(0, 80)) : [],
    comments: Number.isSafeInteger(issue.comments) ? issue.comments : 0,
    updated: typeof issue.updated === 'string' ? issue.updated.slice(0, 32) : null,
    status: statuses.includes(issue.status) ? issue.status : 'Saved'
  };
}

async function readJson(req) {
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > 100_000) throw new Error('Body too large');
    return JSON.parse(body);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 100_000) {
      req.resume();
      throw new Error('Body too large');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export default async function account(req, res) {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action');
    const config = configuration();
    if (!config) return json(200, { enabled: false, user: null });
    if (req.method === 'GET' && ['login', 'callback'].includes(action)) return await signIn(req, res, url, config);
    if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'Method not allowed.' });
    if (req.method === 'POST' && req.headers.origin !== config.origin) return json(403, { error: 'Invalid request origin.' });

    const session = readCookie(req, 'isc_session');
    const db = session ? await database(config) : null;
    const result = db && await db.query(`
      SELECT u.github_id, u.login FROM issuescout_users u JOIN issuescout_sessions s USING (github_id)
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash(session)]);
    const user = result?.rows?.[0];
    if (req.method === 'GET') {
      if (!user) return json(200, { enabled: true, user: null });
      const saved = await db.query('SELECT issue, status FROM issuescout_bookmarks WHERE github_id = $1', [user.github_id]);
      return json(200, { enabled: true, user: { login: user.login },
        bookmarks: saved.rows.map(row => ({ ...row.issue, status: row.status })) });
    }
    if (action === 'logout') {
      if (db) await db.query('DELETE FROM issuescout_sessions WHERE token_hash = $1', [hash(session)]);
      res.setHeader('Set-Cookie', cookie('isc_session', '', 0, config));
      return json(200, { ok: true });
    }
    if (!user) return json(401, { error: 'Sign in again to update your shortlist.' });

    let body;
    try { body = await readJson(req); }
    catch { return json(400, { error: 'Invalid or oversized request.' }); }

    if (action === 'save' || action === 'import') {
      const candidates = action === 'save' ? [body] : body;
      if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 25) {
        return json(400, { error: 'Submit between 1 and 25 issues.' });
      }
      const issues = candidates.map(normalize);
      if (issues.some(issue => !issue)) return json(400, { error: 'Invalid GitHub issue.' });
      const added = await db.query(`
        INSERT INTO issuescout_bookmarks (github_id, issue_id, issue, status)
        SELECT $1, (issue->>'id')::bigint, issue, issue->>'status'
        FROM jsonb_array_elements($2::jsonb) AS input(issue)
        ON CONFLICT DO NOTHING
        RETURNING issue, status`, [user.github_id, JSON.stringify(issues)]);
      if (action === 'save') {
        const saved = added.rows[0] || (await db.query(
          'SELECT issue, status FROM issuescout_bookmarks WHERE github_id = $1 AND issue_id = $2',
          [user.github_id, issues[0].id])).rows[0];
        if (!saved) return json(409, { error: 'The issue changed on another device. Refresh and try again.' });
        return json(200, { issue: { ...saved.issue, status: saved.status } });
      }
      return json(200, { added: added.rowCount });
    }
    if (!validId(body?.id)) return json(400, { error: 'Invalid issue ID.' });
    if (action === 'remove') {
      await db.query('DELETE FROM issuescout_bookmarks WHERE github_id = $1 AND issue_id = $2', [user.github_id, body.id]);
      return json(200, { ok: true });
    }
    if (action === 'progress' && statuses.includes(body.status)) {
      const update = await db.query('UPDATE issuescout_bookmarks SET status = $3 WHERE github_id = $1 AND issue_id = $2',
        [user.github_id, body.id, body.status]);
      if (!update.rowCount) return json(409, { error: 'This issue was removed. Refresh your shortlist.' });
      return json(200, { ok: true });
    }
    return json(400, { error: 'Invalid shortlist action.' });
  } catch (error) {
    console.error('IssueScout account request failed', error.code || error.name);
    return json(503, { error: 'Account sync is temporarily unavailable. Try again shortly.' });
  }
}
