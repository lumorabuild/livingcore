// ─────────────────────────────────────────────────────────────────────────────
// LIVING CORE — client enhancement (island era, part 4 / subtitles rewrite).
// Vanilla, no framework. Progressive: every page renders fully server-side;
// this makes the home page a real pan/zoom map app and every card a real
// dialog — poses, walking, the caption card, pan+zoom, the landmark/
// character/weather/today/projects/info/menu/how-to cards, and the bottle
// form — plus keeps "show all thoughts" and relative times in sync.
//
// THE CAPTION CARD (§ below "CAPTION CARD"): the owner, watching live —
// "I didn't understand what exactly is happening in Kevin and Jenny's brain;
// also everything is moving so fast... the text messages coming out of their
// brain are not easy to read at all." This replaced the old floating map
// bubbles (say/thought/do, one per turn, hanging over the figure) with ONE
// card: the CURRENT turn, clearly labelled (💭 Thinks / 💬 Says / ✋ Does),
// revealed slowly, held long enough to actually read, never more than one on
// screen. A small round badge + a glow ring on the figure (island-map.tsx's
// `.fig-active-ring`) mark who it's about; nothing else floats over the map.
//
// THE DIRECTOR (§ below "poll → queue → play"): ONE global queue across BOTH
// agents now, not two independent per-agent ones — "at most one caption at a
// time" (an apart scene used to animate both figures at once; now it plays
// their turns in arrival order, one at a time, which is also just calmer).
//
// THE DIALOG SYSTEM (§ below "cards"): every floating card is a real
// `<dialog>` with real SSR content. A no-JS click on its trigger just
// follows the `#id` fragment (app.css's `dialog:target{display:block
// !important}` shows it); with JS, `initDialogs()` intercepts the SAME
// click and calls `.showModal()` instead — one trigger, two ways to work.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var POLL_VISIBLE_MS = 5000;
  var POLL_HIDDEN_MS = 30000;

  // ── thought "show all" toggle (the scene panel's blurred thought-peek
  // reveal) — remembered per-browser. Separate from the HUD's map "show
  // thoughts" toggle below, which controls the caption card's 💭 Thinks row
  // and defaults ON ("it's the fun part") where this one defaults OFF. ──
  function initThoughtsToggle() {
    var btn = document.getElementById('thoughts-toggle-btn');
    if (!btn) return;
    var root = document.body;
    var KEY = 'lc:thoughtsShown';
    var shown = false;
    try { shown = localStorage.getItem(KEY) === '1'; } catch (e) {}
    apply(shown);

    btn.addEventListener('click', function () {
      shown = !shown;
      try { localStorage.setItem(KEY, shown ? '1' : '0'); } catch (e) {}
      apply(shown);
    });

    function apply(on) {
      root.classList.toggle('thoughts-shown', on);
      btn.textContent = on ? 'hide thoughts' : 'show all thoughts';
      var all = document.querySelectorAll('.thought-peek');
      for (var i = 0; i < all.length; i++) {
        if (on) all[i].setAttribute('open', ''); else all[i].removeAttribute('open');
      }
    }
  }

  /** The HUD's map-only toggle — hides/shows the caption card's private
   *  💭 Thinks row (never the say/do rows). Default ON. Read by
   *  showCaption()/initCaptionFromSSR() below via `.island-root.thoughts-off`. */
  function initMapThoughtsToggle() {
    var btn = document.getElementById('map-thoughts-toggle');
    var root = document.querySelector('.island-root');
    if (!btn || !root) return;
    var KEY = 'lc:mapThoughts';
    var on = true;
    try { var saved = localStorage.getItem(KEY); if (saved !== null) on = saved === '1'; } catch (e) {}
    apply(on);
    btn.addEventListener('click', function () {
      on = !on;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      apply(on);
    });
    function apply(v) {
      root.classList.toggle('thoughts-off', !v);
      btn.setAttribute('aria-pressed', v ? 'true' : 'false');
    }
  }

  // ── relative times: enhance every [data-ts] in place, refreshed periodically ──
  function relTime(iso) {
    if (!iso) return '';
    var ts = iso.indexOf('T') === -1 ? iso.replace(' ', 'T') + 'Z' : iso;
    var d = Date.parse(ts);
    if (isNaN(d)) return '';
    var diff = Math.round((Date.now() - d) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function refreshRelativeTimes() {
    var nodes = document.querySelectorAll('[data-ts]');
    for (var i = 0; i < nodes.length; i++) {
      var t = relTime(nodes[i].getAttribute('data-ts'));
      if (t) nodes[i].textContent = t;
    }
  }

  // Mirrors turn.tsx's isPlaceholderNothing — a model turn can write the
  // literal word "nothing" (or "(nothing)") as its SAY instead of leaving it
  // blank; either way it isn't real dialogue.
  function isPlaceholderNothing(s) {
    if (!s) return true;
    var norm = s.trim().toLowerCase().replace(/^[([]+|[)\].]+$/g, '').trim();
    return norm === '' || norm === 'nothing' || norm === 'silence' || norm === 'n/a';
  }

  function agentEmoji(speaker) { return speaker === 'kevin' ? '🔧' : '🌿'; }
  function agentName(speaker) { return speaker === 'kevin' ? 'Kevin' : 'Jenny'; }

  function appendTurn(container, t) {
    var div = document.createElement('div');
    div.className = 'turn ' + t.speaker + ' dialogue-turn';
    div.setAttribute('data-turn-id', t.id);

    var head = document.createElement('div');
    head.className = 'turn-head';
    var name = document.createElement('span');
    name.className = 'turn-name';
    name.textContent = agentEmoji(t.speaker) + ' ' + agentName(t.speaker);
    var time = document.createElement('span');
    time.className = 'turn-time';
    time.setAttribute('data-ts', t.created_at);
    time.textContent = relTime(t.created_at) || '';
    head.appendChild(name); head.appendChild(time);
    div.appendChild(head);

    var hasSay = !isPlaceholderNothing(t.say);
    var hasDo = !isPlaceholderNothing(t.do);
    if (hasSay) {
      var say = document.createElement('p');
      say.className = 'turn-say';
      say.textContent = t.say;
      div.appendChild(say);
    }
    if (hasDo) {
      var doEl = document.createElement('p');
      doEl.className = 'turn-do';
      if (!hasSay) {
        var nameSpan = document.createElement('span');
        nameSpan.className = 'turn-do-name';
        nameSpan.textContent = agentName(t.speaker) + ' — ';
        doEl.appendChild(nameSpan);
        doEl.appendChild(document.createTextNode(t.do.trim().charAt(0).toLowerCase() + t.do.trim().slice(1)));
      } else {
        doEl.appendChild(document.createTextNode(t.do));
      }
      div.appendChild(doEl);
    }
    if (!hasSay && !hasDo) {
      var quietEl = document.createElement('p');
      quietEl.className = 'turn-do turn-do-quiet';
      quietEl.textContent = agentName(t.speaker) + ' is quiet for a moment.';
      div.appendChild(quietEl);
    }
    if (t.thought) {
      var det = document.createElement('details');
      det.className = 'thought-peek';
      if (document.body.classList.contains('thoughts-shown')) det.setAttribute('open', '');
      var sum = document.createElement('summary');
      sum.textContent = '💭 peek at the thought';
      var body = document.createElement('div');
      body.className = 'thought-body';
      body.textContent = t.thought;
      det.appendChild(sum); det.appendChild(body);
      div.appendChild(det);
    }
    container.appendChild(div);
  }

  /** Keeps the phone bottom sheet's collapsed peek (`.panel-peek-turn`, SSR'd
   *  with the scene's actual last turn at page load) live as new turns
   *  arrive — otherwise a visitor who leaves it collapsed is shown a turn
   *  that's gone stale the moment the FIRST poll lands a new one. The
   *  one-line summary above it (`.panel-peek-line`) doesn't need a poll-time
   *  update: every case that changes IT (a new scene, a mode change) already
   *  reloads the page — see initPoll()'s reload branches below. */
  function updatePanelPeek(t) {
    var el = document.getElementById('panel-peek-turn');
    if (!el) return;
    var say = !isPlaceholderNothing(t.say) ? t.say : '';
    var doText = !isPlaceholderNothing(t.do) ? t.do : '';
    var text = say || doText;
    if (!text) return;
    el.textContent = agentEmoji(t.speaker) + ' ' + agentName(t.speaker) + ': ' + text;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CARDS — every floating panel is a real <dialog>. ONE delegated system:
  // a click on `[data-open-dialog]` opens `#<value>`; `[data-dialog-close]`,
  // Escape (native <dialog> behaviour) and a click on the ::backdrop close
  // whichever dialog is open. Only one is ever open at a time (opening a
  // second one closes the first) so Esc/backdrop always has one obvious
  // target.
  // ─────────────────────────────────────────────────────────────────────────
  function openDialog(id) {
    var el = document.getElementById(id);
    if (!el || typeof el.showModal !== 'function') return null;
    var current = document.querySelector('dialog[open]');
    if (current && current !== el) current.close();
    if (!el.open) el.showModal();
    return el;
  }

  function initDialogs() {
    document.addEventListener('click', function (e) {
      var opener = e.target.closest ? e.target.closest('[data-open-dialog]') : null;
      if (opener) {
        // The landmark system (below) opens #landmark-dialog itself, AFTER
        // it has populated the title/body/action — never race it here.
        if (opener.hasAttribute('data-landmark')) return;
        e.preventDefault();
        openDialog(opener.getAttribute('data-open-dialog'));
        return;
      }
      var closer = e.target.closest ? e.target.closest('[data-dialog-close]') : null;
      if (closer) {
        e.preventDefault();
        var dlg = closer.closest('dialog');
        if (dlg) dlg.close();
        return;
      }
      // Click on the ::backdrop lands on the <dialog> element itself.
      if (e.target && e.target.tagName === 'DIALOG' && e.target.open) {
        e.target.close();
      }
    });
  }

  /** The "how to watch" first-visit card — shown once (localStorage,
   *  wrapped in try/catch so a visitor with storage blocked just sees it
   *  every visit rather than crashing), and always reachable again from the
   *  ℹ️ info card's own link. A real <dialog> like every other card, so
   *  Esc/backdrop/focus handling is the same native behaviour every other
   *  card here already gets for free — nothing bespoke needed. */
  function initHowTo() {
    var dlg = document.getElementById('howto-dialog');
    if (!dlg) return;
    var KEY = 'lc_seen_howto';
    var seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch (e) {}
    function markSeen() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }
    /*
      NOT an auto-opening modal. The first cut opened this dialog on every first
      visit, which covered the whole island for a newcomer AND for every
      crawler and audit (site-verify: "primary content covered by
      ul.howto-legend" on the live site, 2026-09-26). A small chip offers it
      instead; it goes away once the card has been opened or the chip dismissed.
    */
    if (!seen) {
      var hint = document.createElement('div');
      hint.className = 'howto-hint';
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'howto-hint-open';
      open.textContent = '👋 New here? How to watch';
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'howto-hint-close';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      hint.appendChild(open);
      hint.appendChild(close);
      document.body.appendChild(hint);
      var dismiss = function () { markSeen(); if (hint.parentNode) hint.parentNode.removeChild(hint); };
      open.addEventListener('click', function () { dismiss(); openDialog('howto-dialog'); });
      close.addEventListener('click', dismiss);
    }
    dlg.addEventListener('close', markSeen);
  }

  // ── bottle form — lives inside #bottle-dialog; degrades to a plain
  // POST-by-fetch with no dialog markup required to work. ──
  function wireBottleForm(form) {
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';
    var scope = form.closest('dialog') || form.parentElement;
    var feedback = scope.querySelector('.bottle-feedback');
    var contentEl = form.querySelector('textarea');
    var nameEl = form.querySelector('input[type="text"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var content = contentEl ? contentEl.value.trim() : '';
      if (!content) return;
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      say('', false);

      fetch('/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: content, author: nameEl ? nameEl.value.trim() : '' }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j && res.j.success) {
            say(res.j.data && res.j.data.message ? res.j.data.message : 'Your bottle is at sea.', false);
            form.reset();
          } else {
            say((res.j && res.j.error) || 'Something went wrong — try again in a moment.', true);
          }
        })
        .catch(function () { say('Something went wrong — try again in a moment.', true); })
        .finally(function () { if (btn) btn.disabled = false; });
    });

    function say(msg, isErr) {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.classList.toggle('err', !!isErr);
      feedback.hidden = !msg;
    }
  }

  function initBottleForms() {
    var forms = document.querySelectorAll('#bottle-form, #bottle-dialog-form');
    for (var i = 0; i < forms.length; i++) wireBottleForm(forms[i]);
  }

  // ── the HUD menu button reads aria-expanded off whichever dialog is
  // open (native <dialog> has no built-in aria-expanded wiring) ──
  function initMenuAria() {
    var menu = document.getElementById('menu-dialog');
    var btns = document.querySelectorAll('[data-open-dialog="menu-dialog"]');
    if (!menu || !btns.length) return;
    function sync() {
      for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-expanded', menu.open ? 'true' : 'false');
    }
    menu.addEventListener('close', sync);
    document.addEventListener('click', function () { setTimeout(sync, 0); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE ISLAND — figure poses, walking, the caption card, pan/zoom, landmark
  // cards. Everything below reads small JSON islands the server printed
  // (#__LOCATIONS__, #__WALKGRAPH__, #__LOCINFO__, #__LATEST_TURN__) and
  // moves/poses the SAME server-rendered <g class="pin"> elements; nothing
  // here re-renders any SVG.
  // ─────────────────────────────────────────────────────────────────────────
  var LOCATIONS = {};
  var WALKGRAPH = { hub: { x: 520, y: 430 }, bends: {} };
  var LOCINFO = {};
  (function readIslandData() {
    var loc = document.getElementById('__LOCATIONS__');
    if (loc) { try { LOCATIONS = JSON.parse(loc.textContent || '{}'); } catch (e) {} }
    var wg = document.getElementById('__WALKGRAPH__');
    if (wg) { try { WALKGRAPH = JSON.parse(wg.textContent || '{}') || WALKGRAPH; } catch (e) {} }
    var li = document.getElementById('__LOCINFO__');
    if (li) { try { LOCINFO = JSON.parse(li.textContent || '{}'); } catch (e) {} }
  })();

  /** MIRRORS src/views/island-map.tsx's ACTIVITY_OFFSET — same pattern as
   *  src/world/activity.ts's own note: kept in sync by hand, not shared,
   *  because one lives in a server-only .tsx and the other in a plain
   *  browser script with no build step. */
  var ACTIVITY_OFFSET = {
    fishing: [10, -2], chopping: [-8, 6], gardening: [6, -6], sketching: [10, -10],
    repairing: [-10, -8], building: [8, -10], foraging: [-8, 8], swimming: [14, 18],
    radio: [12, -12], writing: [-12, -12], exploring: [8, -12], resting: [0, 6],
    cooking: [-8, -12], eating: [8, -12],
  };

  /** MIRRORS src/world/prompts.ts's energyWords/moodWords/nowWord —
   *  same thresholds, same fallback order — so the HUD "now" chips can
   *  update live from /api/poll's world.agents without a round trip through
   *  the server. Keep in sync by hand if the server thresholds ever change. */
  function energyWordsJS(e) {
    if (e >= 80) return 'rested';
    if (e >= 55) return 'a little tired';
    if (e >= 30) return 'tired';
    if (e >= 12) return 'exhausted';
    return 'barely able to keep your eyes open';
  }
  function moodWordsJS(m) {
    if (m >= 4) return 'happy';
    if (m >= 2) return 'in good spirits';
    if (m >= -1) return 'even';
    if (m >= -3) return 'low';
    return 'miserable';
  }
  function nowWordJS(a) { return a.energy < 55 ? energyWordsJS(a.energy) : moodWordsJS(a.mood); }

  var islandRoot = null;
  var islandViewport = null;
  var mapStage = null;
  var mapWrap = null;
  var svgEl = null;
  var badgeLayer = null;
  var captionCard = null;

  /**
   * The transform from the SVG's own viewBox (map units) to VIEWPORT pixels
   * — derived fresh every call from the SVG's live viewBox + preserveAspect-
   * Ratio + its OWN rendered box (`getBoundingClientRect`, which already
   * reflects PanZoom's CSS transform on `.map-stage`, however deep the
   * transform chain is — the browser resolves that for us). Includes
   * `rect.left/top` on purpose: `.badge-layer` is `position:fixed;inset:0`
   * (true viewport coordinates), unlike the old below-the-fold layout where
   * it shared an ancestor's origin with `.map-wrap`.
   */
  function mapTransform() {
    var vb = svgEl.viewBox.baseVal;
    var rect = mapWrap.getBoundingClientRect();
    var scaleX = rect.width / vb.width, scaleY = rect.height / vb.height;
    var scale = Math.min(scaleX, scaleY); // the SVG always uses "meet" now — see island-map.tsx
    var offX = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    var offY = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    return { scale: scale, offX: offX, offY: offY };
  }

  function mapToPixel(mx, my) {
    var t = mapTransform();
    return { left: t.offX + mx * t.scale, top: t.offY + my * t.scale };
  }

  function activityOffset(activity) {
    return ACTIVITY_OFFSET[activity] || [0, 0];
  }

  function bendFor(id) { return WALKGRAPH.bends && WALKGRAPH.bends[id]; }

  /** [from, from.bend||hub, to.bend||hub, to], with consecutive near-
   *  duplicate points dropped — see island-map.tsx's WALK_HUB/WALK_BENDS
   *  header comment for why this stand-in for a real path graph is enough. */
  function walkPath(fromId, toId) {
    var from = LOCATIONS[fromId], to = LOCATIONS[toId];
    if (!from || !to) return null;
    var hub = WALKGRAPH.hub || { x: 520, y: 430 };
    var raw = [{ x: from.x, y: from.y }, bendFor(fromId) || hub, bendFor(toId) || hub, { x: to.x, y: to.y }];
    var out = [raw[0]];
    for (var i = 1; i < raw.length; i++) {
      var p = raw[i], q = out[out.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) > 3) out.push(p);
    }
    return out;
  }

  /** Tweens `pin`'s position attribute (never a CSS transform — see
   *  app.css's `.pin { transition: none }` comment) along `walkPath`. Calmer
   *  motion pass (owner: "movement... so fast"): ~45 map-units/second,
   *  clamped 4-12s — half the original SPEC3 speed. Sets data-activity to
   *  "walking" for the duration and calls `done(finalActivity, finalLoc)`
   *  once it arrives so the caller can switch to the real pose. `onFrame`
   *  (optional) is called every frame with the figure's CURRENT map-unit
   *  {x,y} — Follow mode (below) uses it to keep panning while they walk. */
  function walkFigure(pin, fromId, toId, done, onFrame) {
    var path = walkPath(fromId, toId);
    var finalLoc = LOCATIONS[toId] || { x: 500, y: 400 };
    if (!path) { done(); return; }
    var total = 0, segLen = [];
    for (var i = 1; i < path.length; i++) {
      var d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      segLen.push(d); total += d;
    }
    if (total < 2 || REDUCED_MOTION) {
      pin.setAttribute('transform', 'translate(' + finalLoc.x + ', ' + finalLoc.y + ')');
      if (onFrame) onFrame(finalLoc.x, finalLoc.y);
      done();
      return;
    }
    var duration = Math.max(4000, Math.min(12000, (total / 45) * 1000));
    pin.setAttribute('data-activity', 'walking');
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var dist = t * total;
      var acc = 0, idx = 0;
      for (; idx < segLen.length - 1; idx++) { if (acc + segLen[idx] >= dist) break; acc += segLen[idx]; }
      var segT = segLen[idx] ? Math.min(1, (dist - acc) / segLen[idx]) : 1;
      var p0 = path[idx], p1 = path[idx + 1] || p0;
      var x = p0.x + (p1.x - p0.x) * segT, y = p0.y + (p1.y - p0.y) * segT;
      pin.setAttribute('transform', 'translate(' + x.toFixed(1) + ', ' + y.toFixed(1) + ')');
      if (onFrame) onFrame(x, y);
      if (t < 1) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CAPTION CARD ("subtitles") — see this file's header comment. ONE card,
  // the CURRENT turn only, never more than one on screen. readingTime =
  // max(7s, 280ms × words across all three lines) + 3s (item A's own
  // formula) is both how long the card holds AND, doubled down on below in
  // the director, the pacing unit for the whole queue.
  // ─────────────────────────────────────────────────────────────────────────
  function wordCount(s) {
    if (!s) return 0;
    var m = s.trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function captionHoldMs(say, thought, doText) {
    var words = wordCount(say) + wordCount(thought) + wordCount(doText);
    return Math.max(7000, 280 * words) + 3000;
  }

  /** One (icon, label, text) row — a `<details>`-free "more" toggle appears
   *  only once the text is MEASURED to overflow its 4-line clamp (so short
   *  turns, the common case, never show a pointless button). */
  function buildCaptionRow(kind, icon, label, text) {
    var row = document.createElement('div');
    row.className = 'caption-row caption-row-' + kind;
    var iconEl = document.createElement('span');
    iconEl.className = 'caption-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;
    var labelEl = document.createElement('span');
    labelEl.className = 'caption-label';
    labelEl.textContent = label;
    var wrap = document.createElement('div');
    wrap.className = 'caption-text-wrap';
    var textEl = document.createElement('p');
    textEl.className = 'caption-text clamped';
    textEl.textContent = text; // model text — textContent only, never innerHTML
    var moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'caption-more';
    moreBtn.textContent = 'more';
    moreBtn.hidden = true;
    moreBtn.addEventListener('click', function () {
      var expanded = textEl.classList.toggle('expanded');
      moreBtn.textContent = expanded ? 'less' : 'more';
    });
    wrap.appendChild(textEl);
    wrap.appendChild(moreBtn);
    row.appendChild(iconEl);
    row.appendChild(labelEl);
    row.appendChild(wrap);
    requestAnimationFrame(function () {
      if (textEl.scrollHeight - textEl.clientHeight > 6) moreBtn.hidden = false;
    });
    return row;
  }

  /** Renders the caption card for turn `t` (poll shape: say/thought/do/
   *  activity/location, plus `sceneMode` from the caller) — the ONE place
   *  that decides what the card looks like, used both for a live turn
   *  arriving over the poll and, once, to take over the server-rendered
   *  card at load (see initCaptionFromSSR). Rows fade in staggered by
   *  ~1.2s each (thought, then say, then do — whichever are actually
   *  present; an empty one is skipped, never leaving a gap in the timing)
   *  via a per-row `transition-delay` set inline — `instant` skips the
   *  stagger entirely (used for "show the latest turn instantly on load").
   *  Returns the say/thought/do text actually shown, so the caller can size
   *  the hold time off exactly what's on screen (a hidden-by-toggle thought
   *  doesn't buy the card extra time). */
  function showCaption(t, sceneMode, instant) {
    if (!captionCard) return null;
    var say = !isPlaceholderNothing(t.say) ? t.say : '';
    var thoughtsOn = !(islandRoot && islandRoot.classList.contains('thoughts-off'));
    var thought = (t.thought && thoughtsOn) ? t.thought : '';
    var doText = !isPlaceholderNothing(t.do) ? t.do : '';

    var order = [];
    if (thought) order.push({ kind: 'thought', icon: '💭', label: 'Thinks', text: thought });
    if (say) order.push({ kind: 'say', icon: '💬', label: 'Says', text: say });
    if (doText) order.push({ kind: 'do', icon: '✋', label: 'Does', text: doText });

    if (!order.length) {
      // A fully silent turn (nothing to say, no visible action, and either
      // no thought or thoughts toggled off) never "replaces" anything —
      // leave whatever caption/badge is already on screen exactly as it is
      // (empty at first load, otherwise the previous real turn) rather than
      // blanking the card for a turn with nothing to show.
      return null;
    }
    captionCard.setAttribute('data-speaker', t.speaker);
    captionCard.hidden = false;
    while (captionCard.firstChild) captionCard.removeChild(captionCard.firstChild);

    var head = document.createElement('div');
    head.className = 'caption-head';
    var dot = document.createElement('span');
    dot.className = 'caption-dot';
    dot.setAttribute('aria-hidden', 'true');
    var nameEl = document.createElement('span');
    nameEl.className = 'caption-name';
    nameEl.textContent = agentName(t.speaker);
    var metaEl = document.createElement('span');
    metaEl.className = 'caption-meta';
    var locEntry = LOCINFO[t.location];
    metaEl.textContent = (locEntry ? ' — at ' + locEntry.name : '') + (t.activity ? ' · ' + t.activity : '') + (sceneMode === 'apart' ? ' · alone' : '');
    head.appendChild(dot); head.appendChild(nameEl); head.appendChild(metaEl);
    captionCard.appendChild(head);

    var body = document.createElement('div');
    body.className = 'caption-body';
    captionCard.appendChild(body);

    var rows = [];
    order.forEach(function (r, i) {
      var row = buildCaptionRow(r.kind, r.icon, r.label, r.text);
      row.style.transitionDelay = instant ? '0ms' : (i * 1200) + 'ms';
      body.appendChild(row);
      rows.push(row);
    });
    // Two rAFs: the first lets the browser paint the rows at opacity 0 (their
    // base state), the second then flips the class so the transition
    // actually runs instead of the browser coalescing both changes into one
    // frame with no visible transition at all.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        rows.forEach(function (row) { row.classList.add('caption-in'); });
      });
    });

    return { say: say, thought: thought, doText: doText };
  }

  /** Item A: "never covers the acting figure — if it would, pan the map so
   *  the figure sits above it." A one-shot corrective pan (reuses setView/
   *  clampView, not Follow mode's re-centre-and-zoom) run once right after a
   *  turn's figure settles — never fights a visitor's own subsequent drag. */
  function ensureFigureClearOfCaption(agent) {
    if (!captionCard || captionCard.hidden || !mapWrap) return;
    var pin = mapWrap.querySelector('.pin[data-agent="' + agent + '"]');
    if (!pin || typeof pin.getBoundingClientRect !== 'function') return;
    var capRect = captionCard.getBoundingClientRect();
    if (capRect.width <= 0 || capRect.height <= 0) return;
    var pinRect = pin.getBoundingClientRect();
    // Pad generously — the figure's visible footprint (name label above,
    // shadow below) is bigger than the SVG group's own tight bbox.
    var figTop = pinRect.top - 44, figBottom = pinRect.bottom + 14;
    var figLeft = pinRect.left - 24, figRight = pinRect.right + 24;
    var overlap = figLeft < capRect.right && figRight > capRect.left && figTop < capRect.bottom && figBottom > capRect.top;
    if (!overlap) return;
    var shiftUp = Math.min(220, figBottom - capRect.top + 18);
    if (shiftUp <= 0) return;
    setView(view.scale, view.tx, view.ty - shiftUp, true);
  }

  /** Positions the caption card's `max-width` on desktop so it can never
   *  overlap the right-docked scene panel OR the bottom-right zoom cluster —
   *  measured live rather than hardcoded, so it self-corrects if either
   *  one's own CSS changes (same philosophy as fitView()'s panelReserve()
   *  below). Phones don't need this: `.caption-card` there is `left:16px;
   *  right:16px` in plain CSS. Also toggles visibility against the phone
   *  bottom sheet's expanded state (see initPanel()). */
  function updateCaptionLayout() {
    if (!captionCard) return;
    if (window.innerWidth < 1024) {
      captionCard.style.maxWidth = '';
      return;
    }
    var limit = window.innerWidth - 16;
    ['.zoom-cluster', '#island-panel'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.left < limit) limit = r.left;
    });
    var maxW = Math.max(240, Math.min(640, limit - 16 - 16));
    captionCard.style.maxWidth = maxW + 'px';
  }

  // ── the badge + glow ring over whoever's turn is currently narrated —
  // replaces the old floating say/thought/do bubbles; nothing else floats
  // over the map. Only ONE agent is ever "active" at a time now (the
  // director below plays one turn at a time across both agents). ──
  var badgeEls = { kevin: null, jenny: null };
  var activeAgent = null;

  function ensureBadge(agent) {
    if (badgeEls[agent]) return badgeEls[agent];
    if (!badgeLayer) return null;
    var el = document.createElement('div');
    el.className = 'map-badge ' + agent;
    badgeLayer.appendChild(el);
    badgeEls[agent] = el;
    return el;
  }

  function positionBadge(el) {
    if (!el || !el._anchor) return;
    var pt = mapToPixel(el._anchor.x, el._anchor.y);
    el.style.left = pt.left + 'px';
    el.style.top = pt.top + 'px';
  }

  /** `kind` is 'say' | 'thought' | 'do' — whichever row is the "headline" of
   *  what's currently shown (say beats thought beats do, matching the
   *  caption's own row order). Also marks the figure's `.pin[data-active]`
   *  (island-map.tsx's `.fig-active-ring`). */
  function setActive(agent, kind) {
    clearActive();
    activeAgent = agent;
    var pin = mapWrap && mapWrap.querySelector('.pin[data-agent="' + agent + '"]');
    if (pin) pin.setAttribute('data-active', kind);
    var el = ensureBadge(agent);
    if (!el) return;
    el.textContent = kind === 'say' ? '💬' : kind === 'thought' ? '💭' : '✋';
    el._anchor = { x: currentPos[agent].x, y: currentPos[agent].y - 34 };
    positionBadge(el);
    el.classList.add('visible');
  }

  function clearActive() {
    if (!activeAgent) return;
    var pin = mapWrap && mapWrap.querySelector('.pin[data-agent="' + activeAgent + '"]');
    if (pin) pin.removeAttribute('data-active');
    var el = badgeEls[activeAgent];
    if (el) el.classList.remove('visible');
    activeAgent = null;
  }

  /** Repositions the active badge on every pan/zoom transform — the map-
   *  space anchor is fixed per turn (set in setActive above), this just
   *  re-derives its on-screen pixel position, the same job the old
   *  repositionBubbles() did for the floating text bubbles it replaced. */
  function repositionOverlay() {
    if (!badgeLayer || !activeAgent) return;
    positionBadge(badgeEls[activeAgent]);
  }

  // ── per-agent walk/pose state (still per-agent — only the TURN QUEUE
  // below became global) ──
  var lastLoc = { kevin: null, jenny: null };
  var currentPos = {};

  // ── Follow mode (SPEC3 §"Follow button") ──
  var followOn = false;
  var followedAgent = null;

  function setFollow(on) {
    followOn = on;
    var btn = document.getElementById('follow-toggle');
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) followedAgent = null;
  }

  function initFollowToggle() {
    var btn = document.getElementById('follow-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () { setFollow(!followOn); if (followOn) followedAgent = null; });
  }

  /** Reads a `.pin`'s CURRENT `translate(x, y)` attribute straight off the
   *  DOM, rather than recomputing it from LOCATIONS — the server already
   *  applied the shared-location dx spread AND the activity offset
   *  (island-map.tsx's AgentFigure). */
  function readPinPos(pin) {
    var t = pin.getAttribute('transform') || '';
    var m = /translate\(\s*([\-\d.]+)[,\s]+([\-\d.]+)\s*\)/.exec(t);
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 500, y: 400 };
  }

  function initFigures() {
    ['kevin', 'jenny'].forEach(function (id) {
      var pin = mapWrap.querySelector('.pin[data-agent="' + id + '"]');
      if (!pin) return;
      lastLoc[id] = pin.getAttribute('data-loc');
      currentPos[id] = readPinPos(pin);
    });
  }

  function settlePose(agent, pin, activity, locId) {
    var loc = LOCATIONS[locId] || currentPos[agent];
    var off = activityOffset(activity);
    var shared = lastLoc.kevin && lastLoc.jenny && lastLoc.kevin === lastLoc.jenny;
    var dx = shared ? (agent === 'kevin' ? -22 : 22) : 0;
    pin.setAttribute('transform', 'translate(' + (loc.x + dx + off[0]) + ', ' + (loc.y + off[1]) + ')');
    pin.setAttribute('data-activity', activity || 'idle');
    pin.setAttribute('data-loc', locId || lastLoc[agent]);
    currentPos[agent] = { x: loc.x + dx + off[0], y: loc.y + off[1] };
    if (followOn && followedAgent === agent) panFollowTo(currentPos[agent].x, currentPos[agent].y, true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // THE DIRECTOR — poll → queue → play. ONE global queue across BOTH agents
  // (item B: "one turn at a time across both characters... at most one
  // caption at a time"), so an apart scene's two independent storylines now
  // play in arrival order instead of animating simultaneously. When the
  // backlog grows past 4 waiting turns, holds shorten to max(5s, hold/2)
  // until the queue catches back up — never drops a turn, just reads faster.
  // ─────────────────────────────────────────────────────────────────────────
  var turnQueue = [];
  var playingTurn = false;

  function playNextGlobal() {
    if (playingTurn) return;
    if (!turnQueue.length) return;
    playingTurn = true;
    var t = turnQueue.shift();
    var agent = t.speaker;
    var pin = mapWrap && mapWrap.querySelector('.pin[data-agent="' + agent + '"]');
    if (!pin) { playingTurn = false; playNextGlobal(); return; }

    if (followOn) followedAgent = agent;

    // Deliberately does NOT clearActive() here — the badge/glow ring is part
    // of "what's currently shown" exactly like the caption card text is, so
    // it stays through the gap between this turn's hold expiring and the
    // next one actually starting (an empty queue can leave that gap open
    // for a while). setActive() below clears the PREVIOUS turn's badge
    // itself, atomically, the moment a new one is ready to show — so there
    // is never a visible instant with no one marked as speaking while a
    // turn's own text is still on screen.
    function afterHold() {
      playingTurn = false;
      playNextGlobal();
    }

    function showAndHold() {
      settlePose(agent, pin, t.activity, t.location);
      var shown = showCaption(t, t.mode, false);
      if (!shown) { afterHold(); return; }
      var kind = shown.say ? 'say' : shown.thought ? 'thought' : 'do';
      setActive(agent, kind);
      requestAnimationFrame(function () { ensureFigureClearOfCaption(agent); });
      var hold = captionHoldMs(shown.say, shown.thought, shown.doText);
      if (turnQueue.length > 4) hold = Math.max(5000, hold / 2);
      setTimeout(afterHold, hold);
    }

    if (t.location && t.location !== lastLoc[agent]) {
      var from = lastLoc[agent];
      lastLoc[agent] = t.location;
      var onFrame = (followOn && followedAgent === agent)
        ? function (x, y) { panFollowTo(x, y, false); }
        : null;
      if (!from || !LOCATIONS[from]) { settlePose(agent, pin, t.activity, t.location); showAndHold(); }
      else walkFigure(pin, from, t.location, showAndHold, onFrame);
    } else {
      if (followOn && followedAgent === agent) panFollowTo(currentPos[agent].x, currentPos[agent].y, true);
      showAndHold();
    }
  }

  function enqueueTurn(t) {
    turnQueue.push(t);
    playNextGlobal();
  }

  /** On first paint: take over the server-rendered caption card (#__LATEST_
   *  TURN__, printed from the exact same data the live scene panel already
   *  shows) through the SAME showCaption() a live turn uses — never a
   *  second "what does a caption look like" implementation — but `instant`
   *  so it's already fully revealed, no replay (SPEC2 §B, still true here:
   *  "show the current state, don't replay history"). Also arms the hold
   *  timer + badge/ring so the director's queue waits its turn exactly like
   *  it would for any other turn. */
  function initCaptionFromSSR() {
    var el = document.getElementById('__LATEST_TURN__');
    if (!el) { playingTurn = false; return; }
    var t;
    try { t = JSON.parse(el.textContent || 'null'); } catch (e) { t = null; }
    if (!t || !t.speaker || !currentPos[t.speaker]) { playingTurn = false; return; }
    var shown = showCaption(t, t.mode, true);
    if (!shown) { playingTurn = false; return; }
    var kind = shown.say ? 'say' : shown.thought ? 'thought' : 'do';
    playingTurn = true;
    setActive(t.speaker, kind);
    requestAnimationFrame(function () { ensureFigureClearOfCaption(t.speaker); });
    var hold = captionHoldMs(shown.say, shown.thought, shown.doText);
    // Same "don't clear early" rule as playNextGlobal()'s afterHold() above.
    setTimeout(function () { playingTurn = false; playNextGlobal(); }, hold);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAN + ZOOM — vanilla, one CSS `transform: translate() scale()` on
  // `#map-stage` (SPEC3 §"PAN + ZOOM"). No SVG viewBox rewrites per frame:
  // the SVG's own viewBox never changes, so mapTransform()/mapToPixel()
  // above keep working unmodified (a browser resolves the FINAL on-screen
  // box of `.map-wrap` through however many ancestor transforms sit above
  // it — this file never has to do that arithmetic itself).
  // ─────────────────────────────────────────────────────────────────────────
  var MIN_SCALE = 0.6, MAX_SCALE = 4, FIT_SCALE = 0.9, FOLLOW_SCALE = 1.7;
  var view = { scale: FIT_SCALE, tx: 0, ty: 0 };
  var vpSize = { w: 0, h: 0 };
  // Layout fix #3: Kevin & Jenny read as tiny at the fit zoom. FIGURE_UNIT_HEIGHT
  // is the drawn figure's own height in SVG/map units (island-map.tsx's
  // Figure() — roughly head-top at y≈-32.6 to the shadow's bottom at y≈4.1);
  // MIN_FIGURE_PX is the floor we never want it to render smaller than.
  var FIGURE_UNIT_HEIGHT = 37, MIN_FIGURE_PX = 34;

  function readViewportSize() {
    if (!islandViewport) return;
    var r = islandViewport.getBoundingClientRect();
    vpSize.w = r.width; vpSize.h = r.height;
  }

  /** Clamp so the island can never be dragged fully off-screen: at least a
   *  quarter of the viewport's width/height must still overlap the content,
   *  whatever the current zoom. */
  function clampView(v) {
    var Wc = vpSize.w * v.scale, Hc = vpSize.h * v.scale;
    var overlapX = vpSize.w * 0.25, overlapY = vpSize.h * 0.25;
    var minTx = overlapX - Wc, maxTx = vpSize.w - overlapX;
    var minTy = overlapY - Hc, maxTy = vpSize.h - overlapY;
    v.tx = Math.max(minTx, Math.min(maxTx, v.tx));
    v.ty = Math.max(minTy, Math.min(maxTy, v.ty));
    v.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale));
    return v;
  }

  function applyStageTransform() {
    if (!mapStage) return;
    mapStage.style.transform = 'translate(' + view.tx.toFixed(1) + 'px,' + view.ty.toFixed(1) + 'px) scale(' + view.scale.toFixed(4) + ')';
    updateFigureScale();
    repositionOverlay();
  }

  /** Layout fix #3: counter-scale each figure by max(1, k/zoom) so it never
   *  renders under MIN_FIGURE_PX tall, however far out the map is zoomed —
   *  "at high zoom it may grow naturally" just falls out of clamping the
   *  factor at a floor of 1 rather than also capping it. Uses mapTransform()'s
   *  OWN map-units-to-pixels ratio (below) rather than re-deriving one here,
   *  because that ratio already folds in BOTH the SVG's own "meet" letterbox
   *  fit AND this file's pan/zoom `view.scale` — correct at any viewport size,
   *  not just the ones this was eyeballed against.
   *
   *  Cached on `view.scale` + the viewport's own size: those are the only two
   *  things the figure's on-screen size actually depends on, and a plain
   *  DRAG changes neither (only `view.tx/ty`) — skipping the recompute (and
   *  its forced `getBoundingClientRect()` reflow) on every pointermove frame
   *  is what keeps a pan a transform-only operation, per SPEC3's "no layout
   *  thrash on pan". A zoom, a pinch, the fit button and a window resize all
   *  DO change one of the two cache-key parts, so they still recompute. */
  var figureScaleCacheKey = null;
  function updateFigureScale() {
    if (!svgEl || !mapWrap) return;
    var key = view.scale.toFixed(4) + ':' + vpSize.w + ':' + vpSize.h;
    if (key === figureScaleCacheKey) return;
    figureScaleCacheKey = key;
    var t = mapTransform();
    if (!t || !t.scale) return;
    var factor = Math.max(1, Math.min(6, MIN_FIGURE_PX / (FIGURE_UNIT_HEIGHT * t.scale)));
    var pins = mapWrap.querySelectorAll('.pin-scale');
    for (var i = 0; i < pins.length; i++) pins[i].style.transform = 'scale(' + factor.toFixed(3) + ')';
  }

  function setView(scale, tx, ty, animate) {
    view.scale = scale; view.tx = tx; view.ty = ty;
    clampView(view);
    if (animate && !REDUCED_MOTION) {
      mapStage.classList.add('animated');
      applyStageTransform();
      setTimeout(function () { mapStage.classList.remove('animated'); }, 550);
    } else {
      mapStage.classList.remove('animated');
      applyStageTransform();
    }
  }

  /** Layout fix #1's other half: "the initial map fit must account for the
   *  card". Measures the LIVE `#island-panel` rect rather than hard-coding
   *  its CSS width/height here a second time — self-correcting if the panel's
   *  own CSS changes, and it naturally answers "how much room does it need
   *  right now" whether the panel is the desktop drawer, its collapsed thin
   *  tab, or the phone bottom sheet (collapsed OR expanded). Returns extra
   *  insets (screen px) to keep clear on whichever edge the panel docks to. */
  function panelReserve() {
    var r = { left: 0, right: 0, top: 0, bottom: 0 };
    var panel = document.getElementById('island-panel');
    if (!panel) return r;
    var rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return r;
    if (window.innerWidth >= 1024) r.right = Math.max(0, window.innerWidth - rect.left) + 16;
    else r.bottom = Math.max(0, window.innerHeight - rect.top) + 8;
    return r;
  }

  /** The centred "whole island, with a margin" view — the initial view, and
   *  what the ⤢ fit button returns to. Centres (and, when the reserved band
   *  eats into it, shrinks further than FIT_SCALE's own margin) within
   *  whatever's left of the viewport once panelReserve() above is subtracted,
   *  so the island's fit view sits in the UNCOVERED area rather than half
   *  behind the live panel. */
  /** The island's own extent in map units (coastline + surf), not the 1000×640
   *  map rectangle — fitting the rectangle wasted its sea margins, which left
   *  the island ~30% smaller than it needed to be on a phone. */
  var ISLAND_BOX = { x0: 130, y0: 60, x1: 900, y1: 610 };

  function fitView(animate) {
    readViewportSize();
    var res = panelReserve();
    var availW = Math.max(80, vpSize.w - res.left - res.right);
    var availH = Math.max(80, vpSize.h - res.top - res.bottom);
    var a = stageLocalOf(ISLAND_BOX.x0, ISLAND_BOX.y0), b = stageLocalOf(ISLAND_BOX.x1, ISLAND_BOX.y1);
    var boxW = Math.max(1, b.x - a.x), boxH = Math.max(1, b.y - a.y);
    var scale = 0.94 * Math.min(availW / boxW, availH / boxH);
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    var cx = res.left + availW / 2, cy = res.top + availH / 2;
    var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    var tx = cx - mid.x * scale, ty = cy - mid.y * scale;
    setView(scale, tx, ty, animate !== false);
  }

  /** Zoom so that the map point currently under viewport pixel (px,py) stays
   *  under that same pixel — the standard "zoom around the cursor" formula. */
  function zoomTo(newScale, px, py, animate) {
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    var localX = (px - view.tx) / view.scale, localY = (py - view.ty) / view.scale;
    var tx = px - localX * newScale, ty = py - localY * newScale;
    setView(newScale, tx, ty, animate);
  }

  function zoomBy(factor, px, py, animate) {
    if (px === undefined) { px = vpSize.w / 2; py = vpSize.h / 2; }
    zoomTo(view.scale * factor, px, py, animate);
  }

  /** Where SVG viewBox point (mx,my) sits within `.map-stage`'s own NATURAL
   *  (untransformed, i.e. viewport-sized) box — the same "meet" math
   *  mapTransform() uses, but against the outer viewport's raw size rather
   *  than the live (already-panned/zoomed) rect. Follow mode uses this to
   *  turn a map-unit coordinate into a pan target. */
  function stageLocalOf(mx, my) {
    var vb = svgEl.viewBox.baseVal;
    var s = Math.min(vpSize.w / vb.width, vpSize.h / vb.height);
    var offX = (vpSize.w - vb.width * s) / 2 - vb.x * s;
    var offY = (vpSize.h - vb.height * s) / 2 - vb.y * s;
    return { x: offX + mx * s, y: offY + my * s };
  }

  function panFollowTo(mx, my, animate) {
    if (!followOn || !islandViewport) return;
    var local = stageLocalOf(mx, my);
    var tx = vpSize.w / 2 - local.x * FOLLOW_SCALE;
    var ty = vpSize.h / 2 - local.y * FOLLOW_SCALE;
    setView(FOLLOW_SCALE, tx, ty, animate);
  }

  /** Any MANUAL pan/zoom turns Follow off (SPEC3: "any manual pan/zoom
   *  turns follow off") — called from every user-input entry point below,
   *  never from Follow's own programmatic setView calls. */
  function breakFollow() {
    if (followOn) setFollow(false);
  }

  function initPanZoom() {
    islandViewport = document.getElementById('island-viewport');
    mapStage = document.getElementById('map-stage');
    if (!islandViewport || !mapStage) return;
    readViewportSize();
    fitView(false);

    // ── drag to pan (mouse / one finger) + pinch to zoom (two fingers) ──
    var pointers = {}; // id -> {x,y}
    var dragStart = null; // {tx,ty,x,y} at gesture start
    var pinchStart = null; // {dist, scale, midX, midY}
    var moved = 0, downX = 0, downY = 0;
    var didDrag = false;
    // Last two pointermove samples of the CURRENT single-finger drag, each
    // {x,y,t} — just enough to estimate a release velocity for inertia
    // without a physics engine; reset at the start of every drag.
    var moveHistory = [];

    function pointerList() {
      var ids = Object.keys(pointers);
      return ids.map(function (id) { return pointers[id]; });
    }

    function pinchState(list) {
      var dist = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) || 1;
      var midX = (list[0].x + list[1].x) / 2, midY = (list[0].y + list[1].y) / 2;
      var vpRect = islandViewport.getBoundingClientRect();
      return { dist: dist, scale: view.scale, midX: midX - vpRect.left, midY: midY - vpRect.top };
    }

    islandViewport.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return; // ignore right/middle click
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      // Deliberately NO setPointerCapture here. `.island-viewport` is
      // already `position:fixed;inset:0` — the pointer can never leave it
      // mid-drag — and capturing retargets every subsequent pointer event
      // AND THE TRAILING `click` EVENT to the capturing element itself
      // (Pointer Events spec: "for … MouseEvents … dispatched during
      // pointer capture, the target … MUST be the capture target"). That
      // silently broke EVERY click on a landmark or a figure: the browser's
      // own hit-test found the right element, but the click that followed
      // was retargeted to `.island-viewport` no matter where the pointer
      // actually was. Found live by comparing a script-dispatched click
      // (bypasses capture) against a real one at the identical coordinate.
      var list = pointerList();
      if (list.length === 1) {
        dragStart = { tx: view.tx, ty: view.ty, x: e.clientX, y: e.clientY };
        moved = 0; downX = e.clientX; downY = e.clientY;
        moveHistory = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      } else if (list.length === 2) {
        dragStart = null;
        pinchStart = pinchState(list);
      }
    });

    islandViewport.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var list = pointerList();
      if (list.length >= 2) {
        var s = pinchState(list);
        if (pinchStart) {
          breakFollow();
          var factor = s.dist / pinchStart.dist;
          zoomTo(pinchStart.scale * factor, pinchStart.midX, pinchStart.midY, false);
        }
      } else if (list.length === 1 && dragStart) {
        var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
        moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
        if (moved > 6) {
          breakFollow();
          didDrag = true;
          setView(view.scale, dragStart.tx + dx, dragStart.ty + dy, false);
        }
        moveHistory.push({ x: e.clientX, y: e.clientY, t: performance.now() });
        if (moveHistory.length > 2) moveHistory.shift();
      }
    });

    /** A short, capped momentum on release (SPEC3: "inertia/momentum on
     *  release, short, capped") — velocity estimated from the drag's last
     *  two pointermove samples, then an exponential decay applied over a
     *  handful of animation frames, clamped hard so a fast fling can never
     *  fling the island out past the pan clamp in one jump. */
    function applyInertia() {
      if (REDUCED_MOTION || moveHistory.length < 2) return;
      var a = moveHistory[0], b = moveHistory[1];
      var dt = b.t - a.t;
      if (dt <= 0 || dt > 120) return; // paused before lifting — no fling intended
      var vx = Math.max(-22, Math.min(22, ((b.x - a.x) / dt) * 16)); // px per ~frame, capped
      var vy = Math.max(-22, Math.min(22, ((b.y - a.y) / dt) * 16));
      if (Math.abs(vx) < 1 && Math.abs(vy) < 1) return;
      var i = 0;
      (function step() {
        i++;
        var decay = Math.pow(0.85, i);
        setView(view.scale, view.tx + vx * decay, view.ty + vy * decay, false);
        if (i < 12 && (Math.abs(vx * decay) > 0.3 || Math.abs(vy * decay) > 0.3)) requestAnimationFrame(step);
      })();
    }

    function endPointer(e) {
      var wasSingle = Object.keys(pointers).length === 1 && pointers[e.pointerId];
      delete pointers[e.pointerId];
      var list = pointerList();
      if (list.length < 2) pinchStart = null;
      if (list.length === 0) {
        if (didDrag && wasSingle) applyInertia();
        dragStart = null;
        if (didDrag) {
          // Suppress the click that would otherwise fire on whatever the
          // pointer happens to be over after a real drag (SPEC3: "distinguish
          // a click from a drag … so landmark doors and characters still
          // open on click/tap" — the inverse case: a drag must NOT open one).
          suppressNextClick();
        }
        didDrag = false;
      } else if (list.length === 1) {
        // Dropped from a pinch back to one finger — resume panning from here.
        var only = list[0];
        dragStart = { tx: view.tx, ty: view.ty, x: only.x, y: only.y };
        moveHistory = [{ x: only.x, y: only.y, t: performance.now() }];
      }
    }
    islandViewport.addEventListener('pointerup', endPointer);
    islandViewport.addEventListener('pointercancel', endPointer);

    var clickSuppressed = false;
    function suppressNextClick() { clickSuppressed = true; }
    document.addEventListener('click', function (e) {
      if (clickSuppressed) { e.preventDefault(); e.stopPropagation(); clickSuppressed = false; }
    }, true);

    // ── wheel: mouse wheel AND trackpad pinch (reported as ctrl+wheel)
    // both zoom, centred on the cursor. ──
    islandViewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      breakFollow();
      var vpRect = islandViewport.getBoundingClientRect();
      var px = e.clientX - vpRect.left, py = e.clientY - vpRect.top;
      var delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 18; // line mode → approx pixels
      var factor = Math.exp(-delta * 0.0018);
      zoomTo(view.scale * factor, px, py, false);
    }, { passive: false });

    // ── double-click / double-tap: zoom in one step at that point ──
    islandViewport.addEventListener('dblclick', function (e) {
      breakFollow();
      var vpRect = islandViewport.getBoundingClientRect();
      zoomTo(view.scale * 1.6, e.clientX - vpRect.left, e.clientY - vpRect.top, true);
    });
    var lastTap = null;
    islandViewport.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'touch') return;
      var now = Date.now();
      var vpRect = islandViewport.getBoundingClientRect();
      var x = e.clientX - vpRect.left, y = e.clientY - vpRect.top;
      if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 32) {
        breakFollow();
        zoomTo(view.scale * 1.6, x, y, true);
        suppressNextClick();
        lastTap = null;
      } else {
        lastTap = { t: now, x: x, y: y };
      }
    });

    // ── keyboard: arrows pan, +/- zoom, 0 fits — only when nothing else
    // (a dialog, a text field) wants the keystroke. ──
    document.addEventListener('keydown', function (e) {
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      var step = 60;
      if (e.key === 'ArrowLeft') { breakFollow(); setView(view.scale, view.tx + step, view.ty, false); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { breakFollow(); setView(view.scale, view.tx - step, view.ty, false); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { breakFollow(); setView(view.scale, view.tx, view.ty + step, false); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { breakFollow(); setView(view.scale, view.tx, view.ty - step, false); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') { breakFollow(); zoomBy(1.25, undefined, undefined, true); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { breakFollow(); zoomBy(0.8, undefined, undefined, true); e.preventDefault(); }
      else if (e.key === '0') { breakFollow(); fitView(true); e.preventDefault(); }
    });

    // ── the floating +/−/fit buttons ──
    var inBtn = document.getElementById('zoom-in'), outBtn = document.getElementById('zoom-out'), fitBtn = document.getElementById('zoom-fit');
    if (inBtn) inBtn.addEventListener('click', function () { breakFollow(); zoomBy(1.3, undefined, undefined, true); });
    if (outBtn) outBtn.addEventListener('click', function () { breakFollow(); zoomBy(1 / 1.3, undefined, undefined, true); });
    if (fitBtn) fitBtn.addEventListener('click', function () { breakFollow(); fitView(true); });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { readViewportSize(); clampView(view); applyStageTransform(); updateCaptionLayout(); }, 120);
    });
  }

  // ── landmark cards: one generic dialog, populated from LOCINFO by
  // `data-landmark-key` (SPEC3 §"Landmarks") ──
  function openLandmarkCard(key) {
    var info = LOCINFO[key];
    var dlg = document.getElementById('landmark-dialog');
    if (!info || !dlg) return;
    var titleEl = document.getElementById('landmark-dialog-title');
    var bodyEl = document.getElementById('landmark-dialog-body');
    var actionsEl = document.getElementById('landmark-dialog-actions');
    if (titleEl) titleEl.textContent = info.name || '';
    if (bodyEl) bodyEl.textContent = info.blurb || '';
    if (actionsEl) {
      actionsEl.textContent = '';
      if (info.href) {
        var a = document.createElement('a');
        a.className = 'btn';
        a.href = info.href;
        a.textContent = info.hrefLabel || 'Open';
        // An internal card-to-card link (e.g. "#projects-dialog") opens the
        // other card instead of navigating; a real page link just follows.
        if (info.href.charAt(0) === '#') {
          a.addEventListener('click', function (e) { e.preventDefault(); dlg.close(); openDialog(info.href.slice(1)); });
        }
        actionsEl.appendChild(a);
      }
      (info.extra || []).forEach(function (ex) {
        var a2 = document.createElement('a');
        a2.className = 'btn secondary';
        a2.href = ex.href;
        a2.textContent = ex.label;
        if (ex.href.charAt(0) === '#') {
          a2.addEventListener('click', function (e) { e.preventDefault(); dlg.close(); openDialog(ex.href.slice(1)); });
        }
        actionsEl.appendChild(a2);
      });
    }
    openDialog('landmark-dialog');
  }

  function initLandmarks() {
    if (!mapWrap) return;
    function activate(target) {
      var key = target.getAttribute('data-landmark-key');
      if (!key) return;
      openLandmarkCard(key);
    }
    mapWrap.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-landmark]') : null;
      if (!el) return;
      e.preventDefault(); // always show the card first — the card's own primary button carries the real navigation
      activate(el);
    });
    mapWrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var el = e.target.closest ? e.target.closest('[data-landmark]') : null;
      if (!el) return;
      // A real <a> (a door) already gets Enter/Space-to-click for free from
      // the browser — that click bubbles into the handler above. Only a
      // PlainSpot's <g role="button"> (no href, nothing native) needs this.
      // (SVG keeps tag names lower-case, unlike HTML's "A" — check both.)
      if (el.tagName === 'A' || el.tagName === 'a') return;
      e.preventDefault();
      activate(el);
    });
    // tap-hold on touch devices reveals a landmark's label/glow the way
    // :hover does on a mouse (CSS handles :hover/:focus-visible on its own).
    var holdTimer = null;
    mapWrap.addEventListener('touchstart', function (e) {
      var a = e.target.closest ? e.target.closest('[data-landmark]') : null;
      if (!a) return;
      holdTimer = setTimeout(function () { a.classList.add('tapped'); }, 350);
    }, { passive: true });
    ['touchend', 'touchcancel', 'touchmove'].forEach(function (ev) {
      mapWrap.addEventListener(ev, function () {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        var all = mapWrap.querySelectorAll('.landmark.tapped');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('tapped');
      }, { passive: true });
    });
  }

  function initIsland() {
    var root = document.querySelector('.island-root');
    if (!root) return;
    islandRoot = root;
    mapWrap = root.querySelector('.map-wrap');
    badgeLayer = document.getElementById('badge-layer');
    captionCard = document.getElementById('caption-card');
    if (!mapWrap) return;
    svgEl = mapWrap.querySelector('svg');
    if (!svgEl) return;
    initFigures();
    initCaptionFromSSR();
    initPanZoom();
    initLandmarks();
    updateCaptionLayout();
  }

  /** Mirrors src/world/prompts.ts's energy/mood-word thresholds via
   *  nowWordJS (above) to keep the "now" chips current from /api/poll's
   *  world.agents, without a page reload. */
  function updateNowChips(world) {
    if (!world || !world.agents) return;
    ['kevin', 'jenny'].forEach(function (id) {
      var a = world.agents[id];
      if (!a) return;
      var el = document.getElementById('now-text-' + id);
      if (!el) return;
      var loc = LOCINFO[a.location];
      var name = id === 'kevin' ? 'Kevin' : 'Jenny';
      el.textContent = name + ' — ' + (loc ? loc.short : a.location) + ' · ' + a.activity + ' · ' + nowWordJS(a);
      var chip = document.getElementById('now-chip-' + id);
      if (chip) chip.setAttribute('aria-label', name + ' — at ' + (loc ? loc.name : a.location) + ', ' + a.activity + ', ' + nowWordJS(a) + '. Open their character card');
    });
  }

  function updateWeather(world) {
    if (!mapWrap || !world) return;
    mapWrap.setAttribute('data-slot', world.slot);
    mapWrap.setAttribute('data-weather', world.weather.kind);
    mapWrap.setAttribute('data-tide', world.tide);
    // `.island-root` carries its OWN copy of `data-slot`/`data-weather`
    // (layout fix #2, and the ocean-layer's weather-reactive waves) — a CSS
    // custom property only cascades to DESCENDANTS, and `.island-root` is
    // an ANCESTOR of `.map-wrap`, so the sea-tint variables it sets from
    // `data-slot` (app.css) would never reach `.island-root`'s own
    // background if only `.map-wrap` carried it; the fixed `.ocean-layer`
    // is a SIBLING of `.map-wrap`, not a descendant of it at all, so its
    // own `[data-weather]`-scoped wave rules need `.island-root`'s copy
    // for the exact same reason.
    if (islandRoot) {
      islandRoot.setAttribute('data-slot', world.slot);
      islandRoot.setAttribute('data-weather', world.weather.kind);
    }
    var status = document.getElementById('hero-status');
    if (status) {
      var slotLabel = world.slot.charAt(0).toUpperCase() + world.slot.slice(1);
      status.textContent = 'Day ' + world.day + ' · ' + slotLabel + ' · ' + (world.weather.line || '') + ' · tide ' + world.tide;
    }
    updateNowChips(world);
  }

  // ── the live panel: bottom sheet (phone) / floating card (desktop) ──
  function initPanel() {
    var panel = document.getElementById('island-panel');
    var handle = document.getElementById('panel-handle');
    var collapseBtn = document.getElementById('panel-collapse-btn');
    if (!panel) return;
    if (handle) {
      handle.addEventListener('click', function () {
        var open = panel.getAttribute('data-expanded') === 'true';
        var next = !open;
        panel.setAttribute('data-expanded', next ? 'true' : 'false');
        handle.setAttribute('aria-expanded', next ? 'true' : 'false');
        // On phones the caption card docks directly above the COLLAPSED
        // sheet (item A) — an expanded sheet already shows every turn in
        // full, so the floating card steps aside rather than fighting it
        // for the same strip of screen.
        if (captionCard) captionCard.classList.toggle('panel-expanded', next);
      });
    }
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () {
        var collapsed = panel.getAttribute('data-collapsed') === 'true';
        panel.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
        collapseBtn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
        collapseBtn.textContent = collapsed ? '«' : '»';
        // Collapsing the desktop dock frees up the caption card's reserved
        // width — re-measure (updateCaptionLayout reads the panel's live
        // rect, so a collapsed 44px tab vs. the full 360px card both just
        // fall out of the same measurement).
        updateCaptionLayout();
      });
    }
  }

  // ── polling ──
  function initPoll() {
    var root = document.querySelector('[data-poll-root]');
    if (!root) return;
    var scene = document.getElementById('live-scene');
    var presence = document.getElementById('presence-line');
    // The last turn id rides on the root's data attribute (it used to be a
    // hidden <input>, which accessibility checkers read as an unnamed control).
    var since = parseInt(root.getAttribute('data-latest-turn-id') || '0', 10) || 0;
    var timer = null;

    function schedule(ms) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    }

    function turnsBoxFor(speaker, sceneMode) {
      if (sceneMode === 'apart') return document.getElementById('scene-turns-' + speaker);
      return document.getElementById('scene-turns');
    }

    function poll() {
      if (document.hidden) { schedule(POLL_HIDDEN_MS); return; }
      fetch('/api/poll?since=' + since, { headers: { accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) { schedule(POLL_VISIBLE_MS); return; }
          if (data.world && !mapWrap) {
            // The island just started — this page rendered the "hasn't woken
            // up yet" empty state, which has no map to update.
            window.location.reload();
            return;
          }
          if (data.world) updateWeather(data.world);

          if (data.world && data.world.scene && !scene) {
            // A new scene opened while this page was showing "between
            // scenes" (no #live-scene element to update piecemeal).
            window.location.reload();
            return;
          }

          if (data.world && data.world.scene && scene && scene.getAttribute('data-scene-id') !== data.world.scene.id) {
            // Scene boundary crossed — the server-rendered card (setup, turn
            // target, character cards, timeline, apart tracks) is stale; a
            // reload is the simplest correct way to pick up the new scene.
            window.location.reload();
            return;
          }

          if (data.new_turns && data.new_turns.length) {
            var sceneMode = data.world && data.world.scene ? data.world.scene.mode : 'together';
            data.new_turns.forEach(function (t) {
              var box = turnsBoxFor(t.speaker, t.mode || sceneMode);
              if (box) appendTurn(box, t);
              updatePanelPeek(t);
              enqueueTurn(t);
            });
            since = data.latest_turn_id || since;
            if (presence && data.world && sceneMode !== 'apart') {
              var last = data.new_turns[data.new_turns.length - 1];
              var next = last.speaker === 'kevin' ? 'jenny' : 'kevin';
              presence.innerHTML = '<span class="presence-dot"></span> Waiting for ' + agentName(next) + '…';
            }
          }
          schedule(POLL_VISIBLE_MS);
        })
        .catch(function () { schedule(POLL_VISIBLE_MS * 2); });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) schedule(200);
    });

    schedule(POLL_VISIBLE_MS);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initThoughtsToggle();
    initMapThoughtsToggle();
    initFollowToggle();
    refreshRelativeTimes();
    setInterval(refreshRelativeTimes, 30000);
    initDialogs();
    initMenuAria();
    initPanel();
    initPoll();
    initBottleForms();
    initIsland();
    initHowTo();
  });
})();
