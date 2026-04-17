import { useCourseStore } from '../../store/courseStore';
import { useApiStore } from '../../store/apiStore';
import { THEMES, VOICE_OPTIONS, DEFAULT_VOICE_ID, type Theme } from '../../themes';

function ThemePreviewCard({ theme, selected, onClick }: { theme: Theme; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left transition-all cursor-pointer rounded-xl overflow-hidden"
      style={{
        border: selected ? `2.5px solid ${theme.accent}` : `1.5px solid ${theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
        boxShadow: selected
          ? `0 0 0 1px ${theme.accent}40, 0 4px 20px ${theme.accent}20`
          : '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <div
        className="px-5 py-4"
        style={{ background: theme.pageBg }}
      >
        <div
          className="text-[15px] font-bold mb-2.5 leading-tight"
          style={{ color: theme.textPrimary, fontFamily: theme.headingFont }}
        >
          {theme.name}
        </div>
        <p
          className="text-[12.5px] leading-[1.65]"
          style={{ color: theme.textSecondary, fontFamily: theme.bodyFont }}
        >
          Learn how <strong style={{ color: theme.textPrimary, fontWeight: 600 }}>retrieval practice</strong> strengthens memory. Concepts like{' '}
          <span style={{ color: theme.accent, fontWeight: 500 }}>spaced repetition</span>{' '}
          make learning stick.
        </p>
        <div className="flex items-center gap-2 mt-3">
          <div
            className="h-[3px] flex-1 rounded-full"
            style={{ background: `linear-gradient(to right, ${theme.accent}, ${theme.accentLight})` }}
          />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: theme.warmAccent }} />
        </div>
      </div>
    </button>
  );
}

function VoiceCard({
  voice,
  selected,
  onSelect,
}: {
  voice: typeof VOICE_OPTIONS[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full p-3 text-left cursor-pointer rounded-lg border transition-all ${
        selected
          ? 'border-violet-500/50 bg-violet-500/10'
          : 'border-violet-500/15 bg-bg-elevated hover:border-violet-500/30'
      }`}
    >
      <div className={`text-xs font-medium ${
        selected ? 'text-violet-400' : 'text-text-secondary'
      }`}>
        {voice.label}
      </div>
      <div className="text-xs text-text-muted mt-0.5">{voice.desc}</div>
    </button>
  );
}

export function StyleSelector() {
  const { setup, updateSetup } = useCourseStore();
  const { geminiApiKey } = useApiStore();
  const selectedTheme = setup.themeId || 'midnight';
  const storedVoice = setup.voiceId;
  // Old persisted state may hold ElevenLabs voice IDs; fall back to the Gemini default in that case.
  const selectedVoice = VOICE_OPTIONS.some(v => v.id === storedVoice) ? storedVoice : DEFAULT_VOICE_ID;

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-medium text-text-primary">Visual Theme</h3>

      <div className="grid grid-cols-2 gap-3">
        {THEMES.map((theme) => (
          <ThemePreviewCard
            key={theme.id}
            theme={theme}
            selected={selectedTheme === theme.id}
            onClick={() => updateSetup({ themeId: theme.id })}
          />
        ))}
      </div>

      {geminiApiKey && (
        <div className="pt-4 border-t border-violet-500/10">
          <h3 className="text-sm font-medium text-text-primary mb-1">Narrator Voice</h3>
          <p className="text-xs text-text-muted mb-3">
            Gemini text-to-speech voice used for chapter audiobooks.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {VOICE_OPTIONS.map((voice) => (
              <VoiceCard
                key={voice.id}
                voice={voice}
                selected={selectedVoice === voice.id}
                onSelect={() => updateSetup({ voiceId: voice.id })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
