// Barra de ações rápidas colada no campo de mensagem + "/" para respostas rápidas + Alt+N para etapa + tour de boas-vindas.
(() => {
  const { esc, norm, saveLead } = CRM;
  const W = globalThis.CRMW;
  let pop = null;          // popover aberto (etapa / etiquetas / respostas)
  let slash = null;        // menu do "/"

  const lead = () => W.findLead(W.chat);

  function closePop() { pop?.remove(); pop = null; }
  function openPop(anchor, html, bind) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'crmw-pop';
    pop.innerHTML = html;
    document.getElementById('crmw').appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 350)) + 'px';
    pop.style.bottom = (innerHeight - r.top + 6) + 'px';
    bind(pop);
  }
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('#crmw-bar')) closePop(); }, true);

  // ---------- respostas rápidas (com sequência) ----------
  async function useReply(r) {
    closePop();
    const c = W.chat, l = lead();
    const ctx = { name: l?.name || c?.name, phone: l?.phone || c?.phone, campaignId: l?.campaignId };
    if (!r.steps?.length) return W.insertText(W.fillVars(r.body, ctx), true);
    if (!W.ready || !c?.chatId) return W.toast('Aguarde o WhatsApp carregar');
    W.showPanel();
    if (!await W.confirmBox('Enviar sequência?', `“${esc(r.title)}” manda ${r.steps.length + 1} mensagens para <b>${esc(c.name)}</b>, uma depois da outra.`, 'Enviar agora')) return;
    W.toast('Enviando sequência…');
    try {
      await W.wa('sendText', { chatId: c.chatId, text: W.fillVars(r.body, ctx), typing: true }, 60000);
      for (const s of r.steps) {
        await new Promise((res) => setTimeout(res, (Number(s.delay) || 3) * 1000));
        await W.wa('sendText', { chatId: c.chatId, text: W.fillVars(s.text, ctx), typing: true }, 60000);
      }
      W.toast('Sequência enviada');
    } catch (e) { W.toast('Erro ao enviar: ' + e.message); }
  }
  const replyList = (q) => {
    const n = norm(q);
    return W.data.quickReplies.filter((r) => !n || norm(r.title + ' ' + r.folder + ' ' + r.body).includes(n));
  };
  const replyHtml = (list, active = -1) => list.length
    ? list.map((r, i) => `<button class="crmw-qi ${i === active ? 'on' : ''}" data-qi="${r.id}"><b>${r.folder ? `<small>${esc(r.folder)} ›</small> ` : ''}${esc(r.title)}${r.steps?.length ? ` <span class="crmw-pill">${r.steps.length + 1} msgs</span>` : ''}</b><span>${esc(r.body)}</span></button>`).join('')
    : '<div class="crmw-pempty">Nenhuma resposta ainda.</div>';
  const manageLink = '<button class="crmw-pfoot" data-manage>+ Criar / editar respostas</button>';
  function openReplies(anchor) {
    openPop(anchor, `<input class="crmw-psearch" placeholder="🔍 Buscar resposta…"><div class="crmw-plist">${replyHtml(replyList(''))}</div>${manageLink}`, (p) => {
      const s = p.querySelector('.crmw-psearch'); s.focus();
      const bindItems = () => p.querySelectorAll('[data-qi]').forEach((x) => (x.onclick = () => useReply(W.data.quickReplies.find((r) => r.id === x.dataset.qi))));
      s.oninput = () => { p.querySelector('.crmw-plist').innerHTML = replyHtml(replyList(s.value)); bindItems(); };
      s.onkeydown = (e) => e.stopPropagation();
      p.querySelector('[data-manage]').onclick = () => { closePop(); chrome.runtime.sendMessage({ type: 'openBoard', view: 'respostas' }); };
      bindItems();
    });
  }
  W.openReplies = openReplies;

  // ---------- barra ----------
  function bar() {
    const footer = document.querySelector('#main footer');
    let el = document.getElementById('crmw-bar');
    if (!footer || !W.chat || W.chat.isGroup) { el?.remove(); return; }
    if (!el || el.parentElement !== footer) {
      el?.remove();
      el = document.createElement('div');
      el.id = 'crmw-bar';
      if (getComputedStyle(footer).position === 'static') footer.style.position = 'relative';
      footer.appendChild(el);                    // fica flutuando logo acima do campo de mensagem
      el.addEventListener('mousedown', (e) => e.stopPropagation());
      el.onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) act(b.dataset.b, b); };
    }
    const l = lead(), c = W.chat;
    const sig = JSON.stringify([c.key, c.savedName, l?.stage, l?.tagIds, W.data.stages, W.data.tags.length]);
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      const st = l?.stage ? W.stageOf(l.stage) : null;
      const tags = (l?.tagIds || []).map((id) => W.data.tags.find((t) => t.id === id)).filter(Boolean);
      // ícone + rótulo (.l); com a conversa estreita os rótulos somem e fica só o ícone (ver content.css)
      const btn = (b, icon, label, title, cls = '') => `<button data-b="${b}" class="crmw-bbtn ${cls}" title="${title}">${icon}<span class="l">${label}</span></button>`;
      el.innerHTML = (st
        ? `<button data-b="stage" class="crmw-bchip" style="--c:${st.color}" title="Mudar etapa (Alt+1…${W.data.stages.length})"><i></i>${esc(st.name)} ▾</button>`
        : `<button data-b="add" class="crmw-bbtn crmw-bprimary" title="Começar a acompanhar este contato no funil">+<span class="l">Pôr no funil</span></button>`)
        + `<button data-b="tags" class="crmw-bbtn" title="Etiquetas deste contato">🏷${tags.length ? `<span class="dots">${tags.map((t) => `<i style="background:${t.color}"></i>`).join('')}</span>` : '<span class="l">Etiqueta</span>'}</button>`
        + btn('replies', '⚡', 'Respostas', 'Respostas prontas (ou digite / no campo)')
        + btn('schedule', '⏰', 'Agendar', 'Enviar uma mensagem depois, sozinho')
        + btn('remind', '🔔', 'Lembrar', 'Te avisar de fazer algo com este contato')
        + (c.phone && !c.savedName ? btn('save', '💾', 'Salvar', 'Salvar na agenda do celular') : '')
        + `<span class="crmw-bsp"></span>${btn('panel', '', 'Ficha ›', 'Abrir a ficha completa', 'crmw-bghost')}`;
    }
    reserveSpace(el);
  }

  // a barra flutua sobre a conversa: reserva espaço no fim da lista de mensagens para não cobrir a última
  function messageScroller() {
    let n = document.querySelector('#main [data-id]');
    while (n && n.id !== 'main') {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return n;   // mesmo sem rolagem: o WhatsApp encosta as mensagens embaixo
      n = n.parentElement;
    }
    return null;
  }
  function reserveSpace(el) {
    const sc = messageScroller();
    if (!sc) return;
    const need = el.offsetHeight + 12;
    if (Number(sc.dataset.crmwPad) === need && sc.style.paddingBottom === need + 'px') return;
    const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
    sc.style.paddingBottom = need + 'px';
    sc.dataset.crmwPad = need;
    if (atBottom) sc.scrollTop = sc.scrollHeight;
  }

  async function act(name, b) {
    if (name === 'add') { await W.actions.addLead('Orgânico'); W.showPanel(); return; }
    if (name === 'replies') return openReplies(b);
    if (name === 'schedule') { W.showPanel(); return W.actions.schedule(); }
    if (name === 'remind') { W.showPanel(); return W.actions.remind(); }
    if (name === 'save') { W.showPanel(); return W.actions.saveContact(W.chat); }
    if (name === 'panel') return W.showPanel();
    if (name === 'stage') {
      return openPop(b, `<div class="crmw-ptitle">Mover para a etapa</div>${W.data.stages.map((s, i) => `<button class="crmw-qi ${s.id === lead().stage ? 'on' : ''}" data-st="${s.id}"><b><i class="crmw-sw" style="background:${s.color}"></i>${esc(s.name)}</b><span>Alt+${i + 1}</span></button>`).join('')}`,
        (p) => p.querySelectorAll('[data-st]').forEach((x) => (x.onclick = () => { saveLead({ key: lead().key, stage: x.dataset.st }); closePop(); })));
    }
    if (name === 'tags') {
      const l = lead() || await W.ensureRecord(W.chat);
      return openPop(b, `<div class="crmw-ptitle">Etiquetas de ${esc(l.name)}</div>${W.data.tags.map((t) => `<label class="crmw-qi crmw-qcheck"><input type="checkbox" data-tg="${t.id}" ${l.tagIds?.includes(t.id) ? 'checked' : ''}><i class="crmw-sw" style="background:${t.color}"></i><b>${esc(t.name)}</b></label>`).join('') || '<div class="crmw-pempty">Nenhuma etiqueta ainda.</div>'}
        <div class="crmw-pfoot2"><button class="crmw-pfoot" data-newtag>+ Nova etiqueta</button><button class="crmw-pfoot" data-mtags>Gerenciar</button></div>`, (p) => {
        p.querySelectorAll('[data-tg]').forEach((x) => (x.onchange = () => W.toggleTag(W.findLead(W.chat), x.dataset.tg)));
        p.querySelector('[data-newtag]').onclick = () => { closePop(); W.showPanel(); W.actions.newTag(W.findLead(W.chat)); };
        p.querySelector('[data-mtags]').onclick = () => { closePop(); W.openContacts?.('tags'); };
      });
    }
  }

  // ---------- "/" no campo de mensagem ----------
  const composer = () => document.querySelector('#main footer [contenteditable="true"]');
  function slashClose() { slash?.el.remove(); slash = null; }
  function slashUpdate() {
    const box = composer();
    const txt = box?.innerText.replace(/\n$/, '') || '';
    const m = txt.match(/^\/([^\n/]{0,30})$/);
    if (!box || !m || !box.contains(document.activeElement)) return slashClose();
    const list = replyList(m[1]).slice(0, 8);
    if (!slash) {
      const el = document.createElement('div');
      el.className = 'crmw-pop crmw-slash';
      document.getElementById('crmw').appendChild(el);
      slash = { el, i: 0 };
    }
    slash.list = list; slash.i = Math.min(slash.i, Math.max(0, list.length - 1));
    slash.el.innerHTML = `<div class="crmw-ptitle">Respostas rápidas · ↑↓ escolhe · Enter usa · Esc fecha</div>${replyHtml(list, slash.i)}${list.length ? '' : manageLink}`;
    const r = box.getBoundingClientRect();
    slash.el.style.left = Math.max(8, r.left) + 'px';
    slash.el.style.bottom = (innerHeight - r.top + 50) + 'px';
    slash.el.querySelectorAll('[data-qi]').forEach((x) => (x.onmousedown = (e) => { e.preventDefault(); pickSlash(list.find((q) => q.id === x.dataset.qi)); }));
    slash.el.querySelector('[data-manage]')?.addEventListener('mousedown', () => chrome.runtime.sendMessage({ type: 'openBoard', view: 'respostas' }));
  }
  function pickSlash(r) {
    slashClose();
    if (!r) return;
    if (r.steps?.length) W.insertText('', true);
    useReply(r);
  }
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
      const st = W.data.stages[Number(e.code.slice(5)) - 1], l = lead();
      if (st && l) { e.preventDefault(); saveLead({ key: l.key, stage: st.id }); W.toast('Etapa: ' + st.name); }
      return;
    }
    if (!slash || !slash.list) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); slash.i = (slash.i + (e.key === 'ArrowDown' ? 1 : -1) + slash.list.length) % Math.max(1, slash.list.length); slashUpdate(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && slash.list.length) { e.preventDefault(); e.stopPropagation(); pickSlash(slash.list[slash.i]); }
    else if (e.key === 'Escape') slashClose();
  }, true);
  document.addEventListener('input', (e) => { if (e.target.closest?.('#main footer')) setTimeout(slashUpdate, 0); }, true);

  // ---------- tour de boas-vindas ----------
  const STEPS = [
    ['#crmw-panel', 'Painel do CRM', 'Aqui fica a <b>ficha do cliente</b> da conversa aberta: etapa do funil, etiquetas, anotações e ações rápidas. O botão verde <b>CRM</b> mostra/esconde o painel.'],
    ['#crmw-bar', 'Barra na conversa', 'Atalhos sem sair da conversa: <b>pôr no funil</b>, mudar etapa, <b>respostas prontas</b>, <b>agendar</b> mensagem, <b>lembrar</b> e <b>salvar contato</b>. Abra uma conversa para ver.'],
    ['[data-nav="hoje"]', 'Hoje', 'Sua lista do dia: quem precisa de retorno, lembretes e mensagens agendadas. Um clique abre a conversa.'],
    ['#crmw-copen', 'Contatos', 'Todos os seus contatos e conversas: <b>salvar na agenda</b>, <b>etiquetar</b> (um ou vários de uma vez), filtrar, importar e exportar.'],
    ['#crmw-kopen', 'Kanban', 'Todos os leads por etapa. Arraste os cartões entre as colunas.'],
    [null, 'Dica', 'Digite <b>/</b> no campo de mensagem para usar uma resposta pronta. <b>Alt+1, Alt+2…</b> muda a etapa do cliente aberto.'],
  ];
  function tour(force) {
    if (!force && W.data.prefs?.tourDone) return;
    W.showPanel();
    let i = 0;
    const box = document.createElement('div');
    box.className = 'crmw-tour';
    document.getElementById('crmw').appendChild(box);
    const show = () => {
      document.querySelectorAll('.crmw-hl').forEach((x) => x.classList.remove('crmw-hl'));
      const [sel, title, text] = STEPS[i];
      const target = sel && document.querySelector(sel);
      target?.classList.add('crmw-hl');
      box.innerHTML = `<div class="crmw-tour-c"><small>${i + 1} de ${STEPS.length}</small><b>${title}</b><p>${text}</p>
        <div class="crmw-row"><button class="crmw-link" data-t="skip">pular</button><span class="crmw-sp"></span>${i ? '<button class="crmw-btn crmw-g" data-t="back">Voltar</button>' : ''}<button class="crmw-btn" data-t="next">${i === STEPS.length - 1 ? 'Começar' : 'Próximo'}</button></div></div>`;
      const r = target?.getBoundingClientRect();
      const c = box.firstElementChild;
      if (r && r.width) {
        const left = r.left > innerWidth / 2 ? Math.max(12, r.left - 330) : Math.min(innerWidth - 332, r.right + 12);
        c.style.left = left + 'px'; c.style.top = Math.min(innerHeight - 220, Math.max(12, r.top)) + 'px';
      } else { c.style.left = 'calc(50% - 160px)'; c.style.top = '30%'; }
      box.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
        if (b.dataset.t === 'next' && i < STEPS.length - 1) { i++; return show(); }
        if (b.dataset.t === 'back') { i--; return show(); }
        document.querySelectorAll('.crmw-hl').forEach((x) => x.classList.remove('crmw-hl'));
        box.remove();
        CRM.store.set({ prefs: { ...(W.data.prefs || {}), tourDone: true } });
      }));
    };
    show();
  }
  W.tour = tour;

  W.on('chat', () => { closePop(); slashClose(); bar(); });
  W.on('data', (_d, why) => { bar(); if (why === 'load') setTimeout(() => tour(false), 1500); });
})();
