import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './auth/LoginPage'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { TradeLogPage } from './pages/TradeLogPage'
import { TradeDetailPage } from './pages/TradeDetailPage'
import { JournalPage } from './pages/JournalPage'
import { CalendarPage } from './pages/CalendarPage'
import { StatsPage } from './pages/StatsPage'
import { PlaybooksPage } from './pages/PlaybooksPage'
import { PlaybookDetailPage } from './pages/PlaybookDetailPage'
import { AccountsPage } from './pages/AccountsPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/trades" element={<TradeLogPage />} />
            <Route path="/trades/:tradeId" element={<TradeDetailPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/playbooks" element={<PlaybooksPage />} />
            <Route path="/playbooks/:playbookId" element={<PlaybookDetailPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
