import { createFileRoute } from '@tanstack/react-router'
import { useAppContext } from './__root'

export const Route = createFileRoute('/events')({
  component: EventsTab,
})

function EventsTab() {
  const { view } = useAppContext();
  const subagentsDoc = view?.docs ? Object.values(view.docs).find((d: any) => d.kind === 'lali.subagents') as any : null;
  
  const agents = Object.entries(subagentsDoc?.agents || {});

  return (
    <div className="bg-white shadow rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-medium text-gray-900">Subagent Registry & Events</h2>
      </div>
      <ul className="divide-y divide-gray-200">
        {agents.length === 0 ? <li className="p-6 text-center text-gray-500">No subagents have been spawned yet.</li> : 
         agents.map(([name, data]: any) => (
          <li key={name} className="p-6 hover:bg-gray-50">
            <div className="flex gap-4">
              <span className="text-sm font-mono text-gray-400 shrink-0">Subagent</span>
              <div>
                <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded uppercase mb-1">{name}</span>
                <p className="text-sm text-gray-900 font-mono">Conversation ID: {data.conversationId}</p>
                <p className="text-xs text-gray-400 mt-2">Reported Entries: {data.reported?.length || 0}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
