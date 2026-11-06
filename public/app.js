const $ = id => document.getElementById(id);
const storageKey = 'issuescout:saved:v1';
let bookmarks = {};
let storageWarning = '';
try { const data = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (data && typeof data === 'object' && !Array.isArray(data)) bookmarks = Object.fromEntries(Object.entries(data).filter(([, v]) => v && typeof v.title === 'string' && typeof v.url === 'string' && v.url.startsWith('https://github.com/') && Array.isArray(v.labels))); } catch { storageWarning = 'Browser storage is unavailable. Saved issues will last for this session only.'; }
let view = 'discover', page = 1, total = 0, items = [], controller;
let activeQuery = new URLSearchParams();
const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
function persist() { try { localStorage.setItem(storageKey, JSON.stringify(bookmarks)); } catch { storageWarning = 'Could not persist saved issues. Browser storage may be full or disabled.'; $('notice').textContent = storageWarning; } }
const browserBookmarks = bookmarks;
let accountUser;
let accountEnabled = false;
let accountBusy = false;
let accountError = '';

function accountMessage(message) {
  $('account-message').textContent = message;
  $('account-message').hidden = !message;
}

function renderAccount() {
  $('account-status').textContent = accountUser
    ? `Signed in as @${accountUser.login} · Bookmarks sync across devices`
    : accountError || (accountEnabled ? 'Sign in to sync your bookmarks across devices.' : 'Bookmarks are saved in this browser.');
  $('signin').hidden = !accountEnabled || Boolean(accountUser);
  $('signout').hidden = !accountUser;
  $('refresh-bookmarks').hidden = !accountUser;
  $('import-bookmarks').hidden = !accountUser || !Object.keys(browserBookmarks).some(id => !bookmarks[id]);
  for (const id of ['signout', 'refresh-bookmarks', 'import-bookmarks']) $(id).disabled = accountBusy;
}

async function accountRequest(action, body) {
  const url = action ? `/api/account?action=${action}` : '/api/account';
  const options = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Account sync failed. Try again.');
  return data;
}

async function refreshAccount() {
  const data = await accountRequest();
  accountEnabled = data.enabled;
  accountUser = data.user;
  accountError = '';
  bookmarks = accountUser
    ? Object.fromEntries(data.bookmarks.map(issue => [issue.id, issue]))
    : browserBookmarks;
}

function renderAfterAccountChange() {
  renderAccount();
  $('saved-count').textContent = Object.keys(bookmarks).length;
  if (view === 'saved' || (items.length && $('results').getAttribute('aria-busy') !== 'true')) render();
}

async function accountOperation(operation) {
  if (accountBusy) return;
  accountBusy = true;
  accountMessage('');
  renderAccount();
  document.querySelectorAll('.issue .save, .issue .status').forEach(control => { control.disabled = true; });
  try { await operation(); }
  catch (error) { accountMessage(error.message); }
  finally {
    accountBusy = false;
    renderAfterAccountChange();
  }
}

function toggleBookmark(issue) {
  if (accountBusy) return;
  if (!accountUser) {
    if (bookmarks[issue.id]) delete bookmarks[issue.id];
    else bookmarks[issue.id] = { ...issue, status: 'Saved' };
    persist();
    render();
    return;
  }
  accountOperation(async () => {
    if (bookmarks[issue.id]) {
      await accountRequest('remove', { id: issue.id });
      delete bookmarks[issue.id];
    } else {
      const data = await accountRequest('save', { ...issue, status: 'Saved' });
      bookmarks[issue.id] = data.issue;
    }
  });
}

function changeProgress(id, status) {
  if (!accountUser) {
    bookmarks[id].status = status;
    persist();
    return;
  }
  accountOperation(async () => {
    await accountRequest('progress', { id, status });
    bookmarks[id].status = status;
  });
}

$('refresh-bookmarks').onclick = () => accountOperation(refreshAccount);
$('signout').onclick = () => accountOperation(async () => {
  await accountRequest('logout', {});
  accountUser = null;
  bookmarks = browserBookmarks;
});
$('import-bookmarks').onclick = () => accountOperation(async () => {
  const candidates = Object.values(browserBookmarks).filter(issue => !bookmarks[issue.id]);
  let added = 0;
  try {
    for (let i = 0; i < candidates.length; i += 25) {
      const result = await accountRequest('import', candidates.slice(i, i + 25));
      added += result.added;
    }
  } finally {
    await refreshAccount();
  }
  accountMessage(`Imported ${added} browser bookmark${added === 1 ? '' : 's'}.`);
});

function render() {
  $('saved-count').textContent = Object.keys(bookmarks).length;
  $('search-panel').hidden = view === 'saved';
  $('pagination').hidden = view === 'saved' || total === 0;
  $('result-title').textContent = view === 'saved' ? 'Your contribution shortlist' : 'Discover issues';
  $('result-meta').textContent = view === 'saved' ? `${Object.keys(bookmarks).length} saved · ${accountUser ? "synced to your account" : "stored in this browser"}` : `${total.toLocaleString()} matching issues`;
  $('previous').disabled = page === 1;
  $('next').disabled = page * 20 >= Math.min(total, 1000);
  $('page-number').textContent = `Page ${page}`;
  $('results').replaceChildren();
  const list = view === 'saved' ? Object.values(bookmarks) : items;
  if (!list.length) { const empty = element('div', 'empty'); empty.append(element('span', 'empty-icon', view === 'saved' ? '◇' : '⌕'), element('h3', '', view === 'saved' ? 'Good opportunities deserve a bookmark.' : 'No issues found.'), element('p', '', view === 'saved' ? 'Save an issue from Discover to start your contribution shortlist.' : 'Try a different keyword, language, or label.')); $('results').append(empty); }
  for (const issue of list) {
    const card = element('article', 'issue');
    const content = element('div', 'issue-content');
    content.append(element('div', 'repo', `${issue.repository}  /  #${issue.number}`));
    const title = element('a', 'issue-title', issue.title); title.href = issue.url; title.target = '_blank'; title.rel = 'noreferrer'; content.append(title);
    content.append(element('p', 'description', (issue.body || 'Open this issue on GitHub to learn more.').replace(/[#*`>\[\]]/g, '').slice(0, 170)));
    const tags = element('div', 'tags'); for (const label of issue.labels.slice(0, 4)) tags.append(element('span', label === 'good first issue' ? 'tag green' : 'tag', label)); content.append(tags);
    const metadata = element('div', 'metadata'); const date = new Date(issue.updated); metadata.textContent = `${issue.comments || 0} comments · Updated ${Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; content.append(metadata);
    const actions = element('div', 'issue-actions'); const isSaved = Boolean(bookmarks[issue.id]);
    const save = element('button', `save ${isSaved ? 'is-saved' : ''}`, isSaved ? '◆ Saved' : '◇ Save issue'); save.setAttribute('aria-pressed', String(isSaved)); save.setAttribute('aria-label', `${isSaved ? 'Remove saved issue' : 'Save issue'}: ${issue.title}`); save.disabled = accountBusy; save.onclick = () => toggleBookmark(issue); actions.append(save);
    if (view === 'saved') { const status = element('select', 'status'); status.setAttribute('aria-label', `Progress for ${issue.title}`); for (const value of ['Saved', 'In progress', 'PR opened', 'Completed']) { const option = element('option', '', value); option.selected = issue.status === value; status.append(option); } status.disabled = accountBusy; status.onchange = () => changeProgress(issue.id, status.value); actions.append(status); }
    card.append(content, actions); $('results').append(card);
  }
}
async function load() {
  controller?.abort(); controller = new AbortController(); const current = controller;
  $('results').setAttribute('aria-busy', 'true'); $('notice').textContent = 'Searching GitHub…'; $('results').replaceChildren(element('div', 'loading', 'Finding your next contribution…')); $('pagination').hidden = true;
  try {
    const params = new URLSearchParams(activeQuery); params.set('page', String(page));
    const response = await fetch(`/api/issues?${params}`, { signal: current.signal }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed. Please retry.');
    if (current !== controller || view !== 'discover') return;
    items = data.items; total = data.total; $('notice').textContent = data.incomplete ? 'GitHub returned partial results. Try a more specific search.' : storageWarning; render();
  } catch (error) { if (error.name === 'AbortError' || current !== controller) return; items = []; total = 0; render(); $('results').replaceChildren(); const panel = element('div', 'empty'); panel.append(element('h3', '', 'We couldn’t load the issues.'), element('p', '', error.message)); const retry = element('button', 'primary', 'Try again'); retry.onclick = load; panel.append(retry); $('results').append(panel); $('notice').textContent = 'Search failed.'; }
  finally { if (current === controller) $('results').setAttribute('aria-busy', 'false'); }
}
function search() { page = 1; activeQuery = new URLSearchParams({ q: $('query').value, language: $('language').value, label: $('label').value, sort: $('sort').value }); load(); }
$('search').onsubmit = event => { event.preventDefault(); search(); };
for (const id of ['language', 'label', 'sort']) $(id).onchange = search;
$('reset').onclick = () => { $('search').reset(); search(); };
for (const tab of ['discover', 'saved']) $(tab).onclick = () => { view = tab; for (const id of ['discover', 'saved']) { $(id).classList.toggle('active', id === tab); $(id).setAttribute('aria-selected', String(id === tab)); } if (view === 'saved') { controller?.abort(); $('results').setAttribute('aria-busy', 'false'); $('notice').textContent = storageWarning; render(); } else load(); };
$('previous').onclick = () => { if (page > 1) { page--; load(); } };
$('next').onclick = () => { if (page * 20 < Math.min(total, 1000)) { page++; load(); } };
const locationUrl = new URL(location.href);
if (locationUrl.searchParams.get('signin') === 'failed') {
  accountMessage('GitHub sign-in did not complete. Please try again.');
  locationUrl.searchParams.delete('signin');
  history.replaceState(null, '', locationUrl);
}
refreshAccount()
  .catch(() => { accountError = 'Account sync is unavailable. Browser bookmarks are available.'; })
  .finally(renderAfterAccountChange);
search();
