import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'

export const Route = createFileRoute('/activity')({
  component: ActivityTab,
})

function ActivityTab() {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const fetchTasks = async () => {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
    };
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white shadow rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900">Background Work (Active Tasks)</h2>
        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {tasks.length} Tracked
        </span>
      </div>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Task Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phase</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Task ID</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {tasks.length === 0 ? (
            <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">No background tasks found.</td></tr>
          ) : tasks.map(task => (
            <tr key={task.id}>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-800">{task.name}</td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${task.state?.status === 'running' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {task.state?.status || 'unknown'}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{task.state?.checkpoint?.phase || '-'}</td>
              <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-gray-400">{task.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
