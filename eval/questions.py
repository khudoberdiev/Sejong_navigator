# AI-generated — to be rewritten by me
"""Evaluation questions: (language, question, expected item id, what makes it hard).

These were written BEFORE any tuning. Keep them that way: when you change the
search, add new questions instead of editing these to pass.
"""

QUESTIONS = [
    # ---------------------------------------------------------------- Uzbek
    ("uz", "baholarim qayerda?", "sjpt.grade_current", "the headline case"),
    ("uz", "baholarimni qayerdan ko'rsam bo'ladi", "sjpt.grade_current", "suffix -ni"),
    ("uz", "imtihon natijalarim", "sjpt.grade_current", "no shared words"),
    ("uz", "kontrakt to'lovi kvitansiyasini chiqarish", "sjpt.tuition_bill", "suffix -sini"),
    ("uz", "kutubxonadan olgan kitoblarim", "library.loans", "suffixes"),
    ("uz", "uy vazifasini qayerga yuklayman", "ecampus.assignments", "suffix -ni"),
    ("uz", "dars jadavli", "sjpt.timetable", "typo"),
    ("uz", "o'qituvchini baholash so'rovnomasi", "sjpt.lecture_eval", "suffix -si"),
    ("uz", "oldingi semestrlardagi barcha baholarim", "sjpt.grade_history", "suffixes, close to grade_current"),
    ("uz", "kutubxonada o'qish uchun xona band qilmoqchiman", "library.room_booking", "long sentence"),
    # ---------------------------------------------------------------- English
    ("en", "where are my grades?", "sjpt.grade_current", "the headline case"),
    ("en", "grdaes", "sjpt.grade_current", "typo"),
    ("en", "how do I renew a libary book", "library.loans", "typo"),
    ("en", "submit homework", "ecampus.assignments", "short"),
    ("en", "print my tuition invoice", "sjpt.tuition_bill", ""),
    ("en", "my weekly class schedule", "sjpt.timetable", ""),
    ("en", "where can I watch recorded lectures", "ecampus.my_courses", "few shared words"),
    ("en", "official transcript of all my past semesters", "sjpt.grade_history", "close to grade_current"),
    ("en", "reserve a quiet place to study", "library.room_booking", "few shared words"),
    ("en", "change my phone number and address", "sjpt.student_record_view", "no shared words"),
    # ---------------------------------------------------------------- Korean
    ("ko", "성적조회", "sjpt.grade_current", "no spaces"),
    ("ko", "성적 조회", "sjpt.grade_current", "with spaces"),
    ("ko", "이번 학기 학점 확인", "sjpt.grade_current", ""),
    ("ko", "빌린 책 반납 기한", "library.loans", "few shared words"),
    ("ko", "과제 제출하는 곳", "ecampus.assignments", "verb ending -하는"),
    ("ko", "등록금 고지서 츨력", "sjpt.tuition_bill", "typo"),
    ("ko", "수강 신청 내역", "sjpt.timetable", "spacing differs from keywords"),
    ("ko", "교수님 평가하기", "sjpt.lecture_eval", "no exact shared words"),
    ("ko", "장학금 받으려면", "sjpt.tuition", "verb ending"),
    ("ko", "도서관 스터디룸 예약", "library.room_booking", ""),
]
