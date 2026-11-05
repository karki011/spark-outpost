window.BootParty = (function () {
  var plan = window.BootPartyPlan;
  var STAGE_WIDTH = 540;
  var STAGE_HEIGHT = 420;
  var SPARK =
    'M48 2C48.6 6.4 50.1 7.9 54.5 8.5C50.1 9.1 48.6 10.6 48 15C47.4 10.6 45.9 9.1 41.5 8.5C45.9 7.9 47.4 6.4 48 2Z';

  var random = Math.random;
  var root = null;
  var party = null;
  var slots = [];
  var peeker = null;
  var timers = [];
  var lastStatus = null;
  var lastRoutine = null;
  var quietUntil = 0;
  var still = false;
  var finale = false;

  function later(ms, run) {
    timers.push(setTimeout(run, ms));
  }

  function pulse(element, className, ms) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    later(ms, function () {
      element.classList.remove(className);
    });
  }

  function faceMarkup(face) {
    return (
      '<svg class="pb-face" viewBox="0 0 100 100"><g class="pb-breathe"><g fill="' +
      face.fill +
      '">' +
      face.body +
      '</g><g fill="' +
      face.ink +
      '"><g class="pb-eyes pb-idle">' +
      face.idle +
      '</g><g class="pb-eyes pb-happy">' +
      face.happy +
      '</g><g class="pb-eyes pb-sleepy">' +
      face.sleepy +
      '</g></g></g></svg>'
    );
  }

  var EXTRAS = {
    juggler: '<span class="pb-balls"><i><b></b></i><i><b></b></i><i><b></b></i></span>',
    sleeper: '<span class="pb-zz"><i>z</i><i>z</i><i>z</i></span>',
    dancer:
      '<svg class="pb-burst" viewBox="0 0 64 64"><path d="' +
      SPARK +
      '" transform="translate(32 32) scale(2.4) translate(-48 -8.5)"/>' +
      '<circle cx="32" cy="5" r="3"/><circle cx="59" cy="32" r="3"/>' +
      '<circle cx="32" cy="59" r="3"/><circle cx="5" cy="32" r="3"/></svg>',
  };

  function blobElement(className, face, extra) {
    var element = document.createElement('div');
    element.className = className;
    element.innerHTML =
      '<div class="pb-pop"><div class="pb-hop">' +
      faceMarkup(face) +
      (extra || '') +
      '</div></div>';
    return element;
  }

  function slotElement(slot, index) {
    var element = blobElement('pb pb-' + slot.role, slot.face, EXTRAS[slot.role]);
    element.style.setProperty('--x', String(slot.x));
    element.style.setProperty('--j', String(Math.abs(index - 2.5)));
    element.style.setProperty('--delay', slot.delay + 'ms');
    element.style.setProperty('--breath', slot.breath + 'ms');
    if (slot.role === 'sleeper') element.classList.add('sleeping');
    return {
      role: slot.role,
      element: element,
      hop: element.querySelector('.pb-hop'),
      burst: element.querySelector('.pb-burst'),
    };
  }

  function fit() {
    var scale = Math.min(
      1,
      (window.innerWidth - 32) / STAGE_WIDTH,
      window.innerHeight / STAGE_HEIGHT,
    );
    root.style.setProperty('--k', String(Math.max(0.4, scale).toFixed(3)));
  }

  function smile(entry, ms) {
    entry.element.classList.add('happy');
    later(ms, function () {
      if (!finale) entry.element.classList.remove('happy');
    });
  }

  function runRoutine(routine) {
    var members = routine.members.map(function (index) {
      return slots[index];
    });
    if (routine.name === 'hop') pulse(members[0].hop, 'hop', 800);
    if (routine.name === 'bump') {
      pulse(members[0].element, 'bump-right', 1000);
      pulse(members[1].element, 'bump-left', 1000);
    }
    if (routine.name === 'conga') {
      members.forEach(function (entry, order) {
        entry.element.style.setProperty('--i', String(order));
        pulse(entry.element, 'conga', 2700);
        smile(entry, 2700);
      });
    }
    if (routine.name === 'peek') {
      peeker.dataset.side = routine.side;
      pulse(peeker, 'peek', 2600);
    }
  }

  function ambient() {
    if (finale) return;
    if (Date.now() < quietUntil) {
      later(quietUntil - Date.now() + 200, ambient);
      return;
    }
    var routine = plan.nextRoutine({ slots: slots }, random, lastRoutine);
    lastRoutine = routine.name;
    runRoutine(routine);
    later(routine.wait, ambient);
  }

  function wakeSleeper(ms) {
    slots.forEach(function (entry) {
      if (entry.role !== 'sleeper') return;
      entry.element.classList.remove('sleeping');
      pulse(entry.hop, 'startle', 700);
      if (ms === null) return;
      later(ms, function () {
        if (!finale) entry.element.classList.add('sleeping');
      });
    });
  }

  function react() {
    quietUntil = Date.now() + 1500;
    var reaction = plan.stepReaction({ slots: slots }, random);
    var left = slots[reaction.highFive[0]];
    var right = slots[reaction.highFive[1]];
    pulse(left.element, 'five-right', 900);
    pulse(right.element, 'five-left', 900);
    pulse(left.hop, 'cheer', 900);
    pulse(right.hop, 'cheer', 900);
    pulse(left.burst, 'burst', 900);
    smile(left, 1300);
    smile(right, 1300);
    reaction.cheer.forEach(function (index, order) {
      var entry = slots[index];
      if (entry.role === 'sleeper') return;
      entry.hop.style.setProperty('--i', String(order));
      pulse(entry.hop, 'cheer', 1100);
      smile(entry, 1300);
    });
    wakeSleeper(finale ? null : 3200);
  }

  function huddle() {
    slots.forEach(function (entry) {
      entry.element.classList.add('happy');
    });
    party.classList.add('huddle');
  }

  function status(text) {
    if (!party || text === lastStatus) return;
    var first = lastStatus === null;
    lastStatus = text;
    party.dataset.step = text;
    if (text === plan.FINAL_STATUS) finale = true;
    if (still) return;
    if (!first) react();
    if (finale) {
      wakeSleeper(null);
      later(first ? 0 : 900, huddle);
    }
  }

  function leave() {
    if (!party) return;
    timers.forEach(clearTimeout);
    timers = [];
    party.classList.add('joining');
  }

  function start(boot, options) {
    root = boot;
    random = options.random || Math.random;
    still = options.still;
    var cast = plan.cast(window.BOOT_FACES, random);
    party = document.createElement('div');
    party.className = 'party';
    party.setAttribute('aria-hidden', 'true');
    slots = cast.slots.map(slotElement);
    slots.forEach(function (entry) {
      party.appendChild(entry.element);
    });
    peeker = blobElement('pb-peeker', cast.peeker);
    boot.querySelector('.boot-stage').appendChild(party);
    boot.appendChild(peeker);
    fit();
    window.addEventListener('resize', fit);
    if (!still) later(2200, ambient);
    return cast;
  }

  return { start: start, status: status, leave: leave, faceMarkup: faceMarkup, later: later };
})();
