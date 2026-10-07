import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  memo,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/Tooltip'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant' | 'system'
}

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      data-role={from}
      className={cn(
        'group/message flex w-full flex-col gap-2',
        from === 'user'
          ? 'ml-auto max-w-[85%] items-end'
          : 'max-w-full items-start',
        className
      )}
      {...props}
    />
  )
}

export function MessageContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm leading-relaxed',
        'group-data-[role=user]/message:w-fit group-data-[role=user]/message:whitespace-pre-wrap group-data-[role=user]/message:break-words group-data-[role=user]/message:rounded-2xl group-data-[role=user]/message:rounded-br-md group-data-[role=user]/message:border group-data-[role=user]/message:border-slate5 group-data-[role=user]/message:bg-slate4 group-data-[role=user]/message:px-4 group-data-[role=user]/message:py-2.5 group-data-[role=user]/message:text-slate12 group-data-[role=user]/message:shadow-1',
        'group-data-[role=assistant]/message:w-full group-data-[role=assistant]/message:text-slate11',
        className
      )}
      {...props}
    />
  )
}

export function MessageActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-1', className)} {...props} />
}

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

export function MessageAction({
  tooltip,
  label,
  className,
  children,
  ...props
}: MessageActionProps) {
  const button = (
    <Button
      size='icon'
      variant='ghost'
      className={cn('size-8 text-slate9', className)}
      {...props}
    >
      {children}
      <span className='sr-only'>{label ?? tooltip}</span>
    </Button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      controls={false}
      lineNumbers={false}
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
      className={cn(
        'saul-message-response prose size-full min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className
      )}
      {...props}
    />
  ),
  (previous, next) =>
    previous.children === next.children &&
    previous.isAnimating === next.isAnimating &&
    previous.mode === next.mode
)

MessageResponse.displayName = 'MessageResponse'

export function MessageToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'mt-2 flex w-full items-center justify-between gap-4',
        className
      )}
      {...props}
    />
  )
}

type MessageBranchContextValue = {
  currentBranch: number
  totalBranches: number
  goToPrevious: () => void
  goToNext: () => void
  branches: ReactElement[]
  setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextValue | null>(
  null
)

function useMessageBranch() {
  const context = useContext(MessageBranchContext)
  if (!context) {
    throw new Error('MessageBranch components require MessageBranch')
  }
  return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number
  onBranchChange?: (branchIndex: number) => void
}

export function MessageBranch({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch)
  const [branches, setBranches] = useState<ReactElement[]>([])

  const changeBranch = useCallback(
    (branch: number) => {
      setCurrentBranch(branch)
      onBranchChange?.(branch)
    },
    [onBranchChange]
  )
  const goToPrevious = useCallback(() => {
    changeBranch(currentBranch > 0 ? currentBranch - 1 : branches.length - 1)
  }, [branches.length, changeBranch, currentBranch])
  const goToNext = useCallback(() => {
    changeBranch(currentBranch < branches.length - 1 ? currentBranch + 1 : 0)
  }, [branches.length, changeBranch, currentBranch])

  const value = useMemo(
    () => ({
      currentBranch,
      totalBranches: branches.length,
      goToPrevious,
      goToNext,
      branches,
      setBranches,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  )

  return (
    <MessageBranchContext.Provider value={value}>
      <div className={cn('grid w-full gap-2', className)} {...props} />
    </MessageBranchContext.Provider>
  )
}

export function MessageBranchContent({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const { currentBranch, branches, setBranches } = useMessageBranch()
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]) as ReactElement[],
    [children]
  )

  useEffect(() => {
    if (branches.length !== childrenArray.length) setBranches(childrenArray)
  }, [branches.length, childrenArray, setBranches])

  return childrenArray.map((branch, index) => (
    <div
      className={cn('grid gap-2', index === currentBranch ? 'block' : 'hidden')}
      key={branch.key ?? index}
      {...props}
    >
      {branch}
    </div>
  ))
}

export function MessageBranchSelector({
  className,
  ...props
}: ComponentProps<'div'>) {
  const { totalBranches } = useMessageBranch()
  if (totalBranches <= 1) return null
  return (
    <div className={cn('flex items-center gap-0.5', className)} {...props} />
  )
}

export function MessageBranchPrevious(props: ComponentProps<typeof Button>) {
  const { goToPrevious, totalBranches } = useMessageBranch()
  return (
    <Button
      aria-label='Previous branch'
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size='icon'
      variant='ghost'
      {...props}
    >
      {props.children ?? <ChevronLeft size={14} />}
    </Button>
  )
}

export function MessageBranchNext(props: ComponentProps<typeof Button>) {
  const { goToNext, totalBranches } = useMessageBranch()
  return (
    <Button
      aria-label='Next branch'
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size='icon'
      variant='ghost'
      {...props}
    >
      {props.children ?? <ChevronRight size={14} />}
    </Button>
  )
}

export function MessageBranchPage({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  const { currentBranch, totalBranches } = useMessageBranch()
  return (
    <span className={cn('px-2 text-xs text-slate9', className)} {...props}>
      {currentBranch + 1} of {totalBranches}
    </span>
  )
}
