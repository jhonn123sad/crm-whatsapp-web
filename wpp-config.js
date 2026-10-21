// Carrega ANTES do WA-JS: desliga tudo que sairia do navegador.
// - Google Analytics embutido no WA-JS (conta dos autores dele)
// - servidores de terceiros usados para prévia de links
// - marca "WA-JS" nas mensagens
window.WPPConfig = {
  disableGoogleAnalytics: true,
  googleAnalyticsId: null,
  linkPreviewApiServers: [],
  poweredBy: null,
  deviceName: false,
  sendStatusToDevice: false,
  syncAllStatus: false,
};
