import { h } from './dom.js';
import { me, login, signup } from './db.js';

// Resolves with the logged-in user ({ username }); shows the login / sign-up form first when there is no session.
export async function ensureLogin() {
  try {
    return await me();
  } catch {
    // not logged in (or server unreachable: the form's own request will say so)
  }
  const root = document.getElementById('app');
  return new Promise((resolve) => {
    let creating = false;
    const user = h('input', { id: 'login-user', type: 'text', autocomplete: 'username', required: '', maxlength: '30' });
    const pass = h('input', { id: 'login-pass', type: 'password', required: '', maxlength: '200' });
    const msg = h('p', { class: 'error', role: 'alert' });
    const title = h('h1', {});
    const submit = h('button', { type: 'submit', class: 'primary' });
    const toggle = h('button', { type: 'button', class: 'quiet' });
    const render = () => {
      title.textContent = creating ? 'Create an account' : 'Log in';
      submit.textContent = creating ? 'Sign up' : 'Log in';
      toggle.textContent = creating ? 'I already have an account' : 'Create an account';
      pass.autocomplete = creating ? 'new-password' : 'current-password';
      msg.textContent = '';
    };
    toggle.addEventListener('click', () => { creating = !creating; render(); });
    const form = h('form', { class: 'login' }, title,
      h('label', { for: 'login-user' }, 'Username'), user,
      h('label', { for: 'login-pass' }, 'Password'), pass,
      msg, h('div', { class: 'row' }, submit, toggle));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        resolve(await (creating ? signup : login)(user.value.trim(), pass.value));
        form.remove();
      } catch (err) {
        msg.textContent = err.message;
        submit.disabled = false;
      }
    });
    render();
    root.replaceChildren(form);
    user.focus();
  });
}
