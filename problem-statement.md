# Multi-Modal Evidence Review

## Project Overview

The Multi-Modal Evidence Review system is designed to automate damage claim verification by combining visual evidence, claim conversations, user history, and predefined evidence standards. The solution evaluates claims involving cars, laptops, and packages, using submitted images as the primary source of truth. User conversations provide context regarding the reported damage, while historical claim information contributes additional risk signals. The system determines whether the available evidence supports, contradicts, or is insufficient to validate the reported claim and generates structured outputs with supporting justifications.

---

## What the System Does

For every claim, the system performs the following review workflow:

### Claim Understanding

* Extracts the actual damage claim from the user conversation.
* Identifies the reported issue and affected object type.
* Determines which object part should be inspected.

### Image Analysis

* Reviews one or more submitted images.
* Detects visible damage and relevant object parts.
* Evaluates image quality and usability.
* Identifies supporting evidence across multiple images.

### Evidence Validation

* Compares observed evidence against minimum evidence requirements.
* Determines whether sufficient visual evidence exists.
* Validates that the submitted images match the reported claim.

### Risk Assessment

* Reviews user claim history.
* Identifies image-quality and authenticity concerns.
* Flags cases that may require manual review.

### Decision Generation

* Assigns a final claim outcome.
* Estimates damage severity.
* Produces concise image-grounded justifications.
* Selects supporting image identifiers.

---

## Files Provided

| File                                | Purpose                                             |
| ----------------------------------- | --------------------------------------------------- |
| `dataset/sample_claims.csv`         | Labeled examples used for evaluation and validation |
| `dataset/claims.csv`                | Input claims requiring prediction generation        |
| `dataset/user_history.csv`          | Historical claim information and risk indicators    |
| `dataset/evidence_requirements.csv` | Evidence standards and minimum review requirements  |
| `dataset/images/sample/`            | Images associated with sample claims                |
| `dataset/images/test/`              | Images associated with prediction claims            |

Multiple image paths may be provided for a single claim and are separated using semicolons.

**Example:**

```text
images/test/case_001/img_1.jpg;
images/test/case_001/img_2.jpg
```

Image identifiers are derived from filenames without extensions.

**Example:**

```text
img_1.jpg → img_1
```

---

## Input Schema

Each row in `claims.csv` represents a single damage claim.

| Field          | Description                                   |
| -------------- | --------------------------------------------- |
| `user_id`      | Unique identifier of the claimant             |
| `image_paths`  | One or more image paths containing evidence   |
| `user_claim`   | Claim conversation describing reported damage |
| `claim_object` | Object category (`car`, `laptop`, `package`)  |

Additional contextual information is retrieved from:

* `user_history.csv`
* `evidence_requirements.csv`

during claim processing.

---

## Required Output

The system generates one prediction row for every claim.

| Output Column                  | Description                      |
| ------------------------------ | -------------------------------- |
| `user_id`                      | Claimant identifier              |
| `image_paths`                  | Submitted image paths            |
| `user_claim`                   | Original claim conversation      |
| `claim_object`                 | Object category                  |
| `evidence_standard_met`        | Evidence sufficiency result      |
| `evidence_standard_met_reason` | Explanation of evidence decision |
| `risk_flags`                   | Risk indicators                  |
| `issue_type`                   | Visible issue detected           |
| `object_part`                  | Affected object component        |
| `claim_status`                 | Final claim decision             |
| `claim_status_justification`   | Image-grounded explanation       |
| `supporting_image_ids`         | Evidence image identifiers       |
| `valid_image`                  | Image usability assessment       |
| `severity`                     | Estimated damage severity        |

The output is written to:

```text
output.csv
```

---

## Output Meaning

### Claim Status

| Value                    | Meaning                                   |
| ------------------------ | ----------------------------------------- |
| `supported`              | Images support the reported damage        |
| `contradicted`           | Images contradict the reported damage     |
| `not_enough_information` | Evidence is insufficient for verification |

### Severity Levels

| Value     | Meaning                       |
| --------- | ----------------------------- |
| `none`    | No visible damage             |
| `low`     | Minor damage                  |
| `medium`  | Moderate damage               |
| `high`    | Significant damage            |
| `unknown` | Severity cannot be determined |

### Risk Flags

The system may generate one or more risk indicators:

* blurry_image
* cropped_or_obstructed
* low_light_or_glare
* wrong_angle
* wrong_object
* wrong_object_part
* damage_not_visible
* claim_mismatch
* possible_manipulation
* non_original_image
* text_instruction_present
* user_history_risk
* manual_review_required

---

## Evaluation Requirement

The project includes an evaluation framework to validate system performance before generating final predictions.

### Evaluation Workflow

1. Load labeled examples from `sample_claims.csv`.
2. Run the complete review pipeline.
3. Compare generated predictions against expected outputs.
4. Measure decision consistency and evidence assessment quality.
5. Produce an operational analysis report.

### Evaluation Deliverables

```text
evaluation/
├── evaluation_report.md
└── evaluation_results.csv
```

The evaluation report includes:

* Estimated model calls
* Token usage estimates
* Number of processed images
* Cost estimation
* Runtime analysis
* TPM/RPM considerations
* Batching strategy
* Caching strategy
* Retry strategy

---

## Submission

The final submission consists of three required deliverables.

| Deliverable       | Description                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `code.zip`        | Complete runnable implementation including source code, prompts, configuration files, README, and evaluation materials |
| `output.csv`      | Predictions generated for all claims in `dataset/claims.csv`                                                           |
| `chat_transcript` | Development and usage transcript documenting the solution process                                                      |

### Included in `code.zip`

```text
code/
├── src/
├── evaluation/
├── prompts/
├── README.md
├── problem_statement.md
├── package.json
├── package-lock.json
├── .env.example
└── configuration files
```

### Excluded from `code.zip`

```text
node_modules/
dist/
build/
dataset/
data/
corpus/