import { createFileRoute } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-4 p-8 text-center'>
      <div className='flex size-12 items-center justify-center rounded-xl border border-slate5 bg-slate3 text-slate10'>
        <Sparkles size={22} />
      </div>
      <div>
        <h2 className='text-lg font-semibold text-slate12'>Settings</h2>
        <p className='mt-1 max-w-sm text-sm text-slate10'>
          Lali follows its dark application theme. Additional preferences will
          appear here.
        </p>
      </div>
    </div>
  )
}
