const express = require("express");
const repo = require("../services/repository").default || require("../services/repository");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const result = await repo.listMaintenance(100);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("maintenance list error", err);
    res.status(500).json({ error: "maintenance_list_failed", detail: err.message });
  }
});

module.exports = router;
