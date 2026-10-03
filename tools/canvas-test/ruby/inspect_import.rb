# Read-only inspection of what Canvas actually built from an imported cartridge.
#
# Canvas reports "imported, no issues" even when it silently dropped content, so
# the only honest check is to look at the resulting objects.
#
#   COURSE=<id>  limit the report to one course (default: every non-deleted course)
#
# Run via tools/canvas-test/cct.sh (or: docker compose exec -T -e COURSE=3 web \
#   bundle exec rails runner .cct/inspect_import.rb)
def short(s, n = 90) = s.to_s.gsub(/\s+/, ' ')[0, n]
only = ENV['COURSE'] && ENV['COURSE'].to_i

puts "== CONTENT MIGRATIONS"
ContentMigration.order(:id).each do |m|
  next if only && m.context_id != only
  puts "##{m.id} course=#{m.context_id} type=#{m.migration_type} state=#{m.workflow_state} " \
       "progress=#{m.progress} created=#{m.created_at&.strftime('%H:%M:%S')}"
  m.migration_issues.each do |i|
    puts "   ISSUE [#{i.issue_type}] #{short(i.description, 160)} | #{short(i.error_message, 160)}"
  end
  puts "   (no migration issues)" if m.migration_issues.empty?
end

Course.where.not(workflow_state: 'deleted').order(:id).each do |c|
  next if only && c.id != only
  puts
  puts "== COURSE ##{c.id} #{c.name.inspect} state=#{c.workflow_state}"
  puts "syllabus_body: #{c.syllabus_body.to_s.length} chars  " \
       "#{short(ActionController::Base.helpers.strip_tags(c.syllabus_body.to_s), 140).inspect}"

  puts "-- modules"
  c.context_modules.where.not(workflow_state: 'deleted').order(:position).each do |mod|
    puts "  MODULE #{mod.name.inspect} (#{mod.workflow_state}) items=#{mod.content_tags.where.not(workflow_state: 'deleted').count}"
    mod.content_tags.where.not(workflow_state: 'deleted').order(:position).each do |t|
      puts "     - [#{t.content_type}] #{t.title.inspect} state=#{t.workflow_state}"
    end
  end

  puts "-- wiki pages"
  c.wiki_pages.where.not(workflow_state: 'deleted').order(:id).each do |p|
    body = p.body.to_s
    puts "  #{p.title.inspect} state=#{p.workflow_state} body=#{body.length} chars " \
         "script=#{body.include?('<script')} style=#{body.include?('<style')} " \
         "text=#{short(ActionController::Base.helpers.strip_tags(body), 80).inspect}"
  end

  puts "-- quizzes"
  c.quizzes.where.not(workflow_state: 'deleted').order(:id).each do |q|
    qs = q.quiz_questions.order(:position)
    wired = qs.count { |x| (x.question_data[:answers] || []).any? { |a| a[:weight].to_f > 0 } }
    types = qs.map { |x| x.question_data[:question_type] }.tally
    puts "  #{q.title.inspect} state=#{q.workflow_state} published=#{q.published?} type=#{q.quiz_type} " \
         "questions=#{qs.count} with_correct_answer=#{wired} types=#{types} points=#{q.points_possible}"
    sample = qs.first
    next unless sample
    d = sample.question_data
    puts "     sample Q: #{short(d[:question_text], 80).inspect}"
    (d[:answers] || []).first(4).each { |a| puts "        #{a[:weight].to_f > 0 ? '[x]' : '[ ]'} #{short(a[:text], 60)}" }
  end

  puts "-- discussions"
  c.discussion_topics.where.not(workflow_state: 'deleted').order(:id).each do |d|
    puts "  #{d.title.inspect} state=#{d.workflow_state} published=#{d.published?} type=#{d.type.inspect} " \
         "message=#{d.message.to_s.length} chars"
  end

  puts "-- assignments"
  c.assignments.where.not(workflow_state: 'deleted').each do |a|
    puts "  #{a.title.inspect} state=#{a.workflow_state} group=#{a.assignment_group&.name.inspect}"
  end

  puts "-- files"
  c.attachments.where.not(workflow_state: 'deleted').order(:id).each do |a|
    puts "  #{a.full_path.to_s.sub(%r{^course files/}, '')} (#{a.display_name}) #{a.size} bytes #{a.content_type}"
  end
end
