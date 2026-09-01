'use strict';

const state = {
  user: null,
  category: 'all',
  current: null, // { exercise, reps, unit }
};

const $ = (sel) => document.querySelector(sel);
const el = {
  userBtn: $('#userBtn'),
  cats: $('#cats'),
  roll: $('#rollCard'),
  rollCat: $('#rollCat'),
  rollName: $('#rollName'),
  rollNum: $('#rollNum'),
  rollUnit: $('#rollUnit'),
  rollBtn: $('#rollBtn'),
  doneBtn: $('#doneBtn'),
  trainHint: $('#trainHint'),
  viewTrain: $('#viewTrain'),
  viewStats: $('#viewStats'),
  tabTrain: $('#tabTrain'),
  tabStats: $('#tabStats'),
  tabAdmin: $('#tabAdmin'),
  stTotalReps: $('#stTotalReps'),
  stSets: $('#stSets'),
  stDays: $('#stDays'),
  stStreak: $('#stStreak'),
  byExercise: $('#byExercise'),
  recent: $('#recent'),
};

// ---------- categories ----------
async function loadCategories() {
  const { categories } = await api('/categories');
  if (!categories.some((c) => c.slug === state.category)) state.category = 'all';
  el.cats.innerHTML = '';
  for (const c of categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.slug === state.category ? ' chip--active' : '');
    b.innerHTML = `${c.name}<small>${c.count}</small>`;
    b.addEventListener('click', () => {
      state.category = c.slug;
      [...el.cats.children].forEach((x) => x.classList.remove('chip--active'));
      b.classList.add('chip--active');
      roll();
    });
    el.cats.appendChild(b);
  }
}

// ---------- roll ----------
let rolling = false;
async function roll() {
  if (rolling) return;
  rolling = true;
  haptic('light');
  el.doneBtn.hidden = true;
  el.roll.classList.remove('roll--empty', 'pop');
  el.roll.classList.add('is-rolling');
  el.rollBtn.textContent = 'Крутим…';

  // визуальный «барабан»
  let ticks = 0;
  const spin = setInterval(() => {
    el.rollNum.textContent = Math.floor(Math.random() * 40) + 5;
    ticks += 1;
  }, 70);

  try {
    const data = await api(`/roll?category=${encodeURIComponent(state.category)}`);
    // держим анимацию хотя бы ~0.5с
    await new Promise((r) => setTimeout(r, Math.max(0, 500 - ticks * 70)));
    clearInterval(spin);
    state.current = data;
    el.rollCat.textContent = data.exercise.category;
    el.rollName.textContent = data.exercise.name;
    el.rollNum.textContent = data.reps;
    el.rollUnit.textContent = data.unit === 'сек' ? 'секунд' : 'повторений';
    el.roll.classList.remove('is-rolling');
    el.roll.classList.add('pop');
    el.doneBtn.hidden = false;
    el.rollBtn.textContent = 'Ещё раз';
    el.trainHint.textContent = state.user
      ? 'Сделал — жми «Записать подход».'
      : 'Войди, чтобы сохранять подходы в статистику.';
    haptic('medium');
  } catch (e) {
    clearInterval(spin);
    el.roll.classList.remove('is-rolling');
    el.rollNum.textContent = '—';
    el.rollBtn.textContent = 'Крутить';
    toast(e.message);
  } finally {
    rolling = false;
  }
}

async function done() {
  if (!state.current) return;
  if (!state.user) {
    toast('Нужен вход, чтобы сохранять');
    if (!tg) goTo('login.html');
    return;
  }
  try {
    await api('/logs', {
      method: 'POST',
      body: { exercise_id: state.current.exercise.id, reps: state.current.reps },
    });
    haptic('rigid');
    toast('Записано 💪');
    el.doneBtn.hidden = true;
    el.trainHint.textContent = 'Отлично! Крути следующее.';
  } catch (e) {
    toast(e.message);
  }
}

// ---------- stats ----------
async function loadStats() {
  if (!state.user) return;
  try {
    const s = await api('/stats');
    el.stTotalReps.textContent = s.totals.reps;
    el.stSets.textContent = s.totals.sets;
    el.stDays.textContent = s.totals.activeDays;
    el.stStreak.textContent = s.totals.streak;

    const max = Math.max(1, ...s.byExercise.map((r) => r.reps));
    el.byExercise.innerHTML = s.byExercise.length
      ? s.byExercise
          .map((r) => `
            <div class="bar">
              <div class="bar__fill" style="width:${Math.round((r.reps / max) * 100)}%"></div>
              <div class="bar__row">
                <span class="bar__name">${escapeHtml(r.name)}</span>
                <span class="bar__val">${r.reps} <small>${r.unit} · ${r.sets} подх.</small></span>
              </div>
            </div>`)
          .join('')
      : '<p class="empty">Пока пусто. Запиши первый подход на вкладке «Тренировка».</p>';

    el.recent.innerHTML = s.recent.length
      ? s.recent
          .map((r) => `
            <li>
              <span class="recent__name">${escapeHtml(r.name)}</span>
              <span>
                <span class="recent__reps">${r.reps} ${r.unit}</span>
                <span class="recent__time"> · ${timeAgo(r.created_at)}</span>
              </span>
            </li>`)
          .join('')
      : '<li class="empty">Здесь появятся твои подходы.</li>';
  } catch (e) {
    toast(e.message);
  }
}

// ---------- вкладки внутри страницы (не роутинг, просто show/hide) ----------
function switchView(name) {
  el.viewTrain.hidden = name !== 'train';
  el.viewStats.hidden = name !== 'stats';
  el.tabTrain.classList.toggle('tab--active', name === 'train');
  el.tabStats.classList.toggle('tab--active', name === 'stats');
  if (name === 'stats') loadStats();
}

// ---------- user button ----------
function renderUserBtn() {
  if (state.user) {
    el.userBtn.textContent = state.user.display_name || state.user.username || 'Профиль';
  } else {
    el.userBtn.textContent = 'Войти';
  }
  el.tabAdmin.hidden = !(state.user && state.user.is_admin);
}

async function logout() {
  setToken(null);
  state.user = null;
  renderUserBtn();
  if (tg) {
    toast('Вышли из аккаунта');
  } else {
    goTo('login.html');
  }
}

// ---------- boot ----------
async function boot() {
  const { user } = await resolveSession();
  state.user = user;
  renderUserBtn();
  await loadCategories();
  switchView('train');

  el.rollBtn.addEventListener('click', roll);
  el.doneBtn.addEventListener('click', done);
  el.tabTrain.addEventListener('click', () => switchView('train'));
  el.tabStats.addEventListener('click', () => switchView('stats'));
  el.userBtn.addEventListener('click', () => {
    if (state.user) {
      if (confirm(`Вы вошли как ${state.user.display_name}. Выйти?`)) logout();
    } else {
      goTo('login.html');
    }
  });
}

boot();
