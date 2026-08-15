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
      try { window.hljs.highlightElement(el); } catch (e) { /* plain text is fine */ }
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
        try { window.hljs.highlightElement(el); } catch (e) { /* plain text is fine */ }
      }
    });
  }

  /* innerHTML is deliberate: uploads are Bearer-gated and raw HTML uploads
     already run on this origin, which holds no ambient credential. */
  if (kind === 'md') {
    withText(function (text) {
      var el = document.getElementById('content');
      el.innerHTML = window.marked.parse(text);
      highlightAll(el);
    });
  }

  if (kind === 'slides') {
    withText(function (text) {
      var el = document.getElementById('content');
      text.split(/\n---\n/).forEach(function (chunk) {
        var s = document.createElement('section');
        s.innerHTML = window.marked.parse(chunk);
        el.appendChild(s);
      });
      highlightAll(el);
      window.Reveal.initialize({ hash: true });
    });
  }
})();
