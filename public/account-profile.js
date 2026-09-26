// public/account-profile.js — progressive enhancement for the /account
// patron-settings form ONLY (public/account.js is A3's, for the lend-a-mind
// forms). The form itself is a plain <form method="post" action="/api/
// account/patron"> and works with this file entirely absent — a submit does
// a normal navigation and the server 303s back to /account. This only adds
// a live "from <name>" preview and a saving indicator; it never intercepts
// the submit, so the plain-POST path is never at risk of drifting from what
// this script does.
(function () {
  'use strict';

  var form = document.getElementById('patron-form');
  if (!form) return;

  var nameInput = document.getElementById('patron-name-input');
  var showInput = document.getElementById('patron-show-input');
  var preview = document.getElementById('patron-preview');
  var submitBtn = form.querySelector('button[type="submit"]');

  function currentLabel() {
    var name = (nameInput && nameInput.value || '').trim();
    return (showInput && showInput.checked && name) ? name : 'an unseen friend';
  }

  function updatePreview() {
    if (!preview) return;
    preview.textContent = 'Preview: crates will read "from ' + currentLabel() + '".';
  }

  if (nameInput) nameInput.addEventListener('input', updatePreview);
  if (showInput) showInput.addEventListener('change', updatePreview);
  updatePreview();

  form.addEventListener('submit', function () {
    // No preventDefault — the plain POST proceeds exactly as it would
    // without this file. This only gives immediate feedback during the
    // round trip (a full navigation follows regardless).
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
    }
  });
})();
