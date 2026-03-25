import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── SQLite Setup ─────────────────────────────────────────────────────────────
const db = new Database('allgood.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS members (
    user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    last_seen INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, group_id)
  );
`);

function saveGroup(id: string, name: string, type: string) {
  db.prepare('INSERT OR IGNORE INTO groups (id, name, type) VALUES (?, ?, ?)').run(id, name, type);
}

function loadGroups(): Map<string, any> {
  const rows = db.prepare('SELECT * FROM groups').all() as any[];
  const map = new Map();
  rows.forEach(row => {
    // Load saved members for this group
    const memberRows = db.prepare('SELECT * FROM members WHERE group_id = ?').all(row.id) as any[];
    const members = memberRows.map((m: any) => ({
      id: m.user_id,
      name: m.name,
      status: 'unknown',
      groupIds: [row.id],
      groupRoles: { [row.id]: m.role },
      lastUpdate: m.last_seen * 1000
    }));
    map.set(row.id, { id: row.id, name: row.name, type: row.type, members });
  });
  return map;
}

function saveMember(userId: string, groupId: string, name: string, role: string) {
  db.prepare("INSERT OR REPLACE INTO members (user_id, group_id, name, role, last_seen) VALUES (?, ?, ?, ?, strftime('%s','now'))").run(userId, groupId, name, role);
}

function removeMember(userId: string, groupId: string) {
  db.prepare('DELETE FROM members WHERE user_id = ? AND group_id = ?').run(userId, groupId);
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── City Coordinates ────────────────────────────────────────────────────────
const CITY_COORDS: Record<string, { lat: number, lng: number }> = {
  'תל אביב': { lat: 32.0853, lng: 34.7818 },
  'תל אביב - יפו': { lat: 32.0853, lng: 34.7818 },
  'ירושלים': { lat: 31.7683, lng: 35.2137 },
  'חיפה': { lat: 32.7940, lng: 34.9896 },
  'באר שבע': { lat: 31.2518, lng: 34.7913 },
  'ראשון לציון': { lat: 31.9730, lng: 34.7925 },
  'פתח תקווה': { lat: 32.0840, lng: 34.8878 },
  'אשדוד': { lat: 31.8040, lng: 34.6550 },
  'נתניה': { lat: 32.3215, lng: 34.8532 },
  'חולון': { lat: 32.0114, lng: 34.7740 },
  'בני ברק': { lat: 32.0840, lng: 34.8338 },
  'בת ים': { lat: 32.0230, lng: 34.7503 },
  'רמת גן': { lat: 32.0682, lng: 34.8246 },
  'אשקלון': { lat: 31.6688, lng: 34.5743 },
  'רחובות': { lat: 31.8928, lng: 34.8113 },
  'הרצליה': { lat: 32.1663, lng: 34.8434 },
  'חדרה': { lat: 32.4342, lng: 34.9194 },
  'מודיעין': { lat: 31.8969, lng: 35.0095 },
  'כפר סבא': { lat: 32.1753, lng: 34.9066 },
  'נס ציונה': { lat: 31.9304, lng: 34.7995 },
  'לוד': { lat: 31.9516, lng: 34.8951 },
  'רמלה': { lat: 31.9298, lng: 34.8710 },
  'נהריה': { lat: 33.0074, lng: 35.0972 },
  'עכו': { lat: 32.9233, lng: 35.0765 },
  'צפת': { lat: 32.9646, lng: 35.4960 },
  'טבריה': { lat: 32.7940, lng: 35.5300 },
  'נצרת': { lat: 32.6996, lng: 35.3035 },
  'אילת': { lat: 29.5581, lng: 34.9482 },
  'דימונה': { lat: 31.0685, lng: 35.0326 },
  'קריית שמונה': { lat: 33.2074, lng: 35.5706 },
  'קריית גת': { lat: 31.6100, lng: 34.7642 },
  'קריית אתא': { lat: 32.8129, lng: 35.1090 },
  'קריית ביאליק': { lat: 32.8337, lng: 35.0869 },
  'קריית מוצקין': { lat: 32.8367, lng: 35.0778 },
  'קריית אונו': { lat: 32.0598, lng: 34.8556 },
  'אור יהודה': { lat: 32.0293, lng: 34.8556 },
  'גבעתיים': { lat: 32.0710, lng: 34.8127 },
  'רמת השרון': { lat: 32.1469, lng: 34.8397 },
  'הוד השרון': { lat: 32.1512, lng: 34.8969 },
  'כפר יונה': { lat: 32.3148, lng: 34.9369 },
  'עפולה': { lat: 32.6079, lng: 35.2897 },
  'גדרה': { lat: 31.8116, lng: 34.7766 },
  'יבנה': { lat: 31.8782, lng: 34.7412 },
  'נתיבות': { lat: 31.4233, lng: 34.5887 },
  'שדרות': { lat: 31.5236, lng: 34.5965 },
  'אופקים': { lat: 31.3115, lng: 34.6209 },
  'ערד': { lat: 31.2583, lng: 35.2127 },
  'מגדל העמק': { lat: 32.6754, lng: 35.2384 },
  'יוקנעם': { lat: 32.6566, lng: 35.1166 },
  'כרמיאל': { lat: 32.9149, lng: 35.2966 },
  'טירת כרמל': { lat: 32.7594, lng: 34.9696 },
  'אריאל': { lat: 32.1030, lng: 35.1671 },
  'מעלה אדומים': { lat: 31.7731, lng: 35.2980 },
  'בית שמש': { lat: 31.7480, lng: 34.9873 },
  'בית שאן': { lat: 32.4988, lng: 35.4993 },
  'זכרון יעקב': { lat: 32.5702, lng: 34.9480 },
  'פרדס חנה': { lat: 32.4739, lng: 34.9696 },
  'גן יבנה': { lat: 31.7902, lng: 34.7076 },
  'יהוד': { lat: 32.0309, lng: 34.8878 },
  'אלעד': { lat: 32.0509, lng: 34.9516 },
  'ראש העין': { lat: 32.0956, lng: 34.9573 },
  'אבן יהודה': { lat: 32.2730, lng: 34.8879 },
  'בקה אל גרביה': { lat: 32.4197, lng: 35.0374 },
  'טייבה': { lat: 32.2688, lng: 35.0050 },
  'טירה': { lat: 32.2336, lng: 34.9520 },
  'כפר קאסם': { lat: 32.1149, lng: 34.9770 },
  'רהט': { lat: 31.3929, lng: 34.7540 },
  'שפרעם': { lat: 32.8060, lng: 35.1700 },
  'נצרת עילית': { lat: 32.7056, lng: 35.3321 },
  'סח'נין': { lat: 32.8589, lng: 35.3009 },
  'אום אל פחם': { lat: 32.5194, lng: 35.1524 },
  'ג'לג'וליה': { lat: 32.1565, lng: 34.9579 },
  'גבעת שמואל': { lat: 32.0784, lng: 34.8487 },
  'אור עקיבא': { lat: 32.5055, lng: 34.9188 },
  'קלנסווה': { lat: 32.2836, lng: 34.9826 },
};

function getCityCoords(cities: string[]): { lat: number, lng: number } {
  for (const city of cities) {
    // Try exact match
    if (CITY_COORDS[city]) return CITY_COORDS[city];
    // Try partial match
    const match = Object.keys(CITY_COORDS).find(k => city.includes(k) || k.includes(city));
    if (match) return CITY_COORDS[match];
  }
  // Default center of Israel
  return { lat: 31.5, lng: 34.8 };
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Tzeva Adom API ──────────────────────────────────────────────────────────
const THREAT_LABELS: Record<number, string> = {
  0: 'ירי רקטות וטילים',
  1: 'חדירת כלי טיס עוין',
  2: 'אירוע חומרים מסוכנים',
  3: 'רעידת אדמה',
  4: 'צונאמי',
  5: 'חדירת מחבלים',
  6: 'אירוע רדיולוגי',
};

async function fetchTzevaAdomAlerts(): Promise<any[]> {
  try {
    const res = await fetch('https://api.tzevaadom.co.il/notifications', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (AllGood Safety App)',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  const PORT = 3000;

  const users = new Map();
  const groups = loadGroups();
  const alerts: any[] = [];

  console.log(`📦 Loaded ${groups.size} groups from database`);

  const seenNotificationIds = new Set<string>();

  // ─── Keep-alive ping ──────────────────────────────────────────────────────
  setInterval(() => {
    fetch(`http://localhost:${PORT}/api/health`).catch(() => {});
  }, 10 * 60 * 1000);
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Poll Tzeva Adom every 5 seconds ──────────────────────────────────────
  setInterval(async () => {
    const notifications = await fetchTzevaAdomAlerts();
    if (!notifications.length) return;

    for (const notif of notifications) {
      if (!notif.notificationId || seenNotificationIds.has(notif.notificationId)) continue;
      seenNotificationIds.add(notif.notificationId);
      if (notif.isDrill) continue;

      const cities: string[] = notif.cities || [];
      const area = cities.slice(0, 3).join(', ') + (cities.length > 3 ? ` ועוד ${cities.length - 3}` : '');
      const title = THREAT_LABELS[notif.threat] || 'אזעקה';

      const newAlert = {
        id: notif.notificationId,
        timestamp: (notif.time || Date.now() / 1000) * 1000,
        area, cities, title,
        threat: notif.threat,
        source: 'tzevaadom',
        ...getCityCoords(cities),
      };

      alerts.push(newAlert);
      if (alerts.length > 100) alerts.shift();

      users.forEach((user) => {
        user.status = 'pending';
        user.alertStartTime = Date.now();
        user.voicePromptFired = false;
        user.escalationFired = false;
      });

      // Send alert only to users whose watchedCities match, or those with no filter
      users.forEach((user, socketId) => {
        if (!user.watchedCities?.length) {
          io.to(socketId).emit('new-alert', newAlert);
        } else {
          const isRelevant = newAlert.cities.some((city: string) =>
            user.watchedCities.some((w: string) =>
              city.includes(w) || w.includes(city)
            )
          );
          if (isRelevant) io.to(socketId).emit('new-alert', newAlert);
        }
      });
      io.emit('all-alerts', alerts);
      console.log(`🚨 Real Alert [${notif.notificationId}]: ${title} — ${area}`);
    }
  }, 5000);
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Escalation Timer ─────────────────────────────────────────────────────
  setInterval(() => {
    const now = Date.now();
    users.forEach((user, socketId) => {
      if (user.status === 'pending' && user.alertStartTime) {
        const elapsed = (now - user.alertStartTime) / 1000;

        if (elapsed >= 180 && elapsed < 190 && !user.voicePromptFired) {
          user.voicePromptFired = true;
          io.to(socketId).emit('urgent-retry', {
            message: "We haven't heard from you. Please confirm your status."
          });
        }

        if (elapsed >= 240 && elapsed < 250 && !user.escalationFired) {
          user.escalationFired = true;
          user.status = 'unknown';
          user.groupIds.forEach((groupId: string) => {
            const group = groups.get(groupId);
            if (group) {
              const userRole = user.groupRoles?.[groupId] || 'member';
              if (userRole === 'member') {
                const leader = group.members.find((m: any) => m.groupRoles?.[groupId] === 'leader');
                if (leader?.socketId) {
                  io.to(leader.socketId).emit('escalation-alert', {
                    type: 'MEMBER_UNRESPONSIVE',
                    userName: user.name,
                    groupId: group.id,
                    groupName: group.name
                  });
                }
              } else if (userRole === 'leader') {
                const safeMembers = group.members.filter((m: any) => m.status === 'safe' && m.id !== user.id);
                if (safeMembers.length > 0) {
                  const randomMember = safeMembers[Math.floor(Math.random() * safeMembers.length)];
                  if (randomMember.socketId) {
                    io.to(randomMember.socketId).emit('escalation-alert', {
                      type: 'LEADER_UNRESPONSIVE',
                      userName: user.name,
                      groupId: group.id,
                      groupName: group.name
                    });
                  }
                }
              }
              io.to(groupId).emit('group-update', { groupId, members: group.members });
            }
          });
        }
      }
    });
  }, 10000);
  // ─────────────────────────────────────────────────────────────────────────

  // ─── Socket Events ────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create-group', ({ name, type }) => {
      const groupId = `${type}-${Math.random().toString(36).substr(2, 4)}`;
      groups.set(groupId, { id: groupId, name, type, members: [] });
      saveGroup(groupId, name, type);
      socket.emit('group-created', { id: groupId, name, type });
      console.log(`✅ Group created and saved: ${groupId} (${name})`);
    });

    socket.on('join-group', ({ userId, userName, userPhone, userEmail, groupIds, groupRoles, watchedCities }) => {
      const user = {
        id: userId, name: userName, phone: userPhone, email: userEmail,
        groupIds, groupRoles: groupRoles || {},
        watchedCities: watchedCities || [],
        status: 'safe', socketId: socket.id, lastUpdate: Date.now()
      };
      users.set(socket.id, user);

      groupIds.forEach((groupId: string) => {
        socket.join(groupId);

        if (!groups.has(groupId)) {
          const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as any;
          if (row) {
            groups.set(groupId, { id: row.id, name: row.name, type: row.type, members: [] });
            console.log(`♻️ Restored group from DB: ${groupId}`);
          }
        }

        const group = groups.get(groupId);
        if (group) {
          const idx = group.members.findIndex((m: any) => m.id === userId);
          if (idx === -1) group.members.push(user);
          else group.members[idx] = user;

          // Save member to SQLite
          const role = (groupRoles && groupRoles[groupId]) || 'member';
          saveMember(userId, groupId, userName, role);

          io.to(groupId).emit('group-update', {
            groupId, name: group.name, type: group.type, members: group.members
          });
        }
      });
    }); // ← סוגר join-group

    // ─── Leave Group ──────────────────────────────────────────────────────
    socket.on('leave-group', ({ groupId, userId }: { groupId: string, userId: string }) => {
      const group = groups.get(groupId);
      if (group) {
        group.members = group.members.filter((m: any) => m.id !== userId);
        io.to(groupId).emit('group-update', {
          groupId,
          name: group.name,
          type: group.type,
          members: group.members
        });
        console.log(`👋 User ${userId} left group ${groupId}`);
      }
      // Remove from SQLite
      removeMember(userId, groupId);
      socket.leave(groupId);
      const user = users.get(socket.id);
      if (user) {
        user.groupIds = user.groupIds.filter((id: string) => id !== groupId);
        if (user.groupRoles) delete user.groupRoles[groupId];
      }
    });
    // ─────────────────────────────────────────────────────────────────────

    socket.on('update-role', ({ groupId, role }) => {
      const user = users.get(socket.id);
      if (user) {
        if (!user.groupRoles) user.groupRoles = {};
        user.groupRoles[groupId] = role;
        const group = groups.get(groupId);
        if (group) {
          const idx = group.members.findIndex((m: any) => m.id === user.id);
          if (idx !== -1) group.members[idx] = user;
          io.to(groupId).emit('group-update', {
            groupId, name: group.name, type: group.type, members: group.members
          });
        }
      }
    });

    socket.on('update-status', ({ status, location }) => {
      const user = users.get(socket.id);
      if (user) {
        user.status = status;
        user.location = location;
        user.lastUpdate = Date.now();
        if (status === 'pending') user.alertStartTime = Date.now();
        else user.alertStartTime = undefined;
        user.groupIds.forEach((groupId: string) => {
          const group = groups.get(groupId);
          if (group) {
            const idx = group.members.findIndex((m: any) => m.id === user.id);
            if (idx !== -1) group.members[idx] = user;
            io.to(groupId).emit('group-update', {
              groupId, name: group.name, type: group.type, members: group.members
            });
          }
        });
      }
    });

    socket.on('trigger-alert', (alert) => {
      const newAlert = {
        ...alert,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        source: 'demo',
        lat: alert.lat || 32.0853,
        lng: alert.lng || 34.7818,
      };
      alerts.push(newAlert);
      users.forEach((user) => { user.status = 'pending'; user.alertStartTime = Date.now(); });
      // Send alert only to users whose watchedCities match, or those with no filter
      users.forEach((user, socketId) => {
        if (!user.watchedCities?.length) {
          io.to(socketId).emit('new-alert', newAlert);
        } else {
          const isRelevant = newAlert.cities.some((city: string) =>
            user.watchedCities.some((w: string) =>
              city.includes(w) || w.includes(city)
            )
          );
          if (isRelevant) io.to(socketId).emit('new-alert', newAlert);
        }
      });
      io.emit('all-alerts', alerts);
    });

    socket.on('get-alerts', () => {
      socket.emit('all-alerts', alerts);
    });

    // ─── Disconnect ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      const user = users.get(socket.id);
      if (user) {
        user.groupIds?.forEach((groupId: string) => {
          const group = groups.get(groupId);
          if (group) {
            // Mark as offline instead of removing — keeps member visible after refresh
            const idx = group.members.findIndex((m: any) => m.id === user.id);
            if (idx !== -1) {
              group.members[idx] = { ...group.members[idx], status: 'unknown', socketId: null };
            }
            io.to(groupId).emit('group-update', {
              groupId, name: group.name, type: group.type, members: group.members
            });
          }
        });
        users.delete(socket.id);
      }
    });
    // ─────────────────────────────────────────────────────────────────────

  }); // ← סוגר io.on('connection')
  // ─────────────────────────────────────────────────────────────────────────

  // ─── API Routes ───────────────────────────────────────────────────────────
  app.get('/api/health', (_, res) => {
    res.json({ status: 'ok', alertsCount: alerts.length, groupsCount: groups.size });
  });

  app.get('/api/alerts/live', async (_, res) => {
    const data = await fetchTzevaAdomAlerts();
    res.json(data);
  });

  app.get('/api/alerts', (_, res) => {
    res.json(alerts.slice(-50).reverse());
  });

  app.get('/api/alerts/active', (_, res) => {
    const latest = alerts[alerts.length - 1];
    res.json(latest || {});
  });

  app.get('/api/groups', (_, res) => {
    const allGroups = db.prepare('SELECT * FROM groups').all();
    res.json(allGroups);
  });
  // ─────────────────────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ AllGood Server on http://localhost:${PORT}`);
    console.log(`🔍 Polling Tzeva Adom every 5 seconds for real alerts...`);
  });
}

startServer();
