import React, { useState, useEffect, useMemo } from 'react';
import { format, addDays, isAfter, isToday, parse, isBefore, startOfDay } from 'date-fns';
import { th } from 'date-fns/locale';
import Swal from 'sweetalert2';
import { Calendar, Clock, User, Building, MessageSquare, Star, Send, Info, Key, Smartphone, History, Search, Filter, ArrowUpDown, MapPin, Check, LogIn, LogOut } from 'lucide-react';
import { db, auth, loginWithGoogle, logout } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, getDocFromServer, Timestamp, getDocs, where, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const DEPARTMENTS = ['ไอที (IT)', 'ทรัพยากรบุคคล (HR)', 'ฝ่ายขาย (Sales)', 'การตลาด (Marketing)', 'การเงิน (Finance)', 'อื่นๆ (Other)'];
const ROOMS = ['ห้อง A', 'ห้อง B', 'ห้อง C'];

// Error Handling Spec for Firestore Operations
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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
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
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Generate 30-min intervals from 08:00 to 20:00
const generateTimeSlots = () => {
  const slots = [];
  for (let h = 8; h <= 20; h++) {
    slots.push(`${h.toString().padStart(2, '0')}:00`);
    if (h !== 20) {
      slots.push(`${h.toString().padStart(2, '0')}:30`);
    }
  }
  return slots;
};

const TIME_SLOTS = generateTimeSlots();

// Mock data for preview environment
const MOCK_HISTORY = [
  {
    timestamp: new Date().toISOString(),
    name: 'สมชาย ใจดี',
    department: 'ไอที (IT)',
    room: 'ห้อง A',
    topic: 'วางแผนระบบ Q3',
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '10:00',
    endTime: '11:30',
    duration: 1.5,
    satisfaction: 5,
    userLineId: '@somchai'
  },
  {
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    name: 'สมหญิง รักงาน',
    department: 'การตลาด (Marketing)',
    room: 'ห้อง B',
    topic: 'ประชุมแคมเปญใหม่',
    date: format(new Date(Date.now() - 86400000), 'yyyy-MM-dd'),
    startTime: '14:00',
    endTime: '16:00',
    duration: 2,
    satisfaction: 4,
    userLineId: '@somying'
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'booking' | 'history'>('booking');
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // Booking Form State
  const [formData, setFormData] = useState({
    name: '',
    department: '',
    customDepartment: '',
    topic: '',
    room: '',
    date: '',
    startTime: '',
    endTime: '',
  });
  const [minDate, setMinDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Success & Rating State
  const [successData, setSuccessData] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);

  // History State
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Auth Effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Initialize minimum date based on current time
  useEffect(() => {
    const now = new Date();
    const currentHour = now.getHours();
    
    if (currentHour >= 20) {
      setMinDate(format(addDays(now, 1), 'yyyy-MM-dd'));
      setFormData(prev => ({ ...prev, date: format(addDays(now, 1), 'yyyy-MM-dd') }));
    } else {
      setMinDate(format(now, 'yyyy-MM-dd'));
      setFormData(prev => ({ ...prev, date: format(now, 'yyyy-MM-dd') }));
    }
  }, []);

  // Fetch History Effect (Real-time with Firestore)
  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    setIsLoadingHistory(true);
    const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookings = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setHistoryData(bookings);
      setIsLoadingHistory(false);
    }, (error) => {
      setIsLoadingHistory(false);
      handleFirestoreError(error, OperationType.GET, 'bookings');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Cleanup Old Bookings & Feedback Effect
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const cleanupOldData = async () => {
      try {
        // Query bookings where expiresAt is in the past
        const qBookings = query(collection(db, 'bookings'), where('expiresAt', '<', new Date()));
        const snapshotBookings = await getDocs(qBookings);
        
        if (!snapshotBookings.empty) {
          snapshotBookings.forEach(async (docSnap) => {
            try {
              await deleteDoc(doc(db, 'bookings', docSnap.id));
              console.log(`Auto-deleted old booking: ${docSnap.id}`);
            } catch (error) {
              console.error('Failed to auto-delete old booking', error);
            }
          });
        }

        // Query feedback where expiresAt is in the past
        const qFeedback = query(collection(db, 'feedback'), where('expiresAt', '<', new Date()));
        const snapshotFeedback = await getDocs(qFeedback);
        
        if (!snapshotFeedback.empty) {
          snapshotFeedback.forEach(async (docSnap) => {
            try {
              await deleteDoc(doc(db, 'feedback', docSnap.id));
              console.log(`Auto-deleted old feedback: ${docSnap.id}`);
            } catch (error) {
              console.error('Failed to auto-delete old feedback', error);
            }
          });
        }
      } catch (error) {
        console.error('Error fetching old data for cleanup', error);
      }
    };

    // Run cleanup once on load
    cleanupOldData();
  }, [isAuthReady, user]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      if (name === 'date') {
        newData.startTime = '';
        newData.endTime = '';
      }
      if (name === 'startTime') {
        newData.endTime = '';
      }
      if (name === 'department' && value !== 'อื่นๆ (Other)') {
        newData.customDepartment = '';
      }
      return newData;
    });
  };

  const availableStartTimes = useMemo(() => {
    if (!formData.date) return TIME_SLOTS;
    const selectedDate = parse(formData.date, 'yyyy-MM-dd', new Date());
    if (isToday(selectedDate)) {
      const now = new Date();
      return TIME_SLOTS.filter(time => {
        const [hours, minutes] = time.split(':').map(Number);
        const slotTime = new Date();
        slotTime.setHours(hours, minutes, 0, 0);
        return isAfter(slotTime, now);
      });
    }
    return TIME_SLOTS;
  }, [formData.date]);

  const availableEndTimes = useMemo(() => {
    if (!formData.startTime) return [];
    const startIndex = TIME_SLOTS.indexOf(formData.startTime);
    return TIME_SLOTS.slice(startIndex + 1);
  }, [formData.startTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.department || !formData.topic || !formData.room || !formData.date || !formData.startTime || !formData.endTime) {
      Swal.fire({
        icon: 'error',
        title: 'ข้อมูลไม่ครบถ้วน',
        text: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน',
        confirmButtonColor: '#3b82f6'
      });
      return;
    }

    if (formData.department === 'อื่นๆ (Other)' && !formData.customDepartment) {
      Swal.fire({
        icon: 'error',
        title: 'ระบุแผนก',
        text: 'กรุณาระบุแผนกของคุณ',
        confirmButtonColor: '#3b82f6'
      });
      return;
    }

    setIsSubmitting(true);

    const bookingDate = new Date(formData.date);
    const expiresAtDate = addDays(bookingDate, 7); // Expire 7 days after the meeting date

    const payload = {
      userId: user.uid,
      name: formData.name,
      department: formData.department === 'อื่นๆ (Other)' ? formData.customDepartment : formData.department,
      topic: formData.topic,
      room: formData.room,
      date: formData.date,
      startTime: formData.startTime,
      endTime: formData.endTime,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAtDate),
    };

    try {
      const docRef = await addDoc(collection(db, 'bookings'), payload);
      setSuccessData({ ...payload, id: docRef.id });

      setFormData({
        name: '',
        department: '',
        customDepartment: '',
        topic: '',
        room: '',
        date: minDate,
        startTime: '',
        endTime: '',
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bookings');
      Swal.fire({
        icon: 'error',
        title: 'การจองล้มเหลว',
        text: 'เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง',
        confirmButtonColor: '#3b82f6'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRatingSubmit = async (selectedRating: number) => {
    setRatingSubmitted(true);

    if (!successData?.id) return;

    try {
      const feedbackRef = collection(db, 'feedback');
      await addDoc(feedbackRef, {
        bookingId: successData.id,
        userId: user?.uid || 'anonymous',
        rating: selectedRating,
        comment: comment,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(addDays(new Date(), 14))
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'feedback');
      console.error('Failed to submit rating:', error);
    }
  };

  const filteredHistory = useMemo(() => {
    return historyData
      .filter(item => {
        const matchesSearch = item.topic.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              item.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesRoom = filterRoom ? item.room === filterRoom : true;
        return matchesSearch && matchesRoom;
      })
      .sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.startTime}`).getTime();
        const dateB = new Date(`${b.date}T${b.startTime}`).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      });
  }, [historyData, searchQuery, filterRoom, sortOrder]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-6">
            <Calendar className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">ระบบจองห้องประชุม</h1>
          <p className="text-slate-600 mb-8">กรุณาเข้าสู่ระบบด้วยบัญชี Google เพื่อดำเนินการต่อ</p>
          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl transition-colors"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
            เข้าสู่ระบบด้วย Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans text-slate-800">
      <div className="max-w-4xl mx-auto">
        
        {/* Header & Tabs */}
        <div className="bg-white rounded-t-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden border border-slate-100 border-b-0">
          <div className="bg-blue-600 px-8 py-10 text-white text-center relative">
            <button 
              onClick={logout}
              className="absolute top-4 right-4 flex items-center gap-2 text-blue-100 hover:text-white bg-blue-700/50 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium"
            >
              <LogOut className="w-4 h-4" />
              ออกจากระบบ
            </button>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500 mb-4 shadow-inner">
              <Calendar className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">ระบบจองห้องประชุม</h1>
            <p className="mt-2 text-blue-100 font-medium">จองพื้นที่ทำงานของคุณอย่างรวดเร็วและง่ายดาย</p>
          </div>
          
          <div className="flex border-b border-slate-200 bg-slate-50">
            <button
              onClick={() => setActiveTab('booking')}
              className={`flex-1 py-4 text-center font-medium text-sm sm:text-base transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'booking' 
                  ? 'bg-white text-blue-600 border-b-2 border-blue-600' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4" />
              จองห้องประชุม
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-4 text-center font-medium text-sm sm:text-base transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'history' 
                  ? 'bg-white text-blue-600 border-b-2 border-blue-600' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              <History className="w-4 h-4" />
              ประวัติการจอง
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="bg-white rounded-b-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 border-t-0 p-8">
          
          {/* TAB: BOOKING FORM */}
          {activeTab === 'booking' && (
            successData ? (
              <div className="animate-in fade-in duration-300 text-center py-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-6">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">จองห้องประชุมสำเร็จ!</h2>
                <p className="text-slate-600 mb-8">ระบบได้บันทึกการจองของคุณเรียบร้อยแล้ว</p>

                <div className="bg-slate-50 rounded-xl p-6 text-left max-w-md mx-auto mb-8 border border-slate-100">
                  <p className="mb-2"><strong>ห้อง:</strong> {successData.room}</p>
                  <p className="mb-2"><strong>หัวข้อ:</strong> {successData.topic}</p>
                  <p className="mb-2"><strong>วันที่:</strong> {format(new Date(successData.date), 'd MMMM yyyy', { locale: th })}</p>
                  <p><strong>เวลา:</strong> {successData.startTime} - {successData.endTime}</p>
                </div>

                <div className="border-t border-slate-100 pt-8 max-w-md mx-auto">
                  <h3 className="text-lg font-medium text-slate-800 mb-4">คุณมีความพึงพอใจกับระบบการจองนี้ระดับใด?</h3>
                  <div className="flex justify-center gap-2 mb-6">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => !ratingSubmitted && setRating(star)}
                        disabled={ratingSubmitted}
                        className={`focus:outline-none transition-transform ${!ratingSubmitted ? 'hover:scale-110' : 'cursor-default'}`}
                      >
                        <Star
                          className={`w-10 h-10 ${
                            rating >= star
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'fill-slate-100 text-slate-200 hover:fill-yellow-100 hover:text-yellow-200'
                          } transition-colors`}
                        />
                      </button>
                    ))}
                  </div>

                  {!ratingSubmitted && rating > 0 && (
                    <div className="mb-6 animate-in fade-in slide-in-from-bottom-2">
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="ข้อเสนอแนะเพิ่มเติมเพื่อการพัฒนา (ไม่บังคับ)"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white resize-none h-24"
                      />
                      <button
                        onClick={() => handleRatingSubmit(rating)}
                        className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl transition-all"
                      >
                        ส่งคำติชม
                      </button>
                    </div>
                  )}

                  {ratingSubmitted && <p className="text-green-600 font-medium mb-6 animate-in fade-in">ขอบคุณสำหรับคะแนนประเมินและข้อเสนอแนะ!</p>}

                  <button
                    onClick={() => {
                      setSuccessData(null);
                      setRating(0);
                      setComment('');
                      setRatingSubmitted(false);
                    }}
                    className="text-blue-600 hover:text-blue-700 font-medium mt-4"
                  >
                    กลับไปหน้าแรกเพื่อจองใหม่
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-8 animate-in fade-in duration-300">
              {/* Section: Personal Info */}
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-500" />
                  ข้อมูลส่วนตัว
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">ชื่อ-นามสกุล *</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น สมชาย ใจดี"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">แผนก *</label>
                    <select
                      name="department"
                      value={formData.department}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white appearance-none"
                      required
                    >
                      <option value="" disabled>เลือกแผนก</option>
                      {DEPARTMENTS.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {formData.department === 'อื่นๆ (Other)' && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-sm font-medium text-slate-700 mb-1">ระบุแผนก *</label>
                    <input
                      type="text"
                      name="customDepartment"
                      value={formData.customDepartment}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น ฝ่ายออกแบบ, R&D"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Section: Meeting Details */}
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <Building className="w-5 h-5 text-blue-500" />
                  รายละเอียดการประชุม
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">หัวข้อการประชุม *</label>
                    <input
                      type="text"
                      name="topic"
                      value={formData.topic}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น วางแผนระบบ Q3, ประชุมลูกค้า"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">เลือกห้องประชุม *</label>
                    <select
                      name="room"
                      value={formData.room}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white appearance-none"
                      required
                    >
                      <option value="" disabled>เลือกห้อง</option>
                      {ROOMS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">วันที่ *</label>
                    <input
                      type="date"
                      name="date"
                      min={minDate}
                      value={formData.date}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                      <Clock className="w-4 h-4 text-slate-400" /> เวลาเริ่ม *
                    </label>
                    <select
                      name="startTime"
                      value={formData.startTime}
                      onChange={handleInputChange}
                      disabled={!formData.date}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      required
                    >
                      <option value="" disabled>เลือกเวลาเริ่ม</option>
                      {availableStartTimes.map(time => (
                        <option key={time} value={time}>{time}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                      <Clock className="w-4 h-4 text-slate-400" /> เวลาสิ้นสุด *
                    </label>
                    <select
                      name="endTime"
                      value={formData.endTime}
                      onChange={handleInputChange}
                      disabled={!formData.startTime}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                      required
                    >
                      <option value="" disabled>เลือกเวลาสิ้นสุด</option>
                      {availableEndTimes.map(time => (
                        <option key={time} value={time}>{time}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-6">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3.5 px-6 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      กำลังดำเนินการจอง...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      ยืนยันการจอง
                    </>
                  )}
                </button>
              </div>
            </form>
            )
          )}

          {/* TAB: HISTORY VIEW */}
          {activeTab === 'history' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Filters & Controls */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="ค้นหาจากหัวข้อ หรือ ชื่อ..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 focus:bg-white transition-all"
                  />
                </div>
                
                <div className="flex gap-4">
                  <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <select
                      value={filterRoom}
                      onChange={(e) => setFilterRoom(e.target.value)}
                      className="pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 focus:bg-white appearance-none transition-all"
                    >
                      <option value="">ทุกห้อง</option>
                      {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  
                  <button
                    onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-slate-700"
                  >
                    <ArrowUpDown className="w-4 h-4" />
                    <span className="hidden sm:inline">{sortOrder === 'desc' ? 'ล่าสุด' : 'เก่าสุด'}</span>
                  </button>
                </div>
              </div>

              {/* History List */}
              {isLoadingHistory ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400">
                  <svg className="animate-spin h-8 w-8 text-blue-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p>กำลังโหลดข้อมูล...</p>
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="py-12 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                  <History className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                  <p>ไม่พบประวัติการจอง</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {filteredHistory.map((booking, idx) => (
                    <div key={idx} className="bg-white border border-slate-100 p-5 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-800 mb-1">{booking.topic}</h3>
                          <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-md font-medium">
                              <MapPin className="w-3.5 h-3.5" /> {booking.room}
                            </span>
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <User className="w-3.5 h-3.5" /> {booking.name} ({booking.department})
                            </span>
                          </div>
                        </div>
                        <div className="text-left sm:text-right bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="text-sm font-medium text-slate-800 flex items-center sm:justify-end gap-1.5 mb-1">
                            <Calendar className="w-4 h-4 text-blue-500" />
                            {format(new Date(`${booking.date}T${booking.startTime}`), 'd MMMM yyyy', { locale: th })}
                          </div>
                          <div className="text-sm text-slate-600 flex items-center sm:justify-end gap-1.5">
                            <Clock className="w-4 h-4 text-blue-500" />
                            {booking.startTime} - {booking.endTime}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
      
      {/* Instructions Footer */}
      <div className="max-w-4xl mx-auto mt-8 bg-blue-50 rounded-xl p-6 border border-blue-100">
        <h3 className="text-blue-800 font-semibold flex items-center gap-2 mb-3">
          <Info className="w-5 h-5" />
          วิธีการใช้งานระบบจองห้องประชุม
        </h3>
        <ul className="space-y-3 text-sm text-blue-700">
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-200 text-blue-800 font-bold text-xs mt-0.5">1</span>
            <span><strong>กรอกข้อมูลให้ครบถ้วน:</strong> ระบุชื่อ แผนก หัวข้อการประชุม และเลือกห้องที่ต้องการ</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-200 text-blue-800 font-bold text-xs mt-0.5">2</span>
            <span><strong>เลือกวันและเวลา:</strong> ระบุวันที่และช่วงเวลาที่ต้องการใช้งานห้องประชุม</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-200 text-blue-800 font-bold text-xs mt-0.5">3</span>
            <span><strong>ยืนยันการจอง:</strong> ตรวจสอบข้อมูลและกดปุ่ม "ยืนยันการจอง" ด้านล่างสุด หลังจากนั้นสามารถให้คะแนนความพึงพอใจได้ในหน้าสรุปผล</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-200 text-blue-800 font-bold text-xs mt-0.5">4</span>
            <span><strong>ตรวจสอบประวัติ:</strong> สามารถดูรายการจองทั้งหมดได้ที่แท็บ "ประวัติการจอง" ด้านบน ข้อมูลจะแสดงผลแบบ Real-time ทันที</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
