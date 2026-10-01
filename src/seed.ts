import { db } from './db/index.ts';
import { todos } from './db/schema.ts';

async function seed() {
  await db.insert(todos).values([
    { id: '1', title: 'Buy milk' },
    { id: '2', title: 'Read background-agents course' },
    { id: '3', title: 'Launch Lali to the moon' },
  ]);
  console.log('✅ Seeded 3 todos into the SQLite database!');
}

seed().catch(console.error);
