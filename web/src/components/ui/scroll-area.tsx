import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import { cn } from '../../lib/cn'

export function ScrollArea({
  className,
  children,
  'aria-label': ariaLabel,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      {...props}
      data-slot='scroll-area'
      aria-label={ariaLabel}
      className={state =>
        cn(
          'relative min-h-0 min-w-0 overflow-hidden',
          typeof className === 'function' ? className(state) : className
        )
      }
    >
      <ScrollAreaPrimitive.Viewport
        data-slot='scroll-area-viewport'
        aria-label={ariaLabel}
        role={ariaLabel ? 'region' : undefined}
        className='size-full min-h-0 min-w-0 max-h-[inherit] rounded-[inherit] pr-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate8'
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner data-slot='scroll-area-corner' />
    </ScrollAreaPrimitive.Root>
  )
}

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      {...props}
      data-slot='scroll-area-scrollbar'
      orientation={orientation}
      className={state =>
        cn(
          'flex touch-none select-none p-px transition-colors',
          orientation === 'vertical'
            ? 'w-2.5 border-l border-l-transparent'
            : 'h-2.5 flex-col border-t border-t-transparent',
          typeof className === 'function' ? className(state) : className
        )
      }
    >
      <ScrollAreaPrimitive.Thumb
        data-slot='scroll-area-thumb'
        className='relative flex-1 rounded-full bg-slate7 hover:bg-slate8'
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}
