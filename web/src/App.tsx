import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './auth/LoginPage'
import { ResetPasswordPage } from './auth/ResetPasswordPage'
import { AccountProvider } from './accounts/AccountContext'
import { Layout } from './components/Layout'
import { ReviewChecklistProvider } from './components/ReviewChecklistProvider'
import { TodayPage } from './pages/TodayPage'
import { TradeLogPage } from './pages/TradeLogPage'
import { TradeDetailPage } from './pages/TradeDetailPage'
import { JournalPage } from './pages/JournalPage'
import { ReviewPage } from './pages/ReviewPage'
import { InsightsPage } from './pages/InsightsPage'
import { AccountsPage } from './pages/AccountsPage'
import { ManualTradeEntryPage } from './pages/ManualTradeEntryPage'
import { CsvImportPage } from './pages/CsvImportPage'
import { RobinhoodImportPage } from './pages/RobinhoodImportPage'
import { SettingsPage } from './pages/SettingsPage'
import { NetWorthPage } from './pages/NetWorthPage'
import { PortfoliosPage } from './pages/PortfoliosPage'
import { PortfolioDetailPage } from './pages/PortfolioDetailPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            element={
              <RequireAuth>
                <AccountProvider>
                  <ReviewChecklistProvider>
                    <Layout />
                  </ReviewChecklistProvider>
                </AccountProvider>
              </RequireAuth>
            }
          >
            <Route path="/" element={<TodayPage />} />
            <Route path="/trades" element={<TradeLogPage />} />
            <Route path="/trades/new" element={<ManualTradeEntryPage />} />
            <Route path="/trades/:tradeId/edit" element={<ManualTradeEntryPage />} />
            <Route path="/trades/import" element={<CsvImportPage />} />
            <Route path="/trades/import/robinhood" element={<RobinhoodImportPage />} />
            <Route path="/trades/:tradeId" element={<TradeDetailPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/calendar" element={<Navigate to="/journal" replace />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/stats" element={<Navigate to="/insights" replace />} />
            <Route path="/playbooks/*" element={<Navigate to="/settings" replace />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/networth" element={<NetWorthPage />} />
            <Route path="/portfolios" element={<PortfoliosPage />} />
            <Route path="/portfolios/:portfolioId" element={<PortfolioDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
