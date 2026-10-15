import {
  type SqliteDatabase,
  type SqliteExecutor,
  SqliteStorage,
  type SqliteValue,
} from '@earendil-works/pi-durable/storage/sqlite'
import { type Client, createClient, type Transaction } from '@libsql/client'

// Pi owns the schema. This adapter only translates and serializes SQL operations.
class LibsqlExecutor implements SqliteExecutor {
  private connection: Pick<Client, 'execute' | 'executeMultiple'>
  private access: <T>(operation: () => Promise<T>) => Promise<T>

  constructor(
    connection: Pick<Client, 'execute' | 'executeMultiple'>,
    access: <T>(operation: () => Promise<T>) => Promise<T>
  ) {
    this.connection = connection
    this.access = access
  }

  exec(sql: string) {
    return this.access(() => this.connection.executeMultiple(sql))
  }

  run(sql: string, ...params: SqliteValue[]) {
    return this.access(async () => {
      await this.connection.execute({ sql, args: params })
    })
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.access(async () => {
      const result = await this.connection.execute({ sql, args: params })
      // The caller supplies the shape selected by its SQL, as in Pi's Node adapter.
      return result.rows[0] as T | undefined
    })
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.access(async () => {
      const result = await this.connection.execute({ sql, args: params })
      return result.rows as T[]
    })
  }
}

export class LibsqlDatabase implements SqliteDatabase {
  private client: Client
  private executor: LibsqlExecutor
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private uncertain: Error | undefined

  constructor(client: Client) {
    this.client = client
    this.executor = new LibsqlExecutor(client, operation =>
      this.queue(operation)
    )
  }

  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.closed) throw new Error('libSQL database is closed')
      if (this.uncertain) throw this.uncertain
      return operation()
    })
    this.tail = result.catch(() => {})
    return result
  }

  exec(sql: string) {
    return this.executor.exec(sql)
  }

  run(sql: string, ...params: SqliteValue[]) {
    return this.executor.run(sql, ...params)
  }

  get<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.executor.get<T>(sql, ...params)
  }

  all<T extends object>(sql: string, ...params: SqliteValue[]) {
    return this.executor.all<T>(sql, ...params)
  }

  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>) {
    return this.queue(async () => {
      const transaction: Transaction = await this.client.transaction('write')
      let active = true
      const executor = new LibsqlExecutor(transaction, async operation => {
        if (!active) throw new Error('libSQL transaction handle has expired')
        return operation()
      })
      try {
        let result: T
        try {
          result = await callback(executor)
        } catch (error) {
          active = false
          try {
            await transaction.rollback()
          } catch (rollbackError) {
            this.uncertain = new AggregateError(
              [error, rollbackError],
              'libSQL rollback failed; close and reopen the harness before continuing'
            )
            throw this.uncertain
          }
          throw error
        }
        active = false
        try {
          await transaction.commit()
        } catch (error) {
          // A rejected remote commit may have reached the server. Never retry it
          // with stale in-memory Pi state or report a guaranteed rollback.
          this.uncertain = new Error(
            'libSQL commit outcome is uncertain; close and reopen the harness before continuing',
            { cause: error }
          )
          throw this.uncertain
        }
        return result
      } finally {
        active = false
        transaction.close()
      }
    })
  }

  close(): Promise<void> {
    const result = this.tail.then(() => {
      if (!this.closed) {
        this.closed = true
        this.client.close()
      }
    })
    this.tail = result.catch(() => {})
    return result
  }
}

// No replicas or offline writes: a remote URL is the authoritative database.
export function openLibsqlStorage(url: string, authToken?: string) {
  return SqliteStorage.open(
    new LibsqlDatabase(createClient({ url, authToken, intMode: 'number' }))
  )
}
