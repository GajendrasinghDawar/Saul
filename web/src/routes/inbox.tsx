import { createFileRoute } from '@tanstack/react-router'
import { Clock } from 'lucide-react'
import { useAppContext } from './__root'

export const Route = createFileRoute('/inbox')({
  component: InboxTab,
})

function InboxTab() {
  const { approvals } = useAppContext();

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
        {approvals.length === 0 ? <li className="p-6 text-center text-gray-500">Inbox Zero! 🎉</li> : 
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
