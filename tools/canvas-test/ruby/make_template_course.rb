# Build an instructor-style course TEMPLATE in Canvas and export it with Canvas's own
# exporter. This is the shape the template parser/exporter must cope with:
#
#   Instructor Information: Do not publish   (verbatim, unpublished)
#   Begin Here: Introductory Module          (verbatim: page, sub-header, external
#                                             link, page with an **EDIT** marker, image)
#   Module 1: Example Topic                  (example-pattern: real authored content)
#   Module 2: (Example to Edit)              (pattern: placeholders)
#
# tests/fixtures/canvas-instructor-template.imscc is a scrubbed copy of its export.
#
#   CCT_OUT     where to write the export, inside the container
#               (default: /usr/src/app/.cct/template-export.imscc)
#   CCT_SUFFIX  course-name suffix for cleanup        (default: " (cct)")
require 'base64'
suffix = ENV.fetch('CCT_SUFFIX', ' (cct)')
out = ENV.fetch('CCT_OUT', '/usr/src/app/.cct/template-export.imscc')
code = 'CCT-TEMPLATE'

user = User.find(1)
Course.where(course_code: code).where.not(workflow_state: 'deleted').each(&:destroy)
course = Course.create!(name: "Instructor template#{suffix}", account: Account.default, course_code: code)
course.enroll_teacher(user, enrollment_state: 'active')
course.syllabus_body = "<p>Template syllabus placeholder. <strong>EDIT</strong> before term.</p>"
course.save!

def page!(course, title, body)
  p = course.wiki_pages.create!(title: title, body: body)
  p.workflow_state = 'active'
  p.save!
  p
end

def discussion!(course, user, title, message)
  d = course.discussion_topics.create!(title: title, message: message, user: user)
  d.workflow_state = 'active'
  d.save!
  d
end

# 1) Verbatim, unpublished instructor module
info = course.context_modules.create!(name: "Instructor Information: Do not publish")
checklist = page!(course, "Instructor checklist", "<h2>Checklist</h2><ul><li>Set dates</li><li>Publish modules</li></ul>")
info.add_item({ type: 'wiki_page', id: checklist.id }, nil, position: 1)
info.workflow_state = 'unpublished'
info.save!

# 2) Verbatim "Begin Here" with mixed item types
begin_mod = course.context_modules.create!(name: "Begin Here: Introductory Module")
welcome = page!(course, "Welcome to the course", "<h1>Welcome!</h1><p>Start with the syllabus and say hello.</p>")
contact = page!(course, "Instructor contact **EDIT**", "<p>Office hours: **EDIT**</p>")
png = Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
File.binwrite('/tmp/banner.png', png)
banner = Attachment.new(context: course, filename: "banner.png", display_name: "banner.png",
                        uploaded_data: Rack::Test::UploadedFile.new('/tmp/banner.png', 'image/png'))
banner.save!
begin_mod.add_item({ type: 'wiki_page', id: welcome.id }, nil, position: 1)
begin_mod.add_item({ type: 'context_module_sub_header', title: 'Getting started' }, nil, position: 2)
begin_mod.add_item({ type: 'external_url', title: 'Course help desk', url: 'https://example.edu/help' }, nil, position: 3)
begin_mod.add_item({ type: 'wiki_page', id: contact.id }, nil, position: 4)
begin_mod.add_item({ type: 'attachment', id: banner.id }, nil, position: 5)
begin_mod.workflow_state = 'active'
begin_mod.save!

# 3) Example-pattern module (real content -> few-shot) and 4) placeholder pattern module
def pattern_module!(course, user, n, topic, filled)
  mod = course.context_modules.create!(name: "Module #{n}: #{topic}")
  overview = page!(course, "Module #{n} Overview",
                   "<h2>Module #{n} Overview</h2><p>#{filled ? 'In this module you will explore the topic through readings and discussion.' : 'Describe the module here.'}</p>")
  notes = page!(course, "M#{n} Instructor Notes: #{filled ? 'Teaching tips for week one' : '(Example to Edit)'}",
                "<p>#{filled ? 'Open with a short retrieval-practice warmup, then lecture for 20 minutes.' : 'Notes for the instructor.'}</p>")
  disc = discussion!(course, user, "M#{n} Discussion: #{filled ? 'What surprised you?' : '(Example to Edit)'}",
                     "<p>#{filled ? 'Share one idea from the readings that surprised you and why.' : 'Pose a discussion prompt.'}</p>")
  mod.add_item({ type: 'wiki_page', id: overview.id }, nil, position: 1)
  mod.add_item({ type: 'wiki_page', id: notes.id }, nil, position: 2)
  mod.add_item({ type: 'discussion_topic', id: disc.id }, nil, position: 3)
  mod.workflow_state = 'active'
  mod.save!
end
pattern_module!(course, user, 1, "Example Topic", true)
pattern_module!(course, user, 2, "(Example to Edit)", false)

ce = course.content_exports.build
ce.export_type = ContentExport::COMMON_CARTRIDGE
ce.user = user
ce.save!
ce.send(:export_course, {})
abort "export failed: state=#{ce.workflow_state}" unless ce.attachment
File.binwrite(out, ce.attachment.open.read)
puts "export state=#{ce.workflow_state}; wrote #{out} (#{File.size(out)} bytes); course ##{course.id}"
