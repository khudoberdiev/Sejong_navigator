<!-- AI-generated — to be rewritten by me -->
# Search evaluation

Model: `intfloat/multilingual-e5-small`, 45 questions (eval/questions.py), 339 menu items (data/menu_map.json, data `877f1aa26764ade4`). Regenerate with `.venv/bin/python -m eval.run_eval`.

| Setup | uz top-1 | uz top-3 | en top-1 | en top-3 | ko top-1 | ko top-3 | all top-1 | all top-3 |
|---|---|---|---|---|---|---|---|---|
| lexical only (w=0) | 8/13 (62%) | 8/13 (62%) | 12/18 (67%) | 15/18 (83%) | 9/14 (64%) | 10/14 (71%) | 29/45 (64%) | 33/45 (73%) |
| semantic only (w=1) | 2/13 (15%) | 3/13 (23%) | 9/18 (50%) | 12/18 (67%) | 8/14 (57%) | 9/14 (64%) | 19/45 (42%) | 24/45 (53%) |
| hybrid (w=0.5) | 4/13 (31%) | 8/13 (62%) | 14/18 (78%) | 15/18 (83%) | 10/14 (71%) | 11/14 (79%) | 28/45 (62%) | 34/45 (76%) |

## Weight sweep (all languages)

| w | top-1 | top-3 |
|---|---|---|
| 0.0 | 29/45 (64%) | 33/45 (73%) |
| 0.3 | 28/45 (62%) | 35/45 (78%) |
| 0.5 | 28/45 (62%) | 34/45 (76%) |
| 0.6 | 27/45 (60%) | 32/45 (71%) |
| 0.7 | 24/45 (53%) | 31/45 (69%) |
| 0.8 | 23/45 (51%) | 29/45 (64%) |
| 0.9 | 20/45 (44%) | 27/45 (60%) |
| 1.0 | 19/45 (42%) | 24/45 (53%) |

## Hybrid top-1 failures (w=0.5)

| lang | question | expected | got (top 3) | note |
|---|---|---|---|---|
| uz | baholarimni qayerdan ko'rsam bo'ladi | `sjpt.current_semester_grades` | `library.my_taste`, `ecampus.user_tab_my`, `ecampus.my_courses` | suffix -ni |
| uz | imtihon natijalarim | `sjpt.current_semester_grades` | `ecampus.tosc_exam_result`, `library.my_usage`, `library.my_taste` | no shared words |
| uz | kutubxonadan olgan kitoblarim | `library.my_loans` | `library.summary_loans`, `library.my_shelf`, `library.my_loans` | suffixes |
| uz | uy vazifasini qayerga yuklayman | `ecampus.my_courses` | `library.my_facility`, `sjpt.application_management`, `ecampus.my_courses` | suffix -ni |
| uz | dars jadavli | `sjpt.registered_courses_inquiry_print` | `sjpt.class_timetable_syllabus_inquiry`, `portal.sjpt`, `sjpt.credit_forfeit_history` | typo |
| uz | o'qituvchini baholash so'rovnomasi | `sjpt.course_evaluation` | `sjpt.teacher_training_course_application`, `library.comm_qna`, `ecampus.guides_qna` | suffix -si |
| uz | oldingi semestrlardagi barcha baholarim | `sjpt.completed_grades_inquiry` | `ecampus.dashboard_all_courses_btn`, `sjpt.current_semester_grades`, `ecampus.user_tab_previous_course` | suffixes, close to grade_current |
| uz | kutubxonada o'qish uchun xona band qilmoqchiman | `library.studyroom_booking` | `sjpt.facility_use_application`, `library.comm_notice`, `library.studyroom_booking` | long sentence |
| en | how do I renew a libary book | `library.my_loans` | `library.quick_loans`, `library.my_loans`, `library.fac_tour` | typo |
| en | submit homework | `ecampus.my_courses` | `library.thesis_submit`, `sjpt.tuition_installment_application`, `library.sub_quick_purchase` | short |
| en | my weekly class schedule | `sjpt.registered_courses_inquiry_print` | `sjpt.class_timetable_syllabus_inquiry`, `portal.academic_calendar`, `ecampus.user_upcoming_event` |  |
| en | where can I watch recorded lectures | `ecampus.my_courses` | `ecampus.open_course`, `portal.course_guide`, `library.thesis_dcollection` | few shared words |
| ko | 빌린 책 반납 기한 | `library.my_loans` | `library.use_return`, `library.guide_storage`, `sjpt.payment_bill_print` | few shared words |
| ko | 과제 제출하는 곳 | `ecampus.my_courses` | `ecampus.user_edit_profile`, `ecampus.guides`, `ecampus.user_tab_notifications` | verb ending -하는 |
| ko | 수강 신청 내역 | `sjpt.registered_courses_inquiry_print` | `sjpt.course_registration`, `portal.course_guide`, `ecampus.user_participating_courses` | spacing differs from keywords |
| ko | 장학금 받으려면 | `sjpt.scholarship_registration_student_support` | `portal.scholarships`, `sjpt.scholarship_registration_student_support`, `sjpt.regular_semester_scholarship_application` | verb ending |
| uz | xona band qilish | `library.studyroom_booking` | `sjpt.facility_use_application`, `library.svc_facilities`, `library.studyroom_booking` |  |

## Answer cards (data/answers.json)

6/6 questions get the expected card (or correctly none). Not search: these are matched by core/answers.py.

| lang | question | expected card | got |
|---|---|---|---|
| en | seat reservation | seat_booking | seat_booking |
| en | book a seat | seat_booking | seat_booking |
| ko | 좌석 예약 | seat_booking | seat_booking |
| uz | joy band qilish | seat_booking | seat_booking |
| en | book a room | (none) | (none) |
| en | free seats | (none) | (none) |

## Calendar answers (data/calendar.json, today = 2026-11-21)

First row of the calendar card, or no card. Not search: core/calendar.py.

| Setup | right | of |
|---|---|---|
| lexical only (w=0) | 15 | 15 |
| semantic only (w=1) | 14 | 15 |
| hybrid (w=0.5) | 15 | 15 |

Hybrid failures: 0

## Fine-tuning

> **Stale:** these fine-tuning numbers were measured on a different menu map or question set than the tables above (e.g. the old 19-item example data). Re-run `.venv/bin/python -m ml.finetune` to refresh them.

Base `intfloat/multilingual-e5-small` → `models/e5-small-sejong`; synthetic pairs (templates × names/keywords); 1663 training / 118 held-out pairs; 3 epochs, lr 2e-05, temperature 0.05, 83s on cpu. Dropped 3 training questions that were near-copies of eval/questions.py.

Leakage check (all must be 0): {'shared_queries': 0, 'shared_terms': 0, 'shared_templates': 0, 'near_duplicates_of_protected': 0}

| Model | held-out top-1 | held-out top-3 | eval-30 semantic top-1 | eval-30 semantic top-3 | eval-30 hybrid (w=0.5) top-1 | eval-30 hybrid top-3 |
|---|---|---|---|---|---|---|
| baseline | 84/118 (71%) | 104/118 (88%) | 18/30 (60%) | 25/30 (83%) | 24/30 (80%) | 28/30 (93%) |
| fine-tuned | 102/118 (86%) | 117/118 (99%) | 27/30 (90%) | 29/30 (97%) | 28/30 (93%) | 30/30 (100%) |

Per language, top-1 (held-out · eval-30 semantic · eval-30 hybrid):

| Model | uz | en | ko |
|---|---|---|---|
| baseline | 33/48 (69%) · 4/10 (40%) · 7/10 (70%) | 35/48 (73%) · 6/10 (60%) · 7/10 (70%) | 16/22 (73%) · 8/10 (80%) · 10/10 (100%) |
| fine-tuned | 43/48 (90%) · 8/10 (80%) · 8/10 (80%) | 42/48 (88%) · 9/10 (90%) · 10/10 (100%) | 17/22 (77%) · 10/10 (100%) · 10/10 (100%) |
