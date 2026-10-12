import { loadSecrets } from '../secretsManager.ts'
import { validateEnvironment } from './env.ts'

// Evaluate before auth and security modules capture bootstrap signing keys.
try {
  await loadSecrets()
  validateEnvironment()
} catch {
  console.error(
    'Server settings could not be loaded. Check the encryption key and legacy migration state.'
  )
  process.exit(1)
}
