window.BootTeasers = (function () {
  var plan = window.BootPartyPlan;
  var party = window.BootParty;

  function build(boot, face) {
    var teaser = document.createElement('div');
    teaser.className = 'teaser';
    teaser.setAttribute('aria-hidden', 'true');
    teaser.innerHTML =
      '<div class="teaser-herald"><div class="pb-hop">' +
      party.faceMarkup(face) +
      '</div></div>' +
      '<div class="teaser-window"><div class="teaser-card"><div class="teaser-flip">' +
      '<p class="teaser-back">psst…</p>' +
      '<p class="teaser-front"><span class="teaser-label"></span><span class="teaser-text"></span></p>' +
      '</div></div></div>';
    var spoken = document.createElement('p');
    spoken.className = 'boot-sr';
    spoken.setAttribute('aria-live', 'polite');
    boot.querySelector('.boot-foot').appendChild(teaser);
    boot.appendChild(spoken);
    return { teaser: teaser, spoken: spoken };
  }

  function show(boot, face, raw) {
    var teasers = plan.cleanTeasers(raw);
    if (teasers.length === 0) return;
    var parts = build(boot, face);
    var label = parts.teaser.querySelector('.teaser-label');
    var text = parts.teaser.querySelector('.teaser-text');
    plan.teaserTimeline(teasers.length).forEach(function (step, index) {
      party.later(step.arrive, function () {
        label.textContent = teasers[index].label;
        text.textContent = teasers[index].text;
        parts.teaser.dataset.index = String(index);
        parts.teaser.dataset.phase = 'arrive';
        if (index === 0) parts.spoken.textContent = plan.spoken(teasers);
      });
      party.later(step.reveal, function () {
        parts.teaser.dataset.phase = 'reveal';
      });
      if (index === teasers.length - 1) return;
      party.later(step.leave, function () {
        parts.teaser.dataset.phase = 'leave';
      });
      party.later(step.gone, function () {
        parts.teaser.dataset.phase = '';
      });
    });
  }

  return { show: show };
})();
