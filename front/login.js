'use strict';

const state = { authMode: 'login' };

const $ = (sel) => document.querySelector(sel);
const el = {
  tLogin: $('#tLogin'),
  tReg: $('#tReg'),
  authForm: $('#authForm'),
  fUser: $('#fUser'),
  fPass: $('#fPass'),
  authErr: $('#authErr'),
  authSubmit: $('#authSubmit'),
  guestBtn: $('#guestBtn'),
};

function setAuthMode(mode) {
  state.authMode = mode;
  const login = mode === 'login';
  el.tLogin.classList.toggle('tab2--active', login);
  el.tReg.classList.toggle('tab2--active', !login);
  el.authSubmit.textContent = login ? 'Войти' : 'Создать аккаунт';
  el.authErr.hidden = true;
}

async function submitAuth(e) {
  e.preventDefault();
  el.authErr.hidden = true;
  el.authSubmit.disabled = true;
  const body = { username: el.fUser.value, password: el.fPass.value };
  try {
    const data = await api(state.authMode === 'login' ? '/auth/login' : '/auth/register', {
      method: 'POST',
      body,
    });
    setToken(data.token);
    goTo('index.html');
  } catch (err) {
    el.authErr.textContent = err.message;
    el.authErr.hidden = false;
  } finally {
    el.authSubmit.disabled = false;
  }
}

async function boot() {
  // Уже есть валидная сессия (в т.ч. через Telegram) — сразу на тренировки.
  const { user } = await resolveSession();
  if (user) { goTo('index.html'); return; }

  el.tLogin.addEventListener('click', () => setAuthMode('login'));
  el.tReg.addEventListener('click', () => setAuthMode('register'));
  el.authForm.addEventListener('submit', submitAuth);
  el.guestBtn.addEventListener('click', () => goTo('index.html'));
}

boot();
