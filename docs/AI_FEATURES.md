# SplitBill AI Integration Documentation

## Overview
SplitBill has been upgraded with 5 AI-powered capabilities integrated directly into its existing Node.js + SQLite/Supabase + Expo React Native architecture without altering existing financial math (`finance.mjs`), authentication, or on-device child privacy boundaries.

## 1. Setup & Configuration
1. Copy `.env.example` to `.env` in the repository root:
   ```bash
   cp .env.example .env
   ```
2. Set `GEMINI_API_KEY` (from Google AI Studio) or `OPENAI_API_KEY`:
   ```env
   GEMINI_API_KEY=your-gemini-api-key
   GEMINI_MODEL=gemini-2.5-flash
   ```
3. Run the backend and web/mobile client:
   ```bash
   npm ci
   npm --prefix mobile ci
   npm run dev
   ```
4. Apply database migration `supabase/migrations/20261125000000_ai_features.sql` and redeploy Edge Function if using Supabase:
   ```bash
   node scripts/build-edge.mjs
   supabase functions deploy splitbill-api
   ```

## 2. Five Integrated AI Features
1. **Multimodal AI Bill Understanding (`POST /api/trips/:id/ai/scan-receipt`)**: Extracts merchant, date, line items, quantities, prices, tax, discount, and total from JPG/PNG/WebP/PDF bills via Gemini Vision; validates line-item arithmetic; and computes exact per-member shares via `ReceiptScannerSheet.tsx`.
2. **Autonomous AI Expense Agent (`POST /api/trips/:id/ai/assistant`)**: Audits group ledgers for miscategorized expenses and top settlement reminders, surfacing one-tap confirmation cards.
3. **AI Fraud & Duplicate Detection (`POST /api/trips/:id/ai/check-anomalies`)**: Flags SHA-256 duplicate receipt files, identical same-day expenses, receipt-vs-manual mismatches, and statistical Z-score outliers before finalizing a bill (`AnomalyBanner.tsx`).
4. **Predictive Group Spending Intelligence (`GET /api/trips/:id/ai/forecast`, `POST /api/trips/:id/ai/budgets`)**: Forecasts month-end group and category spend with confidence scores, budget comparisons, and saving recommendations inside `Analytics.tsx`.
5. **Natural Language & Voice Expense Management (`AiAssistantSheet.tsx`)**: Supports text and Web Speech voice commands to query balances, summarize expenses, and generate confirmation-gated expense drafts.
