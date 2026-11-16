<!-- AI-generated — to be rewritten by me -->
# Search evaluation

Model: `intfloat/multilingual-e5-small`, 30 questions (eval/questions.py). Regenerate with `.venv/bin/python -m eval.run_eval`.

| Setup | uz top-1 | uz top-3 | en top-1 | en top-3 | ko top-1 | ko top-3 | all top-1 | all top-3 |
|---|---|---|---|---|---|---|---|---|
| lexical only (w=0) | 9/10 (90%) | 9/10 (90%) | 6/10 (60%) | 7/10 (70%) | 9/10 (90%) | 9/10 (90%) | 24/30 (80%) | 25/30 (83%) |
| semantic only (w=1) | 4/10 (40%) | 7/10 (70%) | 6/10 (60%) | 8/10 (80%) | 8/10 (80%) | 10/10 (100%) | 18/30 (60%) | 25/30 (83%) |
| hybrid (w=0.7) | 5/10 (50%) | 9/10 (90%) | 7/10 (70%) | 9/10 (90%) | 9/10 (90%) | 10/10 (100%) | 21/30 (70%) | 28/30 (93%) |

## Weight sweep (all languages)

| w | top-1 | top-3 |
|---|---|---|
| 0.0 | 24/30 (80%) | 25/30 (83%) |
| 0.3 | 26/30 (87%) | 28/30 (93%) |
| 0.5 | 24/30 (80%) | 28/30 (93%) |
| 0.6 | 21/30 (70%) | 28/30 (93%) |
| 0.7 | 21/30 (70%) | 28/30 (93%) |
| 0.8 | 20/30 (67%) | 27/30 (90%) |
| 0.9 | 20/30 (67%) | 26/30 (87%) |
| 1.0 | 18/30 (60%) | 25/30 (83%) |

## Hybrid top-1 failures (w=0.7)

| lang | question | expected | got (top 3) | note |
|---|---|---|---|---|
| uz | baholarim qayerda? | `sjpt.grade_current` | `library.my_library`, `ecampus.my_courses`, `sjpt.grade_current` | the headline case |
| uz | baholarimni qayerdan ko'rsam bo'ladi | `sjpt.grade_current` | `library.my_library`, `ecampus.my_courses`, `sjpt.grade_current` | suffix -ni |
| uz | imtihon natijalarim | `sjpt.grade_current` | `library.my_library`, `ecampus.my_courses`, `sjpt.grade_history` | no shared words |
| uz | kutubxonadan olgan kitoblarim | `library.loans` | `library.my_library`, `library.root`, `library.loans` | suffixes |
| uz | uy vazifasini qayerga yuklayman | `ecampus.assignments` | `library.my_library`, `ecampus.assignments`, `library.room_booking` | suffix -ni |
| en | how do I renew a libary book | `library.loans` | `library.my_library`, `library.loans`, `sjpt.tuition_bill` | typo |
| en | where can I watch recorded lectures | `ecampus.my_courses` | `sjpt.grade_eval`, `sjpt.lecture_eval`, `library.root` | few shared words |
| en | change my phone number and address | `sjpt.student_record_view` | `library.my_library`, `sjpt.student_record_view`, `sjpt.timetable` | no shared words |
| ko | 빌린 책 반납 기한 | `library.loans` | `library.my_library`, `library.loans`, `sjpt.tuition_bill` | few shared words |
