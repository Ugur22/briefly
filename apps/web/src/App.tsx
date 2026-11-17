import { Route, Routes } from 'react-router';
import { BriefPage } from './features/briefs/BriefPage';
import { NewBriefPage } from './features/briefs/NewBriefPage';
import { HealthStatus } from './features/health/HealthStatus';
import { LoginCallback } from './features/session/LoginCallback';
import { RequireSession } from './features/session/RequireSession';
import { WorkspaceList } from './features/workspaces/WorkspaceList';
import { WorkspacePage } from './features/workspaces/WorkspacePage';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login/callback" element={<LoginCallback />} />
        <Route element={<RequireSession />}>
          <Route path="/" element={<WorkspaceList />} />
          <Route path="/w/:wsId" element={<WorkspacePage />} />
          <Route path="/w/:wsId/briefs/new" element={<NewBriefPage />} />
          <Route path="/w/:wsId/briefs/:briefId" element={<BriefPage />} />
        </Route>
      </Routes>
      <footer>
        <HealthStatus />
      </footer>
    </>
  );
}
