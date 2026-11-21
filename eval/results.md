<!-- AI-generated — to be rewritten by me -->
# Search evaluation

Model: `intfloat/multilingual-e5-small`, 30 questions (eval/questions.py), 339 menu items (data/menu_map.json, data `16c4a5fcb3e7f0e2`). Regenerate with `.venv/bin/python -m eval.run_eval`.

| Setup | uz top-1 | uz top-3 | en top-1 | en top-3 | ko top-1 | ko top-3 | all top-1 | all top-3 |
|---|---|---|---|---|---|---|---|---|
| lexical only (w=0) | 4/10 (40%) | 4/10 (40%) | 2/10 (20%) | 5/10 (50%) | 2/10 (20%) | 6/10 (60%) | 8/30 (27%) | 15/30 (50%) |
| semantic only (w=1) | 0/10 (0%) | 0/10 (0%) | 2/10 (20%) | 4/10 (40%) | 2/10 (20%) | 5/10 (50%) | 4/30 (13%) | 9/30 (30%) |
| hybrid (w=0.5) | 2/10 (20%) | 3/10 (30%) | 3/10 (30%) | 5/10 (50%) | 2/10 (20%) | 7/10 (70%) | 7/30 (23%) | 15/30 (50%) |

## Weight sweep (all languages)

| w | top-1 | top-3 |
|---|---|---|
| 0.0 | 8/30 (27%) | 15/30 (50%) |
| 0.3 | 7/30 (23%) | 16/30 (53%) |
| 0.5 | 7/30 (23%) | 15/30 (50%) |
| 0.6 | 6/30 (20%) | 14/30 (47%) |
| 0.7 | 4/30 (13%) | 12/30 (40%) |
| 0.8 | 4/30 (13%) | 10/30 (33%) |
| 0.9 | 5/30 (17%) | 10/30 (33%) |
| 1.0 | 4/30 (13%) | 9/30 (30%) |

## Hybrid top-1 failures (w=0.5)

| lang | question | expected | got (top 3) | note |
|---|---|---|---|---|
| uz | baholarimni qayerdan ko'rsam bo'ladi | `sjpt.current_semester_grades` | `library.my_taste`, `ecampus.user_tab_my`, `ecampus.my_courses` | suffix -ni |
| uz | imtihon natijalarim | `sjpt.current_semester_grades` | `ecampus.tosc_exam_result`, `library.my_usage`, `library.my_taste` | no shared words |
| uz | kutubxonadan olgan kitoblarim | `library.my_loans` | `library.summary_loans`, `library.my_shelf`, `library.my_loans` | suffixes |
| uz | uy vazifasini qayerga yuklayman | `ecampus.my_courses` | `sjpt.move_in_management`, `library.mylib`, `library.my_facility` | suffix -ni |
| uz | dars jadavli | `sjpt.registered_courses_inquiry_print` | `sjpt.class_timetable_syllabus_inquiry`, `portal.sjpt`, `sjpt.class_grade` | typo |
| uz | o'qituvchini baholash so'rovnomasi | `sjpt.course_evaluation` | `sjpt.teacher_training_course_application`, `portal.quick_academic`, `library.comm_qna` | suffix -si |
| uz | oldingi semestrlardagi barcha baholarim | `sjpt.completed_grades_inquiry` | `ecampus.dashboard_all_courses_btn`, `sjpt.current_semester_grades`, `ecampus.user_tab_previous_course` | suffixes, close to grade_current |
| uz | kutubxonada o'qish uchun xona band qilmoqchiman | `library.fac_studyroom` | `portal.quick_library`, `sjpt.facility_use_application`, `portal.library` | long sentence |
| en | grdaes | `sjpt.current_semester_grades` | `portal.sjpt`, `sjpt.grades`, `sjpt.grades_course_evaluation` | typo |
| en | how do I renew a libary book | `library.my_loans` | `library.quick_loans`, `library.my_loans`, `library.fac_tour` | typo |
| en | submit homework | `ecampus.my_courses` | `library.thesis_submit`, `sjpt.tuition_installment_application`, `library.sub_quick_purchase` | short |
| en | print my tuition invoice | `sjpt.registration_history_tuition_bill_print` | `sjpt.tuition_bill_print`, `sjpt.registration_history_tuition_bill_print`, `sjpt.scholarship_history_bill_print` |  |
| en | my weekly class schedule | `sjpt.registered_courses_inquiry_print` | `sjpt.class_timetable_syllabus_inquiry`, `portal.academic_calendar`, `portal.class_info` |  |
| en | where can I watch recorded lectures | `ecampus.my_courses` | `ecampus.open_course`, `portal.class_info`, `portal.ecampus` | few shared words |
| en | reserve a quiet place to study | `library.fac_studyroom` | `portal.library`, `library.libseat_seat_map_popup`, `sjpt.facility_use_application` | few shared words |
| ko | 성적조회 | `sjpt.current_semester_grades` | `sjpt.grade_inquiry`, `sjpt.current_semester_grades`, `ecampus.degree_grade_check` | no spaces |
| ko | 성적 조회 | `sjpt.current_semester_grades` | `ecampus.degree_grade_check`, `sjpt.grade_inquiry`, `sjpt.current_semester_grades` | with spaces |
| ko | 빌린 책 반납 기한 | `library.my_loans` | `library.use_return`, `library.guide_storage`, `sjpt.payment_bill_print` | few shared words |
| ko | 과제 제출하는 곳 | `ecampus.my_courses` | `ecampus.user_edit_profile`, `portal.ecampus`, `ecampus.guides` | verb ending -하는 |
| ko | 등록금 고지서 츨력 | `sjpt.registration_history_tuition_bill_print` | `sjpt.tuition_bill_print`, `sjpt.registration_history_tuition_bill_print`, `sjpt.scholarship_history_bill_print` | typo |
| ko | 수강 신청 내역 | `sjpt.registered_courses_inquiry_print` | `sjpt.course_registration`, `portal.course_guide`, `sjpt.course_search_registration` | spacing differs from keywords |
| ko | 장학금 받으려면 | `sjpt.scholarship_registration_student_support` | `portal.scholarships`, `sjpt.scholarship_registration_student_support`, `sjpt.regular_semester_scholarship_application` | verb ending |
| ko | 도서관 스터디룸 예약 | `library.fac_studyroom` | `library.home_reserve_studyroom`, `library.fac_studyroom`, `library.my_rooms` |  |

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
