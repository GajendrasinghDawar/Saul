import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Clock, AlertCircle, Activity, List, Inbox, MessageCircle, Send } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('chat');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  
  useEffect(() => {
    const sse = new EventSource('/api/stream');
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setApprovals(data.pending || []);
        setRuns(data.allRuns || []);
        setEvents(data.allEvents || []);
      } catch (err) {}
    };
    return () => sse.close();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 p-4 hidden md:block">
        <div className="flex items-center gap-2 mb-8 px-2">
          <AlertCircle className="w-6 h-6 text-indigo-600" />
          <h1 className="font-bold text-xl text-gray-900">Lali</h1>
        </div>
        
        <nav className="space-y-1">
          <button 
            onClick={() => setActiveTab('chat')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${activeTab === 'chat' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <MessageCircle className="w-4 h-4" /> Chat
          </button>
          <button 
            onClick={() => setActiveTab('inbox')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${activeTab === 'inbox' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <Inbox className="w-4 h-4" /> Inbox
          </button>
          <button 
            onClick={() => setActiveTab('activity')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${activeTab === 'activity' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <Activity className="w-4 h-4" /> Background Work (Runs)
          </button>
          <button 
            onClick={() => setActiveTab('events')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${activeTab === 'events' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <List className="w-4 h-4" /> Events
          </button>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8 max-w-5xl mx-auto">
          {activeTab === 'chat' && <ChatTab />}
          {activeTab === 'inbox' && <InboxTab approvals={approvals} />}
          {activeTab === 'activity' && <ActivityTab runs={runs} />}
          {activeTab === 'events' && <EventsTab events={events} />}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Chat Tab (Message Lali)
// ----------------------------------------------------
function ChatTab() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e: any) => {
    e.preventDefault();
    if (!message.trim()) return;
    
    setLoading(true);
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      setMessage('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-gray-500" />
        <h2 className="text-lg font-medium text-gray-900">Message Lali</h2>
      </div>
      <div className="p-6">
        <p className="text-sm text-gray-600 mb-4">Send a message to Lali. If you include words like "todo" or "remind", it will automatically extract the task and save it to your database!</p>
        <form onSubmit={sendMessage} className="flex gap-4">
          <input 
            type="text" 
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="E.g., I need to buy groceries..."
            className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3 border"
          />
          <button 
            type="submit" 
            disabled={loading}
            className="inline-flex items-center gap-2 px-6 py-3 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> Send
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Inbox Tab (Approvals)
// ----------------------------------------------------
function InboxTab({ approvals }: { approvals: any[] }) {
  const handleDecision = async (id: string, approved: boolean) => {
    await fetch(approved ? `/approve/${id}` : `/reject/${id}`, { method: 'POST' });
  };

  return (
    <div className="bg-white shadow rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-500" /> Pending Approvals
        </h2>
        <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {approvals.length} Queue
        </span>
      </div>
      <ul className="divide-y divide-gray-200">
        {approvals.length === 0 ? <li className="p-6 text-center text-gray-500">Inbox Zero! 😴</li> : 
         approvals.map(app => (
          <li key={app.id} className="p-6 hover:bg-gray-50">
            <div className="flex justify-between items-start">
              <div>
                <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded uppercase">Action: {app.action}</span>
                <p className="mt-3 text-sm text-gray-700 font-mono bg-white border border-gray-200 p-4 rounded whitespace-pre-wrap">{app.detail}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleDecision(app.id, false)} className="px-4 py-2 bg-red-100 text-red-700 rounded-md text-sm font-medium hover:bg-red-200">Reject</button>
                <button onClick={() => handleDecision(app.id, true)} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium shadow-sm hover:bg-indigo-700">Approve</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------
// Activity Tab (Runs)
// ----------------------------------------------------
function ActivityTab({ runs }: { runs: any[] }) {
  return (
    <div className="bg-white shadow rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-medium text-gray-900">Background Work (Runs)</h2>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Run ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {runs.map(run => (
            <tr key={run.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">{run.id}</td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${run.status === 'running' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {run.status}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(run.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------
// Events Tab (Timeline)
// ----------------------------------------------------
function EventsTab({ events }: { events: any[] }) {
  return (
    <div className="bg-white shadow rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-medium text-gray-900">System Events</h2>
      </div>
      <ul className="divide-y divide-gray-200">
        {events.length === 0 ? <li className="p-6 text-center text-gray-500">No events recorded yet.</li> : 
         events.map(ev => (
          <li key={ev.id} className="p-4 hover:bg-gray-50">
            <div className="flex gap-4">
              <span className="text-sm font-mono text-gray-400 shrink-0">{new Date(ev.createdAt).toLocaleTimeString()}</span>
              <div>
                <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded uppercase mb-1">{ev.type}</span>
                <p className="text-sm text-gray-900 font-mono">{ev.message}</p>
                <p className="text-xs text-gray-400 mt-1">Run: {ev.runId}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
