import express from "express";
import twilio from "twilio";
import maintenanceRouter from "./maintenance";

const router = express.Router();

// Twilio signature verification middleware.
router.use("/twilio", express.urlencoded({ extended: false }));
router.use("/twilio", (req, res, next) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const signature = req.get("X-Twilio-Signature") || "";
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  const valid = authToken
    ? twilio.validateRequest(authToken, signature, url, req.body)
    : false;

  if (!authToken) {
    return res.status(500).json({ error: "twilio_auth_token_missing" });
  }

  if (!valid) {
    return res.status(403).json({ error: "invalid_signature" });
  }

  return next();
});

// Handle inbound SMS webhook and route into maintenance flow.
router.post("/twilio", async (req, res, next) => {
  try {
    const tenantMessage = req.body?.Body || "";
    const tenantPhone = req.body?.From || "";

    if (!tenantMessage) {
      return res.status(400).json({ error: "missing_message_body" });
    }

    // Reuse maintenance route handler logic by delegating internally.
    req.body = {
      tenantMessage,
      tenantId: tenantPhone, // placeholder mapping until DB mapping exists
      unitId: undefined,
    };

    // Forward to maintenance router
    return (maintenanceRouter as unknown as express.RequestHandler)(req, res, next);
  } catch (err) {
    return next(err);
  }
});

export default router;
