import { createFileRoute } from '@tanstack/react-router'
import { SettingsOverview } from '../components/settings-overview'

export const Route = createFileRoute('/settings/')({
  component: SettingsOverview,
})
