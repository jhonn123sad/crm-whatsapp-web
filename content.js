// Núcleo do CRM dentro do WhatsApp Web: ponte com o WhatsApp, painel lateral (Cliente / Hoje / Ferramentas)
// e componentes simples (folha deslizante, confirmação, escolha rápida de horário) usados também pelo toolbar.js e automation.js.
(() => {
  const { SOURCES, COLORS, getAll, saveLead, removeLead, newLead, newCampaign, upsertItem, removeItem, norm, esc, fillVars, money } = CRM;
  let data = { leads: {}, stages: CRM.DEFAULT_STAGES, tags: [], campaigns: [], quickReplies: [], adPhrases: [], scheduled: [], reminders: [],
    broadcasts: [], contactGroups: [], bots: [], customFields: [], prefs: {} };
  let chat = null;
  let open = localStorage.getItem('crmw-open') !== '0';
  let view = 'cliente', sub = null;      // sub: página dentro de Ferramentas
  let loaded = false, waReady = false;
  let contacts = null, contactsQuery = '', groups = null;
  const picked = new Set();
  const checkedAds = new Set();
  const listeners = { data: [], chat: [], message: [] };

  // ---------- ponte com o WhatsApp (bridge-main.js / WA-JS) ----------
  let seq = 0;
  const pending = new Map();
  function wa(cmd, args, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ crmw: 'req', id, cmd, args }, '*');
      setTimeout(() => { if (pending.delete(id)) reject(new Error('o WhatsApp não respondeu')); }, timeout);
    });
  }
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d) return;
    if (d.crmw === 'res' && pending.has(d.id)) {
      const p = pending.get(d.id); pending.delete(d.id);
      d.ok ? p.resolve(d.result) : p.reject(new Error(d.error));
    }
    if (d.crmw === 'event') onEvent(d.event, d.data);
  });
  async function onEvent(ev, d) {
    if (ev === 'ready' && !waReady) { waReady = true; await refreshActive(); render(); detectAd(chat); }
    if (ev === 'active_chat') setChat(d ? fromWa(d) : null);
    if (ev === 'new_message' && loaded && d?.chat) {
      const c = fromWa(d.chat);
      const lead = findLead(c);
      if (!lead && (d.ad || matchesAdPhrase(d.text))) {
        await saveLead(newLead(c, await adFields(d.ad, null, d.text)));
        toast(`Novo lead de anúncio: ${c.name}`);
      } else if (lead && d.ad && !lead.adUrl) {
        saveLead({ key: lead.key, ...(await adFields(d.ad, lead)) });
      }
      if (lead && !d.isMine) saveLead({ key: lead.key, lastInAt: Date.now() });
      listeners.message.forEach((f) => f({ chat: c, text: d.text, firstEver: d.firstEver, lead: findLead(c) }));
    }
  }
  wa('status').then((s) => { if (s.ready) onEvent('ready'); }).catch(() => {});

  const fromWa = (d) => ({ key: d.phone ? 'tel:' + d.phone : 'id:' + d.id, chatId: d.id, name: d.name, phone: d.phone || '',
    savedName: d.savedName, pushName: d.pushName, isGroup: d.isGroup });

  // anúncio Click-to-WhatsApp -> campanha (cria se não existir)
  async function campaignFor(title, text) {
    const n = norm(text);
    const byPhrase = n && data.campaigns.find((c) => c.phrase && n.includes(norm(c.phrase)));
    if (byPhrase) return byPhrase.id;
    if (!title) return '';
    const found = data.campaigns.find((c) => norm(c.name) === norm(title));
    if (found) return found.id;
    return (await upsertItem('campaigns', newCampaign(title))).id;
  }
  async function adFields(ad, lead, text) {
    const campaignId = lead?.campaignId || await campaignFor(ad?.title, text);
    return ad
      ? { source: 'Anúncio', campaignId, adUrl: ad.url, adBody: ad.body, adTitle: ad.title,
          notes: lead?.notes || ('Veio do anúncio' + (ad.title ? ': ' + ad.title : '') + (ad.app ? ` (${ad.app})` : '')) }
      : { source: 'Anúncio', campaignId, notes: 'Entrou pela mensagem automática do anúncio.' };
  }
  const matchesAdPhrase = (t) => {
    const n = norm(t);
    if (!n) return false;
    return [...data.adPhrases, ...data.campaigns.map((c) => c.phrase)].map(norm).filter(Boolean).some((p) => n.includes(p));
  };

  async function refreshActive() {
    if (!waReady) return;
    const d = await wa('activeChat').catch(() => null);
    setChat(d ? fromWa(d) : domChat());
  }
  // leitura pela tela, usada só até o WA-JS carregar
  function domChat() {
    const header = document.querySelector('#main header');
    if (!header) return null;
    const name = (header.querySelector('span[title]')?.getAttribute('title') || header.querySelector('span[dir="auto"]')?.textContent || '').trim();
    if (!name) return null;
    let jid = null;
    for (const el of document.querySelectorAll('#main [data-id]')) {
      const m = el.getAttribute('data-id').match(/^(?:true|false)_([^_]+@(?:c\.us|lid|g\.us))/);
      if (m) { jid = m[1]; break; }
    }
    let phone = jid?.endsWith('@c.us') ? jid.split('@')[0] : '';
    if (!phone && /^\+?[\d\s()-]{10,}$/.test(name)) phone = name.replace(/\D/g, '');
    return { key: phone ? 'tel:' + phone : 'nome:' + norm(name), chatId: jid, name, phone, isGroup: !!jid?.endsWith('@g.us') };
  }

  function findLead(c) {
    if (!c) return null;
    const L = data.leads;
    if (L[c.key]) return L[c.key];
    return Object.values(L).find((l) => (c.chatId && l.chatId === c.chatId) || (c.phone && l.phone === c.phone)) ||
      Object.values(L).find((l) => norm(l.name) === norm(c.name)) || null;
  }
  function leadForTitle(title) {
    const t = norm(title), digits = title.replace(/\D/g, '');
    return Object.values(data.leads).find((l) => norm(l.name) === t || (digits.length >= 10 && l.phone && l.phone.endsWith(digits.slice(-10))));
  }
  async function ensureLead(c, extra) { return findLead(c) || saveLead(newLead(c, extra)); }
  // ficha sem entrar no funil (para etiquetas/notas de qualquer contato)
  async function ensureRecord(c) { return findLead(c) || saveLead(newLead(c, { stage: '' })); }

  function setChat(c) {
    const changed = (c?.key || '') !== (chat?.key || '') || c?.name !== chat?.name || c?.savedName !== chat?.savedName;
    chat = c;
    if (!changed) return;
    const lead = findLead(c);
    if (lead && c && (lead.name !== c.name || (c.phone && !lead.phone) || (c.chatId && !lead.chatId))) {
      saveLead({ key: lead.key, name: c.name, phone: lead.phone || c.phone, chatId: lead.chatId || c.chatId });
    }
    // não troca a aba sozinho: quem está em "Hoje" ou numa lista continua no mesmo lugar
    closeSheet();
    render();
    listeners.chat.forEach((f) => f(c));
    detectAd(c);
  }

  async function detectAd(c) {
    if (!loaded || !c || c.isGroup || checkedAds.has(c.key) || findLead(c)) return;
    checkedAds.add(c.key);
    if (!waReady || !c.chatId) { checkedAds.delete(c.key); return; }   // tenta de novo quando o WhatsApp carregar
    const found = await wa('findAd', { chatId: c.chatId }).catch(() => null);
    const ad = found?.ad || null;
    const firstText = matchesAdPhrase(found?.firstText) ? found.firstText : '';
    if (ad || firstText) {
      await saveLead(newLead(c, await adFields(ad, null, firstText)));
      toast('Lead de anúncio adicionado ao funil');
    }
  }

  // ---------- estrutura na página ----------
  const root = document.createElement('div');
  root.id = 'crmw';
  root.innerHTML = `<button id="crmw-tab" title="Mostrar/ocultar CRM">CRM</button>
    <aside id="crmw-panel"><div id="crmw-main"></div><div id="crmw-sheet"></div></aside>
    <div id="crmw-toast"></div>
    <div id="crmw-kanban"><div class="crmw-kbar"><b>Kanban</b><span class="crmw-mut">Arraste os cartões entre as colunas · clique para abrir a conversa · Esc fecha</span><button class="crmw-btn crmw-g" id="crmw-kclose">Fechar ✕</button></div><iframe id="crmw-kframe" title="Kanban"></iframe></div>`;
  document.body.appendChild(root);
  const panel = root.querySelector('#crmw-panel');
  const main = root.querySelector('#crmw-main');
  const sheet = root.querySelector('#crmw-sheet');
  // o WhatsApp escuta teclado/clique na página toda; isola o que acontece dentro do CRM
  for (const ev of ['keydown', 'keyup', 'keypress', 'paste']) root.addEventListener(ev, (e) => { if (e.target.closest('input, textarea, select, [contenteditable]')) e.stopPropagation(); });
  root.querySelector('#crmw-tab').onclick = () => { open = !open; localStorage.setItem('crmw-open', open ? '1' : '0'); applyPrefs(); };

  function openKanban() {
    const f = root.querySelector('#crmw-kframe');
    if (!f.src) f.src = chrome.runtime.getURL('board.html?embed=1#funil');
    else sendThemeToBoard();
    root.querySelector('#crmw-kanban').classList.add('on');
    hideReturn();
  }
  // o Kanban embutido segue o mesmo tema do painel
  function sendThemeToBoard() {
    const f = root.querySelector('#crmw-kframe');
    const h = document.documentElement;
    f?.contentWindow?.postMessage({ crmw: 'theme', theme: h.dataset.crmwTheme, style: h.dataset.crmwStyle }, '*');
  }
  root.querySelector('#crmw-kframe').addEventListener('load', sendThemeToBoard);
  const closeKanban = () => root.querySelector('#crmw-kanban').classList.remove('on');
  root.querySelector('#crmw-kclose').onclick = closeKanban;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeKanban(); closeSheet(); } });
  window.addEventListener('message', (e) => {
    if (e.origin !== new URL(chrome.runtime.getURL('')).origin || e.data?.crmw !== 'board') return;
    if (e.data.action === 'openChat') { closeKanban(); openLead(e.data.lead); showReturn('Kanban', openKanban); }
  });

  const BLUR = ['blurMsgs', 'blurList', 'blurPreview', 'blurPhotos', 'blurHeader'];
  // WhatsApp em modo escuro? (ele marca a página com a classe "dark")
  const waIsDark = () => !!(document.body?.classList.contains('dark') || document.documentElement.classList.contains('dark'));
  function applyPrefs() {
    const h = document.documentElement, p = data.prefs || {};
    h.classList.toggle('crmw-open', open);
    for (const k of BLUR) h.classList.toggle('crmw-' + k, !!p[k]);
    const theme = p.crmTheme === 'light' || p.crmTheme === 'dark' ? p.crmTheme : (waIsDark() ? 'dark' : 'light');
    const style = p.crmStyle === 'apple' ? 'apple' : 'whatsapp';
    if (h.dataset.crmwTheme !== theme || h.dataset.crmwStyle !== style) {
      h.dataset.crmwTheme = theme; h.dataset.crmwStyle = style;
      sendThemeToBoard();
    }
    applyWallpaper(p);
  }

  // ---------- papel de parede da conversa (só nesta tela; não muda nada na conta) ----------
  let wallImg = null, wallKey = '';
  async function applyWallpaper(p) {
    const w = p.wall || { type: 'default' };
    if (w.type === 'image' && wallImg === null) wallImg = (await CRM.store.get('wallImg')).wallImg || '';
    const value = w.type === 'color' || w.type === 'gradient' ? w.value : w.type === 'image' && wallImg ? `center / cover no-repeat url("${wallImg}")` : '';
    const key = JSON.stringify([w.type, w.value, w.hideDoodles, value.length]);
    if (key === wallKey) return;
    wallKey = key;
    let st = document.getElementById('crmw-wall-style');
    if (!st) { st = document.createElement('style'); st.id = 'crmw-wall-style'; document.head.appendChild(st); }
    // WhatsApp atual: fundo = conversation-panel-wrapper; desenhos = camada com máscara (default_chat_wallpaper)
    const wrap = '[data-testid="conversation-panel-wrapper"]';   // é o próprio #main
    const doodles = '#main [data-testid^="conversation-background"], #main [data-asset-chat-background-light], #main [data-asset-chat-background-dark]';
    st.textContent = value
      ? `${wrap} { background: ${value} !important; } ${doodles} { display: none !important; }`
      : w.hideDoodles ? `${doodles} { display: none !important; }` : '';
  }
  applyPrefs();

  // botão flutuante para voltar exatamente onde estava (Kanban / Contatos) depois de abrir uma conversa
  function showReturn(label, reopen) {
    let b = root.querySelector('#crmw-return');
    if (!b) { b = document.createElement('div'); b.id = 'crmw-return'; root.appendChild(b); }
    b.innerHTML = `<button data-r="go">↩ Voltar para ${esc(label)}</button><button data-r="x" title="Fechar">✕</button>`;
    b.classList.add('on');
    b.querySelector('[data-r=go]').onclick = () => { b.classList.remove('on'); reopen(); };
    b.querySelector('[data-r=x]').onclick = () => b.classList.remove('on');
  }
  function hideReturn() { root.querySelector('#crmw-return')?.classList.remove('on'); }

  function toast(t) { const el = root.querySelector('#crmw-toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3200); }

  // ---------- componentes ----------
  // folha que sobe por cima do painel (substitui prompt/alert do navegador)
  function openSheet(title, html, bind) {
    sheet.innerHTML = `<div class="crmw-sheet-in"><div class="crmw-sheet-h"><b>${title}</b><button class="crmw-x" data-close>✕</button></div><div class="crmw-sheet-b">${html}</div></div>`;
    sheet.classList.add('on');
    sheet.querySelector('[data-close]').onclick = closeSheet;
    bind?.(sheet);
    sheet.querySelector('input:not([type=hidden]), textarea')?.focus();
  }
  function closeSheet() {
    if (!sheet.classList.contains('on')) return;
    sheet.classList.remove('on'); sheet.innerHTML = '';
    if (pendingRender) { pendingRender = false; render(); }   // aplica mudanças que chegaram com a folha aberta
  }
  function confirmBox(title, text, ok = 'Confirmar') {
    return new Promise((resolve) => {
      openSheet(title, `<p>${text}</p><div class="crmw-row"><button class="crmw-btn" data-ok>${ok}</button><button class="crmw-btn crmw-g" data-no>Cancelar</button></div>`, (s) => {
        s.querySelector('[data-ok]').onclick = () => { closeSheet(); resolve(true); };
        s.querySelector('[data-no]').onclick = () => { closeSheet(); resolve(false); };
      });
    });
  }
  function askText(title, label, placeholder = '', value = '') {
    return new Promise((resolve) => {
      openSheet(title, `<label>${label}<input data-v value="${esc(value)}" placeholder="${esc(placeholder)}"></label><div class="crmw-row"><button class="crmw-btn" data-ok>Salvar</button><button class="crmw-btn crmw-g" data-no>Cancelar</button></div>`, (s) => {
        const go = () => { const v = s.querySelector('[data-v]').value.trim(); closeSheet(); resolve(v || null); };
        s.querySelector('[data-ok]').onclick = go;
        s.querySelector('[data-v]').onkeydown = (e) => { if (e.key === 'Enter') go(); };
        s.querySelector('[data-no]').onclick = () => { closeSheet(); resolve(null); };
      });
    });
  }
  // atalhos de horário: "Em 1 hora", "Amanhã 9h"...
  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function whenOptions() {
    const at = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
    const nextMon = () => { const d = at(0, 9); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d; };
    return [['Em 1 hora', new Date(Date.now() + 3600e3)], ['Hoje 18h', at(0, 18)], ['Amanhã 9h', at(1, 9)], ['Amanhã 14h', at(1, 14)], ['Segunda 9h', nextMon()], ['Em 1 semana', at(7, 9)]]
      .filter(([, d]) => d > Date.now());
  }
  const whenPicker = (id) => `<div class="crmw-when">${whenOptions().map(([n, d]) => `<button type="button" class="crmw-chip" data-when="${toLocal(d)}">${n}</button>`).join('')}</div>
    <input type="datetime-local" id="${id}" value="${toLocal(whenOptions()[0][1])}">`;
  function bindWhen(scope, id) {
    scope.querySelectorAll('[data-when]').forEach((b) => (b.onclick = () => {
      scope.querySelector('#' + id).value = b.dataset.when;
      scope.querySelectorAll('[data-when]').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }
  const fmtWhen = (t) => new Date(t).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ---------- ações rápidas (painel e barra usam as mesmas) ----------
  const actions = {
    async addLead(source, c = chat, stage) {
      if (!c || c.isGroup) return;
      const rec = findLead(c);
      const first = stage || data.stages[0].id;
      if (rec) await saveLead({ key: rec.key, stage: rec.stage || first, ...(source ? { source } : {}) });
      else await saveLead(newLead(c, { source: source || 'Orgânico', stage: first }));
      toast('Adicionado ao funil' + (source === 'Anúncio' ? ' como lead de anúncio' : ''));
    },
    // salva/renomeia na agenda do celular (via WhatsApp). onDone recebe o nome completo.
    saveContact(c = chat, onDone) {
      if (!c?.phone) return toast('O WhatsApp não informou o número deste contato');
      const current = c.savedName || c.pushName || (/^\+?\d/.test(c.name || '') ? '' : c.name) || '';
      const [first, ...rest] = current.split(' ');
      openSheet(c.savedName ? 'Editar nome na agenda' : 'Salvar na agenda do celular', `<p class="crmw-mut">+${esc(c.phone)} vai aparecer com este nome no seu WhatsApp e na agenda do celular.</p>
        <div class="crmw-2"><label>Nome<input id="sc-first" value="${esc(first)}"></label><label>Sobrenome<input id="sc-last" value="${esc(rest.join(' '))}"></label></div>
        <button class="crmw-btn" id="sc-ok">${c.savedName ? 'Salvar alteração' : 'Salvar contato'}</button>`, (s) => {
        const go = async () => {
          const firstName = s.querySelector('#sc-first').value.trim(), lastName = s.querySelector('#sc-last').value.trim();
          if (!firstName) return toast('Escreva o nome');
          try {
            await wa('saveContact', { phone: c.phone, firstName, lastName });
            const full = (firstName + ' ' + lastName).trim();
            const l = findLead(c); if (l) saveLead({ key: l.key, name: full });
            if (chat && (chat.chatId === c.chatId || chat.phone === c.phone)) { chat = { ...chat, savedName: full, name: full }; listeners.chat.forEach((f) => f(chat)); }
            closeSheet(); render(); onDone?.(full);
            toast('Contato salvo: ' + full);
          } catch (e) { toast('Não deu para salvar: ' + e.message); }
        };
        s.querySelector('#sc-ok').onclick = go;
        s.querySelectorAll('input').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') go(); }));
      });
    },
    schedule() {
      const c = chat;
      if (!c || c.isGroup) return toast('Abra a conversa de um contato');
      openSheet(`Agendar mensagem para ${esc(c.name)}`, `<textarea id="ag-text" rows="4" placeholder="Escreva a mensagem…"></textarea>
        <div class="crmw-mut">Quando enviar:</div>${whenPicker('ag-at')}
        <button class="crmw-btn" id="ag-ok">Agendar envio</button>
        <p class="crmw-mut">Sai automaticamente com o WhatsApp Web aberto. Se estiver fechado na hora, sai assim que você abrir.</p>`, (s) => {
        bindWhen(s, 'ag-at');
        s.querySelector('#ag-ok').onclick = async () => {
          const text = s.querySelector('#ag-text').value.trim(), at = new Date(s.querySelector('#ag-at').value).getTime();
          if (!text) return toast('Escreva a mensagem');
          if (!at || at < Date.now() - 60e3) return toast('Escolha um horário no futuro');
          if (!c.chatId) return toast('Aguarde o WhatsApp terminar de carregar');
          await upsertItem('scheduled', { chatId: c.chatId, name: c.name, phone: c.phone, text, at, status: 'pendente' });
          closeSheet(); toast('Agendada para ' + fmtWhen(at));
        };
      });
    },
    remind() {
      const c = chat;
      if (!c || c.isGroup) return toast('Abra a conversa de um contato');
      openSheet(`Lembrete sobre ${esc(c.name)}`, `<input id="lb-note" placeholder="O que fazer? Ex.: ligar para fechar">
        <div class="crmw-mut">Quando avisar:</div>${whenPicker('lb-at')}
        <button class="crmw-btn" id="lb-ok">Criar lembrete</button>
        <p class="crmw-mut">Aparece uma notificação do Windows. Clicando nela, a conversa abre.</p>`, (s) => {
        bindWhen(s, 'lb-at');
        s.querySelector('#lb-ok').onclick = async () => {
          const note = s.querySelector('#lb-note').value.trim(), at = new Date(s.querySelector('#lb-at').value).getTime();
          if (!note) return toast('Escreva o lembrete');
          await upsertItem('reminders', { chatId: c.chatId, phone: c.phone, name: c.name, note, at, done: false });
          const l = findLead(c); if (l) saveLead({ key: l.key, followUp: new Date(at).toISOString().slice(0, 10) });
          closeSheet(); toast('Vou te lembrar ' + fmtWhen(at));
        };
      });
    },
    async copyLink() {
      const p = findLead(chat)?.phone || chat?.phone;
      if (!p) return toast('Número não disponível para este contato');
      await navigator.clipboard.writeText('https://wa.me/' + p); toast('Link copiado: wa.me/' + p);
    },
    async newTag(lead) {
      const name = await askText('Nova etiqueta', 'Nome', 'Ex.: Quente, Orçamento enviado, VIP');
      if (!name) return;
      const t = await upsertItem('tags', { name, color: COLORS[data.tags.length % COLORS.length] });
      if (lead) await saveLead({ key: lead.key, tagIds: [...(lead.tagIds || []), t.id] });
    },
    async newCampaign(lead) {
      const name = await askText('Nova campanha', 'Nome da campanha', 'Ex.: Promo Outubro - Instagram');
      if (!name) return render();
      const c = await upsertItem('campaigns', newCampaign(name));
      if (lead) await saveLead({ key: lead.key, campaignId: c.id });
    },
    nextStage(lead) {
      const i = data.stages.findIndex((s) => s.id === lead.stage);
      const next = data.stages[Math.min(i + 1, data.stages.length - 1)];
      saveLead({ key: lead.key, stage: next.id }); toast('Etapa: ' + next.name);
    },
  };

  // ---------- painel ----------
  const NAV = [['cliente', '👤', 'Cliente'], ['hoje', '📅', 'Hoje'], ['ferramentas', '🧰', 'Ferramentas']];
  // redesenhar não pode jogar a rolagem para o topo: guarda a posição por aba
  const scrollPos = {};
  function render() {
    const where = view + '/' + (sub || '');
    if (main.dataset.where) scrollPos[main.dataset.where] = main.scrollTop;
    try { draw(); } catch (e) { main.textContent = 'Erro no CRM: ' + e.message; console.error('[CRM]', e); }
    main.dataset.where = where;
    main.scrollTop = scrollPos[where] || 0;
  }
  function todayItems() {
    const t0 = new Date(); t0.setHours(23, 59, 59, 999);
    const today = new Date().toISOString().slice(0, 10);
    const leads = Object.values(data.leads);
    return {
      followUps: leads.filter((l) => l.followUp && l.followUp <= today && !['fechado', 'perdido'].includes(l.stage)),
      reminders: data.reminders.filter((r) => !r.done && r.at <= t0.getTime()),
      upcoming: data.reminders.filter((r) => !r.done && r.at > t0.getTime()).sort((a, b) => a.at - b.at).slice(0, 5),
      scheduled: data.scheduled.filter((s) => ['pendente', 'erro'].includes(s.status)).sort((a, b) => a.at - b.at),
      fresh: leads.filter((l) => l.stage === data.stages[0]?.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8),
    };
  }
  function draw() {
    const T = todayItems();
    const badge = T.followUps.length + T.reminders.length;
    main.innerHTML = `<header class="crmw-top"><b class="crmw-logo">CRM</b><span class="crmw-sp"></span>
        <button class="crmw-btn crmw-g" id="crmw-copen" title="Todos os contatos: salvar, etiquetar, organizar">👥 Contatos</button><button class="crmw-btn" id="crmw-kopen" title="Ver todos os leads por etapa">▦ Kanban</button>
        <button class="crmw-icon" id="crmw-theme" title="Tema do CRM: automático, claro ou escuro">${THEME_ICON[data.prefs?.crmTheme || 'auto']}</button><button class="crmw-icon" id="crmw-help" title="Como funciona">?</button></header>
      <nav class="crmw-nav">${NAV.map(([k, i, n]) => `<button data-nav="${k}" class="${view === k ? 'on' : ''}">${i} ${n}${k === 'hoje' && badge ? ` <span class="crmw-count">${badge}</span>` : ''}</button>`).join('')}</nav>
      ${waReady ? '' : '<div class="crmw-warn">⏳ Conectando ao seu WhatsApp… alguns botões liberam em instantes.</div>'}
      <div id="crmw-body"></div>
      <footer class="crmw-support"><div class="crmw-sup-card">
        <span class="crmw-sup-ic">${HEART}</span>
        <div><b>Gostou do CRM?</b><small>É grátis e open source. Apoie com um Pix, se quiser.</small></div>
        <button id="crmw-apoiar">Apoiar</button></div></footer>`;
    main.querySelector('#crmw-apoiar').onclick = support;
    main.querySelector('#crmw-kopen').onclick = openKanban;
    main.querySelector('#crmw-copen').onclick = () => globalThis.CRMW.openContacts?.();
    main.querySelector('#crmw-theme').onclick = () => {
      const order = ['auto', 'light', 'dark'], cur = data.prefs?.crmTheme || 'auto';
      const next = order[(order.indexOf(cur) + 1) % 3];
      CRM.store.set({ prefs: { ...data.prefs, crmTheme: next } });
      toast('Tema do CRM: ' + { auto: 'automático (igual ao WhatsApp)', light: 'claro', dark: 'escuro' }[next]);
    };
    main.querySelector('#crmw-help').onclick = () => globalThis.CRMW.tour?.(true);
    main.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { view = b.dataset.nav; sub = null; closeSheet(); render(); }));
    const body = main.querySelector('#crmw-body');
    if (view === 'hoje') return drawToday(body, T);
    if (view === 'ferramentas') return sub ? drawSub(body) : drawTools(body);
    drawClient(body);
  }

  // apoio voluntário: o CRM continua 100% grátis, sem nada bloqueado
  const SUPPORT_CONTACT = 'jhonny.alves12@gmail.com';
  // Pix estático (BR Code, sem validade, valor livre): mesmo conteúdo do pix-qr.svg
  const PIX_COPIA_E_COLA = '00020126460014br.gov.bcb.pix0124jhonny.alves12@gmail.com5204000053039865802BR5912JHONNY ALVES6006BRASIL62070503***6304E0AF';
  const HEART = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21z"/></svg>';
  function support() {
    openSheet(`<span class="crmw-sup-t"><span class="crmw-sup-ic">${HEART}</span>Apoiar o desenvolvedor</span>`, `<div class="crmw-sup-badges"><span>✔ Grátis</span><span>✔ Open source</span><span>✔ Tudo liberado</span></div>
      <p class="crmw-sup-p">Continua grátis com ou sem apoio. Se quiser ajudar, qualquer valor via <b>Pix</b> 💚</p>
      <div class="crmw-sup-qr"><div class="crmw-qrbox" role="img" aria-label="QR Code Pix"></div>
        <div><div class="crmw-sup-pixlabel"><span class="crmw-pix">PIX</span> Aponte a câmera do banco</div>
        <button class="crmw-btn" id="crmw-copypix">Copiar Pix Copia e Cola</button>
        <div class="crmw-sup-key">Chave (e-mail):<br><code>${SUPPORT_CONTACT}</code> <button class="crmw-link" id="crmw-copymail">copiar</button></div></div></div>`, (s) => {
      s.querySelector('#crmw-copymail').onclick = async () => { await navigator.clipboard.writeText(SUPPORT_CONTACT); toast('Chave Pix copiada: ' + SUPPORT_CONTACT); };
      fetch(chrome.runtime.getURL('pix-qr.svg')).then((r) => r.text()).then((svg) => { const b = s.querySelector('.crmw-qrbox'); if (b) b.innerHTML = svg; }).catch(() => {});
      s.querySelector('#crmw-copypix').onclick = async () => { await navigator.clipboard.writeText(PIX_COPIA_E_COLA); toast('Pix Copia e Cola copiado. Cole no app do seu banco.'); };
    });
  }

  const stageOf = (id) => data.stages.find((s) => s.id === id) || { id, name: id, color: '#64748b' };
  const initials = (n) => (String(n || '#').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '#').toUpperCase();

  // --- Cliente
  function drawClient(body) {
    const c = chat, lead = findLead(c);
    if (!c) {
      body.innerHTML = `<div class="crmw-hero"><div class="crmw-hero-i">💬</div><b>Abra uma conversa</b><p>A ficha do cliente aparece aqui: etapa do funil, etiquetas, anotações e ações rápidas.</p>
        <button class="crmw-btn crmw-g" data-go="hoje">Ver o que fazer hoje</button></div>`;
      body.querySelector('[data-go]').onclick = () => { view = 'hoje'; render(); };
      return;
    }
    if (c.isGroup) {
      body.innerHTML = `<div class="crmw-hero"><div class="crmw-hero-i">👥</div><b>${esc(c.name)}</b><p>Grupos não entram no funil. Para exportar os membros, vá em Ferramentas → Contatos e grupos.</p></div>`;
      return;
    }
    const inFunnel = !!lead?.stage;
    const tagsOn = lead?.tagIds || [];
    const head = `<div class="crmw-card crmw-person"><div class="crmw-avatar" style="background:${inFunnel ? stageOf(lead.stage).color : '#94a3b8'}">${esc(initials(c.name))}</div>
      <div class="crmw-pinfo"><b>${esc(c.name)}</b><span>${/^\+?[\d\s()-]+$/.test(c.name || '') ? (c.pushName ? '~' + esc(c.pushName) + ' · ' : '') + 'não salvo na agenda' : (c.phone ? '+' + esc(c.phone) : 'número oculto') + (c.pushName && c.pushName !== c.name ? ' · ~' + esc(c.pushName) : '')}</span>
      ${tagsOn.length ? `<div class="crmw-ptags">${tagsOn.map((id) => data.tags.find((t) => t.id === id)).filter(Boolean).map((t) => `<i style="--c:${t.color}">${esc(t.name)}</i>`).join('')}</div>` : ''}</div>
      ${c.phone && c.savedName ? '<button class="crmw-icon" data-a="saveContact" title="Editar nome na agenda">✏️</button>' : ''}</div>
      ${c.phone && !c.savedName ? `<button class="crmw-wide crmw-save" data-a="saveContact">💾 Salvar na agenda do celular <small>este número ainda não está salvo</small></button>` : ''}`;
    const quick = `<div class="crmw-quick">
      <button data-a="schedule"><i>⏰</i>Agendar<br>mensagem</button>
      <button data-a="remind"><i>🔔</i>Criar<br>lembrete</button>
      <button data-a="replies"><i>⚡</i>Respostas<br>rápidas</button>
      <button data-a="copyLink"><i>🔗</i>Copiar<br>link</button></div>`;
    const today = new Date().toISOString().slice(0, 10);
    const plus = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
    let funnel;
    if (!inFunnel) {
      funnel = `<div class="crmw-card crmw-cta"><b>Fora do funil de vendas</b><p>Coloque no funil para acompanhar até fechar a venda.</p>
        <div class="crmw-row"><button class="crmw-btn" data-add="Anúncio">📣 Veio de anúncio</button><button class="crmw-btn crmw-g" data-add="Orgânico">+ Pôr no funil</button></div></div>`;
    } else {
      const st = stageOf(lead.stage), idx = data.stages.findIndex((s) => s.id === lead.stage);
      funnel = `${lead.adUrl || lead.adBody || lead.adTitle ? `<div class="crmw-ad">📣 <b>Veio do anúncio</b>${lead.adTitle ? ' “' + esc(lead.adTitle) + '”' : ''}${lead.adBody ? '<br>' + esc(lead.adBody) : ''}${lead.adUrl ? ` · <a href="${esc(lead.adUrl)}" target="_blank" rel="noopener">ver anúncio</a>` : ''}</div>` : ''}
        <div class="crmw-card"><div class="crmw-label">Etapa no funil</div>
          <div class="crmw-steps">${data.stages.map((s, i) => `<button data-stage="${s.id}" class="${i <= idx ? 'done' : ''} ${s.id === lead.stage ? 'on' : ''}" style="--c:${s.color}" title="${esc(s.name)}"><span></span><em>${esc(s.name)}</em></button>`).join('')}</div>
          ${idx < data.stages.length - 2 ? `<button class="crmw-wide" data-a="nextStage">Avançar para <b>${esc(data.stages[idx + 1].name)}</b> →</button>` : `<div class="crmw-mut" style="text-align:center">Etapa atual: <b style="color:${st.color}">${esc(st.name)}</b></div>`}</div>`;
    }
    const camp = lead && data.campaigns.find((x) => x.id === lead.campaignId);
    body.innerHTML = `${head}${funnel}${quick}
      <div class="crmw-card"><div class="crmw-label">Etiquetas <span class="crmw-sp"></span><button class="crmw-link" data-a="manageTags">gerenciar</button></div>
        <div class="crmw-tags">${data.tags.map((t) => `<button class="crmw-tag ${tagsOn.includes(t.id) ? 'on' : ''}" data-tag="${t.id}" style="--c:${t.color}">${esc(t.name)}</button>`).join('')}<button class="crmw-tag crmw-new" data-a="newTag">+ nova</button></div>
        ${data.tags.length ? '' : '<div class="crmw-mut">Ex.: Cliente, Fornecedor, VIP, Orçamento enviado. Servem para filtrar contatos e conversas.</div>'}</div>
      <div class="crmw-card"><div class="crmw-label">Retornar</div>
        <div class="crmw-when">${[['Hoje', today], ['Amanhã', plus(1)], ['Em 3 dias', plus(3)], ['Em 1 semana', plus(7)]].map(([n, d]) => `<button class="crmw-chip ${lead?.followUp === d ? 'on' : ''}" data-fu="${d}">${n}</button>`).join('')}${lead?.followUp ? '<button class="crmw-chip" data-fu="">limpar</button>' : ''}</div>
        ${lead?.followUp ? `<div class="crmw-mut">Marcado para ${new Date(lead.followUp + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} — aparece em <b>Hoje</b> nesse dia.</div>` : ''}</div>
      <div class="crmw-card"><div class="crmw-label">Anotações <span class="crmw-saved" id="crmw-saved"></span></div>
        <textarea data-f="notes" rows="3" placeholder="O que o cliente quer, combinados, objeções…">${esc(lead?.notes || '')}</textarea></div>
      <details class="crmw-card crmw-more" ${localStorage.getItem('crmw-more') === '1' ? 'open' : ''}><summary>Mais informações (origem, campanha, valor${data.customFields.length ? ', campos extras' : ''})</summary>
        <div class="crmw-2"><label>Origem<select data-f="source">${SOURCES.map((s) => `<option ${lead?.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Valor do negócio (R$)<input data-f="value" type="number" step="0.01" value="${lead?.value ?? ''}" placeholder="0,00"></label></div>
        <label>Campanha<select data-f="campaignId"><option value="">— nenhuma —</option>${data.campaigns.map((x) => `<option value="${x.id}" ${x.id === lead?.campaignId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">+ criar campanha…</option></select></label>
        ${data.customFields.map((f) => `<label>${esc(f.name)}<input data-cf="${f.id}" value="${esc(lead?.fields?.[f.id] || '')}"></label>`).join('')}
        ${lead ? `<div class="crmw-row"><span class="crmw-mut">Ficha criada em ${new Date(lead.createdAt).toLocaleDateString('pt-BR')}${camp ? ' · ' + esc(camp.name) : ''}</span><span class="crmw-sp"></span>${inFunnel ? '<button class="crmw-link" data-a="removeLead">tirar do funil</button>' : ''}</div>` : ''}
      </details>
      ${upcomingFor(c)}`;

    // qualquer edição cria a ficha do contato (sem colocar no funil)
    const rec = async () => lead || await ensureRecord(c);
    const savedFlash = () => { const s = main.querySelector('#crmw-saved'); if (s) { s.textContent = '✓ salvo'; setTimeout(() => { s.textContent = ''; }, 1500); } };
    body.querySelectorAll('[data-stage]').forEach((b) => (b.onclick = () => saveLead({ key: lead.key, stage: b.dataset.stage })));
    body.querySelectorAll('[data-tag]').forEach((b) => (b.onclick = async () => toggleTag(await rec(), b.dataset.tag)));
    body.querySelectorAll('[data-fu]').forEach((b) => (b.onclick = async () => saveLead({ key: (await rec()).key, followUp: b.dataset.fu })));
    body.querySelector('.crmw-more').ontoggle = (e) => localStorage.setItem('crmw-more', e.target.open ? '1' : '0');
    body.querySelectorAll('[data-f]').forEach((el) => {
      const save = async () => {
        let v = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
        const r = await rec();
        if (el.dataset.f === 'campaignId' && v === '__new') return actions.newCampaign(r);
        await saveLead({ key: r.key, [el.dataset.f]: v });
        savedFlash();
      };
      el.onchange = save;
      if (el.tagName === 'TEXTAREA') { let t; el.oninput = () => { clearTimeout(t); t = setTimeout(save, 700); }; }
    });
    body.querySelectorAll('[data-cf]').forEach((el) => (el.onchange = async () => { const r = await rec(); saveLead({ key: r.key, fields: { ...r.fields, [el.dataset.cf]: el.value } }); }));
    body.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => actions.addLead(b.dataset.add)));
    body.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'replies') return globalThis.CRMW.openReplies?.(b);
      if (a === 'saveContact') return actions.saveContact(c);
      if (a === 'manageTags') return globalThis.CRMW.openContacts?.('tags');
      if (a === 'newTag') return actions.newTag(await rec());
      if (a === 'removeLead') { if (await confirmBox('Tirar do funil?', `${esc(lead.name)} sai do funil de vendas. Etiquetas e anotações continuam.`, 'Tirar do funil')) saveLead({ key: lead.key, stage: '' }); return; }
      actions[a](lead);
    }));
    bindUpcoming(body);
  }
  function upcomingFor(c) {
    const sch = data.scheduled.filter((s) => s.chatId === c.chatId && ['pendente', 'erro'].includes(s.status));
    const rem = data.reminders.filter((r) => !r.done && r.chatId === c.chatId);
    if (!sch.length && !rem.length) return '';
    return `<div class="crmw-card"><div class="crmw-label">Programado para este contato</div>
      ${sch.map((s) => `<div class="crmw-li"><span>⏰</span><div><b>${fmtWhen(s.at)}</b>${s.status === 'erro' ? ' <em class="crmw-err">não enviou: ' + esc(s.error || '') + '</em>' : ''}<p>${esc(s.text)}</p></div><button class="crmw-link" data-sdel="${s.id}">cancelar</button></div>`).join('')}
      ${rem.map((r) => `<div class="crmw-li"><span>🔔</span><div><b>${fmtWhen(r.at)}</b><p>${esc(r.note)}</p></div><button class="crmw-link" data-rdel="${r.id}">remover</button></div>`).join('')}</div>`;
  }
  function bindUpcoming(body) {
    body.querySelectorAll('[data-sdel]').forEach((b) => (b.onclick = () => removeItem('scheduled', b.dataset.sdel)));
    body.querySelectorAll('[data-rdel]').forEach((b) => (b.onclick = () => removeItem('reminders', b.dataset.rdel)));
  }

  // --- Hoje
  function drawToday(body, T) {
    const leads = Object.values(data.leads);
    const won = leads.filter((l) => l.stage === 'fechado');
    const item = (icon, title, sub, attrs, extra = '') => `<button class="crmw-li crmw-click" ${attrs}><span>${icon}</span><div><b>${title}</b>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</button>`;
    const leadByChat = (chatId) => leads.find((l) => l.chatId === chatId) || { chatId, name: '' };
    const empty = !T.followUps.length && !T.reminders.length && !T.scheduled.length;
    const lf = globalThis.CRMW.listFilter || '';
    const listFilter = lf === 'funnel' ? 'leads' : lf === 'source:Anúncio' ? 'anuncio' : lf.startsWith('stage:') ? lf.slice(6) : lf;
    body.innerHTML = `<div class="crmw-stats">${data.stages.map((s) => `<button data-filter="${s.id}" class="${listFilter === s.id ? 'on' : ''}" title="Mostrar só estes na lista do WhatsApp"><b style="color:${s.color}">${leads.filter((l) => l.stage === s.id).length}</b><span>${esc(s.name)}</span></button>`).join('')}</div>
      <div class="crmw-filterbar">Mostrar na lista do WhatsApp: <button data-filter="leads" class="${listFilter === 'leads' ? 'on' : ''}">só leads</button><button data-filter="anuncio" class="${listFilter === 'anuncio' ? 'on' : ''}">anúncios</button>${listFilter ? '<button data-filter="" class="crmw-clear">✕ mostrar todas</button>' : ''}</div>
      ${empty ? '<div class="crmw-hero"><div class="crmw-hero-i">✅</div><b>Nada pendente para hoje</b><p>Marque “Retornar” ou crie lembretes na ficha do cliente que eles aparecem aqui.</p></div>' : ''}
      ${T.reminders.length ? `<div class="crmw-card"><div class="crmw-label">🔔 Lembretes</div>${T.reminders.map((r) => item('🔔', esc(r.name), esc(r.note) + ' · ' + fmtWhen(r.at), `data-chat="${esc(r.chatId)}" data-phone="${esc(r.phone || '')}"`, `<span class="crmw-link" data-rdone="${r.id}">feito</span>`)).join('')}</div>` : ''}
      ${T.followUps.length ? `<div class="crmw-card"><div class="crmw-label">↻ Retornar hoje</div>${T.followUps.map((l) => item('↻', esc(l.name), (l.followUp < new Date().toISOString().slice(0, 10) ? '<em class="crmw-err">atrasado</em> · ' : '') + esc(stageOf(l.stage).name), `data-lead="${esc(l.key)}"`)).join('')}</div>` : ''}
      ${T.scheduled.length ? `<div class="crmw-card"><div class="crmw-label">⏰ Mensagens agendadas</div>${T.scheduled.map((s) => item(s.status === 'erro' ? '⚠️' : '⏰', esc(s.name) + ' · ' + fmtWhen(s.at), esc(s.text.slice(0, 80)), `data-chat="${esc(s.chatId)}" data-phone="${esc(s.phone || '')}"`)).join('')}</div>` : ''}
      ${T.fresh.length ? `<div class="crmw-card"><div class="crmw-label">🆕 ${esc(data.stages[0].name)} (aguardando atendimento)</div>${T.fresh.map((l) => item('🆕', esc(l.name), (l.source === 'Anúncio' ? '📣 anúncio · ' : '') + 'entrou ' + new Date(l.createdAt).toLocaleDateString('pt-BR'), `data-lead="${esc(l.key)}"`)).join('')}</div>` : ''}
      <div class="crmw-foot">${leads.length} leads no funil · ${won.length} fechados · ${money(won.reduce((s, l) => s + (l.value || 0), 0))}</div>`;
    body.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => applyListFilter(b.dataset.filter || null)));
    body.querySelectorAll('[data-lead]').forEach((b) => (b.onclick = () => openLead(data.leads[b.dataset.lead])));
    body.querySelectorAll('[data-chat]').forEach((b) => (b.onclick = (e) => {
      if (e.target.dataset.rdone) { e.stopPropagation(); return upsertItem('reminders', { id: e.target.dataset.rdone, done: true }); }
      openLead({ ...leadByChat(b.dataset.chat), phone: b.dataset.phone });
    }));
  }

  // --- Ferramentas
  const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
  const TOOLS = [
    ['aparencia', '🎨', 'Aparência', 'Tema claro ou escuro, estilo Apple, tema do WhatsApp e papel de parede'],
    ['contatos', '👥', 'Contatos e etiquetas', 'Salvar na agenda, etiquetar, organizar e exportar contatos'],
    ['grupos', '📇', 'Grupos', 'Grupos de contatos salvos e exportar membros de grupos do WhatsApp'],
    ['respostas', '⚡', 'Respostas rápidas', 'Mensagens prontas. Use digitando / no campo de mensagem'],
    ['robos', '🤖', 'Robôs de resposta', 'Responder sozinho por palavra-chave, 1ª mensagem ou fora do horário'],
    ['privacidade', '🙈', 'Privacidade na tela', 'Desfocar conversas, nomes e fotos para gravar a tela'],
    ['link', '🔗', 'Conversar sem salvar', 'Abrir conversa com qualquer número ou gerar link wa.me'],
    ['funil', '⚙️', 'Configurar funil', 'Colunas do Kanban, etiquetas, campanhas, campos e backup'],
  ];
  function drawTools(body) {
    body.innerHTML = `<div class="crmw-tools">${TOOLS.map(([k, i, n, d]) => `<button class="crmw-tool" data-sub="${k}"><i>${i}</i><div><b>${n}</b><p>${d}</p></div><span>›</span></button>`).join('')}</div>`;
    body.querySelectorAll('[data-sub]').forEach((b) => (b.onclick = () => {
      if (b.dataset.sub === 'contatos') return globalThis.CRMW.openContacts?.();
      if (b.dataset.sub === 'funil') return chrome.runtime.sendMessage({ type: 'openBoard', view: 'ajustes' });
      if (b.dataset.sub === 'respostas') return chrome.runtime.sendMessage({ type: 'openBoard', view: 'respostas' });
      sub = b.dataset.sub; render();
    }));
  }
  const subTabs = { aparencia: drawAppearance, grupos: drawContacts, privacidade: drawPrivacy, link: drawLinkTool };
  function drawSub(body) {
    const t = TOOLS.find((x) => x[0] === sub);
    body.innerHTML = `<button class="crmw-back">‹ Ferramentas</button><h3 class="crmw-subh">${t[1]} ${t[2]}</h3><div id="crmw-subbody"></div>`;
    body.querySelector('.crmw-back').onclick = () => { sub = null; render(); };
    (subTabs[sub] || globalThis.CRMW.tabs[sub])(body.querySelector('#crmw-subbody'));
  }

  async function toggleTag(lead, tagId) {
    if (!lead) return;
    const has = lead.tagIds?.includes(tagId);
    await saveLead({ key: lead.key, tagIds: has ? lead.tagIds.filter((t) => t !== tagId) : [...(lead.tagIds || []), tagId] });
  }

  // os botões da aba Hoje usam o mesmo filtro da faixa no topo da lista de conversas (listbar.js)
  const toBarFilter = (f) => (!f ? '' : f === 'leads' ? 'funnel' : f === 'anuncio' ? 'source:Anúncio' : f.startsWith('tag:') ? f : 'stage:' + f);
  async function applyListFilter(f) {
    if (!waReady) return toast('Aguarde o WhatsApp terminar de carregar');
    await globalThis.CRMW.setListFilter(toBarFilter(f));
  }

  async function openLead(l) {
    if (!l) return;
    if (waReady && (l.chatId || l.phone)) { await wa('openChat', { chatId: l.chatId, phone: l.phone }).catch((e) => toast('Não abriu: ' + e.message)); return; }
    toast('Procure por ' + (l.name || 'o contato') + ' na lista');
  }

  // --- Contatos e grupos
  async function loadContacts() {
    if (!waReady || contacts) return;
    contacts = 'loading';
    try { contacts = await wa('contacts', null, 60000); } catch (e) { toast('Não deu para ler os contatos: ' + e.message); contacts = []; }
    contacts.sort((a, b) => (a.name || a.pushName || a.phone).localeCompare(b.name || b.pushName || b.phone, 'pt-BR'));
    render();
  }
  function csvDownload(name, rows) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  }
  function drawContacts(body) {
    if (!waReady) { body.innerHTML = '<div class="crmw-empty">Aguardando o WhatsApp carregar…</div>'; return; }
    if (!Array.isArray(contacts)) { body.innerHTML = '<div class="crmw-empty">Lendo seus contatos…</div>'; loadContacts(); return; }
    const q = norm(contactsQuery);
    const list = contacts.filter((c) => !q || norm(`${c.name} ${c.pushName} ${c.phone}`).includes(q));
    body.innerHTML = `<input id="crmw-cq" placeholder="🔍 Buscar nome ou número…" value="${esc(contactsQuery)}">
      <div class="crmw-row crmw-between"><span class="crmw-mut">${contacts.length} contatos${q ? ' · ' + list.length + ' encontrados' : ''}</span><button class="crmw-link" id="crmw-cexp">baixar planilha</button></div>
      ${picked.size ? `<div class="crmw-selbar"><b>${picked.size} marcado(s)</b><button class="crmw-btn" id="crmw-cgrp">Salvar como grupo</button><button class="crmw-btn crmw-g" id="crmw-clead">Pôr no funil</button><button class="crmw-link" id="crmw-cclr">limpar</button></div>` : '<p class="crmw-mut">Marque contatos para salvar um grupo ou pôr vários no funil de uma vez.</p>'}
      <details class="crmw-card"><summary>Grupos de contatos salvos (${data.contactGroups.length})</summary>${data.contactGroups.map((g) => `<div class="crmw-contact"><span class="crmw-cname"><b>${esc(g.name)}</b><span>${g.members.length} contatos</span></span><button class="crmw-mini" data-gexp="${g.id}">planilha</button><button class="crmw-link" data-gdel="${g.id}">excluir</button></div>`).join('') || '<p class="crmw-mut">Nenhum ainda.</p>'}</details>
      <details class="crmw-card" id="crmw-wag"><summary>Grupos do WhatsApp — exportar membros</summary><div>${groups ? groups.map((g) => `<div class="crmw-contact"><span class="crmw-cname"><b>${esc(g.name)}</b><span>${g.size || ''} membros</span></span><button class="crmw-mini" data-wexp="${g.id}">planilha</button><button class="crmw-mini" data-wsave="${g.id}">salvar</button></div>`).join('') || '<p class="crmw-mut">Nenhum grupo.</p>' : '<p class="crmw-mut">Abrindo…</p>'}</div></details>
      <div class="crmw-clist">${list.slice(0, 300).map((c, i) => {
        const l = findLead({ key: c.phone ? 'tel:' + c.phone : 'id:' + c.id, chatId: c.id, phone: c.phone, name: c.name });
        return `<div class="crmw-contact"><input type="checkbox" data-pick="${i}" ${picked.has(c.id) ? 'checked' : ''}><div class="crmw-avatar sm" style="background:${l ? stageOf(l.stage).color : '#94a3b8'}">${esc(initials(c.name || c.pushName))}</div><button class="crmw-cname" data-copen="${i}" title="Abrir conversa"><b>${esc(c.name || c.pushName || '+' + c.phone)}</b><span>${c.phone ? '+' + esc(c.phone) : ''}</span></button>
          ${l ? `<span class="crmw-badge" style="--c:${stageOf(l.stage).color}">${esc(stageOf(l.stage).name)}</span>` : `<button class="crmw-mini" data-cadd="${i}">+ funil</button>`}</div>`;
      }).join('')}${list.length > 300 ? '<div class="crmw-mut" style="padding:10px">Mostrando 300. Use a busca para achar os outros.</div>' : ''}</div>`;

    const inp = body.querySelector('#crmw-cq');
    inp.oninput = () => { contactsQuery = inp.value; const pos = inp.selectionStart; render(); const n = main.querySelector('#crmw-cq'); n.focus(); n.setSelectionRange(pos, pos); };
    const asMember = (c) => ({ chatId: c.id, name: c.name || c.pushName || '', phone: c.phone });
    const keyOf = (c) => ({ key: c.phone ? 'tel:' + c.phone : 'id:' + c.id, chatId: c.id, name: c.name || c.pushName || '+' + c.phone, phone: c.phone });
    body.querySelector('#crmw-cexp').onclick = () => csvDownload(`contatos-${new Date().toISOString().slice(0, 10)}.csv`, [['Nome', 'Nome no WhatsApp', 'Telefone'], ...contacts.map((c) => [c.name, c.pushName, c.phone])]);
    const sel = () => contacts.filter((c) => picked.has(c.id));
    const cg = body.querySelector('#crmw-cgrp');
    if (cg) cg.onclick = async () => { const name = await askText('Novo grupo de contatos', 'Nome do grupo', 'Ex.: Clientes 2026'); if (!name) return; await upsertItem('contactGroups', { name, members: sel().map(asMember) }); picked.clear(); toast('Grupo salvo'); };
    const cl = body.querySelector('#crmw-clead');
    if (cl) cl.onclick = async () => { for (const c of sel()) await ensureLead(keyOf(c)); toast(`${picked.size} contato(s) no funil`); picked.clear(); render(); };
    const cc = body.querySelector('#crmw-cclr');
    if (cc) cc.onclick = () => { picked.clear(); render(); };
    body.querySelectorAll('[data-pick]').forEach((el) => (el.onchange = () => { const c = list[el.dataset.pick]; el.checked ? picked.add(c.id) : picked.delete(c.id); render(); }));
    body.querySelectorAll('[data-copen]').forEach((b) => (b.onclick = () => { const c = list[b.dataset.copen]; openLead({ chatId: c.id, phone: c.phone, name: c.name }); }));
    body.querySelectorAll('[data-cadd]').forEach((b) => (b.onclick = async () => { await ensureLead(keyOf(list[b.dataset.cadd])); toast('Adicionado ao funil'); }));
    body.querySelectorAll('[data-gexp]').forEach((b) => (b.onclick = () => { const g = data.contactGroups.find((x) => x.id === b.dataset.gexp); csvDownload(`grupo-${g.name}.csv`, [['Nome', 'Telefone'], ...g.members.map((m) => [m.name, m.phone])]); }));
    body.querySelectorAll('[data-gdel]').forEach((b) => (b.onclick = async () => { if (await confirmBox('Excluir grupo?', 'Os contatos continuam no WhatsApp; só o grupo salvo é apagado.', 'Excluir')) removeItem('contactGroups', b.dataset.gdel); }));
    body.querySelector('#crmw-wag').ontoggle = async (e) => {
      if (!e.target.open || groups) return;
      groups = await wa('groups', null, 60000).catch(() => []);
      render(); main.querySelector('#crmw-wag').open = true;
    };
    const members = async (id) => { toast('Lendo membros do grupo…'); return wa('groupMembers', { groupId: id }, 60000); };
    body.querySelectorAll('[data-wexp]').forEach((b) => (b.onclick = async () => {
      const g = groups.find((x) => x.id === b.dataset.wexp);
      try { const m = await members(g.id); csvDownload(`membros-${g.name}.csv`, [['Nome', 'Nome no WhatsApp', 'Telefone', 'Admin'], ...m.map((x) => [x.name, x.pushName, x.phone, x.admin ? 'sim' : ''])]); } catch (err) { toast('Erro: ' + err.message); }
    }));
    body.querySelectorAll('[data-wsave]').forEach((b) => (b.onclick = async () => {
      const g = groups.find((x) => x.id === b.dataset.wsave);
      try { const m = await members(g.id); await upsertItem('contactGroups', { name: g.name, members: m.filter((x) => x.phone).map((x) => ({ chatId: x.id, name: x.name || x.pushName, phone: x.phone })) }); toast(`Grupo "${g.name}" salvo com ${m.length} contatos`); } catch (err) { toast('Erro: ' + err.message); }
    }));
  }

  // cores: tons de fundo do iOS (Apple HIG); degradês: coleção WebGradients
  const WALL_COLORS = ['#ffffff', '#f2f2f7', '#e9f7ef', '#e3f2fd', '#fff8e1', '#fde7ef', '#efe8ff', '#1c1c1e', '#0b141a'];
  const WALL_GRADIENTS = [
    'linear-gradient(160deg, #a1c4fd 0%, #c2e9fb 100%)', 'linear-gradient(160deg, #fbc2eb 0%, #a6c1ee 100%)',
    'linear-gradient(160deg, #84fab0 0%, #8fd3f4 100%)', 'linear-gradient(160deg, #fccb90 0%, #d57eeb 100%)',
    'linear-gradient(160deg, #e0c3fc 0%, #8ec5fc 100%)', 'linear-gradient(160deg, #fdfbfb 0%, #ebedee 100%)',
    'linear-gradient(160deg, #30cfd0 0%, #330867 100%)', 'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  ];
  function drawAppearance(body) {
    const p = data.prefs || {}, w = p.wall || { type: 'default' };
    const seg = (name, cur, opts) => `<div class="crmw-seg">${opts.map(([v, l]) => `<button data-${name}="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sw = (type, value, title) => `<button class="crmw-wall ${w.type === type && (w.value || '') === (value || '') ? 'on' : ''}" data-wall="${type}" data-wv="${esc(value || '')}" title="${title}" style="background:${type === 'default' ? 'var(--bg2)' : value}">${type === 'default' ? '<span>padrão</span>' : ''}</button>`;
    body.innerHTML = `<section><div class="crmw-h">Tema do CRM</div>
        ${seg('ct', p.crmTheme || 'auto', [['auto', '◐ Automático'], ['light', '☀ Claro'], ['dark', '☾ Escuro']])}
        <p class="crmw-mut">Automático acompanha o tema do WhatsApp.</p>
        <div class="crmw-h">Estilo</div>
        <div class="crmw-styles">
          <button data-cs="whatsapp" class="${p.crmStyle !== 'apple' ? 'on' : ''}"><i style="background:#00a884"></i><b>WhatsApp</b><small>verde, igual ao app</small></button>
          <button data-cs="apple" class="${p.crmStyle === 'apple' ? 'on' : ''}"><i style="background:#007aff"></i><b>Apple</b><small>azul do iOS, fonte do sistema</small></button></div></section>
      <section><div class="crmw-h">Tema do WhatsApp</div>
        ${seg('wt', '', [['system', '◐ Sistema'], ['light', '☀ Claro'], ['dark', '☾ Escuro']])}
        <p class="crmw-mut">${waReady ? 'Muda o tema do próprio WhatsApp Web.' : 'Disponível quando o WhatsApp terminar de carregar.'}</p></section>
      <section><div class="crmw-h">Papel de parede da conversa</div>
        <div class="crmw-walls">${sw('default', '', 'Padrão do WhatsApp')}${WALL_COLORS.map((c) => sw('color', c, 'Cor')).join('')}${WALL_GRADIENTS.map((g) => sw('gradient', g, 'Degradê')).join('')}
          <label class="crmw-wall crmw-wallimg ${w.type === 'image' ? 'on' : ''}" title="Imagem do computador">🖼<input type="file" accept="image/*" id="crmw-wallfile" hidden></label></div>
        <label class="crmw-switch"><input type="checkbox" id="crmw-doodles" ${w.hideDoodles ? 'checked' : ''}><i></i><span>Esconder os desenhos do fundo padrão</span></label>
        <p class="crmw-mut">Muda só nesta tela do computador; o celular não é afetado.</p></section>`;
    const setPrefs = (patch) => CRM.store.set({ prefs: { ...data.prefs, ...patch } });
    body.querySelectorAll('[data-ct]').forEach((b) => (b.onclick = () => setPrefs({ crmTheme: b.dataset.ct })));
    body.querySelectorAll('[data-cs]').forEach((b) => (b.onclick = () => setPrefs({ crmStyle: b.dataset.cs })));
    const markWa = (t) => body.querySelectorAll('[data-wt]').forEach((x) => x.classList.toggle('on', x.dataset.wt === t));
    if (waReady) wa('getTheme').then(markWa).catch(() => {});
    body.querySelectorAll('[data-wt]').forEach((b) => (b.onclick = async () => {
      if (!waReady) return toast('Aguarde o WhatsApp carregar');
      if (b.classList.contains('on')) return;
      // o WhatsApp grava o tema na hora, mas só redesenha a tela ao recarregar
      if (!await confirmBox('Mudar o tema do WhatsApp?', `O WhatsApp Web vai recarregar para aplicar o tema <b>${esc(b.textContent.slice(2))}</b>. Leva poucos segundos e nada é perdido.`, 'Aplicar e recarregar')) return;
      try { await wa('setTheme', { theme: b.dataset.wt }); location.reload(); } catch (e) { toast('Não deu para mudar: ' + e.message); }
    }));
    body.querySelectorAll('[data-wall]').forEach((b) => (b.onclick = () => setPrefs({ wall: { ...w, type: b.dataset.wall, value: b.dataset.wv } })));
    body.querySelector('#crmw-doodles').onchange = (e) => setPrefs({ wall: { ...w, hideDoodles: e.target.checked } });
    body.querySelector('#crmw-wallfile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      // reduz a imagem (máx. 1600 px) para não pesar no armazenamento
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      await CRM.store.set({ wallImg: cv.toDataURL('image/jpeg', 0.85) });
      setPrefs({ wall: { ...w, type: 'image', value: '' } });
      toast('Papel de parede aplicado');
    };
  }

  function drawPrivacy(body) {
    const p = data.prefs || {};
    const opt = (k, label) => `<label class="crmw-switch"><input type="checkbox" data-pref="${k}" ${p[k] ? 'checked' : ''}><i></i><span>${label}</span></label>`;
    body.innerHTML = `<p class="crmw-mut">Passe o mouse em cima para ver. Bom para gravar a tela ou atender com gente por perto.</p>
      ${opt('blurMsgs', 'Desfocar mensagens da conversa')}${opt('blurList', 'Desfocar nomes na lista')}${opt('blurPreview', 'Desfocar prévia da última mensagem')}${opt('blurPhotos', 'Desfocar fotos de perfil')}${opt('blurHeader', 'Desfocar nome no topo da conversa')}
      <button class="crmw-btn crmw-g" id="crmw-allblur">${BLUR.some((k) => p[k]) ? 'Desligar tudo' : 'Ligar tudo'}</button>`;
    body.querySelectorAll('[data-pref]').forEach((el) => (el.onchange = () => CRM.store.set({ prefs: { ...p, [el.dataset.pref]: el.checked } })));
    body.querySelector('#crmw-allblur').onclick = () => { const on = !BLUR.some((k) => p[k]); CRM.store.set({ prefs: { ...p, ...Object.fromEntries(BLUR.map((k) => [k, on])) } }); };
  }
  function drawLinkTool(body) {
    body.innerHTML = `<label>Número com DDD<input id="crmw-lnum" placeholder="27 99999-9999" inputmode="tel"></label>
      <label>Mensagem (opcional)<input id="crmw-lmsg" placeholder="Olá! Tudo bem?"></label>
      <div class="crmw-row"><button class="crmw-btn" id="crmw-lopen">Abrir conversa</button><button class="crmw-btn crmw-g" id="crmw-lcopy">Copiar link</button></div>
      <p class="crmw-mut">Não precisa salvar o número na agenda.</p>`;
    const num = () => { let n = body.querySelector('#crmw-lnum').value.replace(/\D/g, ''); if (n && n.length <= 11) n = '55' + n; return n; };
    body.querySelector('#crmw-lcopy').onclick = async () => {
      if (!num()) return toast('Digite o número');
      const m = body.querySelector('#crmw-lmsg').value.trim();
      await navigator.clipboard.writeText(`https://wa.me/${num()}${m ? '?text=' + encodeURIComponent(m) : ''}`); toast('Link copiado');
    };
    body.querySelector('#crmw-lopen').onclick = () => { if (!num()) return toast('Digite o número'); wa('openChat', { phone: num() }).catch((e) => toast(e.message)); };
  }

  // escreve no campo de mensagem (não envia: você revisa e aperta Enter)
  function insertText(text, replace) {
    const box = document.querySelector('#main footer [contenteditable="true"]');
    if (!box) return toast('Abra uma conversa primeiro');
    box.focus();
    if (replace) document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
  }

  // ---------- etiquetas na lista de conversas ----------
  function badges() {
    const side = document.querySelector('#pane-side');
    if (!side) return;
    for (const t of side.querySelectorAll('span[title]')) {
      if (!t.isConnected || t.closest('.crmw-badges')) continue;
      const cell = t.closest('[role="listitem"], [role="row"], [role="gridcell"]') || t.parentElement;
      if (!cell) continue;
      const lead = leadForTitle(t.getAttribute('title'));
      let b = cell.querySelector('.crmw-badges');
      const want = lead ? [...(lead.stage ? [stageOf(lead.stage)] : []), ...(lead.tagIds || []).map((id) => data.tags.find((x) => x.id === id)).filter(Boolean)] : [];
      const sig = want.map((x) => x.id).join(',');
      if (!want.length) { if (b) b.remove(); continue; }
      if (b && b.dataset.sig === sig) continue;
      if (!b) { b = document.createElement('span'); b.className = 'crmw-badges'; t.after(b); }
      b.dataset.sig = sig;
      b.innerHTML = want.map((x, i) => `<span class="crmw-badge${i || !lead.stage ? ' crmw-dot' : ''}" style="--c:${x.color}" data-tip="${esc(x.name)}">${i || !lead.stage ? '' : esc(x.name)}</span>`).join('');
    }
  }

  // ---------- pedidos do funil em outra aba ----------
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type !== 'openChat') return;
    if (waReady && (msg.chatId || msg.phone)) { wa('openChat', { chatId: msg.chatId, phone: msg.phone }).then(() => reply(true), () => reply(false)); return true; }
    const t = norm(msg.name);
    const span = [...document.querySelectorAll('#pane-side span[title]')].find((s) => norm(s.getAttribute('title')) === t);
    const row = span?.closest('[role="listitem"], [role="row"]') || span;
    if (!row) return reply(false);
    for (const type of ['mousedown', 'mouseup', 'click']) row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    reply(true);
  });

  // ---------- ciclo ----------
  let scheduledTick = false;
  function tick() {
    scheduledTick = false;
    if (!waReady) setChat(domChat());
    applyPrefs();   // tema automático acompanha o WhatsApp
    badges();
    listeners.data.forEach((f) => f(data, 'dom'));
  }
  new MutationObserver(() => { if (!scheduledTick) { scheduledTick = true; setTimeout(tick, 400); } })
    .observe(document.body, { childList: true, subtree: true });
  // o WhatsApp troca claro/escuro mudando a classe da página: o tema automático acompanha na hora
  const themeWatch = new MutationObserver(() => applyPrefs());
  themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // não redesenha enquanto você digita no painel (perderia o cursor); redesenha ao sair do campo
  let pendingRender = false;
  const typing = () => main.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  main.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 50));
  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.wallImg) { wallImg = null; wallKey = ''; }
    data = await getAll();
    applyPrefs();
    if (typing() || sheet.classList.contains('on')) pendingRender = true; else render();
    badges();
    listeners.data.forEach((f) => f(data, 'storage'));
  });
  // API para toolbar.js e automation.js
  globalThis.CRMW = {
    wa, toast, render, insertText, openKanban, showReturn, hideReturn, findLead, ensureLead, ensureRecord, initials, toggleTag, stageOf, openLead, csvDownload, actions,
    openSheet, closeSheet, confirmBox, askText, whenPicker, bindWhen, fmtWhen,
    get data() { return data; }, get chat() { return chat; }, get ready() { return waReady; }, get loaded() { return loaded; },
    on(ev, f) { listeners[ev].push(f); }, tabs: {}, fillVars: (t, ctx) => fillVars(t, ctx, data),
    showPanel() { if (!open) { open = true; localStorage.setItem('crmw-open', '1'); applyPrefs(); } },
  };

  chat = domChat(); render();
  getAll().then((d) => { data = d; loaded = true; applyPrefs(); render(); tick(); detectAd(chat); listeners.data.forEach((f) => f(data, 'load')); })
    .catch((e) => { main.textContent = 'O CRM não conseguiu ler os dados salvos: ' + e.message; });
})();
