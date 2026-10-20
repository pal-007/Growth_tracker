import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Achievements from './pages/Achievements';
import Analytics from './pages/Analytics';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Focus from './pages/Focus';
import Goals from './pages/Goals';
import Habits from './pages/Habits';
import Journal from './pages/Journal';
import Review from './pages/Review';
import Routine from './pages/Routine';
import Settings from './pages/Settings';
import { useApp } from './store';

export default function App() {
  const { me, ready } = useApp();
  if (!ready) return <div className="min-h-screen grid place-items-center text-5xl float" aria-label="Loading">🚀</div>;
  if (!me) return <Auth />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="routine" element={<Routine />} />
        <Route path="goals" element={<Goals />} />
        <Route path="habits" element={<Habits />} />
        <Route path="focus" element={<Focus />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="journal" element={<Journal />} />
        <Route path="review" element={<Review />} />
        <Route path="achievements" element={<Achievements />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
