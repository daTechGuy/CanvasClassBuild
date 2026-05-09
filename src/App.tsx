import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LandingPage } from './pages/LandingPage';
import { SetupPage } from './pages/SetupPage';
import { SyllabusPage } from './pages/SyllabusPage';
import { ResearchPage } from './pages/ResearchPage';
import { BuildPage } from './pages/BuildPage';
import { ExportPage } from './pages/ExportPage';
import { TemplatePreviewPage } from './pages/TemplatePreviewPage';
import { useCourseStore } from './store/courseStore';

function App() {
  const [hydrated, setHydrated] = useState(useCourseStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) return;
    return useCourseStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex items-center gap-3 text-text-muted text-sm">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          Loading course data...
        </div>
      </div>
    );
  }

  return (
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
  );
}

export default App;
