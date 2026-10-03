import { createFileRoute } from '@tanstack/react-router'
import { useAppContext } from './__root'

export const Route = createFileRoute('/events')({
  component: EventsTab,
})

function EventsTab() {
  const { view } = useAppContext();
  const events: any[] = []; // Disabled during pi-durable migration

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
