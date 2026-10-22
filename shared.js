// Modelo de dados do CRM. Tudo fica em chrome.storage.local, neste navegador.
// Usado pela aba do WhatsApp (painel, barra, automações) e pelo funil (board.html).
const CRM = (() => {
  const DEFAULT_STAGES = [
    { id: 'novo', name: 'Novo lead', color: '#f97316' },
    { id: 'conversa', name: 'Em conversa', color: '#0ea5e9' },
    { id: 'proposta', name: 'Proposta', color: '#8b5cf6' },
    { id: 'fechado', name: 'Fechado', color: '#22c55e' },
    { id: 'perdido', name: 'Perdido', color: '#94a3b8' },
  ];
  const SOURCES = ['Anúncio', 'Orgânico', 'Indicação', 'Instagram', 'Site'];
  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#64748b'];
  const DEFAULT_AD_PHRASES = [
    'Olá! Tenho interesse e queria mais informações, por favor.',
    'Olá! Quero mais informações sobre isso.',
    'Olá! Posso obter mais informações sobre isso?',
  ];
  const KEYS = ['leads', 'stages', 'tags', 'campaigns', 'quickReplies', 'adPhrases', 'scheduled', 'reminders',
    'broadcasts', 'contactGroups', 'bots', 'customFields', 'prefs'];
  const store = chrome.storage.local;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function getAll() {
    const d = await store.get(KEYS);
    const data = {
      leads: d.leads || {},
      stages: d.stages?.length ? d.stages : DEFAULT_STAGES,
      tags: d.tags || [],
      campaigns: d.campaigns || [],
      quickReplies: (d.quickReplies || []).map((r) => ({ id: r.id || uid(), folder: '', steps: [], ...r })),
      adPhrases: d.adPhrases || DEFAULT_AD_PHRASES,
      scheduled: d.scheduled || [],
      reminders: d.reminders || [],
      broadcasts: d.broadcasts || [],
      contactGroups: d.contactGroups || [],
      bots: d.bots || [],
      customFields: d.customFields || [{ id: 'produtos', name: 'Produtos de interesse' }],
      prefs: d.prefs || {},
    };
    await migrate(data);
    return data;
  }

  // versões antigas: etiquetas eram texto livre e campanha era só um nome
  async function migrate(data) {
    let changed = false;
    for (const l of Object.values(data.leads)) {
      if (!Array.isArray(l.tagIds)) {
        l.tagIds = [];
        for (const name of String(l.tags || '').split(',').map((s) => s.trim()).filter(Boolean)) {
          let t = data.tags.find((x) => norm(x.name) === norm(name));
          if (!t) { t = { id: uid(), name, color: COLORS[data.tags.length % COLORS.length] }; data.tags.push(t); }
          l.tagIds.push(t.id);
        }
        changed = true;
      }
      if (l.campaign && !l.campaignId) {
        let c = data.campaigns.find((x) => norm(x.name) === norm(l.campaign));
        if (!c) { c = newCampaign(l.campaign); data.campaigns.push(c); }
        l.campaignId = c.id; changed = true;
      }
      if (!l.fields) { l.fields = {}; changed = true; }
    }
    if (changed) await store.set({ leads: data.leads, tags: data.tags, campaigns: data.campaigns });
  }

  async function saveLead(lead) {
    const { leads = {} } = await store.get('leads');
    leads[lead.key] = { ...leads[lead.key], ...lead, updatedAt: Date.now() };
    await store.set({ leads });
    return leads[lead.key];
  }
  async function removeLead(key) {
    const { leads } = await store.get('leads');
    if (leads) { delete leads[key]; await store.set({ leads }); }
  }
  function newLead(chat, extra = {}) {
    const now = Date.now();
    return {
      key: chat.key, name: chat.name, phone: chat.phone || '', chatId: chat.chatId || '', stage: 'novo', source: 'Orgânico',
      campaignId: '', tagIds: [], fields: {}, notes: '', value: null, followUp: '', createdAt: now, updatedAt: now, ...extra,
    };
  }
  const newCampaign = (name, extra = {}) => ({ id: uid(), name, channel: 'Meta Ads', cost: null, phrase: '', start: new Date().toISOString().slice(0, 10), active: true, ...extra });

  // lista genérica (tags, campanhas, robôs...): cria/atualiza/remove por id
  async function upsertItem(key, item) {
    const cur = (await store.get(key))[key] || [];
    const i = cur.findIndex((x) => x.id === item.id);
    if (i >= 0) cur[i] = { ...cur[i], ...item }; else cur.push({ id: uid(), ...item });
    await store.set({ [key]: cur });
    return i >= 0 ? cur[i] : cur[cur.length - 1];
  }
  async function removeItem(key, id) {
    const cur = (await store.get(key))[key] || [];
    await store.set({ [key]: cur.filter((x) => x.id !== id) });
  }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const money = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const leadName = (l) => l?.name || (l?.phone ? '+' + l.phone : 'Contato');

  // {nome} {primeiro_nome} {telefone} {campanha} {saudacao}
  function fillVars(text, ctx = {}, data = {}) {
    const h = new Date().getHours();
    const camp = ctx.campaignId && data.campaigns?.find((c) => c.id === ctx.campaignId)?.name;
    const name = ctx.name && !/^\+?\d[\d\s()-]+$/.test(ctx.name) ? ctx.name : '';
    return String(text)
      .replace(/\{nome\}/gi, name)
      .replace(/\{primeiro_nome\}/gi, name.split(' ')[0] || '')
      .replace(/\{telefone\}/gi, ctx.phone || '')
      .replace(/\{campanha\}/gi, camp || '')
      .replace(/\{saudacao\}/gi, h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite')
      .replace(/ {2,}/g, ' ').replace(/ ([,.!?])/g, '$1');
  }

  function campaignStats(data) {
    const leads = Object.values(data.leads);
    return data.campaigns.map((c) => {
      const ls = leads.filter((l) => l.campaignId === c.id);
      const won = ls.filter((l) => l.stage === 'fechado');
      const revenue = won.reduce((s, l) => s + (l.value || 0), 0);
      return {
        ...c, leads: ls.length, won: won.length, revenue,
        conversion: ls.length ? won.length / ls.length : 0,
        cpl: c.cost && ls.length ? c.cost / ls.length : null,
        roas: c.cost ? revenue / c.cost : null,
      };
    });
  }


  // junta um backup/importação com os dados atuais sem perder nada:
  // etiquetas e campanhas casam pelo nome; fichas do mesmo contato juntam etiquetas e anotações
  function mergeBackup(cur, j) {
    const byName = (list, item) => list.find((x) => norm(x.name) === norm(item.name));
    const mergeList = (curList, inList) => {
      const out = [...curList], map = {};
      for (const it of inList || []) {
        const same = out.find((x) => x.id === it.id) || byName(out, it);
        if (same) map[it.id] = same.id; else { out.push(it); map[it.id] = it.id; }
      }
      return { out, map };
    };
    const tags = mergeList(cur.tags, j.tags), camps = mergeList(cur.campaigns, j.campaigns);
    const leads = { ...cur.leads };
    for (const l of Object.values(j.leads)) {
      const tagIds = (l.tagIds || []).map((id) => tags.map[id] || id);
      const campaignId = l.campaignId ? camps.map[l.campaignId] || l.campaignId : '';
      const old = leads[l.key] || Object.values(leads).find((x) => (l.chatId && x.chatId === l.chatId) || (l.phone && x.phone === l.phone));
      if (!old) { leads[l.key] = { ...l, tagIds, campaignId }; continue; }
      const notes = !l.notes || (old.notes || '').includes(l.notes) ? old.notes : [old.notes, l.notes].filter(Boolean).join('\n\n');
      leads[old.key] = { ...l, ...old, tagIds: [...new Set([...(old.tagIds || []), ...tagIds])], campaignId: old.campaignId || campaignId,
        notes, stage: old.stage || l.stage, name: old.name || l.name, updatedAt: Date.now() };
    }
    const extra = {};   // listas simples do backup que ainda não existem aqui (respostas, robôs, grupos...)
    for (const k of ['quickReplies', 'bots', 'contactGroups', 'customFields']) if (j[k]) extra[k] = mergeList(cur[k], j[k]).out;
    return { ...extra, leads, tags: tags.out, campaigns: camps.out };
  }
  // importa um arquivo de backup/importação mesclando com o que já existe; devolve quantos contatos vieram
  async function importBackup(j) {
    if (!j || !j.leads) throw new Error('o arquivo não é um backup/importação deste CRM');
    await store.set(mergeBackup(await getAll(), j));
    return Object.keys(j.leads).length;
  }

  function toCSV(leads, data) {
    const stageName = Object.fromEntries((data?.stages || DEFAULT_STAGES).map((s) => [s.id, s.name]));
    const tagName = Object.fromEntries((data?.tags || []).map((t) => [t.id, t.name]));
    const campName = Object.fromEntries((data?.campaigns || []).map((c) => [c.id, c.name]));
    const fields = data?.customFields || [];
    const cols = [['Nome', (l) => l.name], ['Telefone', (l) => l.phone], ['Etapa', (l) => stageName[l.stage]], ['Origem', (l) => l.source],
      ['Campanha', (l) => campName[l.campaignId] || l.campaign], ['Link do anúncio', (l) => l.adUrl], ['Etiquetas', (l) => (l.tagIds || []).map((t) => tagName[t]).join(', ')],
      ['Valor', (l) => l.value], ['Retornar em', (l) => l.followUp], ...fields.map((f) => [f.name, (l) => l.fields?.[f.id]]),
      ['Anotações', (l) => l.notes], ['Entrou em', (l) => new Date(l.createdAt).toLocaleString('pt-BR')]];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return '﻿' + [cols.map((c) => c[0]).join(';'), ...leads.map((l) => cols.map(([, f]) => q(f(l))).join(';'))].join('\r\n');
  }

  return { DEFAULT_STAGES, SOURCES, COLORS, DEFAULT_AD_PHRASES, store, uid, getAll, saveLead, removeLead, newLead, newCampaign,
    upsertItem, removeItem, norm, money, esc, leadName, fillVars, campaignStats, toCSV, mergeBackup, importBackup };
})();
