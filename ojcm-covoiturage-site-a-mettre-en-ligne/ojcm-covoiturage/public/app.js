(function () {
'use strict';
var KINDS = { competition: 'Compétition', entrainement: 'Entraînement', stage: 'Stage', autre: 'Autre' };
var S = { data: null, fcity: 'all', fkind: 'all', err: false, mine: [], confirm: null };
var $ = function (s) { return document.querySelector(s); };
var dlg = $('#dlg'), dlgBody = $('#dlg-body');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function store(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(k));
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) { return null; }
}
function api(url, body) {
  return fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || 'Une erreur est survenue. Réessayez.'); e.status = r.status; throw e; }
      return j;
    });
  });
}
var toastTimer;
function toast(msg, bad) {
  var t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = 'toast'; }, 3500);
}
function dparts(date) {
  var d = new Date(date + 'T12:00:00');
  if (isNaN(d.getTime())) return { dow: '', day: '?', mon: '', long: date };
  return {
    dow: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
    day: d.getDate(),
    mon: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
    long: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  };
}
function plural(n, w) { return n + ' ' + w + (n > 1 ? 's' : ''); }
function fromLabel(t) { return t.from === 'Autre' ? (t.meet || 'Autre commune') : t.from; }
function cityClass(c) { return c === 'Sigean' ? 'sigean' : (c === 'Narbonne' ? 'narbonne' : ''); }
function telLink(p) { return '<a href="tel:' + esc(String(p).replace(/[^\d+]/g, '')) + '">' + esc(p) + '</a>'; }
function mats(total, used) {
  var h = '<span class="mats" role="img" aria-label="' + used + ' places réservées sur ' + total + '">';
  for (var i = 0; i < total; i++) h += '<i class="' + (i < used ? 'on' : '') + '"></i>';
  return h + '</span>';
}
function findEvent(id) { return S.data && S.data.events.filter(function (e) { return e.id === id; })[0]; }
function findTrip(id) {
  if (!S.data) return null;
  for (var i = 0; i < S.data.events.length; i++) {
    var t = S.data.events[i].trips.filter(function (x) { return x.id === id; })[0];
    if (t) return { trip: t, event: S.data.events[i] };
  }
  return null;
}

/* ---------- liste ---------- */
function tripRow(t) {
  var taken = t.seats - t.left;
  var act = t.left > 0
    ? '<button class="btn primary sm" type="button" data-act="book" data-trip="' + t.id + '">Réserver</button>'
    : '<span class="tag-full">Complet</span>';
  return '<div class="trip"><div class="who"><div class="top"><span class="chip ' + cityClass(t.from) + '">' + esc(fromLabel(t)) + '</span>' +
    '<b>Départ à ' + esc(t.time) + '</b><span class="muted">avec ' + esc(t.driver) + '</span></div>' +
    '<div class="line">' + mats(t.seats, taken) + '<span>' + (t.left > 0 ? plural(t.left, 'place') + ' libre' + (t.left > 1 ? 's' : '') : 'Complet') + ' sur ' + t.seats + '</span>' +
    (t.from !== 'Autre' && t.meet ? '<span>RDV : ' + esc(t.meet) + '</span>' : '') + '</div>' +
    (t.note ? '<div class="nt">' + esc(t.note) + '</div>' : '') + '</div>' + act + '</div>';
}
function eventCard(e) {
  var dp = dparts(e.date);
  var trips = e.trips.filter(function (t) { return S.fcity === 'all' || t.from === S.fcity; });
  var body = trips.length ? '<div class="trips">' + trips.map(tripRow).join('') + '</div>'
    : '<p class="no-trips">' + (S.fcity === 'all' ? 'Aucun trajet proposé pour l’instant. Soyez le premier !' : 'Aucun trajet au départ de ' + esc(S.fcity === 'Autre' ? 'd’une autre commune' : S.fcity) + ' pour l’instant.') + '</p>';
  return '<article class="ev" data-kind="' + esc(e.kind) + '"><div class="date"><span class="dow">' + esc(dp.dow) + '</span><span class="day">' + esc(dp.day) + '</span><span class="mon">' + esc(dp.mon) + '</span></div>' +
    '<div class="ev-body"><div class="ev-head"><div><h3>' + esc(e.title) + '</h3>' +
    '<div class="ev-meta"><span class="kind">' + esc(KINDS[e.kind] || 'Autre') + '</span>' + (e.time ? esc(e.time) + ' · ' : '') + esc(e.place) + '</div>' +
    (e.info ? '<div class="ev-meta">' + esc(e.info) + '</div>' : '') + '</div>' +
    '<button class="btn sun sm" type="button" data-act="offer" data-ev="' + e.id + '">Proposer un trajet</button></div>' + body + '</div></article>';
}
function renderEvents() {
  var box = $('#events');
  if (S.err && !S.data) { box.innerHTML = '<div class="empty"><h3>Connexion impossible</h3><p class="muted">Les trajets ne se chargent pas. Vérifiez votre connexion puis rechargez la page.</p></div>'; return; }
  if (!S.data) return;
  var a = S.data.announcement;
  $('#announce').innerHTML = a ? '<div class="announce"><span class="sun" aria-hidden="true"></span><div><b>Information du club</b><p>' + esc(a) + '</p></div></div>' : '';
  var evs = S.data.events.filter(function (e) { return S.fkind === 'all' || e.kind === S.fkind; });
  if (!evs.length) {
    box.innerHTML = '<div class="empty"><h3>Aucun rendez-vous à venir</h3><p class="muted">Le club publie ici les prochaines compétitions, stages et entraînements. Revenez bientôt.</p></div>';
    return;
  }
  box.innerHTML = evs.map(eventCard).join('');
}
function renderFilters() {
  document.querySelectorAll('[data-act="fcity"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === S.fcity)); });
}
function load() {
  return api('/api/events').then(function (d) { S.data = d; S.err = false; renderEvents(); })
    .catch(function () { S.err = true; renderEvents(); });
}

/* ---------- fenêtre ---------- */
function openDlg(html) {
  dlgBody.innerHTML = html;
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
}
function closeDlg() { if (dlg.open) dlg.close(); S.confirm = null; }
function head(title) {
  return '<div class="dlg-top"><h2 id="dlg-title">' + esc(title) + '</h2><button class="x" type="button" data-act="close" aria-label="Fermer">×</button></div>';
}
function contact() { return store('ojcm-contact') || { name: '', phone: '' }; }
function saveCode(code) {
  var list = store('ojcm-codes') || [];
  if (list.indexOf(code) < 0) list.push(code);
  store('ojcm-codes', list);
}
function codePanel(code) {
  return '<div class="codebox"><span class="small muted">Votre code d’annulation</span><span class="code">' + esc(code) + '</span>' +
    '<span class="small muted">Gardez-le : il permet de retrouver ou d’annuler. Il est aussi mémorisé dans ce navigateur (bouton « Retrouver ma réservation »).</span></div>';
}

function openOffer(evId) {
  var e = findEvent(evId); if (!e) return;
  var c = contact(), def = S.fcity !== 'all' ? S.fcity : 'Sigean', o = '';
  ['Sigean', 'Narbonne', 'Autre'].forEach(function (v) { o += '<option value="' + v + '"' + (v === def ? ' selected' : '') + '>' + (v === 'Autre' ? 'Autre commune' : v) + '</option>'; });
  openDlg(head('Proposer un trajet') +
    '<div class="ctx"><b>' + esc(e.title) + '</b><br>' + esc(dparts(e.date).long) + ' · ' + esc(e.place) + '</div>' +
    '<form class="form" data-form="offer" data-ev="' + e.id + '" novalidate>' +
    '<label>Votre nom<input id="f-name" required maxlength="60" autocomplete="name" value="' + esc(c.name) + '"></label>' +
    '<label>Téléphone<input id="f-phone" type="tel" required maxlength="20" autocomplete="tel" value="' + esc(c.phone) + '"></label>' +
    '<label>Départ de<select id="f-from">' + o + '</select></label>' +
    '<label>Heure de départ<input id="f-time" type="time" required></label>' +
    '<label class="wide">Point de rendez-vous<input id="f-meet" maxlength="80" placeholder="Ex. parking du dojo, devant la gare"></label>' +
    '<label>Places libres<select id="f-seats">' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option' + (n === 3 ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
    '<label class="wide">Précisions (facultatif)<input id="f-note" maxlength="200" placeholder="Retour prévu vers 18 h, kimonos dans le coffre…"></label>' +
    '<input class="hp" id="f-web" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<p class="err" id="f-err" role="alert"></p>' +
    '<p class="small muted wide" style="grid-column:1/-1">Votre téléphone n’est montré qu’aux personnes qui réservent une place chez vous, et à l’administrateur du club.</p>' +
    '<div class="btns"><button class="btn primary" type="submit">Publier mon trajet</button><button class="btn" type="button" data-act="close">Annuler</button></div></form>');
}
function openBook(tripId) {
  var f = findTrip(tripId); if (!f) { toast('Ce trajet n’existe plus.', true); return; }
  var t = f.trip, e = f.event, c = contact(), o = '';
  for (var i = 1; i <= Math.min(t.left, 8); i++) o += '<option value="' + i + '">' + plural(i, 'place') + '</option>';
  openDlg(head('Réserver une place') +
    '<div class="ctx"><b>' + esc(e.title) + '</b> · ' + esc(dparts(e.date).long) + '<br>Départ ' + esc(fromLabel(t)) + ' à ' + esc(t.time) + ' avec ' + esc(t.driver) + '</div>' +
    '<form class="form" data-form="book" data-trip="' + t.id + '" novalidate>' +
    '<label>Votre nom<input id="f-name" required maxlength="60" autocomplete="name" value="' + esc(c.name) + '"></label>' +
    '<label>Téléphone<input id="f-phone" type="tel" required maxlength="20" autocomplete="tel" value="' + esc(c.phone) + '"></label>' +
    '<label>Places<select id="f-seats">' + o + '</select></label>' +
    '<label>Judoka(s) concerné(s)<input id="f-judoka" maxlength="100" placeholder="Prénom du judoka"></label>' +
    '<input class="hp" id="f-web" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<p class="err" id="f-err" role="alert"></p>' +
    '<div class="btns"><button class="btn primary" type="submit">Confirmer ma réservation</button><button class="btn" type="button" data-act="close">Annuler</button></div></form>');
}

/* ---------- mes réservations ---------- */
function openMine() {
  openDlg(head('Ma réservation ou mon trajet') + '<div id="mine-list"><p class="muted">Chargement…</p></div>' +
    '<form class="form" data-form="code" style="margin-top:6px" novalidate><label class="wide">Retrouver avec un code' +
    '<input id="f-code" maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="Ex. K7M2QX"></label>' +
    '<p class="err" id="f-err" role="alert"></p><div class="btns"><button class="btn primary" type="submit">Retrouver</button></div></form>');
  loadMine();
}
function loadMine() {
  var codes = store('ojcm-codes') || [];
  Promise.all(codes.map(function (c) {
    return api('/api/manage', { code: c }).then(function (r) { return { code: c, r: r }; }, function (e) { return { code: c, r: e.status === 404 ? null : undefined }; });
  })).then(function (list) {
    var keep = list.filter(function (x) { return x.r !== null; });
    store('ojcm-codes', keep.map(function (x) { return x.code; }));
    S.mine = keep.filter(function (x) { return x.r; });
    renderMine();
  });
}
function renderMine() {
  var box = $('#mine-list'); if (!box) return;
  if (!S.mine.length) { box.innerHTML = '<p class="muted" style="margin-bottom:14px">Aucune réservation ni aucun trajet enregistré sur cet appareil.</p>'; return; }
  box.innerHTML = S.mine.map(function (x) {
    var r = x.r, ev = r.event, h;
    var when = ev ? '<h3>' + esc(ev.title) + '</h3><div class="small muted">' + esc(dparts(ev.date).long) + ' · ' + esc(ev.place) + '</div>' : '<h3>Rendez-vous supprimé</h3>';
    var del = '<button class="btn danger sm" type="button" data-act="del" data-code="' + esc(x.code) + '">' + (S.confirm === x.code ? 'Confirmer la suppression' : (r.kind === 'trip' ? 'Supprimer mon trajet' : 'Annuler ma réservation')) + '</button>';
    if (r.kind === 'trip') {
      var t = r.trip;
      h = '<div class="mine-item">' + when + '<p style="margin-top:8px"><b>Mon trajet</b> · ' + esc(fromLabel(t)) + ' à ' + esc(t.time) + ' · ' + plural(t.left, 'place') + ' libre' + (t.left > 1 ? 's' : '') + ' sur ' + t.seats + '</p>' +
        (t.passengers.length ? '<ul>' + t.passengers.map(function (p) { return '<li><b>' + esc(p.name) + '</b> · ' + plural(p.seats, 'place') + ' · ' + telLink(p.phone) + (p.judoka ? ' · ' + esc(p.judoka) : '') + '</li>'; }).join('') + '</ul>' : '<p class="small muted">Aucun passager pour l’instant.</p>') +
        '<div class="row"><span class="small muted">Code : <b>' + esc(x.code) + '</b></span>' + del + '</div></div>';
    } else {
      var t2 = r.trip, d = r.driver;
      h = '<div class="mine-item">' + when + '<p style="margin-top:8px"><b>Ma réservation</b> · ' + plural(r.booking.seats, 'place') + (t2 ? ' · départ ' + esc(fromLabel(t2)) + ' à ' + esc(t2.time) : '') + '</p>' +
        (d ? '<div class="contact" style="margin-top:8px">Conducteur : ' + esc(d.name) + ' · ' + telLink(d.phone) + '</div>' : '<p class="small muted">Ce trajet n’existe plus.</p>') +
        '<div class="row"><span class="small muted">Code : <b>' + esc(x.code) + '</b></span>' + del + '</div></div>';
    }
    return h;
  }).join('');
}

/* ---------- actions ---------- */
var A = {
  fcity: function (el) { S.fcity = el.dataset.v; renderFilters(); renderEvents(); },
  offer: function (el) { openOffer(el.dataset.ev); },
  book: function (el) { openBook(el.dataset.trip); },
  close: closeDlg,
  mine: openMine,
  del: function (el) {
    var code = el.dataset.code;
    if (S.confirm !== code) { S.confirm = code; renderMine(); return; }
    S.confirm = null;
    api('/api/delete', { code: code }).then(function () {
      var list = (store('ojcm-codes') || []).filter(function (c) { return c !== code; });
      store('ojcm-codes', list);
      toast('C’est supprimé.');
      loadMine(); load();
    }).catch(function (e) { toast(e.message, true); });
  }
};
document.addEventListener('click', function (ev) {
  if (ev.target === dlg) { closeDlg(); return; }
  var el = ev.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act !== 'del') S.confirm = null;
  if (A[el.dataset.act]) A[el.dataset.act](el);
});
$('#f-kind').addEventListener('change', function (e) { S.fkind = e.target.value; renderEvents(); });
dlg.addEventListener('close', function () { S.confirm = null; });

function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function fail(msg) { var e = $('#f-err'); if (e) e.textContent = msg; }
document.addEventListener('submit', function (ev) {
  var f = ev.target; if (!f.dataset || !f.dataset.form) return;
  ev.preventDefault();
  var k = f.dataset.form, btn = f.querySelector('[type=submit]');
  fail('');
  if (k === 'code') {
    var code = val('f-code').toUpperCase().replace(/\s/g, '');
    if (code.length < 4) { fail('Saisissez le code reçu.'); return; }
    btn.disabled = true;
    api('/api/manage', { code: code }).then(function () { saveCode(code); $('#f-code').value = ''; loadMine(); })
      .catch(function (e) { fail(e.message); }).then(function () { btn.disabled = false; });
    return;
  }
  var name = val('f-name'), phone = val('f-phone');
  if (name.length < 2) { fail('Indiquez votre nom.'); return; }
  if ((phone.match(/\d/g) || []).length < 8) { fail('Indiquez un numéro de téléphone valide.'); return; }
  btn.disabled = true;
  if (k === 'offer') {
    var from = val('f-from'), meet = val('f-meet'), time = val('f-time');
    if (!time) { fail('Indiquez l’heure de départ.'); btn.disabled = false; return; }
    if (from === 'Autre' && !meet) { fail('Précisez le point de départ.'); btn.disabled = false; return; }
    api('/api/trips', { eventId: f.dataset.ev, name: name, phone: phone, from: from, meet: meet, time: time, seats: val('f-seats'), note: val('f-note'), website: val('f-web') })
      .then(function (r) {
        store('ojcm-contact', { name: name, phone: phone }); saveCode(r.code);
        openDlg(head('Trajet publié') + '<p>Merci ! Votre trajet est visible par tout le club. Les familles qui réservent vous verront dans « Retrouver ma réservation », avec leur téléphone.</p>' + codePanel(r.code) +
          '<div class="btns"><button class="btn primary" type="button" data-act="close">Terminer</button></div>');
        load();
      }).catch(function (e) { fail(e.message); btn.disabled = false; });
  } else if (k === 'book') {
    api('/api/bookings', { tripId: f.dataset.trip, name: name, phone: phone, seats: val('f-seats'), judoka: val('f-judoka'), website: val('f-web') })
      .then(function (r) {
        store('ojcm-contact', { name: name, phone: phone }); saveCode(r.code);
        openDlg(head('Place réservée') + '<div class="contact">Conducteur : ' + esc(r.driver.name) + ' · ' + telLink(r.driver.phone) + '</div>' +
          '<p>Contactez le conducteur pour confirmer le point de rendez-vous.</p>' + codePanel(r.code) +
          '<div class="btns"><button class="btn primary" type="button" data-act="close">Terminer</button></div>');
        load();
      }).catch(function (e) { fail(e.message); btn.disabled = false; if (e.status === 409) load(); });
  }
});

load();
setInterval(function () { if (!dlg.open && !document.hidden) load(); }, 90000);
})();
