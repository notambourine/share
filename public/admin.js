/* Admin page behavior. The `?c=` token lives in location.search and JS memory
   only (never a cookie, never in the markup); every write re-reads it here.
   The Worker serves this page only behind a live token, so a missing c= means
   a stale tab - lock straight away. */
(function () {
  var c = new URLSearchParams(location.search).get('c');
  var actions = document.getElementById('actions');

  function lock() {
    document.body.classList.add('locked');
    stopPoll();
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

  /* Status poll: the route is pure reads, so polling can never spend a
     browser minute. 3s while any awaited render is missing; stops when
     everything landed and each slides source has its check, on 401, or at
     2 minutes. Ready is silent - only generating and overflow get chrome. */
  var awaited = document.querySelectorAll('[data-await]');
  var pollTimer = null;
  var polled = 0;

  function stopPoll() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    // A spinner that outlives the poll would lie; leave the overflow chips.
    document.querySelectorAll('.tstate.gen').forEach(function (st) {
      st.className = 'tstate';
      st.textContent = '';
    });
  }

  /* Click-to-generate tiles (uploaded HTML, nothing prerenders them): until
     clicked they read "click to generate" and never hold the poll open. */
  var requested = new Set();

  function paint(sources) {
    var byPath = new Map();
    sources.forEach(function (s) { byPath.set(s.path, s); });
    var settled = true;
    awaited.forEach(function (tile) {
      var s = byPath.get(tile.dataset.src);
      var st = tile.querySelector('.tstate');
      if (!s || !st) return;
      var key = tile.dataset.await;
      var ready = key === 'html'
        ? s.rendered.some(function (r) { return r.slice(-5) === '.html'; })
        : s.rendered.indexOf(key) !== -1;
      var slides = key.indexOf('slides.') === 0;
      if (slides && s.check && s.check.overflow.length) {
        var n = s.check.overflow;
        st.className = 'tstate err';
        st.textContent = n.length === 1
          ? 'slide ' + n[0] + ' overflows'
          : 'slides ' + n.join(', ') + ' overflow';
      } else if (ready) {
        st.className = 'tstate';
        st.textContent = '';
      } else if (tile.dataset.gen && !requested.has(tile)) {
        st.className = 'tstate todo';
        st.textContent = 'click to generate';
      } else {
        st.className = 'tstate gen';
        st.textContent = 'generating';
        settled = false;
      }
      if (slides && !s.check) settled = false;
    });
    return settled;
  }

  function poll() {
    fetch(location.pathname + 'status?c=' + c).then(function (r) {
      if (r.status === 401) { lock(); return null; }
      return r.ok ? r.json() : null;
    }).then(function (out) {
      // pollTimer gone = capped or settled while this answer was in flight.
      if (out && pollTimer && paint(out.sources)) stopPoll();
    }).catch(function () {});
    polled += 3000;
    if (polled > 120000) stopPoll();
  }

  if (awaited.length) { pollTimer = setInterval(poll, 3000); poll(); }

  /* The tab's own GET fires the render (the tile stays a real anchor); here
     only mark it pending and wake the poll back up. */
  awaited.forEach(function (tile) {
    if (!tile.dataset.gen) return;
    tile.addEventListener('click', function () {
      requested.add(tile);
      var st = tile.querySelector('.tstate');
      if (st) { st.className = 'tstate gen'; st.textContent = 'generating'; }
      polled = 0;
      if (!pollTimer) pollTimer = setInterval(poll, 3000);
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
