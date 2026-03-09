import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';

interface OrefHistoryItem {
  alertDate: string;
  title: string;
  data: string;       // city name
  category: number;
}

interface AlertHistoryProps {
  /** in-app alerts from socket (demo + real-time) */
  socketAlerts: { id: string; area: string; timestamp: number; source?: string }[];
}

const categoryLabel: Record<number, string> = {
  1: '🚀 Rockets',
  2: '✈️ Aircraft',
  3: '🧪 Chemical',
  4: '🌊 Tsunami',
  5: '🌍 Earthquake',
  6: '🔫 Hostile Infiltration',
  13: '🚀 Ballistic Missile',
  101: '✅ All Clear',
};

export default function AlertHistory({ socketAlerts }: AlertHistoryProps) {
  const [orefHistory, setOrefHistory] = useState<OrefHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/oref/history');
      if (res.ok) {
        const data = await res.json();
        setOrefHistory(Array.isArray(data) ? data.slice(0, 30) : []);
        setLastFetched(new Date());
      }
    } catch {
      // Server-side proxy not available
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // Refresh every 2 minutes
    const interval = setInterval(fetchHistory, 120_000);
    return () => clearInterval(interval);
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('he-IL', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const hasRealHistory = orefHistory.length > 0;
  const hasSocketAlerts = socketAlerts.length > 0;

  return (
    <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-black/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h3 className="text-xs font-bold uppercase tracking-wider">Alert History</h3>
          {hasRealHistory && (
            <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-bold">
              Pikud HaOref Live
            </span>
          )}
        </div>
        <button
          onClick={fetchHistory}
          disabled={loading}
          className="p-1.5 hover:bg-black/5 rounded-full transition-colors"
        >
          <RefreshCw className={`w-3 h-3 opacity-40 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto divide-y divide-black/5">
        {/* Real Oref history */}
        {hasRealHistory && orefHistory.map((item, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <span className="text-base mt-0.5">
              {categoryLabel[item.category]?.split(' ')[0] || '⚠️'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-red-700 truncate">{item.data}</p>
              <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                <Clock className="w-2.5 h-2.5" />
                {formatDate(item.alertDate)}
              </p>
            </div>
            <span className="text-[9px] text-gray-300 font-mono shrink-0">
              {categoryLabel[item.category]?.split(' ').slice(1).join(' ') || 'Alert'}
            </span>
          </div>
        ))}

        {/* Socket/demo alerts */}
        {!hasRealHistory && hasSocketAlerts && socketAlerts.map((alert) => (
          <div key={alert.id} className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              {alert.source === 'oref'
                ? <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                : <span className="w-2 h-2 rounded-full bg-orange-400" />
              }
              <div>
                <p className="text-xs font-bold">{alert.area}</p>
                {alert.source === 'demo' && (
                  <p className="text-[9px] text-gray-300">Simulation</p>
                )}
              </div>
            </div>
            <span className="text-[10px] opacity-40 font-mono">
              {new Date(alert.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {/* Empty state */}
        {!hasRealHistory && !hasSocketAlerts && (
          <p className="text-[11px] opacity-30 italic text-center py-4">
            {loading ? 'Loading...' : 'No recent alerts — Stay safe 🕊️'}
          </p>
        )}
      </div>

      {lastFetched && (
        <div className="px-4 py-2 border-t border-black/5">
          <p className="text-[9px] text-gray-300 text-center">
            Updated {lastFetched.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  );
}
