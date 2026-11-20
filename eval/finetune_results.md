<!-- AI-generated — to be rewritten by me -->
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
