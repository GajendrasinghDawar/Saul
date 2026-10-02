import { createFileRoute } from '@tanstack/react-router'
import { MessageCircle, Send } from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/')({
  component: ChatTab,
})

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
