const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function click(href, text, paperId, providers = true) {
  let handler;
  const sent = [];
  const ga = [];
  const window = { location: { href: 'https://example.com/publications/' } };
  if (providers) {
    window.goatcounter = { count: (event) => sent.push(event) };
    window.gtag = (...event) => ga.push(event);
  }
  vm.runInNewContext(fs.readFileSync('assets/js/analytics-events.js', 'utf8'), {
    URL, window,
    document: {
      currentScript: { dataset: { scholarUserid: 'owner' } },
      addEventListener: (_, callback) => { handler = callback; },
    },
  });
  handler({ target: { closest: () => ({ href, textContent: text, closest: () => paperId ? { id: paperId } : null }) } });
  return { sent, ga };
}

test('counts only the owner profile and distinguishes paper and PDF clicks', () => {
  assert.equal(click('https://scholar.google.com/citations?user=owner', 'Scholar').sent[0].path, 'scholar-profile-click');
  assert.equal(click('https://scholar.google.com/citations?user=another', 'Scholar').sent.length, 0);
  assert.equal(click('https://scholar.google.com/citations?user=owner&citation_for_view=owner:id', 'Scholar', 'paper').sent[0].path, 'scholar-paper-click-paper');
  assert.equal(click('https://example.com/paper.pdf', 'PDF', 'paper').sent[0].path, 'paper-pdf-click-paper');
  assert.equal(click('https://example.com/', 'Home').sent.length, 0);
});

test('unavailable analytics never prevents following a link', () => {
  assert.doesNotThrow(() => click('https://scholar.google.com/citations?user=owner', 'Scholar', null, false));
});
