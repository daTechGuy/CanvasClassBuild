# Import a cartridge into a NEW test course, wait for the migration to finish, and
# report the result. Needs the Canvas `jobs` container running (imports are
# background jobs).
#
#   CCT_FILE      path to the .imscc as seen inside the container (required)
#   CCT_NAME      course name                          (default: "Import test")
#   CCT_SUFFIX    appended to the name; the cleanup command only deletes courses
#                 ending with it                       (default: " (cct)")
#   CCT_IMPORTER  canvas_cartridge_importer ("Canvas Course Export Package") or
#                 common_cartridge_importer            (default: canvas_cartridge_importer)
#   CCT_TIMEOUT   seconds to wait                      (default: 600)
#
# Note: Canvas re-detects the package type itself. A package whose manifest has
# course_settings/canvas_export.txt is handled by the NATIVE importer whichever
# importer you pick here.
file = ENV.fetch('CCT_FILE')
name = "#{ENV.fetch('CCT_NAME', 'Import test')}#{ENV.fetch('CCT_SUFFIX', ' (cct)')}"
importer = ENV.fetch('CCT_IMPORTER', 'canvas_cartridge_importer')
timeout = ENV.fetch('CCT_TIMEOUT', '600').to_i
abort "file not found inside the container: #{file}" unless File.exist?(file)

user = User.find(1)
course = Course.create!(name: name, account: Account.default)
course.enroll_teacher(user, enrollment_state: 'active')

cm = course.content_migrations.build
cm.user = user
cm.migration_type = importer
cm.migration_settings[:import_immediately] = true
cm.migration_settings[:migration_ids_to_import] = { copy: { everything: true } }
cm.save!
att = Attachment.new
att.context = cm
att.uploaded_data = Rack::Test::UploadedFile.new(file, 'application/zip')
att.save!
cm.attachment = att
cm.save!
cm.queue_migration
puts "queued migration ##{cm.id} (#{importer}) for course ##{course.id} #{name.inspect}"

deadline = Time.now + timeout
until %w[imported failed].include?(cm.reload.workflow_state)
  abort "timed out after #{timeout}s in state #{cm.workflow_state} - is the jobs container running?" if Time.now > deadline
  sleep 3
end

puts "migration state: #{cm.workflow_state}"
cm.migration_issues.each { |i| puts "  ISSUE [#{i.issue_type}] #{i.description.to_s[0, 200]}" }
puts "COURSE_ID=#{course.id}"
exit(cm.workflow_state == 'imported' ? 0 : 1)
