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
`);

function saveGroup(id: string, name: string, type: string) {
  db.prepare('INSERT OR IGNORE INTO groups (id, name, type) VALUES (?, ?, ?)').run(id, name, type);
}

function loadGroups(): Map<string, any> {
  const rows = db.prepare('SELECT * FROM groups').all() as any[];
  const map = new Map();
  rows.forEach(row => {
    map.set(row.id, { id: row.id, name: row.name, type: row.type, members: [] });
  });
  return map;
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
  const groups = loadGroups(); // Load from SQLite on startup
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
        lat: 31.5 + Math.random() * 2,
        lng: 34.3 + Math.random() * 1.5,
      };

      alerts.push(newAlert);
      if (alerts.length > 100) alerts.shift();

      users.forEach((user) => {
        user.status = 'pending';
        user.alertStartTime = Date.now();
        user.voicePromptFired = false;
        user.escalationFired = false;
      });

      io.emit('new-alert', newAlert);
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
      saveGroup(groupId, name, type); // Save to SQLite
      socket.emit('group-created', { id: groupId, name, type });
      console.log(`✅ Group created and saved: ${groupId} (${name})`);
    });

    socket.on('join-group', ({ userId, userName, userPhone, userEmail, groupIds, groupRoles }) => {
      const user = {
        id: userId, name: userName, phone: userPhone, email: userEmail,
        groupIds, groupRoles: groupRoles || {},
        status: 'safe', socketId: socket.id, lastUpdate: Date.now()
      };
      users.set(socket.id, user);

      groupIds.forEach((groupId: string) => {
        socket.join(groupId);

        // If group not in memory (server restarted), restore from DB
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

          io.to(groupId).emit('group-update', {
            groupId, name: group.name, type: group.type, members: group.members
          });
        }
      });
    });

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
      io.emit('new-alert', newAlert);
      io.emit('all-alerts', alerts);
    });

    socket.on('get-alerts', () => {
      socket.emit('all-alerts', alerts);
    });

    socket.on('disconnect', () => {
  const user = users.get(socket.id);
  if (user) {
    user.groupIds?.forEach((groupId) => {
      group.members = group.members.filter(m => m.id !== user.id);
      io.to(groupId).emit('group-update', ...);
    });
    users.delete(socket.id);
  }
});
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
