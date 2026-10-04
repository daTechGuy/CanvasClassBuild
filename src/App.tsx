import { useState, useEffect, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AppShell } from './components/layout/AppShell';
import { useCourseStore } from './store/courseStore';

const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const SetupPage = lazy(() => import('./pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const SyllabusPage = lazy(() => import('./pages/SyllabusPage').then((m) => ({ default: m.SyllabusPage })));
const ResearchPage = lazy(() => import('./pages/ResearchPage').then((m) => ({ default: m.ResearchPage })));
const BuildPage = lazy(() => import('./pages/BuildPage').then((m) => ({ default: m.BuildPage })));
const ExportPage = lazy(() => import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })));
const TemplatePreviewPage = lazy(() => import('./pages/TemplatePreviewPage').then((m) => ({ default: m.TemplatePreviewPage })));

function App() {
  const [hydrated, setHydrated] = useState(useCourseStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) return;
    return useCourseStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  if (!hydrated) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--cb-ground-page)',
          fontFamily: 'var(--font-cb-serif)',
        }}
      >
        <div
          className="cb-italic"
          style={{
            fontSize: 15,
            color: 'var(--cb-text-muted)',
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <span
            className="cb-sc cb-mono"
            style={{
              fontSize: 12,
              letterSpacing: '0.14em',
              color: 'var(--cb-accent-emphasis)',
            }}
          >
            cb · loading
          </span>
          <span>fetching local course data…</span>
        </div>
      </div>
    );
  }

  return (
    // reducedMotion="user" disables framer-motion transforms for users with
    // the OS "reduce motion" preference; the CSS side is handled by the
    // prefers-reduced-motion block in index.css.
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/syllabus" element={<SyllabusPage />} />
            <Route path="/research" element={<ResearchPage />} />
            <Route path="/build" element={<BuildPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/templates" element={<TemplatePreviewPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}

export default App;
