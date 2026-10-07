import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({
  node,
  inline,
  className,
  children,
  ...props
}: Record<string, unknown>) {
  const [copied, setCopied] = useState(false)

  const match = /language-(\w+)/.exec(className || '')
  const lang = match ? match[1] : ''

  const copy = () => {
    const text = String(children).replace(/\n$/, '')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!match && !className) {
    return (
      <code
        className='bg-slate3 rounded-md px-[0.3rem] py-[0.1rem] text-sm font-mono text-slate11'
        {...props}
      >
        {children}
      </code>
    )
  }

  return (
    <div className='relative group rounded-md border border-slate6 bg-slate2 overflow-hidden my-4 not-prose'>
      <div className='flex items-center justify-between bg-slate3 px-3 py-1.5 text-xs font-sans text-slate10 border-b border-slate6'>
        <span className='uppercase tracking-wider'>{lang || 'text'}</span>
        <button
          type='button'
          onClick={copy}
          className='flex items-center gap-1.5 text-slate9 hover:text-slate12 transition-colors'
          aria-label='Copy code'
        >
          {copied ? (
            <>
              <Check size={14} /> Copied
            </>
          ) : (
            <>
              <Copy size={14} /> Copy
            </>
          )}
        </button>
      </div>
      <div className='overflow-x-auto p-4 text-sm font-mono text-slate11'>
        <pre>
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    </div>
  )
}

export function MarkdownText({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: props => (
          <a
            target='_blank'
            rel='noopener noreferrer'
            className='text-blue10 hover:underline'
            {...props}
          />
        ),
        code: CodeBlock,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
