# Sweep verdicts

## Per-viewport observations

| phase | viewport | notes |
|---|---|---|
| intro | 375x812 | Card is well-contained, heading wraps naturally to two lines, both buttons clearly tappable, large dead-space below card (cosmetic only). |
| intro | 768x1024 | Card fits comfortably in ~30% of the viewport height; ~70% is blank grey — a noticeable but not harmful imbalance. |
| intro | 1440x900 | Same large dead-zone below the card. Content sits in a centered column leaving wide grey flanks; acceptable for an MVP landing card. |
| active | 375x812 seg1 | 3×3 puzzle grid and all four answer tiles visible in seg1 with no clipping. Selected tile (A) has a clear dark border ring. Nav bar (Back / Next) sits below fold. |
| active | 375x812 seg2 | Scrolled view shows the full answer grid plus Back/Next bar. "Next" button overlaps the gear FAB — the gear icon is partially obscured by the "Next →" button's right edge. |
| active | 768x1024 | Entire question + options + keyboard tip + Back/Next bar fits on one screen. Layout is clean; seg2 is a duplicate of seg1 (no additional content), confirming nothing is cut off. |
| active | 1440x900 | Everything above-fold in one screen; wide side margins. Keyboard tip ("Tip: press 1–6 to answer…") is light grey — readable at this size. |
| result | 375x812 seg1 | Score card legible. Q1 review card begins; the stat chip ("AI agents get this right 100%…") wraps to two lines at 375 px — readable but tight. "Incorrect" badge is properly visible. |
| result | 375x812 seg2 | Q1 and Q2 review cards. Option tiles in the answer row are small (~70 px) but recognisable; option labels (A/B/C/D) are light grey and faint but present. Q2 "Why:" explanation line is cut mid-sentence at the segment boundary — this is a scroll artefact, not a layout bug. |
| result | 375x812 seg3 | Q3–Q4 cards; answer grids render correctly at mobile width. |
| result | 768x1024 seg1 | Score card and Q1 review clean. Stat chip sits inline on one line at this width. "Incorrect" badge clips slightly into the gear FAB area in the bottom-right corner — cosmetic only. |
| result | 768x1024 seg2–3 | Q2–Q5 cards render correctly; "Why:" lines wrap cleanly; analogy puzzle (Q5) fits the 4-item row without overflow. |
| result | 1440x900 seg1–3 | All cards use full card width; puzzle grids are well-sized; no horizontal overflow; "Why:" lines are comfortably wide without becoming unreadably long. |

## Findings

- [med] **active-375x812-seg2**: The "Next →" button and the gear FAB overlap. The gear's dark circle is rendered behind the button's right edge, making both targets harder to hit precisely. Files: `active-375x812-seg2.png`. (The FAB is a fixed element; the sticky nav bar should either have enough right-padding or z-index to avoid sitting on top of it.)

- [low] **result-375x812-seg1, result-768x1024-seg1**: The stat chip text ("AI agents get this right 100% of the time · based on 5 runs") wraps to two lines at 375 px and sits very close to the card header, making the top of each review card visually dense. At 768 px it renders on one line without issue. Not a blocker but could be relieved by a slightly smaller font size or truncation strategy on that chip.

- [low] **result-375x812-seg2**: The selected-wrong answer chip (option B, red border) and selected-correct answer chip (option C/D, green border) are distinguishable, but the colour-only distinction between the *wrong user pick* (red tint) and the *correct answer* (green tint) may not be obvious at a glance on a small screen — the option labels (A/B/C/D) are rendered in a very light grey that reads close to the background. No hard readability failure, but label contrast could be nudged darker.

- [low] **intro-768x1024-seg1, intro-1440x900-seg1**: Both viewports show the intro card occupying roughly the top quarter of the screen, leaving a large blank grey expanse below. This is not broken but gives the page an empty feel. Could be addressed with vertical centering or additional below-fold content in future iterations.

- [low] **active-768x1024-seg2**: Segment 2 is a pixel-identical duplicate of seg1 (the page did not scroll further because all content fits in one viewport). This is correct behaviour, not a bug, but confirms the keyboard tip line ("Tip: press 1–6…") is the last element — it is light grey and small but legible at this size.
