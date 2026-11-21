# AI-generated — to be rewritten by me
"""Evaluation questions: (language, question, expected item id, what makes it hard).

These were written BEFORE any tuning. Keep them that way: when you change the
search, add new questions instead of editing these to pass.

2026-11-20: the questions were written for the 19-item EXAMPLE menu map. When the real
recorded data (data/raw/*.json) replaced it, only the expected ids changed, never the
question text. The mapping was fixed before the new results were seen:
  sjpt.grade_current       -> sjpt.current_semester_grades           (same page, 당학기성적조회)
  sjpt.grade_history       -> sjpt.completed_grades_inquiry          (same page, 기이수성적조회)
  sjpt.lecture_eval        -> sjpt.course_evaluation                 (same page, 강의평가)
  sjpt.timetable           -> sjpt.registered_courses_inquiry_print  (your registered courses, 수강내역조회/출력)
  sjpt.tuition_bill        -> sjpt.registration_history_tuition_bill_print
                              (the undergraduate bill; sjpt.tuition_bill_print "등록금 고지서 출력"
                              is the Sejong Language Institute's)
  sjpt.student_record_view -> sjpt.personal_information_management   (contact details, 신상정보관리)
  sjpt.tuition             -> sjpt.scholarship_registration_student_support  (menu group -> menu group)
  library.loans            -> library.my_loans        (your loans and renewals, 대출/갱신현황)
  library.room_booking     -> library.fac_studyroom   (study room info and booking)
  ecampus.assignments      -> ecampus.my_courses  (assignments live inside each course;
                              the course dashboard is the deepest mapped page)

2026-11-21 (Problem N), fixed before the new results were seen:
  library.room_booking     -> library.studyroom_booking  (was library.fac_studyroom; the original
                              id said BOOKING, and the study room is booked with the GO button on
                              library home, which is now in the data; the info page is the rules)
  The four Problem M seat questions ("seat reservation", ...) expected library.seat_status_more.
  That link only SHOWS free seats: reading-room seats are issued at the kiosks and cannot be
  booked online. They moved to ANSWER_QUESTIONS: the right answer is the kiosk answer card
  (data/answers.json), not a menu item.
"""

QUESTIONS = [
    # ---------------------------------------------------------------- Uzbek
    ("uz", "baholarim qayerda?", "sjpt.current_semester_grades", "the headline case"),
    ("uz", "baholarimni qayerdan ko'rsam bo'ladi", "sjpt.current_semester_grades", "suffix -ni"),
    ("uz", "imtihon natijalarim", "sjpt.current_semester_grades", "no shared words"),
    ("uz", "kontrakt to'lovi kvitansiyasini chiqarish", "sjpt.registration_history_tuition_bill_print", "suffix -sini"),
    ("uz", "kutubxonadan olgan kitoblarim", "library.my_loans", "suffixes"),
    ("uz", "uy vazifasini qayerga yuklayman", "ecampus.my_courses", "suffix -ni"),
    ("uz", "dars jadavli", "sjpt.registered_courses_inquiry_print", "typo"),
    ("uz", "o'qituvchini baholash so'rovnomasi", "sjpt.course_evaluation", "suffix -si"),
    ("uz", "oldingi semestrlardagi barcha baholarim", "sjpt.completed_grades_inquiry", "suffixes, close to grade_current"),
    ("uz", "kutubxonada o'qish uchun xona band qilmoqchiman", "library.studyroom_booking", "long sentence"),
    # ---------------------------------------------------------------- English
    ("en", "where are my grades?", "sjpt.current_semester_grades", "the headline case"),
    ("en", "grdaes", "sjpt.current_semester_grades", "typo"),
    ("en", "how do I renew a libary book", "library.my_loans", "typo"),
    ("en", "submit homework", "ecampus.my_courses", "short"),
    ("en", "print my tuition invoice", "sjpt.registration_history_tuition_bill_print", ""),
    ("en", "my weekly class schedule", "sjpt.registered_courses_inquiry_print", ""),
    ("en", "where can I watch recorded lectures", "ecampus.my_courses", "few shared words"),
    ("en", "official transcript of all my past semesters", "sjpt.completed_grades_inquiry", "close to grade_current"),
    ("en", "reserve a quiet place to study", "library.studyroom_booking", "few shared words"),
    ("en", "change my phone number and address", "sjpt.personal_information_management", "no shared words"),
    # ---------------------------------------------------------------- Korean
    ("ko", "성적조회", "sjpt.current_semester_grades", "no spaces"),
    ("ko", "성적 조회", "sjpt.current_semester_grades", "with spaces"),
    ("ko", "이번 학기 학점 확인", "sjpt.current_semester_grades", ""),
    ("ko", "빌린 책 반납 기한", "library.my_loans", "few shared words"),
    ("ko", "과제 제출하는 곳", "ecampus.my_courses", "verb ending -하는"),
    ("ko", "등록금 고지서 츨력", "sjpt.registration_history_tuition_bill_print", "typo"),
    ("ko", "수강 신청 내역", "sjpt.registered_courses_inquiry_print", "spacing differs from keywords"),
    ("ko", "교수님 평가하기", "sjpt.course_evaluation", "no exact shared words"),
    ("ko", "장학금 받으려면", "sjpt.scholarship_registration_student_support", "verb ending"),
    ("ko", "도서관 스터디룸 예약", "library.studyroom_booking", ""),
    # ---------------------------------------------------------------- added 2026-11-21 (Problem M)
    # Intent over labels: the real page, not a folder ("성적", "성적 및 강의평가"), not the
    # Sejong Language Institute's "Grade", not an entry link (portal.library).
    ("en", "grades", "sjpt.current_semester_grades", "folders and the Language Institute's 'Grade' compete"),
    ("en", "my grades", "sjpt.current_semester_grades", ""),
    ("uz", "baholarim", "sjpt.current_semester_grades", ""),
    ("ko", "성적", "sjpt.current_semester_grades", "exact name of two folders"),
    # ---------------------------------------------------------------- added 2026-11-21 (Problem N)
    # Online booking: the GO / ↗ buttons on library home (libseat), not the info pages.
    ("en", "book a room", "library.studyroom_booking", "sjpt facility booking competes"),
    ("en", "study room", "library.studyroom_booking", "info page 스터디룸 안내 및 예약 competes"),
    ("ko", "스터디룸 예약", "library.studyroom_booking", ""),
    ("uz", "xona band qilish", "library.studyroom_booking", ""),
    ("en", "cinema room", "library.cinemaroom_booking", ""),
    ("ko", "시네마룸", "library.cinemaroom_booking", ""),
    ("en", "S-Lounge", "library.slounge_booking", "info page S-Lounge 안내 및 예약 competes"),
    ("ko", "라운지 예약", "library.slounge_booking", ""),
    # ---------------------------------------------------------------- added 2026-11-21 (calendar follow-up)
    # Expected ids fixed before the new results were seen.
    ("en", "tuition", "sjpt.registration_history_tuition_bill_print", "the folder 장학/등록 및 학생지원 has the exact keyword"),
    ("en", "winter break", "sjpt.academic_schedule_inquiry", "계절학기 'winter session' competes; the calendar card answers it"),
    ("uz", "qishki ta'til", "sjpt.academic_schedule_inquiry", "no menu item names a break"),
]

# Questions whose answer is an answer card (data/answers.json), not a menu item:
# (language, question, expected answer id or None, note). Checked by eval/run_eval.py
# (core/answers.py) and tests/test_answers.py.
ANSWER_QUESTIONS = [
    # Reading-room seats are issued at the kiosks (1F, 3F, 4F): the card says so and offers
    # free seats, study room, cinema room and S-Lounge booking. (Problem M expected
    # library.seat_status_more for these four; see the docstring.)
    ("en", "seat reservation", "seat_booking", ""),
    ("en", "book a seat", "seat_booking", ""),
    ("ko", "좌석 예약", "seat_booking", ""),
    ("uz", "joy band qilish", "seat_booking", ""),
    # ...and booking a ROOM is not a seat question
    ("en", "book a room", None, "no card: the study room result answers it"),
    ("en", "free seats", None, "no card: seat_status_more answers it"),
]

# Academic-calendar questions (Problem H): (language, question, expected FIRST row of the
# calendar card, note), or None = no card. The answer depends on the date, so the eval fixes
# "today". Checked by eval/run_eval.py (core/calendar.py) and tests/test_calendar.py.
EVAL_TODAY = "2026-11-21"
CALENDAR_QUESTIONS = [
    ("en", "spring semester start date", "cal.2026_1.classes_start", "menu search said 계절학기 개설희망신청; past: no 2027 start yet"),
    ("en", "when does spring semester start", "cal.2026_1.classes_start", ""),
    ("en", "when does winter break start", "cal.2026_2.classes_end", "no break rows: the break starts after 종강일"),
    ("en", "final exams", "cal.2026_2.classes_end", "no exam rows: last day of classes + a note"),
    ("en", "course registration", "cal.2026_winter.course_reg_all", "no date word: strong title match; 전체학년, not the same-date 타교생 row"),
    ("en", "tuition", "cal.2026_2.tuition_bill_inst4", "bill printing periods only"),
    ("uz", "qishki ta'til qachon", "cal.2026_2.classes_end", ""),
    ("uz", "bahorgi semestr qachon boshlanadi", "cal.2026_1.classes_start", ""),
    ("uz", "kontrakt to'lovi qachon", "cal.2026_2.tuition_bill_inst4", ""),
    ("ko", "수강신청 언제", "cal.2026_winter.course_reg_all", "the next registration: winter session"),
    ("ko", "2학기 개강", "cal.2026_2.classes_start", "past"),
    ("ko", "휴학 신청 기간", "cal.2026_2.leave_apply", "past, newest first"),
    # not calendar questions: menu results only
    ("en", "where are my grades?", None, ""),
    ("en", "seat reservation", None, ""),
    ("uz", "baholarim qayerda?", None, ""),
]
