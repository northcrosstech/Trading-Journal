import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './auth/LoginPage'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { TradeLogPage } from './pages/TradeLogPage'
import { TradeDetailPage } from './pages/TradeDetailPage'
import { JournalPage } from './pages/JournalPage'
import { StrategiesPage } from './pages/StrategiesPage'

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
            <Route path="/strategies" element={<StrategiesPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
