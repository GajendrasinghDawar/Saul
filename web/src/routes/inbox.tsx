import { createFileRoute } from '@tanstack/react-router'
import { Clock, CheckCircle } from 'lucide-react'
import { useAppContext } from './__root'

export const Route = createFileRoute('/inbox')({
  component: InboxTab,
})

function InboxTab() {
  const { view } = useAppContext();
  
  // pi-durable inbox
  const inboxDoc = view?.docs ? Object.values(view.docs).find((d: any) => d.kind === 'pi.inbox') as any : null;
  const approvals = inboxDoc?.items || [];

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
        {approvals.length === 0 ? <li className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
            <CheckCircle className="w-10 h-10 text-green-400" />
            <p>Inbox Zero! 🎉 No pending tool approvals.</p>
          </li> : 
         approvals.map((app: any) => (
          <li key={app.id} className="p-6 hover:bg-gray-50">
            <div className="flex justify-between items-start">
              <div>
                <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-1 rounded uppercase">Action: {app.type}</span>
                <pre className="mt-3 text-sm text-gray-700 bg-white border border-gray-200 p-4 rounded whitespace-pre-wrap">
                  {JSON.stringify(app, null, 2)}
                </pre>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
