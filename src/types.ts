export type UserStatus = 'safe' | 'danger' | 'unknown' | 'not-in-area' | 'pending';
export type UserRole = 'member' | 'leader';
export type Language = 'en' | 'he' | 'es' | 'ru' | 'ar';

export interface User {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  groupIds: string[];
  groupRoles: Record<string, UserRole>; // groupId -> role
  status: UserStatus;
  location?: {
    lat: number;
    lng: number;
    name: string;
  };
  lastUpdate: number;
  socketId?: string;
  alertStartTime?: number;
}

export interface Group {
  id: string;
  name: string;
  type: 'family' | 'work' | 'friends';
  members: User[];
}

export interface Alert {
  id: string;
  timestamp: number;
  area: string;
  lat?: number;
  lng?: number;
}
