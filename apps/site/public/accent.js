(function () {
  var SKINS = { blaze: ['blaze', 'ember'], acid: ['acid', 'volt'], violet: ['violet', 'ultra'] };
  var KEY = 'spark-site.accent';
  var FALLBACK = 'blaze';
  var root = document.documentElement;
  var dark = window.matchMedia('(prefers-color-scheme: dark)');

  function known(accent) {
    return Object.prototype.hasOwnProperty.call(SKINS, accent);
  }

  function stored() {
    try {
      var value = localStorage.getItem(KEY);
      return known(value) ? value : FALLBACK;
    } catch {
      return FALLBACK;
    }
  }

  function apply(accent) {
    root.dataset.accent = accent;
    root.dataset.skin = SKINS[accent][dark.matches ? 1 : 0];
  }

  function choose(accent) {
    if (!known(accent)) return;
    try {
      localStorage.setItem(KEY, accent);
    } catch {
      apply(accent);
      return;
    }
    apply(accent);
  }

  apply(stored());
  dark.addEventListener('change', function () {
    apply(root.dataset.accent);
  });
  window.sparkAccent = {
    choose: choose,
    current: function () {
      return root.dataset.accent;
    },
  };
})();
