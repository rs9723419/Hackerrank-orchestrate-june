export interface ClaimInput {
  claim_id: string;
  conversation: string;
  user_history: string;
  image_ids: string[]; // parsed from comma-separated original column
  object_type: 'car' | 'laptop' | 'package' | string;
  expected_decision?: string; // in case validation labels are present
}

export interface VerificationResult {
  claim_id: string;
  extracted_claim: string;
  evidence_sufficient: 'Yes' | 'No';
  issue_type: string; // scratch, dent, crack, shatter, hole, water damage, torn, open, normal, other
  object_part: string; // bumper, windshield, door, screen, keyboard, box, bubble mailer, etc.
  decision: 'supported' | 'contradicted' | 'not enough information';
  supporting_images: string[];
  risks_flagged: string[]; // quality, mismatch, authenticity, user history, none
  severity: 'low' | 'medium' | 'high';
  justification: string;
  confidence: number; // custom confidence rating out of 100
}

export interface VerificationReport {
  input: ClaimInput;
  result: VerificationResult;
}

export interface EvaluationMetrics {
  total: number;
  sufficientCount: number;
  insufficientCount: number;
  decisionDistribution: {
    supported: number;
    contradicted: number;
    notEnoughInfo: number;
  };
  severityDistribution: {
    low: number;
    medium: number;
    high: number;
  };
  risksTriggered: Record<string, number>;
  partsAffected: Record<string, number>;
  issuesFitted: Record<string, number>;
  accuracy?: number; // if ground truth exists
  confusionMatrix?: Record<string, Record<string, number>>;
}
