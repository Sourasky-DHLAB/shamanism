document.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const client = new PasswordRecovery.Client(window.RESEARCH_CONFIG || {});
  const status = document.querySelector('#reset-status');
  const form = document.querySelector('#reset-password-form');
  const password = document.querySelector('#new-password');
  const confirmation = document.querySelector('#confirm-password');
  const message = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('research-error', error);
  };
  // Consume the fragment in memory, then remove credentials from the address/history.
  const hash = window.location.hash;
  history.replaceState(null, '', window.location.pathname);
  let token;
  try {
    token = PasswordRecovery.readLink(hash);
    await client.verify(token);
    form.hidden = false;
    message('Choose a new password with at least 8 characters.');
  } catch (error) {
    token = null;
    message(error.message, true);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    try { PasswordRecovery.validatePassword(password.value, confirmation.value); }
    catch (error) { message(error.message, true); return; }
    if (!token) { message('Request a new reset link from the archive sign-in form.', true); return; }
    button.disabled = true;
    try {
      await client.update(password.value, token);
      password.value = ''; confirmation.value = '';
      form.hidden = true;
      // Revoke refresh sessions after recovery. Password success is independent of logout.
      try { await client.logout(token); } catch (_) { /* password was already changed */ }
      token = null;
      try { sessionStorage.removeItem('research-session:' + client.url); } catch (_) { /* storage may be unavailable */ }
      message('Your password has been changed. Return to the archive and sign in with your new password.');
    } catch (error) { message(`Could not change your password: ${error.message}`, true); }
    finally { button.disabled = false; }
  });
});
