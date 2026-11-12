import { create } from 'zustand';

const useAppStore = create((set, get) => ({
  // ── Locations ──
  locations: [],
  selectedLocation: null,
  isLoadingLocations: false,

  setLocations: (locations) => set({ locations }),
  setSelectedLocation: (location) => set({ selectedLocation: location }),
  setLoadingLocations: (val) => set({ isLoadingLocations: val }),

  // ── Depth Data ──
  currentDepth: null,
  depthForecast: null,
  depthHistory: null,
  isLoadingDepth: false,

  setCurrentDepth: (data) => set({ currentDepth: data }),
  setDepthForecast: (data) => set({ depthForecast: data }),
  setDepthHistory: (data) => set({ depthHistory: data }),
  setLoadingDepth: (val) => set({ isLoadingDepth: val }),

  // ── Weather ──
  weatherData: null,
  tideData: null,

  setWeatherData: (data) => set({ weatherData: data }),
  setTideData: (data) => set({ tideData: data }),

  // ── Alerts ──
  alerts: [],
  isLoadingAlerts: false,

  setAlerts: (alerts) => set({ alerts }),
  setLoadingAlerts: (val) => set({ isLoadingAlerts: val }),

  // ── Analytics ──
  analytics: null,
  setAnalytics: (data) => set({ analytics: data }),

  // ── UI State ──
  sidebarCollapsed: false,
  activeView: 'dashboard',
  mapCenter: { lat: 20.5937, lng: 78.9629 }, // India center
  mapZoom: 5,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveView: (view) => set({ activeView: view }),
  setMapCenter: (center) => set({ mapCenter: center }),
  setMapZoom: (zoom) => set({ mapZoom: zoom }),

  // ── Search ──
  searchQuery: '',
  searchResults: [],
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchResults: (results) => set({ searchResults: results }),
}));

export default useAppStore;
