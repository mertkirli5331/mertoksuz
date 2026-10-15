import React, { useState, useEffect, useCallback } from 'react';
import type { WeekPlan, DriveLink, AdminUser } from './types';
import {
  fetchAllWeeks,
  updateWeekOnServer,
  resetAllWeeksOnServer,
  importWeeksToServer,
  getLocalCache,
  verifyAdminSessionApi,
  logoutAdminApi,
} from './api';
import { Navbar } from './components/Navbar';
import { StatsOverview } from './components/StatsOverview';
import { WeekNavigator } from './components/WeekNavigator';
import { WeekDetail } from './components/WeekDetail';
import { WeekListView } from './components/WeekListView';
import { DriveLinkModal } from './components/DriveLinkModal';
import { QrSyncModal } from './components/QrSyncModal';
import { BackupModal } from './components/BackupModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { Loader2, AlertCircle, RefreshCw, Smartphone, Lock, ShieldCheck } from 'lucide-react';

export default function App() {
  const [weeks, setWeeks] = useState<WeekPlan[]>([]);
  const [selectedWeekNumber, setSelectedWeekNumber] = useState<number>(1);
  const [currentView, setCurrentView] = useState<'detail' | 'list'>('detail');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Admin Auth state
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

  // Modals state
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const [editingDriveLink, setEditingDriveLink] = useState<DriveLink | null>(null);
  const [modalTargetWeekNumber, setModalTargetWeekNumber] = useState<number>(1);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Check admin session on mount
  useEffect(() => {
    verifyAdminSessionApi().then((auth) => {
      setIsAdmin(auth.isAdmin);
      setAdminUser(auth.user);
    });
  }, []);

  // Initial Data Fetch
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchAllWeeks();
      setWeeks(data.weeks);
      setLastUpdated(data.lastUpdated);
      setIsOnline(true);
    } catch (err: any) {
      console.error('Veri yükleme hatası:', err);
      const cached = getLocalCache();
      if (cached && cached.weeks?.length > 0) {
        setWeeks(cached.weeks);
        setLastUpdated(cached.lastUpdated);
        setIsOnline(false);
      } else {
        setError('Haftalık program verileri yüklenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time SSE Connection for cross-device live updates
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    try {
      eventSource = new EventSource('/api/sync/events');

      eventSource.onopen = () => {
        setIsOnline(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'UPDATE' && Array.isArray(payload.weeks)) {
            setWeeks(payload.weeks);
            setLastUpdated(payload.lastUpdated);
            setIsOnline(true);
          }
        } catch (e) {
          console.warn('SSE Parse error:', e);
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
        }
      };
    } catch {
      // Ignore
    }

    // Safety fallback: Poll every 10 seconds
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/weeks', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.weeks) {
            setWeeks((prev) => {
              if (data.lastUpdated !== lastUpdated) {
                return data.weeks;
              }
              return prev;
            });
            setLastUpdated(data.lastUpdated);
            setIsOnline(true);
          }
        }
      } catch {
        setIsOnline(false);
      }
    }, 10000);

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [lastUpdated]);

  // Handle single week update (Requires admin)
  const handleUpdateWeek = async (updatedWeek: WeekPlan) => {
    if (!isAdmin) {
      setIsLoginModalOpen(true);
      return;
    }

    try {
      setIsSaving(true);
      setWeeks((prev) =>
        prev.map((w) => (w.weekNumber === updatedWeek.weekNumber ? updatedWeek : w))
      );

      const savedWeek = await updateWeekOnServer(updatedWeek.weekNumber, updatedWeek);
      setWeeks((prev) =>
        prev.map((w) => (w.weekNumber === savedWeek.weekNumber ? savedWeek : w))
      );
      setLastUpdated(new Date().toISOString());
      setIsOnline(true);
    } catch (err: any) {
      console.error('Kayıt hatası:', err);
      showToast(err.message || 'Sunucuya kaydedilirken hata oluştu.');
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  // Open Drive Link Modal (Requires admin to add/edit)
  const handleOpenDriveModal = (link?: DriveLink | null, targetWeek?: number) => {
    if (!isAdmin) {
      setIsLoginModalOpen(true);
      return;
    }
    setEditingDriveLink(link || null);
    setModalTargetWeekNumber(targetWeek || selectedWeekNumber);
    setIsDriveModalOpen(true);
  };

  // Save Drive Link (Add or Edit)
  const handleSaveDriveLink = async (savedLink: DriveLink) => {
    const targetWeek = weeks.find((w) => w.weekNumber === modalTargetWeekNumber);
    if (!targetWeek) return;

    let updatedLinks: DriveLink[];
    const existingIndex = (targetWeek.driveLinks || []).findIndex((l) => l.id === savedLink.id);

    if (existingIndex !== -1) {
      updatedLinks = [...(targetWeek.driveLinks || [])];
      updatedLinks[existingIndex] = savedLink;
    } else {
      updatedLinks = [...(targetWeek.driveLinks || []), savedLink];
    }

    const updatedWeek: WeekPlan = {
      ...targetWeek,
      driveLinks: updatedLinks,
    };

    await handleUpdateWeek(updatedWeek);
    showToast(`Google Drive linki ${modalTargetWeekNumber}. haftaya başarıyla kaydedildi!`);
  };

  // Reset all 38 weeks (Admin only)
  const handleResetWeeks = async () => {
    if (!isAdmin) {
      setIsLoginModalOpen(true);
      return;
    }

    try {
      setIsLoading(true);
      const res = await resetAllWeeksOnServer();
      setWeeks(res.weeks);
      setLastUpdated(res.lastUpdated);
      setSelectedWeekNumber(1);
      setIsBackupModalOpen(false);
      showToast('Program başarıyla sıfırlandı.');
    } catch (err: any) {
      showToast(err.message || 'Sıfırlama işlemi başarısız oldu.');
    } finally {
      setIsLoading(false);
    }
  };

  // Import weeks backup (Admin only)
  const handleImportWeeks = async (importedWeeks: WeekPlan[]) => {
    if (!isAdmin) {
      setIsLoginModalOpen(true);
      return;
    }

    try {
      setIsLoading(true);
      const res = await importWeeksToServer(importedWeeks);
      setWeeks(res.weeks);
      setLastUpdated(res.lastUpdated);
      setIsBackupModalOpen(false);
      showToast(`${importedWeeks.length} haftalık plan başarıyla geri yüklendi!`);
    } catch (err: any) {
      showToast(err.message || 'İçe aktarma başarısız oldu.');
    } finally {
      setIsLoading(false);
    }
  };

  // Admin Login callback
  const handleLoginSuccess = (user: AdminUser) => {
    setIsAdmin(true);
    setAdminUser(user);
    showToast(`Hoş geldiniz, ${user.username}! Yönetici modu aktif.`);
  };

  // Admin Logout callback
  const handleLogout = async () => {
    await logoutAdminApi();
    setIsAdmin(false);
    setAdminUser(null);
    showToast('Yönetici çıkışı yapıldı. Ziyaretçi modundasınız.');
  };

  // Selected week object
  const activeWeek =
    weeks.find((w) => w.weekNumber === selectedWeekNumber) || weeks[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        currentView={currentView}
        onViewChange={(v) => setCurrentView(v)}
        onOpenQrModal={() => setIsQrModalOpen(true)}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onOpenChangePasswordModal={() => setIsChangePasswordModalOpen(true)}
        onLogout={handleLogout}
        isAdmin={isAdmin}
        adminUser={adminUser}
        isOnline={isOnline}
        lastUpdated={lastUpdated}
      />

      {/* Global Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl text-xs flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-bottom-5">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Loading Screen */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              38 Haftalık Program Yükleniyor...
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Sunucu ile bağlantı kuruluyor ve haftalar senkronize ediliyor
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto space-y-4">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Bağlantı Sorunu
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {error}
          </p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-medium flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Tekrar Dene</span>
          </button>
        </div>
      ) : (
        <>
          {/* Top Progress & Stats */}
          <StatsOverview weeks={weeks} />

          {/* 38-Week Navigator Tabs */}
          <WeekNavigator
            weeks={weeks}
            selectedWeekNumber={selectedWeekNumber}
            onSelectWeek={(num) => {
              setSelectedWeekNumber(num);
              setCurrentView('detail');
            }}
          />

          {/* Content Body: Either Single Week Detail OR All 38 Weeks List */}
          <main className="flex-1 pb-16">
            {currentView === 'detail' && activeWeek ? (
              <WeekDetail
                week={activeWeek}
                onUpdateWeek={handleUpdateWeek}
                onOpenDriveModal={(link) => handleOpenDriveModal(link, activeWeek.weekNumber)}
                onNavigateWeek={(num) => setSelectedWeekNumber(num)}
                isSaving={isSaving}
                isAdmin={isAdmin}
                onRequireAdmin={() => setIsLoginModalOpen(true)}
              />
            ) : (
              <WeekListView
                weeks={weeks}
                onSelectWeek={(num) => {
                  setSelectedWeekNumber(num);
                  setCurrentView('detail');
                }}
                onOpenDriveModal={(weekNum) => handleOpenDriveModal(null, weekNum)}
                isAdmin={isAdmin}
                onRequireAdmin={() => setIsLoginModalOpen(true)}
              />
            )}
          </main>

          {/* Floating Mobile Bar to Quick-Add or Scan */}
          <div className="sm:hidden fixed bottom-3 left-4 right-4 z-30 bg-slate-900/95 text-white p-2.5 rounded-2xl shadow-xl backdrop-blur-md border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-semibold">{selectedWeekNumber}. Hafta</span>
              <span className="text-slate-400 text-[11px]">
                ({(activeWeek?.driveLinks || []).length} Link)
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {isAdmin ? (
                <button
                  onClick={() => handleOpenDriveModal(null, selectedWeekNumber)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs"
                >
                  + Drive Linki
                </button>
              ) : (
                <button
                  onClick={() => setIsLoginModalOpen(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1"
                >
                  <Lock className="w-3 h-3" />
                  <span>Giriş Yap</span>
                </button>
              )}
              <button
                onClick={() => setIsQrModalOpen(true)}
                className="p-1.5 text-slate-300 hover:text-white bg-slate-800 rounded-xl"
                title="Mobil QR"
              >
                <Smartphone className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Admin Login Modal */}
      <AdminLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={isChangePasswordModalOpen}
        onClose={() => setIsChangePasswordModalOpen(false)}
        onSuccess={(msg) => showToast(msg)}
      />

      {/* Drive Link Modal */}
      <DriveLinkModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        onSave={handleSaveDriveLink}
        editingLink={editingDriveLink}
        weekNumber={modalTargetWeekNumber}
      />

      {/* QR Code Sync Modal */}
      <QrSyncModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
      />

      {/* Backup & Settings Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        weeks={weeks}
        onImport={handleImportWeeks}
        onReset={handleResetWeeks}
        isAdmin={isAdmin}
        onRequireAdmin={() => setIsLoginModalOpen(true)}
      />
    </div>
  );
}
