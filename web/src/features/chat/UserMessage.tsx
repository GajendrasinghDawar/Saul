import { GitFork } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

export function UserMessage({
  content,
  onFork,
}: {
  content: string
  onFork?: () => void
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.article
      initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.15 }}
      className='group/message flex w-full justify-end'
      data-role='user'
    >
      <div className='relative max-w-[calc(100%-2.5rem)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-slate5 bg-slate4 px-4 py-2.5 text-sm leading-relaxed text-slate12 shadow-1 sm:max-w-[min(fit-content,80%)]'>
        {content}
        {onFork && (
          <button
            onClick={onFork}
            title='Fork conversation from here'
            className='absolute -left-10 top-2 p-1.5 opacity-0 transition-opacity group-hover/message:opacity-100 hover:bg-slate3 hover:text-slate11 rounded-md text-slate9'
          >
            <GitFork size={15} />
          </button>
        )}
      </div>
    </motion.article>
  )
}
