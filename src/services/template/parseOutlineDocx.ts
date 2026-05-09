import { streamMessage } from '../llm';
import type { OutlineFields } from '../../types/outline';

/**
 * Convert a DOCX File/Blob to plain text using mammoth.js. mammoth runs
 * entirely in the browser — no server round-trip needed.
 */
export async function docxToText(file: File | Blob): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

const SYSTEM_PROMPT = `You extract structured course-outline fields from raw text pulled out of a Microsoft Word course-outline document. Your output populates a Canvas course homepage, so accuracy matters more than completeness — leave fields blank if the source doesn't clearly contain them.

Extract these four fields, all optional:

- **courseTitle**: The course title (e.g. "SD203NF — Statistics for Data Science"). Often appears at the top of the document.
- **courseDescription**: A short paragraph summarizing what the course is about. Look for phrases like "Course Description", "Overview", "About this course". Plain text, no markdown.
- **courseInformation**: Logistical information — credit hours, prerequisites, meeting times, instructor, semester, format (online/hybrid/in-person), etc. Plain text. May be a few lines or short paragraphs.
- **courseMaterials**: Required textbooks, software, supplies. Plain text.

Output ONLY a JSON object with these four optional string fields. No markdown code fences. No commentary. Missing fields should be omitted (not empty strings).

Example output:
{
  "courseTitle": "SD203 Statistics for Data Science",
  "courseDescription": "Introduction to descriptive and inferential statistics with applications to data science...",
  "courseInformation": "3 credit hours · Online asynchronous · Prerequisite: MA101 College Algebra · Instructor: Dr. Brian Dye",
  "courseMaterials": "Required: OpenIntro Statistics (free PDF). Optional: R (free download)."
}`;

function parseOutlineFieldsResponse(text: string): OutlineFields {
  let json = text.trim();
  const fence = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) json = fence[1];
  const first = json.indexOf('{');
  const last = json.lastIndexOf('}');
  if (first === -1 || last === -1) return {};
  try {
    const raw = JSON.parse(json.slice(first, last + 1)) as Record<string, unknown>;
    const out: OutlineFields = {};
    if (typeof raw.courseTitle === 'string' && raw.courseTitle.trim()) out.courseTitle = raw.courseTitle.trim();
    if (typeof raw.courseDescription === 'string' && raw.courseDescription.trim()) out.courseDescription = raw.courseDescription.trim();
    if (typeof raw.courseInformation === 'string' && raw.courseInformation.trim()) out.courseInformation = raw.courseInformation.trim();
    if (typeof raw.courseMaterials === 'string' && raw.courseMaterials.trim()) out.courseMaterials = raw.courseMaterials.trim();
    return out;
  } catch {
    return {};
  }
}

export interface ExtractOutlineFieldsInput {
  apiKey: string;
  rawText: string;
  /** Cap to avoid blowing the prompt budget on long syllabi. */
  maxChars?: number;
}

export interface ExtractOutlineFieldsResult {
  fields: OutlineFields;
  rawText: string;
  rawLlmResponse: string;
}

export async function extractOutlineFields(
  input: ExtractOutlineFieldsInput,
): Promise<ExtractOutlineFieldsResult> {
  const maxChars = input.maxChars ?? 30_000;
  const trimmed = input.rawText.length > maxChars ? input.rawText.slice(0, maxChars) : input.rawText;

  const userMessage = `Extract the four course-outline fields from this Microsoft Word document text. The text was extracted with mammoth.js so paragraph breaks and headings may be flattened — use context to identify sections.

----- BEGIN OUTLINE TEXT -----
${trimmed}
----- END OUTLINE TEXT -----

Output ONLY the JSON.`;

  const rawLlmResponse = await streamMessage(
    {
      apiKey: input.apiKey,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1500,
    },
    {},
  );

  return {
    fields: parseOutlineFieldsResponse(rawLlmResponse),
    rawText: input.rawText,
    rawLlmResponse,
  };
}
