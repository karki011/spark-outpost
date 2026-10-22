globalThis.__zod_globalConfig = { jitless: true };
if (location.pathname === '/island' || location.pathname === '/meeting-alert') {
  document.documentElement.dataset.island = '';
}
if (location.pathname === '/settings' && window.sparkDesktop) {
  document.documentElement.dataset.settingsWindow = '';
}
try {
  var key = 'spark-outpost.theme';
  var desktop = window.sparkDesktop && window.sparkDesktop.theme;
  var skin = localStorage.getItem(key);
  if (!skin && desktop && desktop.saved) {
    skin = desktop.saved;
    localStorage.setItem(key, skin);
  }
  skin = skin || 'graphite';
  if (skin !== 'system') document.documentElement.dataset.skin = skin;
} catch {
  document.documentElement.dataset.skin = 'graphite';
}
