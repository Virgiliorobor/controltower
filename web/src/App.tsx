// Router + route guards. Auth at the boundary (the third layer of defense — RLS + route guards are the others).
// Unauthenticated → /login. Authoring routes (create/draft) are EDITOR-only; admin is ADMIN-only — a viewer who
// types the URL is redirected to the library (the chrome already omits the link — D0-7). The shell (TopBar) wraps
// the authenticated routes; login + interview/draft/create render their own full-bleed surfaces inside the shell.

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { TopBar } from './components/AppShell';
import { LoadingLine } from './components/primitives';
import LoginView from './views/LoginView';
import LibraryView from './views/LibraryView';
import MapView from './views/MapView';
import CreateChooserView from './views/CreateChooserView';
import FormCreateView from './views/FormCreateView';
import InterviewView from './views/InterviewView';
import DraftReviewView from './views/DraftReviewView';
import ContactsView from './views/ContactsView';
import FreshnessView from './views/FreshnessView';
import AdminView from './views/AdminView';
import { ApiRequestError } from './lib/api';

function Protected({ children, role }: { children: JSX.Element; role?: 'editor' | 'admin' }): JSX.Element {
  const { user, loading, isEditor, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-board-bg">
        <LoadingLine surface="board" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role === 'admin' && !isAdmin) return <Navigate to="/" replace />;
  if (role === 'editor' && !isEditor) return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }: { children: JSX.Element }): JSX.Element {
  return (
    // h-screen gives a definite 100vh height so flex-1 children resolve correctly.
    // overflow-auto lets scrollable views (Library, Admin, etc.) scroll naturally.
    <div className="flex h-screen flex-col bg-board-bg text-ink-onboard font-ui">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />

      <Route
        path="/"
        element={
          <Protected>
            <Shell>
              <LibraryView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/process/:processId"
        element={
          <Protected>
            <Shell>
              <MapView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/contacts"
        element={
          <Protected>
            <Shell>
              <ContactsView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/freshness"
        element={
          <Protected role="editor">
            <Shell>
              <FreshnessView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected role="admin">
            <Shell>
              <AdminView />
            </Shell>
          </Protected>
        }
      />

      {/* Authoring surfaces (editor/admin only) */}
      <Route
        path="/create"
        element={
          <Protected role="editor">
            <Shell>
              <CreateChooserView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/create/form"
        element={
          <Protected role="editor">
            <Shell>
              <FormCreateView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/create/interview"
        element={
          <Protected role="editor">
            <Shell>
              <InterviewView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/process/:processId/interview"
        element={
          <Protected role="editor">
            <Shell>
              <InterviewView />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/draft/:draftId"
        element={
          <Protected role="editor">
            <Shell>
              <DraftReviewView />
            </Shell>
          </Protected>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Re-exported so a future view layer can surface API error types without re-importing the lib.
export { ApiRequestError };
