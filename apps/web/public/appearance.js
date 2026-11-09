(function () {
  var TINTS = {
    graphite: ['light', 'graphite'],
    apricot: ['apricot', 'plum'],
    lagoon: ['lagoon', 'moss'],
    iris: ['iris', 'aurora'],
    fjord: ['fjord', 'void'],
    sage: ['sage', 'loam'],
    blaze: ['blaze', 'ember'],
    acid: ['acid', 'volt'],
    violet: ['violet', 'ultra'],
  };
  var MODES = ['auto', 'light', 'dark'];
  var CONTRASTS = ['system', 'always'];
  var DEFAULT = { mode: 'auto', tint: 'graphite', contrast: 'system' };

  function legacy(theme) {
    if (theme === 'light' || theme === 'dark') {
      return { mode: theme, tint: 'graphite', contrast: 'system' };
    }
    if (theme === 'contrast') return { mode: 'light', tint: 'graphite', contrast: 'always' };
    for (var tint in TINTS) {
      if (TINTS[tint][0] === theme) return { mode: 'light', tint: tint, contrast: 'system' };
      if (TINTS[tint][1] === theme) return { mode: 'dark', tint: tint, contrast: 'system' };
    }
    return DEFAULT;
  }

  function parse(stored) {
    if (!stored) return DEFAULT;
    var parts = String(stored).split('.');
    if (parts.length === 1) return legacy(parts[0]);
    var valid =
      parts.length === 3 &&
      MODES.indexOf(parts[0]) !== -1 &&
      Object.prototype.hasOwnProperty.call(TINTS, parts[1]) &&
      CONTRASTS.indexOf(parts[2]) !== -1;
    return valid ? { mode: parts[0], tint: parts[1], contrast: parts[2] } : DEFAULT;
  }

  function resolve(stored, look, island) {
    var appearance = parse(stored);
    var contrast = appearance.contrast === 'always' || look.moreContrast;
    var pair = TINTS[appearance.tint];
    if (island) return contrast ? 'contrast-dark' : pair[1];
    var dark = appearance.mode === 'auto' ? look.dark : appearance.mode === 'dark';
    if (contrast) return dark ? 'contrast-dark' : 'contrast';
    return dark ? pair[1] : pair[0];
  }

  function systemLook() {
    var media = globalThis.matchMedia;
    return {
      dark: Boolean(media && media('(prefers-color-scheme: dark)').matches),
      moreContrast: Boolean(media && media('(prefers-contrast: more)').matches),
    };
  }

  globalThis.sparkAppearance = {
    resolve: resolve,
    skin: function (stored, island) {
      return resolve(stored, systemLook(), island);
    },
  };
})();
