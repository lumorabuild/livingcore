// Client-side interactivity for Living Core
// Handles typing animation, tab switching, inbox submission, live polling

(function () {
  'use strict';

  // ── Tab Switching ──

  window.switchTab = function (tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(function (el) {
      el.classList.add('hidden');
    });
    // Show target
    var target = document.getElementById('tab-' + tabId);
    if (target) target.classList.remove('hidden');

    // Update tab button styles
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

  // ── Suggest Thought (from chip buttons) ──

  window.suggestThought = function (text) {
    var input = document.getElementById('inbox-input');
    if (input) {
      input.value = text;
      input.focus();
    }
  };

  // ── Inbox Submission (with optional name) ──

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
        // Poll to refresh dialogue
        setTimeout(function () {
          window.location.reload();
        }, 3000);
      } else {
        if (feedback) {
          feedback.textContent = 'Error: ' + (data.error || 'Unknown');
          feedback.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (feedback) {
        feedback.textContent = 'Network error. Try again.';
        feedback.classList.remove('hidden');
      }
    } finally {
      submitBtn && (submitBtn.disabled = false);
      submitBtn && (submitBtn.textContent = 'Drop Idea');
    }
  };

  // ── Live Polling (every 15s) ──

  var POLL_INTERVAL = 15000;
  var pollTimer = null;

  function startPolling() {
    pollTimer = setInterval(pollState, POLL_INTERVAL);
  }

  async function pollState() {
    try {
      var resp = await fetch('/api/state');
      var result = await resp.json();
      if (!result.success || !result.data) return;

      var s = result.data;

      // Update vital stats
      var packetsEl = document.getElementById('vital-packets');
      var turnsEl = document.getElementById('vital-turns');
      var coherenceEl = document.getElementById('vital-coherence');

      if (packetsEl) packetsEl.textContent = (s.packets && s.packets.length) || s.total_interactions || '0';
      if (turnsEl) turnsEl.textContent = s.dialogue_turns || '0';
      if (coherenceEl && s.system_state && s.system_state.avg_coherence) {
        coherenceEl.textContent = Math.round(parseFloat(s.system_state.avg_coherence) * 100) + '%';
      }

      // Update inbox badge
      var inboxBadge = document.querySelector('.inbox-badge');
      if (inboxBadge && s.pending_inbox) {
        inboxBadge.textContent = s.pending_inbox;
      }
    } catch (err) {
      // Silent fail on poll
    }
  }

  // ── Init ──

  // Start polling after initial render
  if (document.readyState === 'complete') {
    startPolling();
  } else {
    window.addEventListener('load', startPolling);
  }

})();
