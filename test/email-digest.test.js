import test from "node:test";
import assert from "node:assert/strict";
import { windowFor, redact, sensitive, readMailbox, renderDigest, priorDelivery, sendDigest } from "../lib/email-digest-core.js";
import handler from "../api/email-summary.js";

test("Tuesday and Friday windows are contiguous and use SAST 08:00", () => {
  const tue = windowFor(new Date("2026-10-27T06:15:00Z"));
  assert.deepEqual(tue, { start: "2026-10-23T06:00:00.000Z", end: "2026-10-27T06:00:00.000Z", preview: false });
  const fri = windowFor(new Date("2026-10-30T06:15:00Z"));
  assert.equal(fri.start, tue.end);
  const early = windowFor(new Date("2026-10-27T05:59:59Z"));
  assert.equal(early.end, tue.start);
});
test("contact information, identifiers and links are redacted", () => {
  assert.equal(redact("Call +27 74 974 1939 or person@example.com https://example.com"), "Call [number] or [email] [link]");
  assert.equal(sensitive({ subject: "Bank account number update" }), true);
  assert.equal(sensitive({ subject: "FPV enquiry" }), false);
});
test("privacy fetch excludes subject, sender and body, follows safe pagination", async () => {
  const original = global.fetch;
  const urls = [];
  const root = "https://graph.microsoft.com/v1.0/users/privacy%40gravityarena.co.za/mailFolders/inbox";
  global.fetch = async url => {
    urls.push(String(url));
    if (!String(url).includes("/messages")) return Response.json({ unreadItemCount: 1, totalItemCount: 2 });
    if (String(url).includes("page=2")) return Response.json({ value: [{ id: "two", isRead: true }] });
    return Response.json({ value: [{ id: "one", isRead: false }], "@odata.nextLink": root + "/messages?page=2" });
  };
  try {
    const result = await readMailbox("privacy", windowFor(new Date("2026-10-27T06:15:00Z")), "token");
    assert.equal(result.received, 2);
    assert.equal(result.unreadInWindow, 1);
    assert.equal(result.topics.length, 0);
    assert.equal(result.complete, true);
    const select = new URL(urls[1]).searchParams.get("$select");
    assert.ok(!/subject|body|from/.test(select));
    await assert.rejects(readMailbox("finance", {}, "token"), /out_of_scope/);
  } finally { global.fetch = original; }
});
test("no partial-success digest if mailbox fails or pagination leaves Graph", async () => {
  const original = global.fetch;
  global.fetch = async url => String(url).includes("/messages") ?
    Response.json({ value: [], "@odata.nextLink": "https://evil.example/messages" }) :
    Response.json({ unreadItemCount: 0 });
  try { await assert.rejects(readMailbox("info", windowFor(), "token"), /unexpected_graph_url/); }
  finally { global.fetch = original; }
});
test("unauthorized requests, GET send and disabled sending cannot invoke providers", async () => {
  const original = global.fetch;
  process.env.GA_EMAIL_SUMMARY_KEY = "key";
  delete process.env.GA_EMAIL_SUMMARIES_ENABLED;
  global.fetch = () => { throw new Error("provider_must_not_be_called"); };
  const response = () => ({ setHeader(){}, status(code){this.code=code;return this}, json(body){this.body=body;return this} });
  try {
    for (const [method, headers, query, expected] of [
      ["GET", {}, {}, 401], ["POST", { authorization: "Bearer wrong" }, {mode:"send"}, 401],
      ["GET", { authorization: "Bearer key" }, {mode:"send"}, 405],
      ["POST", { authorization: "Bearer key" }, {mode:"send"}, 409],
    ]) {
      const res = response();
      await handler({ method, headers, query }, res);
      assert.equal(res.code, expected);
    }
  } finally { global.fetch = original; }
});
test("provider logs suppress a matching report, not unrelated emails", async () => {
  const original = global.fetch;
  global.fetch = async () => Response.json({ count: 2, transactionalEmails: [
    { subject: "Other", email: "sibusiso@gravityarena.co.za" },
    { subject: "Digest", email: "sibusiso@gravityarena.co.za", messageId: "accepted" },
  ] });
  try {
    process.env.BREVO_API_KEY = "fake";
    const prior = await priorDelivery("Digest", windowFor());
    assert.equal(prior.found, true);
    assert.equal(prior.messageId, "accepted");
  } finally { global.fetch = original; }
});
test("send is founder-only and idempotency key respects provider length limit", async () => {
  const original = global.fetch;
  process.env.BREVO_SENDER_EMAIL = "info@gravityarena.co.za";
  global.fetch = async (url, options) => {
    const data = JSON.parse(options.body);
    assert.deepEqual(data.to, [{ email: "sibusiso@gravityarena.co.za", name: "Sibusiso" }]);
    assert.ok(data.headers.idempotencyKey.length <= 36);
    return Response.json({ messageId: "accepted" });
  };
  try { assert.equal(await sendDigest("Subject", "Body", windowFor()), "accepted"); }
  finally { global.fetch = original; }
});
