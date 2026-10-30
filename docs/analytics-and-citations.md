# Website analytics and publication metrics

## Activate visitor statistics

Create a free account at https://www.goatcounter.com/signup and register
`https://zhanxingzhu.github.io`. Copy the endpoint from the account settings into
`goatcounter_endpoint` in `_config.yml`, for example:

```yaml
goatcounter_endpoint: https://YOUR-SITE.goatcounter.com/count
enable_goatcounter: true
```

After publishing, sign in to that GoatCounter site to view page views, visitors,
referrers, and country/browser summaries. Keep the dashboard private unless you
explicitly want to publish the statistics. The endpoint is public; no password or
API secret belongs in this repository. GoatCounter uses no visitor cookies.
Tracking starts after configuration and deployment; previous visits cannot be recovered.

The integration also records these events:

- `scholar-profile-click`: clicks from this website to your Scholar profile.
- `scholar-paper-click-<bibkey>`: clicks on a paper's Google Scholar badge.
- `paper-pdf-click-<bibkey>`: clicks on a publication's PDF button (not proof of a completed download).

These events cannot measure visits made directly to Google Scholar. Scholar does
not let authors install analytics scripts on profile pages. Citation counts are
research metrics, not visitor counts.

The existing Google Analytics integration is also supported: set `google_analytics`
to a valid `G-...` measurement ID and `enable_google_analytics: true`. Prefer one
provider. Analytics scripts only load in production and when the relevant account
identifier is configured. Local Jekyll previews do not send analytics events.

Sources: https://www.goatcounter.com/help/start, https://www.goatcounter.com/help/events,
https://www.goatcounter.com/help/privacy.

## Citation badges

`_data/citations.json` is a dated snapshot of the public Google Scholar profile.
It supplies per-paper badges on the homepage/publications page and all-time total
citations, h-index, and i10-index on the publications page. No visitor browser
scrapes Scholar, and the badges need no third-party image service.

Refresh manually from the repository root:

```sh
bundle exec ruby bin/update_scholar.rb
bundle exec jekyll build --lsi
```

The `Refresh Google Scholar citations` GitHub Actions workflow attempts an update
every Monday at 07:17 UTC and can be run manually from the Actions tab. Successful
refreshes commit only the snapshot and explicitly trigger `Deploy site` (a commit
made with GitHub's workflow token does not itself trigger another push workflow).
GitHub can disable scheduled workflows after prolonged repository inactivity;
re-enable the workflow from Actions if needed.

Scholar has no supported public citation API and can block automated requests.
The updater stops on a challenge, rate limit, or malformed/incomplete response;
it does not bypass access checks. Failed refreshes leave the saved
data intact. Missing papers retain any previous count and its own retrieval date;
otherwise their badge is a Scholar search link with no numeric claim. Ambiguous
title matches also remain unresolved unless an explicit Scholar ID is supplied. A blank
"Cited by" cell on a successfully parsed Scholar paper is recorded as zero.

Matching uses an explicit `google_scholar_id` in `papers.bib`, or a unique exact
title after normalizing case/punctuation. For a renamed or duplicate paper,
add its verified Scholar ID (the part after `a2sHceIAAAAJ:` in its URL) to the
BibTeX entry. Review `_data/citations.json`'s `unmatched` list after refreshing.

DOI-bearing publications additionally request Dimensions citation/impact badges
and Altmetric online-attention badges using the theme's existing integrations.
These providers may have no record or no mentions for a paper. Their metrics are
distinct from Google Scholar citations and from journal impact factors. Disable
them globally under `enable_publication_badges`, or per paper with
`dimensions={false}` / `altmetric={false}`.

Sources: https://scholar.google.com/intl/en/scholar/citations.html,
https://badge.dimensions.ai/.
