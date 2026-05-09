import { researchAnthropic } from './anthropic';
import { researchTavily } from './tavily';
import { researchWikipedia } from './wikipedia';
import type {
  ResearchBackend,
  ResearchProgressCallback,
  RunResearchOptions,
  RunResearchResult,
} from './types';

export type {
  ResearchBackend,
  ResearchProgress,
  ResearchProgressCallback,
  RunResearchOptions,
  RunResearchResult,
} from './types';

export async function runResearch(
  backend: ResearchBackend,
  options: RunResearchOptions,
  progress: ResearchProgressCallback,
): Promise<RunResearchResult> {
  switch (backend) {
    case 'anthropic':
      return researchAnthropic(options, progress);
    case 'tavily':
      return researchTavily(options, progress);
    case 'wikipedia':
      return researchWikipedia(options, progress);
  }
}
