export interface ProviderConfig {
  id: 'claude' | 'gemini' | 'ollama' | 'tavily';
  heading: string;
  connectedHeading: string;
  tagline: string;
  required: boolean;
  costNote: string;
  deepLink: string;
  deepLinkLabel: string;
  steps: { text: string }[];
  placeholder: string;
  warnings: { type: 'alert' | 'info'; text: string }[];
  validationFailHint: string;
}

export const CLAUDE_COST_NOTE =
  'Pay-as-you-go \u2014 a full course typically costs around $20\u201330, depending on length.';

export const GEMINI_COST_NOTE =
  'Free to start \u2014 Google gives you $300 in trial credits. Covers infographics plus voice narration.';

export const CLAUDE_CONFIG: ProviderConfig = {
  id: 'claude',
  heading: 'Connect to Claude',
  connectedHeading: 'Connected to Claude',
  tagline:
    'Claude writes your course content, quizzes, and activities. This connection is required.',
  required: true,
  costNote: CLAUDE_COST_NOTE,
  deepLink: 'https://console.anthropic.com/settings/keys',
  deepLinkLabel: 'Open Anthropic Console',
  steps: [
    { text: 'Create a free account at console.anthropic.com' },
    { text: 'Add at least $5 in API credits (Settings \u2192 Billing)' },
    { text: 'Create an API key and paste it below' },
  ],
  placeholder: 'sk-ant-...',
  warnings: [
    {
      type: 'alert',
      text: 'A Claude Pro subscription is not the same as API access. You need API credits from the Anthropic Console.',
    },
    {
      type: 'info',
      text: 'Your API key is only shown once when created \u2014 save it somewhere safe.',
    },
  ],
  validationFailHint:
    'Check that you copied the full key from console.anthropic.com and that your account has API credits.',
};

export const GEMINI_CONFIG: ProviderConfig = {
  id: 'gemini',
  heading: 'Add infographics & voice narration',
  connectedHeading: 'Infographics & voice connected',
  tagline:
    'Generate custom illustrations for each chapter and a full spoken audiobook from your transcripts.',
  required: false,
  costNote: GEMINI_COST_NOTE,
  deepLink: 'https://aistudio.google.com/apikey',
  deepLinkLabel: 'Open Google AI Studio',
  steps: [
    { text: 'Sign in to Google AI Studio with your Google account' },
    { text: 'Click "Create API Key" and copy it' },
    { text: 'Enable Cloud billing if prompted (free trial works)' },
  ],
  placeholder: 'AIza...',
  warnings: [
    {
      type: 'info',
      text: 'School/university Google accounts may block AI Studio. Use a personal Google account if needed.',
    },
    {
      type: 'info',
      text: 'Image generation requires Cloud billing to be enabled, but the $300 free trial covers it.',
    },
  ],
  validationFailHint:
    'Check that you copied the full key from AI Studio and that your Google account has API access enabled.',
};

export const OLLAMA_COST_NOTE =
  'Pay-as-you-go on ollama.com — cheaper per-token than Claude. Quality on the rich JSON outputs (slides, weekly challenge) will be lumpier than Claude.';

export const OLLAMA_CONFIG: ProviderConfig = {
  id: 'ollama',
  heading: 'Connect to Ollama Cloud',
  connectedHeading: 'Connected to Ollama Cloud',
  tagline:
    'Open-weight alternative to Claude. Generates the same text outputs but cannot run the Research step (no built-in web search).',
  required: false,
  costNote: OLLAMA_COST_NOTE,
  deepLink: 'https://ollama.com/settings/keys',
  deepLinkLabel: 'Open Ollama Settings',
  steps: [
    { text: 'Sign in at ollama.com and open Settings → Keys' },
    { text: 'Click "Create key" and copy it' },
    { text: 'Paste it below and switch the provider toggle to Ollama' },
  ],
  placeholder: 'e.g. 0c5b33c8fe21440b955d5af824e3a5b2.mJroz...',
  warnings: [
    {
      type: 'info',
      text: 'Defaults to gpt-oss:120b-cloud. Other cloud-only models (qwen3-coder, deepseek-v3.1) can be selected after pasting the key.',
    },
    {
      type: 'info',
      text: 'Research step is disabled on Ollama — it relies on Claude’s built-in web search. Switch to Claude for that stage if you need it.',
    },
  ],
  validationFailHint:
    'Check that you copied the full key from ollama.com/settings/keys and that your account has cloud access enabled.',
};

export const TAVILY_COST_NOTE =
  'Free tier — 1,000 searches/month. Used by the Tavily research backend to surface academic sources.';

export const TAVILY_CONFIG: ProviderConfig = {
  id: 'tavily',
  heading: 'Connect to Tavily',
  connectedHeading: 'Connected to Tavily',
  tagline:
    'Web search for the research stage. Required only when Tavily is the selected research backend.',
  required: false,
  costNote: TAVILY_COST_NOTE,
  deepLink: 'https://tavily.com/',
  deepLinkLabel: 'Open Tavily',
  steps: [
    { text: 'Sign up at tavily.com (free tier covers ~1,000 searches/month)' },
    { text: 'Create an API key from the dashboard' },
    { text: 'Paste it below and select Tavily as the research backend' },
  ],
  placeholder: 'tvly-...',
  warnings: [
    {
      type: 'info',
      text: 'Only needed when the research backend is set to Tavily. Wikipedia and Anthropic backends do not require this key.',
    },
  ],
  validationFailHint:
    'Check that you copied the full key from the Tavily dashboard and that you have remaining free-tier quota.',
};

export const PROVIDER_CONFIGS = [CLAUDE_CONFIG, OLLAMA_CONFIG, TAVILY_CONFIG, GEMINI_CONFIG] as const;
