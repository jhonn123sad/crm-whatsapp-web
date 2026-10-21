// Funil: Kanban, lista, campanhas e configurações. Abre em aba própria ou embutido no WhatsApp (?embed=1).
const { SOURCES, COLORS, DEFAULT_AD_PHRASES, store, uid, getAll, saveLead, upsertItem, removeItem, newCampaign, norm, money, esc, campaignStats, toCSV } = CRM;
const $ = (s) => document.querySelector(s);
const EMBED = new URLSearchParams(location.search).has('embed');
let data = null;
let qSteps = [];
if (EMBED) document.body.classList.add('embed');

$('#fOrigem').innerHTML += SOURCES.map((s) => `<option>${s}</option>`).join('');
function showView(v) {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.v === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === v));
  document.querySelector('.filters').style.display = ['ajustes', 'campanhas'].includes(v) ? 'none' : '';
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { history.replaceState(null, '', location.search + '#' + b.dataset.v); showView(b.dataset.v); }));
const fromHash = () => {
  const v = location.hash.slice(1);
  if (v === 'respostas') { showView('ajustes'); setTimeout(() => { $('#qTitle').scrollIntoView({ block: 'center' }); $('#qTitle').focus(); }, 300); return; }
  if (['funil', 'lista', 'campanhas', 'ajustes'].includes(v)) showView(v);
};
window.addEventListener('hashchange', fromHash);
fromHash();
['#fBusca', '#fOrigem', '#fCamp', '#fTag', '#fPeriodo', '#fAtras'].forEach((s) => $(s).addEventListener('input', render));

const today = () => new Date().toISOString().slice(0, 10);
function filtered() {
  const t = norm($('#fBusca').value), o = $('#fOrigem').value, c = $('#fCamp').value, tg = $('#fTag').value, d = Number($('#fPeriodo').value), late = $('#fAtras').checked;
  const since = d ? new Date().setHours(0, 0, 0, 0) - (d - 1) * 864e5 : 0;
  return Object.values(data.leads)
    .filter((l) => l.stage)   // fichas só com etiqueta/nota (fora do funil) não entram no Kanban
    .filter((l) => (!o || l.source === o) && (!c || l.campaignId === c) && (!tg || l.tagIds?.includes(tg)) && l.createdAt >= since &&
      (!late || (l.followUp && l.followUp <= today())) &&
      (!t || norm([l.name, l.phone, l.notes, ...Object.values(l.fields || {})].join(' ')).includes(t)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function openChat(l) {
  if (EMBED) parent.postMessage({ crmw: 'board', action: 'openChat', lead: l }, 'https://web.whatsapp.com');
  else chrome.runtime.sendMessage({ type: 'openChat', name: l.name, phone: l.phone, chatId: l.chatId });
}

const tagsOf = (l) => (l.tagIds || []).map((id) => data.tags.find((t) => t.id === id)).filter(Boolean);
const tagHtml = (t) => `<span class="tag" style="--c:${t.color}">${esc(t.name)}</span>`;
const campName = (id) => data.campaigns.find((c) => c.id === id)?.name || '';

function fillSelect(sel, items, label) {
  const keep = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  sel.value = keep;
}

function render() {
  fillSelect($('#fCamp'), data.campaigns, 'Todas as campanhas');
  fillSelect($('#fTag'), data.tags, 'Todas as etiquetas');
  const list = filtered();
  const closed = list.filter((l) => l.stage === 'fechado');
  $('#totals').textContent = `${list.length} leads · ${closed.length} fechados · ${money(closed.reduce((s, l) => s + (l.value || 0), 0))}`;

  $('#board').innerHTML = data.stages.map((s) => {
    const cs = list.filter((l) => l.stage === s.id);
    const total = cs.reduce((a, l) => a + (l.value || 0), 0);
    return `<div class="col" data-stage="${s.id}" style="--c:${s.color}"><h3><span>${esc(s.name)} · ${cs.length}</span><span>${total ? money(total) : ''}</span></h3><div class="cards">` +
      cs.map((l) => {
        const late = l.followUp && l.followUp <= today() && !['fechado', 'perdido'].includes(l.stage);
        return `<div class="card" draggable="true" data-key="${esc(l.key)}"><b>${esc(l.name)}</b>
          <small>${l.phone ? '+' + esc(l.phone) : ''}${l.value ? ' · ' + money(l.value) : ''}</small>
          ${l.notes ? `<small class="note">${esc(l.notes)}</small>` : ''}
          <div class="tags">${l.source === 'Anúncio' ? '<span class="tag ad">Anúncio</span>' : ''}${campName(l.campaignId) ? `<span class="tag camp">${esc(campName(l.campaignId))}</span>` : ''}${tagsOf(l).map(tagHtml).join('')}</div>
          ${l.followUp ? `<small class="${late ? 'late' : ''}">↻ retorno ${new Date(l.followUp + 'T12:00').toLocaleDateString('pt-BR')}</small>` : ''}
          <div class="acts"><button data-open>Abrir conversa</button></div></div>`;
      }).join('') + '</div></div>';
  }).join('');

  const stageName = Object.fromEntries(data.stages.map((s) => [s.id, s.name]));
  $('#rows').innerHTML = list.map((l) => `<tr data-key="${esc(l.key)}"><td>${esc(l.name)}</td><td>${l.phone ? '+' + esc(l.phone) : ''}</td><td>${esc(stageName[l.stage] || l.stage)}</td>
    <td>${tagsOf(l).map(tagHtml).join(' ')}</td><td>${esc(campName(l.campaignId))}</td><td>${l.value ? money(l.value) : ''}</td><td>${l.followUp ? new Date(l.followUp + 'T12:00').toLocaleDateString('pt-BR') : ''}</td><td>${new Date(l.createdAt).toLocaleDateString('pt-BR')}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Nenhum lead. No WhatsApp Web, abra uma conversa e clique em "+ Lead".</td></tr>';

  renderCampaigns();
  renderSettings();
}

// ---------- Kanban: arrastar ----------
let dragKey = null;
$('#board').addEventListener('dragstart', (e) => { dragKey = e.target.closest('.card')?.dataset.key; });
$('#board').addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); document.querySelectorAll('.col').forEach((c) => c.classList.toggle('drop', c === col)); } });
$('#board').addEventListener('drop', (e) => {
  const col = e.target.closest('.col'); document.querySelectorAll('.col').forEach((c) => c.classList.remove('drop'));
  if (col && dragKey) saveLead({ key: dragKey, stage: col.dataset.stage });
});
$('#board').addEventListener('click', (e) => { const card = e.target.closest('.card'); if (card) openChat(data.leads[card.dataset.key]); });
$('#rows').addEventListener('click', (e) => { const k = e.target.closest('tr')?.dataset.key; if (k) openChat(data.leads[k]); });

// ---------- Campanhas ----------
function renderCampaigns() {
  const rows = campaignStats(data);
  $('#campRows').innerHTML = rows.map((c) => `<tr data-id="${c.id}"><td><input data-cf="name" value="${esc(c.name)}"></td>
    <td><input data-cf="channel" value="${esc(c.channel || '')}" style="width:110px"></td>
    <td><input data-cf="cost" type="number" step="0.01" value="${c.cost ?? ''}" style="width:100px"></td>
    <td><input data-cf="phrase" value="${esc(c.phrase || '')}" placeholder="mensagem pronta do anúncio"></td>
    <td>${c.leads}</td><td>${c.won}</td><td>${Math.round(c.conversion * 100)}%</td><td>${money(c.revenue)}</td>
    <td>${c.cpl != null ? money(c.cpl) : '—'}</td><td>${c.roas != null ? c.roas.toFixed(1) + 'x' : '—'}</td>
    <td><button class="link" data-cdel>excluir</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">Nenhuma campanha ainda.</td></tr>';
}
$('#campRows').addEventListener('change', (e) => {
  const f = e.target.dataset.cf; if (!f) return;
  const id = e.target.closest('tr').dataset.id;
  upsertItem('campaigns', { id, [f]: e.target.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value });
});
$('#campRows').addEventListener('click', (e) => {
  if (!e.target.matches('[data-cdel]')) return;
  if (confirm('Excluir esta campanha? Os leads continuam, só perdem o vínculo.')) removeItem('campaigns', e.target.closest('tr').dataset.id);
});
$('#cAdd').onclick = async () => { const n = $('#cName').value.trim(); if (!n) return; await upsertItem('campaigns', newCampaign(n)); $('#cName').value = ''; };

// ---------- Configurações ----------
const colorPick = (key, item) => `<span class="swatches">${COLORS.map((c) => `<button class="sw ${item.color === c ? 'on' : ''}" style="background:${c}" data-color="${c}" data-k="${key}" data-id="${item.id}"></button>`).join('')}</span>`;
function renderSettings() {
  $('#stageList').innerHTML = data.stages.map((s, i) => `<div class="item"><i class="dot" style="background:${s.color}"></i><input data-stage-name="${s.id}" value="${esc(s.name)}">${colorPick('stages', s)}
    <button class="link" data-up="${i}" ${i ? '' : 'disabled'}>↑</button><button class="link" data-sdel="${s.id}">excluir</button></div>`).join('');
  $('#tagList').innerHTML = data.tags.map((t) => `<div class="item"><i class="dot" style="background:${t.color}"></i><input data-tag-name="${t.id}" value="${esc(t.name)}">${colorPick('tags', t)}<button class="link" data-tdel="${t.id}">excluir</button></div>`).join('') || '<p class="mut">Nenhuma etiqueta.</p>';
  $('#qrList').innerHTML = data.quickReplies.map((r) => `<div class="item"><b>${r.folder ? esc(r.folder) + ' / ' : ''}${esc(r.title)}</b><span>${esc(r.body)}${r.steps?.length ? ` <i>+${r.steps.length} na sequência</i>` : ''}</span><button class="link" data-qdel="${r.id}">remover</button></div>`).join('') || '<p class="mut">Nenhuma resposta ainda.</p>';
  $('#fieldList').innerHTML = data.customFields.map((f) => `<div class="item"><input data-field-name="${f.id}" value="${esc(f.name)}"><button class="link" data-fdel="${f.id}">remover</button></div>`).join('');
  if (document.activeElement !== $('#adPhrases')) $('#adPhrases').value = data.adPhrases.join('\n');
  $('#qSteps').innerHTML = qSteps.map((s, i) => `<div class="row"><textarea data-step="${i}" rows="2" placeholder="Mensagem ${i + 2}">${esc(s.text)}</textarea><label class="mut">depois de<input data-delay="${i}" type="number" value="${s.delay}" style="width:60px"> s</label><button class="link" data-qsdel="${i}">×</button></div>`).join('');
}
const saveStages = (stages) => store.set({ stages });
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.stageName) saveStages(data.stages.map((s) => (s.id === t.dataset.stageName ? { ...s, name: t.value } : s)));
  if (t.dataset.tagName) upsertItem('tags', { id: t.dataset.tagName, name: t.value });
  if (t.dataset.fieldName) upsertItem('customFields', { id: t.dataset.fieldName, name: t.value });
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.step != null) qSteps[t.dataset.step].text = t.value;
  if (t.dataset.delay != null) qSteps[t.dataset.delay].delay = Number(t.value) || 3;
});
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.color) {
    if (t.dataset.k === 'stages') saveStages(data.stages.map((s) => (s.id === t.dataset.id ? { ...s, color: t.dataset.color } : s)));
    else upsertItem(t.dataset.k, { id: t.dataset.id, color: t.dataset.color });
  }
  if (t.dataset.up) { const i = Number(t.dataset.up), s = [...data.stages]; [s[i - 1], s[i]] = [s[i], s[i - 1]]; saveStages(s); }
  if (t.dataset.sdel) {
    const n = Object.values(data.leads).filter((l) => l.stage === t.dataset.sdel).length;
    if (data.stages.length <= 1) return alert('Precisa ter pelo menos uma coluna.');
    if (n) return alert(`Esta coluna tem ${n} leads. Mova-os antes de excluir.`);
    saveStages(data.stages.filter((s) => s.id !== t.dataset.sdel));
  }
  if (t.dataset.tdel && confirm('Excluir etiqueta? Ela sai de todos os leads.')) removeItem('tags', t.dataset.tdel);
  if (t.dataset.qdel) removeItem('quickReplies', t.dataset.qdel);
  if (t.dataset.fdel && confirm('Remover este campo? Os valores já preenchidos ficam guardados no backup.')) removeItem('customFields', t.dataset.fdel);
  if (t.dataset.qsdel) { qSteps.splice(Number(t.dataset.qsdel), 1); renderSettings(); }
});
$('#sAdd').onclick = () => { const n = $('#sName').value.trim(); if (!n) return; saveStages([...data.stages, { id: uid(), name: n, color: COLORS[data.stages.length % COLORS.length] }]); $('#sName').value = ''; };
$('#tAdd').onclick = () => { const n = $('#tName').value.trim(); if (!n) return; upsertItem('tags', { name: n, color: COLORS[data.tags.length % COLORS.length] }); $('#tName').value = ''; };
$('#fAdd').onclick = () => { const n = $('#fName').value.trim(); if (!n) return; upsertItem('customFields', { name: n }); $('#fName').value = ''; };
$('#qStep').onclick = () => { qSteps.push({ text: '', delay: 5 }); renderSettings(); };
$('#qSave').onclick = async () => {
  const title = $('#qTitle').value.trim(), body = $('#qBody').value.trim();
  if (!title || !body) return alert('Preencha o título e a mensagem.');
  await upsertItem('quickReplies', { title, body, folder: $('#qFolder').value.trim(), steps: qSteps.filter((s) => s.text.trim()) });
  $('#qTitle').value = $('#qBody').value = ''; qSteps = [];
};
$('#adSave').onclick = async () => {
  const lines = $('#adPhrases').value.split('\n').map((s) => s.trim()).filter(Boolean);
  await store.set({ adPhrases: lines.length ? lines : DEFAULT_AD_PHRASES });
  alert('Frases salvas.');
};

// ---------- backup ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
$('#exportCsv').onclick = () => download(`leads-${stamp()}.csv`, toCSV(filtered(), data), 'text/csv;charset=utf-8');
$('#exportJson').onclick = async () => download(`backup-crm-${stamp()}.json`, JSON.stringify(await store.get(null), null, 1), 'application/json');
$('#importJson').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j.leads) throw new Error('arquivo não é um backup deste CRM');
    if (!confirm(`Restaurar ${Object.keys(j.leads).length} leads e as configurações do backup?`)) return;
    const cur = await getAll();
    await store.set({ ...j, leads: { ...cur.leads, ...j.leads } });
  } catch (err) { alert('Não deu para restaurar: ' + err.message); }
  e.target.value = '';
};

// não redesenha a tela de configurações enquanto você digita
chrome.storage.onChanged.addListener(async () => {
  data = await getAll();
  if (document.activeElement?.matches('input:not([type=checkbox]), textarea')) { document.activeElement.addEventListener('blur', render, { once: true }); return; }
  render();
});
getAll().then((d) => { data = d; render(); });
