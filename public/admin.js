/* Admin page behavior. The `?c=` token lives in location.search and JS memory
   only (never a cookie, never in the markup); every write re-reads it here.
   The Worker serves this page only behind a live token, so a missing c= means
   a stale tab - lock straight away. */
(function () {
  var c = new URLSearchParams(location.search).get('c');
  var actions = document.getElementById('actions');

  function lock() {
    document.body.classList.add('locked');
  }

  if (!c || !actions) { lock(); return; }

  /* Countdown: exp rides inside the token (v<n>.<exp>.<sig>). Zero degrades
     to the locked fs-index; the server enforces the same clock. */
  var badge = document.querySelector('[data-countdown]');
  var exp = parseInt(c.split('.')[1], 10) || 0;

  function tick() {
    var left = Math.max(0, exp - Math.floor(Date.now() / 1000));
    var m = Math.floor(left / 60), s = ('0' + (left % 60)).slice(-2);
    if (badge) badge.textContent = 'this link: ' + m + ':' + s + ' left';
    if (!left) lock();
  }
  tick();
  setInterval(tick, 1000);

  /* Sliding window: each config write answers a fresh token; adopt it so the
     address bar, the next write, and the countdown all agree. */
  function adopt(fresh) {
    c = fresh;
    exp = parseInt(c.split('.')[1], 10) || 0;
    history.replaceState(null, '', location.pathname + '?c=' + c);
    tick();
  }

  function copied(el, done, redo) {
    el.classList.add('did');
    if (done) el.textContent = done;
    setTimeout(function () {
      el.classList.remove('did');
      if (redo) el.textContent = redo;
    }, 1200);
  }

  var copylink = document.querySelector('[data-copylink]');
  if (copylink) {
    copylink.addEventListener('click', function () {
      navigator.clipboard.writeText(copylink.dataset.url).then(function () {
        copied(copylink, 'copied', 'copy link');
      });
    });
  }

  /* The corner icon copies; the card itself opens. Keep the two apart. */
  document.querySelectorAll('[data-copy-href]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(b.closest('a').href).then(function () {
        copied(b);
      });
    });
  });

  function expText(at) {
    if (at === null) return 'never expires';
    var left = at - Math.floor(Date.now() / 1000);
    if (left >= 86400) return 'expires in ' + Math.ceil(left / 86400) + 'd';
    if (left >= 3600) return 'expires in ' + Math.ceil(left / 3600) + 'h';
    return 'expires in ' + Math.max(1, Math.ceil(left / 60)) + 'm';
  }

  document.querySelectorAll('[data-ttl]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      fetch(location.pathname + 'config?c=' + c, {
        method: 'POST',
        body: JSON.stringify({ ttl: chip.dataset.ttl }),
      }).then(function (r) {
        if (r.status === 401) { lock(); return null; }
        return r.ok ? r.json() : null;
      }).then(function (out) {
        if (!out) return;
        adopt(out.c);
        document.querySelectorAll('[data-ttl]').forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === chip));
        });
        var el = document.querySelector('[data-exp]');
        if (el) el.textContent = expText(out.expiresAt);
      });
    });
  });

  /* Delete: the confirm replaces the whole action row, so copy is gone while
     it is armed. DELETE, never GET - link scanners prefetch. */
  var arm = document.querySelector('[data-arm]');
  var disarm = document.querySelector('[data-disarm]');
  var fire = document.querySelector('[data-fire]');
  if (arm) arm.addEventListener('click', function () { actions.classList.add('arming'); });
  if (disarm) disarm.addEventListener('click', function () { actions.classList.remove('arming'); });
  if (fire) {
    fire.addEventListener('click', function () {
      fetch(location.pathname + '?c=' + c, { method: 'DELETE' }).then(function (r) {
        if (r.status === 401) { lock(); return; }
        if (r.status === 204 || r.status === 404) {
          actions.innerHTML = '<p class="confirmtext" style="display:block">Moved to trash. '
            + 'The link dies within 10 minutes and purges in 90 days.</p>';
        }
      });
    });
  }
})();
