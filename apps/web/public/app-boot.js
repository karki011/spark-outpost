globalThis.__zod_globalConfig = { jitless: true };
(function () {
  var root = document.documentElement;
  var island = location.pathname === '/island' || location.pathname === '/meeting-alert';
  if (island) root.dataset.island = '';

  function readStored() {
    try {
      var key = 'spark-outpost.theme';
      var desktop = window.sparkDesktop && window.sparkDesktop.theme;
      var stored = localStorage.getItem(key);
      if (!stored && desktop && desktop.saved) {
        stored = desktop.saved;
        localStorage.setItem(key, stored);
      }
      return stored;
    } catch {
      return null;
    }
  }

  try {
    root.dataset.skin = window.sparkAppearance.skin(readStored(), island);
  } catch {
    root.dataset.skin = 'graphite';
  }
})();
