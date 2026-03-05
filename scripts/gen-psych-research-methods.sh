#!/usr/bin/env bash
# Generate: Research Methods and Statistics in Psychology (2nd year, 6 weeks)
#
# Usage:
#   ANTHROPIC_API_KEY=sk-ant-... ./scripts/gen-psych-research-methods.sh
#
# Optional extras:
#   GEMINI_API_KEY=...      — enables AI-generated infographics
#   ELEVENLABS_API_KEY=...  — enables audio narration

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Error: ANTHROPIC_API_KEY is required"
  echo "Usage: ANTHROPIC_API_KEY=sk-ant-... $0"
  exit 1
fi

npx tsx scripts/generate-course.ts \
  --topic "Research Methods and Statistics in Psychology" \
  --chapters 6 \
  --level undergrad \
  --length standard \
  --widgets 3 \
  --cohort 60 \
  --environment lecture-theatre \
  --theme midnight \
  --notes "Second-year undergraduate psychology course. Assume students have completed an introductory psychology unit but have minimal prior statistics experience. Cover both qualitative and quantitative methods, experimental design, descriptive and inferential statistics (t-tests, ANOVA, correlation, regression), effect sizes, and APA-style reporting. Emphasise practical application with SPSS/jamovi examples and real psychology research datasets. Include ethical considerations in psychological research (informed consent, deception, institutional review boards)." \
  --specific-topics "The scientific method in psychology; formulating hypotheses and operationalising variables; experimental, quasi-experimental, and correlational designs; sampling methods and external validity; measurement and reliability/validity; descriptive statistics (central tendency, variability, distributions); z-scores and the normal distribution; hypothesis testing logic (null and alternative hypotheses, Type I and Type II errors, p-values); t-tests (one-sample, independent, paired); one-way ANOVA and post-hoc tests; correlation (Pearson r) and simple linear regression; effect sizes (Cohen's d, eta-squared, r-squared) and confidence intervals; APA-style results reporting" \
  --textbook "Recommended: Howitt, D. & Cramer, D. Introduction to Research Methods in Psychology; Field, A. Discovering Statistics Using IBM SPSS Statistics" \
  --output ./output/psych-research-methods
