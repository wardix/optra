import { useState, useEffect } from 'react'

interface Stats {
  total: number
  online: number
  offline: number
  error: number
  dyingGasp: number
  unspecified: number
  unknown: number
}

interface Subscriber {
  subscriber_id: number
  circuit_id: string
  homepass_id: string
  run_state: string
  rx_optical_power: number | null
  last_down_cause: string | null
  last_down_time: string | number | null
  raw_response: string
  updated_at: number
}

interface HistoryItem {
  id: number
  subscriber_id: number
  circuit_id: string
  homepass_id: string
  run_state: string
  last_down_cause: string | null
  last_down_time: string | number | null
  raw_response: string
  checked_at: number
}

const API_BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL.slice(0, -1)
  : import.meta.env.BASE_URL

export default function App() {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    online: 0,
    offline: 0,
    error: 0,
    dyingGasp: 0,
    unspecified: 0,
    unknown: 0,
  })

  const [activeTab, setActiveTab] = useState<
    'outages' | 'weak' | 'los' | 'unspecified' | 'unknown'
  >('outages')
  const [weakSignals, setWeakSignals] = useState<Subscriber[]>([])
  const [outages, setOutages] = useState<Subscriber[]>([])
  const [losOutages, setLosOutages] = useState<Subscriber[]>([])
  const [unspecifiedOutages, setUnspecifiedOutages] = useState<Subscriber[]>([])
  const [unknownOutages, setUnknownOutages] = useState<Subscriber[]>([])
  const [selectedHomepass, setSelectedHomepass] = useState<string | null>(null)
  const [historyList, setHistoryList] = useState<HistoryItem[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isCheckingOnt, setIsCheckingOnt] = useState(false)

  const handleManualCheck = async (subscriberId: number) => {
    if (historyList.length === 0) return

    setIsCheckingOnt(true)
    try {
      const res = await fetch(`${API_BASE}/api/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscriber_id: subscriberId,
          circuit_id: historyList[0].circuit_id,
          homepass_id: historyList[0].homepass_id,
        }),
      })
      if (res.ok) {
        // Re-fetch the history and basic data instantly!
        await Promise.all([
          fetchData(),
          (async () => {
            if (selectedHomepass) {
              const histRes = await fetch(`${API_BASE}/api/history/${selectedHomepass}`)
              if (histRes.ok) setHistoryList(await histRes.json())
            }
          })(),
        ])
      } else {
        const err = await res.json()
        alert(`Gagal memeriksa ONT: ${err.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error during manual check:', err)
      alert('Koneksi gagal atau server terputus.')
    } finally {
      setIsCheckingOnt(false)
    }
  }

  // Refresh stats and basic lists
  const fetchData = async () => {
    try {
      const statsRes = await fetch(`${API_BASE}/api/stats`)
      if (statsRes.ok) setStats(await statsRes.json())

      const weakRes = await fetch(`${API_BASE}/api/weak-signals`)
      if (weakRes.ok) setWeakSignals(await weakRes.json())

      const outagesRes = await fetch(`${API_BASE}/api/outages`)
      if (outagesRes.ok) setOutages(await outagesRes.json())

      const losRes = await fetch(`${API_BASE}/api/outages?type=los`)
      if (losRes.ok) setLosOutages(await losRes.json())

      const unspecifiedRes = await fetch(`${API_BASE}/api/outages?type=unspecified`)
      if (unspecifiedRes.ok) setUnspecifiedOutages(await unspecifiedRes.json())

      const unknownRes = await fetch(`${API_BASE}/api/outages?type=unknown`)
      if (unknownRes.ok) setUnknownOutages(await unknownRes.json())
    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    }
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000) // Auto refresh every 10 seconds
    return () => clearInterval(interval)
  }, [])

  // Load history when a subscriber is selected
  useEffect(() => {
    if (!selectedHomepass) return

    const fetchHistory = async () => {
      setIsLoadingHistory(true)
      try {
        const res = await fetch(`${API_BASE}/api/history/${selectedHomepass}`)
        if (res.ok) setHistoryList(await res.json())
      } catch (err) {
        console.error('Error loading history:', err)
      } finally {
        setIsLoadingHistory(false)
      }
    }

    fetchHistory()
  }, [selectedHomepass])

  // Timestamp format helpers
  const formatTime = (ts: string | number | null) => {
    if (!ts) return 'N/A'
    const num = typeof ts === 'string' ? parseInt(ts, 10) : ts
    if (isNaN(num)) return ts

    try {
      const date = new Date(num)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })

      const parts = formatter.formatToParts(date)
      const val = { day: '', month: '', year: '', hour: '', minute: '' }
      parts.forEach((p) => {
        if (p.type in val) {
          ;(val as any)[p.type] = p.value
        }
      })

      let hourStr = val.hour
      if (hourStr === '24') hourStr = '00'

      return `${val.year}-${val.month}-${val.day} ${hourStr}:${val.minute}`
    } catch (_) {
      return new Date(num).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    }
  }

  const formatRelativeDuration = (ts: string | number | null) => {
    if (!ts) return 'N/A'
    const num = typeof ts === 'string' ? parseInt(ts, 10) : ts
    if (isNaN(num)) return 'N/A'

    const diff = Date.now() - num
    if (diff < 0) return 'Baru saja'

    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days} hari ${hours % 24} jam`
    if (hours > 0) return `${hours} jam ${minutes % 60} menit`
    if (minutes > 0) return `${minutes} menit`
    return `${seconds} detik`
  }

  // Uptime percentage calculation
  const uptimePercentage =
    stats.total > 0 ? ((stats.online / stats.total) * 100).toFixed(1) : '100.0'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      {/* 🚀 Top Navigation Banner */}
      <header className="navbar bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 shadow-xl mb-8 p-4 flex flex-wrap md:flex-nowrap justify-between gap-4">
        <div>
          <span className="text-2xl font-black tracking-wider bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-500 bg-clip-text text-transparent">
            📡 OPTRA PORTAL
          </span>
          <span className="badge badge-indigo border-indigo-700/50 badge-sm font-semibold ml-2">
            v2.0
          </span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={fetchData}
            className="btn btn-outline border-slate-700 btn-sm hover:bg-slate-800 text-slate-300 gap-2"
          >
            🔄 Sync Data
          </button>
        </div>
      </header>

      {/* 📊 Network Stats Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card bg-slate-900 border border-slate-800 p-4 shadow-md rounded-2xl relative overflow-hidden group hover:border-indigo-500/50 transition">
          <div className="text-slate-400 font-bold text-xs uppercase tracking-wider">
            Total Pelanggan
          </div>
          <div className="text-3xl font-extrabold text-white mt-1">{stats.total}</div>
          <div className="text-xs text-slate-500 mt-2">Homepasses Aktif</div>
          <div className="absolute right-3 bottom-3 text-indigo-500 opacity-20 group-hover:scale-110 transition">
            👥
          </div>
        </div>

        <div className="card bg-slate-900 border border-slate-800 p-4 shadow-md rounded-2xl relative overflow-hidden group hover:border-emerald-500/50 transition">
          <div className="text-slate-400 font-bold text-xs uppercase tracking-wider">
            ONT Online
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 mt-1">{stats.online}</div>
          <div className="text-xs text-emerald-500/80 mt-2 font-bold">{uptimePercentage}%</div>
          <div className="absolute right-3 bottom-3 text-emerald-500 opacity-20 group-hover:scale-110 transition">
            🟢
          </div>
        </div>

        <div className="card bg-slate-900 border border-slate-800 p-4 shadow-md rounded-2xl relative overflow-hidden group hover:border-rose-500/50 transition">
          <div className="text-slate-400 font-bold text-xs uppercase tracking-wider">ONT Down</div>
          <div className="text-3xl font-extrabold text-rose-500 mt-1">{stats.offline}</div>
          <div className="text-xs text-rose-500/80 mt-2 font-bold">
            {stats.offline > 0 ? '⚠️ Gangguan Aktif' : 'Semua Terkoneksi'}
          </div>
          <div className="absolute right-3 bottom-3 text-rose-500 opacity-20 group-hover:scale-110 transition">
            🔴
          </div>
        </div>

        <div className="card bg-slate-900 border border-slate-800 p-4 shadow-md rounded-2xl relative overflow-hidden group hover:border-amber-500/50 transition">
          <div className="text-slate-400 font-bold text-xs uppercase tracking-wider">
            Mati Listrik (⚡)
          </div>
          <div className="text-3xl font-extrabold text-amber-500 mt-1">{stats.dyingGasp}</div>
          <div className="text-xs text-amber-400/80 mt-2 font-bold">Dying-Gasp Cooldown</div>
          <div className="absolute right-3 bottom-3 text-amber-500 opacity-20 group-hover:scale-110 transition">
            ⚡
          </div>
        </div>
      </section>

      {/* 🎛️ Interactive Tabs & Directory Filters */}
      <main className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 card bg-slate-900 border border-slate-800 shadow-xl rounded-2xl overflow-hidden p-6">
          <div className="flex flex-wrap gap-4 justify-between items-center mb-6 border-b border-slate-800 pb-4">
            <div className="tabs tabs-boxed bg-slate-950 p-1.5 rounded-xl flex flex-wrap gap-1">
              <button
                onClick={() => setActiveTab('outages')}
                className={`tab font-bold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-200 ${activeTab === 'outages' ? 'tab-active bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>🔴 Offline &gt; 40 Hari</span>
                {outages.length > 0 && (
                  <span
                    className={`badge badge-sm border-0 font-bold ${activeTab === 'outages' ? 'bg-white text-indigo-700' : 'bg-rose-500/20 text-rose-400'}`}
                  >
                    {outages.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('weak')}
                className={`tab font-bold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-200 ${activeTab === 'weak' ? 'tab-active bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>⚠️ Sinyal Lemah</span>
                {weakSignals.length > 0 && (
                  <span
                    className={`badge badge-sm border-0 font-bold ${activeTab === 'weak' ? 'bg-white text-indigo-700' : 'bg-amber-500/20 text-amber-400'}`}
                  >
                    {weakSignals.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('los')}
                className={`tab font-bold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-200 ${activeTab === 'los' ? 'tab-active bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>❌ Mati karena LOS</span>
                {losOutages.length > 0 && (
                  <span
                    className={`badge badge-sm border-0 font-bold ${activeTab === 'los' ? 'bg-white text-indigo-700' : 'bg-rose-500/20 text-rose-400'}`}
                  >
                    {losOutages.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('unspecified')}
                className={`tab font-bold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-200 ${activeTab === 'unspecified' ? 'tab-active bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>❓ Penyebab Tidak Spesifik (--)</span>
                {stats.unspecified > 0 && (
                  <span
                    className={`badge badge-sm border-0 font-bold ${activeTab === 'unspecified' ? 'bg-white text-indigo-700' : 'bg-slate-500/35 text-slate-300'}`}
                  >
                    {stats.unspecified}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('unknown')}
                className={`tab font-bold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-200 ${activeTab === 'unknown' ? 'tab-active bg-indigo-600 text-white shadow-md shadow-indigo-600/20' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <span>⚠️ Status Tidak Diketahui (Telemetri Gagal)</span>
                {stats.unknown > 0 && (
                  <span
                    className={`badge badge-sm border-0 font-bold ${activeTab === 'unknown' ? 'bg-white text-indigo-700' : 'bg-yellow-500/20 text-yellow-400'}`}
                  >
                    {stats.unknown}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 🔴 TAB 1: Longest Outages Table */}
          {activeTab === 'outages' && (
            <div className="overflow-x-auto">
              {outages.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-bold">
                  🎉 Hebat! Tidak ada ONT yang offline lebih dari 40 hari.
                </div>
              ) : (
                <table className="table table-zebra w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-slate-800 text-xs">
                      <th>Sirkuit ID / Homepass</th>
                      <th>Downtime Mulai</th>
                      <th>Durasi Gangguan</th>
                      <th>Penyebab Mati</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outages.map((out) => {
                      return (
                        <tr
                          key={out.subscriber_id}
                          onClick={() => setSelectedHomepass(out.homepass_id)}
                          className="hover:bg-slate-800/50 cursor-pointer border-slate-800/30 transition group"
                        >
                          <td>
                            <div className="font-extrabold text-white group-hover:text-indigo-400 transition">
                              {out.circuit_id}
                            </div>
                            <div className="text-[10px] text-slate-500">{out.homepass_id}</div>
                          </td>
                          <td className="text-xs font-mono">{formatTime(out.last_down_time)}</td>
                          <td>
                            <span className="badge badge-error border-0 text-white font-bold text-[10px]">
                              {formatRelativeDuration(out.last_down_time)}
                            </span>
                          </td>
                          <td className="text-xs">
                            {out.last_down_cause === 'dying-gasp' ? (
                              <span className="text-amber-500 font-bold">
                                ⚡ Dying-Gasp (Power)
                              </span>
                            ) : (
                              <span className="text-rose-400 font-bold">
                                ⚠️ {out.last_down_cause || 'LOS'}
                              </span>
                            )}
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-xs text-indigo-400 group-hover:bg-slate-700 rounded-lg">
                              🔍 Log
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ⚠️ TAB 2: Weak Signals Table */}
          {activeTab === 'weak' && (
            <div className="overflow-x-auto">
              <table className="table table-zebra w-full text-left">
                <thead>
                  <tr className="text-slate-400 border-slate-800 text-xs">
                    <th>Sirkuit ID</th>
                    <th>Daya Optik (Rx)</th>
                    <th>Visual Indikator</th>
                    <th>WiFi SSID</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {weakSignals.map((ws) => {
                    const power = ws.rx_optical_power || -30

                    // Determine color coding
                    let barColor = 'bg-emerald-500'
                    let textColor = 'text-emerald-400'
                    let alertName = 'Good'

                    if (power <= -27) {
                      barColor = 'bg-rose-500 shadow-md shadow-rose-600/30'
                      textColor = 'text-rose-400 font-extrabold animate-pulse'
                      alertName = 'Critical'
                    } else if (power <= -24) {
                      barColor = 'bg-amber-500'
                      textColor = 'text-amber-400 font-bold'
                      alertName = 'Warning'
                    }

                    // Convert power to progress percentage (e.g. -15dBm -> 80%, -30dBm -> 10%)
                    const pct = Math.max(5, Math.min(100, Math.round(((power + 40) / 30) * 100)))

                    const parsed = JSON.parse(ws.raw_response)

                    return (
                      <tr
                        key={ws.subscriber_id}
                        onClick={() => setSelectedHomepass(ws.homepass_id)}
                        className="hover:bg-slate-800/50 cursor-pointer border-slate-800/30 transition group"
                      >
                        <td>
                          <div className="font-extrabold text-white group-hover:text-indigo-400 transition">
                            {ws.circuit_id}
                          </div>
                          <div className="text-[10px] text-slate-500">{ws.homepass_id}</div>
                        </td>
                        <td className="font-mono font-black">
                          <span className={textColor}>{power.toFixed(2)} dBm</span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-full bg-slate-950 rounded-full h-2.5 max-w-[120px]">
                              <div
                                className={`h-2.5 rounded-full ${barColor}`}
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                            <span className="text-[10px] text-slate-500 font-bold uppercase">
                              {alertName}
                            </span>
                          </div>
                        </td>
                        <td className="text-xs text-slate-400 font-semibold">
                          {parsed.ssid || 'N/A'}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-xs text-indigo-400 group-hover:bg-slate-700 rounded-lg">
                            🔍 Log
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ❌ TAB 3: LOS Outages Table */}
          {activeTab === 'los' && (
            <div className="overflow-x-auto">
              {losOutages.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-bold">
                  🎉 Hebat! Tidak ada gangguan akibat kabel putus (LOS) saat ini.
                </div>
              ) : (
                <table className="table table-zebra w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-slate-800 text-xs">
                      <th>Sirkuit ID / Homepass</th>
                      <th>Downtime Mulai</th>
                      <th>Durasi Gangguan</th>
                      <th>Penyebab Mati</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {losOutages.map((out) => {
                      return (
                        <tr
                          key={out.subscriber_id}
                          onClick={() => setSelectedHomepass(out.homepass_id)}
                          className="hover:bg-slate-800/50 cursor-pointer border-slate-800/30 transition group"
                        >
                          <td>
                            <div className="font-extrabold text-white group-hover:text-indigo-400 transition">
                              {out.circuit_id}
                            </div>
                            <div className="text-[10px] text-slate-500">{out.homepass_id}</div>
                          </td>
                          <td className="text-xs font-mono">{formatTime(out.last_down_time)}</td>
                          <td>
                            <span className="badge badge-error border-0 text-white font-bold text-[10px]">
                              {formatRelativeDuration(out.last_down_time)}
                            </span>
                          </td>
                          <td className="text-xs">
                            <span className="text-rose-500 font-extrabold animate-pulse">
                              ❌ LOS (Kabel Putus)
                            </span>
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-xs text-indigo-400 group-hover:bg-slate-700 rounded-lg">
                              🔍 Log
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ❓ TAB: Unspecified Outages Table */}
          {activeTab === 'unspecified' && (
            <div className="overflow-x-auto">
              {unspecifiedOutages.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-bold">
                  🎉 Hebat! Tidak ada ONT mati dengan penyebab tidak spesifik saat ini.
                </div>
              ) : (
                <table className="table table-zebra w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-slate-800 text-xs">
                      <th>Sirkuit ID / Homepass</th>
                      <th>Downtime Mulai</th>
                      <th>Durasi Gangguan</th>
                      <th>Penyebab Mati</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unspecifiedOutages.map((out) => {
                      return (
                        <tr
                          key={out.subscriber_id}
                          onClick={() => setSelectedHomepass(out.homepass_id)}
                          className="hover:bg-slate-800/50 cursor-pointer border-slate-800/30 transition group"
                        >
                          <td>
                            <div className="font-extrabold text-white group-hover:text-indigo-400 transition">
                              {out.circuit_id}
                            </div>
                            <div className="text-[10px] text-slate-500">{out.homepass_id}</div>
                          </td>
                          <td className="text-xs font-mono">{formatTime(out.last_down_time)}</td>
                          <td>
                            <span className="badge badge-error border-0 text-white font-bold text-[10px]">
                              {formatRelativeDuration(out.last_down_time)}
                            </span>
                          </td>
                          <td className="text-xs">
                            <span className="text-slate-400 font-extrabold">
                              ❓ Tidak Spesifik ({out.last_down_cause || '--'})
                            </span>
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-xs text-indigo-400 group-hover:bg-slate-700 rounded-lg">
                              🔍 Log
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ⚠️ TAB: Unknown / Failed Telemetry Table */}
          {activeTab === 'unknown' && (
            <div className="overflow-x-auto">
              {unknownOutages.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-bold">
                  🎉 Hebat! Tidak ada ONT dengan kegagalan penarikan data telemetri.
                </div>
              ) : (
                <table className="table table-zebra w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-slate-800 text-xs">
                      <th>Sirkuit ID / Homepass</th>
                      <th>Terakhir Diperiksa</th>
                      <th>Status Pengoperasian</th>
                      <th>Pesan Telemetri</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unknownOutages.map((out) => {
                      let errMessage = 'Gagal penarikan telemetri'
                      try {
                        const parsed = JSON.parse(out.raw_response)
                        if (parsed.error) {
                          errMessage = parsed.error
                        } else if (parsed.message) {
                          errMessage = parsed.message
                        }
                      } catch (_) {}

                      return (
                        <tr
                          key={out.subscriber_id}
                          onClick={() => setSelectedHomepass(out.homepass_id)}
                          className="hover:bg-slate-800/50 cursor-pointer border-slate-800/30 transition group"
                        >
                          <td>
                            <div className="font-extrabold text-white group-hover:text-indigo-400 transition">
                              {out.circuit_id}
                            </div>
                            <div className="text-[10px] text-slate-500">{out.homepass_id}</div>
                          </td>
                          <td className="text-xs font-mono">{formatTime(out.updated_at)}</td>
                          <td>
                            <span className="badge badge-warning border-0 text-slate-950 font-bold text-[10px]">
                              {out.run_state.toUpperCase()}
                            </span>
                          </td>
                          <td className="text-xs text-amber-500 font-semibold max-w-[200px] truncate">
                            {errMessage}
                          </td>
                          <td>
                            <button className="btn btn-ghost btn-xs text-indigo-400 group-hover:bg-slate-700 rounded-lg">
                              🔍 Log
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* 📊 RIGHT PANEL: Live History & Diagnostics Analyzer */}
        <aside className="card bg-slate-900 border border-slate-800 shadow-xl rounded-2xl p-6">
          <div className="border-b border-slate-800 pb-4 mb-4 flex justify-between items-center">
            <h3 className="text-lg font-black text-white">🔎 History Analyzer</h3>
            {selectedHomepass && (
              <button
                onClick={() => setSelectedHomepass(null)}
                className="btn btn-ghost btn-xs rounded-lg text-slate-500 hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>

          {!selectedHomepass ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-600">
              <span className="text-5xl mb-4">📈</span>
              <p className="font-bold text-sm">Pilih Pelanggan dari Tabel</p>
              <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                Klik baris tabel untuk memuat grafik riwayat kekuatan sinyal dan riwayat down-time.
              </p>
            </div>
          ) : (
            <div>
              {/* Active Selection Details Card */}
              {historyList.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl mb-6 text-xs relative overflow-hidden">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-extrabold">
                    Informasi ONT Terpilih
                  </div>
                  <div className="text-sm font-black text-white mt-1">
                    {historyList[0].circuit_id}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1">
                    {historyList[0].homepass_id}
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-800">
                    <div>
                      <div className="text-[10px] text-slate-500">Status OLT</div>
                      <div
                        className={`font-bold mt-0.5 ${historyList[0].run_state === 'online' ? 'text-emerald-400' : 'text-rose-400'}`}
                      >
                        {historyList[0].run_state.toUpperCase()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">WiFi SSID</div>
                      <div className="font-bold text-white mt-0.5">
                        {JSON.parse(historyList[0].raw_response).ssid || 'N/A'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-800 flex justify-center">
                    <button
                      onClick={() => handleManualCheck(historyList[0].subscriber_id)}
                      disabled={isCheckingOnt}
                      className={`btn btn-sm w-full font-bold text-xs rounded-lg flex items-center justify-center gap-2 border-0 transition-all duration-200 ${
                        isCheckingOnt
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white shadow-md shadow-indigo-600/20'
                      }`}
                    >
                      {isCheckingOnt ? (
                        <>
                          <span className="loading loading-spinner loading-xs"></span>
                          <span>Mengkueri OLT...</span>
                        </>
                      ) : (
                        <>
                          <span>⚡ Cek Status ONT Live</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Chronological History Timeline */}
              <h4 className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-3">
                Logs Sejarah (Terbaru ke Terlama)
              </h4>

              {isLoadingHistory ? (
                <div className="flex justify-center py-12">
                  <span className="loading loading-spinner loading-md text-indigo-500"></span>
                </div>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                  {historyList.map((hist) => {
                    const parsed = JSON.parse(hist.raw_response)
                    const isOnline = hist.run_state === 'online'
                    const isError = hist.run_state === 'error'

                    return (
                      <div
                        key={hist.id}
                        className={`p-3 rounded-xl border text-[11px] transition ${
                          isOnline
                            ? 'bg-slate-950/40 border-slate-800 hover:border-emerald-600/30'
                            : isError
                              ? 'bg-slate-900 border-slate-800/50'
                              : 'bg-rose-950/10 border-rose-900/30 hover:border-rose-600/30'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono text-slate-500 font-bold">
                            {formatTime(hist.checked_at)}
                          </span>
                          {isOnline ? (
                            <span className="badge badge-emerald border-0 text-white font-bold text-[9px]">
                              ONLINE
                            </span>
                          ) : isError ? (
                            <span className="badge bg-slate-700 border-0 text-white font-bold text-[9px]">
                              ERR
                            </span>
                          ) : (
                            <span className="badge badge-error border-0 text-white font-bold text-[9px]">
                              OFFLINE
                            </span>
                          )}
                        </div>

                        {isOnline ? (
                          <div className="mt-2 text-slate-400">
                            Daya Rx:{' '}
                            <strong className="text-cyan-400">
                              {parsed.rxOpticalPower || 'N/A'} dBm
                            </strong>
                          </div>
                        ) : (
                          <div className="text-rose-300/80 mt-2">
                            Penyebab:{' '}
                            <strong className="text-rose-400">
                              {parsed.lastDownCause || 'N/A'}
                            </strong>
                            {parsed.lastDownTime && (
                              <div className="text-[10px] text-slate-500 mt-1">
                                Mati sejak: {parsed.lastDownTime}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      </main>

      {/* 📝 Footer Copyright */}
      <footer className="text-center text-slate-600 text-xs py-8 mt-12 border-t border-slate-900 flex justify-between gap-4 flex-wrap">
        <div>© 2026 Protelindo FTTH NOC - All Rights Reserved.</div>
        <div className="font-mono text-[10px]">
          Sistem dipadukan secara asinkron menggunakan Bun SQL & Hono.
        </div>
      </footer>
    </div>
  )
}
