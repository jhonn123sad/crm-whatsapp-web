// Gerenciador de Contatos em tela cheia: todos os contatos e conversas, filtros, etiquetas,
// salvar/editar na agenda, ações em massa, importar e exportar. Etiquetas também são gerenciadas aqui.
(() => {
  const { esc, norm, saveLead, removeLead, newLead, upsertItem, removeItem, COLORS } = CRM;
  const W = globalThis.CRMW;
  const S = { tab: 'contatos', filter: 'todos', q: '', people: null, loading: false, sel: new Set(), detail: null, limit: 200 };

  const ov = document.createElement('div');
  ov.id = 'crmw-cm';
  document.getElementById('crmw').appendChild(ov);
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (ov.querySelector('.cm-modal')) closeModal(); else close(); } e.stopPropagation(); });

  function open(tab) {
    S.tab = tab || 'contatos';
    ov.classList.add('on');
    W.hideReturn();
    render();
    if (S.scroll) { const l = ov.querySelector('.cm-list'); if (l) l.scrollTop = S.scroll; S.scroll = 0; }
    if (!S.people) load();
  }
  // keep = true: só esconde (abriu uma conversa) e mantém filtro, busca, seleção e ficha aberta
  function close(keep) { ov.classList.remove('on'); if (keep !== true) S.detail = null; }
  W.openContacts = open;

  // ---------- dados: agenda + conversas + fichas do CRM ----------
  async function load() {
    if (!W.ready) { S.people = null; render(); return setTimeout(() => ov.classList.contains('on') && load(), 1500); }
    S.loading = true; render();
    try {
      const [saved, chats] = await Promise.all([W.wa('contacts', null, 90000), W.wa('chats', { onlyUsers: true }, 90000)]);
      const map = new Map();
      const keyOf = (p) => (p.phone ? 'tel:' + p.phone : 'id:' + p.id);
      for (const c of saved) map.set(keyOf(c), { id: c.id, phone: c.phone, savedName: c.name, pushName: c.pushName, t: 0 });
      for (const c of chats) {
        const k = keyOf(c), cur = map.get(k);
        if (cur) Object.assign(cur, { id: c.id || cur.id, t: c.t, unread: c.unread, savedName: cur.savedName || c.savedName });
        else map.set(k, { id: c.id, phone: c.phone, savedName: c.savedName, pushName: c.pushName, t: c.t, unread: c.unread });
      }
      for (const l of Object.values(W.data.leads)) {   // fichas que não estão na agenda nem nas conversas (ex.: importadas)
        const k = l.phone ? 'tel:' + l.phone : l.key;
        if (![...map.values()].some((p) => (l.chatId && p.id === l.chatId) || (l.phone && p.phone === l.phone))) map.set(k, { id: l.chatId, phone: l.phone, savedName: '', pushName: '', t: l.updatedAt, onlyCrm: true, crmName: l.name });
      }
      S.people = [...map.values()];
    } catch (e) { W.toast('Não deu para ler os contatos: ' + e.message); S.people = S.people || []; }
    S.loading = false; render();
  }
  const nameOf = (p) => p.savedName || p.crmName || (p.pushName ? '~' + p.pushName : '') || (p.phone ? '+' + p.phone : 'Sem nome');
  const asChat = (p) => ({ key: p.phone ? 'tel:' + p.phone : 'id:' + p.id, chatId: p.id || (p.phone ? p.phone + '@c.us' : ''), phone: p.phone, name: p.savedName || p.crmName || p.pushName || '+' + p.phone, savedName: p.savedName, pushName: p.pushName });
  // casa a ficha só por número/identificador (nunca pelo nome: duas "Marias" não podem dividir ficha)
  const recOf = (p) => {
    const L = W.data.leads, c = asChat(p);
    return L[c.key] || Object.values(L).find((l) => (p.id && l.chatId === p.id) || (p.phone && l.phone === p.phone)) || null;
  };
  const pid = (p) => p.id || 'tel:' + p.phone;

  // ---------- filtros ----------
  function filtered() {
    const q = norm(S.q), f = S.filter;
    return S.people.filter((p) => {
      const r = recOf(p);
      if (f === 'salvos' && !p.savedName) return false;
      if (f === 'naosalvos' && (p.savedName || !p.phone)) return false;
      if (f === 'funil' && !r?.stage) return false;
      if (f === 'forafunil' && r?.stage) return false;
      if (f === 'semtag' && r?.tagIds?.length) return false;
      if (f.startsWith('tag:') && !r?.tagIds?.includes(f.slice(4))) return false;
      if (f.startsWith('stage:') && r?.stage !== f.slice(6)) return false;
      if (q && !norm(`${p.savedName} ${p.pushName} ${p.crmName} ${p.phone} ${r?.notes || ''}`).includes(q)) return false;
      return true;
    }).sort((a, b) => (b.t || 0) - (a.t || 0) || nameOf(a).localeCompare(nameOf(b), 'pt-BR'));
  }
  function counts() {
    const c = { todos: 0, salvos: 0, naosalvos: 0, funil: 0, forafunil: 0, semtag: 0 };
    const tag = {}, stage = {};
    for (const p of S.people || []) {
      const r = recOf(p);
      c.todos++; if (p.savedName) c.salvos++; else if (p.phone) c.naosalvos++;
      if (r?.stage) { c.funil++; stage[r.stage] = (stage[r.stage] || 0) + 1; } else c.forafunil++;
      if (!r?.tagIds?.length) c.semtag++;
      for (const t of r?.tagIds || []) tag[t] = (tag[t] || 0) + 1;
    }
    return { c, tag, stage };
  }

  // ---------- telas ----------
  function render() {
    if (!ov.classList.contains('on')) return;
    const keepScroll = ov.querySelector('.cm-list')?.scrollTop;
    ov.innerHTML = `<div class="cm-box">
      <header class="cm-head"><b>👥 Contatos</b>
        <nav><button data-tab="contatos" class="${S.tab === 'contatos' ? 'on' : ''}">Contatos</button><button data-tab="tags" class="${S.tab === 'tags' ? 'on' : ''}">Etiquetas</button></nav>
        <span class="crmw-sp"></span>
        <button class="crmw-btn crmw-g" data-act="import">⬆ Importar</button>
        <button class="crmw-btn crmw-g" data-act="export">⬇ Exportar</button>
        <button class="crmw-x" data-act="close" title="Fechar (Esc)">✕</button></header>
      <div class="cm-body">${S.tab === 'tags' ? tagsView() : contactsView()}</div></div>`;
    bind();
    const l = ov.querySelector('.cm-list'); if (l && keepScroll) l.scrollTop = keepScroll;
  }

  function contactsView() {
    if (!S.people) return `<div class="cm-empty">${W.ready ? '⏳ Lendo seus contatos e conversas…' : '⏳ Aguardando o WhatsApp carregar…'}</div>`;
    const { c, tag, stage } = counts();
    const list = filtered();
    const F = (k, label, n, dot) => `<button class="cm-f ${S.filter === k ? 'on' : ''}" data-f="${k}">${dot ? `<i style="background:${dot}"></i>` : ''}<span>${label}</span><em>${n ?? 0}</em></button>`;
    const D = W.data;
    const shown = list.slice(0, S.limit);
    const allSel = shown.length && shown.every((p) => S.sel.has(pid(p)));
    return `<aside class="cm-side">
        ${F('todos', 'Todos', c.todos)}${F('salvos', '💾 Salvos na agenda', c.salvos)}${F('naosalvos', '❗ Não salvos', c.naosalvos)}
        <div class="cm-sh">Funil</div>${F('funil', 'No funil', c.funil)}${D.stages.map((s) => F('stage:' + s.id, s.name, stage[s.id], s.color)).join('')}${F('forafunil', 'Fora do funil', c.forafunil)}
        <div class="cm-sh">Etiquetas <button class="crmw-link" data-tab="tags">gerenciar</button></div>
        ${D.tags.map((t) => F('tag:' + t.id, t.name, tag[t.id], t.color)).join('') || '<p class="crmw-mut" style="padding:4px 10px">Nenhuma ainda.</p>'}${F('semtag', 'Sem etiqueta', c.semtag)}
        <button class="cm-f cm-add" data-act="newtag">+ nova etiqueta</button>
      </aside>
      <section class="cm-main">
        <div class="cm-tools"><input id="cm-q" placeholder="🔍 Buscar nome, número ou anotação…" value="${esc(S.q)}"><span class="crmw-mut">${list.length} contato(s)</span>${S.loading ? '<span class="crmw-mut">atualizando…</span>' : '<button class="crmw-link" data-act="reload">atualizar</button>'}</div>
        ${S.sel.size ? `<div class="cm-bulk"><b>${S.sel.size} selecionado(s)</b>
          <button class="crmw-btn" data-act="btag">🏷 Pôr etiqueta</button><button class="crmw-btn crmw-g" data-act="buntag">Tirar etiqueta</button>
          <button class="crmw-btn crmw-g" data-act="bfunnel">Pôr no funil</button><button class="crmw-btn crmw-g" data-act="bsave">💾 Salvar na agenda</button>
          <button class="crmw-btn crmw-g" data-act="bgroup">Salvar como grupo</button><button class="crmw-btn crmw-g" data-act="bexport">Exportar</button>
          <button class="crmw-link" data-act="bclear">limpar seleção</button></div>` : ''}
        <div class="cm-list"><table><thead><tr><th><input type="checkbox" data-act="selall" ${allSel ? 'checked' : ''}></th><th>Nome</th><th>Telefone</th><th>Etiquetas</th><th>Funil</th><th>Conversa</th><th></th></tr></thead><tbody>
        ${shown.map((p) => {
          const r = recOf(p), st = r?.stage && W.stageOf(r.stage);
          return `<tr data-p="${esc(pid(p))}" class="${S.detail === pid(p) ? 'on' : ''}"><td><input type="checkbox" data-sel ${S.sel.has(pid(p)) ? 'checked' : ''}></td>
            <td><div class="cm-name"><span class="crmw-avatar sm" style="background:${st ? st.color : '#94a3b8'}">${esc(W.initials(nameOf(p).replace('~', '')))}</span><div><b>${esc(nameOf(p))}</b>${p.savedName && p.pushName && p.pushName !== p.savedName ? `<small>~${esc(p.pushName)}</small>` : ''}</div></div></td>
            <td>${p.phone ? '+' + esc(p.phone) : '<span class="crmw-mut">oculto</span>'}${!p.savedName && p.phone ? ' <span class="cm-unsaved" title="Não está na agenda">não salvo</span>' : ''}</td>
            <td>${(r?.tagIds || []).map((id) => D.tags.find((t) => t.id === id)).filter(Boolean).map((t) => `<span class="cm-tag" style="--c:${t.color}">${esc(t.name)}</span>`).join('')}</td>
            <td>${st ? `<span class="cm-tag" style="--c:${st.color}">${esc(st.name)}</span>` : ''}</td>
            <td class="crmw-mut">${p.t ? new Date(p.t).toLocaleDateString('pt-BR') : ''}${p.unread ? ` <b class="cm-unread">${p.unread}</b>` : ''}</td>
            <td class="cm-acts"><button title="Abrir conversa" data-row="open">💬</button>${p.phone ? `<button title="${p.savedName ? 'Editar nome na agenda' : 'Salvar na agenda'}" data-row="save">${p.savedName ? '✏️' : '💾'}</button>` : ''}</td></tr>`;
        }).join('') || `<tr><td colspan="7" class="cm-empty">Nenhum contato neste filtro.</td></tr>`}
        </tbody></table>${list.length > S.limit ? `<button class="crmw-wide" data-act="more">Mostrar mais (${list.length - S.limit} restantes)</button>` : ''}</div>
      </section>
      ${S.detail ? detailView() : ''}`;
  }

  function detailView() {
    const p = S.people.find((x) => pid(x) === S.detail);
    if (!p) return '';
    const r = recOf(p), D = W.data;
    return `<aside class="cm-detail"><div class="cm-dh"><span class="crmw-avatar" style="background:${r?.stage ? W.stageOf(r.stage).color : '#94a3b8'}">${esc(W.initials(nameOf(p).replace('~', '')))}</span>
        <div><b>${esc(nameOf(p))}</b><span>${p.phone ? '+' + esc(p.phone) : 'número oculto'}</span></div><button class="crmw-x" data-act="dclose">✕</button></div>
      <div class="crmw-row"><button class="crmw-btn" data-act="dopen">💬 Abrir conversa</button>${p.phone ? `<button class="crmw-btn crmw-g" data-act="dsave">${p.savedName ? '✏️ Editar nome' : '💾 Salvar na agenda'}</button>` : ''}</div>
      ${!p.savedName && p.phone ? '<p class="cm-warnline">Este número não está salvo na agenda do celular.</p>' : ''}
      <label>Funil de vendas<select data-d="stage"><option value="">Fora do funil</option>${D.stages.map((s) => `<option value="${s.id}" ${r?.stage === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="crmw-label">Etiquetas</div>
      <div class="crmw-tags">${D.tags.map((t) => `<button class="crmw-tag ${r?.tagIds?.includes(t.id) ? 'on' : ''}" data-dtag="${t.id}" style="--c:${t.color}">${esc(t.name)}</button>`).join('')}<button class="crmw-tag crmw-new" data-act="dnewtag">+ nova</button></div>
      <label>Retornar em<input type="date" data-d="followUp" value="${esc(r?.followUp || '')}"></label>
      <label>Anotações<textarea data-d="notes" rows="5" placeholder="Informações sobre este contato…">${esc(r?.notes || '')}</textarea></label>
      ${r ? `<div class="crmw-mut">Ficha criada em ${new Date(r.createdAt).toLocaleDateString('pt-BR')}</div><button class="crmw-link" data-act="ddel">apagar ficha do CRM (não mexe no WhatsApp)</button>` : '<div class="crmw-mut">A ficha é criada quando você pôr etiqueta, nota ou etapa.</div>'}
    </aside>`;
  }

  function tagsView() {
    const D = W.data;
    const { tag } = S.people ? counts() : { tag: {} };
    return `<section class="cm-main cm-tags">
      <p class="crmw-mut">Etiquetas organizam seus contatos (ex.: Cliente, Fornecedor, VIP, Orçamento enviado). Aparecem coloridas na lista de conversas e servem de filtro aqui e no Kanban.</p>
      <div class="cm-newtag"><input id="cm-tname" placeholder="Nome da nova etiqueta"><button class="crmw-btn" data-act="tadd">Criar etiqueta</button></div>
      ${D.tags.map((t) => `<div class="cm-trow" data-t="${t.id}"><i class="cm-dot" style="background:${t.color}"></i>
        <input value="${esc(t.name)}" data-tname>
        <span class="cm-sw">${COLORS.map((c) => `<button class="${t.color === c ? 'on' : ''}" style="background:${c}" data-tcolor="${c}" title="cor"></button>`).join('')}</span>
        <button class="crmw-link" data-tsee>${tag[t.id] || 0} contato(s) ›</button>
        <button class="crmw-link cm-del" data-tdel>apagar</button></div>`).join('') || '<div class="cm-empty">Nenhuma etiqueta. Crie a primeira acima.</div>'}
    </section>`;
  }

  // ---------- modal dentro da tela de contatos ----------
  function modal(title, html, bindFn) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'cm-modal';
    m.innerHTML = `<div class="cm-mbox"><div class="crmw-sheet-h"><b>${title}</b><button class="crmw-x" data-mclose>✕</button></div><div class="crmw-sheet-b">${html}</div></div>`;
    ov.appendChild(m);
    m.querySelector('[data-mclose]').onclick = closeModal;
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    bindFn?.(m);
    m.querySelector('input:not([type=checkbox]), textarea, select')?.focus();
  }
  function closeModal() { ov.querySelector('.cm-modal')?.remove(); }
  const pickTag = (title, ok, cb) => modal(title, `${W.data.tags.length ? `<select id="cm-tagpick">${W.data.tags.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>` : '<p>Crie uma etiqueta primeiro.</p>'}
    <input id="cm-tagnew" placeholder="…ou escreva uma etiqueta nova"><button class="crmw-btn" id="cm-tagok">${ok}</button>`, (m) => {
    m.querySelector('#cm-tagok').onclick = async () => {
      const nn = m.querySelector('#cm-tagnew').value.trim();
      let id = m.querySelector('#cm-tagpick')?.value;
      if (nn) id = (W.data.tags.find((t) => norm(t.name) === norm(nn)) || await upsertItem('tags', { name: nn, color: COLORS[W.data.tags.length % COLORS.length] })).id;
      if (!id) return W.toast('Escolha ou escreva uma etiqueta');
      closeModal(); cb(id);
    };
  });

  const selected = () => S.people.filter((p) => S.sel.has(pid(p)));
  async function recFor(p) { return recOf(p) || W.ensureRecord(asChat(p)); }

  // ---------- eventos ----------
  function bind() {
    ov.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; render(); }));
    ov.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; S.limit = 200; render(); }));
    const q = ov.querySelector('#cm-q');
    if (q) { q.oninput = () => { S.q = q.value; const pos = q.selectionStart; render(); const n = ov.querySelector('#cm-q'); n.focus(); n.setSelectionRange(pos, pos); }; }
    ov.querySelectorAll('[data-act]').forEach((b) => (b.onclick = (e) => act(b.dataset.act, e)));
    ov.querySelectorAll('tbody tr[data-p]').forEach((tr) => (tr.onclick = (e) => {
      const p = S.people.find((x) => pid(x) === tr.dataset.p);
      if (e.target.matches('[data-sel]')) { e.target.checked ? S.sel.add(pid(p)) : S.sel.delete(pid(p)); return render(); }
      const rb = e.target.closest('[data-row]');
      if (rb?.dataset.row === 'open') return openChat(p);
      if (rb?.dataset.row === 'save') return savePerson(p);
      S.detail = pid(p); render();
    }));
    // detalhe
    const det = ov.querySelector('.cm-detail');
    if (det) {
      const p = S.people.find((x) => pid(x) === S.detail);
      det.querySelectorAll('[data-dtag]').forEach((b) => (b.onclick = async () => W.toggleTag(await recFor(p), b.dataset.dtag)));
      det.querySelectorAll('[data-d]').forEach((el) => {
        const save = async () => { const r = await recFor(p); saveLead({ key: r.key, [el.dataset.d]: el.value }); };
        el.onchange = save;
        if (el.tagName === 'TEXTAREA') { let t; el.oninput = () => { clearTimeout(t); t = setTimeout(save, 700); }; }
      });
    }
    // etiquetas
    ov.querySelectorAll('.cm-trow').forEach((row) => {
      const id = row.dataset.t;
      row.querySelector('[data-tname]').onchange = (e) => { if (e.target.value.trim()) upsertItem('tags', { id, name: e.target.value.trim() }); };
      row.querySelectorAll('[data-tcolor]').forEach((b) => (b.onclick = () => upsertItem('tags', { id, color: b.dataset.tcolor })));
      row.querySelector('[data-tsee]').onclick = () => { S.tab = 'contatos'; S.filter = 'tag:' + id; render(); if (!S.people) load(); };
      row.querySelector('[data-tdel]').onclick = () => {
        const t = W.data.tags.find((x) => x.id === id);
        modal('Apagar etiqueta?', `<p>“${esc(t.name)}” sai de todos os contatos. Os contatos não são apagados.</p><button class="crmw-btn" id="cm-yes">Apagar etiqueta</button>`, (m) => {
          m.querySelector('#cm-yes').onclick = async () => {
            closeModal();
            const { leads = {} } = await CRM.store.get('leads');
            for (const l of Object.values(leads)) if (l.tagIds?.includes(id)) l.tagIds = l.tagIds.filter((x) => x !== id);
            await CRM.store.set({ leads });
            await removeItem('tags', id);
          };
        });
      };
    });
  }

  async function act(a) {
    const D = W.data;
    if (a === 'close') return close();
    if (a === 'reload') { S.people = null; return load(); }
    if (a === 'more') { S.limit += 300; return render(); }
    if (a === 'selall') { const shown = filtered().slice(0, S.limit); const all = shown.every((p) => S.sel.has(pid(p))); shown.forEach((p) => (all ? S.sel.delete(pid(p)) : S.sel.add(pid(p)))); return render(); }
    if (a === 'bclear') { S.sel.clear(); return render(); }
    if (a === 'dclose') { S.detail = null; return render(); }
    if (a === 'newtag' || a === 'tadd' || a === 'dnewtag') {
      const input = ov.querySelector('#cm-tname');
      const create = async (name) => {
        const t = await upsertItem('tags', { name, color: COLORS[D.tags.length % COLORS.length] });
        if (a === 'dnewtag' && S.detail) { const p = S.people.find((x) => pid(x) === S.detail); const r = await recFor(p); saveLead({ key: r.key, tagIds: [...(r.tagIds || []), t.id] }); }
        W.toast('Etiqueta criada: ' + name);
      };
      if (a === 'tadd' && input?.value.trim()) return create(input.value.trim());
      return modal('Nova etiqueta', '<input id="cm-nt" placeholder="Ex.: Cliente, Fornecedor, VIP"><button class="crmw-btn" id="cm-ntok">Criar</button>', (m) => {
        const go = () => { const v = m.querySelector('#cm-nt').value.trim(); if (!v) return; closeModal(); create(v); };
        m.querySelector('#cm-ntok').onclick = go;
        m.querySelector('#cm-nt').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      });
    }
    if (a === 'dopen') return openChat(S.people.find((x) => pid(x) === S.detail));
    if (a === 'dsave') return savePerson(S.people.find((x) => pid(x) === S.detail));
    if (a === 'ddel') {
      const p = S.people.find((x) => pid(x) === S.detail), r = recOf(p);
      return modal('Apagar ficha?', `<p>Apaga etiquetas, notas e etapa de <b>${esc(nameOf(p))}</b> no CRM. O contato e a conversa no WhatsApp continuam.</p><button class="crmw-btn" id="cm-yes">Apagar ficha</button>`, (m) => {
        m.querySelector('#cm-yes').onclick = () => { closeModal(); removeLead(r.key); };
      });
    }
    // em massa
    if (a === 'btag') return pickTag(`Pôr etiqueta em ${S.sel.size} contato(s)`, 'Aplicar', async (id) => {
      for (const p of selected()) { const r = await recFor(p); if (!r.tagIds?.includes(id)) await saveLead({ key: r.key, tagIds: [...(r.tagIds || []), id] }); }
      W.toast('Etiqueta aplicada');
    });
    if (a === 'buntag') return pickTag(`Tirar etiqueta de ${S.sel.size} contato(s)`, 'Tirar', async (id) => {
      for (const p of selected()) { const r = recOf(p); if (r?.tagIds?.includes(id)) await saveLead({ key: r.key, tagIds: r.tagIds.filter((x) => x !== id) }); }
      W.toast('Etiqueta removida');
    });
    if (a === 'bfunnel') return modal(`Pôr ${S.sel.size} contato(s) no funil`, `<label>Etapa<select id="cm-st">${D.stages.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><button class="crmw-btn" id="cm-stok">Pôr no funil</button>`, (m) => {
      m.querySelector('#cm-stok').onclick = async () => {
        const st = m.querySelector('#cm-st').value; closeModal();
        for (const p of selected()) { const r = await recFor(p); await saveLead({ key: r.key, stage: st }); }
        W.toast('No funil');
      };
    });
    if (a === 'bsave') {
      const list = selected().filter((p) => p.phone && !p.savedName);
      const withName = list.filter((p) => p.pushName || p.crmName);
      return modal('Salvar na agenda do celular', `<p>${list.length} dos selecionados não estão salvos. ${withName.length} têm nome no WhatsApp e serão salvos com esse nome${list.length - withName.length ? `; ${list.length - withName.length} sem nome serão salvos como “Cliente” + final do número` : ''}.</p>
        <label class="crmw-check"><input type="checkbox" id="cm-pref" checked><span>Usar nome do WhatsApp quando houver</span></label>
        <button class="crmw-btn" id="cm-svok" ${list.length ? '' : 'disabled'}>Salvar ${list.length} contato(s)</button>`, (m) => {
        m.querySelector('#cm-svok').onclick = async () => {
          closeModal();
          let ok = 0;
          for (const p of list) {
            const n = (m.querySelector('#cm-pref').checked && (p.pushName || p.crmName)) || 'Cliente ' + p.phone.slice(-4);
            const [first, ...rest] = n.split(' ');
            try { await W.wa('saveContact', { phone: p.phone, firstName: first, lastName: rest.join(' ') }); p.savedName = n; ok++; } catch { /* segue */ }
            W.toast(`Salvando… ${ok}/${list.length}`);
            await new Promise((r) => setTimeout(r, 600));
          }
          W.toast(`${ok} contato(s) salvos na agenda`); render();
        };
      });
    }
    if (a === 'bgroup') return modal('Salvar como grupo de contatos', '<input id="cm-gn" placeholder="Nome do grupo (ex.: Clientes 2026)"><button class="crmw-btn" id="cm-gok">Salvar grupo</button>', (m) => {
      m.querySelector('#cm-gok').onclick = async () => {
        const name = m.querySelector('#cm-gn').value.trim(); if (!name) return;
        closeModal();
        await upsertItem('contactGroups', { name, members: selected().map((p) => ({ chatId: p.id, name: nameOf(p).replace('~', ''), phone: p.phone })) });
        W.toast('Grupo salvo');
      };
    });
    if (a === 'bexport' || a === 'export') return exportCsv(a === 'bexport' ? selected() : filtered());
    if (a === 'import') return importModal();
  }

  function exportCsv(list) {
    const D = W.data;
    const tn = Object.fromEntries(D.tags.map((t) => [t.id, t.name]));
    W.csvDownload(`contatos-${new Date().toISOString().slice(0, 10)}.csv`, [['Nome', 'Nome no WhatsApp', 'Telefone', 'Salvo na agenda', 'Etiquetas', 'Etapa', 'Anotações'],
      ...list.map((p) => { const r = recOf(p); return [p.savedName || p.crmName || '', p.pushName || '', p.phone || '', p.savedName ? 'sim' : 'não', (r?.tagIds || []).map((i) => tn[i]).filter(Boolean).join(', '), r?.stage ? W.stageOf(r.stage).name : '', r?.notes || '']; })]);
    W.toast(`${list.length} contato(s) exportados`);
  }

  function importModal() {
    const D = W.data;
    modal('Importar contatos', `<p class="crmw-mut">Cole uma lista (uma pessoa por linha: <b>Nome; Telefone</b>) ou escolha uma planilha CSV.</p>
      <textarea id="cm-imp" rows="7" placeholder="Maria Souza; 27 99999-0000&#10;João Lima; (21) 98888-7777"></textarea>
      <input type="file" id="cm-impf" accept=".csv,.txt">
      <div class="crmw-2"><label>Pôr etiqueta<select id="cm-imptag"><option value="">— nenhuma —</option>${D.tags.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <label>Funil<select id="cm-impst"><option value="">Fora do funil</option>${D.stages.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label></div>
      <label class="crmw-check"><input type="checkbox" id="cm-impsave"><span>Também salvar na agenda do celular</span></label>
      <button class="crmw-btn" id="cm-impok">Importar</button>`, (m) => {
      m.querySelector('#cm-impf').onchange = async (e) => { const f = e.target.files[0]; if (f) m.querySelector('#cm-imp').value = await f.text(); };
      m.querySelector('#cm-impok').onclick = async () => {
        const rows = m.querySelector('#cm-imp').value.split(/\r?\n/).map((l) => l.split(/[;,\t]/).map((x) => x.replace(/^"|"$/g, '').trim())).filter((r) => r.some(Boolean));
        const tag = m.querySelector('#cm-imptag').value, st = m.querySelector('#cm-impst').value, alsoSave = m.querySelector('#cm-impsave').checked;
        const parsed = rows.map((r) => {
          const phoneCell = r.find((x) => x.replace(/\D/g, '').length >= 10) || '';
          let phone = phoneCell.replace(/\D/g, ''); if (phone && phone.length <= 11) phone = '55' + phone;
          const name = r.find((x) => x && x !== phoneCell && !/^\D*\d[\d\s()+-]*$/.test(x)) || '';
          return { name, phone };
        }).filter((x) => x.phone && !/^nome$/i.test(x.name));
        if (!parsed.length) return W.toast('Não achei telefones na lista');
        closeModal();
        let n = 0;
        for (const x of parsed) {
          const c = { key: 'tel:' + x.phone, chatId: x.phone + '@c.us', phone: x.phone, name: x.name || '+' + x.phone };
          const r = W.findLead(c) || await saveLead(newLead(c, { stage: st || '' }));
          await saveLead({ key: r.key, ...(st ? { stage: st } : {}), ...(tag && !r.tagIds?.includes(tag) ? { tagIds: [...(r.tagIds || []), tag] } : {}), ...(x.name && !r.name ? { name: x.name } : {}) });
          if (alsoSave && x.name && W.ready) { const [f, ...l] = x.name.split(' '); await W.wa('saveContact', { phone: x.phone, firstName: f, lastName: l.join(' ') }).catch(() => {}); await new Promise((res) => setTimeout(res, 600)); }
          n++; W.toast(`Importando… ${n}/${parsed.length}`);
        }
        W.toast(`${n} contato(s) importados`); S.people = null; load();
      };
    });
  }

  async function openChat(p) {
    S.scroll = ov.querySelector('.cm-list')?.scrollTop || 0;   // para voltar no mesmo ponto da lista
    close(true);
    await W.openLead({ chatId: p.id, phone: p.phone, name: nameOf(p) });
    W.showReturn('Contatos', () => open(S.tab));
  }
  // salvar/editar na agenda sem sair da tela de contatos
  function savePerson(p) {
    if (!W.ready) return W.toast('Aguarde o WhatsApp carregar');
    const [first, ...rest] = (p.savedName || p.crmName || p.pushName || '').split(' ');
    modal(p.savedName ? 'Editar nome na agenda' : 'Salvar na agenda do celular', `<p class="crmw-mut">+${esc(p.phone)} vai aparecer com este nome no WhatsApp e na agenda do celular.</p>
      <div class="crmw-2"><label>Nome<input id="cm-sf" value="${esc(first)}"></label><label>Sobrenome<input id="cm-sl" value="${esc(rest.join(' '))}"></label></div>
      <button class="crmw-btn" id="cm-sok">Salvar</button>`, (m) => {
      const go = async () => {
        const firstName = m.querySelector('#cm-sf').value.trim(), lastName = m.querySelector('#cm-sl').value.trim();
        if (!firstName) return W.toast('Escreva o nome');
        try {
          await W.wa('saveContact', { phone: p.phone, firstName, lastName });
          p.savedName = (firstName + ' ' + lastName).trim();
          const r = recOf(p); if (r) await saveLead({ key: r.key, name: p.savedName });
          closeModal(); render(); W.toast('Contato salvo: ' + p.savedName);
        } catch (e) { W.toast('Não deu para salvar: ' + e.message); }
      };
      m.querySelector('#cm-sok').onclick = go;
      m.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') go(); }));
    });
  }

  const typing = () => ov.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  W.on('data', (_d, why) => { if (why !== 'dom' && ov.classList.contains('on') && !typing()) render(); });
})();
