import { createRootRoute, Outlet, Link } from '@tanstack/react-router'
import { AlertCircle, Activity, List, Inbox, MessageCircle } from 'lucide-react'
import { useState, useEffect, createContext, useContext } from 'react'

type AppData = {
  view: any;
};

const AppContext = createContext<AppData>({ view: null });

export const useAppContext = () => useContext(AppContext);

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const [view, setView] = useState<any>(null);
  
  useEffect(() => {
    const sse = new EventSource('/api/stream');
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'init' || data.type === 'update') {
          setView(data.view);
        }
      } catch (_) {}
    };
    return () => sse.close();
  }, []);

  return (
    <AppContext.Provider value={{ view }}>
      <div className="min-h-screen bg-gray-50 flex items-start">
        {/* Sticky Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 p-4 hidden md:block sticky top-0 h-screen overflow-y-auto shrink-0">
          <div className="flex items-center gap-2 mb-8 px-2">
            <AlertCircle className="w-6 h-6 text-indigo-600" />
            <h1 className="font-bold text-xl text-gray-900">Lali</h1>
          </div>
          
          <nav className="space-y-1">
            <Link 
              to="/"
              activeProps={{ className: 'bg-indigo-50 text-indigo-600' }}
              inactiveProps={{ className: 'text-gray-700 hover:bg-gray-100' }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium"
            >
              <MessageCircle className="w-4 h-4" /> Chat
            </Link>
            <Link 
              to="/inbox"
              activeProps={{ className: 'bg-indigo-50 text-indigo-600' }}
              inactiveProps={{ className: 'text-gray-700 hover:bg-gray-100' }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Inbox className="w-4 h-4" /> Inbox
            </Link>
            <Link 
              to="/activity"
              activeProps={{ className: 'bg-indigo-50 text-indigo-600' }}
              inactiveProps={{ className: 'text-gray-700 hover:bg-gray-100' }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium"
            >
              <Activity className="w-4 h-4" /> Background Work (Runs)
            </Link>
            <Link 
              to="/events"
              activeProps={{ className: 'bg-indigo-50 text-indigo-600' }}
              inactiveProps={{ className: 'text-gray-700 hover:bg-gray-100' }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium"
            >
              <List className="w-4 h-4" /> Events
            </Link>
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="p-8 max-w-5xl mx-auto">
            <Outlet />
          </div>
        </div>
      </div>
    </AppContext.Provider>
  )
}
