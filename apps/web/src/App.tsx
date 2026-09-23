import { Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/Landing.js';
import { RoomPage } from './pages/Room.js';
import { Toasts } from './components/Toasts.js';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </>
  );
}
