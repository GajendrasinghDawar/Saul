import saulMark from '../assets/saul-mark.svg'
import { cn } from '../lib/cn'

export function SaulMark({ className }: { className?: string }) {
  return (
    <img
      src={saulMark}
      alt=''
      aria-hidden='true'
      width={128}
      height={128}
      className={cn('size-10 shrink-0', className)}
    />
  )
}

export function SaulBrand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <SaulMark className='size-12' />
      <span className='text-2xl font-bold tracking-tight text-slate12'>
        Saul
      </span>
    </div>
  )
}
