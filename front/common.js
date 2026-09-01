'use strict';

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const TOKEN_KEY = 'rf_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api(pathname, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1900);
}

function haptic(type) {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(type || 'light'); } catch {}
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function timeAgo(iso) {
  const then = new Date((iso || '').replace(' ', 'T') + 'Z');
  if (isNaN(then)) return '';
  const s = Math.floor((Date.now() - then.getTime()) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return then.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function goTo(page) {
  window.location.href = page;
}

/**
 * Определяет текущую сессию и ничего никуда не редиректит —
 * это решает уже конкретная страница.
 *
 * - Внутри Telegram (tg.initData доступен) — логинимся через initData.
 *   Это работает только на той странице, которую Telegram открыл
 *   изначально: initData передаётся Telegram'ом в URL только на входе
 *   в Mini App и на других страницах уже недоступен. Поэтому
 *   index.html (точка входа для Telegram) держит эту логику,
 *   а login.html/admin.html полагаются на токен из localStorage,
 *   который уже сохранён после первого TG-логина на index.html.
 * - Иначе — проверяем сохранённый токен через /me.
 * - Иначе — гость.
 */
async function resolveSession() {
  if (tg && tg.initData) {
    try {
      tg.ready();
      tg.expand();
      const data = await api('/auth/telegram', { method: 'POST', body: { initData: tg.initData } });
      setToken(data.token);
      return { user: data.user, viaTelegram: true };
    } catch (e) {
      console.warn('TG auth failed:', e.message);
      return { user: null, viaTelegram: true };
    }
  }
  if (getToken()) {
    try {
      const { user } = await api('/me');
      return { user, viaTelegram: false };
    } catch {
      setToken(null);
      return { user: null, viaTelegram: false };
    }
  }
  return { user: null, viaTelegram: false };
}
