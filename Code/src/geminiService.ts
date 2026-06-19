import { GoogleGenAI, Type } from "@google/genai";
import { ClaimInput, VerificationResult } from "./types.js";

// Lazy-initialized GoogleGenAI client
let aiInstance: GoogleGenAI | null = null;

function getAi(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiInstance;
}

// Robust helper to perform requests to Gemini with retry-backoff and model fallbacks
async function generateContentWithRetryAndFallback(
  ai: GoogleGenAI,
  contents: any,
  config: any,
  primaryModel: string = "gemini-3.5-flash",
  fallbackModels: string[] = ["gemini-flash-latest", "gemini-3.1-flash-lite"]
): Promise<any> {
  const allModels = [primaryModel, ...fallbackModels];
  let lastError: any = null;

  for (const model of allModels) {
    let delay = 1500; // starting delay
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Calling Gemini API using model ${model} (Attempt ${attempt}/${maxRetries})...`);
        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error.message || "";
        const errorStatus = error.status || error.statusCode || "";

        // Identify transient/retryable errors
        const isTransient =
          errorStatus === "UNAVAILABLE" ||
          errorStatus === 503 ||
          errorStatus === "RESOURCE_EXHAUSTED" ||
          errorStatus === 429 ||
          errorMessage.includes("503") ||
          errorMessage.includes("UNAVAILABLE") ||
          errorMessage.includes("high demand") ||
          errorMessage.includes("overloaded") ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("exhausted") ||
          errorMessage.includes("ResourceExhausted") ||
          errorMessage.includes("Quota exceeded");

        if (isTransient) {
          if (attempt < maxRetries) {
            console.warn(`[Gemini API Warning] Model ${model} returned transient error: ${errorMessage}. Retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2; // exponential backoff
            continue;
          } else {
            console.warn(`[Gemini API Warning] Model ${model} failed after ${maxRetries} attempts.`);
          }
        } else {
          // Fail fast or try fallback model on non-transient errors (e.g. invalid arguments or config issues)
          console.error(`[Gemini API Error] Non-transient error on model ${model}: ${errorMessage}`);
          break; // break retry loop to try the next model
        }
      }
    }
  }

  throw lastError || new Error("All Gemini attempts failed.");
}

export async function verifyClaimWithGemini(
  claim: ClaimInput,
  images: { id: string; base64: string; mimeType: string }[]
): Promise<VerificationResult> {
  const ai = getAi();

  // Create parts for images
  const imageParts = images.map((img) => ({
    inlineData: {
      mimeType: img.mimeType,
      data: img.base64,
    },
  }));

  // Construct detailed text prompt with user context
  const textPrompt = `
You are an expert claims investigator verifying insurance/claims support based on user conversations and photographic evidence.
Please perform a detailed, rigorous multi-modal forensic review of the following claim:

--- CLAIM DETAILS ---
Claim ID: ${claim.claim_id}
Object Type: ${claim.object_type}
Conversation Log: ${claim.conversation}
User History Context: ${claim.user_history}
Available Image IDs for Review: ${claim.image_ids.join(', ')}

--- SPECIFIC GUIDELINES ---
1. Extract the primary claim detail from the conversation (what is specifically damaged, and what occurred).
2. Inspect the attached images. Determine if the evidence is SUFFICIENT.
   - Evidence is only sufficient if there are clear, in-focus photos of the claimed object and damage.
   - If the object shown does not match the claimed object type (e.g., car is claimed but image shows a laptop), flag a 'mismatch' risk and set decision to 'contradicted' (or 'not enough information' if the correct object is missing).
3. Identify the specific visible 'issue_type' and 'object_part' from the images.
   - Cars: bumper, windshield, door, hood, fender, mirror, headlight, trunk, window, wheel, chassis, other. Major issues: dent, scratch, crack, shatter, hole, crash, normal.
   - Laptops: screen, keyboard, bezel, hinge, lid, ports, screen bezel, trackpad, bottom cover, charger, other. Major issues: crack, shatter, scratch, key missing, spill/water, bent, burned, normal.
   - Packages: box, bubble mailer, tape, label, envelope, contents, other. Major issues: torn, open, crashed, crushed, water damage, ripped, normal.
4. Render a final decision:
   - 'supported': If there is clear, visible photographic evidence matching the user's claim and showing the damage.
   - 'contradicted': If the photo shows the claimed part is completely intact/undamaged (and it is clearly visible), or if the photo shows a completely different object or different type of damage, or if the user's claim is mathematically/logically refuted by the image.
   - 'not enough information': If the photos do not show the part in question, are too blurry/dark to see, are missing, or do not offer a clear view to confirm either way.
5. Select the supporting image IDs from the available list that direct the decision.
6. Flag risks:
   - 'quality': Blurry, dark, extreme closeups lacking context, or bad resolution.
   - 'mismatch': Image contains a different object, model, or license plate from the claim.
   - 'authenticity': Stock image, duplicate of another submission, tampered, computer-generated, or edited.
   - 'user history': High risk based on past history (e.g. high frequency of claims, fraud locks, multiple recent matches).
   - 'none': Default if clean submissions.
7. Estimate severity ('low', 'medium', 'high') based on the size/impact of damage.
8. Write a clear, concise justification explaining what exactly is visible in the photos and how it connects to the decision. Ground all observations firmly in the images. Reference specific image IDs, e.g. "In Image car1, a deep crack is visible in..." Wait, do NOT use generic statements; prove that you inspected the image details (colors, context, angles).

Please return the result in JSON format matching the schema requested below.
  `;

  const textPart = { text: textPrompt };

  try {
    const response = await generateContentWithRetryAndFallback(
      ai,
      { parts: [...imageParts, textPart] },
      {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: [
            "extracted_claim",
            "evidence_sufficient",
            "issue_type",
            "object_part",
            "decision",
            "supporting_images",
            "risks_flagged",
            "severity",
            "justification",
            "confidence",
          ],
          properties: {
            extracted_claim: {
              type: Type.STRING,
              description: "The extracted actual damage claim from the dialog, focusing on what object/part has what damage.",
            },
            evidence_sufficient: {
              type: Type.STRING,
              enum: ["Yes", "No"],
              description: "Is the photo evidence sufficient to assess the claim?",
            },
            issue_type: {
              type: Type.STRING,
              description: "The visible issue type, like: scratch, dent, crack, shatter, hole, torn, normal, etc. If undamaged, use 'normal' or 'none'.",
            },
            object_part: {
              type: Type.STRING,
              description: "The specific object component affected (e.g. bumper, windshield, screen, keyboard, lid, box, content, etc.).",
            },
            decision: {
              type: Type.STRING,
              enum: ["supported", "contradicted", "not enough information"],
              description: "Supported, contradicted, or not enough information decision.",
            },
            supporting_images: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Lists the image IDs supporting your decision (e.g. ['img1.png']). Avoid empty arrays if possible.",
            },
            risks_flagged: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Any flagged risks: quality, mismatch, authenticity, user history, or none.",
            },
            severity: {
              type: Type.STRING,
              enum: ["low", "medium", "high"],
              description: "The severity rating of the physical damage.",
            },
            justification: {
              type: Type.STRING,
              description: "Extremely professional, factual explanation grounded specifically in the photos.",
            },
            confidence: {
              type: Type.INTEGER,
              description: "Integer Confidence level from 0 to 100 on this decision.",
            },
          },
        },
      }
    );

    const parsed = JSON.parse(response.text || "{}");
    
    // Ensure default format and clean types
    return {
      claim_id: claim.claim_id,
      extracted_claim: parsed.extracted_claim || "Damage claim not extracted.",
      evidence_sufficient: parsed.evidence_sufficient === "Yes" ? "Yes" : "No",
      issue_type: parsed.issue_type || "other",
      object_part: parsed.object_part || "whole",
      decision: parsed.decision || "not enough information",
      supporting_images: parsed.supporting_images || [],
      risks_flagged: parsed.risks_flagged || ["none"],
      severity: parsed.severity || "low",
      justification: parsed.justification || "No justification provided.",
      confidence: parsed.confidence || 50,
    };
  } catch (error: any) {
    console.error(`Error processing claim ${claim.claim_id} with Gemini:`, error);
    // Graceful fallback
    return {
      claim_id: claim.claim_id,
      extracted_claim: "Extraction failed due to API or timeout error.",
      evidence_sufficient: "No",
      issue_type: "unverified",
      object_part: "unverified",
      decision: "not enough information",
      supporting_images: [],
      risks_flagged: ["quality"],
      severity: "low",
      justification: `AI review failed: ${error.message}`,
      confidence: 0,
    };
  }
}
