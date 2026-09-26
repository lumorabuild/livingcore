// public/account.js — lend-a-mind (SPEC4 §A3). Client for the /account page
// ONLY: the donation list (fetched, never baked into the server-rendered
// HTML — src/views/account/donations.tsx's container starts empty) and the
// add/pause/resume/revoke/edit-limits actions.
//
// The add form itself already works with this file entirely absent — it's a
// plain <form method="post" action="/api/account/donations">, so a submit
// with JS off does a normal navigation and the server redirects back to
// /account with a notice. This file only upgrades that submit to stay on the
// page, and renders the list nobody can see without it.
//
// Rules this file follows throughout: the key field is never read back or
// echoed (only key_preview from the API, already masked server-side); every
// piece of server/model/patron text lands via textContent, never innerHTML —
// nothing here ever interpolates a string into markup.
(function () {
  'use strict';

  var list = document.getElementById('lend-a-mind-list');
  var form = document.getElementById('donation-form');
  if (!list && !form) return; // signed out / feature disabled — the section is empty

  var msg = document.getElementById('donation-form-msg');
  var providerSelect = document.getElementById('donation-provider');
  var modelInput = document.getElementById('donation-model');

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        if (k === 'class') e.className = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) return;
      e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return e;
  }

  function fmt(n) {
    try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); }
  }

  var STATUS_LABEL = {
    active: 'active',
    paused: 'paused',
    paused_errors: 'paused — repeated errors',
    revoked: 'revoked',
  };

  var ROLE_LABEL = { kevin: 'Kevin', jenny: 'Jenny', narrator: 'the narrator' };

  async function api(path, opts) {
    var res = await fetch(path, Object.assign({
      headers: Object.assign({ 'Accept': 'application/json' }, (opts && opts.json) ? { 'Content-Type': 'application/json' } : {}),
      credentials: 'same-origin',
    }, opts || {}));
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, data: data };
  }

  function postJson(path, body) {
    return api(path, { method: 'POST', json: true, body: JSON.stringify(body || {}) });
  }

  function renderRow(d) {
    var statusText = STATUS_LABEL[d.status] || d.status;
    var header = el('strong', null, [ROLE_LABEL[d.role] || d.role]);
    var sub = el('span', { class: 'muted' }, [
      ' · ' + d.provider + ' · ' + d.model + ' · ' + d.key_preview + ' · ' + statusText,
    ]);

    var usage = el('div', { class: 'muted' }, [
      'Today: ' + fmt(d.calls_today) + ' / ' + fmt(d.calls_per_day) + ' calls, ' +
      fmt(d.tokens_today) + ' / ' + fmt(d.tokens_per_day) + ' tokens.',
    ]);

    var children = [el('div', null, [header, sub]), usage];

    if (d.last_error) {
      children.push(el('div', { class: 'muted' }, ['Last error: ' + d.last_error]));
    }

    var actions = el('div', { style: 'margin-top:.35em;' }, []);

    if (d.status === 'active') {
      actions.appendChild(actionButton('Pause', function () { return postJson('/api/account/donations/' + d.id, { action: 'pause' }); }));
    } else if (d.status === 'paused' || d.status === 'paused_errors') {
      actions.appendChild(actionButton('Resume', function () { return postJson('/api/account/donations/' + d.id, { action: 'resume' }); }));
    }

    var callsInput = el('input', { type: 'number', min: '10', max: '2000', step: '10', value: String(d.calls_per_day), style: 'width:6em;margin-left:.5em;' });
    var tokensInput = el('input', { type: 'number', min: '10000', max: '3000000', step: '10000', value: String(d.tokens_per_day), style: 'width:8em;margin-left:.35em;' });
    actions.appendChild(document.createTextNode(' '));
    actions.appendChild(callsInput);
    actions.appendChild(tokensInput);
    actions.appendChild(actionButton('Update limits', function () {
      return postJson('/api/account/donations/' + d.id, {
        calls_per_day: Number(callsInput.value),
        tokens_per_day: Number(tokensInput.value),
      });
    }));

    actions.appendChild(actionButton('Revoke', function () {
      if (!window.confirm('Revoke this donation? Its key is deleted immediately and it stops being used right away.')) {
        return Promise.resolve({ ok: true, skip: true });
      }
      return postJson('/api/account/donations/' + d.id + '/revoke', {});
    }, true));

    children.push(actions);

    var row = el('div', { class: 'prose', style: 'border-top:1px solid var(--muted, #ccc);padding-top:.6em;margin-top:.6em;' }, children);
    return row;
  }

  function actionButton(label, onClick, danger) {
    var btn = el('button', { type: 'button', style: danger ? 'margin-left:.5em;color:#b34242;' : 'margin-left:.5em;' }, [label]);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      onClick().then(function (result) {
        if (result && result.skip) { btn.disabled = false; return; }
        loadDonations();
      }).catch(function () {
        btn.disabled = false;
      });
    });
    return btn;
  }

  function renderList(data) {
    if (!list) return;
    list.textContent = '';
    list.removeAttribute('data-loading');
    var donations = (data && data.donations) || [];
    if (!donations.length) {
      list.appendChild(el('p', { class: 'muted' }, ['You haven\'t lent a mind yet. The form below takes a minute.']));
      return;
    }
    donations.forEach(function (d) { list.appendChild(renderRow(d)); });
  }

  function loadDonations() {
    if (!list) return;
    api('/api/account/donations').then(function (res) {
      if (!res.ok || !res.data) {
        list.textContent = '';
        list.appendChild(el('p', { class: 'muted' }, ['Could not load your donations right now — try reloading.']));
        return;
      }
      renderList(res.data);
    }).catch(function () {
      list.textContent = '';
      list.appendChild(el('p', { class: 'muted' }, ['Could not load your donations right now — try reloading.']));
    });
  }

  // A donor picking a provider sees a placeholder shaped like a real id for
  // THAT provider (e.g. Fireworks' "accounts/fireworks/models/..." prefix is
  // a real footgun otherwise — byok.md §2).
  if (providerSelect && modelInput) {
    providerSelect.addEventListener('change', function () {
      var opt = providerSelect.options[providerSelect.selectedIndex];
      var placeholder = opt && opt.getAttribute('data-placeholder');
      if (placeholder) modelInput.setAttribute('placeholder', placeholder);
    });
  }

  if (form) {
    form.addEventListener('submit', function (evt) {
      evt.preventDefault();
      if (msg) { msg.textContent = 'Checking your key…'; }
      var fd = new FormData(form);
      var body = {};
      fd.forEach(function (v, k) { body[k] = v; });
      body.consent = form.querySelector('input[name="consent"]').checked ? '1' : '';

      postJson('/api/account/donations', body).then(function (res) {
        var keyField = form.querySelector('input[name="api_key"]');
        if (keyField) keyField.value = ''; // never re-shown, whatever happened
        if (res.ok && res.data && res.data.ok) {
          if (msg) msg.textContent = 'Donated — thank you.';
          form.reset();
          loadDonations();
        } else {
          var message = (res.data && (res.data.message || res.data.error)) || 'Could not save that donation.';
          if (msg) msg.textContent = message;
        }
      }).catch(function () {
        var keyField = form.querySelector('input[name="api_key"]');
        if (keyField) keyField.value = '';
        if (msg) msg.textContent = 'Something went wrong — try again.';
      });
    });
  }

  loadDonations();
})();
