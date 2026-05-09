/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  query, 
  orderBy, 
  serverTimestamp,
  increment,
  getDoc,
  where
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LogOut, 
  Shield, 
  Plus, 
  Package, 
  Users, 
  History, 
  X, 
  Phone, 
  User as UserIcon,
  Search,
  Wrench,
  AlertTriangle,
  ArrowRightLeft,
  Edit2,
  Trash2,
  Camera,
  ImageIcon
} from 'lucide-react';
import { auth, db, loginWithGoogle, logout } from './lib/firebase';
import { Part, Rental, AdminLog, CATEGORIES } from './types.ts';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState<Part[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
  const [showAdminPopup, setShowAdminPopup] = useState(false);
  const [showRentalModal, setShowRentalModal] = useState<{ part: Part } | null>(null);
  const [showAddPartModal, setShowAddPartModal] = useState(false);
  const [showEditPartModal, setShowEditPartModal] = useState<Part | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [adminActiveTab, setAdminActiveTab] = useState<'inventory' | 'rentals' | 'logs'>('inventory');

  // Refs for scrolling
  const rentalsRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  const scrollToRentals = () => {
    if (isAdminMode) {
      setAdminActiveTab('rentals');
    } else {
      setIsAdminMode(false);
      setTimeout(() => {
        rentalsRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const scrollToLibrary = () => {
    setIsAdminMode(false);
    setTimeout(() => {
      libraryRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // Auth State
  useEffect(() => {
    console.log("Auth listener initializing...");
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log("Auth state changed:", u?.email || "No user");
      setUser(u);
      
      if (u) {
        try {
          const adminRef = doc(db, 'admins', u.uid);
          // Use a timeout or handle failure for admin check to not block initial load
          const adminSnap = await getDoc(adminRef).catch(err => {
            console.error("Admin snap fetch failed:", err);
            return null;
          });
          
          const isAdminUser = adminSnap?.exists() || 
                             u.email === 'kfcrobotpw@gmail.com' || 
                             u.uid === 'HVu4W9gNPYcDWhB6FBgdGyejF2G3';
                             
          setIsAdmin(isAdminUser);
        } catch (error) {
          console.error("Admin check logic failed:", error);
          setIsAdmin(u.email === 'kfcrobotpw@gmail.com' || u.uid === 'HVu4W9gNPYcDWhB6FBgdGyejF2G3');
        }
      } else {
        setIsAdmin(false);
        setIsAdminMode(false);
      }
      
      // Ensure loading is set to false after auth state is determined
      setLoading(false);
    }, (error) => {
      console.error("Auth listener error:", error);
      setLoading(false);
    });

    // Fallback: if auth state doesn't change within 5 seconds, stop loading
    const timeout = setTimeout(() => {
      if (loading) {
        console.warn("Auth check timed out, forcing loading to false");
        setLoading(false);
      }
    }, 5000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Data Sync
  useEffect(() => {
    if (!user) return;

    const partsUnsubscribe = onSnapshot(collection(db, 'parts'), (snapshot) => {
      setParts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Part)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'parts');
    });

    const rentalsQuery = isAdminMode 
      ? query(collection(db, 'rentals'), orderBy('borrowedAt', 'desc'))
      : query(collection(db, 'rentals'), where('userId', '==', user.uid), orderBy('borrowedAt', 'desc'));

    const rentalsUnsubscribe = onSnapshot(rentalsQuery, (snapshot) => {
      setRentals(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Rental)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'rentals');
    });

    let logsUnsubscribe = () => {};
    if (isAdminMode && isAdmin) {
      const logsQuery = query(collection(db, 'admin_logs'), orderBy('timestamp', 'desc'));
      logsUnsubscribe = onSnapshot(logsQuery, (snapshot) => {
        setAdminLogs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AdminLog)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'admin_logs');
      });
    }

    return () => {
      partsUnsubscribe();
      rentalsUnsubscribe();
      logsUnsubscribe();
    };
  }, [user, isAdminMode, isAdmin]);

  const handleAdminAccess = async () => {
    if (!user) return;
    
    try {
      // Log the attempt
      await addDoc(collection(db, 'admin_logs'), {
        userId: user.uid,
        userEmail: user.email,
        displayName: user.displayName,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'admin_logs');
    }

    if (isAdmin) {
      setIsAdminMode(true);
      setShowAdminPopup(false);
    } else {
      alert("관리자 권한이 없습니다. 계정 정보가 로깅되었습니다.");
      setShowAdminPopup(false);
    }
  };

  const handleRental = async (formData: { name: string; phone: string }) => {
    if (!showRentalModal || !user) return;
    const { part } = showRentalModal;

    if (part.availableStock <= 0) {
      alert("재고가 없습니다.");
      return;
    }

    try {
      // Create rental record
      const rentalsRef = collection(db, 'rentals');
      await addDoc(rentalsRef, {
        userId: user.uid,
        userEmail: user.email,
        userName: formData.name,
        userPhone: formData.phone,
        partId: part.id,
        partName: part.name,
        status: 'borrowed',
        borrowedAt: serverTimestamp()
      });

      // Update stock
      await updateDoc(doc(db, 'parts', part.id), {
        availableStock: increment(-1)
      });

      setShowRentalModal(null);
      alert("대여가 완료되었습니다.");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('{')) throw error;
      handleFirestoreError(error, OperationType.WRITE, 'rentals/parts');
    }
  };

  const handleReturn = async (rental: Rental) => {
    try {
      await updateDoc(doc(db, 'rentals', rental.id), {
        status: 'returned',
        returnedAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'parts', rental.partId), {
        availableStock: increment(1)
      });

      alert("반납이 완료되었습니다.");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('{')) throw error;
      handleFirestoreError(error, OperationType.WRITE, `rentals/parts/${rental.id}`);
    }
  };

  const handleAddPart = async (formData: any, imageFile: File | null) => {
    try {
      let imageUrl = '';
      if (imageFile) {
        imageUrl = await compressImage(imageFile);
      }

      await addDoc(collection(db, 'parts'), {
        ...formData,
        totalStock: parseInt(formData.totalStock),
        availableStock: parseInt(formData.totalStock),
        imageUrl
      });
      setShowAddPartModal(false);
      alert("부품이 추가되었습니다.");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'parts');
    }
  };

  const handleUpdatePart = async (id: string, formData: any, imageFile: File | null) => {
    try {
      const partRef = doc(db, 'parts', id);
      const totalStock = parseInt(formData.totalStock) || 0;
      const availableStock = parseInt(formData.availableStock) || 0;
      
      const updateData: any = {
        name: String(formData.name),
        category: String(formData.category),
        description: String(formData.description || ''),
        totalStock,
        availableStock
      };

      if (imageFile) {
        updateData.imageUrl = await compressImage(imageFile);
      }
      
      await updateDoc(partRef, updateData);
      setShowEditPartModal(null);
      alert("부품 정보가 수정되었습니다.");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `parts/${id}`);
    }
  };

  const handleDeletePart = async (id: string) => {
    if (!window.confirm("정말로 이 부품을 삭제하시겠습니까? 관련 대여 기록은 유지되지만 부품 목록에서는 사라집니다.")) return;
    try {
      await deleteDoc(doc(db, 'parts', id));
      alert("부품이 삭제되었습니다.");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `parts/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="relative mb-8">
          <div className="absolute inset-0 animate-ping rounded-full bg-blue-400/20" />
          <div className="relative animate-spin rounded-full h-16 w-16 border-4 border-slate-200 border-t-blue-600 shadow-xl" />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2 tracking-tight">K.F.C. 시스템 초기화 중</h2>
        <p className="text-slate-500 font-medium text-sm text-center max-w-xs animate-pulse">
          데이터를 안전하게 불러오고 있습니다.<br />잠시만 기다려 주세요.
        </p>
        
        {/* Safety button if stuck for more than 5 seconds */}
        <button 
          onClick={() => setLoading(false)}
          className="mt-12 text-[10px] font-black text-slate-300 uppercase tracking-widest hover:text-slate-500 transition-colors"
        >
          로딩이 너무 오래 걸리나요?
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[2rem] shadow-2xl p-10 text-center border border-slate-100"
        >
          <div className="mb-10">
            <div className="w-24 h-24 bg-red-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-red-100">
              <Package className="text-white w-10 h-10" />
            </div>
            <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">K.F.C. 로봇동아리</h1>
            <p className="text-slate-500 font-medium text-sm">LEGO 부품 인벤토리 시스템</p>
          </div>
          
          <button
            onClick={() => loginWithGoogle()}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 py-4 px-6 rounded-2xl font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm hover:shadow-md"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            구글 계정으로 로그인
          </button>
          
          <p className="mt-10 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            용인시청소년수련관 로봇동아리 K.F.C.
          </p>
        </motion.div>
      </div>
    );
  }

  const filteredParts = parts.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-30">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center font-bold text-white text-[10px] shadow-sm">
            KFC
          </div>
          <div>
            <h1 className="text-lg font-black leading-tight tracking-tight text-slate-900">용인시청소년수련관 로봇동아리 K.F.C.</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">부품 관리 시스템</p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="hidden md:flex items-center space-x-3 bg-slate-100 px-3 py-1.5 rounded-full">
            <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white overflow-hidden">
              {user.photoURL ? <img src={user.photoURL} alt={user.displayName || ''} /> : <UserIcon className="text-white p-1" />}
            </div>
            <span className="text-xs font-bold text-slate-600">{user.email}</span>
          </div>
          
          <button
            onClick={logout}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-slate-200 p-6 flex flex-col justify-between shrink-0">
          <nav className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black mb-4">네비게이션</p>
            <button 
              onClick={scrollToLibrary}
              className={`w-full flex items-center space-x-3 p-3 rounded-xl font-bold transition-all active:scale-95 ${!isAdminMode ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <div className={`w-2 h-2 rounded-full ${!isAdminMode ? 'bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]' : 'bg-slate-300'}`} />
              <span>부품 라이브러리</span>
            </button>
            <button 
              onClick={scrollToRentals}
              className={`w-full flex items-center space-x-3 p-3 rounded-xl font-bold transition-all active:scale-95 ${isAdminMode && adminActiveTab === 'rentals' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <div className={`w-2 h-2 rounded-full ${isAdminMode && adminActiveTab === 'rentals' ? 'bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]' : 'bg-slate-300'}`} />
              <span>대여 현황</span>
            </button>
          </nav>

          <div className="bg-slate-900 rounded-2xl p-4 text-white">
            <p className="text-[10px] uppercase font-black text-slate-500 mb-4 tracking-widest text-center">관리자 메뉴</p>
            <button 
              onClick={() => isAdminMode ? setIsAdminMode(false) : setShowAdminPopup(true)}
              className={`w-full flex items-center justify-center space-x-2 p-3 rounded-xl font-bold transition-all ${isAdminMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/40'}`}
            >
              <Shield size={16} />
              <span>{isAdminMode ? '사용자 모드' : '관리자 대시보드'}</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-8 overflow-y-auto overflow-x-hidden">
          <AnimatePresence mode="wait">
            {isAdminMode ? (
              <motion.div
                key="admin"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <AdminView 
                  parts={parts} 
                  rentals={rentals} 
                  adminLogs={adminLogs}
                  activeTab={adminActiveTab}
                  setActiveTab={setAdminActiveTab}
                  onAddPart={() => setShowAddPartModal(true)}
                  onEditPart={(part: Part) => setShowEditPartModal(part)}
                  onDeletePart={handleDeletePart}
                />
              </motion.div>
            ) : (
              <motion.div
                key="user"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <UserView 
                  parts={filteredParts}
                  rentals={rentals}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  onRental={(part: Part) => setShowRentalModal({ part })}
                  onReturn={handleReturn}
                  rentalsRef={rentalsRef}
                  libraryRef={libraryRef}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Admin Warning Popup */}
      <AnimatePresence>
        {showAdminPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-[480px] rounded-[2rem] shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-10 flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-4xl mb-8 shadow-inner shadow-red-200/50">⚠️</div>
                <h3 className="text-2xl font-black text-slate-900 mb-4 tracking-tight">관리자 접근 보안</h3>
                <p className="text-slate-600 leading-relaxed mb-10 text-sm">
                  관리자 버튼은 실제 관리자만 누를 수 있습니다.<br />
                  <span className="font-bold text-red-600 underline underline-offset-4 decoration-2">접속 시 계정 정보({user.email})가 시스템에 전송됩니다.</span>
                </p>
                <div className="flex space-x-3 w-full">
                  <button
                    onClick={() => setShowAdminPopup(false)}
                    className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleAdminAccess}
                    className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200"
                  >
                    확인 및 접속
                  </button>
                </div>
              </div>
              <div className="bg-slate-50 px-10 py-4 border-t border-slate-100 text-[10px] text-slate-400 font-bold tracking-widest text-center uppercase">
                보안 프로토콜 활성화됨 • 세션 ID: KFC-{user.uid.slice(0, 5)}
              </div>
            </motion.div>
          </div>
        )}

        {/* Rental Modal */}
        {showRentalModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full overflow-hidden border border-slate-200"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                <h3 className="text-xl font-black tracking-tight">대여: {showRentalModal.part.name}</h3>
                <button onClick={() => setShowRentalModal(null)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={24} />
                </button>
              </div>
              <form 
                className="p-10"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  handleRental({ 
                    name: d.get('name') as string, 
                    phone: d.get('phone') as string 
                  });
                }}
              >
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">성함</label>
                    <input 
                      name="name"
                      required
                      placeholder="예시: 홍길동"
                      className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-bold text-slate-700 bg-slate-50/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">전화번호</label>
                    <input 
                      name="phone"
                      required
                      placeholder="010-1234-5678"
                      className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-bold text-slate-700 bg-slate-50/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full mt-10 bg-blue-600 text-white py-5 rounded-2xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all uppercase tracking-widest"
                >
                  대여 신청
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {/* Edit Part Modal */}
        {showEditPartModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                <h3 className="text-xl font-black tracking-tight">부품 정보 수정</h3>
                <button onClick={() => setShowEditPartModal(null)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={24} />
                </button>
              </div>
              <form 
                className="p-10 space-y-8"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  const imageFile = (document.getElementById('edit-image') as HTMLInputElement)?.files?.[0] || null;
                  
                  handleUpdatePart(showEditPartModal.id, {
                    name: d.get('name'),
                    category: d.get('category'),
                    totalStock: d.get('totalStock'),
                    availableStock: d.get('availableStock'),
                    description: d.get('description'),
                  }, imageFile);
                }}
              >
                <div className="flex justify-center mb-6">
                  <div className="relative group">
                    <div className="w-32 h-32 rounded-3xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden">
                      {showEditPartModal.imageUrl ? (
                        <img src={showEditPartModal.imageUrl} alt="Part" className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="text-slate-300" size={32} />
                      )}
                    </div>
                    <label 
                      htmlFor="edit-image"
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer rounded-3xl text-white font-bold text-xs"
                    >
                      변경하기
                    </label>
                    <input id="edit-image" type="file" accept="image/*" className="hidden" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">부품 이름</label>
                    <input name="name" required defaultValue={showEditPartModal.name} className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">카테고리</label>
                    <select name="category" defaultValue={showEditPartModal.category} className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold">
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">전체 재고수량</label>
                    <input name="totalStock" type="number" required defaultValue={showEditPartModal.totalStock} className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">잔여 재고수량</label>
                    <input name="availableStock" type="number" required defaultValue={showEditPartModal.availableStock} className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">상세 설명 / 스펙</label>
                    <textarea name="description" defaultValue={showEditPartModal.description} className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 h-28 font-medium" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition-all uppercase tracking-widest">저장하기</button>
              </form>
            </motion.div>
          </div>
        )}
        {showAddPartModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-900 text-white">
                <h3 className="text-xl font-black tracking-tight">새 부품 등록</h3>
                <button onClick={() => setShowAddPartModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all">
                  <X size={24} />
                </button>
              </div>
              <form 
                className="p-10 space-y-8"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  const imageFile = (document.getElementById('add-image') as HTMLInputElement)?.files?.[0] || null;

                  handleAddPart({
                    name: d.get('name'),
                    category: d.get('category'),
                    totalStock: d.get('totalStock'),
                    description: d.get('description')
                  }, imageFile);
                }}
              >
                <div className="flex justify-center mb-6">
                  <div className="relative group">
                    <div className="w-32 h-32 rounded-3xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden" id="add-image-preview">
                      <Camera className="text-slate-300" size={32} />
                    </div>
                    <label 
                      htmlFor="add-image"
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer rounded-3xl text-white font-bold text-xs"
                    >
                      이미지 선택
                    </label>
                    <input 
                      id="add-image" 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const preview = document.getElementById('add-image-preview');
                            if (preview) {
                              preview.innerHTML = `<img src="${ev.target?.result}" class="w-full h-full object-cover" />`;
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">부품 이름</label>
                    <input name="name" required className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">카테고리</label>
                    <select name="category" className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold">
                      {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">초기 재고</label>
                    <input name="totalStock" type="number" required defaultValue="1" className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 font-bold" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">상세 설명 / 스펙</label>
                    <textarea name="description" className="w-full px-5 py-3 rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-slate-50/50 h-28 font-medium" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black shadow-lg hover:bg-slate-800 transition-all uppercase tracking-widest">부품 등록 완료</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserView({ 
  parts, 
  rentals, 
  searchQuery, 
  setSearchQuery, 
  onRental, 
  onReturn,
  rentalsRef,
  libraryRef
}: any) {
  const activeRentals = rentals.filter((r: Rental) => r.status === 'borrowed');

  return (
    <div className="space-y-12">
      {/* Search Header */}
      <div ref={libraryRef} className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black tracking-tight text-slate-900 mb-2">부품 라이브러리</h2>
          <p className="text-slate-500 font-medium">로봇 제작에 필요한 부품을 찾아보세요.</p>
        </div>
        <div className="relative w-full lg:w-96">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-[1.25rem] outline-none shadow-sm focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all font-bold text-slate-700"
            placeholder="부품 검색..."
          />
        </div>
      </div>

      {/* My Rentals Section */}
      {activeRentals.length > 0 && (
        <section ref={rentalsRef} className="space-y-6">
          <div className="flex items-center space-x-3 px-1">
            <div className="w-2 h-6 bg-red-600 rounded-full" />
            <h3 className="text-xl font-black text-slate-900 tracking-tight">나의 대여 현황</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeRentals.map((rental: Rental) => (
              <motion.div
                key={rental.id}
                layout
                className="bg-white border-2 border-red-50 rounded-3xl p-6 shadow-sm flex items-center justify-between"
              >
                <div>
                  <h4 className="font-bold text-slate-900 mb-1">{rental.partName}</h4>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    대여일: {rental.borrowedAt?.toDate().toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => onReturn(rental)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-black rounded-xl hover:bg-slate-800 transition-all shadow-lg"
                >
                  반납하기
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Part Grid */}
      <section className="space-y-6 pb-20">
        <div className="flex items-center space-x-3 px-1">
          <div className="w-2 h-6 bg-blue-600 rounded-full" />
          <h3 className="text-xl font-black text-slate-900 tracking-tight">모든 부품</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
          {parts.map((part: Part) => (
            <motion.div
              key={part.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-100 transition-all group relative overflow-hidden flex flex-col"
            >
              <div className="h-48 bg-slate-100 relative overflow-hidden">
                {part.imageUrl ? (
                  <img src={part.imageUrl} alt={part.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-2">
                    <ImageIcon size={32} />
                    <span className="text-[10px] font-black uppercase tracking-widest">{part.category}</span>
                  </div>
                )}
                <div className="absolute top-4 right-4">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm ${
                    part.availableStock > 0 
                    ? 'bg-green-100 text-green-700' 
                    : 'bg-red-100 text-red-700'
                  }`}>
                    재고 {part.availableStock}개
                  </span>
                </div>
              </div>

              <div className="p-6 flex-1 flex flex-col space-y-4">
                <div>
                  <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">{part.category}</p>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors uppercase line-clamp-1">
                    {part.name}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium mt-2 line-clamp-2 min-h-[40px]">
                    {part.description || '부품에 대한 상세 설명이 없습니다.'}
                  </p>
                </div>

                <button
                  onClick={() => onRental(part)}
                  disabled={part.availableStock <= 0}
                  className={`w-full py-4 rounded-2xl font-black transition-all text-xs uppercase tracking-widest flex items-center justify-center gap-2 ${
                    part.availableStock > 0 
                    ? 'bg-slate-900 text-white hover:bg-blue-600 shadow-lg shadow-slate-200' 
                    : 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none'
                  }`}
                >
                  <ArrowRightLeft size={14} />
                  <span>{part.availableStock > 0 ? '대여하기' : '대여 불가 (품절)'}</span>
                </button>
              </div>
            </motion.div>
          ))}
          {parts.length === 0 && (
            <div className="col-span-full py-32 text-center bg-white border border-slate-200 rounded-[2rem] shadow-inner shadow-slate-100">
              <Package size={48} className="mx-auto text-slate-200 mb-6" />
              <p className="text-slate-400 font-black uppercase tracking-widest text-xs">검색 결과가 없습니다.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminView({ 
  parts, 
  rentals, 
  adminLogs, 
  onAddPart,
  onEditPart,
  onDeletePart,
  activeTab,
  setActiveTab
}: any) {
  return (
    <div className="space-y-10">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black tracking-tight text-slate-900 mb-2">관리자 대시보드</h2>
          <p className="text-slate-500 font-medium tracking-wide">인벤토리를 관리하고 시스템 활동을 모니터링합니다.</p>
        </div>
        <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
          {[
            { id: 'inventory', label: '재고 관리', icon: Package },
            { id: 'rentals', label: '대여 기록', icon: History },
            { id: 'logs', label: '보안 로그', icon: Users },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-5 py-3 text-[10px] font-black uppercase tracking-widest transition-all rounded-[0.85rem] active:scale-95 ${
                activeTab === tab.id 
                ? 'bg-slate-900 text-white shadow-lg' 
                : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/40 p-10 min-h-[600px] border border-slate-100">
        {activeTab === 'inventory' && (
          <div className="space-y-10">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">전체 재고 현황</h3>
              <button 
                onClick={onAddPart}
                className="flex items-center gap-3 bg-red-600 text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-500 shadow-lg shadow-red-200 transition-all active:scale-95"
              >
                <Plus size={18} />
                새 부품 등록
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                    <th className="pb-6 px-2">부품 이름</th>
                    <th className="pb-6 px-2">카테고리</th>
                    <th className="pb-6 px-2 text-center">전체 수량</th>
                    <th className="pb-6 px-2 text-center">잔여 수량</th>
                    <th className="pb-6 px-2 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {parts.map((p: Part) => (
                    <tr key={p.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="py-6 px-2">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-slate-50 overflow-hidden border border-slate-100 flex items-center justify-center shrink-0">
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                            ) : (
                              <ImageIcon size={20} className="text-slate-200" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-slate-900 uppercase truncate">{p.name}</p>
                            <p className="text-[10px] font-medium text-slate-400 truncate max-w-[150px]">{p.description || '설명 없음'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-6 px-2">
                        <span className="px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black rounded-full uppercase tracking-widest border border-blue-100">
                          {p.category}
                        </span>
                      </td>
                      <td className="py-6 px-2 text-center font-bold text-slate-400">{p.totalStock}</td>
                      <td className="py-6 px-2 text-center font-black text-slate-900">{p.availableStock}</td>
                      <td className="py-6 px-2 text-right">
                        <div className="flex items-center justify-end space-x-3">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditPart(p);
                            }}
                            className="p-3 text-slate-400 hover:text-blue-600 hover:bg-white rounded-xl transition-all active:scale-95 shadow-sm hover:shadow-md border border-transparent hover:border-blue-100 bg-slate-50/50"
                            title="수정"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeletePart(p.id);
                            }}
                            className="p-3 text-slate-400 hover:text-red-600 hover:bg-white rounded-xl transition-all active:scale-95 shadow-sm hover:shadow-md border border-transparent hover:border-red-100 bg-slate-50/50"
                            title="삭제"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'rentals' && (
          <div className="space-y-10">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">전체 대여 내역</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100">
                    <th className="pb-6 px-2">대여자 정보</th>
                    <th className="pb-6 px-2">부품명</th>
                    <th className="pb-6 px-2 text-center">현황</th>
                    <th className="pb-6 px-2 text-right">일시</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rentals.map((r: Rental) => (
                    <tr key={r.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="py-6 px-2">
                        <div className="flex flex-col">
                          <span className="font-black text-slate-900">{r.userName}</span>
                          <span className="text-[11px] font-medium text-slate-400">{r.userPhone}</span>
                        </div>
                      </td>
                      <td className="py-6 px-2 font-bold text-slate-700">{r.partName}</td>
                      <td className="py-6 px-2 text-center">
                        {r.status === 'borrowed' 
                          ? <span className="bg-orange-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg shadow-orange-100">대여중</span>
                          : <span className="bg-slate-100 text-slate-400 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">반납완료</span>
                        }
                      </td>
                      <td className="py-6 px-2 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] font-black text-slate-900">{r.borrowedAt?.toDate().toLocaleDateString()}</span>
                          {r.status === 'returned' && (
                            <span className="text-[10px] font-bold text-green-500 uppercase">반납: {r.returnedAt?.toDate().toLocaleDateString()}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="space-y-10">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">보안 접속 로그</h3>
            <div className="grid grid-cols-1 gap-4">
              {adminLogs.map((log: AdminLog) => (
                <div key={log.id} className="flex items-center gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100 group hover:border-red-200 transition-all">
                  <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm group-hover:bg-red-50 group-hover:border-red-100">
                    <UserIcon className="text-slate-400 group-hover:text-red-500 transition-colors" size={24} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-black text-slate-900 text-lg">{log.displayName}</span>
                      <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded uppercase tracking-widest">이벤트: 관리자 도구 클릭</span>
                    </div>
                    <p className="text-xs font-bold text-slate-400">{log.userEmail} • 시스템 접근 시도됨</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-slate-900 mb-1">{log.timestamp?.toDate().toLocaleDateString()}</p>
                    <p className="text-[10px] font-bold text-slate-400 font-mono">{log.timestamp?.toDate().toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
              {adminLogs.length === 0 && (
                <div className="py-20 text-center">
                  <Shield size={48} className="mx-auto text-slate-100 mb-6" />
                  <p className="text-slate-300 font-black uppercase tracking-[0.2em] text-xs">보안 이벤트가 없습니다.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
