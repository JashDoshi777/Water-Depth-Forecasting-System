import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import LocationDetail from './pages/LocationDetail';
import Analytics from './pages/Analytics';
import Alerts from './pages/Alerts';
import Forecast from './pages/Forecast';
import Locations from './pages/Locations';
import DataSources from './pages/DataSources';

export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <BrowserRouter>
      <div className="app-layout">
        <button className="mobile-menu-btn" aria-label="Toggle navigation" onClick={() => setNavOpen((o) => !o)}>
          {navOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/location/:digipin" element={<LocationDetail />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/data-sources" element={<DataSources />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
