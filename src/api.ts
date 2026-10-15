import type { WeekPlan, AppSyncData, AdminUser, AuthState } from './types';

const LOCAL_STORAGE_KEY = 'haftalik_program_backup_cache';
const ADMIN_TOKEN_KEY = 'haftalik_program_admin_token';

// Admin Token Management
export function getStoredAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // Ignored
  }
}

// Admin API calls
export async function loginAdminApi(username: string, password: string): Promise<{ user: AdminUser; token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Giriş yapılamadı.');
  }

  setStoredAdminToken(data.token);
  return { user: data.user, token: data.token };
}

export async function verifyAdminSessionApi(): Promise<AuthState> {
  const token = getStoredAdminToken();
  if (!token) {
    return { isAdmin: false, user: null, token: null };
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setStoredAdminToken(null);
      return { isAdmin: false, user: null, token: null };
    }
    const data = await res.json();
    if (data.isAdmin) {
      return { isAdmin: true, user: data.user, token };
    } else {
      setStoredAdminToken(null);
      return { isAdmin: false, user: null, token: null };
    }
  } catch {
    return { isAdmin: false, user: null, token: null };
  }
}

export async function logoutAdminApi(): Promise<void> {
  const token = getStoredAdminToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Ignored
    }
  }
  setStoredAdminToken(null);
}

export async function changeAdminPasswordApi(currentPassword: string, newPassword: string): Promise<string> {
  const token = getStoredAdminToken();
  if (!token) {
    throw new Error('Yönetici girişi bulunamadı.');
  }

  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Şifre güncellenemedi.');
  }
  return data.message || 'Şifre başarıyla güncellendi.';
}

// Local cache
export function getLocalCache(): AppSyncData | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('LocalStorage read error:', e);
  }
  return null;
}

export function saveLocalCache(data: AppSyncData) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('LocalStorage save error:', e);
  }
}

// Fetch all weeks from server (Public read)
export async function fetchAllWeeks(): Promise<AppSyncData> {
  try {
    const res = await fetch('/api/weeks', {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Sunucu yanıtı başarısız: ${res.statusText}`);
    }
    const data: AppSyncData = await res.json();
    saveLocalCache(data);
    return data;
  } catch (err) {
    console.warn('Sunucuya erişilemedi, yerel önbellek deneniyor:', err);
    const cached = getLocalCache();
    if (cached) {
      return cached;
    }
    throw err;
  }
}

// Update a week on the server (Requires Admin Token)
export async function updateWeekOnServer(weekNumber: number, weekData: Partial<WeekPlan>): Promise<WeekPlan> {
  const token = getStoredAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api/weeks/${weekNumber}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(weekData),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Güncelleme hatası: ${res.statusText}`);
  }

  return data.week;
}

// Reset 38 weeks (Requires Admin Token)
export async function resetAllWeeksOnServer(): Promise<AppSyncData> {
  const token = getStoredAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/reset', {
    method: 'POST',
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Sıfırlama başarısız oldu.');
  }

  saveLocalCache(data.data);
  return data.data;
}

// Import data (Requires Admin Token)
export async function importWeeksToServer(weeks: WeekPlan[]): Promise<AppSyncData> {
  const token = getStoredAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({ weeks }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'İçe aktarma hatası oluştu.');
  }

  const fullData: AppSyncData = {
    lastUpdated: data.lastUpdated,
    weeks,
  };
  saveLocalCache(fullData);
  return fullData;
}

// Determine Google Drive link type from URL
export function detectDriveLinkType(url: string): 'folder' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'form' | 'other' {
  if (!url) return 'other';
  const lower = url.toLowerCase();
  
  if (lower.includes('drive.google.com/drive/folders') || lower.includes('/folders/')) {
    return 'folder';
  }
  if (lower.includes('docs.google.com/document') || lower.includes('/document/d/')) {
    return 'document';
  }
  if (lower.includes('docs.google.com/spreadsheets') || lower.includes('/spreadsheets/d/')) {
    return 'spreadsheet';
  }
  if (lower.includes('docs.google.com/presentation') || lower.includes('/presentation/d/')) {
    return 'presentation';
  }
  if (lower.includes('docs.google.com/forms') || lower.includes('/forms/d/')) {
    return 'form';
  }
  if (lower.includes('.pdf') || lower.includes('/file/d/')) {
    return 'pdf';
  }
  if (lower.includes('drive.google.com') || lower.includes('docs.google.com')) {
    return 'folder';
  }
  return 'other';
}
