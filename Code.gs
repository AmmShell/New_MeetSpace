// --- CONFIGURATION ---
const APP_NAME = "Meeting Room Booking";

// [ตั้งค่าใหม่] กำหนด ID และชื่อ Tab ของ Google Sheet
const SPREADSHEET_ID = "1yYZeL8dMA_b5q0j8Dgl0UGdzQLF4C8BvCDsqbB5L0yU"; 
const SHEET_NAME = "Sheet1"; // ระบุชื่อ Tab ให้ตรงกับใน Sheet ของคุณ

// --- MAIN WEB APP ---
function doGet(e) {
  // [เพิ่มใหม่] รองรับการดึงข้อมูลประวัติการจองผ่าน API
  if (e && e.parameter && e.parameter.action === 'getHistory') {
    const output = ContentService.createTextOutput(JSON.stringify(getBookingHistory()));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }

  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// --- API FUNCTIONS ---

function getBookedSlots(dateStr, roomId) {
  // Simulate network delay for realism
  Utilities.sleep(400);

  // MOCK LOGIC: Room B is busy at 10:00-11:00 and 13:00-14:00
  if (roomId === 'Room B') {
    return ['10:00', '10:30', '13:00', '13:30'];
  }
  
  // MOCK LOGIC: Room A is busy at 09:00
  if (roomId === 'Room A') {
    return ['09:00', '09:30'];
  }

  return [];
}

function processBooking(data) {
  Logger.log('Booking received: ' + JSON.stringify(data));

  // 1. ตรวจสอบเวลาว่าง (ของเดิม)
  const bookedSlots = getBookedSlots(data.date, data.room);
  if (bookedSlots.includes(data.startTime)) {
    return { 
      success: false, 
      message: `Calendar conflict: ${data.room} is already booked on ${data.date} at ${data.startTime}. Please select another time.` 
    };
  }

  // ==========================================
  // [เพิ่มใหม่] 1.5 บันทึกข้อมูลลง Google Sheet
  // ==========================================
  let actualRowIndex = 0; // ตัวแปรสำหรับเก็บหมายเลขแถวที่ถูกบันทึก
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      return { 
        success: false, 
        message: `Google Sheet Error: Sheet "${SHEET_NAME}" not found in the specified spreadsheet.` 
      };
    }
    
    // จัดเรียงข้อมูลให้ตรงกับคอลัมน์ที่ตั้งไว้
    const rowData = [
      new Date(),       // Timestamp (เวลาที่กดจอง)
      data.name,        // ชื่อ
      data.nickname,    // ชื่อเล่น
      data.department,  // แผนก
      data.topic,       // หัวข้อ
      data.room,        // ห้อง
      data.date,        // วันที่
      data.startTime,   // เวลาเริ่ม
      data.endTime      // เวลาสิ้นสุด
    ];
    
    sheet.appendRow(rowData);
    actualRowIndex = sheet.getLastRow(); // ดึงหมายเลขแถวล่าสุดที่เพิ่งเพิ่มเข้าไป
    Logger.log("บันทึกข้อมูลลง Sheet สำเร็จ ที่แถว: " + actualRowIndex);
  } catch (e) {
    Logger.log("Google Sheet Error: " + e.toString());
    return { 
      success: false, 
      message: `Google Sheet Error: Failed to write booking data. Details: ${e.toString()}` 
    };
  }

  // ==========================================
  // 2. สร้างไฟล์สรุปการจองลงใน Google Drive (ของเดิม)
  // ==========================================
  try {
    const folderId = "1z30e5SgPzui8h9fsbqFqIrwivMxWI00R";
    const driveFolder = DriveApp.getFolderById(folderId);
    
    const summaryText = `--- รายงานการจองห้องประชุม ---\n` +
                        `ผู้จอง: ${data.name}\n` +
                        `ห้องประชุม: ${data.room}\n` +
                        `หัวข้อ: ${data.topic}\n` +
                        `วันที่: ${data.date}\n` +
                        `เวลา: ${data.startTime} - ${data.endTime}\n` +
                        `LINE ID: ${data.lineId || 'ไม่ระบุ'}`;
                        
    const fileName = `Booking_${data.name}_${data.date}.txt`;
    driveFolder.createFile(fileName, summaryText);
    Logger.log("บันทึกไฟล์ลง Drive สำเร็จ");
  } catch (e) {
    Logger.log("Drive Error: " + e.toString());
  }

  // ==========================================
  // 3. ส่งแจ้งเตือนไปยังผู้ใช้ผ่าน LINE Webhook (ngrok) (ของเดิม)
  // ==========================================
  if (data.lineId) {
    try {
      const webhookUrl = "https://1433-110-164-182-98.ap.ngrok.io/Mybot/bot.php";
      const payload = {
        "channelId": "1657923451",
        "lineId": data.lineId,
        "message": `ยืนยันการจองห้องประชุม!\nคุณ ${data.name} ได้จอง ${data.room}\nเรื่อง: ${data.topic}\nเวลา: ${data.date} (${data.startTime}-${data.endTime})`
      };
      const options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      };
      UrlFetchApp.fetch(webhookUrl, options);
      Logger.log("ส่ง Webhook ไปยัง LINE สำเร็จ");
    } catch (e) {
      Logger.log("LINE Webhook Error: " + e.toString());
    }
  }

  // 4. Mocking Google Calendar Event URL Generation (ของเดิม)
  const dateFormatted = data.date.replace(/-/g, '');
  const startFormatted = data.startTime.replace(/:/g, '') + '00';
  const endFormatted = data.endTime.replace(/:/g, '') + '00';
  const mockEventUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(data.topic)}&dates=${dateFormatted}T${startFormatted}/${dateFormatted}T${endFormatted}&details=${encodeURIComponent('Booked via ' + APP_NAME + ' by ' + data.name)}&location=${encodeURIComponent(data.room)}`;

  // ส่งผลลัพธ์กลับไปให้หน้าเว็บ พร้อมหมายเลขแถวจริงที่บันทึก
  return { 
    success: true, 
    rowIndex: actualRowIndex || Math.floor(Math.random() * 1000) + 2, // ถ้าบันทึก Sheet ไม่ได้ จะคืนค่าสุ่มเหมือนเดิม
    eventUrl: mockEventUrl 
  };
}

function updateRating(rowIndex, rating) {
  Logger.log('Updating rating for row ' + rowIndex + ' to ' + rating);
  
  // โค้ดสำหรับบันทึกคะแนนกลับไปที่ Sheet เดิม
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    // สมมติว่าคะแนนถูกเก็บไว้ที่คอลัมน์ที่ 10 (คอลัมน์ J)
    sheet.getRange(rowIndex, 10).setValue(rating);
  } catch (e) {
    Logger.log("Rating Update Error: " + e.toString());
  }
  
  return { success: true };
}

// ==========================================
// [เพิ่มใหม่] API & History Functions
// ==========================================

function getBookingHistory() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) return { success: false, message: "Sheet not found" };
    
    const data = sheet.getDataRange().getValues();
    const bookings = [];
    
    // ข้ามแถวหัวตาราง (เริ่มที่ i = 1)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      
      bookings.push({
        timestamp: row[0] instanceof Date ? row[0].toISOString() : row[0],
        name: row[1],
        nickname: row[2],
        department: row[3],
        topic: row[4],
        room: row[5],
        date: row[6] instanceof Date ? row[6].toISOString().split('T')[0] : row[6],
        startTime: row[7] instanceof Date ? row[7].toTimeString().slice(0,5) : row[7],
        endTime: row[8] instanceof Date ? row[8].toTimeString().slice(0,5) : row[8],
      });
    }
    
    return { success: true, data: bookings.reverse() };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// [เพิ่มใหม่] รองรับการส่งข้อมูลจาก React App (ภายนอก)
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const result = processBooking(data);
    const output = ContentService.createTextOutput(JSON.stringify(result));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  } catch (error) {
    const output = ContentService.createTextOutput(JSON.stringify({ success: false, message: error.toString() }));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

function doOptions(e) {
  return HtmlService.createHtmlOutput("")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}