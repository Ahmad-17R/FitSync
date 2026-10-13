## Mean over 5 queries

| Model | P@3 | P@5 | R@5 | MAP | MRR |
|---|---|---|---|---|---|
| Boolean * | 0.733 | 0.600 | 0.850 | 0.800 | 0.900 |
| BIM | 0.333 | 0.320 | 0.510 | 0.616 | 0.535 |
| BIM + feedback | 0.333 | 0.280 | 0.470 | 0.598 | 0.524 |
| BM25 | 0.733 | 0.600 | 0.850 | 0.904 | 1.000 |
| BM25F | 0.733 | 0.600 | 0.850 | 0.904 | 1.000 |

* Boolean returns an unranked set; its ranked metrics use arbitrary id order. Set-based scores are below.

## Boolean as a set

| Query | Expression | Retrieved | Precision | Recall | F1 |
|---|---|---|---|---|---|
| Q1 | standing AND leg AND bent AND tree | 1 | 1.00 | 1.00 | 1.00 |
| Q2 | beginner AND balance NOT floor | 2 | 0.50 | 0.50 | 0.50 |
| Q3 | gentle AND stretch AND lower AND back | 5 | 1.00 | 1.00 | 1.00 |
| Q4 | hamstring AND stretch | 5 | 1.00 | 1.00 | 1.00 |
| Q5 | arms AND overhead | 3 | 1.00 | 0.75 | 0.86 |

## Q1: "standing leg bent tree"

Source: Live coach: Tree Pose emitted 'Standing leg is bent'  
Relevant: tree

| Model | Top 3 (✓ = relevant) | P@3 | AP |
|---|---|---|---|
| Boolean | tree ✓ | 0.33 | 1.00 |
| BIM | tree ✓, chair, bridge | 0.33 | 1.00 |
| BIM + feedback | tree ✓, chair, bridge | 0.33 | 1.00 |
| BM25 | tree ✓, mountain, warrior_ii | 0.33 | 1.00 |
| BM25F | tree ✓, mountain, warrior_ii | 0.33 | 1.00 |

## Q2: "beginner balance"

Source: User: wants beginner-friendly balance work, no floor poses  
Relevant: tree, triangle

| Model | Top 3 (✓ = relevant) | P@3 | AP |
|---|---|---|---|
| Boolean | mountain, triangle ✓ | 0.33 | 0.25 |
| BIM | side_plank, warrior_iii, half_moon | 0.00 | 0.20 |
| BIM + feedback | side_plank, warrior_iii, half_moon | 0.00 | 0.20 |
| BM25 | tree ✓, eagle, half_moon | 0.33 | 0.62 |
| BM25F | tree ✓, eagle, half_moon | 0.33 | 0.62 |

## Q3: "gentle stretch lower back"

Source: User: stiff lower back, wants something gentle  
Relevant: cat_cow, childs_pose, cobra, sphinx, supine_twist

| Model | Top 3 (✓ = relevant) | P@3 | AP |
|---|---|---|---|
| Boolean | cobra ✓, childs_pose ✓, cat_cow ✓ | 1.00 | 1.00 |
| BIM | mountain, easy_pose, upward_salute | 0.00 | 0.40 |
| BIM + feedback | mountain, easy_pose, upward_salute | 0.00 | 0.32 |
| BM25 | supine_twist ✓, childs_pose ✓, cobra ✓ | 1.00 | 1.00 |
| BM25F | supine_twist ✓, childs_pose ✓, cobra ✓ | 1.00 | 1.00 |

## Q4: "hamstring stretch"

Source: User: tight hamstrings  
Relevant: downward_dog, seated_forward_bend, standing_forward_bend, triangle, wide_forward_bend

| Model | Top 3 (✓ = relevant) | P@3 | AP |
|---|---|---|---|
| Boolean | triangle ✓, downward_dog ✓, seated_forward_bend ✓ | 1.00 | 1.00 |
| BIM | bridge, warrior_iii, triangle ✓ | 0.33 | 0.56 |
| BIM + feedback | bridge, warrior_iii, triangle ✓ | 0.33 | 0.56 |
| BM25 | seated_forward_bend ✓, wide_forward_bend ✓, standing_forward_bend ✓ | 1.00 | 1.00 |
| BM25F | standing_forward_bend ✓, seated_forward_bend ✓, wide_forward_bend ✓ | 1.00 | 1.00 |

## Q5: "arms overhead"

Source: Live coach: Warrior I emitted 'Arms not raised overhead'  
Relevant: chair, tree, upward_salute, warrior_i

| Model | Top 3 (✓ = relevant) | P@3 | AP |
|---|---|---|---|
| Boolean | tree ✓, warrior_i ✓, upward_salute ✓ | 1.00 | 0.75 |
| BIM | tree ✓, warrior_i ✓, upward_salute ✓ | 1.00 | 0.92 |
| BIM + feedback | tree ✓, warrior_i ✓, upward_salute ✓ | 1.00 | 0.92 |
| BM25 | upward_salute ✓, warrior_i ✓, tree ✓ | 1.00 | 0.89 |
| BM25F | upward_salute ✓, warrior_i ✓, tree ✓ | 1.00 | 0.89 |
