import { useEffect, useState, useMemo, useRef, FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { User, Group, Alert, UserStatus, Language } from './types';
import { translations } from './translations';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  Users, 
  Bell, 
  CheckCircle2, 
  AlertTriangle, 
  MapPin, 
  Settings,
  ChevronRight,
  Info,
  Lightbulb,
  Globe,
  Briefcase,
  Heart,
  Map as MapIcon,
  X,
  QrCode,
  Timer,
  Search,
  Navigation,
  Phone,
  Mail
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateAlertMessage, generateGroupSummary } from './services/claudeService';
import { QRCodeSVG } from 'qrcode.react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import AlertHistory from './components/AlertHistory';

// Fix Leaflet icon issue
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Map Controller Component
function ChangeView({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  map.setView(center, zoom);
  return null;
}

// Mock User ID for demo - persisted across sessions
const MY_USER_ID = (() => {
  const stored = localStorage.getItem('allgood_user_id');
  if (stored) return stored;
  const id = 'user-' + Math.random().toString(36).substr(2, 4);
  localStorage.setItem('allgood_user_id', id);
  return id;
})();

export default function App() {
  const [userName, setUserName] = useState<string>(() => localStorage.getItem('allgood_name') || '');
  const [userPhone, setUserPhone] = useState<string>(() => localStorage.getItem('allgood_phone') || '');
  const [userEmail, setUserEmail] = useState<string>(() => localStorage.getItem('allgood_email') || '');
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(() => !localStorage.getItem('allgood_name'));
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [groups, setGroups] = useState<Record<string, { name: string, type: string, members: User[] }>>({});
  const [allAlerts, setAllAlerts] = useState<Alert[]>([]);
  const [currentAlert, setCurrentAlert] = useState<Alert | null>(null);
  const [myStatus, setMyStatus] = useState<UserStatus>('safe');
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'status' | 'groups' | 'map'>('status');
  const [safetyTips, setSafetyTips] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>('en');
  const [groupRoles, setGroupRoles] = useState<Record<string, 'member' | 'leader'>>(() => {
    const stored = localStorage.getItem('allgood_group_roles');
    return stored ? JSON.parse(stored) : {};
  });
  const [escalationAlert, setEscalationAlert] = useState<{ type: string, userName: string, groupName: string } | null>(null);
  const [alertSeconds, setAlertSeconds] = useState(0);
  const [inviteGroup, setInviteGroup] = useState<{ id: string, name: string } | null>(null);
  const [showCreateCircle, setShowCreateCircle] = useState(false);
  const [showJoinCircle, setShowJoinCircle] = useState(false);
  const [newCircleName, setNewCircleName] = useState('');
  const [joinCircleCode, setJoinCircleCode] = useState('');
  const [newCircleType, setNewCircleType] = useState<'family' | 'work' | 'friends'>('family');
  const [groupSummaries, setGroupSummaries] = useState<Record<string, string>>({});
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<Record<string, boolean>>({});
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  
  // Map state
  const [mapCenter, setMapCenter] = useState<[number, number]>([32.0853, 34.7818]);
  const [mapZoom, setMapZoom] = useState(13);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [watchedCities, setWatchedCities] = useState<string[]>(() => {
    const stored = localStorage.getItem('allgood_watched_cities');
    return stored ? JSON.parse(stored) : [];
  });
  const [myCity, setMyCity] = useState<string>('');
  const [showLocationSettings, setShowLocationSettings] = useState(false);
  const [manualCityInput, setManualCityInput] = useState('');

  const t = translations[lang];
  const isRTL = lang === 'he' || lang === 'ar';

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'he' ? 'he-IL' : lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : lang === 'ar' ? 'ar-SA' : 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentAlert) {
      interval = setInterval(() => {
        setAlertSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setAlertSeconds(0);
    }
    return () => clearInterval(interval);
  }, [currentAlert]);

  useEffect(() => {
    localStorage.setItem('allgood_group_roles', JSON.stringify(groupRoles));
  }, [groupRoles]);

  useEffect(() => {
    if (socket && socket.connected) {
      socket.emit('join-group', {
        userId: MY_USER_ID,
        userName: userName || 'User',
        groupIds: Object.keys(groupRoles),
        groupRoles: groupRoles
      });
    }
  }, [socket, groupRoles, userName]);

  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/join/')) {
      const groupId = path.split('/join/')[1];
      if (groupId) {
        setGroupRoles(prev => {
          if (prev[groupId]) return prev;
          return { ...prev, [groupId]: 'member' as const };
        });
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  // FIX 1: GPS useEffect is now its own separate block, outside the socket useEffect
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      setMapCenter([latitude, longitude]);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
        const data = await res.json();
        const city = data.address?.city || data.address?.town || data.address?.village || '';
        if (city) {
          setMyCity(city);
          setWatchedCities(prev => {
            if (prev.includes(city)) return prev;
            const updated = [city, ...prev].slice(0, 3);
            localStorage.setItem('allgood_watched_cities', JSON.stringify(updated));
            return updated;
          });
        }
      } catch {}
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('allgood_watched_cities', JSON.stringify(watchedCities));
  }, [watchedCities]);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('get-alerts');
      fetch('/api/alerts/active')
        .then(res => res.json())
        .then(data => {
          if (data && data.id) {
            const isRecent = (Date.now() - data.timestamp) < 600000;
            if (isRecent) {
              setCurrentAlert(data);
              setMyStatus('pending');
            }
          }
        })
        .catch(err => console.error('Alert check error:', err));
    });

    newSocket.on('group-update', ({ groupId, name, type, members }: { groupId: string, name: string, type: string, members: User[] }) => {
      setGroups(prev => ({ 
        ...prev, 
        [groupId]: { name, type, members } 
      }));
    });

    newSocket.on('group-created', ({ id, name, type }: { id: string, name: string, type: 'family' | 'work' | 'friends' }) => {
      setGroupRoles(prev => ({ ...prev, [id]: 'leader' as const }));
      setShowCreateCircle(false);
      setNewCircleName('');
    });

    newSocket.on('new-alert', async (alert: Alert) => {
      if (watchedCities.length > 0 && alert.cities) {
        const isRelevant = alert.cities.some(city => 
          watchedCities.some(w => city.includes(w) || w.includes(city))
        );
        if (!isRelevant) return;
      }
      setCurrentAlert(alert);
      setMyStatus('pending');
      newSocket.emit('update-status', { status: 'pending' });
      
      const firstGroupId = Object.keys(groupRoles)[0];
      const groupType = (firstGroupId?.split('-')[0] as 'family' | 'work' | 'friends') || 'family';
      const groupName = firstGroupId ? (firstGroupId.split('-').slice(1).join('-') || firstGroupId) : 'General';
      const isLeader = firstGroupId ? groupRoles[firstGroupId] === 'leader' : false;

      const message = await generateAlertMessage({
        userName: userName || 'User',
        groupName,
        groupType,
        area: alert.area,
        language: lang,
        isLeader
      });
      setSafetyTips(message);
      
      if (alert.lat && alert.lng) {
        setMapCenter([alert.lat, alert.lng]);
        setMapZoom(14);
      }
    });

    newSocket.on('urgent-retry', ({ message }: { message: string }) => {
      speak(message);
    });

    newSocket.on('escalation-alert', (data: { type: string, userName: string, groupName: string }) => {
      setEscalationAlert(data);
      speak(`Escalation alert: ${data.userName} from ${data.groupName} is unresponsive.`);
    });

    newSocket.on('all-alerts', (alerts: Alert[]) => {
      setAllAlerts(alerts);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const handleIAmOkay = () => {
    setMyStatus('safe');
    setCurrentAlert(null);
    setSafetyTips(null);
    socket?.emit('update-status', { status: 'safe' });
  };

  const handleIAmInDanger = () => {
    setMyStatus('danger');
    setCurrentAlert(null);
    setSafetyTips(null);
    socket?.emit('update-status', { status: 'danger' });
    window.location.href = 'tel:100';
  };

  const handleNotInArea = () => {
    setMyStatus('not-in-area');
    setCurrentAlert(null);
    setSafetyTips(null);
    socket?.emit('update-status', { status: 'not-in-area' });
  };

  const handleSaveName = (e: FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const newName = nameInput.trim();
    setUserName(newName);
    localStorage.setItem('allgood_name', newName);
    setShowNamePrompt(false);
    socket?.emit('join-group', {
      userId: MY_USER_ID,
      userName: newName,
      groupIds: Object.keys(groupRoles),
      groupRoles
    });
  };

  const handleCreateCircle = () => {
    if (newCircleName.trim()) {
      socket?.emit('create-group', { name: newCircleName, type: newCircleType });
    }
  };

  const handleJoinCircle = (code?: string) => {
    const finalCode = code || joinCircleCode.trim();
    if (finalCode) {
      setGroupRoles(prev => {
        if (prev[finalCode]) return prev;
        return { ...prev, [finalCode]: 'member' as const };
      });
      setShowJoinCircle(false);
      setJoinCircleCode('');
      setActiveTab('groups');
      setSelectedGroupId(finalCode);
    }
  };

  const handleGenerateSummary = async (groupId: string, groupName: string, members: User[]) => {
    setIsGeneratingSummary(prev => ({ ...prev, [groupId]: true }));
    try {
      const summary = await generateGroupSummary({
        leaderName: userName || 'Leader',
        groupName,
        members: members.map(m => ({ name: m.name, status: m.status })),
        language: lang
      });
      setGroupSummaries(prev => ({ ...prev, [groupId]: summary }));
    } catch (error) {
      console.error('Summary generation error:', error);
    } finally {
      setIsGeneratingSummary(prev => ({ ...prev, [groupId]: false }));
    }
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery + ', Israel')}&limit=1`);
      const data = await response.json();
      if (data && data.length > 0) {
        setMapCenter([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        setMapZoom(15);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const triggerDemoAlert = () => {
    socket?.emit('trigger-alert', { area: 'Tel Aviv', lat: 32.0853, lng: 34.7818 });
  };

  const getStatusColor = (status: UserStatus) => {
    switch (status) {
      case 'safe': return 'bg-emerald-500';
      case 'pending': return 'bg-yellow-500 animate-pulse';
      case 'danger': return 'bg-red-500 animate-pulse';
      case 'not-in-area': return 'bg-stone-100 border-stone-200';
      case 'unknown': return 'bg-yellow-500';
      default: return 'bg-yellow-500';
    }
  };

  const getStatusTextColor = (status: UserStatus) => {
    switch (status) {
      case 'safe': return 'text-emerald-600';
      case 'pending': return 'text-yellow-600';
      case 'danger': return 'text-red-600';
      case 'not-in-area': return 'text-stone-400';
      case 'unknown': return 'text-yellow-600';
      default: return 'text-yellow-600';
    }
  };

  const getScreenBg = (status: UserStatus) => {
    if (status === 'safe') return 'bg-emerald-50';
    if (status === 'pending') return 'bg-yellow-50';
    if (status === 'danger') return 'bg-red-50';
    if (status === 'not-in-area') return 'bg-stone-100';
    return 'bg-yellow-50';
  };

  const getStatusCardStyle = (status: UserStatus) => {
    if (status === 'safe') return 'bg-emerald-500 text-white border-emerald-600';
    if (status === 'pending') return 'bg-yellow-400 text-yellow-900 border-yellow-500';
    if (status === 'danger') return 'bg-red-500 text-white border-red-600';
    if (status === 'not-in-area') return 'bg-white text-stone-700 border-stone-200';
    return 'bg-yellow-400 text-yellow-900 border-yellow-500';
  };

  const getStatusEmoji = (status: UserStatus) => {
    if (status === 'safe') return '🟢';
    if (status === 'pending') return '🟡';
    if (status === 'danger') return '🔴';
    if (status === 'not-in-area') return '⚪';
    return '🟡';
  };

  return (
    <div className={cn(
      "min-h-screen font-sans selection:bg-emerald-100 transition-colors duration-700",
      getScreenBg(myStatus),
      isRTL ? "rtl" : "ltr"
    )} dir={isRTL ? 'rtl' : 'ltr'}>

      {/* Name Prompt - First Launch */}
      <AnimatePresence>
        {showNamePrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl"
            >
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-2xl font-black tracking-tight">Welcome to AllGood</h3>
                <p className="text-sm opacity-50 mt-2">What should your circle members call you?</p>
              </div>
              <form onSubmit={handleSaveName} className="space-y-4">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Your name..."
                  autoFocus
                  maxLength={30}
                  className="w-full bg-stone-50 border border-black/5 rounded-xl px-4 py-3 outline-none focus:border-emerald-500 transition-colors text-center font-bold text-lg"
                />
                <button
                  type="submit"
                  disabled={!nameInput.trim()}
                  className="w-full bg-black text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-colors disabled:opacity-20"
                >
                  Get Started →
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className={cn(
        "sticky top-0 z-40 backdrop-blur-md border-b px-6 py-4 flex items-center justify-between transition-colors duration-700",
        myStatus === 'safe' ? "bg-white/80 border-black/5" : 
        myStatus === 'pending' ? "bg-yellow-100/80 border-yellow-200" : 
        myStatus === 'danger' ? "bg-red-100/80 border-red-200" : 
        "bg-stone-100/80 border-stone-200"
      )}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Shield className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{t.appName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select 
            value={lang} 
            onChange={(e) => setLang(e.target.value as Language)}
            className="text-xs font-bold bg-black/5 border-none rounded-lg px-2 py-1 outline-none"
          >
            <option value="en">EN</option>
            <option value="he">HE</option>
            <option value="es">ES</option>
            <option value="ru">RU</option>
            <option value="ar">AR</option>
          </select>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-black/5 rounded-full transition-colors flex items-center gap-2"
          >
            {userName && <span className="text-sm font-bold opacity-60">{userName}</span>}
            <Settings className="w-5 h-5 opacity-60" />
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="sticky top-[65px] z-30 bg-white border-b border-black/5 shadow-lg"
          >
            <div className="max-w-md mx-auto px-6 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest opacity-40">Profile</h3>
                <button onClick={() => setShowSettings(false)}>
                  <X className="w-4 h-4 opacity-40" />
                </button>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const val = (e.currentTarget.elements.namedItem('editName') as HTMLInputElement).value.trim();
                if (val) {
                  setUserName(val);
                  localStorage.setItem('allgood_name', val);
                  setShowSettings(false);
                  socket?.emit('join-group', { userId: MY_USER_ID, userName: val, groupIds: Object.keys(groupRoles), groupRoles });
                }
              }} className="flex gap-2">
                <input
                  name="editName"
                  defaultValue={userName}
                  placeholder="Your name"
                  maxLength={30}
                  className="flex-1 bg-stone-50 border border-black/5 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 transition-colors font-medium"
                />
                <button type="submit" className="bg-black text-white font-bold px-4 py-2.5 rounded-xl text-sm hover:bg-stone-800 transition-colors">
                  Save
                </button>
              </form>
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2">Alert Zones</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  {watchedCities.map(city => (
                    <span key={city} className="flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded-full">
                      <MapPin className="w-3 h-3" />
                      {city}
                      <button onClick={() => setWatchedCities(prev => prev.filter(c => c !== city))}>
                        <X className="w-3 h-3 opacity-60 hover:opacity-100" />
                      </button>
                    </span>
                  ))}
                  {watchedCities.length === 0 && (
                    <p className="text-xs opacity-40">No zones set — receiving all alerts</p>
                  )}
                </div>
                {watchedCities.length < 3 && (
                  <div className="flex gap-2">
                    <input
                      value={manualCityInput}
                      onChange={e => setManualCityInput(e.target.value)}
                      placeholder="Add city..."
                      className="flex-1 bg-stone-50 border border-black/5 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={() => {
                        if (manualCityInput.trim()) {
                          setWatchedCities(prev => [...prev, manualCityInput.trim()].slice(0, 3));
                          setManualCityInput('');
                        }
                      }}
                      className="bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-xl"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-md mx-auto px-6 py-8 pb-32">
        {/* Escalation Alert Notification */}
        <AnimatePresence>
          {escalationAlert && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6 bg-red-600 text-white p-4 rounded-2xl shadow-xl flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-6 h-6" />
                <div>
                  <h4 className="font-bold text-sm">Escalation Alert</h4>
                  <p className="text-xs opacity-90">
                    {escalationAlert.userName} from {escalationAlert.groupName} is unresponsive.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setEscalationAlert(null)}
                className="text-xs font-bold bg-white/20 px-3 py-1 rounded-lg"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {activeTab === 'status' && (
          <>
            <section className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider opacity-50">{t.yourStatus}</h2>
                <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold uppercase">Live</span>
              </div>
              
              <motion.div 
                layout
                className={cn(
                  "p-6 rounded-3xl shadow-sm border transition-all duration-500",
                  myStatus === 'safe' ? "bg-white border-black/5" : 
                  myStatus === 'pending' ? "bg-yellow-50 border-yellow-200" :
                  myStatus === 'not-in-area' ? "bg-white border-stone-200" :
                  "bg-red-50 border-red-200 animate-pulse"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-16 h-16 rounded-2xl flex items-center justify-center",
                    myStatus === 'safe' ? "bg-emerald-50" : 
                    myStatus === 'pending' ? "bg-yellow-100" :
                    myStatus === 'not-in-area' ? "bg-stone-50" :
                    "bg-red-100 animate-pulse"
                  )}>
                    {myStatus === 'safe' ? (
                      <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                    ) : myStatus === 'not-in-area' ? (
                      <MapPin className="w-8 h-8 text-stone-400" />
                    ) : (
                      <AlertTriangle className={cn(
                        "w-8 h-8 animate-pulse",
                        (myStatus === 'pending' || myStatus === 'unknown') ? "text-yellow-600" : "text-red-600"
                      )} />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-2xl font-bold">
                        {myStatus === 'safe' ? t.safe : 
                         myStatus === 'pending' ? "Status Pending" :
                         myStatus === 'not-in-area' ? "Not in Area" :
                         myStatus === 'unknown' ? "Status Unknown" :
                         t.danger}
                      </h3>
                      {currentAlert && (
                        <div className="flex items-center gap-1 text-red-600 font-mono text-sm font-bold bg-red-50 px-2 py-1 rounded-lg">
                          <Timer className="w-3 h-3" />
                          {formatTime(alertSeconds)}
                        </div>
                      )}
                    </div>
                    <p className="opacity-60 text-sm">
                      {myStatus === 'safe' ? t.noAlerts : 
                       myStatus === 'pending' ? "Please confirm you are safe." :
                       myStatus === 'not-in-area' ? "You are currently outside the alert zone." :
                       myStatus === 'unknown' ? "We haven't heard from you in a while." :
                       "A siren was detected in Tel Aviv."}
                    </p>
                  </div>
                </div>

                {myStatus !== 'safe' && (
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={handleIAmOkay}
                    className="w-full mt-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-200 transition-all active:scale-95"
                  >
                    {t.imOkay}
                  </motion.button>
                )}
              </motion.div>
            </section>

            <section className="mt-12 p-6 bg-stone-200/50 rounded-3xl border border-black/5">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-4 h-4 opacity-40" />
                <h3 className="text-xs font-bold uppercase tracking-wider opacity-40">Developer Preview</h3>
              </div>
              <button 
                onClick={triggerDemoAlert}
                className="w-full bg-black text-white font-bold py-3 rounded-xl hover:bg-stone-800 transition-colors"
              >
                {t.demoAlert}
              </button>
            </section>
          </>
        )}

        {activeTab === 'groups' && (
          <div className="space-y-8">
            <AnimatePresence mode="wait">
              {!selectedGroupId ? (
                <motion.div
                  key="circles-list"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wider opacity-50">{t.circles}</h2>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setShowJoinCircle(true)}
                        className="flex items-center gap-1 text-xs font-bold text-stone-600 bg-stone-100 px-3 py-1.5 rounded-lg hover:bg-stone-200 transition-colors"
                      >
                        <QrCode className="w-3 h-3" />
                        {t.joinCircle}
                      </button>
                      <button 
                        onClick={() => setShowCreateCircle(true)}
                        className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                      >
                        <Users className="w-3 h-3" />
                        {t.createCircle}
                      </button>
                    </div>
                  </div>

                  {Object.keys(groups).length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-black/10">
                      <Users className="w-12 h-12 opacity-10 mx-auto mb-4" />
                      <p className="text-sm opacity-40">No circles yet. Create one to get started.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {(Object.entries(groups) as [string, { name: string, type: string, members: User[] }][]).map(([groupId, groupData]) => {
                        const { name: groupName, type: groupType, members } = groupData;
                        const myRole = groupRoles[groupId] || 'member';
                        const Icon = groupType === 'family' ? Heart : groupType === 'work' ? Briefcase : Users;
                        const safeCount = members.filter(m => m.status === 'safe').length;
                        const totalCount = members.length;

                        return (
                          <motion.button
                            key={groupId}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setSelectedGroupId(groupId)}
                            className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm flex items-center justify-between group text-left"
                          >
                            <div className="flex items-center gap-4">
                              <div className={cn(
                                "w-14 h-14 rounded-2xl flex items-center justify-center transition-colors",
                                groupType === 'family' ? "bg-red-50 text-red-600" :
                                groupType === 'work' ? "bg-blue-50 text-blue-600" :
                                "bg-emerald-50 text-emerald-600"
                              )}>
                                <Icon className="w-7 h-7" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="font-black text-lg tracking-tight">{groupName}</h3>
                                  <span className={cn(
                                    "text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest",
                                    myRole === 'leader' ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-400"
                                  )}>
                                    {myRole}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex -space-x-2">
                                    {members.slice(0, 3).map((m, i) => (
                                      <div key={m.id} className="w-6 h-6 rounded-full border-2 border-white bg-stone-100 flex items-center justify-center text-[10px] font-bold text-stone-400">
                                        {m.name[0]}
                                      </div>
                                    ))}
                                    {members.length > 3 && (
                                      <div className="w-6 h-6 rounded-full border-2 border-white bg-stone-50 flex items-center justify-center text-[8px] font-bold text-stone-400">
                                        +{members.length - 3}
                                      </div>
                                    )}
                                  </div>
                                  <span className="text-xs font-bold opacity-40">
                                    {safeCount}/{totalCount} {t.safeStatus}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 opacity-20 group-hover:opacity-100 transition-opacity" />
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="circle-detail"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  {(() => {
                    const groupId = selectedGroupId!;
                    const groupData = groups[groupId];
                    const members = groupData?.members || [];
                    const groupName = groupData?.name || groupId;
                    const groupType = groupData?.type || 'family';
                    const myRoleInGroup = groupRoles[groupId] || 'member';
                    const Icon = groupType === 'family' ? Heart : groupType === 'work' ? Briefcase : Users;

                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <button 
                            onClick={() => setSelectedGroupId(null)}
                            className="flex items-center gap-2 text-sm font-bold opacity-40 hover:opacity-100 transition-opacity"
                          >
                            <ChevronRight className={cn("w-4 h-4", isRTL ? "" : "rotate-180")} />
                            {t.backToCircles}
                          </button>
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              "text-[10px] font-black px-2 py-1 rounded-lg border uppercase",
                              myRoleInGroup === 'leader' ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-black/10 text-black/40"
                            )}>
                              {myRoleInGroup}
                            </span>
                            <button 
                              onClick={() => setInviteGroup({ id: groupId, name: groupName })}
                              className="text-xs font-bold text-emerald-600 hover:underline"
                            >
                              {t.invite}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 mb-8">
                          <div className={cn(
                            "w-16 h-16 rounded-[24px] flex items-center justify-center",
                            groupType === 'family' ? "bg-red-50 text-red-600" :
                            groupType === 'work' ? "bg-blue-50 text-blue-600" :
                            "bg-emerald-50 text-emerald-600"
                          )}>
                            <Icon className="w-8 h-8" />
                          </div>
                          <div>
                            <h2 className="text-2xl font-black tracking-tight">{groupName}</h2>
                            <p className="text-sm opacity-40 font-medium capitalize">{groupType} Circle • {members.length} members</p>
                          </div>
                        </div>

                        {myRoleInGroup === 'leader' && (
                          <div className="mb-8">
                            {groupSummaries[groupId] ? (
                              <motion.div 
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 text-sm text-emerald-800 relative group"
                              >
                                <div className="flex items-center gap-2 mb-2 opacity-60">
                                  <Lightbulb className="w-4 h-4" />
                                  <span className="font-bold uppercase tracking-widest text-[10px]">AI Intelligence Report</span>
                                </div>
                                <p className="leading-relaxed font-medium">{groupSummaries[groupId]}</p>
                                <button 
                                  onClick={() => handleGenerateSummary(groupId, groupName, members)}
                                  className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold underline"
                                >
                                  Refresh
                                </button>
                              </motion.div>
                            ) : (
                              <button 
                                onClick={() => handleGenerateSummary(groupId, groupName, members)}
                                disabled={isGeneratingSummary[groupId]}
                                className="w-full py-4 bg-white border border-dashed border-black/10 rounded-3xl text-xs font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-all flex items-center justify-center gap-2"
                              >
                                {isGeneratingSummary[groupId] ? (
                                  <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Lightbulb className="w-4 h-4" />
                                )}
                                Generate Safety Summary
                              </button>
                            )}
                          </div>
                        )}

                        <div className="space-y-3">
                          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30 px-2">{t.members}</h3>
                          {members.map((member) => (
                            <motion.div 
                              key={member.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="bg-white p-4 rounded-2xl border border-black/5 flex items-center justify-between shadow-sm"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-stone-50 flex items-center justify-center font-black text-stone-300 text-lg">
                                  {member.name[0]}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-bold">{member.name}</h4>
                                    {member.id === MY_USER_ID && <span className="text-[8px] font-black bg-stone-100 px-1.5 py-0.5 rounded uppercase opacity-40">You</span>}
                                  </div>
                                  <div className="flex flex-col gap-0.5">
                                    <p className="text-xs opacity-50 flex items-center gap-1 font-medium">
                                      <MapPin className="w-3 h-3" /> {member.location?.name || 'Home'}
                                    </p>
                                    {member.phone && (
                                      <a 
                                        href={`tel:${member.phone}`}
                                        className="text-xs text-emerald-600 flex items-center gap-1 font-bold hover:underline"
                                      >
                                        <Phone className="w-3 h-3" /> {member.phone}
                                      </a>
                                    )}
                                    {member.email && (
                                      <a 
                                        href={`mailto:${member.email}`}
                                        className="text-xs opacity-40 flex items-center gap-1 font-medium hover:underline"
                                      >
                                        <Mail className="w-3 h-3" /> {member.email}
                                      </a>
                                    )}
                                  </div>
                                  {member.location && member.id !== MY_USER_ID && (
                                    <button 
                                      onClick={() => {
                                        setMapCenter([member.location!.lat, member.location!.lng]);
                                        setMapZoom(16);
                                        setActiveTab('map');
                                      }}
                                      className="text-[8px] font-black text-emerald-600 uppercase tracking-widest hover:underline mt-1 block"
                                    >
                                      {t.viewOnMap}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <div className="flex items-center gap-2">
                                  <div className={cn("w-2 h-2 rounded-full", getStatusColor(member.status))} />
                                  <span className={cn("text-xs font-black uppercase tracking-wider", getStatusTextColor(member.status))}>
                                    {member.status === 'safe' ? t.safeStatus : member.status === 'pending' ? 'Pending' : member.status === 'not-in-area' ? t.notInAreaStatus : t.dangerStatus}
                                  </span>
                                </div>
                                {member.lastUpdate && (
                                  <span className="text-[8px] font-bold opacity-20 uppercase">
                                    {t.updated} {new Date(member.lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="space-y-4">
            <form onSubmit={handleSearch} className="relative">
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search location in Israel..."
                className="w-full bg-white border border-black/5 rounded-2xl px-12 py-4 outline-none focus:border-emerald-500 transition-all shadow-sm"
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 opacity-30" />
              {isSearching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </form>

            <section className="h-[60vh] bg-white rounded-3xl border border-black/5 overflow-hidden relative z-0">
              <MapContainer 
                center={mapCenter} 
                zoom={mapZoom} 
                className="h-full w-full"
                zoomControl={false}
              >
                <ChangeView center={mapCenter} zoom={mapZoom} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                
                <Marker position={mapCenter}>
                  <Popup>
                    <div className="text-center">
                      <p className="font-bold">{userName || 'You'}</p>
                      <p className="text-xs opacity-60">Your Location</p>
                    </div>
                  </Popup>
                </Marker>

                {selectedGroupId && groups[selectedGroupId]?.members?.map(member => (
                  member.location && member.id !== MY_USER_ID && (
                    <Marker 
                      key={member.id} 
                      position={[member.location.lat, member.location.lng]}
                      icon={L.divIcon({
                        className: 'custom-member-icon',
                        html: `<div class="relative">
                          <div class="w-8 h-8 rounded-full border-2 border-white shadow-lg flex items-center justify-center font-black text-xs text-white ${getStatusColor(member.status)}">
                            ${member.name[0]}
                          </div>
                          <div class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(member.status)}"></div>
                        </div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                      })}
                    >
                      <Popup>
                        <div className="text-center">
                          <p className="font-bold">{member.name}</p>
                          <p className={cn("text-[10px] font-black uppercase tracking-wider", getStatusTextColor(member.status))}>
                            {member.status}
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  )
                ))}

                {allAlerts.map((alert) => (
                  alert.lat && alert.lng && (
                    <Marker 
                      key={alert.id} 
                      position={[alert.lat, alert.lng]}
                      icon={L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="relative">
                          <div class="absolute -inset-4 bg-red-500/20 rounded-full animate-ping"></div>
                          <div class="w-4 h-4 bg-red-600 rounded-full border-2 border-white shadow-lg"></div>
                        </div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                      })}
                    >
                      <Popup>
                        <div className="text-center">
                          <p className="font-bold text-red-600">ALERT: {alert.area}</p>
                          <p className="text-xs opacity-60">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                        </div>
                      </Popup>
                    </Marker>
                  )
                ))}
              </MapContainer>
              
              <div className="absolute bottom-4 left-4 right-4 z-[1000]">
                <AlertHistory socketAlerts={allAlerts} />
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-black/5 px-8 py-4 pb-8 flex justify-around items-center z-50">
        <button 
          onClick={() => setActiveTab('status')}
          className={cn("flex flex-col items-center gap-1 transition-colors", activeTab === 'status' ? "text-emerald-600" : "opacity-40 hover:opacity-100")}
        >
          <Shield className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.status}</span>
        </button>
        <button 
          onClick={() => setActiveTab('groups')}
          className={cn("flex flex-col items-center gap-1 transition-colors", activeTab === 'groups' ? "text-emerald-600" : "opacity-40 hover:opacity-100")}
        >
          <Users className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.circles}</span>
        </button>
        <button 
          onClick={() => setActiveTab('map')}
          className={cn("flex flex-col items-center gap-1 transition-colors", activeTab === 'map' ? "text-emerald-600" : "opacity-40 hover:opacity-100")}
        >
          <MapIcon className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest">{t.map}</span>
        </button>
      </nav>

      {/* Create Circle Modal */}
      <AnimatePresence>
        {showCreateCircle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative"
            >
              <button 
                onClick={() => setShowCreateCircle(false)}
                className="absolute top-6 right-6 p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                <X className="w-5 h-5 opacity-40" />
              </button>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold tracking-tight">{t.createCircle}</h3>
                <p className="text-sm opacity-60 mt-1">Build your safety network</p>
              </div>
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1.5 block">Circle Name</label>
                  <input 
                    type="text" 
                    value={newCircleName}
                    onChange={(e) => setNewCircleName(e.target.value)}
                    placeholder="e.g. Hiking Team"
                    className="w-full bg-stone-50 border border-black/5 rounded-xl px-4 py-3 outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1.5 block">Circle Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['family', 'work', 'friends'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewCircleType(type)}
                        className={cn(
                          "py-2 rounded-xl text-xs font-bold capitalize border transition-all",
                          newCircleType === type 
                            ? "bg-emerald-600 border-emerald-600 text-white" 
                            : "bg-white border-black/5 opacity-60"
                        )}
                      >
                        {t[type]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button 
                onClick={handleCreateCircle}
                disabled={!newCircleName.trim()}
                className="w-full bg-black text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-colors disabled:opacity-20"
              >
                {t.createCircle}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Join Circle Modal */}
      <AnimatePresence>
        {showJoinCircle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative"
            >
              <button 
                onClick={() => setShowJoinCircle(false)}
                className="absolute top-6 right-6 p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                <X className="w-5 h-5 opacity-40" />
              </button>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-stone-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <QrCode className="w-8 h-8 text-stone-600" />
                </div>
                <h3 className="text-xl font-bold tracking-tight">{t.joinCircle}</h3>
                <p className="text-sm opacity-60 mt-1">Enter a circle code or paste a link</p>
              </div>
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-1.5 block">{t.enterCode}</label>
                  <input 
                    type="text" 
                    value={joinCircleCode}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.includes('/join/')) {
                        setJoinCircleCode(val.split('/join/')[1]);
                      } else {
                        setJoinCircleCode(val);
                      }
                    }}
                    placeholder="e.g. family-a1b2"
                    className="w-full bg-stone-50 border border-black/5 rounded-xl px-4 py-3 outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>
              <button 
                onClick={() => handleJoinCircle()}
                disabled={!joinCircleCode.trim()}
                className="w-full bg-black text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-colors disabled:opacity-20"
              >
                {t.join}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite QR Modal */}
      <AnimatePresence>
        {inviteGroup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative"
            >
              <button 
                onClick={() => setInviteGroup(null)}
                className="absolute top-6 right-6 p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                <X className="w-5 h-5 opacity-40" />
              </button>
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <QrCode className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold tracking-tight">Invite to {inviteGroup.name}</h3>
                <p className="text-sm opacity-60 mt-1">Scan this code or use the code below</p>
              </div>
              <div className="bg-stone-50 p-6 rounded-3xl flex flex-col items-center justify-center mb-4 border border-black/5">
                <QRCodeSVG 
                  value={`${window.location.origin}/join/${inviteGroup.id}`}
                  size={200}
                  level="H"
                  includeMargin={false}
                />
                <div className="mt-6 p-3 bg-white rounded-xl border border-black/5 w-full text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-30 mb-1">Circle Code</p>
                  <p className="font-mono font-bold text-emerald-600 select-all">{inviteGroup.id}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const link = `${window.location.origin}/join/${inviteGroup.id}`;
                  if (navigator.share) {
                    navigator.share({ title: `Join ${inviteGroup.name} on AllGood`, url: link });
                  } else {
                    navigator.clipboard.writeText(link);
                  }
                }}
                className="w-full mb-4 bg-stone-100 text-stone-700 font-bold py-3 rounded-2xl hover:bg-stone-200 transition-colors text-sm flex items-center justify-center gap-2"
              >
                <ChevronRight className="w-4 h-4" />
                Copy / Share Link
              </button>
              <button 
                onClick={() => setInviteGroup(null)}
                className="w-full bg-black text-white font-bold py-4 rounded-2xl hover:bg-stone-800 transition-colors"
              >
                Done
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alert Overlay */}
      <AnimatePresence>
        {currentAlert && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-red-600 flex flex-col items-center justify-center p-8 text-white text-center"
          >
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mb-8"
            >
              <Bell className="w-12 h-12" />
            </motion.div>
            
            <h2 className="text-4xl font-black mb-4 tracking-tighter uppercase">{t.sirenDetected}</h2>
            <div className="flex items-center gap-2 mb-6 bg-white/20 px-4 py-2 rounded-2xl font-mono text-2xl font-black">
              <Timer className="w-6 h-6" />
              {formatTime(alertSeconds)}
            </div>
            <p className="text-xl opacity-90 mb-6 max-w-xs">
              {currentAlert.area}
            </p>

            {safetyTips && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white/10 p-4 rounded-2xl mb-8 text-left max-w-sm border border-white/20"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-yellow-300" />
                  <span className="text-xs font-bold uppercase tracking-widest text-yellow-300">{t.aiTips}</span>
                </div>
                <p className="text-sm opacity-90 leading-relaxed whitespace-pre-wrap">
                  {safetyTips}
                </p>
              </motion.div>
            )}

            <div className="w-full max-w-sm space-y-3">
              <button 
                onClick={handleIAmOkay}
                className="w-full bg-white text-red-600 font-black text-2xl py-6 rounded-3xl shadow-2xl shadow-black/20 active:scale-95 transition-transform"
              >
                ✓ {t.imOkay}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleIAmInDanger}
                  className="bg-white/20 border-2 border-white/40 text-white font-bold text-base py-4 rounded-2xl active:scale-95 transition-transform"
                >
                  🆘 Need Help
                </button>
                <button
                  onClick={handleNotInArea}
                  className="bg-white/20 border-2 border-white/40 text-white font-bold text-base py-4 rounded-2xl active:scale-95 transition-transform"
                >
                  📍 Not in Area
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
