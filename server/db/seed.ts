import { db } from './index.ts'
import { todos } from './schema.ts'

async function seed() {
  await db.insert(todos).values([
    { id: '1', userId: 'seed-user', title: 'Buy milk' },
    { id: '2', userId: 'seed-user', title: 'Read background-agents course' },
    { id: '3', userId: 'seed-user', title: 'Launch Lali to the moon' },
  ])
  console.log('✅ Seeded 3 todos into the SQLite database!')
}

seed().catch(console.error)
