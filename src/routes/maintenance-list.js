const express = require("express");
const repo = require("../services/repository").default || require("../services/repository");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const limit = Number(_req.query?.limit) || 100;
    const status = _req.query?.status
      ? String(_req.query.status)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const unitId = _req.query?.unitId ? String(_req.query.unitId) : undefined;
    const tenantId = _req.query?.tenantId ? String(_req.query.tenantId) : undefined;
    const result = await repo.listMaintenance({ limit, status, unitId, tenantId });
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("maintenance list error", err);
    res.status(500).json({ error: "maintenance_list_failed", detail: err.message });
  }
});

module.exports = router;
