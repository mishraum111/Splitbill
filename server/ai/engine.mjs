import { createHash } from 'node:crypto';
import { assert, currencies, minor, allocate } from '../finance.mjs';
import { createAiClient } from './provider.mjs';

const VALID_CATEGORIES = [
  'Food & drinks', 'Transport', 'Stay', 'Shopping', 'Activities',
  'Groceries', 'Bills', 'Fuel', 'Tickets', 'Rentals', 'Fees & tips', 'Health', 'Other',
];

const KEYWORD_RULES = [
  { cat: 'Food & drinks', re: /dinner|lunch|breakfast|cafe|coffee|zomato|swiggy|restaurant|pizza|burger|bar|drinks|tea|biryani|chai/i },
  { cat: 'Transport', re: /uber|ola|cab|taxi|auto|metro|train|irctc|flight|indigo|bus|toll|parking/i },
  { cat: 'Stay', re: /hotel|airbnb|oyo|hostel|resort|villa|stay|room|booking\.com/i },
  { cat: 'Groceries', re: /blinkit|zepto|instamart|bigbasket|dmart|grocery|supermarket|milk|vegetables|fruits/i },
  { cat: 'Fuel', re: /petrol|diesel|fuel|hpcl|bpcl|iocl|shell|cng/i },
  { cat: 'Tickets', re: /movie|pvr|inox|bookmyshow|ticket|concert|museum|entry/i },
  { cat: 'Bills', re: /electricity|wifi|broadband|airtel|jio|water|gas|rent|utility/i },
  { cat: 'Health', re: /pharmacy|apollo|medplus|doctor|hospital|medicine|clinic/i },
  { cat: 'Shopping', re: /amazon|flipkart|myntra|mall|zara|clothes|store/i },
];

export function inferCategoryDeterministic(text = '') {
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(text)) return { category: rule.cat, confidence: 0.86 };
  }
  return { category: 'Other', confidence: 0.45 };
}

export async function analyzeReceipt({ file, trip, aiClient = createAiClient() }) {
  assert(file && typeof file.data === 'string' && file.data.length > 0, 'Receipt file data is required');
  assert(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mime), 'Unsupported receipt format');
  const fileHash = createHash('sha256').update(file.data).digest('hex');

  const systemInstruction = `You are a precision financial receipt OCR and extraction engine.
Extract structured data from the provided receipt image or PDF.
Return ONLY valid JSON matching:
{
  "merchant": string,
  "date": "YYYY-MM-DD" or null,
  "currency": "${trip.currency}" or detected 3-letter ISO code,
  "category": one of ${JSON.stringify(VALID_CATEGORIES)},
  "items": [{ "name": string, "quantity": number, "unitPrice": number, "totalPrice": number }],
  "subtotal": number,
  "tax": number,
  "discount": number,
  "total": number,
  "missingFields": string[],
  "confidence": number between 0 and 1
}`;

  const aiResult = await aiClient.generateJson({
    systemInstruction,
    prompt: `Extract all line items, quantities, unit prices, taxes, discounts, merchant name, date, and final total. Group currency is ${trip.currency}.`,
    attachment: { mime: file.mime, data: file.data },
    temperature: 0.1,
  });

  if (!aiResult.ok) {
    const inferred = inferCategoryDeterministic(file.name || '');
    return {
      status: aiResult.reason === 'AI_NOT_CONFIGURED' ? 'needs_api_key' : 'fallback',
      message: aiResult.reason === 'AI_NOT_CONFIGURED'
        ? 'Set GEMINI_API_KEY on the server to enable automatic vision/PDF line-item OCR. You can enter or edit items manually below.'
        : `Vision service unavailable (${aiResult.reason}). Fill or adjust fields below.`,
      fileHash,
      merchant: (file.name || 'Receipt').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      date: new Date().toISOString().slice(0, 10),
      currency: trip.currency,
      category: inferred.category,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      mathValidation: { valid: true, discrepancy: 0, warnings: ['Manual entry required without vision API key'] },
      confidence: 0,
    };
  }

  const parsed = aiResult.data || {};
  const items = Array.isArray(parsed.items)
    ? parsed.items.map((it, idx) => ({
        id: `item_${idx + 1}`,
        name: String(it.name || `Item ${idx + 1}`).slice(0, 80),
        quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
        unitPrice: Number(it.unitPrice) || 0,
        totalPrice: Number(it.totalPrice) || (Number(it.quantity || 1) * Number(it.unitPrice || 0)),
        assignedTo: trip.members.map((m) => m.id),
      }))
    : [];

  const itemsSum = Number(items.reduce((acc, it) => acc + it.totalPrice, 0).toFixed(2));
  const tax = Number(parsed.tax) || 0;
  const discount = Number(parsed.discount) || 0;
  const total = Number(parsed.total) || Number((itemsSum + tax - discount).toFixed(2));
  const expectedTotal = Number((itemsSum + tax - discount).toFixed(2));
  const discrepancy = items.length > 0 ? Number((total - expectedTotal).toFixed(2)) : 0;

  const warnings = [];
  if (Math.abs(discrepancy) > 0.05) {
    warnings.push(`Receipt total (${total}) differs from items + tax - discount (${expectedTotal}) by ${discrepancy}. Verify before saving.`);
  }
  if (!parsed.date) warnings.push('Receipt date was unclear; defaulted to today.');
  if (!parsed.merchant) warnings.push('Merchant name was not detected.');

  const category = VALID_CATEGORIES.includes(parsed.category)
    ? parsed.category
    : inferCategoryDeterministic(`${parsed.merchant || ''} ${items.map((i) => i.name).join(' ')}`).category;

  return {
    status: 'extracted',
    provider: aiResult.provider,
    model: aiResult.model,
    fileHash,
    merchant: String(parsed.merchant || 'Scanned Receipt').slice(0, 120),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || '')) ? parsed.date : new Date().toISOString().slice(0, 10),
    currency: Object.hasOwn(currencies, parsed.currency) ? parsed.currency : trip.currency,
    category,
    items,
    subtotal: itemsSum,
    tax,
    discount,
    total,
    mathValidation: {
      valid: Math.abs(discrepancy) <= 0.05,
      expectedTotal,
      discrepancy,
      warnings,
    },
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.85)),
  };
}

export function computeItemizedShares(items, tax, discount, total, members, currency) {
  const scale = 10 ** currencies[currency];
  const memberWeights = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const item of items) {
    const assignees = (item.assignedTo || []).filter((id) => Object.hasOwn(memberWeights, id));
    if (!assignees.length) continue;
    const perPerson = (Number(item.totalPrice) || 0) / assignees.length;
    for (const id of assignees) memberWeights[id] += perPerson;
  }
  const activeMembers = members.filter((m) => memberWeights[m.id] > 0);
  assert(activeMembers.length > 0, 'Assign at least one item to a group member');
  const totalMinor = minor(String(Number(total).toFixed(currencies[currency])), currency);
  const allocated = allocate(
    totalMinor,
    activeMembers.map((m) => memberWeights[m.id]),
  );
  return activeMembers.map((m, idx) => ({
    memberId: m.id,
    amountMinor: allocated[idx],
    value: (allocated[idx] / scale).toFixed(currencies[currency]),
  }));
}

export function detectExpenseAnomalies({ candidate, trip, receiptAnalysis = null }) {
  const flags = [];
  let riskScore = 0;
  const currency = candidate.currency || trip.currency;
  const scale = 10 ** currencies[currency];
  const candidateMinor = minor(String(candidate.amount), currency);
  const candidateMajor = candidateMinor / scale;

  for (const existing of trip.expenses) {
    if (candidate.id && existing.id === candidate.id) continue;
    const sameAmount = existing.originalAmount === candidateMinor && existing.currency === currency;
    const sameDate = existing.date === candidate.date;
    const titleSim = existing.title.trim().toLowerCase() === String(candidate.title || '').trim().toLowerCase();

    if (sameAmount && sameDate && titleSim) {
      riskScore += 0.55;
      flags.push({
        code: 'EXACT_DUPLICATE',
        severity: 'high',
        reason: `An identical bill ("${existing.title}" for ${currency} ${candidateMajor.toFixed(2)} on ${existing.date}) already exists in this group.`,
      });
    } else if (sameAmount && sameDate) {
      riskScore += 0.35;
      flags.push({
        code: 'SAME_DAY_AMOUNT',
        severity: 'medium',
        reason: `Another expense of ${currency} ${candidateMajor.toFixed(2)} was already logged on ${existing.date} ("${existing.title}").`,
      });
    }
    if (receiptAnalysis?.fileHash && existing.receiptHash === receiptAnalysis.fileHash) {
      riskScore += 0.65;
      flags.push({
        code: 'DUPLICATE_RECEIPT_FILE',
        severity: 'high',
        reason: `This exact receipt file was already attached to "${existing.title}" on ${existing.date}.`,
      });
    }
  }

  if (receiptAnalysis && receiptAnalysis.total > 0) {
    const diff = Math.abs(candidateMajor - receiptAnalysis.total);
    if (diff > Math.max(1, receiptAnalysis.total * 0.02)) {
      riskScore += 0.4;
      flags.push({
        code: 'RECEIPT_AMOUNT_MISMATCH',
        severity: 'high',
        reason: `Entered amount (${currency} ${candidateMajor.toFixed(2)}) differs from scanned receipt total (${receiptAnalysis.currency} ${receiptAnalysis.total.toFixed(2)}).`,
      });
    }
    if (receiptAnalysis.date && candidate.date && receiptAnalysis.date !== candidate.date) {
      riskScore += 0.2;
      flags.push({
        code: 'RECEIPT_DATE_MISMATCH',
        severity: 'low',
        reason: `Entered date (${candidate.date}) differs from the date printed on the receipt (${receiptAnalysis.date}).`,
      });
    }
  }

  if (trip.expenses.length >= 4) {
    const amounts = trip.expenses.map((e) => e.amount / scale);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0 && candidateMajor > mean + 3 * stdDev && candidateMajor > mean * 2.5) {
      riskScore += 0.3;
      flags.push({
        code: 'UNUSUAL_AMOUNT_SPIKE',
        severity: 'medium',
        reason: `Amount (${currency} ${candidateMajor.toFixed(2)}) is significantly higher than this group's typical expense average (${currency} ${mean.toFixed(2)}).`,
      });
    }
  }

  const confidence = Number(Math.min(0.99, riskScore).toFixed(2));
  return {
    flagged: flags.length > 0,
    confidence,
    level: confidence >= 0.6 ? 'high' : confidence >= 0.3 ? 'medium' : 'none',
    summary: flags.length
      ? 'Potential anomaly detected — please review before saving.'
      : 'No duplicate or consistency issues detected.',
    flags,
  };
}

export function forecastGroupSpending({ trip, budgets = {} }) {
  const scale = 10 ** currencies[trip.currency];
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = Math.max(1, now.getDate());

  const byMonth = {};
  const currentMonthByCategory = {};
  const historicalByCategory = {};

  for (const exp of trip.expenses) {
    const month = String(exp.date || '').slice(0, 7);
    const major = exp.amount / scale;
    byMonth[month] = (byMonth[month] || 0) + major;
    if (month === currentMonth) {
      currentMonthByCategory[exp.category] = (currentMonthByCategory[exp.category] || 0) + major;
    } else {
      historicalByCategory[exp.category] = (historicalByCategory[exp.category] || 0) + major;
    }
  }

  const pastMonths = Object.keys(byMonth).filter((m) => m !== currentMonth).sort();
  const pastAvg = pastMonths.length
    ? pastMonths.reduce((s, m) => s + byMonth[m], 0) / pastMonths.length
    : 0;
  const currentSpend = byMonth[currentMonth] || 0;
  const paceProjection = (currentSpend / dayOfMonth) * daysInMonth;
  const predictedMonthTotal = pastAvg > 0
    ? Number((0.6 * paceProjection + 0.4 * pastAvg).toFixed(2))
    : Number(paceProjection.toFixed(2));

  const categoryInsights = Object.entries(currentMonthByCategory)
    .map(([category, spent]) => {
      const projected = Number(((spent / dayOfMonth) * daysInMonth).toFixed(2));
      const budgetLimit = budgets[category] ? budgets[category] / scale : null;
      return {
        category,
        spentToDate: Number(spent.toFixed(2)),
        projectedMonthly: projected,
        budgetLimit,
        overBudgetRisk: budgetLimit ? projected > budgetLimit : false,
        explanation: `You have spent ${trip.currency} ${spent.toLocaleString('en-IN')} on ${category} this month. Based on current pace, predicted monthly ${category.toLowerCase()} spend is ${trip.currency} ${projected.toLocaleString('en-IN')}.`,
      };
    })
    .sort((a, b) => b.projectedMonthly - a.projectedMonthly);

  const recommendations = [];
  for (const item of categoryInsights.slice(0, 2)) {
    if (item.overBudgetRisk && item.budgetLimit) {
      recommendations.push(
        `Trim ${item.category} spending by ${trip.currency} ${Math.ceil((item.projectedMonthly - item.budgetLimit) / Math.max(1, daysInMonth - dayOfMonth))}/day to stay within your ${trip.currency} ${item.budgetLimit} budget.`
      );
    } else if (item.projectedMonthly > 0) {
      recommendations.push(
        `Batching ${item.category.toLowerCase()} orders could save ~10% (${trip.currency} ${Math.round(item.projectedMonthly * 0.1)}) by month-end.`
      );
    }
  }

  const confidence = trip.expenses.length >= 10 ? 0.86 : trip.expenses.length >= 3 ? 0.72 : 0.54;
  return {
    currency: trip.currency,
    currentMonth,
    spentThisMonth: Number(currentSpend.toFixed(2)),
    predictedMonthTotal,
    historicalMonthlyAverage: Number(pastAvg.toFixed(2)),
    confidence,
    monthlySeries: Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total: Number(total.toFixed(2)) })),
    categoryInsights,
    recommendations,
  };
}

export async function runConversationalAgent({ message, history = [], trip, user, aiClient = createAiClient() }) {
  const promptText = String(message || '').trim();
  assert(promptText.length > 0 && promptText.length <= 1000, 'Enter a message up to 1000 characters');

  const scale = 10 ** currencies[trip.currency];
  const meMember = trip.members.find((m) => m.id === trip.me);
  const memberDirectory = trip.members.map((m) => ({
    id: m.id,
    name: m.name,
    balance: (trip.balances.find((b) => b.id === m.id)?.balance || 0) / scale,
  }));

  const proactiveSuggestions = [];
  const miscategorized = trip.expenses.filter(
    (e) => e.category === 'Other' && inferCategoryDeterministic(e.title).category !== 'Other'
  );
  if (miscategorized.length > 0) {
    const sample = miscategorized[0];
    const suggestedCat = inferCategoryDeterministic(sample.title).category;
    proactiveSuggestions.push({
      type: 'recategorize',
      expenseId: sample.id,
      title: `Re-categorize "${sample.title}" to ${suggestedCat}`,
      reason: `"${sample.title}" is currently under Other, but matches ${suggestedCat}.`,
      requiresConfirmation: true,
    });
  }
  if (trip.settlements.length > 0) {
    const top = trip.settlements[0];
    const fromName = trip.members.find((m) => m.id === top.from)?.name || 'Member';
    const toName = trip.members.find((m) => m.id === top.to)?.name || 'Member';
    proactiveSuggestions.push({
      type: 'settlement_reminder',
      title: `Settle up ${trip.currency} ${(top.amount / scale).toFixed(2)} (${fromName} → ${toName})`,
      reason: `${fromName} has the largest outstanding balance in "${trip.name}".`,
      requiresConfirmation: true,
    });
  }

  const addMatch = promptText.match(/(?:add|log|record|split)\s+(?:₹|rs\.?|inr|\$|€|£)?\s*(\d+(?:\.\d{1,2})?)\s+(.+?)(?:\s+(?:between|with|among|for)\s+(.+))?$/i);
  if (addMatch && !aiClient.status().configured) {
    const rawAmount = addMatch[1];
    const rawTitle = addMatch[2].replace(/\s+expense$/i, '').trim();
    const inferred = inferCategoryDeterministic(rawTitle);
    const targetText = (addMatch[3] || '').toLowerCase();
    let shareMembers = trip.members;
    if (targetText && !/all|everyone/.test(targetText)) {
      const matched = trip.members.filter((m) => targetText.includes(m.name.toLowerCase().split(' ')[0]));
      if (matched.length > 0) {
        shareMembers = matched.some((m) => m.id === trip.me) ? matched : [meMember, ...matched].filter(Boolean);
      }
    }
    return {
      reply: `I prepared a draft for "${rawTitle}" (${trip.currency} ${rawAmount}) split equally among ${shareMembers.map((m) => m.name).join(', ')}. Review and confirm to save.`,
      requiresConfirmation: true,
      draftExpense: {
        title: rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1),
        amount: rawAmount,
        currency: trip.currency,
        rate: 1,
        date: new Date().toISOString().slice(0, 10),
        category: inferred.category,
        note: 'Created via SplitBill AI Assistant',
        mode: 'equal',
        payers: [{ memberId: trip.me, amount: rawAmount }],
        shares: shareMembers.map((m) => ({ memberId: m.id, value: '0' })),
      },
      proactiveSuggestions,
    };
  }

  if (!aiClient.status().configured) {
    if (/highest|most|owes/i.test(promptText)) {
      const sorted = [...memberDirectory].sort((a, b) => a.balance - b.balance);
      const topDebtor = sorted[0];
      const topCreditor = sorted[sorted.length - 1];
      return {
        reply: topDebtor && topDebtor.balance < 0
          ? `${topDebtor.name} has the highest outstanding balance to pay (${trip.currency} ${Math.abs(topDebtor.balance).toFixed(2)}), while ${topCreditor.name} is owed ${trip.currency} ${topCreditor.balance.toFixed(2)}.`
          : `Everyone in ${trip.name} is currently settled up!`,
        requiresConfirmation: false,
        proactiveSuggestions,
      };
    }
    const totalMajor = trip.total / scale;
    return {
      reply: `"${trip.name}" has ${trip.expenses.length} expenses totaling ${trip.currency} ${totalMajor.toFixed(2)}. Your personal net balance is ${trip.currency} ${((meMember ? trip.balances.find((b) => b.id === trip.me)?.balance : 0) / scale).toFixed(2)}.`,
      requiresConfirmation: false,
      proactiveSuggestions,
    };
  }

  const systemInstruction = `You are SplitBill AI, an autonomous expense management assistant scoped strictly to the user's current group "${trip.name}" (${trip.currency}).
Logged-in user: ${user.name} (memberId: ${trip.me}).
Group members & current net balances (${trip.currency}): ${JSON.stringify(memberDirectory)}.
Recent expenses: ${JSON.stringify(trip.expenses.slice(-25).map((e) => ({ id: e.id, title: e.title, amount: e.amount / scale, category: e.category, date: e.date })))}.

Rules:
1. Never invent balances or expenses outside the provided group data.
2. If the user asks to create/add/split an expense, DO NOT claim it is saved; set "requiresConfirmation": true and return "draftExpense".
3. Return ONLY valid JSON:
{
  "reply": string,
  "requiresConfirmation": boolean,
  "draftExpense": null | {
    "title": string,
    "amount": string,
    "currency": "${trip.currency}",
    "rate": 1,
    "date": "YYYY-MM-DD",
    "category": one of ${JSON.stringify(VALID_CATEGORIES)},
    "note": string,
    "mode": "equal" | "exact" | "percent" | "shares",
    "payers": [{ "memberId": string, "amount": string }],
    "shares": [{ "memberId": string, "value": string }]
  }
}`;

  const llm = await aiClient.generateJson({
    systemInstruction,
    prompt: `Conversation history: ${JSON.stringify(history.slice(-6))}\nUser message: ${promptText}`,
    temperature: 0.2,
  });

  if (!llm.ok) {
    return {
      reply: `I couldn't reach the AI model (${llm.reason}), but your group "${trip.name}" currently has ${trip.expenses.length} bills totaling ${trip.currency} ${(trip.total / scale).toFixed(2)}.`,
      requiresConfirmation: false,
      proactiveSuggestions,
    };
  }

  return {
    reply: String(llm.data?.reply || 'Done.'),
    requiresConfirmation: Boolean(llm.data?.requiresConfirmation && llm.data?.draftExpense),
    draftExpense: llm.data?.draftExpense || null,
    proactiveSuggestions,
  };
}
