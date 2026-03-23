import React, { useState, useEffect, useMemo } from 'react';
import { format, addDays, isAfter, isToday, parse, isBefore, startOfDay } from 'date-fns';
import { th } from 'date-fns/locale';
import emailjs from '@emailjs/browser';
import Swal from 'sweetalert2';
import { Calendar, Clock, User, Building, MessageSquare, Star, Send, Info, Key, Smartphone, History, Search, Filter, ArrowUpDown, MapPin, Check, LogIn, LogOut, Trash2 } from 'lucide-react';
import { db, auth, loginWithGoogle, loginAsGuest, logout } from './firebase';
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
  const [activeTab, setActiveTab] = useState<'booking' | 'history' | 'allHistory'>('booking');
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // Booking Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    department: '',
    customDepartment: '',
    topic: '',
    room: '',
    date: '',
    startTime: '',
    endTime: '',
    additionalRequests: '',
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
  const [hasAutoFilled, setHasAutoFilled] = useState(false);

  // Auth Effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (currentUser?.email) {
        setFormData(prev => ({ ...prev, email: currentUser.email || '' }));
      }
      if (!currentUser) {
        setHasAutoFilled(false);
        setFormData(prev => ({
          ...prev,
          name: '',
          email: '',
          department: '',
          customDepartment: '',
        }));
      }
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

  // Load Last Used Data from History
  useEffect(() => {
    if (!isAuthReady || !user || user.isAnonymous || isLoadingHistory || hasAutoFilled) return;

    const lastBooking = historyData.find(b => b.userId === user.uid);
    if (lastBooking) {
      let dept = lastBooking.department || '';
      let customDept = '';
      
      if (dept && !DEPARTMENTS.includes(dept)) {
        customDept = dept;
        dept = 'อื่นๆ (Other)';
      }

      setFormData(prev => ({
        ...prev,
        name: prev.name || lastBooking.name || '',
        email: prev.email || lastBooking.email || user.email || '',
        department: prev.department || dept,
        customDepartment: prev.customDepartment || customDept,
      }));
    }
    setHasAutoFilled(true);
  }, [historyData, isLoadingHistory, isAuthReady, user, hasAutoFilled]);

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

        // Query user's own feedback to check for expiration (avoids permission errors)
        const qFeedback = query(collection(db, 'feedback'), where('userId', '==', user.uid));
        const snapshotFeedback = await getDocs(qFeedback);
        const now = new Date();
        
        if (!snapshotFeedback.empty) {
          snapshotFeedback.forEach(async (docSnap) => {
            const data = docSnap.data();
            if (data.expiresAt && data.expiresAt.toDate() < now) {
              try {
                await deleteDoc(doc(db, 'feedback', docSnap.id));
                console.log(`Auto-deleted old feedback: ${docSnap.id}`);
              } catch (error) {
                console.error('Failed to auto-delete old feedback', error);
              }
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

    // Guest Restrictions
    if (user.isAnonymous) {
      // 1. Max 3 days in advance
      const maxDate = addDays(startOfDay(new Date()), 3);
      if (isAfter(bookingDate, maxDate)) {
        setIsSubmitting(false);
        Swal.fire({
          icon: 'warning',
          title: 'ข้อจำกัดสำหรับ Guest',
          text: 'บัญชี Guest สามารถจองล่วงหน้าได้ไม่เกิน 3 วัน กรุณาเข้าสู่ระบบด้วย Google เพื่อจองล่วงหน้าได้นานกว่านี้',
          confirmButtonColor: '#3b82f6'
        });
        return;
      }

      // 2. Max 2 hour duration
      const startIndex = TIME_SLOTS.indexOf(formData.startTime);
      const endIndex = TIME_SLOTS.indexOf(formData.endTime);
      const durationSlots = endIndex - startIndex;
      if (durationSlots > 4) { // 4 slots = 120 mins (each slot is 30 mins)
        setIsSubmitting(false);
        Swal.fire({
          icon: 'warning',
          title: 'ข้อจำกัดสำหรับ Guest',
          text: 'บัญชี Guest สามารถจองได้สูงสุด 2 ชั่วโมงต่อครั้ง กรุณาเข้าสู่ระบบด้วย Google เพื่อจองได้นานกว่านี้',
          confirmButtonColor: '#3b82f6'
        });
        return;
      }
    }

    const expiresAtDate = addDays(bookingDate, 365); // Keep history for 1 year

    const payload = {
      userId: user.uid,
      name: formData.name,
      email: formData.email,
      department: formData.department === 'อื่นๆ (Other)' ? formData.customDepartment : formData.department,
      topic: formData.topic,
      room: formData.room,
      date: formData.date,
      startTime: formData.startTime,
      endTime: formData.endTime,
      additionalRequests: formData.additionalRequests,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAtDate),
    };

    try {
      const docRef = await addDoc(collection(db, 'bookings'), payload);
      setSuccessData({ ...payload, id: docRef.id });

      // Send Email Notification via EmailJS
      if (formData.email && import.meta.env.VITE_EMAILJS_SERVICE_ID && import.meta.env.VITE_EMAILJS_TEMPLATE_ID && import.meta.env.VITE_EMAILJS_PUBLIC_KEY) {
        try {
          const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY.replace(/['"]/g, '').trim(); // Remove any accidental quotes or spaces
          console.log("Using Public Key length:", publicKey.length);
          
          await emailjs.send(
            import.meta.env.VITE_EMAILJS_SERVICE_ID.replace(/['"]/g, '').trim(),
            import.meta.env.VITE_EMAILJS_TEMPLATE_ID.replace(/['"]/g, '').trim(),
            {
              to_email: formData.email,
              to_name: formData.name,
              room: formData.room,
              topic: formData.topic,
              date: format(bookingDate, 'd MMMM yyyy', { locale: th }),
              start_time: formData.startTime,
              end_time: formData.endTime,
              department: payload.department,
            },
            {
              publicKey: publicKey,
            }
          );
          console.log("Email notification sent successfully");
        } catch (emailError) {
          console.error("Failed to send email notification:", emailError);
        }
      }

      setFormData(prev => ({
        ...prev,
        name: '',
        department: '',
        customDepartment: '',
        topic: '',
        room: '',
        date: minDate,
        startTime: '',
        endTime: '',
        additionalRequests: '',
      }));

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
        expiresAt: Timestamp.fromDate(addDays(new Date(), 365))
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'feedback');
      console.error('Failed to submit rating:', error);
    }
  };

  const showGuestRestrictions = () => {
    Swal.fire({
      title: 'ข้อจำกัดสำหรับบัญชี Guest',
      html: `
        <div class="text-left space-y-4 py-2">
          <div class="flex items-start gap-3">
            <div class="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
            <div>
              <p class="font-bold text-slate-800">จองล่วงหน้าได้จำกัด</p>
              <p class="text-sm text-slate-600">สามารถจองล่วงหน้าได้ไม่เกิน 3 วันเท่านั้น</p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <div class="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
            <div>
              <p class="font-bold text-slate-800">จำกัดระยะเวลาการประชุม</p>
              <p class="text-sm text-slate-600">จองได้สูงสุด 2 ชั่วโมง (120 นาที) ต่อครั้ง</p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <div class="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
            <div>
              <p class="font-bold text-slate-800">ต้องกรอกข้อมูลใหม่ทุกครั้ง</p>
              <p class="text-sm text-slate-600">ระบบจะไม่จดจำชื่อ อีเมล และแผนกของคุณสำหรับการจองครั้งต่อไป</p>
            </div>
          </div>
          <div class="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
            <p class="text-sm text-blue-700 leading-relaxed">
              <strong>💡 คำแนะนำ:</strong> เข้าสู่ระบบด้วยบัญชี Google เพื่อปลดล็อกข้อจำกัดทั้งหมด, จัดการประวัติการจองได้สะดวกยิ่งขึ้น และระบบจะช่วยจดจำข้อมูลส่วนตัวของคุณให้โดยอัตโนมัติ
            </p>
          </div>
        </div>
      `,
      confirmButtonText: 'ตกลง',
      confirmButtonColor: '#3b82f6',
      customClass: {
        container: 'font-sans'
      }
    });
  };

  const showBookingDetails = (booking: any) => {
    const isPast = new Date(`${booking.date}T${booking.endTime}`) < new Date();
    
    Swal.fire({
      title: 'รายละเอียดการจอง',
      html: `
        <div class="text-left space-y-4 py-2">
          <div class="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <h3 class="font-bold text-lg text-slate-800 mb-1">${booking.topic}</h3>
            <div class="flex items-center gap-2 text-sm text-slate-500">
              <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">${booking.room}</span>
              ${isPast ? '<span class="bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-medium">เสร็จสิ้นแล้ว</span>' : '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">กำลังจะมาถึง</span>'}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-1">
              <p class="text-xs text-slate-400 uppercase font-bold tracking-wider">วันที่</p>
              <p class="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <i class="lucide-calendar w-4 h-4 text-blue-500"></i>
                ${format(new Date(`${booking.date}T${booking.startTime}`), 'd MMMM yyyy', { locale: th })}
              </p>
            </div>
            <div class="space-y-1">
              <p class="text-xs text-slate-400 uppercase font-bold tracking-wider">เวลา</p>
              <p class="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <i class="lucide-clock w-4 h-4 text-blue-500"></i>
                ${booking.startTime} - ${booking.endTime} น.
              </p>
            </div>
          </div>

          <div class="space-y-3 pt-2">
            ${booking.additionalRequests ? `
            <div class="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
              <div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                <i class="lucide-info w-5 h-5"></i>
              </div>
              <div>
                <p class="text-xs text-amber-600 font-medium">อุปกรณ์เสริม / อาหารว่าง</p>
                <p class="text-sm font-bold text-amber-900">${booking.additionalRequests}</p>
              </div>
            </div>
            ` : ''}
            <div class="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-lg">
              <div class="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
                <i class="lucide-user w-5 h-5"></i>
              </div>
              <div>
                <p class="text-xs text-slate-400 font-medium">ผู้จอง</p>
                <p class="text-sm font-bold text-slate-800">${booking.name}</p>
              </div>
            </div>
            <div class="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-lg">
              <div class="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500">
                <i class="lucide-building w-5 h-5"></i>
              </div>
              <div>
                <p class="text-xs text-slate-400 font-medium">แผนก</p>
                <p class="text-sm font-bold text-slate-800">${booking.department}</p>
              </div>
            </div>
          </div>

          ${booking.createdAt ? `
            <div class="pt-2 text-center">
              <p class="text-[10px] text-slate-400">ทำการจองเมื่อ: ${format(booking.createdAt.toDate(), 'd MMM yyyy HH:mm', { locale: th })} น.</p>
            </div>
          ` : ''}
        </div>
      `,
      confirmButtonText: 'ปิด',
      confirmButtonColor: '#3b82f6',
      showCancelButton: booking.userId === user.uid && !isPast,
      cancelButtonText: 'ยกเลิกการจองนี้',
      cancelButtonColor: '#ef4444',
      customClass: {
        container: 'font-sans'
      }
    }).then((result) => {
      if (result.dismiss === Swal.DismissReason.cancel) {
        handleCancelBooking(booking.id);
      }
    });
  };

  const handleCancelBooking = async (bookingId: string) => {
    const result = await Swal.fire({
      title: 'ยืนยันการยกเลิก?',
      text: "คุณต้องการยกเลิกการจองห้องประชุมนี้ใช่หรือไม่?",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'ใช่, ยกเลิกเลย',
      cancelButtonText: 'ไม่ยกเลิก'
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'bookings', bookingId));
        Swal.fire({
          icon: 'success',
          title: 'ยกเลิกสำเร็จ',
          text: 'การจองของคุณถูกยกเลิกเรียบร้อยแล้ว',
          confirmButtonColor: '#3b82f6'
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'bookings');
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: 'ไม่สามารถยกเลิกการจองได้ กรุณาลองใหม่อีกครั้ง',
          confirmButtonColor: '#3b82f6'
        });
      }
    }
  };

  const filteredHistory = useMemo(() => {
    const now = new Date();
    return historyData
      .filter(item => {
        const matchesSearch = item.topic.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              item.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesRoom = filterRoom ? item.room === filterRoom : true;
        
        // Filter based on tab
        if (activeTab === 'history') {
          // Only show upcoming bookings (end time is in the future)
          const bookingEnd = new Date(`${item.date}T${item.endTime}`);
          return matchesSearch && matchesRoom && bookingEnd > now;
        }
        
        // For allHistory, show everything
        return matchesSearch && matchesRoom;
      })
      .sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.startTime}`).getTime();
        const dateB = new Date(`${b.date}T${b.startTime}`).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      });
  }, [historyData, searchQuery, filterRoom, sortOrder, activeTab]);

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
          <p className="text-slate-600 mb-8">กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ</p>
          
          <div className="space-y-3">
            <button
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl transition-colors"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              เข้าสู่ระบบด้วย Google
            </button>
            
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink-0 mx-4 text-slate-400 text-sm">หรือ</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            <button
              onClick={loginAsGuest}
              className="w-full flex items-center justify-center gap-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 px-4 rounded-xl transition-colors"
            >
              เข้าใช้งานแบบไม่ระบุตัวตน (Guest)
            </button>

            <button 
              onClick={showGuestRestrictions}
              className="mt-2 text-xs text-amber-600 hover:text-amber-700 flex items-center justify-center gap-1 mx-auto transition-colors"
            >
              <Info className="w-3 h-3" /> ดูข้อจำกัดของบัญชี Guest
            </button>
          </div>
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
              รายการจองปัจจุบัน
            </button>
            <button
              onClick={() => setActiveTab('allHistory')}
              className={`flex-1 py-4 text-center font-medium text-sm sm:text-base transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'allHistory' 
                  ? 'bg-white text-blue-600 border-b-2 border-blue-600' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              ประวัติทั้งหมด
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
                        maxLength={100}
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
              {/* Policy Banner */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-amber-800">
                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold mb-1">นโยบายระดับองค์กร</p>
                  <p>ทุกการประชุมที่ใช้เวลาเกิน 30 นาที จะต้องทำการจองผ่านระบบล่วงหน้าอย่างน้อย 2 ชั่วโมง</p>
                </div>
              </div>

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
                      maxLength={30}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น สมชาย ใจดี"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">อีเมล (สำหรับรับการแจ้งเตือน)</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      maxLength={30}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น somchai@example.com"
                    />
                  </div>

                  <div className="md:col-span-2">
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
                      maxLength={30}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น ฝ่ายออกแบบ, R&D"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Section: Meeting Details */}
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                    <Building className="w-5 h-5 text-blue-500" />
                    รายละเอียดการประชุม
                  </h2>
                  {user.isAnonymous && (
                    <button 
                      onClick={showGuestRestrictions}
                      className="text-[10px] sm:text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-100 flex items-center gap-1 hover:bg-amber-100 transition-colors cursor-help"
                    >
                      <Info className="w-3 h-3" /> บัญชี Guest มีข้อจำกัดการจอง (คลิกเพื่อดู)
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">หัวข้อการประชุม *</label>
                    <input
                      type="text"
                      name="topic"
                      value={formData.topic}
                      onChange={handleInputChange}
                      maxLength={100}
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

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">อุปกรณ์เสริม / อาหารว่าง (ถ้ามี)</label>
                    <input
                      type="text"
                      name="additionalRequests"
                      value={formData.additionalRequests}
                      onChange={handleInputChange}
                      maxLength={100}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-slate-50 focus:bg-white"
                      placeholder="เช่น โปรเจคเตอร์, สายแปลงสัญญาณ, กาแฟ 3 ที่"
                    />
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
          {(activeTab === 'history' || activeTab === 'allHistory') && (
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
                    maxLength={100}
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

              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">
                  {activeTab === 'history' ? 'รายการจองปัจจุบัน' : 'ประวัติการประชุมทั้งหมด'}
                </h2>
                <div className="text-sm text-slate-500">
                  พบ {filteredHistory.length} รายการ
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
                  <p>{activeTab === 'history' ? 'ไม่มีรายการจองที่กำลังจะถึง' : 'ไม่พบประวัติการจอง'}</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {filteredHistory.map((booking, idx) => {
                    const isPast = new Date(`${booking.date}T${booking.endTime}`) < new Date();
                    return (
                      <div 
                        key={idx} 
                        onClick={() => showBookingDetails(booking)}
                        className={`bg-white border border-slate-100 p-5 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden ${isPast ? 'opacity-75 bg-slate-50/50' : ''}`}
                      >
                        <div className="absolute top-0 right-0 w-1 h-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-lg font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">{booking.topic}</h3>
                              {isPast && (
                                <span className="text-[10px] uppercase tracking-wider bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                                  เสร็จสิ้นแล้ว
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-600 mb-3 flex-wrap">
                              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-md font-medium">
                                <MapPin className="w-3.5 h-3.5" /> {booking.room}
                              </span>
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <User className="w-3.5 h-3.5" /> {booking.name} ({booking.department})
                              </span>
                              {booking.additionalRequests && (
                                <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-md font-medium text-xs">
                                  <Info className="w-3.5 h-3.5" /> มีคำขอพิเศษ
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                              <Info className="w-3 h-3" /> คลิกเพื่อดูรายละเอียดทั้งหมด
                            </div>
                          </div>
                          <div className="text-left sm:text-right bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between" onClick={(e) => e.stopPropagation()}>
                            <div>
                              <div className="text-sm font-medium text-slate-800 flex items-center sm:justify-end gap-1.5 mb-1">
                                <Calendar className="w-4 h-4 text-blue-500" />
                                {format(new Date(`${booking.date}T${booking.startTime}`), 'd MMMM yyyy', { locale: th })}
                              </div>
                              <div className="text-sm text-slate-600 flex items-center sm:justify-end gap-1.5">
                                <Clock className="w-4 h-4 text-blue-500" />
                                {booking.startTime} - {booking.endTime} น.
                              </div>
                            </div>
                            
                            {booking.userId === user.uid && !isPast && (
                              <button
                                onClick={() => handleCancelBooking(booking.id)}
                                className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 py-1.5 px-3 rounded-lg border border-red-100 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                ยกเลิกการจอง
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
