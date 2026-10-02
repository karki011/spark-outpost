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

  function startParty(boot, bridge) {
    var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cast = window.BootParty.start(boot, { still: still });
    if (typeof bridge.teasers !== 'function') return;
    Promise.resolve(bridge.teasers())
      .then(function (teasers) {
        window.BootTeasers.show(boot, cast.herald, teasers);
      })
      .catch(function (error) {
        console.error(error);
      });
  }

  function start() {
    var boot = document.querySelector('.boot');
    var line = document.querySelector('.boot-status');
    var bridge = window.sparkBoot;
    if (!boot || !line || !bridge) return;
    try {
      startParty(boot, bridge);
    } catch (error) {
      console.error(error);
    }
    bridge.onStatus(function (text) {
      showStatus(line, text);
      window.BootParty.status(text);
    });
    bridge.onLeave(function () {
      root.dataset.leaving = '';
      window.BootParty.leave();
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(bridge.painted);
    });
  }

  document.addEventListener('DOMContentLoaded', start);
})();
