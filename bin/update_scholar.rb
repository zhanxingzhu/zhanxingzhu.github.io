require 'bibtex'
require 'json'
require 'net/http'
require 'nokogiri'
require 'time'
require 'uri'
require 'yaml'

module ScholarMetrics
  class Error < StandardError; end

  def self.normalize(title)
    title.to_s.scrub.unicode_normalize(:nfkd).downcase.gsub(/[^a-z0-9]/, '')
  end

  def self.number(text, blank_zero: false)
    text = text.to_s.strip
    return 0 if blank_zero && text.empty?
    raise Error, "Unexpected citation number: #{text.inspect}" unless text.match?(/\A[\d,]+\z/)

    Integer(text.delete(','), 10)
  end

  def self.parse(html, user)
    doc = Nokogiri::HTML(html)
    raise Error, 'Scholar returned a login/challenge or an incomplete page' unless doc.at_css('#gsc_prf_in') && doc.at_css('#gsc_a_b')

    papers = doc.css('.gsc_a_tr').map do |row|
      link = row.at_css('.gsc_a_at')
      count = row.at_css('.gsc_a_ac')
      raise Error, 'Incomplete Scholar paper row' unless link && count

      query = URI.decode_www_form(URI.parse(link['href']).query.to_s).to_h
      owner, id = query.fetch('citation_for_view', '').split(':', 2)
      raise Error, 'Scholar paper belongs to a different profile' unless owner == user && id&.match?(/\A[\w-]+\z/)

      { 'scholar_id' => id, 'title' => link.text.scrub, 'citations' => number(count.text, blank_zero: true) }
    end
    raise Error, 'Scholar returned no papers' if papers.empty?

    summary = {}
    { 'Citations' => 'citations', 'h-index' => 'h_index', 'i10-index' => 'i10_index' }.each do |label, key|
      row = doc.css('#gsc_rsb_st tr').find { |r| r.at_css('td')&.text == label }
      raise Error, "Missing Scholar metric: #{label}" unless row && row.css('td').size >= 2

      summary[key] = number(row.css('td')[1].text)
    end
    more = doc.at_css('#gsc_bpf_more')
    raise Error, 'Missing Scholar pagination control' unless more

    { 'papers' => papers, 'summary' => summary, 'more' => !more.key?('disabled') }
  end

  def self.fetch(user, start)
    uri = URI('https://scholar.google.com/citations')
    uri.query = URI.encode_www_form(user: user, hl: 'en', cstart: start, pagesize: 100)
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 30) do |http|
      http.get(uri.request_uri)
    end
    raise Error, "Scholar HTTP #{response.code}; keeping the saved snapshot" unless response.is_a?(Net::HTTPSuccess)

    response.body
  end

  def self.snapshot(bibliography, pages, user, previous, timestamp)
    papers = pages.flat_map { |page| page.fetch('papers') }
    ids = papers.map { |paper| paper.fetch('scholar_id') }
    raise Error, 'Duplicate pages or Scholar IDs in response' unless ids.uniq.size == ids.size
    if previous['profile_articles'] && papers.size < previous['profile_articles'] * 0.8
      raise Error, 'Incomplete profile response; keeping the saved snapshot'
    end
    by_id = papers.to_h { |paper| [paper['scholar_id'], paper] }
    by_title = papers.group_by { |paper| normalize(paper['title']) }
    matched = {}
    missing = []
    bibliography.entries.each do |key, entry|
      id = entry[:google_scholar_id]&.to_s
      candidates = by_title.fetch(normalize(entry[:title]), [])
      paper = id ? by_id[id] : (candidates.one? ? candidates.first : nil)
      if paper
        matched[key] = paper.merge('updated_at' => timestamp)
      else
        # A missing match is unknown, not zero. Preserve any last verified count and its date.
        saved = previous.fetch('papers', {})[key]
        matched[key] = saved if saved
        missing << key
      end
    end
    raise Error, 'No bibliography entries matched Scholar' if matched.empty?

    {
      'scholar_userid' => user,
      'source_url' => "https://scholar.google.com/citations?user=#{user}&hl=en",
      'updated_at' => timestamp,
      'profile_articles' => papers.size,
      'summary' => pages.first.fetch('summary'),
      'unmatched' => missing,
      'papers' => matched.sort.to_h
    }
  end

  def self.run(files)
    root = File.expand_path('..', __dir__)
    config = YAML.load_file(File.join(root, '_config.yml'))
    user = config.fetch('scholar_userid')
    destination = File.join(root, '_data/citations.json')
    previous = File.exist?(destination) ? JSON.parse(File.read(destination)) : {}
    raise Error, 'Saved snapshot belongs to another profile' if previous['scholar_userid'] && previous['scholar_userid'] != user

    pages = []
    10.times do |index|
      html = files.empty? ? fetch(user, index * 100) : File.binread(files.fetch(index))
      page = parse(html, user)
      pages << page
      break unless page['more']

      sleep 2 if files.empty?
    end
    raise Error, 'Incomplete Scholar pagination' if pages.last['more']

    bibliography = BibTeX.open(File.join(root, '_bibliography/papers.bib'))
    data = snapshot(bibliography, pages, user, previous, Time.now.utc.iso8601)
    File.write(destination + '.tmp', JSON.pretty_generate(data) + "\n")
    File.rename(destination + '.tmp', destination)
    puts "Updated #{data['papers'].size}/#{bibliography.entries.size} papers. Unmatched: #{data['unmatched'].join(', ')}"
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    ScholarMetrics.run(ARGV)
  rescue StandardError => error
    warn "Scholar refresh failed: #{error.message}. Existing data has not been replaced."
    exit 1
  end
end
