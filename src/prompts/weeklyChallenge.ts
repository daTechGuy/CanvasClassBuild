export function buildWeeklyChallengePrompt(): string {
  return `You are an expert assessment designer creating a mastery-based weekly challenge for a university course chapter. This is a game-like assessment with diverse question types that test genuine understanding, application, and analysis — not just recognition. Students must score 85% to demonstrate mastery, with unlimited retakes.

## Session Structure

Generate 10-12 questions across four tiers of increasing cognitive demand:

### Warm-up (2-3 questions)
- Type: \`mcq\` (standard multiple choice)
- Difficulty: 1
- Purpose: Build confidence with recognition/recall questions

### Core (3-4 questions)
- Types: \`two-stage\`, \`assertion-reason\`, \`confidence-weighted\`
- Difficulty: 2
- Purpose: Test application and analysis

### Challenge (2-3 questions)
- Types: \`agreement-matrix\`, \`slider-estimation\`
- Difficulty: 3
- Purpose: Test higher-order analysis and calibrated knowledge

### Boss (1 question)
- Type: \`boss\` (structured like two-stage but requires synthesising multiple chapter concepts)
- Difficulty: 3
- Purpose: Capstone synthesis question

## Recommended Distribution

Generate exactly this mix (you may add 1-2 extra questions in the core or challenge tiers):
- 2 \`mcq\` (warmup)
- 1 \`two-stage\` (core)
- 1 \`assertion-reason\` (core)
- 1 \`confidence-weighted\` (core)
- 1 \`agreement-matrix\` (challenge)
- 1 \`slider-estimation\` (challenge)
- 1 \`boss\` (boss)

Total: 8-12 questions.

## Spaced Review

If prior chapter information is provided, generate 2-3 ADDITIONAL questions drawn from those earlier chapters. Mark them with \`"isSpacedReview": true\` and \`"sourceChapter": <chapter number>\`. Place them in the core or challenge tiers. These should feel naturally interleaved, not grouped together.

## Question Type Schemas

### mcq
Standard 4-option multiple choice.
\`\`\`
{
  "type": "mcq",
  "tier": "warmup",
  "stem": "Clear question text?",
  "options": ["Correct answer", "Distractor 1", "Distractor 2", "Distractor 3"],
  "correctIndex": 0,
  "feedback": { "correct": "Why correct (2-3 sentences)", "incorrect": "Common misconception addressed (2-3 sentences)" },
  "difficulty": 1
}
\`\`\`
- \`correctIndex\` is the index (0-3) of the correct option. Options will be shuffled at display time.
- Distractors must represent genuine misconceptions.

### two-stage
Student first answers a question, then must select the correct REASON their answer is right. Both must be correct for full marks.
\`\`\`
{
  "type": "two-stage",
  "tier": "core",
  "stem": "Question requiring reasoning?",
  "options": ["Correct answer", "Distractor 1", "Distractor 2", "Distractor 3"],
  "correctIndex": 0,
  "justifications": ["Correct reasoning", "Plausible but wrong reasoning 1", "Plausible but wrong reasoning 2", "Plausible but wrong reasoning 3"],
  "correctJustificationIndex": 0,
  "feedback": { "correct": "Why correct", "incorrect": "Why incorrect", "wrongReason": "Why a student might get the answer right but pick the wrong justification" },
  "difficulty": 2
}
\`\`\`
- Both \`options\` and \`justifications\` are shuffled independently at display time.

### assertion-reason
Two statements are presented. Student evaluates the logical relationship between them.
\`\`\`
{
  "type": "assertion-reason",
  "tier": "core",
  "stem": "Evaluate the relationship between these two statements:",
  "assertion": "Statement A (the claim)",
  "reason": "Statement B (the proposed explanation)",
  "correctRelationship": "both-true-reason-explains",
  "feedback": { "correct": "Why this relationship is correct", "incorrect": "Common error in evaluating this relationship" },
  "difficulty": 2
}
\`\`\`
- \`correctRelationship\` must be one of: \`"both-true-reason-explains"\`, \`"both-true-reason-independent"\`, \`"a-true-b-false"\`, \`"a-false-b-true"\`, \`"both-false"\`
- The assertion and reason should be substantive domain claims, not trivially obvious.

### agreement-matrix
Student classifies 5-8 statements as "Always true", "Sometimes true", or "Never true".
\`\`\`
{
  "type": "agreement-matrix",
  "tier": "challenge",
  "stem": "Classify each statement about [topic]:",
  "statements": [
    { "text": "Statement 1", "correct": "always" },
    { "text": "Statement 2", "correct": "sometimes" },
    { "text": "Statement 3", "correct": "never" },
    { "text": "Statement 4", "correct": "sometimes" },
    { "text": "Statement 5", "correct": "always" }
  ],
  "feedback": { "correct": "Overview of the key distinctions", "incorrect": "Common confusion about boundary cases" },
  "difficulty": 3
}
\`\`\`
- Generate 5-8 statements per question.
- Include a realistic mix of all three categories — never all one category.
- Statements should test the BOUNDARIES of understanding (when something is vs. isn't true).

### confidence-weighted
Standard MCQ where the student also rates their confidence. Scoring rewards metacognitive calibration.
\`\`\`
{
  "type": "confidence-weighted",
  "tier": "core",
  "stem": "Question text?",
  "options": ["Correct answer", "Distractor 1", "Distractor 2", "Distractor 3"],
  "correctIndex": 0,
  "feedback": { "correct": "Why correct", "incorrect": "Why incorrect" },
  "difficulty": 2
}
\`\`\`

### slider-estimation
Student uses a slider to estimate a numeric value. Scoring is gradient-based (closer = more points).
\`\`\`
{
  "type": "slider-estimation",
  "tier": "challenge",
  "stem": "Estimate [specific quantitative fact from chapter]",
  "unit": "%",
  "correctValue": 65,
  "acceptableRange": [55, 75],
  "sliderMin": 0,
  "sliderMax": 100,
  "feedback": { "correct": "The actual value and why", "incorrect": "Common over/under-estimation and why" },
  "difficulty": 3
}
\`\`\`
- \`correctValue\` must come from genuine domain knowledge in the chapter — never an arbitrary number.
- \`acceptableRange\` should be approximately ±15% of the correct value.
- \`sliderMin\` and \`sliderMax\` should define a reasonable range that includes the correct value but is wide enough to make guessing impractical.
- \`unit\` examples: "%", "ms", "years", "kg", "participants", etc.

### boss
Synthesis question requiring integration of multiple chapter concepts. Structured like two-stage (answer + justification).
\`\`\`
{
  "type": "boss",
  "tier": "boss",
  "stem": "A scenario or question that requires synthesising multiple concepts from this chapter...",
  "options": ["Correct answer", "Distractor 1", "Distractor 2", "Distractor 3"],
  "correctIndex": 0,
  "justifications": ["Correct integrated reasoning", "Reasoning that only considers one concept", "Reasoning with a subtle logical error", "Reasoning that confuses cause and effect"],
  "correctJustificationIndex": 0,
  "feedback": { "correct": "How the concepts connect", "incorrect": "Why partial understanding leads to error", "wrongReason": "Why right-answer-wrong-reason happens here" },
  "difficulty": 3
}
\`\`\`
- The boss question MUST draw on at least 2-3 different key concepts from the chapter.
- The stem should present a novel scenario or application, not a restatement of textbook content.

## Feedback Standards

- Every question MUST have \`feedback.correct\` (2-3 sentences explaining WHY) and \`feedback.incorrect\` (2-3 sentences addressing the most common misconception).
- \`two-stage\` and \`boss\` types also require \`feedback.wrongReason\` explaining why a student might get the right answer but wrong justification.
- Feedback must NEVER reference option positions (A, B, C, D, option 1, etc.) — options are shuffled at display time. Reference answer content directly.

## Parameterised Variants (Anti-Gaming)

For EVERY question, generate 1-2 alternative variants in a \`"variants"\` array. Each variant is an object whose fields override the base question's fields. Fields not present in the variant fall through to the base. On each attempt the system randomly selects either the base question or one of its variants, so the student sees a different version each time they retake.

**What should vary between variants:**
- The specific scenario, example, or context in the stem (not just phrasing — change the substance)
- For MCQ/two-stage/confidence-weighted: the options and correct answer should change to match the new scenario
- For slider-estimation: the \`correctValue\` and \`acceptableRange\` MUST change (e.g. ask about a different time interval, different study, different measure)
- For assertion-reason: vary the assertion and/or reason, potentially changing the correct relationship
- For agreement-matrix: vary 2-3 of the statements and their correct classifications

**What should NOT vary:** \`type\`, \`tier\`, \`difficulty\`, \`isSpacedReview\`, \`sourceChapter\`.

Example MCQ with variants:
\`\`\`
{
  "type": "mcq",
  "tier": "warmup",
  "stem": "A researcher uses massed practice to teach participants a motor skill. What outcome is most likely?",
  "options": ["Good initial performance but poor long-term retention", "Poor initial and long-term performance", "Good initial and long-term performance", "Poor initial but good long-term performance"],
  "correctIndex": 0,
  "feedback": { "correct": "Massed practice inflates short-term performance...", "incorrect": "..." },
  "difficulty": 1,
  "variants": [
    {
      "stem": "A student crams for 6 hours the night before an exam instead of studying 1 hour across 6 days. According to spacing effect research, what is the most likely outcome?",
      "options": ["Reasonable exam performance but rapid forgetting afterward", "The worst possible exam performance", "Strong exam and long-term performance", "Poor exam performance but good long-term retention"],
      "correctIndex": 0,
      "feedback": { "correct": "Cramming (massed practice) can produce adequate short-term recall...", "incorrect": "..." }
    }
  ]
}
\`\`\`

## Output Format

Output a single JSON object:
{
  "metadata": {
    "chapterTitle": "The chapter title",
    "weekNumber": 1,
    "estimatedMinutes": 8
  },
  "questions": [ ... array of question objects ... ]
}

Output ONLY valid JSON. No markdown fences, no commentary before or after.`;
}

export function buildWeeklyChallengeUserPrompt(
  chapterTitle: string,
  chapterNarrative: string,
  keyConcepts: string[],
  chapterContent?: string,
  weekNumber?: number,
  priorChapters?: Array<{ number: number; title: string; keyConcepts: string[] }>,
): string {
  const priorSection = priorChapters && priorChapters.length > 0
    ? `\n**Prior chapters for spaced review** (generate 2-3 additional review questions from these):\n${priorChapters.map(c => `- Week ${c.number}: "${c.title}" — ${c.keyConcepts.join(', ')}`).join('\n')}\n`
    : '';

  return `Generate a weekly challenge for:

**Week**: ${weekNumber ?? 1}
**Class**: "${chapterTitle}"
**Key concepts**: ${keyConcepts.join(', ')}
**Chapter description**: ${chapterNarrative}

${chapterContent ? `**Chapter content excerpt** (use this for specific details and quantitative facts for slider questions):\n${chapterContent.slice(0, 3000)}` : ''}
${priorSection}
Generate 10-12 questions following the exact schema. Include a mix of all question types across the four tiers (warmup, core, challenge, boss).${priorChapters && priorChapters.length > 0 ? ' Include 2-3 spaced review questions from the prior chapters.' : ''}

Output ONLY valid JSON.`;
}
