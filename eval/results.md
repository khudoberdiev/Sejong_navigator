<!-- AI-generated — to be rewritten by me -->
# Search evaluation

Model: `intfloat/multilingual-e5-small`, 30 questions (eval/questions.py). Regenerate with `.venv/bin/python -m eval.run_eval`.

| Setup | uz top-1 | uz top-3 | en top-1 | en top-3 | ko top-1 | ko top-3 | all top-1 | all top-3 |
|---|---|---|---|---|---|---|---|---|
| lexical only (w=0) | 9/10 (90%) | 9/10 (90%) | 6/10 (60%) | 7/10 (70%) | 9/10 (90%) | 9/10 (90%) | 24/30 (80%) | 25/30 (83%) |
| semantic only (w=1) | 4/10 (40%) | 7/10 (70%) | 6/10 (60%) | 8/10 (80%) | 8/10 (80%) | 10/10 (100%) | 18/30 (60%) | 25/30 (83%) |
| hybrid (w=0.5) | 7/10 (70%) | 9/10 (90%) | 7/10 (70%) | 9/10 (90%) | 10/10 (100%) | 10/10 (100%) | 24/30 (80%) | 28/30 (93%) |

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

## Hybrid top-1 failures (w=0.5)

| lang | question | expected | got (top 3) | note |
|---|---|---|---|---|
| uz | baholarimni qayerdan ko'rsam bo'ladi | `sjpt.grade_current` | `library.my_library`, `sjpt.grade_current`, `ecampus.my_courses` | suffix -ni |
| uz | imtihon natijalarim | `sjpt.grade_current` | `library.my_library`, `ecampus.my_courses`, `sjpt.grade_history` | no shared words |
| uz | kutubxonadan olgan kitoblarim | `library.loans` | `library.root`, `library.my_library`, `library.loans` | suffixes |
| en | how do I renew a libary book | `library.loans` | `library.my_library`, `library.loans`, `library.root` | typo |
| en | where can I watch recorded lectures | `ecampus.my_courses` | `sjpt.grade_eval`, `sjpt.lecture_eval`, `library.root` | few shared words |
| en | change my phone number and address | `sjpt.student_record_view` | `library.my_library`, `sjpt.student_record_view`, `sjpt.timetable` | no shared words |

## Fine-tuning

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
