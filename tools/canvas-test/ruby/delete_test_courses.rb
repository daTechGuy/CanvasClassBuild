# Soft-delete (the same as "Delete this course" in the UI; recoverable) every
# non-deleted course whose name ends with the test suffix. Courses you made by hand
# are never touched.
#
#   CCT_SUFFIX  (default: " (cct)")
suffix = ENV.fetch('CCT_SUFFIX', ' (cct)')
mine = Course.where.not(workflow_state: 'deleted').select { |c| c.name.to_s.end_with?(suffix) }
puts "deleting #{mine.size} course(s) ending #{suffix.inspect}: #{mine.map(&:id).inspect}"
mine.each(&:destroy)
puts "-- remaining non-deleted courses:"
Course.where.not(workflow_state: 'deleted').order(:id).each { |c| puts "  ##{c.id} #{c.workflow_state} #{c.name.inspect}" }
