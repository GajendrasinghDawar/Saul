import { randomUUID } from 'node:crypto'
import type { AuthEvent, AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import { AiError, type AiManager } from './ai.ts'

type PublicPrompt<T> = T extends AuthPrompt
  ? Omit<T, 'signal'> & { id: string }
  : never
type State = {
  id: string
  providerId: string
  status: 'pending' | 'complete' | 'error' | 'cancelled'
  prompt?: PublicPrompt<AuthPrompt>
  events: AuthEvent[]
  error?: string
}
type Session = {
  owner: string
  expires: number
  controller: AbortController
  state: State
  answer?: (value: string) => void
}
export class AiLogins {
  private sessions = new Map<string, Session>()
  private timer = setInterval(() => this.prune(), 30_000).unref()
  constructor(privateManager: AiManager) {
    this.manager = privateManager
  }
  private manager: AiManager
  close() {
    clearInterval(this.timer)
    for (const s of this.sessions.values()) s.controller.abort()
    this.sessions.clear()
  }
  private prune() {
    for (const [id, s] of this.sessions)
      if (Date.now() > s.expires) {
        s.controller.abort()
        this.sessions.delete(id)
      }
  }
  private session(id: string, owner: string) {
    this.prune()
    const s = this.sessions.get(id)
    if (!s || s.owner !== owner)
      throw new AiError('Login session not found or expired.')
    return s
  }
  get(id: string, owner: string) {
    return structuredClone(this.session(id, owner).state)
  }
  start(providerId: string, method: AuthType, owner: string) {
    this.prune()
    const p = this.manager.models.getProvider(providerId)
    if (
      !p ||
      !(method === 'api_key'
        ? p.auth.apiKey?.login
        : method === 'oauth'
          ? p.auth.oauth
          : false)
    )
      throw new AiError('Login method is unavailable.')
    if (
      this.sessions.size >= 50 ||
      [...this.sessions.values()].filter(
        s => s.owner === owner && s.state.status === 'pending'
      ).length >= 3
    )
      throw new AiError('Too many login sessions. Cancel an existing login.')
    const id = randomUUID()
    const s: Session = {
      owner,
      expires: Date.now() + 10 * 60_000,
      controller: new AbortController(),
      state: { id, providerId, status: 'pending', events: [] },
    }
    this.sessions.set(id, s)
    void this.manager.models
      .login(
        providerId,
        method,
        {
          signal: s.controller.signal,
          notify: event => {
            if (s.state.status === 'pending' && s.state.events.length < 100)
              s.state.events.push(structuredClone(event))
          },
          prompt: prompt =>
            new Promise<string>((resolve, reject) => {
              const { signal, ...publicPrompt } = prompt
              const promptId = randomUUID()
              const cleanup = () => {
                signal?.removeEventListener('abort', abort)
                s.controller.signal.removeEventListener('abort', abort)
                if (s.state.prompt?.id === promptId) {
                  delete s.state.prompt
                  delete s.answer
                }
              }
              const abort = () => {
                cleanup()
                reject(new Error('Login cancelled'))
              }
              if (signal?.aborted || s.controller.signal.aborted) {
                abort()
                return
              }
              s.state.prompt = { ...publicPrompt, id: promptId }
              s.answer = value => {
                cleanup()
                resolve(value)
              }
              signal?.addEventListener('abort', abort, { once: true })
              s.controller.signal.addEventListener('abort', abort, {
                once: true,
              })
            }),
        },
        { getDeviceId: this.manager.getDeviceId }
      )
      .then(
        () => {
          if (s.state.status === 'pending') s.state.status = 'complete'
        },
        () => {
          if (s.state.status === 'pending') {
            s.state.status = 'error'
            s.state.error =
              'Provider login failed. Check configuration and try again.'
          }
        }
      )
      .finally(() => {
        delete s.state.prompt
        delete s.answer
      })
    if (method === 'oauth')
      s.state.events.push({
        type: 'info',
        message:
          'If the provider redirects to localhost, the callback runs on the Saul server, not your browser. Use the manual code/URL prompt where available; otherwise run login on the server host.',
      })
    return this.get(id, owner)
  }
  answer(id: string, owner: string, promptId: unknown, value: unknown) {
    const s = this.session(id, owner)
    if (
      s.state.status !== 'pending' ||
      !s.answer ||
      s.state.prompt?.id !== promptId ||
      typeof value !== 'string' ||
      value.length > 16384 ||
      (s.state.prompt?.type === 'select' &&
        !s.state.prompt.options.some(option => option.id === value))
    )
      throw new AiError(
        'The login prompt is no longer pending or the answer is invalid.'
      )
    s.answer(value)
    return this.get(id, owner)
  }
  cancel(id: string, owner: string) {
    const s = this.session(id, owner)
    if (s.state.status === 'pending') {
      s.state.status = 'cancelled'
      s.controller.abort()
      delete s.state.prompt
      delete s.answer
    }
  }
  cancelProvider(id: string) {
    for (const s of this.sessions.values())
      if (s.state.providerId === id && s.state.status === 'pending') {
        s.state.status = 'cancelled'
        s.controller.abort()
      }
  }
}
