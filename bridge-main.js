// Roda no "mundo" da página do WhatsApp Web, junto com o WA-JS (window.WPP).
// Conversa com o content.js por window.postMessage: { crmw: 'req', id, cmd, args } -> { crmw: 'res', id, ok, result }.
(() => {
  let ready = false;

  const ser = (w) => (w ? (typeof w === 'string' ? w : w._serialized) : null);
  // aceita "5527...@c.us", Wid {user} ou o formato do mapa LID {id, _serialized}
  const userOf = (w) => (w ? (typeof w === 'string' ? w.split('@')[0] : w.user || w._serialized?.split('@')[0] || w.id) : null);

  async function phoneOf(wid) {
    const id = ser(wid);
    if (!id) return '';
    if (id.endsWith('@c.us')) return userOf(id);
    if (id.endsWith('@lid')) {
      try { const e = await WPP.contact.getPnLidEntry(id); return userOf(e?.phoneNumber) || ''; } catch { return ''; }
    }
    return '';
  }

  async function chatInfo(chat) {
    if (!chat) return null;
    const id = ser(chat.id);
    const contact = chat.contact || WPP.whatsapp.ContactStore.get(id);
    return {
      id,
      isGroup: id.endsWith('@g.us'),
      name: chat.formattedTitle || contact?.name || contact?.pushname || chat.name || userOf(id),
      savedName: contact?.name || '',
      pushName: contact?.pushname || '',
      phone: await phoneOf(chat.id),
      unread: chat.unreadCount || 0,
      t: (chat.t || 0) * 1000,
    };
  }

  function adOf(m) {
    const c = m?.ctwaContext;
    if (!c || !(c.sourceUrl || c.sourceId || c.title)) return null;
    return { title: c.title || '', body: c.description || '', url: c.sourceUrl || '', sourceId: c.sourceId || '', app: c.sourceApp || '' };
  }

  const commands = {
    async status() { return { ready, me: ready ? userOf(WPP.conn.getMyUserId?.()) : null }; },
    async activeChat() { return chatInfo(WPP.chat.getActiveChat()); },
    async contacts() {
      const list = await WPP.contact.list({ onlyMyContacts: true });
      const out = [];
      for (const c of list) {
        const id = ser(c.id);
        if (!id || id.endsWith('@g.us') || id === 'status@broadcast') continue;
        out.push({ id, name: c.name || c.pushname || '', pushName: c.pushname || '', phone: await phoneOf(c.id), isBusiness: !!c.isBusiness });
      }
      return out;
    },
    async chats({ onlyUsers = true, count } = {}) {
      const list = await WPP.chat.list({ onlyUsers, count });
      return Promise.all(list.map(chatInfo));
    },
    async openChat({ chatId, phone }) {
      const id = chatId || (phone ? phone.replace(/\D/g, '') + '@c.us' : null);
      if (!id) return false;
      try { await WPP.chat.find(id); } catch { /* conversa nova */ }
      return WPP.chat.openChatBottom(id);
    },
    async filterChats({ ids }) {
      if (!ids) return WPP.chat.setChatList('all');
      return WPP.chat.setChatList('custom', ids.length ? ids : ['0@c.us']);
    },
    // anúncio de origem + texto da 1ª mensagem do cliente (para detectar pela frase do anúncio)
    async findAd({ chatId }) {
      const msgs = await WPP.chat.getMessages(chatId, { count: 40 });
      let ad = null, firstText = '';
      for (const m of msgs) {
        if (m.id?.fromMe) continue;
        ad = ad || adOf(m);
        if (!firstText && (m.body || m.caption)) firstText = String(m.body || m.caption);
      }
      return { ad, firstText };
    },
    async sendText({ chatId, text, typing }) {
      if (typing) {
        await WPP.chat.markIsComposing(chatId).catch(() => {});
        await new Promise((r) => setTimeout(r, Math.min(6000, 800 + text.length * 40)));
      }
      const r = await WPP.chat.sendTextMessage(chatId, text, { createChat: true, linkPreview: false });
      return { id: ser(r?.id) };
    },
    async saveContact({ phone, firstName, lastName }) {
      const digits = String(phone || '').replace(/\D/g, '');
      if (!digits) throw new Error('número não disponível para este contato');
      await WPP.contact.save(digits + '@c.us', firstName, { lastName: lastName || undefined, syncAddressBook: true });
      return true;
    },
    async groups() {
      const list = await WPP.chat.list({ onlyGroups: true });
      return list.map((g) => ({ id: ser(g.id), name: g.formattedTitle || g.name || 'Grupo', size: g.groupMetadata?.participants?.length || 0 }));
    },
    async groupMembers({ groupId }) {
      const parts = await WPP.group.getParticipants(groupId);
      const out = [];
      for (const p of parts) {
        const id = ser(p.id);
        const c = WPP.whatsapp.ContactStore.get(id);
        const phone = await phoneOf(p.id);
        out.push({ id: phone ? phone + '@c.us' : id, name: c?.name || c?.pushname || '', pushName: c?.pushname || '', phone, admin: !!(p.isAdmin || p.isSuperAdmin) });
      }
      return out;
    },
    async setInput({ chatId, text }) {
      return WPP.chat.setInputText(text, chatId);
    },
  };

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.crmw !== 'req') return;
    try {
      if (!ready && d.cmd !== 'status') throw new Error('WhatsApp ainda carregando');
      const result = await commands[d.cmd](d.args || {});
      window.postMessage({ crmw: 'res', id: d.id, ok: true, result }, '*');
    } catch (err) {
      window.postMessage({ crmw: 'res', id: d.id, ok: false, error: String(err?.message || err) }, '*');
    }
  });

  const emit = (event, data) => window.postMessage({ crmw: 'event', event, data }, '*');

  function start() {
    if (!window.WPP?.loader) return setTimeout(start, 500);
    WPP.loader.onReady(() => {
      ready = true;
      emit('ready', {});
      WPP.on('chat.active_chat', async (chat) => emit('active_chat', await chatInfo(chat).catch(() => null)));
      WPP.on('chat.new_message', async (m) => {
        if (m?.id?.fromMe || m?.isGroupMsg) return;
        const chatId = ser(m.id?.remote || m.from);
        if (!chatId || !/@(c\.us|lid)$/.test(chatId)) return;
        const chat = WPP.whatsapp.ChatStore.get(chatId);
        let firstEver = false;
        try { firstEver = (await WPP.chat.getMessages(chatId, { count: 3 })).length <= 1; } catch { /* sem histórico */ }
        emit('new_message', { chat: await chatInfo(chat || { id: chatId }), text: m.body || m.caption || '', ad: adOf(m), firstEver });
      });
    });
  }
  start();
})();
