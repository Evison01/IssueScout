const $ = id => document.getElementById(id);
const storageKey = 'issuescout:saved:v1';
let bookmarks = {};
let storageWarning = '';
try { const data = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (data && typeof data === 'object' && !Array.isArray(data)) bookmarks = Object.fromEntries(Object.entries(data).filter(([, v]) => v && typeof v.title === 'string' && typeof v.url === 'string' && v.url.startsWith('https://github.com/') && Array.isArray(v.labels))); } catch { storageWarning = 'Browser storage is unavailable. Saved issues will last for this session only.'; }
let view = 'discover', page = 1, total = 0, items = [], controller;
let activeQuery = new URLSearchParams();
const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
function persist() { try { localStorage.setItem(storageKey, JSON.stringify(bookmarks)); } catch { storageWarning = 'Could not persist saved issues. Browser storage may be full or disabled.'; $('notice').textContent = storageWarning; } }
function render() {
  $('saved-count').textContent = Object.keys(bookmarks).length;
  $('search-panel').hidden = view === 'saved';
  $('pagination').hidden = view === 'saved' || total === 0;
  $('result-title').textContent = view === 'saved' ? 'Your contribution shortlist' : 'Discover issues';
  $('result-meta').textContent = view === 'saved' ? `${Object.keys(bookmarks).length} saved · stored on this browser` : `${total.toLocaleString()} matching issues`;
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
    const save = element('button', `save ${isSaved ? 'is-saved' : ''}`, isSaved ? '◆ Saved' : '◇ Save issue'); save.setAttribute('aria-pressed', String(isSaved)); save.setAttribute('aria-label', `${isSaved ? 'Remove saved issue' : 'Save issue'}: ${issue.title}`); save.onclick = () => { if (bookmarks[issue.id]) delete bookmarks[issue.id]; else bookmarks[issue.id] = { ...issue, status: 'Saved' }; persist(); render(); }; actions.append(save);
    if (view === 'saved') { const status = element('select', 'status'); status.setAttribute('aria-label', `Progress for ${issue.title}`); for (const value of ['Saved', 'In progress', 'PR opened', 'Completed']) { const option = element('option', '', value); option.selected = issue.status === value; status.append(option); } status.onchange = () => { bookmarks[issue.id].status = status.value; persist(); }; actions.append(status); }
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
search();
