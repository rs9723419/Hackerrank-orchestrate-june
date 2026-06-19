import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { unzipAndLoadClaims, writeCSV, calculateMetrics } from "./src/evalEngine.js";
import { verifyClaimWithGemini } from "./src/geminiService.js";
import { ClaimInput, VerificationResult } from "./src/types.js";

// Load configuration
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = 3000;

// Enable JSON bodies with higher limits for base64 claims uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Mock in-memory session cache
let activeClaims: ClaimInput[] = [];
let activeImages: Record<string, { base64: string; mimeType: string }> = {};
let activeResults: VerificationResult[] = [];

// Robust helper to match image files with nested paths, slashes, or case variations
function findActiveImage(targetRef: string) {
  if (!targetRef) return null;
  // 1. Try direct exact match
  if (activeImages[targetRef]) {
    return activeImages[targetRef];
  }

  // 2. Normalize and check base filenames case-insensitively
  const cleanTarget = path.basename(targetRef).toLowerCase().trim().replace(/['"\[\]]/g, "");
  for (const [key, value] of Object.entries(activeImages)) {
    const cleanKey = path.basename(key).toLowerCase().trim();
    if (cleanKey === cleanTarget) {
      return value;
    }
  }

  // 3. Fallback to substring checking if there's an exact subsegment match
  for (const [key, value] of Object.entries(activeImages)) {
    const cleanKey = key.toLowerCase();
    const cleanTargetRef = targetRef.toLowerCase();
    if (cleanKey.includes(cleanTargetRef) || cleanTargetRef.includes(cleanKey)) {
      return value;
    }
  }

  return null;
}

// Load pre-seeded data into active cache on startup
function loadSeeds() {
  try {
    const seedsPath = path.join(process.cwd(), "src", "seeds.json");
    if (fs.existsSync(seedsPath)) {
      const data = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
      activeClaims = data.claims || [];
      // Hydrate image mappings
      activeImages = {};
      for (const [name, b64] of Object.entries(data.images)) {
        activeImages[name] = {
          base64: b64 as string,
          mimeType: name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg" : "image/png"
        };
      }
      activeResults = [];
      console.log("Seeded claims database loaded successfully. Count:", activeClaims.length);
    }
  } catch (err: any) {
    console.error("Failed to load claims seeds:", err.message);
  }
}

loadSeeds();

// Set up destination for multer zip uploading
const upload = multer({ dest: "/tmp/claims-uploads" });

// API: Get Seed Data
app.get("/api/claims/seeds", (req, res) => {
  loadSeeds();
  res.json({
    success: true,
    claims: activeClaims,
    resultsCount: activeResults.length
  });
});

// API: List loaded claims
app.get("/api/claims/list", (req, res) => {
  res.json({
    success: true,
    claims: activeClaims,
    results: activeResults
  });
});

// API: Get single image content (handles paths, sub-directories, and special names via wildcard)
app.get("/api/claims/images/*", (req, res) => {
  // Extract trailing path after /api/claims/images/
  const wildcardPath = req.params[0];
  const img = findActiveImage(wildcardPath);
  if (!img) {
    return res.status(404).json({ error: `Image '${wildcardPath}' not found inside claims database.` });
  }
  const buffer = Buffer.from(img.base64, "base64");
  res.setHeader("Content-Type", img.mimeType);
  res.send(buffer);
});

// API: Upload claims ZIP template
app.post("/api/claims/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No ZIP file provided." });
  }

  try {
    const zipPath = req.file.path;
    const { claims, images } = await unzipAndLoadClaims(zipPath);

    activeClaims = claims;
    activeImages = images;
    activeResults = []; // reset results on new template upload

    // Clean up temporary uploaded file from multer
    fs.unlinkSync(zipPath);

    res.json({
      success: true,
      claimsCount: claims.length,
      imagesCount: Object.keys(images).length,
      claims
    });
  } catch (err: any) {
    console.error("ZIP processing error:", err.message);
    res.status(500).json({ error: `Failed to process uploaded ZIP file: ${err.message}` });
  }
});

// API: Verify claim (single or batch)
app.post("/api/claims/verify", async (req, res) => {
  const { claimId } = req.body;

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "GEMINI_API_KEY environment variable is not configured on the server. Please define it in your secrets."
    });
  }

  try {
    if (claimId) {
      // Verify singular claim
      const claim = activeClaims.find((c) => c.claim_id === claimId);
      if (!claim) {
        return res.status(404).json({ error: `Claim ID '${claimId}' not found.` });
      }

      const claimImages = claim.image_ids
        .map((imgId) => {
          const imgData = findActiveImage(imgId);
          if (imgData) {
            return {
              id: imgId,
              base64: imgData.base64,
              mimeType: imgData.mimeType,
            };
          }
          return null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const result = await verifyClaimWithGemini(claim, claimImages);

      // Upsert into active results array
      const existingIdx = activeResults.findIndex((r) => r.claim_id === claimId);
      if (existingIdx !== -1) {
        activeResults[existingIdx] = result;
      } else {
        activeResults.push(result);
      }

      return res.json({ success: true, result });
    } else {
      // Verify ALL (Batch Verification)
      const results: VerificationResult[] = [];
      console.log(`Starting Batch verification of ${activeClaims.length} records...`);

      for (const claim of activeClaims) {
        const claimImages = claim.image_ids
          .map((imgId) => {
            const imgData = findActiveImage(imgId);
            if (imgData) {
              return {
                id: imgId,
                base64: imgData.base64,
                mimeType: imgData.mimeType,
              };
            }
            return null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const result = await verifyClaimWithGemini(claim, claimImages);
        results.push(result);
      }

      activeResults = results;

      // Automatically output file to workspace root as requested in standard challenge output requirements
      try {
        const csvText = writeCSV(activeResults);
        fs.writeFileSync(path.join(process.cwd(), "output.csv"), csvText, "utf8");
        console.log("CSV output file auto-saved to workspace root.");
      } catch (fErr: any) {
        console.error("Failed to auto-write output.csv to project directory:", fErr.message);
      }

      return res.json({ success: true, resultsCount: results.length, results });
    }
  } catch (err: any) {
    console.error("Verification processing error:", err);
    res.status(500).json({ error: `AI claim verification failed: ${err.message}` });
  }
});

// API: Manual update/override (part of human-in-the-loop validation)
app.post("/api/claims/override", (req, res) => {
  const overrideResult: VerificationResult = req.body;
  if (!overrideResult || !overrideResult.claim_id) {
    return res.status(400).json({ error: "Invalid result payload." });
  }

  const existingIdx = activeResults.findIndex((r) => r.claim_id === overrideResult.claim_id);
  if (existingIdx !== -1) {
    activeResults[existingIdx] = {
      ...overrideResult,
      confidence: 100 // manually verified has max confidence score
    };

    // Save outputs
    try {
      const csvText = writeCSV(activeResults);
      fs.writeFileSync(path.join(process.cwd(), "output.csv"), csvText, "utf8");
    } catch {}

    return res.json({ success: true, result: activeResults[existingIdx] });
  } else {
    return res.status(404).json({ error: "Claim result not yet verified. Please verify with AI first, then apply details." });
  }
});

// API: Get evaluation performance scorecard and distributions
app.get("/api/claims/metrics", (req, res) => {
  try {
    const metrics = calculateMetrics(activeResults, activeClaims);
    res.json({ success: true, metrics });
  } catch (err: any) {
    res.status(500).json({ error: `Metrics calculation failed: ${err.message}` });
  }
});

// API: Stream output.csv file
app.get("/api/claims/download-csv", (req, res) => {
  if (activeResults.length === 0) {
    return res.status(400).send("No verified claims results to download. Please run verification first.");
  }

  try {
    const csvContent = writeCSV(activeResults);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=output.csv");
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).send(`Export failed: ${err.message}`);
  }
});

// Mount Vite middleware for SPA development, or static server in prod
async function startAppServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in Development environment (Vite pipeline).");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in Production mode (Static distribution).");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening at http://0.0.0.0:${PORT}`);
  });
}

startAppServer();
