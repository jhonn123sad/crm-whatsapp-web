// Ícone da extensão abre o funil; o funil e os lembretes pedem para abrir conversas na aba do WhatsApp Web.
const api = globalThis.browser || chrome;
const notifTargets = {};   // id da notificação -> conversa

api.action.onClicked.addListener(() => openBoard());

async function openBoard(view) {
  const base = api.runtime.getURL('board.html');
  const url = base + (view ? '#' + view : '');
  const [tab] = await api.tabs.query({ url: base + '*' });
  if (tab) { await api.tabs.update(tab.id, { active: true, url }); await api.windows.update(tab.windowId, { focused: true }); }
  else await api.tabs.create({ url });
}

async function openChat({ name, phone, chatId }) {
  let [tab] = await api.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tab) {
    tab = await api.tabs.create({ url: phone ? `https://web.whatsapp.com/send?phone=${phone}` : 'https://web.whatsapp.com/' });
  } else {
    // abre pelo próprio WhatsApp (sem recarregar); se não der, usa o link por número
    const ok = await api.tabs.sendMessage(tab.id, { type: 'openChat', name, phone, chatId }).catch(() => false);
    if (!ok && phone) await api.tabs.update(tab.id, { url: `https://web.whatsapp.com/send?phone=${phone}` });
  }
  await api.tabs.update(tab.id, { active: true });
  await api.windows.update(tab.windowId, { focused: true });
}

api.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'openBoard') return openBoard(msg.view);
    if (msg.type === 'openChat') return openChat(msg);
    if (msg.type === 'notify') {
      notifTargets[msg.id] = msg;
      api.notifications.create(msg.id, { type: 'basic', iconUrl: 'icon.png', title: msg.title, message: msg.message || '', priority: 2 });
    }
  })().then(() => reply(true), () => reply(false));
  return true;
});

api.notifications.onClicked.addListener((id) => {
  const t = notifTargets[id];
  if (t) openChat(t);
  api.notifications.clear(id);
});
