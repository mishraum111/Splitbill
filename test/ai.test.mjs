import { test } from 'node:test';
import { strict as a } from 'node:assert';
import { createApp } from '../server/index.mjs';
import { computeItemizedShares } from '../server/ai/engine.mjs';

test('AI endpoints enforce membership, detect duplicates/outliers, forecast spend, and draft NLP expenses safely', async (t) => {
  const app = createApp({ allowLegacyAuth: true, database: ':memory:' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  });

  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const req = async (path, method = 'GET', body, token, status = 200) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json();
    a.equal(res.status, status, JSON.stringify(data));
    return data;
  };

  const alice = await req('/guest', 'POST', { name: 'Alice' });
  const outsider = await req('/guest', 'POST', { name: 'Outsider' });
  const trip = await req('/trips', 'POST', { name: 'Goa Trip', currency: 'INR', guests: ['Rahul'] }, alice.token, 201);
  const [aliceMember, rahulMember] = trip.members;
  const path = `/trips/${trip.id}`;

  await req(`${path}/ai/forecast`, 'GET', undefined, outsider.token, 403);
  await req(`${path}/ai/assistant`, 'POST', { message: 'Summary' }, outsider.token, 403);

  const itemized = computeItemizedShares(
    [
      { name: 'Pizza', totalPrice: 600, assignedTo: [aliceMember.id, rahulMember.id] },
      { name: 'Coffee', totalPrice: 200, assignedTo: [rahulMember.id] },
    ],
    80,
    0,
    880,
    trip.members,
    'INR',
  );
  a.deepEqual(
    itemized.map((s) => s.amountMinor),
    [33000, 55000],
  );

  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 4; i++) {
    await req(
      `${path}/expenses`,
      'POST',
      {
        title: `Lunch ${i + 1}`,
        amount: '500',
        currency: 'INR',
        category: 'Food & drinks',
        date: today,
        mode: 'equal',
        shares: [{ memberId: aliceMember.id }, { memberId: rahulMember.id }],
        payers: [{ memberId: aliceMember.id }],
      },
      alice.token,
    );
  }

  const dupCheck = await req(
    `${path}/ai/check-anomalies`,
    'POST',
    {
      expense: { title: 'Lunch 1', amount: '500', currency: 'INR', date: today },
    },
    alice.token,
  );
  a.equal(dupCheck.flagged, true);
  a.ok(dupCheck.flags.some((f) => f.code === 'EXACT_DUPLICATE'));

  const forecast = await req(`${path}/ai/forecast`, 'GET', undefined, alice.token);
  a.equal(forecast.spentThisMonth, 2000);
  a.ok(forecast.predictedMonthTotal >= 2000);
  a.equal(forecast.categoryInsights[0].category, 'Food & drinks');

  const draftRes = await req(
    `${path}/ai/assistant`,
    'POST',
    { message: 'Add 1500 dinner expense between Alice and Rahul' },
    alice.token,
  );
  a.equal(draftRes.requiresConfirmation, true);
  a.equal(draftRes.draftExpense.amount, '1500');
  a.equal(draftRes.draftExpense.category, 'Food & drinks');

  const afterDraftTrip = await req(path, 'GET', undefined, alice.token);
  a.equal(afterDraftTrip.expenses.length, 4);
});
