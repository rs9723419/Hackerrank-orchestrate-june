Hackerrank-orchestrate

Multi-Modal Evidence Review

A program that:

1. Reads the claims CSV.
2. Reads the associated local images.
3. Understands the user's conversation (what damage is being claimed).
4. Looks at the images.
5. Compares the claim against what is visible.
6. Produces a final decision.
7. Writes all results into `output.csv` in the required format.

---

### Example

#### Input

Conversation:

> "My laptop fell off the desk and the screen cracked."

Images:

* `img1.jpg`
* `img2.jpg`

User history:

```json
{
  "previous_claims": 1
}
```

#### Your system analyzes

Claim extracted:

```json
{
  "object": "laptop",
  "damage": "crack",
  "part": "screen"
}
```

Image analysis:

```json
{
  "object": "laptop",
  "visible_damage": "screen crack",
  "severity": "high"
}
```

Verification:

```json
{
  "decision": "supported"
}
```

---

### Modules you should design

#### 1. Claim Extraction

Input:

```text
conversation
```

Output:

```json
{
  "object_type": "car",
  "damage_type": "dent",
  "part": "rear bumper"
}
```

Use:

* LLM
* Prompt engineering

---

#### 2. Image Analysis

Input:

```text
images
```

Output:

```json
{
  "visible_damage": "dent",
  "part": "rear bumper",
  "severity": "moderate"
}
```

Use:

* GPT-4o Vision
* Qwen2.5-VL
* LLaVA

---

#### 3. Verification Engine

Compares:

```text
Claim
VS
Image evidence
```

Returns:

```text
supported
contradicted
insufficient
```

Example:

Claim:

```text
rear bumper dent
```

Image:

```text
rear bumper dent visible
```

→ Supported

---

#### 4. Risk Detection

Checks:

* blurry images
* wrong object type
* duplicate images
* suspicious history

Outputs:

```json
[
  "low_quality_image",
  "high_claim_frequency"
]
```

---

#### 5. CSV Generator

Creates:

```text
output.csv
```

with exactly the schema specified in `problem_statement.md`.

---

### Minimum Deliverables

Your code should contain something like:

```text
src/

main.py

claim_extractor.py

image_analyzer.py

verification.py

risk_detector.py

csv_writer.py
```

---

### What the judges are looking for

Not:

❌ "Train a damage classifier from scratch"

But:

✅ Build a complete multimodal reasoning pipeline:

```text
Conversation
      +
Images
      +
History
      ↓

Claim Extraction
      ↓

Image Understanding
      ↓

Evidence Verification
      ↓

Risk Assessment
      ↓

output.csv
```
