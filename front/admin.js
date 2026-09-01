'use strict';

const state = { user: null, adminEx: [], editId: null };

const $ = (sel) => document.querySelector(sel);
const el = {
  exFormTitle: $('#exFormTitle'),
  exName: $('#exName'),
  exCat: $('#exCat'),
  exMin: $('#exMin'),
  exMax: $('#exMax'),
  exUnit: $('#exUnit'),
  exErr: $('#exErr'),
  exSave: $('#exSave'),
  exCancel: $('#exCancel'),
  catSlug: $('#catSlug'),
  catName: $('#catName'),
  catErr: $('#catErr'),
  catSave: $('#catSave'),
  adminList: $('#adminList'),
};

async function loadAdmin() {
  try {
    const [{ categories }, { exercises }] = await Promise.all([
      api('/admin/categories'),
      api('/admin/exercises'),
    ]);
    state.adminEx = exercises;
    el.exCat.innerHTML = categories
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');

    const groups = {};
    for (const e of exercises) (groups[e.category_id] = groups[e.category_id] || []).push(e);

    let html = '';
    for (const c of categories) {
      const items = groups[c.id] || [];
      html += `<div class="catrow"><span class="catrow__lbl">${escapeHtml(c.name)} · ${items.length}</span>`;
      if (!items.length) {
        html += `<button class="iconbtn iconbtn--del catrow__del" data-delcat="${c.id}">Удалить категорию</button>`;
      }
      html += '</div>';
      for (const e of items) {
        html += `
          <div class="exrow">
            <div class="exrow__main">
              <div class="exrow__name">${escapeHtml(e.name)}</div>
              <div class="exrow__meta"><b>${e.min_reps}–${e.max_reps} ${e.unit}</b>${e.logs ? ` · ${e.logs} подх. в истории` : ''}</div>
            </div>
            <button class="iconbtn" data-edit="${e.id}">Изм.</button>
            <button class="iconbtn iconbtn--del" data-del="${e.id}">✕</button>
          </div>`;
      }
    }
    el.adminList.innerHTML = html || '<p class="empty">Пока нет упражнений.</p>';
  } catch (e) {
    toast(e.message);
  }
}

function resetExForm() {
  state.editId = null;
  el.exName.value = '';
  el.exMin.value = '';
  el.exMax.value = '';
  el.exUnit.value = 'раз';
  el.exErr.hidden = true;
  el.exFormTitle.textContent = 'Новое упражнение';
  el.exSave.textContent = 'Добавить упражнение';
  el.exCancel.hidden = true;
}

function startEdit(id) {
  const e = (state.adminEx || []).find((x) => x.id === id);
  if (!e) return;
  state.editId = id;
  el.exName.value = e.name;
  el.exCat.value = String(e.category_id);
  el.exMin.value = e.min_reps;
  el.exMax.value = e.max_reps;
  el.exUnit.value = e.unit;
  el.exFormTitle.textContent = 'Редактирование';
  el.exSave.textContent = 'Сохранить изменения';
  el.exCancel.hidden = false;
  el.exErr.hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveExercise() {
  el.exErr.hidden = true;
  const body = {
    name: el.exName.value,
    category_id: Number(el.exCat.value),
    min_reps: Number(el.exMin.value),
    max_reps: Number(el.exMax.value),
    unit: el.exUnit.value,
  };
  try {
    if (state.editId) {
      await api(`/admin/exercises/${state.editId}`, { method: 'PUT', body });
      toast('Изменено');
    } else {
      await api('/admin/exercises', { method: 'POST', body });
      toast('Добавлено 💪');
    }
    resetExForm();
    await loadAdmin();
  } catch (e) {
    el.exErr.textContent = e.message;
    el.exErr.hidden = false;
  }
}

async function deleteExercise(id) {
  if (!confirm('Удалить упражнение?')) return;
  try {
    await api(`/admin/exercises/${id}`, { method: 'DELETE' });
    toast('Удалено');
    if (state.editId === id) resetExForm();
    await loadAdmin();
  } catch (e) {
    toast(e.message);
  }
}

async function saveCategory() {
  el.catErr.hidden = true;
  try {
    await api('/admin/categories', {
      method: 'POST',
      body: { slug: el.catSlug.value, name: el.catName.value },
    });
    el.catSlug.value = '';
    el.catName.value = '';
    toast('Категория добавлена');
    await loadAdmin();
  } catch (e) {
    el.catErr.textContent = e.message;
    el.catErr.hidden = false;
  }
}

async function deleteCategory(id) {
  if (!confirm('Удалить категорию?')) return;
  try {
    await api(`/admin/categories/${id}`, { method: 'DELETE' });
    toast('Категория удалена');
    await loadAdmin();
  } catch (e) {
    toast(e.message);
  }
}

async function boot() {
  const { user } = await resolveSession();
  if (!user || !user.is_admin) {
    goTo('index.html');
    return;
  }
  state.user = user;

  document.getElementById('checking').hidden = true;
  document.getElementById('app').hidden = false;

  await loadAdmin();

  el.exSave.addEventListener('click', saveExercise);
  el.exCancel.addEventListener('click', resetExForm);
  el.catSave.addEventListener('click', saveCategory);
  el.adminList.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.edit) startEdit(Number(t.dataset.edit));
    else if (t.dataset.del) deleteExercise(Number(t.dataset.del));
    else if (t.dataset.delcat) deleteCategory(Number(t.dataset.delcat));
  });
}

boot();