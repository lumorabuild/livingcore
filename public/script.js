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
            ? '✨ ' + userName + ' — Kevin & Jenny are discussing your idea...'
            : '✨ Kevin & Jenny are discussing your idea...';
          feedback.textContent = msg;
          feedback.classList.remove('hidden');
          setTimeout(function () {
            feedback.classList.add('hidden');
          }, 4000);
        }
      } else {
        showError(feedback, 'Failed to send. Try again?');
      }
    } catch (err) {
      showError(feedback, 'Network error. Check your connection.');
    }

    submitBtn && (submitBtn.disabled = false);
    submitBtn && (submitBtn.textContent = 'Drop Idea');
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

  // Reveal turns one by one with a delay
  function animateTurns(container) {
    if (!container) return;
    var turnEls = container.querySelectorAll('.dialogue-turn');
    if (turnEls.length === 0) return;

    // Hide all turns first
    turnEls.forEach(function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    });

    // Reveal one by one
    var delay = 6000; // 3 seconds between each turn (including typing sim + pause)
    turnEls.forEach(function (el, i) {
      setTimeout(function () {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, i * delay + 500); // 500ms initial delay, then 6s between turns
    });

    return turnEls.length * delay + 1000; // Total animation duration
  }

  // ── Auto-Polling: check for new dialogue turns every 5 seconds ──

  var lastTurnId = 0;
  var isAnimating = false;

  // Read initial state from page
  function initPolling() {
    var timeline = document.getElementById('dialogue-timeline');
    if (timeline) {
      var turnId = parseInt(timeline.getAttribute('data-latest-turn-id') || '0');
      lastTurnId = turnId;
    }

    // Start typing animation for initially loaded turns
    var nowContainer = document.getElementById('now-turns-container');
    if (nowContainer) {
      // Delay initial animation so the page loads first
      setTimeout(function () {
        animateTurns(nowContainer);
      }, 2000);
    }

    // Start polling
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

          // Append new turns to NOW section
          var nowContainer = document.getElementById('now-turns-container');
          var turnCountEl = document.getElementById('now-turn-count');
          var timeline = document.getElementById('dialogue-timeline');

          if (nowContainer && data.new_turns.length > 0) {
            isAnimating = true;

            // Update turn count in the header
            if (turnCountEl) {
              var currentCount = nowContainer.querySelectorAll('.dialogue-turn').length;
              turnCountEl.textContent = (currentCount + data.new_turns.length) + ' turns';
            }

            // Update timeline data attribute
            if (timeline) {
              timeline.setAttribute('data-turn-count', String(data.dialogue_turns));
            }

            // Show new turns one by one with typing effect
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
    for (var i = 0; i < turns.length; i++) {
      var turn = turns[i];
      var turnEl = createTurnElement(turn, i);

      // Append to container (hidden initially)
      turnEl.style.opacity = '0';
      turnEl.style.transform = 'translateY(8px)';
      turnEl.style.transition = 'opacity 0.8s ease-out, transform 0.8s ease-out';
      container.appendChild(turnEl);

      // Update agent status bar to show who's speaking
      updateAgentStatus(turn.speaker);

      // Trigger reflow for CSS transition
      turnEl.offsetHeight;

      // Fade in with 1.5s transition
      turnEl.style.opacity = '1';
      turnEl.style.transform = 'translateY(0)';

      // Wait for turn to display before showing the next one
      await sleep(5000); // 5 seconds between turns
    }
  }

  function createTurnElement(turn, index) {
    var speaker = turn.speaker || 'kevin';
    var isKevin = speaker === 'kevin';
    var faceSize = 32;
    var color = isKevin ? '#4ecdc4' : '#ff6b9d';
    var name = isKevin ? 'Kevin' : 'Jenny';
    var badge = isKevin ? 'Grounder' : 'Weaver';
    var createdAt = turn.created_at ? formatTime(turn.created_at) : '';

    var div = document.createElement('div');
    div.className = 'dialogue-turn';
    div.style.animationDelay = '0s';

    div.innerHTML =
      '<div class="flex items-start gap-2 mb-2 pt-2 border-t border-[#2f3336] first:border-0">' +
        '<div class="flex-shrink-0 mt-0.5" style="width:' + faceSize + 'px;height:' + faceSize + 'px;">' +
          getAgentSvg(speaker, faceSize) +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-1.5 mb-1">' +
            '<span class="text-xs font-semibold" style="color:' + color + '">' + name + '</span>' +
            '<span class="text-[9px] text-[#71767b] bg-[#2f3336] px-1.5 py-0.5 rounded-full">' + badge + '</span>' +
            '<span class="text-[10px] text-[#71767b] ml-auto">' + createdAt + '</span>' +
          '</div>' +
          '<div class="text-xs text-[#e7e9ea] leading-relaxed">' + escapeHtml(turn.content) + '</div>' +
        '</div>' +
      '</div>';

    return div;
  }

  function updateAgentStatus(activeSpeaker) {
    var isKevin = activeSpeaker === 'kevin';

    // Update the agent bar speaking indicators
    var kevinStatus = document.querySelector('.flex.items-center.gap-1.mt-0\\.5');
    // Simple approach: update via the agent bar structure
    // The agent bar is re-rendered on full page load, so this is a best-effort update
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
      var d = new Date(dateStr);
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
