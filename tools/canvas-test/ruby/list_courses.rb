# List every course (including soft-deleted ones) with its state.
Course.order(:id).each do |c|
  puts "##{c.id.to_s.ljust(3)} #{c.workflow_state.ljust(10)} #{c.name.inspect}  (created #{c.created_at.strftime('%Y-%m-%d %H:%M')})"
end
