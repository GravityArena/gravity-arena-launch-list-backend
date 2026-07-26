import assert from "node:assert/strict";
import test from "node:test";
import { createLaunchListHandler } from "../src/launch-list.js";

const environment = {
  BREVO_API_KEY: "test-key",
  BREVO_MASTER_LIST_ID: "42",
  ALLOWED_ORIGINS: "https://gravityarena.co.za"
};

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    }
  };
}

function silentLogger() {
  return { info() {}, error() {} };
}

test("handles allowed CORS preflight", async () => {
  const handler = createLaunchListHandler({
    environment,
    logger: silentLogger()
  });
  const response = createResponse();

  await handler(
    {
      method: "OPTIONS",
      headers: { origin: "https://gravityarena.co.za" }
    },
    response
  );

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers["Access-Control-Allow-Origin"],
    "https://gravityarena.co.za"
  );
});

test("always allows official Gravity Arena origins", async () => {
  const handler = createLaunchListHandler({
    environment: {
      ...environment,
      ALLOWED_ORIGINS: "\"https://preview.example\""
    },
    logger: silentLogger()
  });
  const response = createResponse();

  await handler(
    {
      method: "OPTIONS",
      headers: { origin: "https://gravityarena.co.za" }
    },
    response
  );

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers["Access-Control-Allow-Origin"],
    "https://gravityarena.co.za"
  );
});

test("rejects an unapproved origin", async () => {
  const handler = createLaunchListHandler({
    environment,
    logger: silentLogger()
  });
  const response = createResponse();

  await handler(
    {
      method: "POST",
      headers: { origin: "https://example.com" },
      body: { email: "fan@example.com" }
    },
    response
  );

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.ok, false);
});

test("rejects invalid email without calling Brevo", async () => {
  let fetchCalled = false;
  const handler = createLaunchListHandler({
    environment,
    logger: silentLogger(),
    fetchImpl: async () => {
      fetchCalled = true;
    }
  });
  const response = createResponse();

  await handler(
    {
      method: "POST",
      headers: { origin: "https://gravityarena.co.za" },
      body: { email: "not-an-email" }
    },
    response
  );

  assert.equal(response.statusCode, 400);
  assert.equal(fetchCalled, false);
});

test("silently accepts a honeypot submission without calling Brevo", async () => {
  let fetchCalled = false;
  const handler = createLaunchListHandler({
    environment,
    logger: silentLogger(),
    fetchImpl: async () => {
      fetchCalled = true;
    }
  });
  const response = createResponse();

  await handler(
    {
      method: "POST",
      headers: { origin: "https://gravityarena.co.za" },
      body: {
        email: "bot@example.com",
        website: "https://spam.example"
      }
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(fetchCalled, false);
});

test("creates or updates a Brevo contact and assigns the master list", async () => {
  let request;
  const handler = createLaunchListHandler({
    environment,
    logger: silentLogger(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    }
  });
  const response = createResponse();

  await handler(
    {
      method: "POST",
      headers: { origin: "https://gravityarena.co.za" },
      body: {
        email: "Pilot@Example.com",
        firstName: "Avi",
        lastName: "Pilot",
        consent: true
      }
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(request.url, "https://api.brevo.com/v3/contacts");
  assert.equal(request.options.headers["api-key"], "test-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    email: "pilot@example.com",
    attributes: { FIRSTNAME: "Avi", LASTNAME: "Pilot" },
    listIds: [42],
    updateEnabled: true
  });
});

test("supports Brevo double opt-in when configured", async () => {
  let request;
  const handler = createLaunchListHandler({
    environment: {
      ...environment,
      BREVO_DOI_TEMPLATE_ID: "88",
      BREVO_DOI_REDIRECT_URL: "https://gravityarena.co.za/thank-you"
    },
    logger: silentLogger(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    }
  });
  const response = createResponse();

  await handler(
    {
      method: "POST",
      headers: { origin: "https://gravityarena.co.za" },
      body: { email: "fan@example.com" }
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.doubleOptIn, true);
  assert.equal(
    request.url,
    "https://api.brevo.com/v3/contacts/doubleOptinConfirmation"
  );
  assert.deepEqual(JSON.parse(request.options.body).includeListIds, [42]);
});

test("returns a safe error when Brevo is unavailable", async () => {
  const handler = createLaunchListHandler({
    environment,
    logger: silentLogger(),
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() {
        return { code: "unavailable", message: "sensitive upstream detail" };
      }
    })
  });
  const response = createResponse();

  await handler(
    {
      method: "POST",
      headers: { origin: "https://gravityarena.co.za" },
      body: { email: "fan@example.com" }
    },
    response
  );

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, "unavailable");
  assert.equal(
    response.body.error,
    "The signup service is temporarily unavailable. Please try again."
  );
});
