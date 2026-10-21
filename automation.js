// Automações que rodam com o WhatsApp Web aberto: robôs de auto-resposta, mensagens agendadas e lembretes.
(() => {
  const { esc, norm, upsertItem, removeItem, saveLead, store } = CRM;
  const W = globalThis.CRMW;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const today = () => new Date().toISOString().slice(0, 10);

  async function patchList(key, id, patch) {
    const cur = (await store.get(key))[key] || [];
    const it = cur.find((x) => x.id === id);
    if (it) { Object.assign(it, typeof patch === 'function' ? patch(it) : patch); await store.set({ [key]: cur }); }
    return it;
  }

  // ---------- aba Disparos ----------
  W.tabs.disparos = (body) => {
    body.innerHTML = `<section><div class="crmw-h">Disparos em massa</div>
      <p class="crmw-mut">Ainda não está ativo nesta versão. Envio automático para listas de contatos é o que mais faz o WhatsApp bloquear números,
      e precisa da sua autorização explícita para ser incluído.</p>
      <p class="crmw-mut">Enquanto isso: use <b>grupos de contatos</b> (aba Contatos) e <b>respostas rápidas</b> com {primeiro_nome} para mandar um a um.</p></section>`;
  };

  // ---------- aba Robôs (auto-resposta) ----------
  const TRIG = { contains: 'Mensagem contém', exact: 'Mensagem exata', first_day: 'Primeira mensagem do dia', first_ever: 'Primeira mensagem do cliente', away: 'Fora do horário' };
  W.tabs.robos = (body) => {
    const D = W.data;
    body.innerHTML = `<p class="crmw-mut">O robô responde sozinho quando alguém te manda mensagem. Ex.: quando escrever “preço”, mandar a tabela.</p>
      <section><div class="crmw-h">Novo robô</div>
      <input id="bt-name" placeholder="Nome (ex.: Boas-vindas anúncio)">
      <label>Quando<select id="bt-trig">${Object.entries(TRIG).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <input id="bt-text" placeholder="Palavra/frase (para 'contém' e 'exata'), ex.: preço">
      <div class="crmw-2" id="bt-hours" style="display:none"><label>Atende das<input id="bt-h1" type="time" value="08:00"></label><label>até<input id="bt-h2" type="time" value="18:00"></label></div>
      <textarea id="bt-reply" rows="3" placeholder="Resposta. Para mandar várias, separe com uma linha contendo ---"></textarea>
      <div class="crmw-2"><label>Depois, mudar etapa<select id="bt-stage"><option value="">—</option>${D.stages.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>e pôr etiqueta<select id="bt-tag"><option value="">—</option>${D.tags.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label></div>
      <label class="crmw-check"><input type="checkbox" id="bt-onlylead"><span>Só para contatos que já são leads</span></label>
      <button class="crmw-btn" id="bt-save">Criar robô</button>
      <p class="crmw-mut">Só responde quem mandou mensagem. Não responde grupos. Cada robô responde a mesma pessoa no máximo 1 vez a cada 30 min.</p></section>
      <section><div class="crmw-h">Robôs</div>${D.bots.length ? D.bots.map((b) => `<div class="crmw-camp"><label class="crmw-check"><input type="checkbox" data-bon="${b.id}" ${b.active ? 'checked' : ''}><span><b>${esc(b.name)}</b><br><small>${TRIG[b.trigger.type]}${b.trigger.text ? ': “' + esc(b.trigger.text) + '”' : ''}${b.trigger.type === 'away' ? ` (${b.trigger.from}–${b.trigger.to})` : ''} · ${b.replies.length} msg · ${b.count || 0} respostas</small></span></label><button class="crmw-link" data-bdel="${b.id}">excluir</button></div>`).join('') : '<span class="crmw-mut">Nenhum ainda.</span>'}</section>`;
    const trig = body.querySelector('#bt-trig');
    trig.onchange = () => { body.querySelector('#bt-text').style.display = ['contains', 'exact'].includes(trig.value) ? '' : 'none'; body.querySelector('#bt-hours').style.display = trig.value === 'away' ? '' : 'none'; };
    body.querySelector('#bt-save').onclick = async () => {
      const name = body.querySelector('#bt-name').value.trim();
      const replies = body.querySelector('#bt-reply').value.split(/\n-{3,}\n/).map((s) => s.trim()).filter(Boolean);
      const type = trig.value, text = body.querySelector('#bt-text').value.trim();
      if (!name || !replies.length) return W.toast('Dê um nome e escreva a resposta');
      if (['contains', 'exact'].includes(type) && !text) return W.toast('Escreva a palavra que dispara o robô');
      await upsertItem('bots', { name, active: true, count: 0, onlyLeads: body.querySelector('#bt-onlylead').checked,
        trigger: { type, text, from: body.querySelector('#bt-h1').value, to: body.querySelector('#bt-h2').value },
        replies, setStage: body.querySelector('#bt-stage').value, addTag: body.querySelector('#bt-tag').value });
      W.toast('Robô criado e ligado');
    };
    body.querySelectorAll('[data-bon]').forEach((el) => (el.onchange = () => patchList('bots', el.dataset.bon, { active: el.checked })));
    body.querySelectorAll('[data-bdel]').forEach((b) => (b.onclick = async () => { if (await W.confirmBox('Excluir robô?', 'Ele para de responder.', 'Excluir')) removeItem('bots', b.dataset.bdel); }));
  };

  const botMemory = JSON.parse(localStorage.getItem('crmw-botmem') || '{}');   // chatId -> {day, last:{botId:ts}}
  const remember = () => localStorage.setItem('crmw-botmem', JSON.stringify(botMemory));
  function inHours(from, to) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    const [a, b] = [from, to].map((s) => { const [h, mi] = (s || '0:0').split(':').map(Number); return h * 60 + mi; });
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }
  W.on('message', async ({ chat, text, firstEver, lead }) => {
    if (!chat?.chatId || chat.isGroup) return;
    const mem = (botMemory[chat.chatId] ||= { day: '', last: {} });
    const firstToday = mem.day !== today();
    mem.day = today();
    const n = norm(text);
    for (const b of W.data.bots.filter((x) => x.active)) {
      if (b.onlyLeads && !lead) continue;
      if (Date.now() - (mem.last[b.id] || 0) < 30 * 60e3) continue;
      const t = b.trigger;
      const hit = t.type === 'contains' ? n.includes(norm(t.text))
        : t.type === 'exact' ? n === norm(t.text)
        : t.type === 'first_day' ? firstToday
        : t.type === 'first_ever' ? firstEver
        : t.type === 'away' ? !inHours(t.from, t.to) : false;
      if (!hit) continue;
      mem.last[b.id] = Date.now(); remember();
      const ctx = { name: lead?.name || chat.name, phone: chat.phone, campaignId: lead?.campaignId };
      try {
        await sleep(rand(2000, 5000));
        for (const r of b.replies) { await W.wa('sendText', { chatId: chat.chatId, text: W.fillVars(r, ctx), typing: true }, 60000); await sleep(rand(1500, 3500)); }
        if (b.setStage || b.addTag) {
          const l = lead || await W.ensureLead(chat);
          await saveLead({ key: l.key, ...(b.setStage ? { stage: b.setStage } : {}), ...(b.addTag && !l.tagIds?.includes(b.addTag) ? { tagIds: [...(l.tagIds || []), b.addTag] } : {}) });
        }
        await patchList('bots', b.id, (x) => ({ count: (x.count || 0) + 1 }));
      } catch (e) { W.toast(`Robô "${b.name}" não conseguiu responder: ${e.message}`); }
      break;   // um robô por mensagem
    }
    remember();
  });

  // ---------- mensagens agendadas (uma conversa por vez, criadas por você) ----------
  let sending = false;
  async function runScheduled() {
    if (sending || !W.ready) return;
    const due = W.data.scheduled.filter((s) => s.status === 'pendente' && s.at <= Date.now());
    if (!due.length) return;
    sending = true;
    try {
      for (const s of due) {
        const cur = (await store.get('scheduled')).scheduled?.find((x) => x.id === s.id);
        if (cur?.status !== 'pendente') continue;            // outra aba já pegou
        await patchList('scheduled', s.id, { status: 'enviando' });
        try { await W.wa('sendText', { chatId: s.chatId, text: s.text }); await patchList('scheduled', s.id, { status: 'enviada', sentAt: Date.now() }); W.toast('Mensagem agendada enviada para ' + s.name); }
        catch (e) { await patchList('scheduled', s.id, { status: 'erro', error: e.message }); }
        await sleep(4000);
      }
    } finally { sending = false; }
  }

  // ---------- lembretes ----------
  async function runReminders() {
    const due = W.data.reminders.filter((r) => !r.done && r.at <= Date.now());
    for (const r of due) {
      await patchList('reminders', r.id, { done: true });
      chrome.runtime.sendMessage({ type: 'notify', id: r.id, title: 'Lembrete: ' + r.name, message: r.note, chatId: r.chatId, phone: r.phone });
      W.toast(`⏰ ${r.name}: ${r.note}`);
    }
  }

  setInterval(() => { runScheduled(); runReminders(); }, 5000);
})();
