/**
 * Course-outline fields extracted from an instructor's uploaded outline DOCX.
 * Populates the "Begin Here" homepage (and other small slots) at IMSCC export
 * time. All fields are optional — the LLM extracts what's clearly present in
 * the source document and leaves the rest blank.
 */
export interface OutlineFields {
  courseTitle?: string;
  courseDescription?: string;
  courseInformation?: string;
  courseMaterials?: string;
}
