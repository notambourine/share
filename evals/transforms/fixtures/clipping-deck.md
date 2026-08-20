---
marp: true
paginate: true
---

<!-- _class: lead -->

<p class="eyebrow">consent configuration</p>

# One CMP, three consent *models*

Pandectes, gated on geography. What we recommend, and what it costs to wire up.

---

<p class="eyebrow">01 &middot; the model</p>

## Consent follows the *visitor's* geography

| Geography | Model | Before the visitor chooses |
| --- | --- | --- |
| EU (GDPR) | Strict opt-in | Pixels blocked |
| California (CIPA) | Strict opt-in | Pixels blocked |
| 18 other US states | Opt-out | Pixels on, decline offered |
| Everywhere else | No banner | Pixels on |

---

<p class="eyebrow">02 &middot; what it takes</p>

## Not a one-click *install*

- GTM holds the tags that read the consent state, and every third-party tag
  stays gated until consent is given or implied
- Elevar forwards events downstream of the same state, so a mismatch there
  double-counts or drops a purchase
- Shopify runs the app pixels beside it, on its own consent API
- The tag inventory in GTM is the long pole: 34 tags today, and each one needs
  a category assigned before the CMP can gate it
- Strict opt-in costs us data in the EU and California, and honoring implied
  consent inside the banner window takes some of that back
- Implied consent counts four signals: scrolling the page, clicking the main
  window, closing the modal with the x, and staying 30 seconds
- None of this ships by toggling the CMP on, and three systems have to agree on
  one consent state before any of it is trustworthy

---

<p class="eyebrow">03 &middot; next</p>

## Where we would *start*

GTM is the long pole. The tag inventory sets the size of the job.

> Next deliverable: the tag-by-tag GTM configuration, written as steps.
