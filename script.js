// ================= Estado y persistencia =================

const KEY = 'mi-dia:v1';
const THEME_KEY = 'mi-dia:theme';
const TAB_KEY = 'mi-dia:tab';

const GYM_TYPES = ['Pecho', 'Espalda', 'Pierna', 'Hombro', 'Brazos', 'Core', 'Cardio', 'Full body', 'Otro'];
const TAB_TITLES = { hoy: 'Hoy', universidad: 'Universidad', gym: 'Gym' };
const RING_LEN = 2 * Math.PI * 52; // circunferencia del anillo (r = 52)

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = loadState();
let supabaseClient = null;
const SHARED_UID = '00000000-0000-4000-8000-000000000001';
let currentUser = { id: SHARED_UID };
let cloudSyncQueue = Promise.resolve();
let cloudSyncTimer = null;
let taskFilter = 'pendientes';
let groupByCourse = false;
let calMonth = startOfMonth(new Date());
let selectedGymDate = null;
let currentTab = 'hoy';

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return {
      tasks: Array.isArray(raw && raw.tasks) ? raw.tasks : [],
      gym: raw && raw.gym && typeof raw.gym === 'object' ? raw.gym : {},
      goal: raw && Number.isInteger(raw.goal) ? raw.goal : 4,
    };
  } catch (e) {
    return { tasks: [], gym: {}, goal: 4 };
  }
}

function saveState() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('No se pudo guardar en este navegador'); }
  if (supabaseClient) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      cloudSyncQueue = cloudSyncQueue.then(syncCloudState).catch((err) => {
        console.error('Error sincronizando Mi día:', err);
        toast('No se pudo sincronizar. Revisa tu conexión.');
      });
    }, 250);
  }
}

async function syncCloudState() {
  if (!supabaseClient) return;
  const uid = SHARED_UID;
  const taskRows = state.tasks.map(t => ({
    id: t.id, usuario_id: uid, titulo: t.title, notas: t.notes || '',
    fecha_limite: t.due || null, prioridad: t.priority || 'media', tipo: t.type || 'Tarea',
    materia: courseOf(t), completada: !!t.done, completada_en: t.doneAt || null,
    creada_en: t.createdAt ? new Date(t.createdAt + 'T12:00:00').toISOString() : new Date().toISOString()
  }));
  const { data: oldTasks, error: oldTaskErr } = await supabaseClient.from('tareas').select('id').eq('usuario_id', uid);
  if (oldTaskErr) throw oldTaskErr;
  const taskIds = new Set(taskRows.map(t => t.id));
  const deleteTaskIds = (oldTasks || []).filter(t => !taskIds.has(t.id)).map(t => t.id);
  if (deleteTaskIds.length) { const { error } = await supabaseClient.from('tareas').delete().in('id', deleteTaskIds); if (error) throw error; }
  if (taskRows.length) { const { error } = await supabaseClient.from('tareas').upsert(taskRows); if (error) throw error; }

  const gymRows = Object.entries(state.gym).map(([fecha, e]) => ({
    usuario_id: uid, fecha, tipo: e.type || 'Full body', minutos: Number(e.minutes) || 0, notas: e.notes || ''
  }));
  const { data: oldGym, error: oldGymErr } = await supabaseClient.from('entrenamientos').select('id,fecha').eq('usuario_id', uid);
  if (oldGymErr) throw oldGymErr;
  const gymDates = new Set(gymRows.map(g => g.fecha));
  const deleteGymIds = (oldGym || []).filter(g => !gymDates.has(g.fecha)).map(g => g.id);
  if (deleteGymIds.length) { const { error } = await supabaseClient.from('entrenamientos').delete().in('id', deleteGymIds); if (error) throw error; }
  if (gymRows.length) { const { error } = await supabaseClient.from('entrenamientos').upsert(gymRows, { onConflict: 'usuario_id,fecha' }); if (error) throw error; }

  const { error: prefErr } = await supabaseClient.from('preferencias').upsert({ usuario_id: uid, meta_semanal: state.goal }, { onConflict: 'usuario_id' });
  if (prefErr) throw prefErr;
}

async function loadCloudState() {
  const uid = SHARED_UID;
  const [tasksRes, gymRes, prefRes] = await Promise.all([
    supabaseClient.from('tareas').select('*').eq('usuario_id', uid),
    supabaseClient.from('entrenamientos').select('*').eq('usuario_id', uid),
    supabaseClient.from('preferencias').select('*').eq('usuario_id', uid).maybeSingle()
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (gymRes.error) throw gymRes.error;
  if (prefRes.error) throw prefRes.error;
  state = {
    tasks: (tasksRes.data || []).map(t => ({ id: t.id, title: t.titulo, notes: t.notas || '', due: t.fecha_limite || '', priority: t.prioridad || 'media', type: t.tipo || 'Tarea', course: t.materia || '', done: !!t.completada, doneAt: t.completada_en || null, createdAt: (t.creada_en || '').slice(0,10) || todayISO() })),
    gym: Object.fromEntries((gymRes.data || []).map(g => [g.fecha, { type: g.tipo || 'Full body', minutes: g.minutos || 0, notes: g.notas || '' }])),
    goal: prefRes.data ? prefRes.data.meta_semanal : 4
  };
  localStorage.setItem(KEY, JSON.stringify(state));
  if (!prefRes.data) await syncCloudState();
}

function showAuth(message = '') {
  document.body.classList.add('auth-locked');
  $('auth-screen').hidden = false;
  $('auth-message').textContent = message;
}

function hideAuth() {
  $('auth-screen').hidden = true;
  document.body.classList.remove('auth-locked');
  $('signout-btn').hidden = false;
}


// ================= Utilidades =================

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

// La semana va de lunes a domingo
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function shortDate(s) {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function daysFromToday(dateStr) {
  return Math.round((parseISO(dateStr) - parseISO(todayISO())) / 86400000);
}

function newId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

function $(id) { return document.getElementById(id); }

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Números que "suben" con una pequeña animación
function setNum(el, value) {
  const to = Number(value);
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (reduceMotion || from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const dur = 450;
  (function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

function setRing(id, done, goal) {
  const pct = Math.min(1, goal ? done / goal : 0);
  const ring = $(id);
  ring.style.strokeDashoffset = String(RING_LEN * (1 - pct));
  ring.style.opacity = pct === 0 ? '0' : '1'; // evita el punto de la punta redondeada con 0 días
}

// ================= Tema =================

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-label').textContent = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0A0B14' : '#F3F4FB';
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignorar */ }
}

$('theme-btn').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  closeMenu();
});

// ================= Menú de opciones =================

function closeMenu() {
  $('menu').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}

$('menu-btn').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const open = $('menu').hidden;
  $('menu').hidden = !open;
  $('menu-btn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (ev) => { if (!ev.target.closest('.menu-wrap')) closeMenu(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });

// ================= Navegación =================

function moveIndicator() {
  const active = document.querySelector('.nav-item.active');
  const ind = $('nav-ind');
  if (!active) return;
  ind.dataset.tab = active.dataset.tab;
  ind.style.width = active.offsetWidth + 'px';
  ind.style.height = active.offsetHeight + 'px';
  ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
}

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => {
    const show = p.id === 'tab-' + name;
    p.hidden = !show;
    p.classList.remove('enter');
    if (show) { void p.offsetWidth; p.classList.add('enter'); }
  });
  $('page-title').textContent = TAB_TITLES[name];
  $('fab').hidden = name === 'gym';
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* ignorar */ }
  moveIndicator();
  renderAll();
}

document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
window.addEventListener('resize', moveIndicator);

// ================= Universidad: tareas =================

function isOverdue(t) { return !t.done && t.due && t.due < todayISO(); }
function courseOf(t) { return (t.course || t.category || '').trim(); }
function typeOf(t) { return t.type || 'Tarea'; }

const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };

function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.due || '9999-99-99';
    const db = b.due || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
  });
}

function filteredTasks() {
  const today = todayISO();
  const weekEnd = new Date(startOfWeek(new Date()));
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndISO = iso(weekEnd);
  const q = $('t-search').value.trim().toLowerCase();
  let list = state.tasks;
  if (taskFilter === 'pendientes') list = list.filter((t) => !t.done);
  else if (taskFilter === 'hoy') list = list.filter((t) => !t.done && t.due && t.due <= today);
  else if (taskFilter === 'semana') list = list.filter((t) => !t.done && t.due && t.due <= weekEndISO);
  else if (taskFilter === 'vencidas') list = list.filter(isOverdue);
  else if (taskFilter === 'hechas') list = list.filter((t) => t.done);
  if (q) list = list.filter((t) => (t.title + ' ' + (t.notes || '') + ' ' + courseOf(t)).toLowerCase().includes(q));
  return sortTasks(list);
}

function dueText(t) {
  const diff = daysFromToday(t.due);
  if (diff < -1) return { text: `Venció hace ${-diff} días`, cls: 'late' };
  if (diff === -1) return { text: 'Venció ayer', cls: 'late' };
  if (diff === 0) return { text: 'Hoy', cls: 'soon' };
  if (diff === 1) return { text: 'Mañana', cls: 'soon' };
  if (diff <= 7) return { text: `En ${diff} días`, cls: '' };
  return { text: shortDate(t.due), cls: '' };
}

function taskElement(t, index) {
  const li = document.createElement('li');
  li.className = `task p-${t.priority || 'media'}${t.done ? ' done' : ''}`;
  li.style.animationDelay = Math.min(index || 0, 10) * 30 + 'ms';

  const check = document.createElement('label');
  check.className = 'check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!t.done;
  cb.setAttribute('aria-label', 'Marcar como hecha');
  cb.addEventListener('change', () => toggleTask(t.id));
  const box = document.createElement('span');
  check.append(cb, box);

  const body = document.createElement('div');
  body.className = 'task-body';

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = t.title;
  body.appendChild(title);

  if (t.notes) {
    const n = document.createElement('div');
    n.className = 'task-notes';
    n.textContent = t.notes;
    body.appendChild(n);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const addPill = (text, cls) => {
    const p = document.createElement('span');
    p.className = 'pill' + (cls ? ' ' + cls : '');
    p.textContent = text;
    meta.appendChild(p);
  };
  const type = typeOf(t);
  if (type !== 'Tarea') addPill(type, type === 'Examen' ? 'exam' : type === 'Proyecto' ? 'proj' : '');
  if (courseOf(t)) addPill(courseOf(t), 'course');
  if (t.due) {
    if (t.done) addPill(shortDate(t.due));
    else { const d = dueText(t); addPill(d.text, d.cls); }
  }
  body.appendChild(meta);

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.setAttribute('aria-label', 'Eliminar tarea');
  del.addEventListener('click', () => deleteTask(t.id));

  li.append(check, body, del);
  return li;
}

function toggleTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? todayISO() : null;
  saveState();
  if (t.done) toast('¡Tarea completada!');
  renderAll();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((x) => x.id !== id);
  saveState();
  renderAll();
}

function listOf(tasks) {
  const ul = document.createElement('ul');
  ul.className = 'task-list';
  tasks.forEach((t, i) => ul.appendChild(taskElement(t, i)));
  return ul;
}

function renderTasks() {
  const list = filteredTasks();
  const box = $('task-container');
  box.innerHTML = '';

  if (groupByCourse) {
    const groups = {};
    list.forEach((t) => {
      const c = courseOf(t) || 'Sin materia';
      (groups[c] = groups[c] || []).push(t);
    });
    Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach((c) => {
      const h = document.createElement('div');
      h.className = 'group-head';
      h.textContent = `${c} · ${groups[c].length}`;
      box.append(h, listOf(groups[c]));
    });
  } else if (list.length) {
    box.appendChild(listOf(list));
  }

  $('task-empty').style.display = list.length ? 'none' : 'block';
  document.querySelectorAll('#task-filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === taskFilter));
  $('group-toggle').setAttribute('aria-pressed', String(groupByCourse));
  $('clear-done').style.display = state.tasks.some((t) => t.done) ? 'inline-block' : 'none';

  // Resumen superior
  const pending = state.tasks.filter((t) => !t.done);
  setNum($('u-pending'), pending.length);
  setNum($('u-done-week'), doneThisWeek());

  const exams = sortTasks(pending.filter((t) => typeOf(t) === 'Examen' && t.due && t.due >= todayISO()));
  if (exams.length) {
    const d = daysFromToday(exams[0].due);
    $('u-exam-days').textContent = d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : `${d} días`;
    $('u-exam-name').textContent = exams[0].title + (courseOf(exams[0]) ? ' · ' + courseOf(exams[0]) : '');
  } else {
    $('u-exam-days').textContent = '—';
    $('u-exam-name').textContent = 'Sin exámenes a la vista';
  }

  // Sugerencias de materias para el formulario
  const courses = [...new Set(state.tasks.map(courseOf).filter(Boolean))].sort();
  const dl = $('course-list');
  dl.innerHTML = '';
  courses.forEach((c) => { const o = document.createElement('option'); o.value = c; dl.appendChild(o); });
}

function doneThisWeek() {
  const wkStart = iso(startOfWeek(new Date()));
  return state.tasks.filter((t) => t.done && t.doneAt && t.doneAt >= wkStart).length;
}

// --- Diálogo de nueva tarea ---
const dialog = $('task-dialog');

function openDialog() {
  $('task-form').reset();
  if (!$('t-due').value && currentTab === 'hoy') $('t-due').value = todayISO();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  $('t-title').focus();
}
function closeDialog() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

$('fab').addEventListener('click', openDialog);
$('dialog-close').addEventListener('click', closeDialog);
dialog.addEventListener('click', (ev) => { if (ev.target === dialog) closeDialog(); });

$('task-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const title = $('t-title').value.trim();
  if (!title) return;
  const checked = (name) => ev.target.querySelector(`input[name="${name}"]:checked`).value;
  state.tasks.push({
    id: newId(),
    title,
    notes: $('t-notes').value.trim(),
    due: $('t-due').value || '',
    priority: checked('t-priority'),
    type: checked('t-type'),
    course: $('t-course').value.trim(),
    done: false,
    doneAt: null,
    createdAt: todayISO(),
  });
  saveState();
  closeDialog();
  toast('Tarea guardada');
  renderAll();
});

$('quick-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const title = $('quick-title').value.trim();
  if (!title) return;
  state.tasks.push({
    id: newId(), title, notes: '', due: todayISO(), priority: 'media',
    type: 'Tarea', course: '', done: false, doneAt: null, createdAt: todayISO(),
  });
  saveState();
  ev.target.reset();
  toast('Agregada para hoy');
  renderAll();
});

$('task-filters').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  taskFilter = chip.dataset.filter;
  renderTasks();
});

$('group-toggle').addEventListener('click', () => { groupByCourse = !groupByCourse; renderTasks(); });
$('t-search').addEventListener('input', renderTasks);

$('clear-done').addEventListener('click', () => {
  const n = state.tasks.filter((t) => t.done).length;
  if (!n) return;
  if (!confirm(`¿Borrar ${n} tarea(s) hecha(s)?`)) return;
  state.tasks = state.tasks.filter((t) => !t.done);
  saveState();
  renderAll();
});

// ================= Gym =================

function trainedDates() { return Object.keys(state.gym).sort(); }

function gymCountInRange(from, to) {
  const a = iso(from), b = iso(to);
  return trainedDates().filter((d) => d >= a && d <= b).length;
}

function weekCount() {
  const start = startOfWeek(new Date());
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return gymCountInRange(start, end);
}

function monthRange(monthDate) {
  const start = startOfMonth(monthDate);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return [start, end];
}

function monthCount(monthDate) {
  const [s, e] = monthRange(monthDate);
  return gymCountInRange(s, e);
}

function monthMinutes(monthDate) {
  const [s, e] = monthRange(monthDate);
  const a = iso(s), b = iso(e);
  return trainedDates().filter((d) => d >= a && d <= b).reduce((sum, d) => sum + (state.gym[d].minutes || 0), 0);
}

// Racha: días consecutivos hasta hoy (si hoy aún no entrenas, cuenta desde ayer)
function currentStreak() {
  const d = new Date();
  if (!state.gym[iso(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (state.gym[iso(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderGymTypes() {
  const box = $('g-types');
  if (box.children.length) return;
  GYM_TYPES.forEach((t, i) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'g-type'; input.value = t;
    if (i === 0) input.checked = true;
    const span = document.createElement('span');
    span.textContent = t;
    label.append(input, span);
    box.appendChild(label);
  });
}

function renderCalendar() {
  $('g-month-label').textContent = `${MONTHS[calMonth.getMonth()]} ${calMonth.getFullYear()}`;
  const cal = $('g-cal');
  cal.innerHTML = '';

  const offset = (calMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const today = todayISO();

  for (let i = 0; i < offset; i++) {
    const e = document.createElement('div');
    e.className = 'cal-cell empty-cell';
    cal.appendChild(e);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = iso(new Date(calMonth.getFullYear(), calMonth.getMonth(), day));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-cell';
    if (state.gym[date]) b.classList.add('trained');
    if (date === today) b.classList.add('today');
    if (date === selectedGymDate) b.classList.add('selected');
    b.textContent = day;
    b.dataset.date = date;
    const entry = state.gym[date];
    b.title = entry ? `${entry.type}${entry.minutes ? ' · ' + entry.minutes + ' min' : ''}` : 'Sin registro';
    cal.appendChild(b);
  }
}

function fillGymForm(date) {
  selectedGymDate = date;
  const entry = state.gym[date];
  $('g-date').value = date;
  const type = entry ? entry.type : GYM_TYPES[0];
  const radio = document.querySelector(`input[name="g-type"][value="${type}"]`) || document.querySelector('input[name="g-type"]');
  if (radio) radio.checked = true;
  $('g-min').value = entry && entry.minutes ? entry.minutes : '';
  $('g-notes').value = entry ? entry.notes || '' : '';
  $('g-remove').hidden = !entry;
  $('g-form-title').textContent = entry ? 'Editar entrenamiento' : 'Registrar entrenamiento';
}

function renderGymLog() {
  const ul = $('g-log');
  ul.innerHTML = '';
  const recent = trainedDates().reverse().slice(0, 8);
  if (!recent.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Todavía no has registrado entrenamientos.';
    ul.appendChild(li);
    return;
  }
  recent.forEach((date) => {
    const e = state.gym[date];
    const li = document.createElement('li');
    const d = document.createElement('span');
    d.className = 'log-date';
    d.textContent = shortDate(date);
    const m = document.createElement('span');
    m.className = 'log-main';
    const b = document.createElement('b');
    b.textContent = e.type;
    m.append(b, document.createTextNode((e.minutes ? ` · ${e.minutes} min` : '') + (e.notes ? ` — ${e.notes}` : '')));
    li.append(d, m);
    ul.appendChild(li);
  });
}

function renderGym() {
  renderGymTypes();
  const wk = weekCount();
  setNum($('g-week'), wk);
  $('g-goal').textContent = state.goal;
  setRing('gym-ring', wk, state.goal);
  setNum($('g-month'), monthCount(new Date()));
  setNum($('g-streak'), currentStreak());
  setNum($('g-minutes'), monthMinutes(new Date()));
  setNum($('g-total'), trainedDates().length);
  renderCalendar();
  renderGymLog();
  if (!selectedGymDate) fillGymForm(todayISO());
}

$('g-cal').addEventListener('click', (ev) => {
  const cell = ev.target.closest('.cal-cell');
  if (!cell || !cell.dataset.date) return;
  fillGymForm(cell.dataset.date);
  renderCalendar();
});

$('g-prev').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
});
$('g-next').addEventListener('click', () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
});

$('g-date').addEventListener('change', () => {
  if ($('g-date').value) { fillGymForm($('g-date').value); renderCalendar(); }
});

$('gym-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const date = $('g-date').value;
  if (!date) return;
  const minutes = parseInt($('g-min').value, 10);
  const type = document.querySelector('input[name="g-type"]:checked');
  state.gym[date] = {
    type: type ? type.value : GYM_TYPES[0],
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
    notes: $('g-notes').value.trim(),
  };
  saveState();
  selectedGymDate = date;
  calMonth = startOfMonth(parseISO(date));
  toast('Entrenamiento guardado');
  renderAll();
});

$('g-remove').addEventListener('click', () => {
  const date = $('g-date').value;
  if (!state.gym[date]) return;
  delete state.gym[date];
  saveState();
  toast('Día quitado');
  fillGymForm(date);
  renderAll();
});

$('goal-minus').addEventListener('click', () => { state.goal = Math.max(1, state.goal - 1); saveState(); renderAll(); });
$('goal-plus').addEventListener('click', () => { state.goal = Math.min(7, state.goal + 1); saveState(); renderAll(); });

// ================= Hoy =================

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

function renderHome() {
  const now = new Date();
  const label = now.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('today-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  $('greeting').textContent = greeting();

  const today = todayISO();
  const due = sortTasks(state.tasks.filter((t) => !t.done && t.due && t.due <= today));
  $('hero-title').textContent = due.length
    ? `Tienes ${due.length} ${due.length === 1 ? 'pendiente' : 'pendientes'} para hoy`
    : 'Todo al día. ¿Algo nuevo que anotar?';

  const ul = $('today-tasks');
  ul.innerHTML = '';
  due.slice(0, 8).forEach((t, i) => ul.appendChild(taskElement(t, i)));
  $('today-empty').style.display = due.length ? 'none' : 'block';
  $('today-count').textContent = due.length;

  const wk = weekCount();
  setNum($('home-week-count'), wk);
  $('home-goal').textContent = state.goal;
  setRing('home-ring', wk, state.goal);

  const streak = currentStreak();
  $('home-streak').textContent = wk >= state.goal
    ? 'Meta semanal cumplida. Excelente.'
    : streak > 0 ? `Llevas ${streak} ${streak === 1 ? 'día' : 'días'} seguido${streak === 1 ? '' : 's'}.` : 'Aún no has entrenado esta semana.';
  $('home-gym-toggle').textContent = state.gym[today] ? 'Hoy ya entrenaste (quitar)' : 'Marcar que entrené hoy';

  const pending = state.tasks.filter((t) => !t.done);
  setNum($('s-pending'), pending.length);
  setNum($('s-overdue'), pending.filter(isOverdue).length);
  setNum($('s-done-week'), doneThisWeek());
  setNum($('s-gym-month'), monthCount(now));

  // Racha en el menú lateral
  $('side-streak').textContent = `${streak} ${streak === 1 ? 'día' : 'días'}`;
  document.querySelector('.flame').classList.toggle('pulse', streak > 0);
}

$('home-gym-toggle').addEventListener('click', () => {
  const today = todayISO();
  if (state.gym[today]) {
    delete state.gym[today];
  } else {
    state.gym[today] = { type: 'Full body', minutes: 0, notes: '' };
    toast('¡Buen trabajo, a seguir así!');
  }
  saveState();
  renderAll();
});

// ================= Respaldo =================

$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mi-dia-respaldo-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  closeMenu();
  toast('Respaldo exportado');
});

$('import-btn').addEventListener('click', () => { closeMenu(); $('import-file').click(); });

$('import-file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.tasks) || !data.gym || typeof data.gym !== 'object') throw new Error('formato');
      if (!confirm('Esto reemplaza tus datos actuales con los del respaldo. ¿Continuar?')) return;
      state = {
        tasks: data.tasks,
        gym: data.gym,
        goal: Number.isInteger(data.goal) ? data.goal : 4,
      };
      saveState();
      selectedGymDate = null;
      toast('Respaldo importado');
      renderAll();
    } catch (e) {
      toast('Ese archivo no es un respaldo válido');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
});

// ================= Render general e inicio =================

function renderAll() {
  renderHome();
  renderTasks();
  renderGym();
}

function initApp() {
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch (e) { /* ignorar */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  applyTheme(theme);

  let tab = 'hoy';
  try { tab = localStorage.getItem(TAB_KEY) || 'hoy'; } catch (e) { /* ignorar */ }
  if (tab === 'tareas') tab = 'universidad'; // compatibilidad con la versión anterior
  if (!TAB_TITLES[tab]) tab = 'hoy';
  showTab(tab);

  // Reposicionar el indicador cuando las fuentes terminan de cargar
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
}

// ================= Conexión compartida Supabase =================
(function setupSharedCloud() {
  const url = window.MIDIA_SUPABASE_URL;
  const key = window.MIDIA_SUPABASE_PUBLISHABLE_KEY;
  if (!window.supabase || !url || !key || key === 'PEGA_AQUI_TU_CLAVE_PUBLICABLE') {
    console.error('Mi día: falta configurar la clave publicable en config.js.');
    toast('No se pudo conectar con la agenda compartida. Revisa config.js.');
    initApp();
    return;
  }
  supabaseClient = window.supabase.createClient(url, key);
  currentUser = { id: SHARED_UID };
  (async () => {
    try {
      await loadCloudState();
      initApp();
      // Refresca los cambios de otras personas mientras la página permanece abierta.
      setInterval(async () => {
        if (document.hidden || !supabaseClient) return;
        try {
          const [tasksRes, gymRes, prefRes] = await Promise.all([
            supabaseClient.from('tareas').select('*').eq('usuario_id', SHARED_UID),
            supabaseClient.from('entrenamientos').select('*').eq('usuario_id', SHARED_UID),
            supabaseClient.from('preferencias').select('*').eq('usuario_id', SHARED_UID).maybeSingle()
          ]);
          if (tasksRes.error) throw tasksRes.error;
          if (gymRes.error) throw gymRes.error;
          if (prefRes.error) throw prefRes.error;
          const remote = {
            tasks: (tasksRes.data || []).map(t => ({ id: t.id, title: t.titulo, notes: t.notas || '', due: t.fecha_limite || '', priority: t.prioridad || 'media', type: t.tipo || 'Tarea', course: t.materia || '', done: !!t.completada, doneAt: t.completada_en || null, createdAt: (t.creada_en || '').slice(0,10) || todayISO() })),
            gym: Object.fromEntries((gymRes.data || []).map(g => [g.fecha, { type: g.tipo || 'Full body', minutes: g.minutos || 0, notes: g.notas || '' }])),
            goal: prefRes.data ? prefRes.data.meta_semanal : 4
          };
          // No pisar cambios locales que todavía están pendientes de guardarse.
          if (!cloudSyncTimer) {
            state = remote;
            localStorage.setItem(KEY, JSON.stringify(state));
            renderAll();
          }
        } catch (err) { console.error('Error actualizando agenda compartida:', err); }
      }, 5000);
    } catch (err) {
      console.error('Error cargando agenda compartida:', err);
      initApp();
      toast('No se pudo cargar la agenda compartida. Revisa las políticas de Supabase.');
    }
  })();
})();
