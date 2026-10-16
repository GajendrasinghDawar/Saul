import { Link } from '@tanstack/react-router'
import { ArrowUpRight, ChartNoAxesCombined } from 'lucide-react'
import { useEffect, useState } from 'react'

type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  reasoning?: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
}
type UsageSummary = {
  generatedAt: string
  scope: 'owned-conversations'
  conversationCount: number
  totals: Usage
  models: { key: string; usage: Usage; costStatus: 'estimated' | 'unknown' }[]
  tools: { name: string; usage: Usage }[]
  unknownPricingModels: number
}

const number = new Intl.NumberFormat('en-US')
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})
function cost(value: number) {
  return value > 0 && value < 0.000001 ? '< $0.000001' : money.format(value)
}
const card = 'rounded-xl border border-slate5 bg-slate2 p-5'

export function SettingsOverview() {
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly starts a fresh request and cancels the previous one.
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    void (async () => {
      try {
        const response = await fetch('/api/usage', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Sign in again to view your usage.'
              : 'Usage is unavailable. Please try again.'
          )
        const result: UsageSummary = await response.json()
        if (!controller.signal.aborted) setData(result)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Usage is unavailable. Please try again.'
          )
      }
    })()
    return () => controller.abort()
  }, [attempt])

  const estimated =
    data?.models.filter(model => model.costStatus === 'estimated') ?? []
  const estimatedCost = estimated.reduce(
    (sum, model) => sum + model.usage.cost.total,
    0
  )

  return (
    <section aria-label='Overview' className='min-w-0 space-y-6'>
      <div className='flex items-start gap-3'>
        <ChartNoAxesCombined
          className='mt-1 shrink-0 text-slate10'
          size={20}
          aria-hidden='true'
        />
        <div>
          <h3 className='text-lg font-medium text-slate12'>Usage overview</h3>
          <p className='mt-1 text-sm text-slate10'>
            Lifetime recorded usage in conversations you own. Not a billing
            period or installation-wide total.
          </p>
        </div>
      </div>
      {!data && !error && (
        <p role='status' className={`${card} text-sm text-slate11`}>
          Loading recorded usage…
        </p>
      )}
      {error && (
        <div role='alert' className={card}>
          <p className='text-sm text-slate11'>{error}</p>
          <button
            type='button'
            onClick={() => setAttempt(value => value + 1)}
            className='mt-3 rounded-md border border-slate7 px-3 py-2 text-sm text-slate12 hover:bg-slate3'
          >
            Retry usage
          </button>
        </div>
      )}
      {data && (
        <>
          <div className='grid gap-3 sm:grid-cols-3'>
            <Metric
              label='Estimated model cost'
              value={estimated.length ? cost(estimatedCost) : 'Unknown'}
              detail={
                data.unknownPricingModels
                  ? `${number.format(data.unknownPricingModels)} model(s) with unknown pricing excluded`
                  : 'Recorded estimates · USD'
              }
            />
            <Metric
              label='Model tokens'
              value={number.format(data.totals.totalTokens)}
              detail='Input, output and cache tokens'
            />
            <Metric
              label='Conversations'
              value={number.format(data.conversationCount)}
              detail='Owned conversations in this record'
            />
          </div>
          {data.models.length === 0 ? (
            <div className={card}>
              <h4 className='font-medium text-slate12'>
                No model usage recorded yet
              </h4>
              <p className='mt-2 text-sm text-slate10'>
                Usage will appear here when model activity is recorded in your
                conversations. Missing records are not evidence of zero provider
                charges.
              </p>
            </div>
          ) : (
            <UsageTable
              title='Model breakdown'
              rows={data.models.map(model => ({
                name: model.key,
                usage: model.usage,
                price:
                  model.costStatus === 'estimated'
                    ? cost(model.usage.cost.total)
                    : 'Unknown',
              }))}
            />
          )}
          {data.tools.length > 0 && (
            <div className='space-y-3'>
              <UsageTable
                title='Tool usage'
                rows={data.tools.map(tool => ({
                  name: tool.name,
                  usage: tool.usage,
                  price:
                    tool.usage.cost.total > 0
                      ? cost(tool.usage.cost.total)
                      : 'Unknown',
                }))}
              />
              <p className='text-xs text-slate10'>
                Tool counters are reported separately and are not added to model
                totals; they may overlap model activity. Tool costs are recorded
                estimates where available.
              </p>
            </div>
          )}
        </>
      )}
      <aside
        className={`${card} text-sm text-slate11`}
        aria-label='About these estimates'
      >
        <h4 className='font-medium text-slate12'>A usage record, not a bill</h4>
        <p className='mt-2'>
          Costs are estimates from recorded activity, not actual billing.
          Unknown or zero rates do not mean usage is free. Unpriced models are
          excluded from the estimated total. Estimates may be incomplete when
          pricing or usage records are missing.
        </p>
        <p className='mt-2 text-slate10'>
          Provider invoices, subscription balances and quotas are unavailable in
          Saul. Check your provider’s account for actual charges and limits.
        </p>
      </aside>
      <div className='grid gap-3 sm:grid-cols-2'>
        <Link
          to='/settings/ai-providers'
          className={`${card} group hover:border-slate7`}
        >
          <span className='flex items-center justify-between gap-3 font-medium text-slate12'>
            AI providers <ArrowUpRight size={16} aria-hidden='true' />
          </span>
          <p className='mt-2 text-sm text-slate10'>
            Manage connections, credentials and the default model for new chats.
          </p>
        </Link>
        <Link
          to='/settings/environment-variables'
          className={`${card} hover:border-slate7`}
        >
          <span className='flex items-center justify-between gap-3 font-medium text-slate12'>
            Environment <ArrowUpRight size={16} aria-hidden='true' />
          </span>
          <p className='mt-2 text-sm text-slate10'>
            Find guidance for server configuration and deployment secrets.
          </p>
        </Link>
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className={card}>
      <p className='text-sm text-slate10'>{label}</p>
      <p className='mt-3 break-words text-2xl font-semibold tracking-tight text-slate12 tabular-nums'>
        {value}
      </p>
      <p className='mt-2 text-xs text-slate10'>{detail}</p>
    </div>
  )
}

function UsageTable({
  title,
  rows,
}: {
  title: string
  rows: { name: string; usage: Usage; price: string }[]
}) {
  return (
    <div className='min-w-0 rounded-xl border border-slate5 bg-slate2'>
      <section
        className='overflow-x-auto rounded-xl focus-visible:outline-slate8'
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the wide table.
        tabIndex={0}
        aria-label={`${title}, scroll horizontally for all counters`}
      >
        <table className='w-full text-left text-sm text-slate11'>
          <caption className='p-5 text-left font-medium text-slate12'>
            {title}
          </caption>
          <thead className='border-y border-slate5 bg-slate3 text-xs text-slate10'>
            <tr>
              {[
                'Name',
                'Input',
                'Output',
                'Cache read',
                'Cache write',
                'Reasoning',
                'Total tokens',
                'Estimated USD',
              ].map(label => (
                <th
                  scope='col'
                  key={label}
                  className='whitespace-nowrap px-5 py-3 font-medium'
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.name}
                className='border-b border-slate5 last:border-0'
              >
                <th
                  scope='row'
                  className='min-w-40 max-w-72 break-words px-5 py-4 font-medium text-slate12'
                >
                  {row.name}
                </th>
                {[
                  row.usage.input,
                  row.usage.output,
                  row.usage.cacheRead,
                  row.usage.cacheWrite,
                  row.usage.reasoning,
                  row.usage.totalTokens,
                ].map((value, index) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: Fixed counter columns have no local state.
                    key={index}
                    className='whitespace-nowrap px-5 py-4 tabular-nums'
                  >
                    {value === undefined ? '—' : number.format(value)}
                  </td>
                ))}
                <td className='whitespace-nowrap px-5 py-4 tabular-nums'>
                  {row.price}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
