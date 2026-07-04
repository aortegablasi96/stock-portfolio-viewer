import { PortfolioDashboard } from './components/PortfolioDashboard'

/**
 * Application root. Renders the read-only portfolio dashboard (Milestone M1).
 * All data flows over the typed IPC bridge (`window.api`); the renderer holds no
 * business logic and never reaches data sources directly.
 */
export function App(): React.JSX.Element {
  return <PortfolioDashboard />
}
