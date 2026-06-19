import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { ClaimInput, VerificationResult, EvaluationMetrics } from './types.js';

// Helper to safely parse CSV rows
export function parseCSV(csvText: string): ClaimInput[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0 || !lines[0]) return [];

  // Parse headers: clean spaces, quotes, and normalize lowercase
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Find column indexes
  const idIdx = headers.findIndex((h) => h === 'claim_id' || h === 'id' || h.includes('id'));
  const convIdx = headers.findIndex((h) => h === 'conversation' || h === 'dialog' || h === 'text' || h.includes('conversation') || h.includes('chat'));
  const histIdx = headers.findIndex((h) => h === 'user_history' || h === 'history' || h.includes('history'));
  const imgIdx = headers.findIndex((h) => h === 'image_ids' || h === 'images' || h.includes('image'));
  const typeIdx = headers.findIndex((h) => h === 'object_type' || h === 'type' || h.includes('object'));
  const expectedIdx = headers.findIndex((h) => h === 'expected' || h === 'ground_truth' || h === 'expected_decision' || h.includes('expected'));

  console.log("CSV parsed headers:", headers, "Indices:", { idIdx, convIdx, histIdx, imgIdx, typeIdx, expectedIdx });

  const claims: ClaimInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line considering quotes
    const cols: string[] = [];
    let inQuotes = false;
    let currentPart = '';

    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(currentPart.trim());
        currentPart = '';
      } else {
        currentPart += char;
      }
    }
    cols.push(currentPart.trim());

    // Fallback if split length doesn't match headers
    if (cols.length < Math.max(idIdx, convIdx, histIdx, imgIdx, typeIdx) + 1) {
      continue;
    }

    const claim_id = idIdx !== -1 ? cols[idIdx]?.replace(/^"|"$/g, '') : `claim_${i}`;
    const conversation = convIdx !== -1 ? cols[convIdx]?.replace(/^"|"$/g, '') : '';
    const user_history = histIdx !== -1 ? cols[histIdx]?.replace(/^"|"$/g, '') : '';
    const object_type = typeIdx !== -1 ? cols[typeIdx]?.replace(/^"|"$/g, '').toLowerCase() : 'unknown';
    const expected_decision = expectedIdx !== -1 ? cols[expectedIdx]?.replace(/^"|"$/g, '') : undefined;

    // Extract image IDs
    const rawImagesString = imgIdx !== -1 ? cols[imgIdx]?.replace(/^"|"$/g, '') : '';
    // Images are typically array in format like `['img1.jpg', 'img2.jpg']` or `img1.jpg; img2.jpg` or comma-separated
    let image_ids: string[] = [];
    if (rawImagesString) {
      const cleaned = rawImagesString.replace(/[\[\]']/g, ''); // remove [] and '
      image_ids = cleaned.split(/[,;|]/).map((img) => img.trim()).filter(Boolean);
    }

    claims.push({
      claim_id,
      conversation,
      user_history,
      image_ids,
      object_type,
      expected_decision,
    });
  }

  return claims;
}

// Convert mime types from filenames
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg'; // fallback
}

// Extract zip and load files
export async function unzipAndLoadClaims(zipFilePath: string): Promise<{
  claims: ClaimInput[];
  images: Record<string, { base64: string; mimeType: string }>;
}> {
  console.log(`Loading zip: ${zipFilePath}`);
  const zip = new AdmZip(zipFilePath);
  const zipEntries = zip.getEntries();

  let csvContent = '';
  const imagesMap: Record<string, { base64: string; mimeType: string }> = {};

  zipEntries.forEach((entry) => {
    const entryName = entry.entryName;
    const lowerName = entryName.toLowerCase();
    
    if (lowerName.endsWith('.csv') && !entryName.includes('__MACOSX')) {
      csvContent = entry.getData().toString('utf8');
      console.log(`Found CSV file in zip: ${entryName}`);
    } else if (
      (lowerName.endsWith('.jpg') ||
        lowerName.endsWith('.jpeg') ||
        lowerName.endsWith('.png') ||
        lowerName.endsWith('.webp')) &&
      !entryName.includes('__MACOSX')
    ) {
      const filename = path.basename(entryName);
      const base64 = entry.getData().toString('base64');
      const mimeType = getMimeType(entryName);
      imagesMap[filename] = { base64, mimeType };
    }
  });

  if (!csvContent) {
    throw new Error("No .csv claims template found in ZIP file.");
  }

  const claims = parseCSV(csvContent);
  console.log(`Extracted ${claims.length} claims and ${Object.keys(imagesMap).length} images from zip.`);

  return { claims, images: imagesMap };
}

// Generate schema output.csv content
export function writeCSV(results: VerificationResult[]): string {
  const headers = [
    'claim_id',
    'extracted_claim',
    'evidence_sufficient',
    'issue_type',
    'object_part',
    'decision',
    'supporting_images',
    'risks_flagged',
    'severity',
    'justification'
  ];

  const escapeCSV = (str: string) => {
    if (!str) return '""';
    const cleaned = str.replace(/"/g, '""');
    return `"${cleaned}"`;
  };

  const rows = results.map((r) => {
    const supportingImagesStr = r.supporting_images.join(', ');
    const risksStr = r.risks_flagged.join(', ');

    return [
      escapeCSV(r.claim_id),
      escapeCSV(r.extracted_claim),
      escapeCSV(r.evidence_sufficient),
      escapeCSV(r.issue_type),
      escapeCSV(r.object_part),
      escapeCSV(r.decision),
      escapeCSV(supportingImagesStr),
      escapeCSV(risksStr),
      escapeCSV(r.severity),
      escapeCSV(r.justification)
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

// Evaluation Metrics logic
export function calculateMetrics(
  results: VerificationResult[],
  inputs: ClaimInput[]
): EvaluationMetrics {
  const total = results.length;
  let sufficientCount = 0;
  let insufficientCount = 0;

  const decisionDistribution = {
    supported: 0,
    contradicted: 0,
    notEnoughInfo: 0,
  };

  const severityDistribution = {
    low: 0,
    medium: 0,
    high: 0,
  };

  const risksTriggered: Record<string, number> = {};
  const partsAffected: Record<string, number> = {};
  const issuesFitted: Record<string, number> = {};

  results.forEach((r) => {
    // Sufficiency
    if (r.evidence_sufficient === 'Yes') sufficientCount++;
    else insufficientCount++;

    // Decision
    if (r.decision === 'supported') decisionDistribution.supported++;
    else if (r.decision === 'contradicted') decisionDistribution.contradicted++;
    else decisionDistribution.notEnoughInfo++;

    // Severity
    severityDistribution[r.severity]++;

    // Risks
    r.risks_flagged.forEach((risk) => {
      const rName = risk.trim().toLowerCase();
      risksTriggered[rName] = (risksTriggered[rName] || 0) + 1;
    });

    // Parts
    const part = r.object_part.trim().toLowerCase();
    partsAffected[part] = (partsAffected[part] || 0) + 1;

    // Issues
    const issue = r.issue_type.trim().toLowerCase();
    issuesFitted[issue] = (issuesFitted[issue] || 0) + 1;
  });

  // Calculate Accuracy/Metrics if Ground Truth is provided
  let correctCount = 0;
  let groundTruthCount = 0;
  const confusion: Record<string, Record<string, number>> = {
    supported: { supported: 0, contradicted: 0, 'not enough information': 0 },
    contradicted: { supported: 0, contradicted: 0, 'not enough information': 0 },
    'not enough information': { supported: 0, contradicted: 0, 'not enough information': 0 },
  };

  results.forEach((r) => {
    const input = inputs.find((item) => item.claim_id === r.claim_id);
    if (input && input.expected_decision) {
      groundTruthCount++;
      const expected = input.expected_decision.trim().toLowerCase();
      const actual = r.decision.trim().toLowerCase();

      // Normalize string variations
      let normalizedExpected = expected;
      if (expected.includes('enough') || expected.includes('insufficient') || expected.includes('not')) {
        normalizedExpected = 'not enough information';
      }

      let normalizedActual = actual;

      if (normalizedExpected === normalizedActual) {
        correctCount++;
      }

      // Populate confusion matrix
      if (confusion[normalizedExpected] && confusion[normalizedExpected][normalizedActual] !== undefined) {
        confusion[normalizedExpected][normalizedActual]++;
      }
    }
  });

  const accuracy = groundTruthCount > 0 ? (correctCount / groundTruthCount) * 100 : undefined;

  return {
    total,
    sufficientCount,
    insufficientCount,
    decisionDistribution,
    severityDistribution,
    risksTriggered,
    partsAffected,
    issuesFitted,
    accuracy,
    confusionMatrix: groundTruthCount > 0 ? confusion : undefined,
  };
}
