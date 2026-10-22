// Filtros do CRM no topo da lista de conversas do próprio WhatsApp (Tudo, Funil, etapas, etiqueta, campanha).
// Usa o filtro nativo da lista (WA-JS chat.setChatList 'custom'), então rolagem e cliques continuam do WhatsApp.
(() => {
  const { esc } = CRM;
  const W = globalThis.CRMW;
  let filter = localStorage.getItem('crmw-listfilter') || '';   // '', 'funnel', 'stage:x', 'tag:x', 'camp:x', 'source:Anúncio'
  let pop = null, applied = '', applyTimer = null;

  const leads = () => Object.values(W.data.leads).filter((l) => l.chatId || l.phone);
  function pick(f) {
    const L = leads();
    if (f === 'funnel') return L.filter((l) => l.stage);
    if (f.startsWith('stage:')) return L.filter((l) => l.stage === f.slice(6));
    if (f.startsWith('tag:')) return L.filter((l) => l.tagIds?.includes(f.slice(4)));
    if (f.startsWith('camp:')) return L.filter((l) => l.campaignId === f.slice(5));
    if (f.startsWith('source:')) return L.filter((l) => l.source === f.slice(7));
    return [];
  }
  function label(f) {
    const D = W.data;
    if (f === 'funnel') return 'Funil';
    if (f.startsWith('stage:')) return W.stageOf(f.slice(6)).name;
    if (f.startsWith('tag:')) return D.tags.find((t) => t.id === f.slice(4))?.name || 'Etiqueta';
    if (f.startsWith('camp:')) return D.campaigns.find((c) => c.id === f.slice(5))?.name || 'Campanha';
    if (f.startsWith('source:')) return f.slice(7);
    return 'Tudo';
  }

  async function setFilter(f, quiet) {
    filter = f || '';
    localStorage.setItem('crmw-listfilter', filter);
    closePop();
    await apply(true);
    if (!quiet && filter) W.toast(`Mostrando ${pick(filter).length} conversa(s): ${label(filter)}`);
    draw(true);
    W.render();
  }
  // aplica no WhatsApp (e reaplica quando entram leads novos no filtro ativo)
  async function apply(force) {
    if (!W.ready) return;
    const ids = filter ? pick(filter).map((l) => l.chatId || l.phone + '@c.us') : null;
    const sig = filter + '|' + (ids ? ids.sort().join(',') : '');
    if (!force && sig === applied) return;
    applied = sig;
    await W.wa('filterChats', { ids }).catch(() => {});
  }

  function closePop() { pop?.remove(); pop = null; }
  function openPop(anchor, title, items) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'crmw-pop';
    pop.innerHTML = `<div class="crmw-ptitle">${title}</div>${items.length ? items.map(([f, name, n, color]) => `<button class="crmw-qi ${filter === f ? 'on' : ''}" data-f="${esc(f)}"><b>${color ? `<i class="crmw-sw" style="background:${color}"></i>` : ''}${esc(name)}</b><span>${n} conversa(s)</span></button>`).join('') : '<div class="crmw-pempty">Nada aqui ainda.</div>'}`;
    document.getElementById('crmw').appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.bottom = 'auto';
    pop.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => setFilter(b.dataset.f)));
  }
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('#crmw-listbar')) closePop(); }, true);

  function draw(force) {
    const side = document.querySelector('#pane-side');
    let bar = document.getElementById('crmw-listbar');
    if (!side) { bar?.remove(); return; }
    // fora da área que rola, logo acima dela (embaixo de "Tudo / Não lidas"): dentro, o WhatsApp desenha as conversas por cima
    if (!bar || bar.nextElementSibling !== side) {
      bar?.remove();
      bar = document.createElement('div');
      bar.id = 'crmw-listbar';
      side.parentElement.insertBefore(bar, side);
      bar.addEventListener('mousedown', (e) => e.stopPropagation());
      bar.onclick = (e) => {
        const b = e.target.closest('[data-lf]'); if (!b) return;
        const v = b.dataset.lf;
        if (v === 'tags') return openPop(b, 'Filtrar por etiqueta', W.data.tags.map((t) => ['tag:' + t.id, t.name, pick('tag:' + t.id).length, t.color]));
        if (v === 'camps') return openPop(b, 'Filtrar por campanha', W.data.campaigns.map((c) => ['camp:' + c.id, c.name, pick('camp:' + c.id).length]));
        setFilter(v === filter ? '' : v);
      };
      force = true;
    }
    const D = W.data;
    const sig = JSON.stringify([filter, D.stages, D.tags.length, D.campaigns.length, Object.keys(D.leads).length, leads().map((l) => l.stage).join()]);
    if (!force && bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    const chip = (f, txt, color, n) => `<button data-lf="${esc(f)}" class="${filter === f ? 'on' : ''}" ${color ? `style="--c:${color}"` : ''}>${color ? '<i></i>' : ''}${txt}${n != null ? ` <em>${n}</em>` : ''}</button>`;
    const isTag = filter.startsWith('tag:'), isCamp = filter.startsWith('camp:');
    bar.innerHTML = chip('', 'Tudo')
      + chip('funnel', 'Funil', null, pick('funnel').length)
      + D.stages.map((s) => chip('stage:' + s.id, esc(s.name), s.color, pick('stage:' + s.id).length)).join('')
      + `<button data-lf="tags" class="${isTag ? 'on' : ''}">🏷 ${isTag ? esc(label(filter)) : 'Etiqueta'} ▾</button>`
      + `<button data-lf="camps" class="${isCamp ? 'on' : ''}">📣 ${isCamp ? esc(label(filter)) : 'Campanha'} ▾</button>`;
  }

  // API para o painel (aba Hoje) usar o mesmo filtro
  W.setListFilter = setFilter;
  Object.defineProperty(W, 'listFilter', { get: () => filter });

  W.on('data', (_d, why) => {
    draw();
    if (filter && why !== 'dom') { clearTimeout(applyTimer); applyTimer = setTimeout(() => apply(false), 600); }
  });
  // ao conectar, reaplica o filtro que estava ativo
  const waitReady = setInterval(() => { if (W.ready) { clearInterval(waitReady); if (filter) apply(true); } }, 1000);
})();
