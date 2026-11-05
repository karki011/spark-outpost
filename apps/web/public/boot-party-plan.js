window.BootPartyPlan = (function () {
  var SLOTS = [-228, -164, -102, 102, 164, 228];
  var DANCER_PAIRS = [
    [1, 2],
    [3, 4],
  ];
  var ROUTINES = ['hop', 'bump', 'conga', 'peek', 'hop'];
  var TEASER = { first: 1400, arrive: 700, flip: 600, hold: 3000, leave: 450, gap: 500 };

  function between(random, low, high) {
    return low + random() * (high - low);
  }

  function pick(random, list) {
    return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  }

  function shuffle(random, list) {
    var copy = list.slice();
    for (var index = copy.length - 1; index > 0; index -= 1) {
      var swap = Math.floor(random() * (index + 1));
      var held = copy[index];
      copy[index] = copy[swap];
      copy[swap] = held;
    }
    return copy;
  }

  function cast(faces, random) {
    var order = shuffle(random, faces);
    var sleeperLeft = random() < 0.5;
    var slots = SLOTS.map(function (x, index) {
      var outer = index === 0 || index === SLOTS.length - 1;
      var role = 'dancer';
      if (outer) role = (index === 0) === sleeperLeft ? 'sleeper' : 'juggler';
      return {
        face: order[index],
        x: x,
        role: role,
        delay: Math.round(between(random, 450, 1300)),
        breath: Math.round(between(random, 2600, 3800)),
      };
    });
    return { slots: slots, peeker: order[SLOTS.length], herald: order[SLOTS.length + 1] };
  }

  function dancers(party) {
    return party.slots
      .map(function (slot, index) {
        return slot.role === 'dancer' ? index : -1;
      })
      .filter(function (index) {
        return index >= 0;
      });
  }

  function nextRoutine(party, random, last) {
    var choices = ROUTINES.filter(function (name) {
      return name !== last;
    });
    var name = pick(random, choices);
    var wait = Math.round(between(random, 1800, 3200));
    if (name === 'bump') return { name: name, members: pick(random, DANCER_PAIRS), wait: wait };
    if (name === 'conga') return { name: name, members: dancers(party), wait: wait + 1200 };
    if (name === 'peek') {
      return { name: name, members: [], side: random() < 0.5 ? 'left' : 'right', wait: wait };
    }
    return { name: 'hop', members: [pick(random, dancers(party))], wait: wait };
  }

  function stepReaction(party, random) {
    var pair = pick(random, DANCER_PAIRS);
    var cheer = party.slots
      .map(function (_slot, index) {
        return index;
      })
      .filter(function (index) {
        return pair.indexOf(index) < 0;
      });
    return { highFive: pair, cheer: cheer };
  }

  function teaserTimeline(count) {
    var each = TEASER.arrive + TEASER.flip + TEASER.hold + TEASER.leave;
    var timeline = [];
    for (var index = 0; index < count; index += 1) {
      var start = TEASER.first + index * (each + TEASER.gap);
      timeline.push({
        arrive: start,
        reveal: start + TEASER.arrive,
        leave: start + TEASER.arrive + TEASER.flip + TEASER.hold,
        gone: start + each,
      });
    }
    return timeline;
  }

  function cleanTeasers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(function (item) {
        return (
          item &&
          typeof item.label === 'string' &&
          typeof item.text === 'string' &&
          item.text.length > 0
        );
      })
      .slice(0, 5)
      .map(function (item) {
        return { label: item.label.slice(0, 40), text: item.text.slice(0, 120) };
      });
  }

  function spoken(teasers) {
    return teasers
      .map(function (item) {
        var text = item.text.replace(/\p{Extended_Pictographic}️?/gu, '').trim();
        return item.label + ': ' + text.replace(/[.…]*$/, '') + '.';
      })
      .join(' ');
  }

  return {
    FINAL_STATUS: 'Starting Spark…',
    SLOTS: SLOTS,
    cast: cast,
    nextRoutine: nextRoutine,
    stepReaction: stepReaction,
    teaserTimeline: teaserTimeline,
    cleanTeasers: cleanTeasers,
    spoken: spoken,
  };
})();
