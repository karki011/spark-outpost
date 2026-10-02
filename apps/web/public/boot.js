(function () {
  var root = document.documentElement;
  var theme = new URLSearchParams(location.search).get('theme') || 'graphite';
  if (!/^[a-z]{1,24}$/.test(theme)) theme = 'graphite';
  if (theme !== 'system') root.dataset.skin = theme;

  function showStatus(line, text) {
    if (line.dataset.text === text) return;
    line.dataset.text = text;
    var span = document.createElement('span');
    span.textContent = text;
    line.replaceChildren(span);
  }

  function start() {
    var line = document.querySelector('.boot-status');
    var bridge = window.sparkBoot;
    if (!line || !bridge) return;
    bridge.onStatus(function (text) {
      showStatus(line, text);
    });
    bridge.onLeave(function () {
      root.dataset.leaving = '';
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(bridge.painted);
    });
  }

  document.addEventListener('DOMContentLoaded', start);
})();
