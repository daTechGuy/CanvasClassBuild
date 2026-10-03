# Build a small course with Canvas's own models (published page, practice + graded
# quiz, discussion, file, module, syllabus) and export it with Canvas's OWN
# exporter. The result is the ground truth for "what a native Canvas export looks
# like" — the exporter in src/services/export/imsccExporter.ts mirrors it, and
# tests/fixtures/canvas-reference-export.imscc is a scrubbed copy.
#
#   CCT_OUT     where to write the export, inside the container
#               (default: /usr/src/app/.cct/reference-export.imscc)
#   CCT_SUFFIX  course-name suffix for cleanup        (default: " (cct)")
suffix = ENV.fetch('CCT_SUFFIX', ' (cct)')
out = ENV.fetch('CCT_OUT', '/usr/src/app/.cct/reference-export.imscc')
code = 'CCT-REFERENCE'

user = User.find(1)
Course.where(course_code: code).where.not(workflow_state: 'deleted').each(&:destroy)
course = Course.create!(name: "Reference export#{suffix}", account: Account.default, course_code: code)
course.enroll_teacher(user, enrollment_state: 'active')
course.syllabus_body = "<h2>Syllabus</h2><p>The <b>syllabus body</b> goes here.</p>"
course.save!
course.offer! if course.respond_to?(:offer!)

page = course.wiki_pages.create!(title: "Chapter 1 — Reading", body: "<h1>Reading</h1><p>Some <em>html</em> body text.</p>")
page.workflow_state = 'active'
page.save!

def add_quiz(course, title, type)
  quiz = course.quizzes.create!(title: title, quiz_type: type, description: "<p>Quiz description</p>", points_possible: 2)
  2.times do |i|
    quiz.quiz_questions.create!(question_data: {
      question_name: "Q#{i + 1}", question_text: "<p>Question #{i + 1}?</p>", question_type: 'multiple_choice_question',
      points_possible: 1, correct_comments: "Yes", incorrect_comments: "No",
      answers: [
        { text: "Right", weight: 100, id: 1 },
        { text: "Wrong A", weight: 0, id: 2 },
        { text: "Wrong B", weight: 0, id: 3 }
      ]
    })
  end
  quiz.generate_quiz_data
  quiz.published_at = Time.now
  quiz.workflow_state = 'available'
  quiz.save!
  quiz
end
practice = add_quiz(course, "Practice Quiz", 'practice_quiz')
graded = add_quiz(course, "In-Class Quiz", 'assignment')

disc = course.discussion_topics.create!(title: "Discussion 1", message: "<p>Talk it over.</p>", user: user)
disc.workflow_state = 'active'
disc.save!

# Any small file will do; the content type just needs to be believable.
att = Attachment.new(context: course, filename: "teaching-resources.docx", display_name: "teaching-resources.docx",
                     uploaded_data: Rack::Test::UploadedFile.new('/usr/src/app/package.json', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
att.save!

mod = course.context_modules.create!(name: "Chapter 1")
mod.add_item({ type: 'wiki_page', id: page.id }, nil, position: 1)
mod.add_item({ type: 'quiz', id: practice.id }, nil, position: 2)
mod.add_item({ type: 'quiz', id: graded.id }, nil, position: 3)
mod.add_item({ type: 'discussion_topic', id: disc.id }, nil, position: 4)
mod.add_item({ type: 'attachment', id: att.id }, nil, position: 5)
mod.workflow_state = 'active'
mod.save!

# ContentExport#export is queued as a background job; export_course runs it inline.
ce = course.content_exports.build
ce.export_type = ContentExport::COMMON_CARTRIDGE
ce.user = user
ce.save!
ce.send(:export_course, {})
abort "export failed: state=#{ce.workflow_state}" unless ce.attachment
File.binwrite(out, ce.attachment.open.read)
puts "export state=#{ce.workflow_state}; wrote #{out} (#{File.size(out)} bytes); course ##{course.id}"
