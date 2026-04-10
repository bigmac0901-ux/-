/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  auth, 
  db 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  Timestamp,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  parseISO,
  getDay,
  addDays,
  isBefore
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { 
  Calendar as CalendarIcon, 
  Users, 
  Plus, 
  ChevronLeft, 
  ChevronRight, 
  LogOut, 
  User as UserIcon,
  X,
  Trash2,
  AlertCircle,
  Clock,
  GripVertical,
  MoreVertical,
  Settings,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Constants ---
const ADMIN_EMAILS = [
  "bigmac0901@gmail.com",
  "alphastaff5123@gmail.com",
  // ここに管理者にしたいメールアドレスを追加してください
];

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 日本の祝日判定（簡易版：主要な祝日と振替休日を考慮）
// 実際には外部APIやライブラリ（holiday-jpなど）を使用するのが望ましいですが、
// ここでは主要なロジックを実装します。
function getHolidayName(date: Date): string | null {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const dayOfWeek = date.getDay();

  // 固定祝日
  if (month === 1 && day === 1) return "元日";
  if (month === 2 && day === 11) return "建国記念の日";
  if (month === 2 && day === 23) return "天皇誕生日";
  if (month === 4 && day === 29) return "昭和の日";
  if (month === 5 && day === 3) return "憲法記念日";
  if (month === 5 && day === 4) return "みどりの日";
  if (month === 5 && day === 5) return "こどもの日";
  if (month === 8 && day === 11) return "山の日";
  if (month === 11 && day === 3) return "文化の日";
  if (month === 11 && day === 23) return "勤労感謝の日";

  // ハッピーマンデー
  const nthMonday = Math.floor((day - 1) / 7) + 1;
  if (month === 1 && nthMonday === 2 && dayOfWeek === 1) return "成人の日";
  if (month === 7 && nthMonday === 3 && dayOfWeek === 1) return "海の日";
  if (month === 9 && nthMonday === 3 && dayOfWeek === 1) return "敬老の日";
  if (month === 10 && nthMonday === 2 && dayOfWeek === 1) return "スポーツの日";

  // 春分・秋分（簡易計算）
  if (month === 3 && day === Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))) return "春分の日";
  if (month === 9 && day === Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))) return "秋分の日";

  return null;
}

// --- Types ---
interface Staff {
  id: string;
  name: string;
  email?: string;
  loginId?: string;
  role: 'admin' | 'staff';
  color: string;
  isManual?: boolean;
}

interface Shift {
  id: string;
  staffId: string;
  staffName: string;
  startTime: Date;
  endTime: Date;
  title: string;
  note: string;
}

// --- Components ---

const ErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setErrorMsg(event.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-2xl border border-red-100">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle className="w-8 h-8" />
            <h1 className="text-xl font-bold">エラーが発生しました</h1>
          </div>
          <p className="text-slate-600 mb-6">{errorMsg}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<'calendar' | 'management'>('calendar');
  const now = new Date();
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{ shiftId: string; targetDate: Date } | null>(null);
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        const staffDocRef = doc(db, 'staff', currentUser.uid);
        const staffDoc = await getDoc(staffDocRef);
        if (!staffDoc.exists()) {
          const isDefaultAdmin = currentUser.email && ADMIN_EMAILS.includes(currentUser.email);
          await setDoc(staffDocRef, {
            name: currentUser.displayName || '不明なユーザー',
            email: currentUser.email,
            role: isDefaultAdmin ? 'admin' : 'staff',
            color: '#3b82f6'
          });
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Data Listeners
  useEffect(() => {
    const staffQuery = query(collection(db, 'staff'));
    const unsubscribeStaff = onSnapshot(staffQuery, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Staff));
      setStaffList(list);
    }, (error) => console.error("Staff fetch error:", error));

    const shiftsQuery = query(collection(db, 'shifts'), orderBy('startTime', 'asc'));
    const unsubscribeShifts = onSnapshot(shiftsQuery, (snapshot) => {
      const list = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          startTime: (data.startTime as Timestamp).toDate(),
          endTime: (data.endTime as Timestamp).toDate(),
        } as Shift;
      });
      setShifts(list);
    }, (error) => console.error("Shifts fetch error:", error));

    return () => {
      unsubscribeStaff();
      unsubscribeShifts();
    };
  }, []);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const currentUserData = useMemo(() => staffList.find(s => s.id === user?.uid), [staffList, user]);
  const isAdmin = useMemo(() => {
    if (!user) return false;
    if (currentUserData?.role === 'admin') return true;
    return user.email && ADMIN_EMAILS.includes(user.email);
  }, [user, currentUserData]);

  // Calendar Logic
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const shiftsByDay = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    shifts.forEach(shift => {
      const dayKey = format(shift.startTime, 'yyyy-MM-dd');
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push(shift);
    });
    return map;
  }, [shifts]);

  const handleShiftAction = async (action: 'move' | 'copy') => {
    if (!pendingDrop) return;
    const { shiftId, targetDate } = pendingDrop;
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;

    const duration = shift.endTime.getTime() - shift.startTime.getTime();
    
    // Create new start time with the same hours/minutes but on the target date
    const newStartTime = new Date(targetDate);
    newStartTime.setHours(shift.startTime.getHours());
    newStartTime.setMinutes(shift.startTime.getMinutes());
    newStartTime.setSeconds(0);
    newStartTime.setMilliseconds(0);

    const newEndTime = new Date(newStartTime.getTime() + duration);

    try {
      if (action === 'move') {
        await updateDoc(doc(db, 'shifts', shiftId), {
          startTime: Timestamp.fromDate(newStartTime),
          endTime: Timestamp.fromDate(newEndTime)
        });
      } else {
        await addDoc(collection(db, 'shifts'), {
          staffId: shift.staffId,
          staffName: shift.staffName,
          startTime: Timestamp.fromDate(newStartTime),
          endTime: Timestamp.fromDate(newEndTime),
          title: shift.title || '',
          note: shift.note || ''
        });
      }
      setPendingDrop(null);
    } catch (err) {
      console.error(`Shift ${action} error:`, err);
    }
  };

  const handleDeleteShift = async () => {
    if (!shiftToDelete) return;
    try {
      await deleteDoc(doc(db, 'shifts', shiftToDelete.id));
      setShiftToDelete(null);
    } catch (err) {
      console.error("Shift delete error:", err);
    }
  };

  const handleDeleteStaff = async () => {
    if (!staffToDelete) return;
    try {
      await deleteDoc(doc(db, 'staff', staffToDelete.id));
      setStaffToDelete(null);
    } catch (err) {
      console.error("Staff delete error:", err);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50">
        {/* Mobile Overlay */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside className={cn(
          "fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 p-4 flex flex-col gap-6 z-50 transition-transform duration-300 lg:relative lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="flex items-center justify-between lg:justify-start gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-100">
                <CalendarIcon className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-lg font-bold tracking-tight">StaffSync</h1>
            </div>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="p-2 hover:bg-slate-100 rounded-lg lg:hidden"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-6">
            <nav className="flex flex-col gap-1">
              <button 
                onClick={() => {
                  setActiveView('calendar');
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                  activeView === 'calendar' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <CalendarIcon className="w-4 h-4" />
                カレンダー表示
              </button>
              {isAdmin && (
                <button 
                  onClick={() => {
                    setActiveView('management');
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                    activeView === 'management' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Settings className="w-4 h-4" />
                  管理・設定
                </button>
              )}
            </nav>

            {activeView === 'management' && isAdmin && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Users className="w-3 h-3" /> スタッフ管理
                  </h2>
                  <button 
                    onClick={() => setIsStaffModalOpen(true)}
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-blue-600 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {staffList.filter(s => s.role !== 'admin').map(staff => (
                    <div key={staff.id} className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-slate-50 transition-colors group">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-[10px]" style={{ backgroundColor: staff.color }}>
                        {staff.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{staff.name}</p>
                        <p className="text-[9px] text-slate-400 uppercase font-bold">{staff.role}</p>
                      </div>
                      {staff.id !== user?.uid && (
                        <button 
                          onClick={() => setStaffToDelete(staff)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeView === 'calendar' && (
              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2 px-3">
                  <Users className="w-3 h-3" /> スタッフ一覧
                </h2>
                <div className="flex flex-col gap-1 px-1.5">
                  {staffList.filter(s => s.role !== 'admin').map(staff => (
                    <div key={staff.id} className="flex items-center gap-2 p-1.5 rounded-xl">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center text-white font-bold text-[8px]" style={{ backgroundColor: staff.color }}>
                        {staff.name.charAt(0)}
                      </div>
                      <p className="text-[11px] font-medium text-slate-600 truncate">{staff.name}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100">
            {isAuthReady ? (
              user ? (
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.displayName || ''} referrerPolicy="no-referrer" />
                    ) : (
                      <UserIcon className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{user.displayName}</p>
                    <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">現在の状態</p>
                    <div className="flex items-center gap-2 text-slate-600">
                      <Eye className="w-3.5 h-3.5" />
                      <span className="text-xs font-bold">ゲスト閲覧中</span>
                    </div>
                  </div>
                  <button 
                    onClick={handleLogin}
                    className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all active:scale-95 text-sm"
                  >
                    <LogOut className="w-4 h-4 rotate-180" />
                    管理者・スタッフ ログイン
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center justify-center py-4">
                <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-50">
          {activeView === 'calendar' ? (
            <>
              <header className="h-auto min-h-16 bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex flex-col sm:flex-row items-center justify-between sticky top-0 z-10 gap-4">
                <div className="flex items-center justify-between w-full sm:w-auto gap-4">
                  <button 
                    onClick={() => setIsSidebarOpen(true)}
                    className="p-2 hover:bg-slate-100 rounded-lg lg:hidden"
                  >
                    <Users className="w-5 h-5 text-slate-600" />
                  </button>
                  <h2 className="text-lg lg:text-xl font-bold text-slate-900 truncate flex-1 sm:flex-none">
                    {format(currentMonth, 'yyyy年 MMMM', { locale: ja })}
                  </h2>
                  <div className="flex items-center bg-slate-100 rounded-xl p-0.5 sm:p-1">
                    <button 
                      onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                      className="p-1.5 sm:p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
                    >
                      <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <button 
                      onClick={() => setCurrentMonth(new Date())}
                      className="px-2 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold hover:bg-white hover:shadow-sm rounded-lg transition-all"
                    >
                      今日
                    </button>
                    <button 
                      onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                      className="p-1.5 sm:p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all"
                    >
                      <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  {isAdmin && (
                    <button 
                      onClick={() => {
                        setEditingShift(null);
                        setSelectedDate(new Date());
                        setIsShiftModalOpen(true);
                      }}
                      className="flex-1 sm:flex-none px-4 lg:px-6 py-2.5 lg:py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-100 text-sm lg:text-base"
                    >
                      <Plus className="w-4 h-4 lg:w-5 lg:h-5" /> <span className="sm:inline">シフト追加</span>
                    </button>
                  )}
                </div>
              </header>

              <div className="flex-1 p-2 sm:p-4 lg:p-6 overflow-auto">
                <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-[500px] sm:min-h-[600px]">
                  <div className="calendar-grid border-b border-slate-200">
                    {['日', '月', '火', '水', '木', '金', '土'].map((day, idx) => (
                      <div 
                        key={day} 
                        className={cn(
                          "py-2 sm:py-3 text-center text-[10px] sm:text-xs font-bold uppercase tracking-wider",
                          idx === 0 ? "text-red-500 bg-red-50/30" : 
                          idx === 6 ? "text-blue-500 bg-blue-50/30" : "text-slate-400"
                        )}
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  <LayoutGroup>
                    <div className="calendar-days-grid flex-1">
                      {days.map((day, i) => {
                        const dayKey = format(day, 'yyyy-MM-dd');
                        const dayShifts = shiftsByDay[dayKey] || [];
                        const isCurrentMonth = isSameMonth(day, currentMonth);
                        const isToday = isSameDay(day, new Date());
                        const isHoliday = getHolidayName(day) !== null;
                        const isSunday = getDay(day) === 0;
                        const isSaturday = getDay(day) === 6;

                        return (
                          <div 
                            key={day.toString()} 
                            data-date={dayKey}
                            className={cn(
                              "calendar-cell p-1 sm:p-1.5 border-r border-b border-slate-100 flex flex-col gap-0.5 sm:gap-1 transition-colors group relative overflow-hidden",
                              (isSunday || isHoliday) ? "bg-red-100/50" : 
                              isSaturday ? "bg-blue-100/50" : "bg-white",
                              !isCurrentMonth && "opacity-40 grayscale-[0.2]",
                              i % 7 === 6 && "border-r-0"
                            )}
                          >
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex flex-col">
                                <span className={cn(
                                  "w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center text-[10px] sm:text-xs font-bold rounded-full transition-all",
                                  isToday ? "bg-blue-600 text-white shadow-lg shadow-blue-100" : 
                                  getDay(day) === 0 || getHolidayName(day) ? "text-red-500" :
                                  getDay(day) === 6 ? "text-blue-500" : "text-slate-600",
                                  !isCurrentMonth && "opacity-30"
                                )}>
                                  {format(day, 'd')}
                                </span>
                                {isCurrentMonth && getHolidayName(day) && (
                                  <span className="text-[7px] sm:text-[8px] text-red-400 font-bold truncate max-w-[40px] sm:max-w-[60px]">
                                    {getHolidayName(day)}
                                  </span>
                                )}
                              </div>
                              {isAdmin && (
                                <button 
                                  onClick={() => {
                                    setSelectedDate(day);
                                    setEditingShift(null);
                                    setIsShiftModalOpen(true);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 rounded-lg text-slate-400 transition-all"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            <div className="flex flex-col gap-0.5 sm:gap-1 overflow-y-auto flex-1 scrollbar-hide">
                              {dayShifts.map(shift => {
                                const staff = staffList.find(s => s.id === shift.staffId);
                                const isPast = shift.endTime.getTime() < now.getTime();
                                return (
                                  <motion.button
                                    layout
                                    layoutId={shift.id}
                                    key={shift.id}
                                    drag={isAdmin}
                                    dragSnapToOrigin
                                    dragElastic={0.1}
                                    dragMomentum={false}
                                    onDragEnd={(e, info) => {
                                      if (!isAdmin) return;
                                      const elements = document.elementsFromPoint(info.point.x, info.point.y);
                                      const cell = elements.find(el => el.classList.contains('calendar-cell'));
                                      if (cell) {
                                        const dateStr = cell.getAttribute('data-date');
                                        if (dateStr && dateStr !== dayKey) {
                                          setPendingDrop({ shiftId: shift.id, targetDate: parseISO(dateStr) });
                                        }
                                      }
                                    }}
                                    onClick={() => {
                                      if (!isAdmin) return;
                                      setEditingShift(shift);
                                      setSelectedDate(shift.startTime);
                                      setIsShiftModalOpen(true);
                                    }}
                                    className={cn(
                                      "text-left px-1 py-0.5 sm:px-1.5 sm:py-1 rounded-md sm:rounded-lg text-[7px] sm:text-[9px] font-bold truncate transition-all flex items-center gap-0.5 sm:gap-1 select-none z-10 shadow-sm group/shift",
                                      isAdmin ? "cursor-grab active:cursor-grabbing hover:brightness-95 active:scale-95" : "cursor-default",
                                      isPast && "shadow-none border-transparent"
                                    )}
                                    style={{ 
                                      backgroundColor: staff?.color || '#3b82f6',
                                      color: '#fff',
                                      opacity: isPast ? 0.3 : 1
                                    }}
                                  >
                                    {isAdmin && <GripVertical className="w-2 h-2 sm:w-2.5 sm:h-2.5 opacity-50 shrink-0" />}
                                    <span className="opacity-80 font-mono text-[6px] sm:text-[8px]">{format(shift.startTime, 'HH:mm')}</span>
                                    <span className="truncate flex-1">{staff?.name || shift.staffName}</span>
                                  </motion.button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </LayoutGroup>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col">
              <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setIsSidebarOpen(true)}
                    className="p-2 hover:bg-slate-100 rounded-lg lg:hidden"
                  >
                    <Users className="w-5 h-5 text-slate-600" />
                  </button>
                  <h2 className="text-xl font-bold text-slate-900">管理・設定</h2>
                </div>
              </header>
              <div className="flex-1 p-6 overflow-auto">
                <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Staff Management Card */}
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
                          <Users className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold">スタッフ管理</h3>
                          <p className="text-sm text-slate-500">スタッフの追加・削除・権限設定</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsStaffModalOpen(true)}
                        className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="space-y-3">
                      {staffList.map(staff => (
                        <div key={staff.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl group">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: staff.color }}>
                              {staff.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-bold text-sm">{staff.name}</p>
                              <p className="text-xs text-slate-400">{staff.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={staff.role}
                              onChange={async (e) => {
                                const newRole = e.target.value as 'admin' | 'staff';
                                try {
                                  await updateDoc(doc(db, 'staff', staff.id), { role: newRole });
                                } catch (err) {
                                  console.error("Role update error:", err);
                                }
                              }}
                              disabled={staff.id === user?.uid}
                              className={cn(
                                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider outline-none cursor-pointer transition-all",
                                staff.role === 'admin' ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600",
                                staff.id === user?.uid && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              <option value="staff">Staff</option>
                              <option value="admin">Admin</option>
                            </select>
                            {staff.id !== user?.uid && (
                              <button 
                                onClick={() => setStaffToDelete(staff)}
                                className="p-2 text-slate-300 hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* App Stats Card */}
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center">
                        <CalendarIcon className="w-6 h-6 text-green-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">稼働状況</h3>
                        <p className="text-sm text-slate-500">登録済みのシフト統計</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl">
                        <p className="text-xs text-slate-400 font-bold uppercase mb-1">総スタッフ数</p>
                        <p className="text-2xl font-bold">{staffList.length} 名</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl">
                        <p className="text-xs text-slate-400 font-bold uppercase mb-1">総シフト数</p>
                        <p className="text-2xl font-bold">{shifts.length} 件</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Modals */}
        <AnimatePresence>
          {isShiftModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsShiftModalOpen(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              >
                <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 className="text-xl font-bold">
                    {editingShift ? 'シフトを編集' : '新規シフト作成'}
                  </h3>
                  <button onClick={() => setIsShiftModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const staffId = formData.get('staffId') as string;
                    const startDateStr = (formData.get('startDate') || formData.get('date')) as string;
                    const endDateStr = (formData.get('endDate') || startDateStr) as string;
                    const startStr = formData.get('startTime') as string;
                    const endStr = formData.get('endTime') as string;
                    const title = formData.get('title') as string;
                    const note = formData.get('note') as string;

                    const startTime = parseISO(`${startDateStr}T${startStr}`);
                    const endTime = parseISO(`${startDateStr}T${endStr}`);
                    const staff = staffList.find(s => s.id === staffId);

                    const shiftData = {
                      staffId,
                      staffName: staff?.name || '',
                      startTime: Timestamp.fromDate(startTime),
                      endTime: Timestamp.fromDate(endTime),
                      title: title || '',
                      note: note || ''
                    };

                    try {
                      if (editingShift) {
                        await updateDoc(doc(db, 'shifts', editingShift.id), shiftData);
                      } else {
                        await addDoc(collection(db, 'shifts'), shiftData);
                      }
                      
                      // Bulk Copy Logic (if endDate is after startDate)
                      if (endDateStr !== startDateStr) {
                        const bulkEndDate = parseISO(endDateStr);
                        let currentDate = addDays(startTime, 1);
                        const duration = endTime.getTime() - startTime.getTime();

                        while (isBefore(currentDate, addDays(bulkEndDate, 1))) {
                          const newStart = new Date(currentDate);
                          const newEnd = new Date(currentDate.getTime() + duration);
                          
                          await addDoc(collection(db, 'shifts'), {
                            ...shiftData,
                            startTime: Timestamp.fromDate(newStart),
                            endTime: Timestamp.fromDate(newEnd)
                          });
                          currentDate = addDays(currentDate, 1);
                        }
                      }
                      setIsShiftModalOpen(false);
                    } catch (err) {
                      console.error("Shift save error:", err);
                    }
                  }}
                  className="p-8 flex flex-col gap-6 overflow-y-auto"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">スタッフ</label>
                      <select 
                        name="staffId" 
                        required 
                        defaultValue={editingShift?.staffId || user?.uid}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        {staffList.filter(s => s.role !== 'admin').map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-2 grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">開始日</label>
                        <input 
                          type="date" 
                          name="startDate" 
                          required 
                          defaultValue={format(editingShift ? editingShift.startTime : (selectedDate || new Date()), 'yyyy-MM-dd')}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">終了日</label>
                        <input 
                          type="date" 
                          name="endDate" 
                          required 
                          defaultValue={format(editingShift ? editingShift.startTime : (selectedDate || new Date()), 'yyyy-MM-dd')}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">開始時間</label>
                      <input 
                        type="time" 
                        name="startTime" 
                        required 
                        defaultValue={editingShift ? format(editingShift.startTime, 'HH:mm') : '09:00'}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">終了時間</label>
                      <input 
                        type="time" 
                        name="endTime" 
                        required 
                        defaultValue={editingShift ? format(editingShift.endTime, 'HH:mm') : '18:00'}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">タイトル（任意）</label>
                      <input 
                        type="text" 
                        name="title" 
                        defaultValue={editingShift?.title}
                        placeholder="例: 早番, 会議など"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 pt-4">
                    {editingShift && (
                      <button 
                        type="button"
                        onClick={() => {
                          setShiftToDelete(editingShift);
                          setIsShiftModalOpen(false);
                        }}
                        className="p-4 text-red-500 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 className="w-6 h-6" />
                      </button>
                    )}
                    <button 
                      type="submit"
                      className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-xl shadow-blue-100"
                    >
                      保存する
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {isStaffModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsStaffModalOpen(false)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
              >
                <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h3 className="text-xl font-bold">スタッフを追加</h3>
                  <button onClick={() => setIsStaffModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>
                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const name = formData.get('name') as string;
                    const role = formData.get('role') as 'admin' | 'staff';
                    const color = formData.get('color') as string;

                    try {
                      await addDoc(collection(db, 'staff'), {
                        name,
                        role,
                        color,
                        isManual: true,
                        createdAt: Timestamp.now()
                      });
                      setIsStaffModalOpen(false);
                    } catch (err) {
                      console.error("Staff add error:", err);
                    }
                  }}
                  className="p-8 flex flex-col gap-6 overflow-y-auto"
                >
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">名前</label>
                    <input 
                      type="text" 
                      name="name" 
                      required 
                      placeholder="スタッフ名を入力"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">役割</label>
                    <select 
                      name="role" 
                      required 
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    >
                      <option value="staff">スタッフ</option>
                      <option value="admin">管理者</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">表示色</label>
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        '#ef4444', // Red
                        '#3b82f6', // Blue
                        '#22c55e', // Green
                        '#f59e0b', // Amber
                        '#a855f7', // Purple
                        '#f97316', // Orange
                        '#06b6d4', // Cyan
                        '#ec4899', // Pink
                        '#84cc16', // Lime
                        '#475569'  // Slate
                      ].map(c => (
                        <label key={c} className="relative cursor-pointer group">
                          <input type="radio" name="color" value={c} className="peer sr-only" defaultChecked={c === '#ef4444'} />
                          <div className="w-full aspect-square rounded-xl border-2 border-transparent peer-checked:border-slate-900 peer-checked:scale-110 transition-all shadow-sm group-hover:scale-105" style={{ backgroundColor: c }} />
                        </label>
                      ))}
                    </div>
                  </div>
                  <button 
                    type="submit"
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-xl shadow-blue-100"
                  >
                    スタッフを追加
                  </button>
                </form>
              </motion.div>
            </div>
          )}

          {pendingDrop && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPendingDrop(null)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden p-8 text-center"
              >
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Clock className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold mb-2">シフトの操作を選択</h3>
                <p className="text-slate-500 mb-8">
                  {format(pendingDrop.targetDate, 'M月d日')} へシフトを移動しますか、それともコピーしますか？
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => handleShiftAction('move')}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-100"
                  >
                    移動する
                  </button>
                  <button 
                    onClick={() => handleShiftAction('copy')}
                    className="w-full py-4 bg-slate-100 text-slate-900 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                  >
                    コピーする
                  </button>
                  <button 
                    onClick={() => setPendingDrop(null)}
                    className="w-full py-3 text-slate-400 font-medium hover:text-slate-600 transition-all"
                  >
                    キャンセル
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {shiftToDelete && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShiftToDelete(null)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden p-8 text-center"
              >
                <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-xl font-bold mb-2">シフトを削除しますか？</h3>
                <p className="text-slate-500 mb-8">
                  {format(shiftToDelete.startTime, 'M月d日 HH:mm')} の {shiftToDelete.staffName} さんのシフトを削除します。この操作は取り消せません。
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handleDeleteShift}
                    className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-100"
                  >
                    削除する
                  </button>
                  <button 
                    onClick={() => setShiftToDelete(null)}
                    className="w-full py-4 bg-slate-100 text-slate-900 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                  >
                    キャンセル
                  </button>
                </div>
              </motion.div>
            </div>
          )}
          {staffToDelete && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setStaffToDelete(null)}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden p-8 text-center"
              >
                <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Users className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-xl font-bold mb-2">スタッフを削除しますか？</h3>
                <p className="text-slate-500 mb-8">
                  {staffToDelete.name} さんをリストから削除します。この操作は取り消せません。
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handleDeleteStaff}
                    className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-100"
                  >
                    削除する
                  </button>
                  <button 
                    onClick={() => setStaffToDelete(null)}
                    className="w-full py-4 bg-slate-100 text-slate-900 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                  >
                    キャンセル
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
