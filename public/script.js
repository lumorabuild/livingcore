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
      btn.className = 'flex-1 text-center py-3 text-sm font-medium border-b-2 border-transparent text-[#71767b] hover:text-[#e7e9ea]';
    });
    var activeBtn = document.getElementById('tab-btn-' + tabId);
    if (activeBtn) {
      activeBtn.className = 'flex-1 text-center py-3 text-sm font-medium border-b-2 border-[#71767b] text-[#e7e9ea]';
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
    var submitBtn = document.getElementById('inbox-submit');
    var feedback = document.getElementById('inbox-feedback');
    var text = (input && input.value.trim()) || '';

    if (!text) {
      input && input.focus();
      return;
    }

    submitBtn && (submitBtn.disabled = true);
    submitBtn && (submitBtn.textContent = 'Sending...');

    try {
      var resp = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, author: 'web' })
      });
      var data = await resp.json();

      if (data.success) {
        input && (input.value = '');
        if (feedback) {
          feedback.textContent = '✨ Kevin & Jenny are discussing your idea...';
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

  window.suggestThought = function (thought) {
    var input = document.getElementById('inbox-input');
    if (input) {
      input.value = thought;
      input.focus();
    }
  };

  // ── Typing Animation for Recent Turns ──

  function animateTyping() {
    var turns = document.querySelectorAll('.dialogue-turn p');
    // Only animate the last 2-3 turns
    var recent = Array.prototype.slice.call(turns).slice(-3);
    recent.forEach(function (el, idx) {
      var text = el.textContent;
      if (el.dataset.animated) return;
      el.dataset.animated = 'true';
      el.textContent = '';
      var i = 0;
      var iv = setInterval(function () {
        if (i < text.length) {
          el.textContent += text[i];
          i++;
        } else {
          clearInterval(iv);
        }
      }, 15 + idx * 5);
    });
  }

  // Run typing animation on load
  animateTyping();

  // ── Live Polling (every 10 seconds) ──

  setInterval(function () {
    fetch('/api/state')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) return;
        var s = data.data;
        var ss = s.system_state || {};

        // Packet count: use array length
        var el = document.getElementById('vital-packets');
        if (el) el.textContent = (s.packets && s.packets.length) || '0';

        // Turn count from system_state
        var turnsEl = document.getElementById('vital-turns');
        if (turnsEl) turnsEl.textContent = ss.total_dialogue_turns || '0';

        // Coherence percentage
        var cohEl = document.getElementById('vital-coherence');
        if (cohEl && ss.avg_coherence) {
          var pct = Math.round(parseFloat(ss.avg_coherence) * 100);
          cohEl.textContent = pct + '%';
        }

        // RSS count from rss_stats
        var rssEl = document.getElementById('vital-rss');
        if (rssEl && s.rss_stats && s.rss_stats.total) rssEl.textContent = s.rss_stats.total;
      })
      .catch(function () { /* silent */ });
  }, 10000);

  // ── Enter key submits inbox ──
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      var input = document.getElementById('inbox-input');
      if (input && document.activeElement === input) {
        e.preventDefault();
        window.submitInbox();
      }
    }
  });

})();
