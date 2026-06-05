// Client-side interactivity for Living Core
// Tab switching, inbox submission, auto-polling with typing animation

(function () {
  'use strict';

  // ── Tab Switching ──

  window.switchTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(function (el) {
      el.classList.add('hidden');
    });
    var target = document.getElementById('tab-' + tabId);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('[id^="tab-btn-"]').forEach(function (btn) {
      btn.className = 'flex-1 text-center py-2.5 text-xs font-medium border-b-2 border-transparent text-[#71767b] hover:text-[#e7e9ea]';
    });
    var activeBtn = document.getElementById('tab-btn-' + tabId);
    if (activeBtn) {
      activeBtn.className = 'flex-1 text-center py-2.5 text-xs font-medium border-b-2 border-[#71767b] text-[#e7e9ea]';
    }
  };

  // ── Floating popups (note / about) ──

  window.openModal = function (id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('hidden');
    m.style.display = 'flex';
    if (id === 'note-modal') {
      var input = document.getElementById('inbox-input');
      if (input) setTimeout(function () { input.focus(); }, 50);
    }
  };

  window.closeModal = function (id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'none';
  };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(function (m) {
        m.style.display = 'none';
      });
    }
  });

  // ── Toggle Reasoning ──

  window.toggleThoughts = function (btn) {
    var container = btn.parentElement;
    var thoughts = container.querySelector('.thoughts-content');
    if (thoughts) {
      var hidden = thoughts.classList.contains('hidden');
      thoughts.classList.toggle('hidden');
      btn.textContent = hidden ? '🔍 hide reasoning' : '🔍 show reasoning';
    }
  };

  // ── Inbox Submission ──

  window.submitInbox = async function () {
    var input = document.getElementById('inbox-input');
    var nameInput = document.getElementById('inbox-name');
    var submitBtn = document.getElementById('inbox-submit');
    var feedback = document.getElementById('inbox-feedback');
    var text = (input && input.value.trim()) || '';
    var userName = (nameInput && nameInput.value.trim()) || '';

    if (!text) {
      input && input.focus();
      return;
    }

    submitBtn && (submitBtn.disabled = true);
    submitBtn && (submitBtn.textContent = 'Sending...');

    var payload = { content: text, author: 'web' };
    if (userName) {
      payload.author = userName;
    }

    try {
      var resp = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await resp.json();

      if (data.success) {
        input && (input.value = '');
        if (feedback) {
          var msg = userName
            ? '💌 Thanks ' + userName + ' — your note is on its way to Kevin & Jenny.'
            : '💌 Your note is on its way to Kevin & Jenny.';
          feedback.textContent = msg;
          feedback.classList.remove('hidden');
          // Let them see the confirmation, then close the popup
          setTimeout(function () {
            feedback.classList.add('hidden');
            if (window.closeModal) window.closeModal('note-modal');
          }, 2200);
        }
      } else {
        showError(feedback, 'Failed to send. Try again?');
      }
    } catch (err) {
      showError(feedback, 'Network error. Check your connection.');
    }

    submitBtn && (submitBtn.disabled = false);
    submitBtn && (submitBtn.textContent = 'Send note');
  };

  function showError(el, msg) {
    if (!el) return;
    el.textContent = '⚠ ' + msg;
    el.classList.remove('hidden');
    el.style.color = '#ff6b9d';
    setTimeout(function () {
      el.classList.add('hidden');
      el.style.color = '';
    }, 5000);
  }

  // ── Enter key to submit inbox ──

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      var input = document.getElementById('inbox-input');
      var feedback = document.getElementById('inbox-feedback');
      if (input && document.activeElement === input && !feedback.classList.contains('hidden')) {
        window.submitInbox();
      }
    }
  });

  // ── Typing Animation ──

  // Reveal the on-load "Now" messages by reusing the server-rendered elements
  // (so there's no duplicate). Older ones fade in quickly; the newest types out.
  async function animateTurns(container) {
    if (!container) return;
    var turnEls = Array.prototype.slice.call(container.children);
    if (turnEls.length === 0) return;

    // Hide all first
    turnEls.forEach(function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
    });

    // Newest is at the TOP (index 0). Reveal from the bottom (oldest) upward so the
    // newest message types in last, right where the eye rests.
    for (var i = turnEls.length - 1; i >= 0; i--) {
      var el = turnEls[i];
      var isNewest = (i === 0);

      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';

      if (isNewest) {
        // Sync the top bar to whoever speaks this (newest) line while it types
        updateAgentStatus(el.getAttribute('data-speaker'));
        var p = el.querySelector('p');
        if (p) {
          await typeText(p, p.textContent || '', 14);
        }
        await sleep(200);
      } else {
        await sleep(180);
      }
    }
    // Settled — nobody is actively typing now
    setAgentsIdle();
  }

  // ── Auto-Polling: check for new dialogue turns every 5 seconds ──

  var lastTurnId = 0;
  var isAnimating = false;

  // Re-render server timestamps (UTC) into the viewer's local time, consistently
  // with live turns.
  function normalizeTurnTimes() {
    document.querySelectorAll('.turn-time[data-ts]').forEach(function (el) {
      var t = formatTime(el.getAttribute('data-ts'));
      if (t) el.textContent = t;
    });
  }

  // Read initial state from page
  async function initPolling() {
    var timeline = document.getElementById('dialogue-timeline');
    if (timeline) {
      var turnId = parseInt(timeline.getAttribute('data-latest-turn-id') || '0');
      lastTurnId = turnId;
    }

    normalizeTurnTimes();

    // Animate the initially loaded turns (reuses the SSR elements — no duplicates)
    var nowContainer = document.getElementById('now-turns-container');
    if (nowContainer) {
      isAnimating = true;
      // Hide immediately to avoid a flash, then reveal/type them in
      Array.prototype.slice.call(nowContainer.children).forEach(function (el) {
        el.style.opacity = '0';
      });
      await sleep(300);
      await animateTurns(nowContainer);
      isAnimating = false;
    }

    // Then start polling for genuinely new turns
    pollLoop();
  }

  function pollLoop() {
    // Only poll if not currently animating
    var pollDelay = isAnimating ? 12000 : 5000;

    setTimeout(function () {
      pollForUpdates();
    }, pollDelay);
  }

  async function pollForUpdates() {
    try {
      var resp = await fetch('/api/poll?since=' + lastTurnId);
      var data = await resp.json();

      if (data && data.new_turns && data.new_turns.length > 0) {
        // Update vital stats
        updateVitalStats(data);

        // Add new turns to the "Now" section with animation
        if (data.new_turns.length > 0) {
          // Update latest turn ID
          var maxId = data.new_turns[data.new_turns.length - 1].id;
          if (maxId > lastTurnId) {
            lastTurnId = maxId;
          }

          // Append new turns to the NOW feed
          var nowContainer = document.getElementById('now-turns-container');
          var timeline = document.getElementById('dialogue-timeline');

          if (nowContainer && data.new_turns.length > 0) {
            isAnimating = true;

            // Update timeline data attribute
            if (timeline) {
              timeline.setAttribute('data-turn-count', String(data.dialogue_turns));
            }

            // Show new turns one by one with typing effect (feed trims to last 5)
            await showNewTurnsOneByOne(nowContainer, data.new_turns);

            isAnimating = false;
          }
        }
      }
    } catch (err) {
      // Silent fail — polling will retry next cycle
    }

    pollLoop();
  }

  function updateVitalStats(data) {
    // Update packet count
    if (data.packet_count !== undefined) {
      var pktsEl = document.getElementById('vital-packets');
      if (pktsEl) pktsEl.textContent = data.packet_count;
    }
    // Update turn count in header
    if (data.dialogue_turns !== undefined) {
      var turnsEl = document.getElementById('vital-turns');
      if (turnsEl) turnsEl.textContent = data.dialogue_turns;
    }
    // Update coherence
    if (data.coherence !== undefined) {
      var cohEl = document.getElementById('vital-coherence');
      if (cohEl) cohEl.textContent = Math.round(data.coherence * 100) + '%';
    }
  }

  // ── Show new turns one by one with typing animation ──

  async function showNewTurnsOneByOne(container, turns) {
    // turns arrive oldest→newest. We PREPEND each at the top, so the newest ends up
    // on top and older ones flow downward (like a live feed you never have to scroll).
    for (var i = 0; i < turns.length; i++) {
      var turn = turns[i];
      var turnEl = createTurnElement(turn, i);

      // Insert at the TOP (hidden initially), coming down from above
      turnEl.style.opacity = '0';
      turnEl.style.transform = 'translateY(-8px)';
      turnEl.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
      container.insertBefore(turnEl, container.firstChild);

      // Keep the live feed to the last 5 messages — drop the oldest (bottom)
      trimContainer(container, 5);

      // Update agent status bar to show who's speaking
      updateAgentStatus(turn.speaker);

      // If this message carries a gesture (flowers, a heart...), float it at the top
      maybeFloatGesture(turn.content);

      // Trigger reflow for CSS transition
      turnEl.offsetHeight;

      // Settle the bubble in
      turnEl.style.opacity = '1';
      turnEl.style.transform = 'translateY(0)';

      // Then type the message out, character by character
      var contentEl = turnEl.querySelector('.turn-content');
      await typeText(contentEl, turn.content || '', 14);

      // Small breath before the next person replies
      await sleep(1400);
    }
    // Done typing this batch — nobody is speaking now
    setAgentsIdle();
  }

  // Keep only the last `max` turn elements — newest is on top, so drop from the bottom
  function trimContainer(container, max) {
    while (container.children.length > max) {
      container.removeChild(container.lastChild);
    }
  }

  // ── Gesture floats — when Kevin or Jenny sends the other something ──
  var GESTURE_EMOJIS = ['💐', '🌹', '❤️', '💕', '💖', '☕', '🍷', '🎁', '💋', '🌸', '🫶', '💝', '🍫'];

  function maybeFloatGesture(content) {
    if (!content) return;
    for (var i = 0; i < GESTURE_EMOJIS.length; i++) {
      if (content.indexOf(GESTURE_EMOJIS[i]) >= 0) {
        floatGesture(GESTURE_EMOJIS[i]);
        return;
      }
    }
  }

  function floatGesture(emoji) {
    var layer = document.getElementById('gesture-layer');
    if (!layer) return;
    var el = document.createElement('div');
    el.className = 'gesture-float';
    el.textContent = emoji;
    layer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3600);
  }

  // Typewriter effect — types `text` into `el` one character at a time.
  // Uses textContent (safe) and code-point splitting so emojis don't flicker as
  // broken glyphs mid-type.
  function typeText(el, text, speed) {
    return new Promise(function (resolve) {
      if (!el) { resolve(); return; }
      var chars = Array.from(text || '');
      var i = 0;
      el.textContent = '';
      var cursor = document.createElement('span');
      cursor.className = 'type-cursor animate-pulse';
      cursor.style.opacity = '0.7';
      cursor.textContent = '▍';
      el.appendChild(cursor);
      var iv = setInterval(function () {
        i++;
        el.textContent = chars.slice(0, i).join('');
        el.appendChild(cursor);
        if (i >= chars.length) {
          clearInterval(iv);
          if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
          resolve();
        }
      }, speed);
    });
  }

  // Builds a live turn with the EXACT same markup/style as the server-rendered
  // CompactDialogueTurn (left accent bar, name + husband/wife + time, reasoning
  // toggle) so the feed is one consistent chat — not two different looks.
  function createTurnElement(turn, index) {
    var speaker = turn.speaker || 'kevin';
    var isKevin = speaker === 'kevin';
    var color = isKevin ? '#4ecdc4' : '#ff6b9d';
    var name = isKevin ? 'Kevin' : 'Jenny';
    var badge = isKevin ? 'husband' : 'wife';
    var iso = turn.created_at || '';
    var timeText = iso ? formatTime(iso) : '';
    var thoughts = turn.thoughts || turn.thought_process || '';

    var div = document.createElement('div');
    div.className = 'dialogue-turn-turn';
    div.setAttribute('data-speaker', speaker);
    div.style.borderLeft = '2px solid ' + color;
    div.style.paddingLeft = '8px';

    var html =
      '<div class="flex items-center gap-1.5 mb-1">' +
        '<span class="text-[10px] font-semibold" style="color:' + color + '">' + name + '</span>' +
        '<span class="text-[9px] text-[#71767b]">' + badge + '</span>' +
        '<span class="text-[9px] text-[#71767b] turn-time" data-ts="' + escapeHtml(iso) + '">' + timeText + '</span>' +
      '</div>' +
      '<p class="text-xs text-[#b0b3b8] leading-relaxed turn-content"></p>';
    if (thoughts) {
      html +=
        '<button onclick="toggleThoughts(this)" class="text-[9px] text-[#71767b] hover:text-[#e7e9ea] mt-1">🔍 show reasoning</button>' +
        '<div class="thoughts-content mt-1 hidden"><p class="text-[10px] text-[#71767b] italic leading-relaxed whitespace-pre-wrap">' + escapeHtml(thoughts) + '</p></div>';
    }
    div.innerHTML = html;
    return div;
  }

  // Sync the top status bar to whoever is currently typing.
  function updateAgentStatus(activeSpeaker) {
    setAgentState('kevin', activeSpeaker === 'kevin', '#4ecdc4');
    setAgentState('jenny', activeSpeaker === 'jenny', '#ff6b9d');
    var divider = document.getElementById('agent-divider');
    if (divider) divider.textContent = activeSpeaker === 'kevin' ? '►' : (activeSpeaker === 'jenny' ? '◄' : '↔');
  }

  // Nobody is typing right now → both listening.
  function setAgentsIdle() {
    setAgentState('kevin', false, '#4ecdc4');
    setAgentState('jenny', false, '#ff6b9d');
    var divider = document.getElementById('agent-divider');
    if (divider) divider.textContent = '↔';
  }

  function thinkingBarsHtml(color) {
    var bar = '<span class="thinking-bar" style="display:inline-block;width:2px;height:9px;background:' + color + '"></span>';
    return '<span class="inline-flex items-end gap-0.5">' + bar + bar + bar + '</span>';
  }

  function setAgentState(who, speaking, color) {
    var status = document.getElementById(who + '-status');
    if (status) {
      if (speaking) {
        var word = '<span class="text-[10px] font-medium" style="color:' + color + '">speaking</span>';
        var bars = thinkingBarsHtml(color);
        // Jenny's row is right-aligned (bars before word); Kevin's is word before bars.
        status.innerHTML = (who === 'jenny') ? (bars + ' ' + word) : (word + ' ' + bars);
      } else {
        status.innerHTML = '<span class="text-[10px] text-[#71767b]">listening</span>';
      }
    }
    var ind = document.getElementById(who + '-indicator');
    if (ind) {
      if (speaking) {
        ind.classList.add('active');
        ind.style.borderBottom = '2px solid ' + color;
        ind.style.paddingBottom = '2px';
      } else {
        ind.classList.remove('active');
        ind.style.borderBottom = '';
        ind.style.paddingBottom = '';
      }
    }
  }

  function getAgentSvg(speaker, size) {
    if (speaker === 'jenny') {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" stroke="#ff6b9d" stroke-width="2" fill="#1a1f2e"/><circle cx="17" cy="19" r="4" fill="#ff6b9d" opacity="0.9"/><circle cx="31" cy="19" r="4" fill="#ff6b9d" opacity="0.9"/><path d="M14 32 Q24 40 34 32" stroke="#ff6b9d" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" fill="none"><rect x="3" y="3" width="42" height="42" rx="8" stroke="#4ecdc4" stroke-width="2" fill="#1a1f2e"/><circle cx="17" cy="19" r="4" fill="#4ecdc4" opacity="0.9"/><circle cx="31" cy="19" r="4" fill="#4ecdc4" opacity="0.9"/><path d="M14 32 Q24 40 34 32" stroke="#4ecdc4" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';
  }

  // ── Utilities ──

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatTime(dateStr) {
    try {
      if (!dateStr) return '';
      // D1 timestamps look like "2026-06-05 10:54:00" (UTC, no zone marker).
      // Normalize so the browser parses them as UTC, then show in the viewer's local time.
      var s = String(dateStr).trim();
      if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
      if (!/(Z|[+\-]\d\d:?\d\d)$/.test(s)) s += 'Z';
      var d = new Date(s);
      if (isNaN(d.getTime())) return '';
      var hours = d.getHours();
      var mins = d.getMinutes();
      var ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      return hours + ':' + (mins < 10 ? '0' : '') + mins + ' ' + ampm;
    } catch (e) {
      return '';
    }
  }

  // ── Start ──

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPolling);
  } else {
    initPolling();
  }

})();
