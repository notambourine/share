/* Client-side rendering for share shells. The Worker only emits markup;
   highlighting, markdown, and slides happen here (vendored libs, no CDN). */
(function () {
  var body = document.body;
  var kind = body.dataset.kind;
  var raw = body.dataset.raw;

  var copy = document.querySelector('[data-copy]');
  if (copy) {
    copy.addEventListener('click', function () {
      var url = location.origin + location.pathname;
      navigator.clipboard.writeText(url).then(function () {
        copy.textContent = 'copied';
        setTimeout(function () { copy.textContent = 'copy link'; }, 1500);
      });
    });
  }

  if (!kind || !raw) return;

  function withText(fn) {
    fetch(raw).then(function (r) { return r.text(); }).then(fn);
  }

  function highlightAll(root) {
    if (!window.hljs) return;
    root.querySelectorAll('pre code').forEach(function (el) {
      try { window.hljs.highlightElement(el); } catch { /* plain text is fine */ }
    });
  }

  if (kind === 'code') {
    withText(function (text) {
      var el = document.getElementById('content');
      el.textContent = text;
      var name = decodeURIComponent(location.pathname.split('/').pop() || '');
      var dot = name.lastIndexOf('.');
      if (dot > 0) el.className = 'language-' + name.slice(dot + 1).toLowerCase();
      if (window.hljs) {
        try { window.hljs.highlightElement(el); } catch { /* plain text is fine */ }
      }
    });
  }

  /* A hand copy of splitFrontMatter in src/lib/exportPath.ts - this file has
     no build step to import it. tests/frontmatter.test.ts holds them together. */
  function stripFront(text) {
    if (!/^---[ \t]*\r?\n/.test(text)) return text;
    var end = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text.slice(3));
    return end ? text.slice(3 + end.index + end[0].length) : text;
  }

  /* innerHTML is deliberate: uploads are Bearer-gated and raw HTML uploads
     already run on this origin, which holds no ambient credential. */
  if (kind === 'md') {
    withText(function (text) {
      var el = document.getElementById('content');
      el.innerHTML = window.marked.parse(stripFront(text));
      highlightAll(el);
    });
  }

  /* One slide at a time, with the index in the hash so a link can point at
     slide 7. Marpit emits every slide as a sibling svg; navigation is ours. */
  function deck(host) {
    var slides = host.querySelectorAll('svg[data-marpit-svg]');
    if (!slides.length) return;
    var nav = document.querySelector('.deck-nav');
    var count = nav && nav.querySelector('[data-count]');
    var at = 0;

    function show(n) {
      at = Math.max(0, Math.min(slides.length - 1, n));
      for (var i = 0; i < slides.length; i++) {
        slides[i].classList.toggle('current', i === at);
      }
      if (count) count.textContent = (at + 1) + ' / ' + slides.length;
      var want = '#' + (at + 1);
      if (location.hash !== want) history.replaceState(null, '', want);
    }

    if (nav) {
      nav.hidden = false;
      nav.querySelector('[data-prev]').addEventListener('click', function () { show(at - 1); });
      nav.querySelector('[data-next]').addEventListener('click', function () { show(at + 1); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') show(at + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') show(at - 1);
      else if (k === 'Home') show(0);
      else if (k === 'End') show(slides.length - 1);
      else return;
      e.preventDefault();
    });
    window.addEventListener('hashchange', function () {
      show((parseInt(location.hash.slice(1), 10) || 1) - 1);
    });

    show((parseInt(location.hash.slice(1), 10) || 1) - 1);
  }

  if (kind === 'slides') {
    var themeCss = fetch('/vendor/marp/nt-marp.css')
      .then(function (r) { return r.ok ? r.text() : ''; })
      .catch(function () { return ''; });

    withText(function (text) {
      themeCss.then(function (css) {
        var host = document.getElementById('content');
        /* Marpit defaults markdown-it to the commonmark preset, which has GFM
           tables and strikethrough off. `marked` renders both on the md shell,
           so the deck has to match or the same file reads two ways. */
        var marpit = new window.Marpit.Marpit({
          inlineSVG: true,
          markdown: ['default', { html: true, linkify: true }],
        });
        /* An unparseable theme must not cost the deck: Marpit's built-in
           default still renders readable slides. */
        if (css) {
          try { marpit.themeSet.default = marpit.themeSet.add(css); } catch { /* default theme */ }
        }
        var out = marpit.render(text);
        var style = document.createElement('style');
        style.textContent = out.css;
        document.head.appendChild(style);
        host.innerHTML = out.html;
        highlightAll(host);
        deck(host);
      });
    });
  }
})();
