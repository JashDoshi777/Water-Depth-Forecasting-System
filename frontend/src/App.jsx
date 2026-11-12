import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar, { TabBar } from './components/Sidebar';
import { useTheme } from './lib/theme';
import { Loading } from './components/ui';
import Dashboard from './pages/Dashboard';

const LocationDetail = lazy(() => import('./pages/LocationDetail'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Locations = lazy(() => import('./pages/Locations'));
const DataSources = lazy(() => import('./pages/DataSources'));
const MLLab = lazy(() => import('./pages/MLLab'));

function Shell() {
  const theme = useTheme();
  const { pathname } = useLocation();
  return (
    <div className="app">
      <Sidebar theme={theme} />
      <main className={`main ${pathname === '/' ? 'main--map' : ''}`} id="main">
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Dashboard scheme={theme.scheme} />} />
            <Route path="/location/:digipin" element={<LocationDetail />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/ml-lab" element={<MLLab />} />
            <Route path="/data-sources" element={<DataSources />} />
            <Route path="*" element={<Dashboard scheme={theme.scheme} />} />
          </Routes>
        </Suspense>
      </main>
      <TabBar theme={theme} />
    </div>
  );
}

export default function App() {
  return <BrowserRouter><Shell /></BrowserRouter>;
}
