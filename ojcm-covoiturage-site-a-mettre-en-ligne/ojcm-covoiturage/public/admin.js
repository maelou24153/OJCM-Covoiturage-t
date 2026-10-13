(function () {
'use strict';
var KINDS = { competition: 'Compétition', entrainement: 'Entraînement', stage: 'Stage', autre: 'Autre' };
var S = { admin: false, configured: true, data: null, tab: 'vue', edit: null, confirm: null, err: '' };
var $ = function (s) { return document.querySelector(s); };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function api(method, url, body) {
  var opts = { method: method, headers: { 'Content-Type': 'application/json', 'X-OJCM': '1' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401 && url !== '/api/admin/login') { S.admin = false; render(); }
      if (!r.ok) { var e = new Error(j.error || 'Une erreur est survenue.'); e.status = r.status; throw e; }
      return j;
    });
  });
}
var tt;
function toast(msg, bad) {
  var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(tt); tt = setTimeout(function () { t.className = 'toast'; }, 3500);
}
function dlong(date) {
  var d = new Date(date + 'T12:00:00');
  return isNaN(d.getTime()) ? date : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fromLabel(t) { return t.from === 'Autre' ? (t.meet || 'Autre commune') : t.from; }
function evById(id) { return S.data.events.filter(function (e) { return e.id === id; })[0]; }
function telLink(p) { return '<a href="tel:' + esc(String(p).replace(/[^\d+]/g, '')) + '">' + esc(p) + '</a>'; }
function cf(key, label) { return S.confirm === key ? 'Confirmer ?' : label; }

function load() {
  return api('GET', '/api/admin/data').then(function (d) { S.data = d; render(); }).catch(function () {});
}
function stats() {
  var t0 = S.data.today, ids = {}, offered = 0, taken = 0, by = { Sigean: [0, 0], Narbonne: [0, 0], Autre: [0, 0] };
  var evs = S.data.events.filter(function (e) { return e.date >= t0; });
  evs.forEach(function (e) { ids[e.id] = 1; });
  var trips = S.data.trips.filter(function (t) { return ids[t.eventId]; });
  trips.forEach(function (t) {
    var b = t.seats - t.left; offered += t.seats; taken += b;
    var k = by[t.from] ? t.from : 'Autre'; by[k][0] += t.seats; by[k][1] += b;
  });
  return { events: evs.length, trips: trips.length, offered: offered, taken: taken, by: by };
}

/* ---------- vues ---------- */
function loginView() {
  return '<div class="login"><h1>Espace administrateur</h1><p class="muted">Réservé aux responsables du club.</p>' +
    (S.configured ? '' : '<p class="err" style="margin-top:12px">Le mot de passe n’est pas configuré sur le serveur (variable ADMIN_PASSWORD).</p>') +
    '<form class="form" data-form="login"><label>Mot de passe<input id="pw" type="password" autocomplete="current-password" required></label>' +
    '<p class="err" id="err" role="alert">' + esc(S.err) + '</p><div class="btns"><button class="btn primary" type="submit">Se connecter</button><a class="btn" href="/">Retour au site</a></div></form></div>';
}
function vueView() {
  var st = stats(), pct = st.offered ? Math.round(100 * st.taken / st.offered) : 0;
  var h = '<div class="kpis"><div class="kpi"><b>' + st.events + '</b><span>rendez-vous à venir</span></div>' +
    '<div class="kpi"><b>' + st.trips + '</b><span>trajets proposés</span></div>' +
    '<div class="kpi"><b>' + st.taken + ' / ' + st.offered + '</b><span>places réservées</span></div>' +
    '<div class="kpi"><b>' + pct + ' %</b><span>taux de remplissage</span></div></div><div class="bars">';
  ['Sigean', 'Narbonne', 'Autre'].forEach(function (c) {
    var v = st.by[c], w = v[0] ? Math.round(100 * v[1] / v[0]) : 0;
    h += '<div class="bar"><span>' + (c === 'Autre' ? 'Autres communes' : c) + '</span><div class="track"><div class="fill" style="width:' + w + '%"></div></div><span class="v">' + v[1] + ' / ' + v[0] + '</span></div>';
  });
  return h + '</div><p class="muted">Les chiffres concernent les rendez-vous à venir. Le détail des trajets, avec les téléphones, est dans l’onglet Trajets.</p>';
}
function eventForm() {
  var cur = S.edit && S.edit !== 'new' ? evById(S.edit) : null;
  cur = cur || { title: '', kind: 'competition', date: '', time: '', place: '', info: '' };
  var o = '';
  Object.keys(KINDS).forEach(function (k) { o += '<option value="' + k + '"' + (cur.kind === k ? ' selected' : '') + '>' + KINDS[k] + '</option>'; });
  return '<form class="form panel" data-form="event">' +
    '<label class="wide">Intitulé<input id="ev-title" required maxlength="90" value="' + esc(cur.title) + '" placeholder="Tournoi, stage, entraînement…"></label>' +
    '<label>Type<select id="ev-kind">' + o + '</select></label>' +
    '<label>Date<input id="ev-date" type="date" required value="' + esc(cur.date) + '"></label>' +
    '<label>Heure (facultatif)<input id="ev-time" type="time" value="' + esc(cur.time || '') + '"></label>' +
    '<label>Lieu<input id="ev-place" required maxlength="90" value="' + esc(cur.place) + '" placeholder="Salle ou gymnase, ville"></label>' +
    '<label class="wide">Information complémentaire (facultatif)<input id="ev-info" maxlength="200" value="' + esc(cur.info || '') + '" placeholder="Convocation à 8 h, pesée, repas…"></label>' +
    '<p class="err" id="err" role="alert"></p><div class="btns"><button class="btn primary" type="submit">' + (cur.title ? 'Enregistrer' : 'Publier le rendez-vous') + '</button>' +
    '<button class="btn" type="button" data-act="evcancel">Annuler</button></div></form>';
}
function rdvView() {
  var h = '<div class="sec-head" style="margin-top:6px"><h2 class="t">Rendez-vous</h2>' + (S.edit ? '' : '<button class="btn sun" data-act="evnew">Ajouter un rendez-vous</button>') + '</div>';
  if (S.edit) h += eventForm();
  var evs = S.data.events.slice().sort(function (a, b) { return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')); });
  if (!evs.length) return h + '<div class="empty"><h3>Aucun rendez-vous</h3><p class="muted">Ajoutez le premier pour ouvrir les inscriptions de trajets.</p></div>';
  h += '<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Intitulé</th><th>Type</th><th>Lieu</th><th>Trajets</th><th></th></tr></thead><tbody>';
  evs.forEach(function (e) {
    var n = S.data.trips.filter(function (t) { return t.eventId === e.id; }).length;
    h += '<tr><td class="nw">' + esc(dlong(e.date)) + (e.time ? ' · ' + esc(e.time) : '') + (e.date < S.data.today ? ' <span class="small muted">(passé)</span>' : '') + '</td>' +
      '<td>' + esc(e.title) + '</td><td>' + esc(KINDS[e.kind] || 'Autre') + '</td><td>' + esc(e.place) + '</td><td>' + n + '</td>' +
      '<td><div class="acts"><button class="btn sm" data-act="evedit" data-id="' + e.id + '">Modifier</button>' +
      '<button class="btn danger sm" data-act="evdel" data-cf="1" data-id="' + e.id + '">' + cf('e:' + e.id, 'Supprimer') + '</button></div></td></tr>';
  });
  return h + '</tbody></table></div><p class="small muted">Supprimer un rendez-vous supprime aussi ses trajets et réservations.</p>';
}
function trajetsView() {
  var h = '<div class="sec-head" style="margin-top:6px"><h2 class="t">Trajets</h2><a class="btn" href="/api/admin/export.csv">Exporter en CSV</a></div>';
  var trips = S.data.trips.slice().sort(function (a, b) {
    var ea = evById(a.eventId), eb = evById(b.eventId);
    return ((ea && ea.date) || '').localeCompare((eb && eb.date) || '') || a.time.localeCompare(b.time);
  });
  if (!trips.length) return h + '<div class="empty"><h3>Aucun trajet</h3><p class="muted">Les trajets proposés par les familles apparaîtront ici.</p></div>';
  h += '<div class="tbl-wrap"><table><thead><tr><th>Rendez-vous</th><th>Conducteur</th><th>Départ</th><th>Places</th><th>Passagers</th><th></th></tr></thead><tbody>';
  trips.forEach(function (t) {
    var e = evById(t.eventId);
    h += '<tr><td>' + (e ? esc(e.title) + '<br><span class="small muted">' + esc(dlong(e.date)) + '</span>' : '<span class="muted">Rendez-vous supprimé</span>') + '</td>' +
      '<td>' + esc(t.name) + '<br>' + telLink(t.phone) + '</td><td class="nw">' + esc(fromLabel(t)) + '<br>' + esc(t.time) + '</td>' +
      '<td class="nw">' + (t.seats - t.left) + ' / ' + t.seats + '</td><td>' +
      (t.passengers.length ? t.passengers.map(function (p) {
        return '<div style="margin-bottom:6px"><b>' + esc(p.name) + '</b> (' + p.seats + ') ' + telLink(p.phone) + (p.judoka ? '<br><span class="small muted">' + esc(p.judoka) + '</span>' : '') +
          ' <button class="btn danger sm" data-act="bkdel" data-cf="1" data-id="' + p.id + '">' + cf('b:' + p.id, 'Retirer') + '</button></div>';
      }).join('') : '<span class="muted">Aucun</span>') + '</td>' +
      '<td><button class="btn danger sm" data-act="tripdel" data-cf="1" data-id="' + t.id + '">' + cf('t:' + t.id, 'Supprimer') + '</button></td></tr>';
  });
  return h + '</tbody></table></div>';
}
function messageView() {
  return '<div class="sec-head" style="margin-top:6px"><h2 class="t">Information du club</h2></div>' +
    '<p class="muted" style="margin-bottom:12px">Ce message s’affiche en haut de la page des trajets. Laissez vide pour le retirer.</p>' +
    '<form class="form panel" data-form="ann"><label class="wide">Message<textarea id="an" rows="4" maxlength="400">' + esc((S.data.settings && S.data.settings.announcement) || '') + '</textarea></label>' +
    '<div class="btns"><button class="btn primary" type="submit">Publier le message</button></div></form>';
}
function render() {
  var top = $('#top-actions'), app = $('#app');
  if (!S.admin) { top.innerHTML = '<a class="btn ghost sm" href="/">Retour au site</a>'; app.innerHTML = loginView(); return; }
  top.innerHTML = '<a class="btn ghost sm" href="/">Voir le site</a><button class="btn ghost sm" data-act="logout">Se déconnecter</button>';
  if (!S.data) { app.innerHTML = '<p class="muted" style="padding-top:20px">Chargement…</p>'; return; }
  var tabs = [['vue', 'Vue d’ensemble'], ['rdv', 'Rendez-vous'], ['trajets', 'Trajets'], ['msg', 'Message']];
  var saved = {};
  document.querySelectorAll('#app input[id],#app select[id],#app textarea[id]').forEach(function (el) { saved[el.id] = el.value; });
  app.innerHTML = '<nav class="tabs" role="tablist" aria-label="Sections">' + tabs.map(function (t) {
    return '<button class="tab" role="tab" data-act="tab" data-v="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>';
  }).join('') + '</nav><div style="padding-top:12px">' + (S.tab === 'vue' ? vueView() : S.tab === 'rdv' ? rdvView() : S.tab === 'trajets' ? trajetsView() : messageView()) + '</div>';
  if (!S.fresh) Object.keys(saved).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = saved[id]; });
  S.fresh = false;
}
function confirmed(key) {
  if (S.confirm !== key) { S.confirm = key; render(); return false; }
  S.confirm = null; return true;
}

/* ---------- actions ---------- */
function done(msg) { toast(msg); return load(); }
function fail(e) { toast(e.message, true); }
var A = {
  tab: function (el) { S.tab = el.dataset.v; S.edit = null; S.fresh = true; render(); },
  logout: function () { api('POST', '/api/admin/logout').then(function () { S.admin = false; S.data = null; render(); }); },
  evnew: function () { S.edit = 'new'; S.fresh = true; render(); },
  evedit: function (el) { S.edit = el.dataset.id; S.fresh = true; render(); },
  evcancel: function () { S.edit = null; S.fresh = true; render(); },
  evdel: function (el) { var id = el.dataset.id; if (!confirmed('e:' + id)) return; api('DELETE', '/api/admin/events/' + id).then(function () { return done('Rendez-vous supprimé.'); }).catch(fail); },
  tripdel: function (el) { var id = el.dataset.id; if (!confirmed('t:' + id)) return; api('DELETE', '/api/admin/trips/' + id).then(function () { return done('Trajet supprimé.'); }).catch(fail); },
  bkdel: function (el) { var id = el.dataset.id; if (!confirmed('b:' + id)) return; api('DELETE', '/api/admin/bookings/' + id).then(function () { return done('Réservation retirée.'); }).catch(fail); }
};
document.addEventListener('click', function (ev) {
  var el = ev.target.closest('[data-act]'); if (!el) return;
  if (!el.dataset.cf) S.confirm = null;
  if (A[el.dataset.act]) A[el.dataset.act](el);
});
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function showErr(m) { var e = $('#err'); if (e) e.textContent = m; }
document.addEventListener('submit', function (ev) {
  var f = ev.target; if (!f.dataset || !f.dataset.form) return;
  ev.preventDefault();
  var k = f.dataset.form, btn = f.querySelector('[type=submit]');
  if (k === 'login') {
    btn.disabled = true; showErr('');
    api('POST', '/api/admin/login', { password: $('#pw').value }).then(function () {
      S.admin = true; S.err = ''; render(); return load();
    }).catch(function (e) { S.err = e.message; showErr(e.message); }).then(function () { btn.disabled = false; });
  } else if (k === 'event') {
    var e = { title: val('ev-title'), kind: val('ev-kind'), date: val('ev-date'), time: val('ev-time'), place: val('ev-place'), info: val('ev-info') };
    if (!e.title || !e.date || !e.place) { showErr('Renseignez l’intitulé, la date et le lieu.'); return; }
    var id = S.edit; btn.disabled = true;
    (id && id !== 'new' ? api('PUT', '/api/admin/events/' + id, e) : api('POST', '/api/admin/events', e)).then(function () {
      S.edit = null; S.fresh = true; return done('Rendez-vous enregistré.');
    }).catch(function (x) { showErr(x.message); btn.disabled = false; });
  } else if (k === 'ann') {
    btn.disabled = true;
    api('PUT', '/api/admin/settings', { announcement: val('an') }).then(function (r) {
      S.data.settings = r.settings; toast('Message enregistré.'); render();
    }).catch(fail).then(function () { btn.disabled = false; });
  }
});

api('GET', '/api/admin/me').then(function (r) {
  S.admin = r.admin; S.configured = r.configured; render();
  if (S.admin) load();
}).catch(function () { S.err = 'Serveur injoignable.'; render(); });
})();
