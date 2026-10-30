require 'minitest/autorun'
require 'liquid'
require_relative '../bin/update_scholar'

class ScholarMetricsTest < Minitest::Test
  USER = 'example'

  def profile(count = '1,234')
    <<~HTML
      <div id="gsc_prf_in">Test Researcher</div>
      <table id="gsc_rsb_st">
        <tr><td>Citations</td><td>2,000</td></tr>
        <tr><td>h-index</td><td>20</td></tr>
        <tr><td>i10-index</td><td>30</td></tr>
      </table>
      <table><tbody id="gsc_a_b"><tr class="gsc_a_tr">
        <td><a class="gsc_a_at" href="/citations?citation_for_view=example:paper1">A Paper</a></td>
        <td><a class="gsc_a_ac">#{count}</a></td>
      </tr></tbody></table>
      <button id="gsc_bpf_more" disabled>Show more</button>
    HTML
  end

  def test_parses_profile_and_observed_zero
    result = ScholarMetrics.parse(profile, USER)
    assert_equal 1234, result['papers'][0]['citations']
    assert_equal 2000, result['summary']['citations']
    refute result['more']
    assert_equal 0, ScholarMetrics.parse(profile(''), USER)['papers'][0]['citations']
  end

  def test_rejects_blocked_malformed_and_wrong_profile_responses
    assert_raises(ScholarMetrics::Error) { ScholarMetrics.parse('<html>Verify you are human</html>', USER) }
    assert_raises(ScholarMetrics::Error) { ScholarMetrics.parse(profile('unavailable'), USER) }
    assert_raises(ScholarMetrics::Error) { ScholarMetrics.parse(profile, 'someone-else') }
    assert_raises(ScholarMetrics::Error) { ScholarMetrics.parse(profile.sub('gsc_bpf_more', 'missing'), USER) }
  end

  def test_matches_unique_titles_but_preserves_missing_counts_with_original_dates
    bib = BibTeX.parse('@article{found, title={A paper}} @article{missing, title={Other paper}} @article{new, title={New paper}}')
    saved = { 'scholar_id' => 'old', 'citations' => 17, 'updated_at' => '2026-01-01' }
    data = ScholarMetrics.snapshot(bib, [ScholarMetrics.parse(profile, USER)], USER, { 'papers' => { 'missing' => saved } }, '2026-10-30')
    assert_equal 1234, data['papers']['found']['citations']
    assert_equal saved, data['papers']['missing']
    refute data['papers'].key?('new')
    assert_equal %w[missing new], data['unmatched']
  end

  def test_ambiguous_titles_need_explicit_ids
    page = ScholarMetrics.parse(profile, USER)
    page['papers'] << page['papers'][0].merge('scholar_id' => 'paper2', 'citations' => 5)
    bib = BibTeX.parse('@article{exact, title={A paper}, google_scholar_id={paper2}} @article{ambiguous, title={A paper}}')
    data = ScholarMetrics.snapshot(bib, [page], USER, {}, '2026-10-30')
    assert_equal 5, data['papers']['exact']['citations']
    refute data['papers'].key?('ambiguous')
  end

  def test_partial_profiles_and_duplicate_pages_are_rejected
    bib = BibTeX.parse('@article{found, title={A paper}}')
    page = ScholarMetrics.parse(profile, USER)
    assert_raises(ScholarMetrics::Error) { ScholarMetrics.snapshot(bib, [page], USER, { 'profile_articles' => 100 }, 'today') }
    assert_raises(ScholarMetrics::Error) { ScholarMetrics.snapshot(bib, [page, page], USER, {}, 'today') }
  end

  def analytics(environment, overrides = {})
    config = {
      'enable_goatcounter' => true, 'enable_google_analytics' => true,
      'scholar_userid' => USER
    }.merge(overrides)
    Liquid::Template.parse(File.read(File.expand_path('../_includes/scripts/analytics.liquid', __dir__))).render!(
      'site' => config, 'jekyll' => { 'environment' => environment }
    )
  end

  def test_analytics_is_off_without_config_or_in_development
    refute_includes analytics('production'), '<script'
    refute_includes analytics('development', 'goatcounter_endpoint' => 'https://example.goatcounter.com/count', 'google_analytics' => 'G-EXAMPLE'), '<script'
  end

  def test_goatcounter_and_google_analytics_can_be_enabled_independently
    output = analytics('production', 'goatcounter_endpoint' => 'https://example.goatcounter.com/count', 'enable_google_analytics' => false)
    assert_includes output, 'gc.zgo.at/count.js'
    assert_includes output, 'analytics-events.js'
    refute_includes output, 'googletagmanager.com'
    output = analytics('production', 'google_analytics' => 'G-EXAMPLE', 'enable_goatcounter' => false)
    assert_includes output, 'googletagmanager.com'
    assert_includes output, 'analytics-events.js'
    refute_includes output, 'gc.zgo.at'
  end
end
